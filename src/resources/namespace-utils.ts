import path from 'node:path';
import fse from 'fs-extra';
import type { LocalConfig } from '../types.js';
import { isSafeNamespaceSegment, loadProjectsManifest, listProjectIds } from '../projects.js';
import { dirContentEqual, hasVcsMetadataRecursive } from '../utils/fs.js';

/**
 * Namespace helpers shared by the docs and wiki handlers (and get-cmd).
 *
 * docs/wiki 的项目命名空间是「路径即归属」模型（003 spec）：
 *  - `docs/`、`.wiki/` 的第一层子目录名若命中已定义 project id → 该项目私有的
 *    命名空间目录；否则 → 团队共享。
 *  - 同步范围 = 共享根 + 活动项目（`localConfig.projects`）的命名空间目录。
 */

/** Project ids defined in the team repo's manifest/projects.yaml (empty set when absent). */
export async function loadDefinedProjectIds(repoPath: string): Promise<Set<string>> {
  const manifest = await loadProjectsManifest(repoPath);
  return new Set(manifest ? listProjectIds(manifest) : []);
}

/**
 * Project ids active in this directory (`teamai projects set` output).
 * Ids from a hand-edited config.yaml are guarded with the same segment-safety
 * rule the manifest schema enforces (src/projects.ts SAFE_ID) before they are
 * ever joined into a filesystem path.
 */
export function activeProjectIds(localConfig: LocalConfig): string[] {
  return (localConfig.projects ?? []).filter((id) => isSafeNamespaceSegment(id));
}

/** True when the first-level entry name is a defined project namespace. */
export function isProjectNamespace(name: string, definedProjectIds: Set<string>): boolean {
  return definedProjectIds.has(name);
}

/** Project ids defined by the manifest but NOT active in this directory. */
export function inactiveProjectIds(localConfig: LocalConfig, defined: Set<string>): string[] {
  const active = new Set(activeProjectIds(localConfig));
  return [...defined].filter((id) => !active.has(id));
}

/**
 * Data-safety gate for removing a local namespace dir (same philosophy as the
 * skill cleanup's `skillSafeToRemove`): the local dir must be a directory that
 * matches the team repo copy byte-for-byte. A nested git checkout always fails
 * the check (its .git can hide unpushed history a content compare cannot see).
 */
export async function namespaceDirSafeToRemove(
  localDir: string,
  repoDir: string,
): Promise<boolean> {
  const localStat = await fse.stat(localDir).catch(() => null);
  if (!localStat?.isDirectory()) return false;
  const repoStat = await fse.stat(repoDir).catch(() => null);
  if (!repoStat?.isDirectory()) return false;
  if (await hasVcsMetadataRecursive(localDir)) return false;
  return dirContentEqual(localDir, repoDir);
}