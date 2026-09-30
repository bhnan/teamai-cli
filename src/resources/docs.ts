import path from 'node:path';
import fs from 'node:fs/promises';
import fse from 'fs-extra';
import { ResourceHandler } from './base.js';
import type { NamedPublishSource } from './base.js';
import { resolveBaseDir, type ResourceItem, type TeamaiConfig, type LocalConfig } from '../types.js';
import { expandHome, listDirs, pruneEmptyDirs, pathExists, readFileSafe } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import { caseFoldKey } from '../manifest-schema.js';
import { resolveResourceNamespaces } from '../resource-namespaces.js';
import { isPastVersionOf } from '../utils/git.js';

/**
 * The single directory the team docs bundle is copied into. In project scope a
 * `~/`-prefixed `sharing.docs.localDir` is relative to the project root, not to
 * HOME. `pull` writes here and `doctor` checks here (#598).
 */
export function resolveDocsDestination(teamConfig: TeamaiConfig, localConfig: LocalConfig): string {
  const localDir = teamConfig.sharing.docs.localDir;
  if (localConfig.scope === 'project' && localConfig.projectRoot && localDir.startsWith('~/')) {
    return path.join(localConfig.projectRoot, localDir.substring(2));
  }
  const expanded = expandHome(localDir);
  return path.isAbsolute(expanded) ? expanded : path.resolve(resolveBaseDir(localConfig), expanded);
}

/**
 * Parse a repo-relative docs publish key for one project: the default
 * `docs/<projectId>/…` or a named source's `docs/<projectId>_<name>/…`. Keys
 * under any other `docs/<namespace>/` never match.
 */
export function matchDocsPublishPrefix(
  key: string,
  projectId: string,
): { prefix: string; name?: string } | null {
  if (!key.startsWith('docs/')) return null;
  const rest = key.slice('docs/'.length);
  const nsSlash = rest.indexOf('/');
  if (nsSlash <= 0) return null;
  const ns = rest.slice(0, nsSlash);
  if (ns === projectId) return { prefix: `docs/${projectId}/` };
  if (ns.startsWith(`${projectId}_`)) {
    return { prefix: `docs/${ns}/`, name: ns.slice(projectId.length + 1) };
  }
  return null;
}

/** Only absence means an empty bundle; permission and I/O errors must stop pruning. */
async function readEntries(dir: string) {
  try {
    return await fse.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
}

/** Files in the docs mirror, including links themselves but never their targets. */
export async function listDocFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readEntries(expandHome(dir))) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isDirectory()) {
      const nested = await listDocFiles(path.join(dir, entry.name));
      files.push(...nested.map(file => `${entry.name}/${file}`));
    } else {
      files.push(entry.name);
    }
  }
  return files;
}

/** Remove stale visible entries without following local symlinks or removing dotfiles. */
async function pruneDocs(source: string | undefined, destination: string): Promise<void> {
  const sourceEntries = new Map((source ? await readEntries(source) : []).map(e => [e.name, e]));
  for (const entry of await readEntries(destination)) {
    if (entry.name.startsWith('.')) continue;
    const target = path.join(destination, entry.name);
    const sourceEntry = sourceEntries.get(entry.name);
    if (entry.isDirectory()) {
      if (sourceEntry && !sourceEntry.isDirectory()) continue;
      await pruneDocs(sourceEntry ? path.join(source!, entry.name) : undefined, target);
      // A stale directory containing hidden local files must survive.
      if (!sourceEntry && (await fse.readdir(target)).length === 0) await fse.rmdir(target);
    } else if (!sourceEntry) {
      await fse.unlink(target);
    }
  }
}

/** Whether `child` is `parent` itself or inside it; also the dedication rule a docs destination must pass. */
export function containsPath(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function hasHiddenEntries(dir: string): Promise<boolean> {
  for (const entry of await readEntries(dir)) {
    if (entry.name.startsWith('.')) return true;
    if (entry.isDirectory() && await hasHiddenEntries(path.join(dir, entry.name))) return true;
  }
  return false;
}

/**
 * Find replacements without traversing destination links or touching either
 * tree. `withheld` names top-level directories that are not copied (#707).
 */
async function findDocConflicts(
  source: string,
  destination: string,
  withheld: ReadonlySet<string> = new Set(),
): Promise<Array<{ source: string; target: string }>> {
  const conflicts: Array<{ source: string; target: string }> = [];
  const localEntries = new Map((await readEntries(destination)).map(entry => [entry.name, entry]));
  for (const entry of await readEntries(source)) {
    if (entry.name.startsWith('.') || withheld.has(entry.name)) continue;
    const local = localEntries.get(entry.name);
    if (!local) continue;
    const src = path.join(source, entry.name);
    const target = path.join(destination, entry.name);
    if (local.isSymbolicLink() || entry.isSymbolicLink() || local.isDirectory() !== entry.isDirectory()) {
      if (local.isDirectory() && await hasHiddenEntries(target)) {
        throw new Error(`Cannot replace ${target}: it contains hidden local entries. Move them before retrying.`);
      }
      conflicts.push({ source: src, target });
    } else if (entry.isDirectory()) {
      conflicts.push(...await findDocConflicts(src, target));
    }
  }
  return conflicts;
}

/** Copy `source` over `destination`, except the top-level directories in `withheld`. */
async function copyDocs(source: string, destination: string, withheld: ReadonlySet<string>): Promise<void> {
  const conflicts = await findDocConflicts(source, destination, withheld);
  const staging = conflicts.length ? await fse.mkdtemp(path.join(destination, '.teamai-docs-')) : undefined;
  const moved: Array<{ target: string; backup: string }> = [];
  const visible = (src: string) => !path.basename(src).startsWith('.');
  const delivered = (src: string) => visible(src) && !withheld.has(path.relative(source, src).split(path.sep)[0] ?? '');
  try {
    // Prepare replacements while the old entries are still in place. A copy
    // failure must not remove the directory/file it was meant to replace.
    for (const [index, conflict] of conflicts.entries()) {
      await fse.copy(conflict.source, path.join(staging!, `new-${index}`), { filter: visible });
    }
    const replacedSources = new Set(conflicts.map(conflict => conflict.source));
    await fse.copy(source, destination, {
      overwrite: true,
      filter: src => delivered(src) && !replacedSources.has(src),
    });
    // Copying has finished before any rename: no copy worker can write into
    // a conflicting path while it is being replaced or restored.
    for (const [index, conflict] of conflicts.entries()) {
      const backup = path.join(staging!, `old-${index}`);
      await fse.rename(conflict.target, backup);
      moved.push({ target: conflict.target, backup });
      await fse.rename(path.join(staging!, `new-${index}`), conflict.target);
    }
  } catch (error) {
    for (const { target, backup } of moved.reverse()) {
      await fse.remove(target);
      await fse.rename(backup, target);
    }
    // If restoration itself fails, leave the backup directory for recovery.
    if (staging) await fse.remove(staging);
    throw error;
  }
  if (staging) await fse.remove(staging);
}

/** What pull delivers from the team repo's `docs/`, and what it withholds (#707). */
export interface DesiredDocs {
  /** The team repo's `docs/`. */
  readonly sourceDir: string;
  /** The files delivered, relative to `sourceDir` as `listDocFiles` lists them, minus an inactive namespace's. */
  readonly files: readonly string[];
  /** Each `docs/<dir>/` of a namespace declared but not active here, with its files. */
  readonly withheld: ReadonlyArray<{ readonly dir: string; readonly files: readonly string[] }>;
}

/**
 * The docs this member receives: every file under `docs/` except those under a
 * top-level directory named by `inactiveNamespaces`. A directory no role or
 * project declares is never withheld. Names compare case-folded, so a
 * `docs/Checkout/` is withheld with `checkout` on every filesystem rather than
 * only on the ones that would open it under that name.
 */
export async function resolveDesiredDocs(repoPath: string, inactiveNamespaces: readonly string[]): Promise<DesiredDocs> {
  const sourceDir = path.join(expandHome(repoPath), 'docs');
  const inactive = new Set(inactiveNamespaces.map(caseFoldKey));
  const withheldDirs = new Set((await listDirs(sourceDir)).filter((dir) => inactive.has(caseFoldKey(dir))));
  const files: string[] = [];
  const withheld = new Map<string, string[]>([...withheldDirs].map((dir) => [dir, []]));
  for (const file of await listDocFiles(sourceDir)) {
    const slash = file.indexOf('/');
    const dirFiles = slash === -1 ? undefined : withheld.get(file.slice(0, slash));
    if (dirFiles) dirFiles.push(file.slice(slash + 1));
    else files.push(file);
  }
  return { sourceDir, files, withheld: [...withheld].map(([dir, dirFiles]) => ({ dir, files: dirFiles })) };
}

/**
 * `resolveDesiredDocs` for a caller that holds no pull context (recall,
 * contribute, doctor): the same namespaces pull resolves. Legacy mode withholds
 * nothing. Throws when the scope's manifests cannot be read, as pull stops the
 * scope then.
 */
export async function resolveDocsForDirectory(localConfig: LocalConfig): Promise<DesiredDocs> {
  const resolved = await resolveResourceNamespaces(localConfig);
  return resolveDesiredDocs(localConfig.repo.localPath, resolved?.inactiveDocsNamespaces ?? []);
}

/** The file's bytes, or null when it is not a file this process can read. */
async function readBytes(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

/**
 * Remove the local copies of the docs `desired` withholds, the way a
 * deactivated namespace's skills and agents go: only a copy byte-equal to the
 * team file, now or in an earlier commit, is deleted. An older version is what
 * the mirror delivered before the team edited it, not a member edit. An edited
 * one is kept and named, so nothing a member wrote over a team doc is lost. A
 * local file the team repo does not have is the mirror's to prune, as anywhere
 * else in the destination.
 */
async function withdrawInactiveNamespaces(desired: DesiredDocs, localDocsDir: string, localConfig: LocalConfig): Promise<void> {
  for (const { dir, files } of desired.withheld) {
    const kept: string[] = [];
    for (const file of files) {
      const deployed = path.join(localDocsDir, dir, file);
      const current = await readBytes(deployed);
      if (current === null) continue;
      const source = await readBytes(path.join(desired.sourceDir, dir, file));
      const unchanged = source !== null && (current.equals(source)
        || await isPastVersionOf(localConfig.repo.localPath, deployed, `docs/${dir}/${file}`));
      if (!unchanged) {
        kept.push(`${dir}/${file}`);
        continue;
      }
      await fs.rm(deployed, { force: true });
      log.debug(`[${localConfig.scope}] Removed ${dir}/${file} of inactive docs namespace "${dir}"`);
    }
    await pruneEmptyDirs(path.join(localDocsDir, dir));
    if (kept.length > 0) {
      log.warn(
        `[${localConfig.scope}] Kept ${kept.length} doc(s) of docs namespace "${dir}", which is not active here: `
        + `they differ from the team copy (${kept.join(', ')} in ${localDocsDir}). Back them up, then delete them manually.`,
      );
    }
  }
}

export class DocsHandler extends ResourceHandler {
  readonly type = 'docs' as const;

  /**
   * The publish source for one-way docs push (007): the project's own `docs/`
   * directory, read-only. Never the docs pull destination — pulling a mirror
   * back in would round-trip the team's own copies.
   */
  publishSourceDir(localConfig: LocalConfig): string | null {
    if (localConfig.scope !== 'project' || !localConfig.projectRoot) return null;
    return path.join(localConfig.projectRoot, 'docs');
  }

  /** The team repo copy for one project: `docs/<projectId>/`, or `docs/<projectId>_<name>/` for a named source. */
  publishTargetDir(localConfig: LocalConfig, projectId: string, name?: string): string {
    return path.join(localConfig.repo.localPath, 'docs', name ? `${projectId}_${name}` : projectId);
  }

  async scanLocalForPush(
    _teamConfig: TeamaiConfig,
    localConfig: LocalConfig,
    options?: { projectId?: string; docsSources?: NamedPublishSource[] },
  ): Promise<ResourceItem[]> {
    // One-way publish (007): the default `docs/` source against the team
    // repo's `docs/<projectId>/` copy, plus each explicitly named source
    // (`--docs-source <dir>=<name>`) against its own `docs/<projectId>_<name>/`
    // namespace — a stable target that keeps same-named files apart. A file
    // that matches byte-for-byte is unchanged; push.ts decides
    // modified-vs-conflict against the recorded baseline. Only visible files
    // publish — dotfiles stay project-local.
    const projectId = options?.projectId;
    if (!projectId || !localConfig.projectRoot) return [];
    const sources: Array<{ dir: string; repoPrefix: string; named: boolean }> = [];
    const defaultSource = this.publishSourceDir(localConfig);
    if (defaultSource && await pathExists(defaultSource)) {
      sources.push({ dir: 'docs', repoPrefix: `docs/${projectId}`, named: false });
    }
    for (const { dir, name } of options?.docsSources ?? []) {
      sources.push({ dir, repoPrefix: `docs/${projectId}_${name}`, named: true });
    }
    if (sources.length > 1) {
      log.info(
        `[docs] default source: docs → docs/${projectId}/`
        + sources.slice(1).map(({ dir, repoPrefix }) => `; source ${dir} → ${repoPrefix}/`).join(''),
      );
    }

    const items: ResourceItem[] = [];
    for (const { dir, repoPrefix, named } of sources) {
      const source = path.join(localConfig.projectRoot!, dir);
      for (const rel of await listDocFiles(source)) {
        const localFile = path.join(source, rel);
        const targetFile = path.join(localConfig.repo.localPath, repoPrefix, rel);
        const exists = await pathExists(targetFile);
        const same = exists
          && (await readFileSafe(localFile)) === (await readFileSafe(targetFile));
        if (!same) {
          items.push({
            // Source-prefixed for named sources, so a named source's files stay
            // distinguishable from the default bundle's in every listing.
            name: named ? `${dir}/${rel}` : rel,
            type: 'docs',
            sourcePath: localFile,
            relativePath: `${repoPrefix}/${rel}`,
            status: exists ? 'modified' : 'new',
          });
        }
      }
    }
    return items;
  }

  async scanTeamForPull(_teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const docsDir = path.join(localConfig.repo.localPath, 'docs');
    // Nested documents are synced as part of the same bundle.
    if (await this.countDocFiles(docsDir) === 0) return [];

    return [{
      name: 'docs',
      type: 'docs',
      sourcePath: docsDir,
      relativePath: 'docs/',
    }];
  }

  async countDocFiles(sourcePath: string): Promise<number> {
    return (await listDocFiles(sourcePath)).length;
  }

  async pushItem(item: ResourceItem, _teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    // One-way publish (007): copy the project original into the team repo's
    // docs/<projectId>/ copy. The project original is never written to.
    const dest = path.join(localConfig.repo.localPath, item.relativePath);
    await fse.ensureDir(path.dirname(dest));
    await fse.copy(item.sourcePath, dest, { overwrite: true });
    log.debug(`Published doc ${item.relativePath} → team repo`);
  }

  /**
   * Mirror the docs this directory receives into the dedicated local
   * directory. `pull` resolves the set once and calls `pullDocs`.
   */
  async pullItem(_item: ResourceItem, teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    await this.pullDocs(await resolveDocsForDirectory(localConfig), teamConfig, localConfig);
  }

  /**
   * Mirror `desired` into the dedicated local directory: copy the delivered
   * files, remove every visible local entry the team repo does not have, then
   * withdraw the unchanged copies of a namespace not active here (#707).
   */
  async pullDocs(desired: DesiredDocs, teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const localDocsDir = resolveDocsDestination(teamConfig, localConfig);
    const src = desired.sourceDir;
    // Validate the source before touching the destination, including an empty bundle.
    const entries = await readEntries(src);
    await fse.ensureDir(localDocsDir);
    const destination = await fse.realpath(localDocsDir);
    const repo = await fse.realpath(localConfig.repo.localPath);
    const base = await fse.realpath(resolveBaseDir(localConfig));
    // In single-repo mode the configured docs directory may already be the
    // source. Withdrawing there would delete the team's own files.
    if (destination === path.join(repo, 'docs')) return;
    if (containsPath(destination, base) || containsPath(destination, repo) || containsPath(repo, destination)) {
      throw new Error('Docs pruning requires a dedicated localDir that does not overlap the team repo or contain the home or project root.');
    }
    if (entries.length > 0) {
      await copyDocs(src, localDocsDir, new Set(desired.withheld.map(({ dir }) => dir)));
    }
    // Copy first: a failed copy must not trigger deletion of the previous bundle.
    await pruneDocs(src, localDocsDir);
    await withdrawInactiveNamespaces(desired, localDocsDir, localConfig);
    log.debug(`Synced docs → ${localDocsDir}`);
  }

  async removeItem(_name: string, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<string[]> {
    log.warn('Removing docs is not supported via remove command. Delete from team repo directly.');
    return [];
  }
}
