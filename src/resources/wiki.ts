import path from 'node:path';
import fse from 'fs-extra';
import { ResourceHandler } from './base.js';
import type { NamedPublishSource } from './base.js';
import type { ResourceItem, TeamaiConfig, LocalConfig } from '../types.js';
import { getUserHome } from '../utils/home.js';
import { listFilesRecursive, pathExists, readFileSafe } from '../utils/fs.js';
import { discoverWikiRoots, wikiPublishTarget } from '../utils/wiki-roots.js';
import { log } from '../utils/logger.js';

function hasDotSegment(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => segment.startsWith('.'));
}

/**
 * Project-bound wiki knowledge bases.
 *
 * Team convention — distinct from the `teamwiki/` codebase knowledge graph.
 * The DEFAULT wiki is the project root's `.wiki/`, published one-way to
 * `.wiki/<projectId>/` in the team repo (the historical target, so nothing
 * already published moves). Additional wikis are opt-in per run
 * (`--wiki-source <dir>=<name>`): each publishes its directory as
 * `.wiki/<projectId>_<name>/` — the name is the wiki's team-repo identity,
 * never inferred from the directory's basename (007 change 2026-09-30,
 * revised same day). Every other directory is ignored: not scanned, uploaded,
 * cleaned or pending-deleted. Other projects read published wikis from the
 * clone and `recall --wiki-page` verifies their source anchors. `teamai pull`
 * never deploys or cleans the project wiki; the pull-side handlers below are
 * kept only for the deprecated `get wiki` legacy mirror.
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

  /** The publish target for one project wiki: `.wiki/<projectId>[_<name>]/`. */
  publishTargetDir(localConfig: LocalConfig, projectId: string, name?: string): string {
    return wikiPublishTarget(localConfig.repo.localPath, projectId, name);
  }

  async scanLocalForPush(
    _teamConfig: TeamaiConfig,
    localConfig: LocalConfig,
    options?: { projectId?: string; wikiSources?: NamedPublishSource[] },
  ): Promise<ResourceItem[]> {
    // One-way publish (007): the default root's and each explicitly named
    // source's own pages against the team repo copy. push.ts decides
    // modified-vs-conflict against the recorded baseline.
    const projectId = options?.projectId;
    if (!projectId || !localConfig.projectRoot) return [];
    const sources: Array<{ dir: string; repoPrefix: string }> = [];
    if (await pathExists(path.join(localConfig.projectRoot, '.wiki'))) {
      sources.push({ dir: '.wiki', repoPrefix: `.wiki/${projectId}` });
    }
    for (const { dir, name } of options?.wikiSources ?? []) {
      sources.push({ dir, repoPrefix: `.wiki/${projectId}_${name}` });
    }

    // What dry-run has to show (007 revision): the default root, every named
    // source with its target, and the wiki-shaped siblings left ignored.
    const specified = new Set(sources.map(({ dir }) => dir));
    const ignored = (await discoverWikiRoots(localConfig.projectRoot))
      .filter((root) => root !== '.wiki' && !specified.has(root));
    log.info(
      `[wiki] default root: .wiki → .wiki/${projectId}/`
      + sources.slice(1).map(({ dir, repoPrefix }) => `; source ${dir} → ${repoPrefix}/`).join('')
      + (ignored.length > 0 ? `; ignored (not specified): ${ignored.join(', ')}` : ''),
    );

    const items: ResourceItem[] = [];
    for (const { dir, repoPrefix } of sources) {
      const local = path.join(localConfig.projectRoot, dir);
      const repo = path.join(localConfig.repo.localPath, repoPrefix);
      for (const rel of await listFilesRecursive(local)) {
        if (hasDotSegment(rel) || !rel.endsWith('.md')) continue;
        const localFile = path.join(local, rel);
        const repoFile = path.join(repo, rel);
        const exists = await pathExists(repoFile);
        const same = exists && (await readFileSafe(localFile)) === (await readFileSafe(repoFile));
        if (!same) {
          items.push({
            // Source-prefixed so two wikis' same-named pages stay distinct.
            name: `${dir}/${rel}`,
            type: 'wiki',
            sourcePath: localFile,
            // Repo-root-relative so push stages `.wiki/<projectId>[_<name>]/<rel>`.
            relativePath: `${repoPrefix}/${rel}`,
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
