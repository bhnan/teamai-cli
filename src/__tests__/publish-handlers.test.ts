import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fse from 'fs-extra';
import os from 'node:os';
import { DocsHandler } from '../resources/docs.js';
import { WikiHandler } from '../resources/wiki.js';
import type { LocalConfig } from '../types.js';

let tmp: string;

beforeEach(async () => {
  tmp = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-publish-'));
});

afterEach(async () => {
  await fse.remove(tmp);
});

function makeConfig(kind: 'project' | 'user' = 'project'): LocalConfig {
  return {
    repo: { localPath: path.join(tmp, 'team-repo'), remote: 'https://example.com/team/repo.git' },
    username: 'tester',
    scope: kind,
    ...(kind === 'project' ? { projectRoot: path.join(tmp, 'project') } : {}),
    additionalRoles: [],
  } as LocalConfig;
}

function write(rel: string, content: string, base = tmp): void {
  const target = path.join(base, rel);
  fse.mkdirSync(path.dirname(target), { recursive: true });
  fse.writeFileSync(target, content);
}

describe('DocsHandler one-way publish', () => {
  it('scans nothing without a projectId or outside project scope', async () => {
    const handler = new DocsHandler();
    write('project/docs/a.md', 'hello');
    expect(await handler.scanLocalForPush({} as never, makeConfig('project'))).toEqual([]);
    expect(await handler.scanLocalForPush({} as never, makeConfig('project'), { projectId: 'proj' }).then((r) => r))
      .toHaveLength(1);
    expect(await handler.scanLocalForPush({} as never, makeConfig('user'), { projectId: 'proj' })).toEqual([]);
  });

  it('reports new and modified files against docs/<projectId>/', async () => {
    const handler = new DocsHandler();
    write('project/docs/new.md', 'new');
    write('project/docs/same.md', 'same');
    write('project/docs/changed.md', 'changed-local');
    write('team-repo/docs/proj/same.md', 'same');
    write('team-repo/docs/proj/changed.md', 'changed-remote');

    const items = await handler.scanLocalForPush({} as never, makeConfig(), { projectId: 'proj' });
    const byName = new Map(items.map((i) => [i.name, i]));
    expect(byName.get('new.md')).toMatchObject({ status: 'new', relativePath: 'docs/proj/new.md' });
    expect(byName.get('changed.md')).toMatchObject({ status: 'modified' });
    expect(byName.has('same.md')).toBe(false);
  });

  it('keeps dotfiles project-local', async () => {
    const handler = new DocsHandler();
    write('project/docs/.draft.md', 'secret');
    const items = await handler.scanLocalForPush({} as never, makeConfig(), { projectId: 'proj' });
    expect(items).toEqual([]);
  });

  it('publishItem copies into docs/<projectId>/ and never writes the source', async () => {
    const handler = new DocsHandler();
    const source = path.join(tmp, 'project', 'docs', 'a.md');
    write('project/docs/a.md', 'original');
    await handler.pushItem(
      { name: 'a.md', type: 'docs', sourcePath: source, relativePath: 'docs/proj/a.md', status: 'new' },
      {} as never,
      makeConfig(),
    );
    expect(fse.readFileSync(path.join(tmp, 'team-repo', 'docs', 'proj', 'a.md'), 'utf-8')).toBe('original');
    expect(fse.readFileSync(source, 'utf-8')).toBe('original');
  });
});

describe('WikiHandler one-way publish', () => {
  it('publishes against .wiki/<projectId>/ with the project segment in the path', async () => {
    const handler = new WikiHandler();
    write('project/.wiki/featwiki/page.md', 'new page');
    write('team-repo/.wiki/proj/featwiki/page.md', 'old page');

    const items = await handler.scanLocalForPush({} as never, makeConfig(), { projectId: 'proj' });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'wiki',
      status: 'modified',
      relativePath: '.wiki/proj/featwiki/page.md',
    });

    await handler.pushItem(items[0]!, {} as never, makeConfig());
    expect(fse.readFileSync(path.join(tmp, 'team-repo', '.wiki', 'proj', 'featwiki', 'page.md'), 'utf-8'))
      .toBe('new page');
  });

  it('scans nothing without a projectId', async () => {
    const handler = new WikiHandler();
    write('project/.wiki/featwiki/page.md', 'new page');
    expect(await handler.scanLocalForPush({} as never, makeConfig())).toEqual([]);
  });
});
