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
 * pages live in `<projectRoot>/.wiki/` and publish one-way to the team repo's
 * `.wiki/<projectId>/` directory (007), where other projects read them and
 * `recall --wiki-page` verifies their source anchors. `teamai pull` never
 * deploys or cleans the project wiki; the pull-side handlers below are kept
 * only for the deprecated `get wiki` legacy mirror.
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

  /** The publish target for one project: `.wiki/<projectId>/` (007). */
  publishTargetDir(localConfig: LocalConfig, projectId: string): string {
    return path.join(localConfig.repo.localPath, '.wiki', projectId);
  }

  async scanLocalForPush(
    _teamConfig: TeamaiConfig,
    localConfig: LocalConfig,
    options?: { projectId?: string },
  ): Promise<ResourceItem[]> {
    // One-way publish (007): the project's own pages against the team repo's
    // `.wiki/<projectId>/` copy. push.ts decides modified-vs-conflict against
    // the recorded baseline.
    const projectId = options?.projectId;
    const local = this.localWikiDir(localConfig);
    if (!projectId || !(await pathExists(local))) return [];
    const repo = this.publishTargetDir(localConfig, projectId);
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
          // Repo-root-relative so push stages `.wiki/<projectId>/<rel>`.
          relativePath: `.wiki/${projectId}/${rel}`,
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
    const dest = path.join(localConfig.repo.localPath, item.relativePath);
    await fse.ensureDir(path.dirname(dest));
    await fse.copy(item.sourcePath, dest, { overwrite: true });
    log.debug(`Published wiki page ${item.relativePath} → team repo`);
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
