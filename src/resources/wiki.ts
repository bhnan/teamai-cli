import path from 'node:path';
import fse from 'fs-extra';
import { ResourceHandler } from './base.js';
import type { ResourceItem, TeamaiConfig, LocalConfig } from '../types.js';
import { getUserHome } from '../utils/home.js';
import { listFilesRecursive, pathExists, readFileSafe } from '../utils/fs.js';
import { discoverWikiRoots } from '../utils/wiki-roots.js';
import { log } from '../utils/logger.js';

function hasDotSegment(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => segment.startsWith('.'));
}

/**
 * Project-bound wiki knowledge bases — one per wiki root directory.
 *
 * Team convention — distinct from the `teamwiki/` codebase knowledge graph: a
 * project keeps its wikis as dot-prefixed, lowercase-wiki-suffixed direct
 * children of the project root (`.wiki/`, `.dev_wiki/`, …, 007 change
 * 2026-09-30). Each root is an independent wiki that publishes one-way to
 * `<rootName>/<projectId>/` in the team repo, where other projects read them
 * and `recall --wiki-page` verifies their source anchors. The `.wiki/` root
 * keeps its historical `.wiki/<projectId>/` target, so nothing already
 * published moves. `teamai pull` never deploys or cleans the project wiki;
 * the pull-side handlers below are kept only for the deprecated `get wiki`
 * legacy mirror.
 */
export class WikiHandler extends ResourceHandler {
  readonly type = 'wiki' as const;

  /** The default (`.wiki`) local root, bound to the project in project scope. */
  localWikiDir(localConfig: LocalConfig): string {
    if (localConfig.scope === 'project' && localConfig.projectRoot) {
      return path.join(localConfig.projectRoot, '.wiki');
    }
    return path.join(getUserHome(), '.wiki');
  }

  repoWikiDir(localConfig: LocalConfig): string {
    return path.join(localConfig.repo.localPath, '.wiki');
  }

  /** The publish target for one project and wiki root: `<root>/<projectId>/`. */
  publishTargetDir(localConfig: LocalConfig, projectId: string, root = '.wiki'): string {
    return path.join(localConfig.repo.localPath, root, projectId);
  }

  async scanLocalForPush(
    _teamConfig: TeamaiConfig,
    localConfig: LocalConfig,
    options?: { projectId?: string; excludeRoots?: string[] },
  ): Promise<ResourceItem[]> {
    // One-way publish (007): every discovered wiki root's own pages against
    // the team repo's `<root>/<projectId>/` copy. push.ts decides
    // modified-vs-conflict against the recorded baseline.
    const projectId = options?.projectId;
    if (!projectId || !localConfig.projectRoot) return [];
    const excluded = new Set(options?.excludeRoots ?? []);
    const roots = (await discoverWikiRoots(localConfig.projectRoot)).filter((r) => !excluded.has(r));
    if (excluded.size > 0 || roots.length > 1) {
      log.info(
        `[wiki] roots: ${roots.length > 0 ? roots.join(', ') : '(none)'}` +
          (excluded.size > 0 ? `; excluded this run: ${[...excluded].join(', ')}` : ''),
      );
    }
    const items: ResourceItem[] = [];
    for (const root of roots) {
      const local = path.join(localConfig.projectRoot, root);
      const repo = this.publishTargetDir(localConfig, projectId, root);
      for (const rel of await listFilesRecursive(local)) {
        if (hasDotSegment(rel) || !rel.endsWith('.md')) continue;
        const localFile = path.join(local, rel);
        const repoFile = path.join(repo, rel);
        const exists = await pathExists(repoFile);
        const same = exists && (await readFileSafe(localFile)) === (await readFileSafe(repoFile));
        if (!same) {
          items.push({
            // Root-prefixed so two roots' same-named pages stay distinct.
            name: `${root}/${rel}`,
            type: 'wiki',
            sourcePath: localFile,
            // Repo-root-relative so push stages `<root>/<projectId>/<rel>`.
            relativePath: `${root}/${projectId}/${rel}`,
            status: exists ? 'modified' : 'new',
          });
        }
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
