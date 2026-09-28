/**
 * Unit tests for the wiki source anchor resolver and verifier
 * (src/utils/wiki-source-anchor.ts).
 *
 * Pure functions + filesystem reads only; no network, no config wiring.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  mapAnchorPath,
  verifyWikiSource,
  resolveWikiPageSources,
} from '../utils/wiki-source-anchor.js';
import type { WikiSharingConfig } from '../types.js';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'teamai-wiki-anchor-'));
  try {
    return await fn(dir);
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

const PAGE = '.wiki/teamai-cli/docs-wiki/topics/usage-guide.md';

describe('mapAnchorPath', () => {
  const base = { pageRepoPath: PAGE, projectId: 'teamai-cli' };

  it('maps the default project-root relative docs/ form', () => {
    expect(mapAnchorPath('docs/usage-guide.md', base)).toEqual({ mapped: 'docs/teamai-cli/usage-guide.md' });
  });

  it('applies an explicit map rule before the default convention', () => {
    const map = [{ from: 'docs/', to: 'docs/teamai-cli/' }];
    expect(mapAnchorPath('docs/usage-guide.md', { ...base, map })).toEqual({ mapped: 'docs/teamai-cli/usage-guide.md' });
    // An explicit rule wins even for paths the default would not map.
    expect(mapAnchorPath('designs/x.md', { ...base, map: [{ from: 'designs/', to: 'docs/teamai-cli/designs/' }] })).toEqual({
      mapped: 'docs/teamai-cli/designs/x.md',
    });
  });

  it('does not guess page-relative ../ forms (not a documented default form)', () => {
    expect(mapAnchorPath('../../docs/usage-guide.md', base).reason).toContain('no mapping rule');
    expect(mapAnchorPath('../../../secrets/key.md', base).reason).toContain('no mapping rule');
  });

  it('refuses absolute paths and paths with no matching rule', () => {
    expect(mapAnchorPath('/etc/passwd', base).reason).toBeTruthy();
    expect(mapAnchorPath('docs/usage-guide.md', { ...base, projectId: undefined }).reason).toContain('no active project');
    expect(mapAnchorPath('README.md', base).reason).toContain('no mapping rule');
  });
});

describe('verifyWikiSource', () => {
  it('verifies an existing in-scope file whose hash matches', async () => {
    await withTmpDir(async (dir) => {
      const target = path.join(dir, 'docs', 'teamai-cli', 'usage-guide.md');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const text = '# guide\n';
      await fsp.writeFile(target, text);

      const result = await verifyWikiSource('docs/usage-guide.md', 'docs/teamai-cli/usage-guide.md', {
        cloneRoot: dir,
        allowedRoot: path.join(dir, 'docs', 'teamai-cli'),
        expectedSha256: sha(text),
      });
      expect(result.status).toBe('verified');
      expect(result.resolved).toBe(target);
    });
  });

  it('reports missing when the mapped file does not exist', async () => {
    await withTmpDir(async (dir) => {
      const result = await verifyWikiSource('docs/x.md', 'docs/teamai-cli/x.md', {
        cloneRoot: dir,
        allowedRoot: path.join(dir, 'docs', 'teamai-cli'),
        expectedSha256: sha('x'),
      });
      expect(result.status).toBe('missing');
    });
  });

  it('reports out_of_scope when a symlink escapes the allowed scope', async () => {
    await withTmpDir(async (dir) => {
      const outside = path.join(dir, 'outside', 'secret.md');
      await fsp.mkdir(path.dirname(outside), { recursive: true });
      await fsp.writeFile(outside, 'top secret');
      const link = path.join(dir, 'docs', 'teamai-cli', 'link.md');
      await fsp.mkdir(path.dirname(link), { recursive: true });
      await fsp.symlink(outside, link);

      const result = await verifyWikiSource('docs/link.md', 'docs/teamai-cli/link.md', {
        cloneRoot: dir,
        allowedRoot: path.join(dir, 'docs', 'teamai-cli'),
        expectedSha256: sha('top secret'),
      });
      expect(result.status).toBe('out_of_scope');
    });
  });

  it('reports content_changed when the bytes no longer match the recorded hash', async () => {
    await withTmpDir(async (dir) => {
      const target = path.join(dir, 'docs', 'teamai-cli', 'usage-guide.md');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, '# changed\n');

      const result = await verifyWikiSource('docs/usage-guide.md', 'docs/teamai-cli/usage-guide.md', {
        cloneRoot: dir,
        allowedRoot: path.join(dir, 'docs', 'teamai-cli'),
        expectedSha256: sha('# original\n'),
      });
      expect(result.status).toBe('content_changed');
      expect(result.reason).toContain('sha256 mismatch');
    });
  });

  it('reports unverifiable when sha256 is absent or malformed', async () => {
    await withTmpDir(async (dir) => {
      const target = path.join(dir, 'docs', 'teamai-cli', 'u.md');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      await fsp.writeFile(target, 'u');

      const noHash = await verifyWikiSource('docs/u.md', 'docs/teamai-cli/u.md', {
        cloneRoot: dir,
        allowedRoot: path.join(dir, 'docs', 'teamai-cli'),
        expectedSha256: undefined,
      });
      expect(noHash.status).toBe('unverifiable');

      const badHash = await verifyWikiSource('docs/u.md', 'docs/teamai-cli/u.md', {
        cloneRoot: dir,
        allowedRoot: path.join(dir, 'docs', 'teamai-cli'),
        expectedSha256: 'not-a-hash',
      });
      expect(badHash.status).toBe('unverifiable');
    });
  });
});

describe('resolveWikiPageSources', () => {
  it('walks every anchor and keeps them independent', async () => {
    await withTmpDir(async (dir) => {
      const target = path.join(dir, 'docs', 'teamai-cli', 'usage-guide.md');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const text = '# guide\n';
      await fsp.writeFile(target, text);

      const results = await resolveWikiPageSources(PAGE, [
        { path: 'docs/usage-guide.md', sha256: sha(text) },
        { path: 'docs/gone.md', sha256: sha('gone') },
        { path: '../README.md' },
        { path: 'https://example.com/x.md', sha256: sha('x') },
      ], { cloneRoot: dir, projectId: 'teamai-cli' });

      // URL and page-relative anchors are not file anchors → skipped/unmapped.
      expect(results.map((r) => r.status)).toEqual(['verified', 'missing', 'unmapped']);
      expect(results[0].resolved).toBe(target);
      expect(results[1].reason).toContain('does not exist');
    });
  });

  it('uses the explicit map from the matching wiki source config', async () => {
    await withTmpDir(async (dir) => {
      const target = path.join(dir, 'docs', 'teamai-cli', 'usage-guide.md');
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const text = '# guide\n';
      await fsp.writeFile(target, text);

      const wiki: WikiSharingConfig = {
        sources: [{ id: 'docs-wiki', map: [{ from: 'docs/', to: 'docs/teamai-cli/' }] }],
      };
      const results = await resolveWikiPageSources(PAGE, [{ path: 'docs/usage-guide.md', sha256: sha(text) }], {
        cloneRoot: dir,
        projectId: 'teamai-cli',
        wiki,
      });
      expect(results[0].status).toBe('verified');
    });
  });
});
