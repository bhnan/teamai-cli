import path from 'node:path';
import fse from 'fs-extra';

/**
 * Wiki root directories (007 change 2026-09-30, revised same day): the
 * DEFAULT wiki is the project root's `.wiki/` directory, published one-way to
 * `.wiki/<projectId>/` in the team repo — the historical layout, so nothing
 * already published moves and existing citations stay valid. Every other
 * directory — including ones matching the wiki-root name pattern below — is
 * ignored until it is EXPLICITLY selected with `--wiki-source <dir>=<name>`,
 * which publishes it as `.wiki/<projectId>_<name>/`. Discovery of
 * pattern-matching siblings exists only to report them as ignored.
 */
export const WIKI_ROOT_NAME_PATTERN = /^\..*wiki$/;

/** Case-sensitive: dot-prefixed, lowercase-wiki-suffixed name (`..wiki` fits). */
export function isWikiRootName(name: string): boolean {
  return WIKI_ROOT_NAME_PATTERN.test(name);
}

/**
 * Every wiki-root-shaped directory among the DIRECT children of `projectRoot`,
 * sorted — regardless of whether it is published this run. Only directories
 * count (a plain file named `.testwiki` is not a wiki), and the discovery
 * never descends into subdirectories (a nested `child/.wiki/` is a different
 * project's root, not this one's).
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

/** How one repo-relative wiki publish key sits in the team repo. */
export interface WikiPublishPrefix {
  /** The team-repo top level the key sits under: always `.wiki` now; a beta-5 root name for legacy keys. */
  root: string;
  /** The full key prefix (`<root>/<namespace>/`) the rest of the key is relative to. */
  prefix: string;
  /** Present when the key belongs to an explicitly named source: the `<name>` in `.wiki/<projectId>_<name>/`. */
  name?: string;
  /** True for `<rootName>/<projectId>/` keys a pre-explicit-roots release wrote (`.dev_wiki/<pid>/`). */
  legacy?: boolean;
}

/**
 * Parse a repo-relative wiki publish key for one project. Three shapes match:
 * the default `.wiki/<projectId>/…`, an explicitly named
 * `.wiki/<projectId>_<name>/…`, and a legacy `<rootName>/<projectId>/…` that a
 * beta release auto-discovered. `docs/…` and other prefixes never match.
 */
export function matchWikiPublishPrefix(
  key: string,
  projectId: string,
): WikiPublishPrefix | null {
  const firstSlash = key.indexOf('/');
  if (firstSlash <= 0) return null;
  const root = key.slice(0, firstSlash);
  const rest = key.slice(firstSlash + 1);
  if (root === '.wiki') {
    const nsSlash = rest.indexOf('/');
    if (nsSlash <= 0) return null;
    const ns = rest.slice(0, nsSlash);
    if (ns === projectId) return { root, prefix: `.wiki/${projectId}/` };
    if (ns.startsWith(`${projectId}_`)) {
      return { root, prefix: `.wiki/${ns}/`, name: ns.slice(projectId.length + 1) };
    }
    return null;
  }
  if (!isWikiRootName(root)) return null;
  if (!rest.startsWith(`${projectId}/`)) return null;
  return { root, prefix: `${root}/${projectId}/`, legacy: true };
}

/**
 * Resolve a repo-relative wiki page path to `{ root, projectId }`, or null.
 * Both current layouts pass: `.wiki/<projectId>/…` and
 * `.wiki/<projectId>_<name>/…` (the namespace segment is returned verbatim);
 * legacy beta pages under `<rootName>/<projectId>/…` pass too.
 */
export function parseWikiPagePath(
  pageRepoPath: string,
): { root: string; projectId: string } | null {
  const parts = pageRepoPath.split('/');
  if (parts.length < 3) return null;
  const [root, projectId] = parts;
  if (!root || !projectId || !isWikiRootName(root)) return null;
  return { root, projectId };
}

/**
 * The publish directory for one wiki in the team repo: `.wiki/<projectId>/`
 * for the default root, `.wiki/<projectId>_<name>/` for an explicitly named
 * source.
 */
export function wikiPublishTarget(repoRoot: string, projectId: string, name?: string): string {
  return path.join(repoRoot, '.wiki', name ? `${projectId}_${name}` : projectId);
}
