import path from 'node:path';
import fse from 'fs-extra';

/**
 * Wiki root directories (007 change 2026-09-30): a project may keep several
 * knowledge bases as dot-prefixed, lowercase-wiki-suffixed DIRECT children of
 * the project root — `.wiki/`, `.dev_wiki/`, `.researchwiki/`. Each root is an
 * independent wiki that publishes one-way to `<rootName>/<projectId>/` in the
 * team repo. `.wiki/<projectId>/` keeps its existing layout, so nothing
 * already published moves and existing citations stay valid.
 */
export const WIKI_ROOT_NAME_PATTERN = /^\..*wiki$/;

/** Case-sensitive: dot-prefixed, lowercase-wiki-suffixed name (`..wiki` fits). */
export function isWikiRootName(name: string): boolean {
  return WIKI_ROOT_NAME_PATTERN.test(name);
}

/**
 * Every wiki root among the DIRECT children of `projectRoot`, sorted. Only
 * directories count (a plain file named `.testwiki` is not a wiki), and the
 * discovery never descends into subdirectories (a nested `child/.wiki/` is a
 * different project's root, not this one's).
 */
export async function discoverWikiRoots(projectRoot: string): Promise<string[]> {
  let entries: fse.Dirent[];
  try {
    entries = (await fse.readdir(projectRoot, { withFileTypes: true })) as fse.Dirent[];
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isDirectory() && isWikiRootName(e.name))
    .map((e) => e.name)
    .sort();
}

/**
 * Parse a repo-relative wiki publish key (`<rootName>/<projectId>/…`) for one
 * project. `.wiki/<projectId>/…` matches like any other root; `docs/…` and
 * other prefixes do not match at all.
 */
export function matchWikiPublishPrefix(
  key: string,
  projectId: string,
): { root: string; prefix: string } | null {
  const firstSlash = key.indexOf('/');
  if (firstSlash <= 0) return null;
  const root = key.slice(0, firstSlash);
  if (!isWikiRootName(root)) return null;
  const rest = key.slice(firstSlash + 1);
  if (!rest.startsWith(`${projectId}/`)) return null;
  return { root, prefix: `${root}/${projectId}/` };
}

/** Resolve a repo-relative wiki page path to `{ root, projectId }`, or null. */
export function parseWikiPagePath(
  pageRepoPath: string,
): { root: string; projectId: string } | null {
  const parts = pageRepoPath.split('/');
  if (parts.length < 3) return null;
  const [root, projectId] = parts;
  if (!root || !projectId || !isWikiRootName(root)) return null;
  return { root, projectId };
}

/** `path.join` for a wiki root that also documents the target convention. */
export function wikiPublishTarget(repoRoot: string, root: string, projectId: string): string {
  return path.join(repoRoot, root, projectId);
}
