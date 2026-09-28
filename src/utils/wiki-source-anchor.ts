/**
 * Resolve and verify a wiki page's source anchors (`sources[].path` +
 * `sha256` in the page frontmatter) against the local team-repo clone.
 *
 * A wiki page declares the originals it cites as `sources[]`, each element
 * carrying the path the page was authored against (relative to the authoring
 * project root, e.g. `docs/usage-guide.md`) and the SHA-256 of that file's
 * bytes at authoring time. Once project content is published into the
 * team-repo namespace (`docs/<pid>/…`), those relative paths no longer resolve
 * on their own. This module maps each anchor to the file it refers to inside
 * the clone, then decides whether that file may be cited as the original:
 *
 *  1. map the anchor path (explicit `map` rules from `sharing.wiki` first,
 *     then the default "project-root relative → docs/<pid>/" convention);
 *  2. check the mapped target is a single existing file inside the allowed
 *     `docs/<pid>/` scope (realpath-checked, so a symlink cannot escape);
 *  3. compare the file's SHA-256 against the anchor's recorded hash.
 *
 * Only an anchor that passes every check is `verified` and may be cited.
 * Retrieval of the page itself is never gated on these checks — the two are
 * deliberately independent (see docs/006-wiki-source-citation-mapping/spec.md).
 *
 * The frontmatter contract is the only coupling: the CLI reads `sources[]`
 * generically and never depends on which tool produced the page.
 */

import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { TeamaiConfig, WikiPathMap, WikiSharingConfig } from '../types.js';

/** Closed set of citation states a single source anchor can end in. */
export type WikiSourceStatus =
  | 'verified'
  | 'missing'
  | 'out_of_scope'
  | 'content_changed'
  | 'unmapped'
  | 'unverifiable';

export interface WikiSourceVerification {
  /** The anchor path exactly as written in the page frontmatter. */
  path: string;
  status: WikiSourceStatus;
  /** Team-repo-relative mapped path; present only when mapping succeeded. */
  mapped?: string;
  /** Absolute path of the mapped file on this machine; present when verified. */
  resolved?: string;
  /** SHA-256 of the file bytes read from disk; present when verified. */
  sha256?: string;
  /** Human-readable reason; required for every non-verified status. */
  reason?: string;
}

/**
 * Resolve one anchor path to a team-repo-relative path, or report why it
 * cannot be mapped.
 *
 * Mapping order (first match wins, per spec §3.2):
 *  1. explicit `map[].from` prefix → replace with `map[].to`;
 *  2. default convention: `docs/…` → `docs/<pid>/…`.
 *
 * Any other path (absolute, dot-file, outside docs/, page-relative `../…`) is
 * `unmapped` — never guessed. The default only rewrites the `docs/…` form;
 * a wiki whose anchors use a different layout declares explicit `map` rules.
 */
export function mapAnchorPath(
  anchorPath: string,
  opts: {
    pageRepoPath: string;
    projectId: string | undefined;
    map?: WikiPathMap[];
  },
): { mapped?: string; reason?: string } {
  const { pageRepoPath, projectId, map } = opts;
  const trimmed = anchorPath.trim();
  if (trimmed === '') return { reason: 'empty anchor path' };
  if (path.isAbsolute(trimmed)) return { reason: 'absolute paths are not mapped (config uses repo-relative paths)' };

  // Rule 1: explicit mapping.
  if (map && map.length > 0) {
    const rule = map.find((m) => trimmed === m.from || trimmed.startsWith(m.from.endsWith('/') ? m.from : `${m.from}/`) || trimmed.startsWith(m.from));
    if (rule) {
      const rest = trimmed.slice(rule.from.length);
      const mapped = rest === '' ? rule.to : `${rule.to.replace(/\/$/, '')}/${rest.replace(/^\//, '')}`;
      return { mapped };
    }
  }

  // Rule 2: default convention — project-root relative `docs/…`, mapped into
  // the project namespace. The default only rewrites this one form; anything
  // else (page-relative `../…`, absolute paths, non-docs roots) must be
  // covered by an explicit `map` rule and is otherwise not guessed.
  if (trimmed.startsWith('docs/')) {
    if (!projectId) return { reason: 'no active project id to map docs/ into docs/<pid>/' };
    return { mapped: `docs/${projectId}/${trimmed.slice('docs/'.length)}` };
  }

  return { reason: `no mapping rule matches "${trimmed}"` };
}

/**
 * Verify a mapped target: single existing regular file inside the allowed
 * `docs/<pid>/` scope, whose bytes hash to the recorded value.
 */
export async function verifyWikiSource(
  anchorPath: string,
  mapped: string,
  opts: {
    cloneRoot: string;
    allowedRoot: string;
    expectedSha256?: string;
  },
): Promise<WikiSourceVerification> {
  const { cloneRoot, allowedRoot, expectedSha256 } = opts;
  const base: WikiSourceVerification = { path: anchorPath, mapped, status: 'unmapped' };

  if (expectedSha256 !== undefined && !/^[0-9a-f]{64}$/i.test(expectedSha256)) {
    return { ...base, status: 'unverifiable', reason: `malformed sha256 "${expectedSha256}"` };
  }
  if (expectedSha256 === undefined) {
    return { ...base, status: 'unverifiable', reason: 'anchor has no sha256; content cannot be proven identical' };
  }

  const candidate = path.resolve(cloneRoot, mapped);
  try {
    const st = await fsp.stat(candidate);
    if (!st.isFile()) {
      return { ...base, status: 'missing', reason: `target is not a regular file: ${mapped}` };
    }
  } catch {
    return { ...base, status: 'missing', reason: `mapped file does not exist: ${mapped}` };
  }

  // Real-path check: a symlink inside docs/ that points outside the allowed
  // scope must not smuggle a citation out of `docs/<pid>/`.
  let realCandidate: string;
  try {
    realCandidate = await fsp.realpath(candidate);
  } catch {
    return { ...base, status: 'missing', reason: `cannot resolve real path of ${mapped}` };
  }
  const realAllowed = path.resolve(allowedRoot);
  if (!realCandidate.startsWith(`${realAllowed}${path.sep}`) && realCandidate !== realAllowed) {
    return { ...base, status: 'out_of_scope', reason: `resolved path ${realCandidate} escapes allowed scope ${realAllowed}` };
  }

  let bytes: Buffer;
  try {
    bytes = await fsp.readFile(candidate);
  } catch {
    return { ...base, status: 'missing', reason: `mapped file unreadable: ${mapped}` };
  }
  const actual = createHash('sha256').update(bytes).digest('hex');
  if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
    return {
      ...base,
      status: 'content_changed',
      reason: `sha256 mismatch (expected ${expectedSha256}, actual ${actual})`,
    };
  }

  return { ...base, status: 'verified', resolved: candidate, sha256: actual };
}

/**
 * Resolve and verify every source anchor of a wiki page.
 *
 * `pageRepoPath` is the page's path relative to the team-repo clone root
 * (e.g. `.wiki/teamai-cli/docs-wiki/topics/usage-guide.md`); `projectId` is
 * the active project's id used by the default mapping convention.
 */
export async function resolveWikiPageSources(
  pageRepoPath: string,
  anchors: Array<{ path: string; sha256?: string }>,
  opts: {
    cloneRoot: string;
    projectId: string | undefined;
    wiki?: WikiSharingConfig;
  },
): Promise<WikiSourceVerification[]> {
  const { cloneRoot, projectId, wiki } = opts;
  const out: WikiSourceVerification[] = [];
  for (const anchor of anchors) {
    const p = anchor.path.trim();
    if (p === '') continue;
    if (p.includes('://')) continue; // URLs are not file anchors.
    if (p.endsWith('/')) continue; // bare directories are not file anchors.

    // Find the source config this page belongs to (by the collection id in
    // the page path: `.wiki/<pid>/<name>wiki/...`). Without a match the
    // default convention still applies — mapping is never blocked by config.
    let map: WikiPathMap[] | undefined;
    const m = pageRepoPath.match(/^\.wiki\/[^/]+\/([^/]+)\//);
    if (m && wiki?.sources) {
      const cfg = wiki.sources.find((s) => s.id === m[1]);
      if (cfg) map = cfg.map;
    }

    const { mapped, reason } = mapAnchorPath(p, { pageRepoPath, projectId, map });
    if (!mapped) {
      out.push({ path: p, status: 'unmapped', reason });
      continue;
    }

    const allowedRoot = path.join(cloneRoot, 'docs', projectId ?? '');
    out.push(await verifyWikiSource(p, mapped, { cloneRoot, allowedRoot, expectedSha256: anchor.sha256 }));
  }
  return out;
}
