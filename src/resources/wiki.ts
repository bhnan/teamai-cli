import path from 'node:path';
import fse from 'fs-extra';
import { ResourceHandler } from './base.js';
import type { ResourceItem, TeamaiConfig, LocalConfig } from '../types.js';
import { getUserHome } from '../utils/home.js';
import { listFilesRecursive, pathExists, readFileSafe } from '../utils/fs.js';
import { log } from '../utils/logger.js';

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
    const items: ResourceItem[] = [];
    for (const rel of await listFilesRecursive(local)) {
      if (hasDotSegment(rel) || !rel.endsWith('.md')) continue;
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

  async scanTeamForPull(_teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const repo = this.repoWikiDir(localConfig);
    if (!(await pathExists(repo))) return [];
    const pages = (await listFilesRecursive(repo)).filter((f) => f.endsWith('.md') && !hasDotSegment(f));
    if (pages.length === 0) return [];
    return [{ name: 'wiki', type: 'wiki', sourcePath: repo, relativePath: '.wiki/' }];
  }

  async pushItem(item: ResourceItem, _teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const dest = path.join(this.repoWikiDir(localConfig), item.name);
    await fse.ensureDir(path.dirname(dest));
    await fse.copy(item.sourcePath, dest, { overwrite: true });
    log.debug(`Pushed wiki page ${item.name} → team repo`);
  }

  /** Whole-repo mirror: overwrite same-named pages, preserve local-only pages. */
  async pullItem(item: ResourceItem, _teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const local = this.localWikiDir(localConfig);
    await fse.ensureDir(local);
    const src = item.sourcePath;
    await fse.copy(src, local, {
      overwrite: true,
      // Allow the `.wiki` root itself (hidden by name) but skip hidden entries inside.
      filter: (srcPath: string) => srcPath === src || !path.basename(srcPath).startsWith('.'),
    });
    log.debug(`Synced wiki → ${local}`);
  }

  async removeItem(_name: string, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<string[]> {
    log.warn('Removing wiki pages is not supported via remove command. Delete from team repo directly.');
    return [];
  }
}
