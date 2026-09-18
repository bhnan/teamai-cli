import path from 'node:path';
import fse from 'fs-extra';
import { ResourceHandler } from './base.js';
import type { ResourceItem, TeamaiConfig, LocalConfig } from '../types.js';
import { getUserHome } from '../utils/home.js';
import { listFilesRecursive, pathExists, readFileSafe } from '../utils/fs.js';
import { log } from '../utils/logger.js';
import {
  activeProjectIds,
  inactiveProjectIds,
  loadDefinedProjectIds,
  namespaceDirSafeToRemove,
} from './namespace-utils.js';

function hasDotSegment(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => segment.startsWith('.'));
}

/**
 * Project-bound `.wiki/` knowledge base.
 *
 * Team convention — distinct from the `teamwiki/` codebase knowledge graph:
 * pages live in `<projectRoot>/.wiki/` and mirror to the team repo's `.wiki/`
 * directory. `teamai push` offers changed pages as MR items; `teamai pull`
 * mirrors the team repo back (overwriting same-named pages while preserving
 * local-only pages).
 *
 * Namespace model (003): `.wiki/<wiki-id>/` is a team-shared wiki collection;
 * `.wiki/<project-id>/<wiki-id>/` is a project-private wiki — a project owns
 * multiple wikis under its namespace dir. First-level dirs matching defined
 * project ids are project namespaces; everything else is shared.
 */
export class WikiHandler extends ResourceHandler {
  readonly type = 'wiki' as const;

  /** Local wiki root, bound to the project in project scope. */
  localWikiDir(localConfig: LocalConfig): string {
    if (localConfig.scope === 'project' && localConfig.projectRoot) {
      return path.join(localConfig.projectRoot, '.wiki');
    }
    return path.join(getUserHome(), '.wiki');
  }

  repoWikiDir(localConfig: LocalConfig): string {
    return path.join(localConfig.repo.localPath, '.wiki');
  }

  async scanLocalForPush(_teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const local = this.localWikiDir(localConfig);
    const repo = this.repoWikiDir(localConfig);
    // Repo `.wiki/` may not exist yet — every local page is then "new" (bootstrap push).
    if (!(await pathExists(local))) return [];
    const defined = await loadDefinedProjectIds(localConfig.repo.localPath);
    const active = new Set(activeProjectIds(localConfig));
    const items: ResourceItem[] = [];
    for (const rel of await listFilesRecursive(local)) {
      if (hasDotSegment(rel) || !rel.endsWith('.md')) continue;
      // Skip inactive project namespace wikis (defined project, not active here).
      const top = rel.split('/')[0];
      if (defined.has(top) && !active.has(top)) continue;
      const localFile = path.join(local, rel);
      const repoFile = path.join(repo, rel);
      const exists = await pathExists(repoFile);
      const same = exists && (await readFileSafe(localFile)) === (await readFileSafe(repoFile));
      if (!same) {
        items.push({
          name: rel,
          type: 'wiki',
          sourcePath: localFile,
          // Repo-root-relative so push stages `.wiki/<rel>` in the clone.
          relativePath: `.wiki/${rel}`,
          status: exists ? 'modified' : 'new',
        });
      }
    }
    return items;
  }

  /**
   * Pull scan (003): shared root bundle (shared wiki collections) + one bundle
   * per active project namespace (its private wikis, any number of them).
   */
  async scanTeamForPull(_teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const repo = this.repoWikiDir(localConfig);
    if (!(await pathExists(repo))) return [];
    const defined = await loadDefinedProjectIds(localConfig.repo.localPath);
    const sharedPages = (await listFilesRecursive(repo)).filter((f) => {
      if (!f.endsWith('.md') || hasDotSegment(f)) return false;
      return !defined.has(f.split('/')[0]);
    });
    const items: ResourceItem[] = [];
    if (sharedPages.length > 0) {
      items.push({ name: 'wiki', type: 'wiki', sourcePath: repo, relativePath: '.wiki/' });
    }
    for (const pid of activeProjectIds(localConfig)) {
      const src = path.join(repo, pid);
      if (!(await pathExists(src))) continue;
      const pages = (await listFilesRecursive(src)).filter((f) => f.endsWith('.md') && !hasDotSegment(f));
      if (pages.length === 0) continue;
      items.push({
        name: `wiki/${pid}`,
        type: 'wiki',
        sourcePath: src,
        relativePath: `.wiki/${pid}/`,
        namespace: pid,
      });
    }
    return items;
  }

  /**
   * Count the pages a pull bundle will install. The shared-root bundle excludes
   * first-level project namespace dirs (they arrive via their own bundles).
   */
  async countBundleFiles(item: ResourceItem, localConfig: LocalConfig): Promise<number> {
    if (item.namespace) {
      return (await listFilesRecursive(item.sourcePath)).filter((f) => f.endsWith('.md') && !hasDotSegment(f)).length;
    }
    const defined = await loadDefinedProjectIds(localConfig.repo.localPath);
    return (await listFilesRecursive(item.sourcePath)).filter((f) => {
      if (!f.endsWith('.md') || hasDotSegment(f)) return false;
      return !defined.has(f.split('/')[0]);
    }).length;
  }

  async pushItem(item: ResourceItem, _teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const dest = path.join(this.repoWikiDir(localConfig), item.name);
    await fse.ensureDir(path.dirname(dest));
    await fse.copy(item.sourcePath, dest, { overwrite: true });
    log.debug(`Pushed wiki page ${item.name} → team repo`);
  }

  /**
   * Whole-dir mirror: overwrite same-named pages, preserve local-only pages.
   * Shared-root bundle excludes first-level project namespace dirs; project
   * bundle mirrors only `.<wiki>/<pid>`.
   */
  async pullItem(item: ResourceItem, _teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const local = this.localWikiDir(localConfig);
    await fse.ensureDir(local);
    const src = item.sourcePath;
    if (item.namespace) {
      const dest = path.join(local, item.namespace);
      await fse.ensureDir(dest);
      await fse.copy(src, dest, {
        overwrite: true,
        filter: (srcPath: string) => srcPath === src || !path.basename(srcPath).startsWith('.'),
      });
      log.debug(`Synced .wiki/${item.namespace} → ${local}`);
      return;
    }
    const defined = await loadDefinedProjectIds(localConfig.repo.localPath);
    await fse.copy(src, local, {
      overwrite: true,
      // Allow the `.wiki` root itself (hidden by name) but skip hidden entries inside.
      filter: (srcPath: string) => {
        if (srcPath === src) return true;
        const base = path.basename(srcPath);
        if (base.startsWith('.')) return false;
        // Skip first-level project namespace dirs inside the shared root.
        const relToRoot = path.relative(src, srcPath);
        if (relToRoot && !relToRoot.includes(path.sep) && defined.has(relToRoot)) return false;
        return true;
      },
    });
    log.debug(`Synced wiki → ${local}`);
  }

  /**
   * Cleanup (003): remove local `<projectRoot>/.wiki/<pid>` dirs for defined
   * projects no longer active — only when local matches the team repo
   * (data-safety, same rule as docs). Returns candidate names; dryRun reports
   * without removing.
   */
  async cleanupInactiveNamespaces(
    localConfig: LocalConfig,
    dryRun = false,
  ): Promise<string[]> {
    const local = this.localWikiDir(localConfig);
    const repo = this.repoWikiDir(localConfig);
    if (!(await pathExists(local))) return [];
    const defined = await loadDefinedProjectIds(localConfig.repo.localPath);
    const removed: string[] = [];
    for (const pid of inactiveProjectIds(localConfig, defined)) {
      const localDir = path.join(local, pid);
      const repoDir = path.join(repo, pid);
      if (!(await pathExists(localDir))) continue;
      if (!(await namespaceDirSafeToRemove(localDir, repoDir))) {
        log.warn(`[${localConfig.scope}] [wiki] Kept .wiki/${pid}: it has local changes or files not in the team repo. Push or back them up, then delete it manually.`);
        continue;
      }
      removed.push(pid);
      if (!dryRun) {
        await fse.remove(localDir);
        log.debug(`[wiki] Removed inactive project namespace .wiki/${pid}`);
      }
    }
    return removed;
  }

  async removeItem(_name: string, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<string[]> {
    log.warn('Removing wiki pages is not supported via remove command. Delete from team repo directly.');
    return [];
  }
}
