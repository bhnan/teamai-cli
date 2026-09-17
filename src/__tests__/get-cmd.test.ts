import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeWikiDiff,
  isValidName,
  listTypeEntries,
  resolveDocsSource,
  resolveRuleSource,
  resolveSkillSource,
} from '../get-cmd.js';
import { WikiHandler } from '../resources/wiki.js';
import type { LocalConfig, TeamaiConfig } from '../types.js';

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'teamai-get-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function write(rel: string, content: string): void {
  const p = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
}

describe('isValidName', () => {
  it('accepts normal and namespaced names', () => {
    expect(isValidName('alpha')).toBe(true);
    expect(isValidName('ns/beta')).toBe(true);
  });

  it('rejects traversal and absolute paths', () => {
    expect(isValidName('../../pwn')).toBe(false);
    expect(isValidName('/abs')).toBe(false);
    expect(isValidName('a/../b')).toBe(false);
  });
});

describe('resolveSkillSource', () => {
  it('resolves flat skills', async () => {
    write('skills/alpha/SKILL.md', 'x');
    expect(await resolveSkillSource(path.join(tmp, 'skills'), 'alpha')).toBe(path.join(tmp, 'skills', 'alpha'));
  });

  it('resolves namespaced skills', async () => {
    write('skills/ns/beta/SKILL.md', 'x');
    expect(await resolveSkillSource(path.join(tmp, 'skills'), 'beta')).toBe(path.join(tmp, 'skills', 'ns', 'beta'));
  });

  it('returns null when missing', async () => {
    expect(await resolveSkillSource(path.join(tmp, 'skills'), 'nope')).toBeNull();
  });

  it('throws on namespace ambiguity', async () => {
    write('skills/a/dup/SKILL.md', 'x');
    write('skills/b/dup/SKILL.md', 'x');
    await expect(resolveSkillSource(path.join(tmp, 'skills'), 'dup')).rejects.toThrow(/multiple namespaces/);
  });
});

describe('resolveRuleSource', () => {
  it('resolves exact, suffix-optional, and deep basename', async () => {
    write('rules/gamma.md', 'g');
    write('rules/a/b/deep.md', 'd');
    const rules = path.join(tmp, 'rules');
    expect(await resolveRuleSource(rules, 'gamma')).toBe(path.join(tmp, 'rules', 'gamma.md'));
    expect(await resolveRuleSource(rules, 'gamma.md')).toBe(path.join(tmp, 'rules', 'gamma.md'));
    expect(await resolveRuleSource(rules, 'a/b/deep')).toBe(path.join(tmp, 'rules', 'a', 'b', 'deep.md'));
    expect(await resolveRuleSource(rules, 'deep')).toBe(path.join(tmp, 'rules', 'a', 'b', 'deep.md'));
  });

  it('returns null when missing', async () => {
    write('rules/gamma.md', 'g');
    expect(await resolveRuleSource(path.join(tmp, 'rules'), 'nope')).toBeNull();
  });
});

describe('resolveDocsSource', () => {
  it('resolves suffix-optional and subpath docs', async () => {
    write('docs/epsilon.md', 'e');
    write('docs/sub/zeta.md', 'z');
    const docs = path.join(tmp, 'docs');
    expect(await resolveDocsSource(docs, 'epsilon')).toBe(path.join(tmp, 'docs', 'epsilon.md'));
    expect(await resolveDocsSource(docs, 'epsilon.md')).toBe(path.join(tmp, 'docs', 'epsilon.md'));
    expect(await resolveDocsSource(docs, 'sub/zeta')).toBe(path.join(tmp, 'docs', 'sub', 'zeta.md'));
  });
});

describe('listTypeEntries', () => {
  it('lists skills (flat + ns), rules, docs, wiki', async () => {
    write('skills/alpha/SKILL.md', 'x');
    write('skills/ns/beta/SKILL.md', 'x');
    write('rules/gamma.md', 'g');
    write('docs/epsilon.md', 'e');
    write('.wiki/Home.md', 'h');
    expect(await listTypeEntries(tmp, 'skills')).toEqual(['alpha', 'ns/beta']);
    expect(await listTypeEntries(tmp, 'rules')).toEqual(['gamma.md']);
    expect(await listTypeEntries(tmp, 'docs')).toEqual(['epsilon.md']);
    expect(await listTypeEntries(tmp, 'wiki')).toEqual(['Home.md']);
  });

  it('returns empty for missing directories', async () => {
    expect(await listTypeEntries(tmp, 'wiki')).toEqual([]);
  });
});

describe('computeWikiDiff', () => {
  it('detects changed / only-in-src / only-in-dst', async () => {
    write('.wiki/arch/a.md', 'v1');
    write('.wiki/Home.md', 'h');
    write('local/.wiki/arch/a.md', 'v2');
    write('local/.wiki/keep.md', 'k');
    const diff = await computeWikiDiff(path.join(tmp, '.wiki'), path.join(tmp, 'local', '.wiki'));
    expect(diff.changed).toEqual(['arch/a.md']);
    expect(diff.onlyInSrc).toEqual(['Home.md']);
    expect(diff.onlyInDst).toEqual(['keep.md']);
  });

  it('treats a missing local wiki as entirely new', async () => {
    write('.wiki/Home.md', 'h');
    const diff = await computeWikiDiff(path.join(tmp, '.wiki'), path.join(tmp, 'local', '.wiki'));
    expect(diff.onlyInSrc).toEqual(['Home.md']);
    expect(diff.onlyInDst).toEqual([]);
  });
});

describe('WikiHandler', () => {
  function makeConfigs(): { localConfig: LocalConfig; teamConfig: TeamaiConfig } {
    return {
      localConfig: {
        scope: 'project',
        projectRoot: tmp,
        repo: { localPath: path.join(tmp, 'repo') },
      } as unknown as LocalConfig,
      teamConfig: {
        sharing: { docs: { localDir: '~/docs' } },
      } as unknown as TeamaiConfig,
    };
  }

  it('scanLocalForPush returns only new/modified pages vs the team repo', async () => {
    write('.wiki/changed.md', 'local-v2');
    write('.wiki/same.md', 'same');
    write('.wiki/new.md', 'n');
    write('repo/.wiki/changed.md', 'local-v1');
    write('repo/.wiki/same.md', 'same');
    const { localConfig, teamConfig } = makeConfigs();
    const handler = new WikiHandler();
    const items = await handler.scanLocalForPush(teamConfig, localConfig);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(['changed.md', 'new.md']);
    expect(items.find((i) => i.name === 'changed.md')?.status).toBe('modified');
    expect(items.find((i) => i.name === 'new.md')?.status).toBe('new');
  });

  it('localWikiDir binds to the project in project scope', () => {
    const { localConfig } = makeConfigs();
    const handler = new WikiHandler();
    expect(handler.localWikiDir(localConfig)).toBe(path.join(tmp, '.wiki'));
  });
});
