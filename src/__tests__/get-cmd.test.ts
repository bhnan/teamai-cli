import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  computeWikiDiff,
  isValidName,
  listTypeEntries,
  resolveDocsSource,
  resolveNamespacedSource,
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

  it('rejects degenerate dot segments and empty segments', () => {
    expect(isValidName('.')).toBe(false);
    expect(isValidName('a/./b')).toBe(false);
    expect(isValidName('ns/')).toBe(false);
    expect(isValidName('')).toBe(false);
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

  it('scope filter (003): excludes inactive project namespace wikis from the diff', async () => {
    write('.wiki/team/Home.md', 'h');
    write('.wiki/alpha/tech/t.md', 't');
    write('local/.wiki/team/Home.md', 'h2');
    write('local/.wiki/alpha/tech/t.md', 't2');
    const defined = new Set(['alpha', 'beta']);
    const diff = await computeWikiDiff(
      path.join(tmp, '.wiki'), path.join(tmp, 'local', '.wiki'), defined, ['beta'],
    );
    // alpha is a defined but INACTIVE project namespace → excluded from the diff.
    expect(diff.changed).toEqual(['team/Home.md']);
    expect(diff.onlyInSrc).toEqual([]);
    expect(diff.onlyInDst).toEqual([]);
  });
});

describe('resolveNamespacedSource (003)', () => {
  it('treats shared-root + project namespace duplicates as ambiguous (001 rule 7)', async () => {
    write('docs/shared.md', 'shared');
    write('docs/alpha/shared.md', 'project');
    const docs = path.join(tmp, 'docs');
    await expect(resolveNamespacedSource(docs, 'shared.md', ['alpha']))
      .rejects.toThrow(/multiple namespaces/);
  });

  it('falls through to active project namespace dirs', async () => {
    write('docs/alpha/a.md', 'a');
    const docs = path.join(tmp, 'docs');
    expect(await resolveNamespacedSource(docs, 'a', ['alpha']))
      .toBe(path.join(docs, 'alpha', 'a.md'));
  });

  it('explicit namespace prefix resolves even when the namespace is not in the active list', async () => {
    write('docs/beta/b.md', 'b');
    const docs = path.join(tmp, 'docs');
    expect(await resolveNamespacedSource(docs, 'beta/b.md', []))
      .toBe(path.join(docs, 'beta', 'b.md'));
  });

  it('throws listing candidates on ambiguity across namespaces', async () => {
    write('docs/shared.md', 'shared');
    write('docs/alpha/shared.md', 'project');
    const docs = path.join(tmp, 'docs');
    await expect(resolveNamespacedSource(docs, 'shared', ['alpha']))
      .rejects.toThrow(/multiple namespaces/);
  });

  it('returns null when nothing matches', async () => {
    const docs = path.join(tmp, 'docs');
    expect(await resolveNamespacedSource(docs, 'nope', ['alpha'])).toBeNull();
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
