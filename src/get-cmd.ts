import path from 'node:path';
import fse from 'fs-extra';
import { detectProjectConfig, loadLocalConfigForScope, loadTeamConfig } from './config.js';
import { resolveToolBaseDir, scopedToolPaths } from './types.js';
import type { GlobalOptions, LocalConfig, ResourceItem, TeamaiConfig } from './types.js';
import { ResourceHandler, isToolInstalledForConfig } from './resources/base.js';
import { ruleFileExtensionForTool, usesCopilotInstructions, usesCursorMdcRules } from './resources/rule-format.js';
import { teamRuleToCursorMdc } from './resources/cursor-mdc.js';
import { teamRuleToCopilotInstructions } from './resources/copilot-instructions.js';
import { resolveDocsLocalDir } from './resources/docs.js';
import { loadDefinedProjectIds, activeProjectIds, namespaceDirSafeToRemove } from './resources/namespace-utils.js';
import { listDirs, listFilesRecursive, pathExists, readFileSafe } from './utils/fs.js';
import { pullRepo } from './utils/git.js';
import { log } from './utils/logger.js';
import { getUserHome } from './utils/home.js';

const TYPES = ['skills', 'rules', 'docs', 'wiki'] as const;
type GetType = (typeof TYPES)[number];

export interface GetOptions extends GlobalOptions {
  type?: string;
  name?: string;
  tool?: string;
  all?: boolean;
  diff?: boolean;
  prune?: boolean;
  refresh?: boolean;
}

interface Ctx {
  repo: string;
  localConfig: LocalConfig;
  teamConfig: TeamaiConfig;
  scope: 'project' | 'user';
  projectRoot: string;
}

// ─── Pure helpers (unit-tested) ─────────────────────────

/** Reject path traversal (`..`/`.` segments) and absolute paths in resource names. */
export function isValidName(name: string): boolean {
  if (name.includes('..') || name.startsWith('/')) return false;
  return !name.split('/').some((s) => s === '.' || s.length === 0);
}

/** Resolve `skills/<name>` or `skills/<ns>/<name>`; null when absent; throws on ambiguity. */
export async function resolveSkillSource(repoSkills: string, name: string): Promise<string | null> {
  const flat = path.join(repoSkills, name, 'SKILL.md');
  if (await pathExists(flat)) return path.join(repoSkills, name);
  const cands: string[] = [];
  for (const d of await listDirs(repoSkills)) {
    const cand = path.join(repoSkills, d, name, 'SKILL.md');
    if (await pathExists(cand)) cands.push(path.join(repoSkills, d, name));
  }
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    throw new Error(
      `'${name}' exists in multiple namespaces:\n  ${cands
        .map((c) => `${path.basename(path.dirname(c))}/${path.basename(c)}`)
        .join('\n  ')}`,
    );
  }
  return null;
}

/** Resolve a rule by exact relative path, `name`/`name.md`, or unique basename (any depth). */
export async function resolveRuleSource(repoRules: string, name: string): Promise<string | null> {
  const base = name.replace(/\.md$/, '');
  const exact = path.join(repoRules, name);
  if (await pathExists(exact)) return exact;
  const exactMd = path.join(repoRules, `${base}.md`);
  if (await pathExists(exactMd)) return exactMd;
  const cands: string[] = [];
  for (const rel of await listFilesRecursive(repoRules)) {
    if (!rel.endsWith('.md')) continue;
    const fileBase = path.basename(rel).replace(/\.md$/, '');
    if (fileBase === base || rel === name) cands.push(path.join(repoRules, rel));
  }
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    throw new Error(`'${name}' matched multiple rule files:\n  ${cands.join('\n  ')}`);
  }
  return null;
}

/** Resolve a doc by relative path; `.md` suffix optional (target keeps the real name). */
export async function resolveDocsSource(repoDocs: string, name: string): Promise<string | null> {
  const exact = path.join(repoDocs, name);
  if (await pathExists(exact)) return exact;
  const withMd = path.join(repoDocs, `${name}.md`);
  if (await pathExists(withMd)) return withMd;
  return null;
}

/**
 * Namespace-aware doc/wiki page resolution (003).
 *
 * Resolution order: shared root first, then each active project namespace dir.
 * An explicit path that already carries a namespace prefix (e.g. `a/x.md`) is
 * resolved directly against the root — explicit requests are not blocked by the
 * active set (same rule as skills, review Y5). Multiple hits → throw with the
 * candidate list (caller prints usage-style error).
 */
export async function resolveNamespacedSource(
  repoRoot: string,
  name: string,
  projectDirs: string[],
): Promise<string | null> {
  const cands: string[] = [];
  const probe = async (base: string) => {
    const exact = path.join(base, name);
    if (await pathExists(exact)) cands.push(exact);
    const withMd = path.join(base, `${name}.md`);
    if (await pathExists(withMd)) cands.push(withMd);
  };
  await probe(repoRoot);
  for (const dir of projectDirs) {
    await probe(path.join(repoRoot, dir));
  }
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    throw new Error(
      `'${name}' exists in multiple namespaces:\n  ${cands
        .map((c) => path.relative(repoRoot, c))
        .join('\n  ')}`,
    );
  }
  return null;
}

/** Discover pullable entries per type (what `get list` prints). */
export async function listTypeEntries(repo: string, type: GetType): Promise<string[]> {
  const dirFor: Record<GetType, string> = { skills: 'skills', rules: 'rules', docs: 'docs', wiki: '.wiki' };
  const root = path.join(repo, dirFor[type]);
  if (!(await pathExists(root))) return [];
  if (type === 'skills') {
    const out: string[] = [];
    for (const d of await listDirs(root)) {
      if (await pathExists(path.join(root, d, 'SKILL.md'))) {
        out.push(d);
        continue;
      }
      for (const sub of await listDirs(path.join(root, d))) {
        if (await pathExists(path.join(root, d, sub, 'SKILL.md'))) out.push(`${d}/${sub}`);
      }
    }
    return out.sort();
  }
  const files = await listFilesRecursive(root);
  return files.filter((f) => (type === 'docs' ? !hasDotSegment(f) : f.endsWith('.md') && !hasDotSegment(f))).sort();
}

/**
 * Compare the team repo wiki against the local wiki (read-only).
 *
 * Optional scope (003): when `definedProjectIds` is given, wiki collections
 * under inactive project namespaces are excluded from the diff — the mirror
 * scope is shared root + active project namespaces only.
 */
export async function computeWikiDiff(
  srcWiki: string,
  dstWiki: string,
  definedProjectIds?: Set<string>,
  active?: string[],
): Promise<{ onlyInSrc: string[]; onlyInDst: string[]; changed: string[] }> {
  const inScope = (rel: string): boolean => {
    if (!definedProjectIds || definedProjectIds.size === 0) return true;
    const top = rel.split('/')[0];
    return active && definedProjectIds.has(top) ? active.includes(top) : true;
  };
  const srcFiles = (await pathExists(srcWiki))
    ? (await listFilesRecursive(srcWiki)).filter((f) => f.endsWith('.md') && !hasDotSegment(f) && inScope(f)).sort()
    : [];
  const dstFiles = (await pathExists(dstWiki))
    ? (await listFilesRecursive(dstWiki)).filter((f) => f.endsWith('.md') && !hasDotSegment(f) && inScope(f)).sort()
    : [];
  const dstSet = new Set(dstFiles);
  const srcSet = new Set(srcFiles);
  const onlyInSrc = srcFiles.filter((f) => !dstSet.has(f));
  const onlyInDst = dstFiles.filter((f) => !srcSet.has(f));
  const changed: string[] = [];
  for (const f of srcFiles) {
    if (!dstSet.has(f)) continue;
    const a = await readFileSafe(path.join(srcWiki, f));
    const b = await readFileSafe(path.join(dstWiki, f));
    if (a !== b) changed.push(f);
  }
  return { onlyInSrc, onlyInDst, changed };
}

// ─── Command entry ──────────────────────────────────────

function fail(msg: string): void {
  log.error(msg);
  process.exitCode = 1;
}

function usage(hint?: string): void {
  if (hint) log.error(hint);
  log.error(
    [
      'Usage:',
      '  teamai get list [skills|rules|docs|wiki]',
      '  teamai get skills <name> [tool] [--force]',
      '  teamai get rules  <name> [tool] [--force]',
      '  teamai get docs   <name> [--force]        # single file (.md suffix optional)',
      '  teamai get docs   --all [--prune]         # mirror the team docs directory',
      '  teamai get wiki   [page] [--force]        # omit page = whole-repo mirror',
      '  teamai get wiki   --diff                  # preview team vs local differences',
      'Note: docs/wiki have no delete direction in v1 — remove pages in the team repo directly.',
      'Options: --refresh fast-forwards the local clone first (default: offline)',
    ].join('\n'),
  );
  process.exitCode = 1;
}

function hasDotSegment(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => segment.startsWith('.'));
}

async function printType(ctx: Ctx, type: GetType): Promise<void> {
  const entries = await listTypeEntries(ctx.repo, type);
  if (entries.length === 0) {
    log.info(`  (no ${type} in team repo)`);
    return;
  }
  for (const e of entries) log.info(`  ${e}`);
}

async function detectContext(): Promise<Ctx | null> {
  let projectConfig: LocalConfig | null = null;
  try {
    projectConfig = await detectProjectConfig();
  } catch {
    projectConfig = null;
  }
  if (projectConfig) {
    const teamConfig = await loadTeamConfig(projectConfig.repo.localPath);
    if (!teamConfig) {
      fail('Team config (teamai.yaml) not found. Check your repo path.');
      return null;
    }
    return {
      repo: projectConfig.repo.localPath,
      localConfig: projectConfig,
      teamConfig,
      scope: 'project',
      projectRoot: projectConfig.projectRoot ?? process.cwd(),
    };
  }
  const userConfig = await loadLocalConfigForScope('user');
  if (!userConfig) {
    fail('teamai is not initialized. Run `teamai init` first.');
    return null;
  }
  const teamConfig = await loadTeamConfig(userConfig.repo.localPath);
  if (!teamConfig) {
    fail('Team config (teamai.yaml) not found. Check your repo path.');
    return null;
  }
  return {
    repo: userConfig.repo.localPath,
    localConfig: userConfig,
    teamConfig,
    scope: 'user',
    projectRoot: process.cwd(),
  };
}

export async function get(options: GetOptions): Promise<void> {
  const rawType = options.type;
  if (!rawType || rawType === 'list') {
    const ctx = await detectContext();
    if (!ctx) return;
    const filter = rawType === 'list' ? (options.name as GetType | undefined) : undefined;
    if (filter && !(TYPES as readonly string[]).includes(filter)) {
      usage();
      return;
    }
    const types: GetType[] = filter ? [filter] : [...TYPES];
    for (const t of types) {
      log.info(`[${t}]`);
      await printType(ctx, t);
    }
    return;
  }
  if (!(TYPES as readonly string[]).includes(rawType)) {
    usage();
    return;
  }
  const type = rawType as GetType;
  const name = options.name;
  const tool = options.tool?.toLowerCase();
  const all = options.all === true;
  const diff = options.diff === true;
  const prune = options.prune === true;
  const force = options.force === true;

  // Option/type combination validation (fail fast before touching anything).
  if (diff && type !== 'wiki') return usage('`--diff` applies to wiki only');
  if (all && type !== 'docs') return usage('`--all` applies to docs only');
  if (prune && type !== 'wiki' && type !== 'docs') return usage('`--prune` applies to mirror modes only');
  if (type === 'wiki' && diff && prune) return usage('`--diff` is read-only; `--prune` not applicable');
  if (all && name) return usage('`--all` mirrors the whole directory; drop the name');
  if (diff && name) return usage('`--diff` previews the whole wiki; drop the name');
  if ((type === 'docs' || type === 'wiki') && tool) return usage('`tool` applies to skills/rules only');
  if (name && !isValidName(name)) return fail(`Invalid path: ${name}`);

  const ctx = await detectContext();
  if (!ctx) return;

  if (options.refresh) {
    try {
      await pullRepo(ctx.repo);
    } catch (e) {
      log.warn(`Refresh failed, using existing clone: ${(e as Error).message}`);
    }
  }

  switch (type) {
    case 'skills': {
      if (!name) {
        await printType(ctx, 'skills');
        return;
      }
      let src: string | null;
      try {
        src = await resolveSkillSource(path.join(ctx.repo, 'skills'), name);
      } catch (e) {
        fail((e as Error).message);
        return;
      }
      if (!src) {
        fail(`Skill not found in team repo: ${name}. Available:`);
        await printType(ctx, 'skills');
        return;
      }
      const item: ResourceItem = { name, type: 'skills', sourcePath: src, relativePath: `skills/${name}` };
      const allPaths = scopedToolPaths(ctx.teamConfig, { scope: ctx.scope });
      const targetTools: string[] = [];
      if (tool) {
        targetTools.push(tool);
      } else {
        for (const t of Object.keys(allPaths)) {
          const tp = allPaths[t];
          if (tp.skills && (await isToolInstalledForConfig(t, tp.skills, ctx.localConfig))) targetTools.push(t);
        }
        if (targetTools.length === 0) return fail('No installed tools with a skills path');
      }
      // Overwrite guard (spec rule 2): refuse unless --force when any target already exists.
      if (!force) {
        const conflicts: string[] = [];
        for (const t of targetTools) {
          const existing = path.join(resolveToolBaseDir(t, ctx.localConfig), allPaths[t].skills!, name);
          if (await pathExists(existing)) conflicts.push(existing);
        }
        if (conflicts.length > 0) {
          return fail(
            `Already exists: ${conflicts[0]}${conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : ''} (use --force to overwrite)`,
          );
        }
      }
      for (const t of targetTools) {
        const dest = path.join(resolveToolBaseDir(t, ctx.localConfig), allPaths[t].skills!, name);
        await fse.remove(dest);
        await fse.ensureDir(path.dirname(dest));
        await fse.copy(src, dest);
        log.info(`✓ ${name} → ${dest}`);
      }
      log.info('Note: a pulled copy may be overwritten by the next `teamai pull`.');
      return;
    }

    case 'rules': {
      if (!name) {
        await printType(ctx, 'rules');
        return;
      }
      let src: string | null;
      try {
        src = await resolveRuleSource(path.join(ctx.repo, 'rules'), name);
      } catch (e) {
        fail((e as Error).message);
        return;
      }
      if (!src) {
        fail(`Rule not found in team repo: ${name}. Available:`);
        await printType(ctx, 'rules');
        return;
      }
      const rel = path.relative(path.join(ctx.repo, 'rules'), src);
      const stem = rel.replace(/\.md$/, '');
      const item: ResourceItem = { name: stem, type: 'rules', sourcePath: src, relativePath: `rules/${rel}` };
      const allPaths = scopedToolPaths(ctx.teamConfig, { scope: ctx.scope });
      const targetTools: string[] = [];
      if (tool) {
        targetTools.push(tool);
      } else {
        for (const t of Object.keys(allPaths)) {
          const tp = allPaths[t];
          if (tp.rules && (await isToolInstalledForConfig(t, tp.rules, ctx.localConfig))) targetTools.push(t);
        }
        if (targetTools.length === 0) return fail('No installed tools with a rules path');
      }
      // Overwrite guard (spec rule 2): per-tool rendered destination must not exist unless --force.
      if (!force) {
        const conflicts: string[] = [];
        for (const t of targetTools) {
          const existing = path.join(
            resolveToolBaseDir(t, ctx.localConfig),
            allPaths[t].rules!,
            `${stem}${ruleFileExtensionForTool(t)}`,
          );
          if (await pathExists(existing)) conflicts.push(existing);
        }
        if (conflicts.length > 0) {
          return fail(
            `Already exists: ${conflicts[0]}${conflicts.length > 1 ? ` (+${conflicts.length - 1} more)` : ''} (use --force to overwrite)`,
          );
        }
      }
      const raw = await readFileSafe(src);
      if (raw === null) return fail(`Cannot read rule source: ${src}`);
      for (const t of targetTools) {
        const destDir = path.join(resolveToolBaseDir(t, ctx.localConfig), allPaths[t].rules!);
        await fse.ensureDir(destDir);
        const dest = path.join(destDir, `${stem}${ruleFileExtensionForTool(t)}`);
        if (usesCursorMdcRules(t)) {
          await fse.writeFile(dest, teamRuleToCursorMdc(raw), 'utf-8');
          // Mirror official RulesHandler: drop legacy `.md` copies that these tools ignore.
          await fse.remove(path.join(destDir, `${stem}.md`));
          log.info(`✓ ${stem} → ${dest} (rendered .mdc)`);
        } else if (usesCopilotInstructions(t)) {
          await fse.writeFile(dest, teamRuleToCopilotInstructions(raw), 'utf-8');
          await fse.remove(path.join(destDir, `${stem}.md`));
          log.info(`✓ ${stem} → ${dest} (rendered instructions)`);
        } else {
          await fse.copy(src, dest);
          log.info(`✓ ${stem} → ${dest}`);
        }
      }
      log.info('Note: a pulled copy may be overwritten by the next `teamai pull`.');
      return;
    }

    case 'docs': {
      const localDocsDir = resolveDocsLocalDir(ctx.teamConfig, ctx.localConfig);
      const repoDocs = path.join(ctx.repo, 'docs');
      const defined = await loadDefinedProjectIds(ctx.repo);
      const active = activeProjectIds(ctx.localConfig);
      if (all) {
        if (!(await pathExists(repoDocs))) return fail('No docs in team repo');
        await fse.ensureDir(localDocsDir);
        // Shared root: copy everything except first-level project namespace dirs.
        await fse.copy(repoDocs, localDocsDir, {
          overwrite: true,
          filter: (srcPath: string) => {
            const base = path.basename(srcPath);
            if (base.startsWith('.')) return false;
            const relToRoot = path.relative(repoDocs, srcPath);
            return !(relToRoot && !relToRoot.includes(path.sep) && defined.has(relToRoot));
          },
        });
        // Active project namespaces.
        for (const pid of active) {
          const src = path.join(repoDocs, pid);
          if (!(await pathExists(src))) continue;
          await fse.ensureDir(path.join(localDocsDir, pid));
          await fse.copy(src, path.join(localDocsDir, pid), {
            overwrite: true,
            filter: (p: string) => !path.basename(p).startsWith('.'),
          });
        }
        if (prune) {
          // Inactive project namespaces are removed whole — with the same
          // data-safety guard as pull (local edits are kept, never silent).
          for (const top of await listDirs(localDocsDir)) {
            if (defined.has(top) && !active.includes(top)) {
              const dir = path.join(localDocsDir, top);
              if (!(await namespaceDirSafeToRemove(dir, path.join(repoDocs, top)))) {
                log.warn(`[${ctx.scope}] Kept docs/${top}: it has local changes or files not in the team repo. Push or back them up, then delete it manually.`);
                continue;
              }
              await fse.remove(dir);
              log.info(`  − removed inactive docs namespace: ${top}`);
            }
          }
          for (const rel of await listFilesRecursive(localDocsDir)) {
            if (hasDotSegment(rel)) continue;
            if (!(await pathExists(path.join(repoDocs, rel)))) {
              await fse.remove(path.join(localDocsDir, rel));
              log.info(`  − removed extra: ${rel}`);
            }
          }
        }
        log.info(`✓ docs mirrored → ${localDocsDir}`);
        return;
      }
      if (!name) {
        await printType(ctx, 'docs');
        return;
      }
      let src: string | null;
      try {
        src = await resolveNamespacedSource(repoDocs, name, active);
      } catch (e) {
        fail((e as Error).message);
        return;
      }
      if (!src) {
        fail(`Doc not found in team repo: ${name}. Available:`);
        await printType(ctx, 'docs');
        return;
      }
      const rel = path.relative(repoDocs, src);
      const dest = path.join(localDocsDir, rel);
      if (await pathExists(dest)) {
        if (!force) return fail(`Already exists: ${dest} (use --force to overwrite)`);
      }
      await fse.ensureDir(path.dirname(dest));
      await fse.copy(src, dest);
      log.info(`✓ ${rel} → ${dest}`);
      return;
    }

    case 'wiki': {
      const repoWiki = path.join(ctx.repo, '.wiki');
      const localWiki =
        ctx.scope === 'project' && ctx.localConfig.projectRoot
          ? path.join(ctx.localConfig.projectRoot, '.wiki')
          : path.join(getUserHome(), '.wiki');
      const defined = await loadDefinedProjectIds(ctx.repo);
      const active = activeProjectIds(ctx.localConfig);
      if (diff) {
        const d = await computeWikiDiff(repoWiki, localWiki, defined, active);
        let any = false;
        for (const f of d.onlyInSrc) { log.info(`  + ${f} (team repo only)`); any = true; }
        for (const f of d.onlyInDst) { log.info(`  − ${f} (local only)`); any = true; }
        for (const f of d.changed) { log.info(`  ~ ${f} (differ)`); any = true; }
        if (!any) log.info('wiki is in sync');
        return;
      }
      if (name) {
        let src: string | null;
        try {
          src = await resolveNamespacedSource(repoWiki, name, active);
        } catch (e) {
          fail((e as Error).message);
          return;
        }
        if (!src) {
          fail(`Wiki page not found in team repo: ${name}. Available:`);
          await printType(ctx, 'wiki');
          return;
        }
        const rel = path.relative(repoWiki, src);
        const dest = path.join(localWiki, rel);
        if (await pathExists(dest)) {
          if (!force) return fail(`Already exists: ${dest} (use --force to overwrite)`);
        }
        await fse.ensureDir(path.dirname(dest));
        await fse.copy(src, dest);
        log.info(`✓ ${rel} → ${dest}`);
        return;
      }
      if (!(await pathExists(repoWiki))) return fail('No .wiki in team repo');
      await fse.ensureDir(localWiki);
      const copyRoot = repoWiki;
      // Shared root: exclude first-level project namespace dirs.
      await fse.copy(repoWiki, localWiki, {
        overwrite: true,
        filter: (srcPath: string) => {
          if (srcPath === copyRoot) return true;
          const base = path.basename(srcPath);
          if (base.startsWith('.')) return false;
          const relToRoot = path.relative(repoWiki, srcPath);
          return !(relToRoot && !relToRoot.includes(path.sep) && defined.has(relToRoot));
        },
      });
      // Active project wikis (a project may own multiple wiki collections).
      for (const pid of active) {
        const src = path.join(repoWiki, pid);
        if (!(await pathExists(src))) continue;
        await fse.ensureDir(path.join(localWiki, pid));
        await fse.copy(src, path.join(localWiki, pid), {
          overwrite: true,
          filter: (p: string) => p === src || !path.basename(p).startsWith('.'),
        });
      }
      if (prune) {
        for (const top of await listDirs(localWiki)) {
          if (defined.has(top) && !active.includes(top)) {
            const dir = path.join(localWiki, top);
            if (!(await namespaceDirSafeToRemove(dir, path.join(repoWiki, top)))) {
              log.warn(`[${ctx.scope}] Kept .wiki/${top}: it has local changes or files not in the team repo. Push or back them up, then delete it manually.`);
              continue;
            }
            await fse.remove(dir);
            log.info(`  − removed inactive wiki namespace: ${top}`);
          }
        }
        for (const rel of await listFilesRecursive(localWiki)) {
          if (hasDotSegment(rel) || !rel.endsWith('.md')) continue;
          if (!(await pathExists(path.join(repoWiki, rel)))) {
            await fse.remove(path.join(localWiki, rel));
            log.info(`  − removed extra: ${rel}`);
          }
        }
      }
      log.info(`✓ wiki mirrored → ${localWiki}`);
      return;
    }
  }
}
