import path from 'node:path';
import fse from 'fs-extra';
import { ResourceHandler } from './base.js';
import type { ResourceItem, TeamaiConfig, LocalConfig } from '../types.js';
import { expandHome, fileContentEqual, listFilesRecursive, pathExists } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import {
  activeProjectIds,
  inactiveProjectIds,
  loadDefinedProjectIds,
  namespaceDirSafeToRemove,
} from './namespace-utils.js';

/**
 * Resolve the project-bound docs directory for the active scope.
 *
 * Docs are bound to the project: in project scope a `~/`-prefixed localDir is
 * re-rooted into projectRoot (so the default `~/docs` lands at
 * `<projectRoot>/docs`); user scope resolves against HOME.
 */
export function resolveDocsLocalDir(teamConfig: TeamaiConfig, localConfig: LocalConfig): string {
  const docsLocalDir = teamConfig.sharing.docs.localDir;
  if (localConfig.scope === 'project' && localConfig.projectRoot) {
    return docsLocalDir.startsWith('~/')
      ? path.join(localConfig.projectRoot, docsLocalDir.substring(2))
      : expandHome(docsLocalDir);
  }
  return expandHome(docsLocalDir);
}

export class DocsHandler extends ResourceHandler {
  readonly type = 'docs' as const;

  /**
   * Docs are normally authored directly in the team repo, but this fork makes
   * the project docs directory the primary surface: scan it for files that are
   * new or differ from the team repo and offer them via `teamai push`.
   *
   * Namespace scope (003): only the shared root plus ACTIVE project namespaces
   * are scanned. Inactive project namespace dirs are not offered as push items
   * (they are cleaned by pull, not republished).
   */
  async scanLocalForPush(teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const localDocsDir = resolveDocsLocalDir(teamConfig, localConfig);
    const repoDocsDir = path.join(localConfig.repo.localPath, 'docs');
    if (!(await pathExists(localDocsDir)) || !(await pathExists(repoDocsDir))) return [];
    const defined = await loadDefinedProjectIds(localConfig.repo.localPath);
    const active = new Set(activeProjectIds(localConfig));
    const items: ResourceItem[] = [];
    for (const rel of await listFilesRecursive(localDocsDir)) {
      if (rel.split('/').some((segment) => segment.startsWith('.'))) continue;
      // Skip inactive project namespace dirs (defined project, not active here).
      const top = rel.split('/')[0];
      if (defined.has(top) && !active.has(top)) continue;
      const localFile = path.join(localDocsDir, rel);
      const repoFile = path.join(repoDocsDir, rel);
      const exists = await pathExists(repoFile);
      // Binary-safe comparison (utf-8 decode can collapse distinct binaries).
      const same = exists && (await fileContentEqual(localFile, repoFile));
      if (!same) {
        items.push({
          name: rel,
          type: 'docs',
          sourcePath: localFile,
          // Repo-root-relative so push stages `docs/<rel>` in the clone.
          relativePath: `docs/${rel}`,
          status: exists ? 'modified' : 'new',
        });
      }
    }
    return items;
  }

  /**
   * Pull scan (003): return one bundle for the shared root and one bundle per
   * active project namespace. Each bundle's `namespace` is set only for project
   * bundles (undefined = shared root), so pullItem knows which portion to copy.
   */
  async scanTeamForPull(_teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const docsDir = path.join(localConfig.repo.localPath, 'docs');
    if (!(await pathExists(docsDir))) return [];
    const defined = await loadDefinedProjectIds(localConfig.repo.localPath);
    const sharedCount = await this.countDocFilesExcluding(docsDir, defined);
    const items: ResourceItem[] = [];
    if (sharedCount > 0) {
      items.push({
        name: 'docs',
        type: 'docs',
        sourcePath: docsDir,
        relativePath: 'docs/',
      });
    }
    // Active project namespaces are pulled as their own bundles. Their files are
    // not counted in the shared root (the shared bundle's filter excludes them).
    for (const pid of activeProjectIds(localConfig)) {
      const src = path.join(docsDir, pid);
      if (!(await pathExists(src))) continue;
      if ((await this.countDocFiles(src)) === 0) continue;
      items.push({
        name: `docs/${pid}`,
        type: 'docs',
        sourcePath: src,
        relativePath: `docs/${pid}/`,
        namespace: pid,
      });
    }
    return items;
  }

  /** Count doc files under sourcePath excluding first-level project namespaces. */
  async countDocFilesExcluding(sourcePath: string, definedProjectIds: Set<string>): Promise<number> {
    if (!(await pathExists(sourcePath))) return 0;
    const files = await listFilesRecursive(sourcePath);
    return files.filter((f) => {
      const top = f.split('/')[0];
      return definedProjectIds.has(top) ? false
        : f.split('/').every((segment) => !segment.startsWith('.'));
    }).length;
  }

  async countDocFiles(sourcePath: string): Promise<number> {
    if (!(await pathExists(sourcePath))) return 0;
    const files = await listFilesRecursive(sourcePath);
    return files.filter(f => f.split('/').every(segment => !segment.startsWith('.'))).length;
  }

  /** Copy one scanned local file into the team repo (called by `teamai push`). */
  async pushItem(item: ResourceItem, _teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const repoDocsDir = path.join(localConfig.repo.localPath, 'docs');
    const dest = path.join(repoDocsDir, item.name);
    await fse.ensureDir(path.dirname(dest));
    await fse.copy(item.sourcePath, dest, { overwrite: true });
    log.debug(`Pushed doc ${item.name} → team repo`);
  }

  /**
   * Sync one docs bundle into the local docs directory.
   *
   * Shared-root bundle (no namespace): copy the whole repo docs dir while
   * EXCLUDING first-level project namespace dirs (they come via their own
   * bundles; inactive ones must not be installed).
   * Project bundle (namespace set): copy only `docs/<pid>`.
   */
  async pullItem(item: ResourceItem, teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const localDocsDir = resolveDocsLocalDir(teamConfig, localConfig);
    try {
      if (item.namespace) {
        await fse.ensureDir(path.join(localDocsDir, item.namespace));
        await fse.copy(item.sourcePath, path.join(localDocsDir, item.namespace), {
          overwrite: true,
          filter: (srcPath: string) => !path.basename(srcPath).startsWith('.'),
        });
        log.debug(`Synced docs/${item.namespace} → ${localDocsDir}`);
        return;
      }
      const defined = await loadDefinedProjectIds(localConfig.repo.localPath);
      const src = expandHome(item.sourcePath);
      await fse.copy(src, localDocsDir, {
        overwrite: true,
        filter: (srcPath: string) => {
          const base = path.basename(srcPath);
          if (base.startsWith('.')) return false;
          // Skip first-level project namespace dirs inside the shared root.
          const relToRoot = path.relative(src, srcPath);
          if (relToRoot && !relToRoot.includes(path.sep) && defined.has(relToRoot)) return false;
          return true;
        },
      });
      log.debug(`Synced docs → ${localDocsDir}`);
    } catch (e) {
      log.warn(`Failed to sync docs: ${(e as Error).message}`);
    }
  }

  /**
   * Cleanup (003): remove local `<projectRoot>/docs/<pid>` dirs for defined
   * projects that are no longer active — but only when the local copy matches
   * the team repo (no local-only or modified files), mirroring the skill
   * data-safety rule. Returns candidate dir names. With dryRun set, nothing is
   * removed — candidates are reported instead.
   */
  async cleanupInactiveNamespaces(
    teamConfig: TeamaiConfig,
    localConfig: LocalConfig,
    dryRun = false,
  ): Promise<string[]> {
    const localDocsDir = resolveDocsLocalDir(teamConfig, localConfig);
    const repoDocsDir = path.join(localConfig.repo.localPath, 'docs');
    if (!(await pathExists(localDocsDir))) return [];
    const defined = await loadDefinedProjectIds(localConfig.repo.localPath);
    const removed: string[] = [];
    for (const pid of inactiveProjectIds(localConfig, defined)) {
      const localDir = path.join(localDocsDir, pid);
      const repoDir = path.join(repoDocsDir, pid);
      if (!(await pathExists(localDir))) continue;
      if (!(await namespaceDirSafeToRemove(localDir, repoDir))) {
        log.warn(`[${localConfig.scope}] [docs] Kept docs/${pid}: it has local changes or files not in the team repo. Push or back them up, then delete it manually.`);
        continue;
      }
      removed.push(pid);
      if (!dryRun) {
        await fse.remove(localDir);
        log.debug(`[docs] Removed inactive project namespace docs/${pid}`);
      }
    }
    return removed;
  }

  /**
   * Count the files a pull bundle will install. The shared-root bundle excludes
   * first-level project namespace dirs (they arrive via their own bundles).
   */
  async countBundleFiles(item: ResourceItem, localConfig: LocalConfig): Promise<number> {
    if (item.namespace) return this.countDocFiles(item.sourcePath);
    const defined = await loadDefinedProjectIds(localConfig.repo.localPath);
    return this.countDocFilesExcluding(item.sourcePath, defined);
  }

  async removeItem(_name: string, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<string[]> {
    log.warn('Removing docs is not supported via remove command. Delete from team repo directly.');
    return [];
  }
}
