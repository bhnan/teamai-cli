import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  isValidName,
  listTypeEntries,
  resolveSharedRuleSource,
  resolveSharedSkillSource,
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

describe('resolveSharedSkillSource', () => {
  it('resolves a skill at the shared root', async () => {
    write('skills/alpha/SKILL.md', 'x');
    expect(await resolveSharedSkillSource(path.join(tmp, 'skills'), 'alpha')).toEqual({
      source: path.join(tmp, 'skills', 'alpha'),
      namespacedOnly: [],
    });
  });

  it('never resolves a namespace copy; reports it as namespacedOnly', async () => {
    write('skills/ns/beta/SKILL.md', 'x');
    expect(await resolveSharedSkillSource(path.join(tmp, 'skills'), 'beta')).toEqual({
      source: null,
      namespacedOnly: ['ns/beta'],
    });
  });

  it('reports every namespace copy instead of throwing on ambiguity', async () => {
    write('skills/a/dup/SKILL.md', 'x');
    write('skills/b/dup/SKILL.md', 'x');
    expect(await resolveSharedSkillSource(path.join(tmp, 'skills'), 'dup')).toEqual({
      source: null,
      namespacedOnly: ['a/dup', 'b/dup'],
    });
  });

  it('never resolves an explicit namespace path, even when it exists', async () => {
    write('skills/demo/deploy/SKILL.md', 'x');
    expect(await resolveSharedSkillSource(path.join(tmp, 'skills'), 'demo/deploy')).toEqual({
      source: null,
      namespacedOnly: ['demo/deploy'],
    });
    expect(await resolveSharedSkillSource(path.join(tmp, 'skills'), 'a/b/c')).toEqual({
      source: null,
      namespacedOnly: [],
    });
  });

  it('prefers the shared-root copy when both exist', async () => {
    write('skills/shared/SKILL.md', 'x');
    write('skills/ns/shared/SKILL.md', 'y');
    const res = await resolveSharedSkillSource(path.join(tmp, 'skills'), 'shared');
    expect(res.source).toBe(path.join(tmp, 'skills', 'shared'));
  });

  it('returns empty when nothing matches', async () => {
    expect(await resolveSharedSkillSource(path.join(tmp, 'skills'), 'nope')).toEqual({
      source: null,
      namespacedOnly: [],
    });
  });
});

describe('resolveSharedRuleSource', () => {
  it('resolves a root rule with or without the .md suffix', async () => {
    write('rules/gamma.md', 'g');
    expect(await resolveSharedRuleSource(path.join(tmp, 'rules'), 'gamma')).toEqual({
      source: path.join(tmp, 'rules', 'gamma.md'),
      namespacedOnly: [],
    });
    expect(await resolveSharedRuleSource(path.join(tmp, 'rules'), 'gamma.md')).toEqual({
      source: path.join(tmp, 'rules', 'gamma.md'),
      namespacedOnly: [],
    });
  });

  it('never resolves deep or namespaced copies; reports them as namespacedOnly', async () => {
    write('rules/ns/deep.md', 'd');
    expect(await resolveSharedRuleSource(path.join(tmp, 'rules'), 'deep')).toEqual({
      source: null,
      namespacedOnly: ['ns/deep.md'],
    });
    expect(await resolveSharedRuleSource(path.join(tmp, 'rules'), 'ns/deep')).toEqual({
      source: null,
      namespacedOnly: ['ns/deep.md'],
    });
  });

  it('returns empty when nothing matches', async () => {
    expect(await resolveSharedRuleSource(path.join(tmp, 'rules'), 'nope')).toEqual({
      source: null,
      namespacedOnly: [],
    });
  });
});

describe('listTypeEntries', () => {
  it('lists only shared-root entries for skills and rules', async () => {
    write('skills/alpha/SKILL.md', 'x');
    write('skills/ns/beta/SKILL.md', 'x');
    write('rules/gamma.md', 'g');
    write('rules/ns/delta.md', 'd');
    expect(await listTypeEntries(tmp, 'skills')).toEqual(['alpha']);
    expect(await listTypeEntries(tmp, 'rules')).toEqual(['gamma.md']);
  });

  it('returns empty for missing directories', async () => {
    expect(await listTypeEntries(tmp, 'skills')).toEqual([]);
    expect(await listTypeEntries(tmp, 'rules')).toEqual([]);
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

  it('scanLocalForPush publishes against .wiki/<projectId>/ and needs one', async () => {
    write('.wiki/changed.md', 'local-v2');
    write('.wiki/same.md', 'same');
    write('.wiki/new.md', 'n');
    write('repo/.wiki/proj/changed.md', 'local-v1');
    write('repo/.wiki/proj/same.md', 'same');
    const { localConfig, teamConfig } = makeConfigs();
    const handler = new WikiHandler();
    // Without a projectId the one-way publish has nowhere to land.
    expect(await handler.scanLocalForPush(teamConfig, localConfig)).toEqual([]);
    const items = await handler.scanLocalForPush(teamConfig, localConfig, { projectId: 'proj' });
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(['changed.md', 'new.md']);
    expect(items.find((i) => i.name === 'changed.md')?.status).toBe('modified');
    expect(items.find((i) => i.name === 'new.md')?.status).toBe('new');
    expect(items.find((i) => i.name === 'new.md')?.relativePath).toBe('.wiki/proj/new.md');
  });

  it('localWikiDir binds to the project in project scope', () => {
    const { localConfig } = makeConfigs();
    const handler = new WikiHandler();
    expect(handler.localWikiDir(localConfig)).toBe(path.join(tmp, '.wiki'));
  });
});
