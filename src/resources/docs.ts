import path from 'node:path';
import fse from 'fs-extra';
import { ResourceHandler } from './base.js';
import type { ResourceItem, TeamaiConfig, LocalConfig } from '../types.js';
import { expandHome, fileContentEqual, listFilesRecursive, pathExists } from '../utils/fs.js';
import { log } from '../utils/logger.js';

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
   */
  async scanLocalForPush(teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<ResourceItem[]> {
    const localDocsDir = resolveDocsLocalDir(teamConfig, localConfig);
    const repoDocsDir = path.join(localConfig.repo.localPath, 'docs');
    if (!(await pathExists(localDocsDir)) || !(await pathExists(repoDocsDir))) return [];
    const items: ResourceItem[] = [];
    for (const rel of await listFilesRecursive(localDocsDir)) {
      if (rel.split('/').some((segment) => segment.startsWith('.'))) continue;
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
   * Sync docs from team repo to local docs directory.
   */
  async pullItem(item: ResourceItem, teamConfig: TeamaiConfig, localConfig: LocalConfig): Promise<void> {
    const localDocsDir = resolveDocsLocalDir(teamConfig, localConfig);
    try {
      const src = expandHome(item.sourcePath);
      await fse.copy(src, localDocsDir, {
        overwrite: true,
        filter: (srcPath: string) => !path.basename(srcPath).startsWith('.'),
      });
      log.debug(`Synced docs → ${localDocsDir}`);
    } catch (e) {
      log.warn(`Failed to sync docs: ${(e as Error).message}`);
    }
  }

  async removeItem(_name: string, _teamConfig: TeamaiConfig, _localConfig: LocalConfig): Promise<string[]> {
    log.warn('Removing docs is not supported via remove command. Delete from team repo directly.');
    return [];
  }
}
