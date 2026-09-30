import { describe, expect, it } from 'vitest';
import { matchWikiSourceCollection } from '../utils/wiki-source-anchor.js';
import type { WikiSharingConfig } from '../types.js';

const wiki: WikiSharingConfig = {
  sources: [
    { id: 'docs-wiki', map: [{ from: 'docs/', to: 'docs/teamai-cli/' }] },
    { id: 'dev-wiki', map: [{ from: 'dev/', to: 'docs/teamai-cli/dev/' }] },
  ],
};

describe('matchWikiSourceCollection (any wiki root, 007 change 2026-09-30)', () => {
  it('matches the collection id under the .wiki root as before', () => {
    expect(matchWikiSourceCollection('.wiki/teamai-cli/docs-wiki/topics/a.md', wiki)).toEqual([
      { from: 'docs/', to: 'docs/teamai-cli/' },
    ]);
  });

  it('matches the collection id under any other wiki root', () => {
    expect(matchWikiSourceCollection('.dev_wiki/teamai-cli/dev-wiki/x.md', wiki)).toEqual([
      { from: 'dev/', to: 'docs/teamai-cli/dev/' },
    ]);
  });

  it('returns undefined for unknown collections, non-wiki roots, or no config', () => {
    expect(matchWikiSourceCollection('.wiki/teamai-cli/other-wiki/a.md', wiki)).toBeUndefined();
    expect(matchWikiSourceCollection('docs/teamai-cli/docs-wiki/a.md', wiki)).toBeUndefined();
    expect(matchWikiSourceCollection('.wiki/teamai-cli/docs-wiki/a.md', undefined)).toBeUndefined();
  });
});
