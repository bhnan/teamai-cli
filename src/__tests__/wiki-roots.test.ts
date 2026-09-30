import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  discoverWikiRoots,
  isWikiRootName,
  matchWikiPublishPrefix,
  parseWikiPagePath,
} from '../utils/wiki-roots.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-wiki-roots-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function mkdirp(rel: string): void {
  fs.mkdirSync(path.join(tmp, rel), { recursive: true });
}

describe('isWikiRootName (007 change 2026-09-30 decision table)', () => {
  it.each([
    ['.wiki', true],
    ['.dev_wiki', true],
    ['.researchwiki', true],
    ['..wiki', true], // dot prefix, then `.*` may itself contain dots
    ['.wiki_backup', false], // does not end with lowercase wiki
    ['wiki', false], // no dot prefix
    ['.dev_Wiki', false], // case-sensitive: capital W does not match
    ['.WIKI', false],
    ['', false],
  ])('%j → %j', (name, expected) => {
    expect(isWikiRootName(name)).toBe(expected);
  });
});

describe('discoverWikiRoots', () => {
  it('finds only dot-prefixed lowercase-wiki DIRECTORIES of the project root', async () => {
    mkdirp('.wiki/a');
    mkdirp('.dev_wiki/b');
    mkdirp('.researchwiki');
    mkdirp('.wiki_backup/x');
    mkdirp('wiki/y');
    mkdirp('.dev_Wiki/z');
    mkdirp('child/.wiki/nested'); // not a direct child — never discovered
    fs.writeFileSync(path.join(tmp, '.testwiki'), 'plain file, not a directory');
    expect(await discoverWikiRoots(tmp)).toEqual(['.dev_wiki', '.researchwiki', '.wiki']);
  });

  it('returns empty for a missing root', async () => {
    expect(await discoverWikiRoots(path.join(tmp, 'nope'))).toEqual([]);
  });
});

describe('matchWikiPublishPrefix', () => {
  it('matches any wiki root for the given project', () => {
    expect(matchWikiPublishPrefix('.wiki/demo/spec/a.md', 'demo')).toEqual({
      root: '.wiki',
      prefix: '.wiki/demo/',
    });
    expect(matchWikiPublishPrefix('.dev_wiki/demo/index.md', 'demo')).toEqual({
      root: '.dev_wiki',
      prefix: '.dev_wiki/demo/',
    });
  });

  it('rejects other projects, docs keys, and non-wiki prefixes', () => {
    expect(matchWikiPublishPrefix('.wiki/other/a.md', 'demo')).toBeNull();
    expect(matchWikiPublishPrefix('docs/demo/a.md', 'demo')).toBeNull();
    expect(matchWikiPublishPrefix('skills/demo/a.md', 'demo')).toBeNull();
    expect(matchWikiPublishPrefix('wiki/demo/a.md', 'demo')).toBeNull();
  });
});

describe('parseWikiPagePath', () => {
  it('splits root and projectId from any wiki-root page path', () => {
    expect(parseWikiPagePath('.wiki/teamai-cli/docs-wiki/topics/usage-guide.md')).toEqual({
      root: '.wiki',
      projectId: 'teamai-cli',
    });
    expect(parseWikiPagePath('.dev_wiki/teamai-cli/dev-wiki/x.md')).toEqual({
      root: '.dev_wiki',
      projectId: 'teamai-cli',
    });
  });

  it('rejects non-wiki roots and too-short paths', () => {
    expect(parseWikiPagePath('docs/a/b.md')).toBeNull();
    expect(parseWikiPagePath('wiki/a/b.md')).toBeNull();
    expect(parseWikiPagePath('.wiki/only-pid')).toBeNull();
  });
});
