import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fse from 'fs-extra';
import { WikiHandler } from '../resources/wiki.js';
import { LocalConfigSchema, TeamaiConfigSchema, type LocalConfig, type TeamaiConfig } from '../types.js';

function writeProjectManifest(repoPath: string, ids: string[]): Promise<void> {
  return fse.outputFile(
    path.join(repoPath, 'manifest', 'projects.yaml'),
    `version: 1\nprojects:\n${ids.map((id) => `  - id: ${id}\n    name: ${id}\n    resources:\n      knowledge: [${id}]\n      skills: [${id}]\n      learnings: [${id}]\n`).join('')}`,
  );
}

describe('WikiHandler project namespaces (003)', () => {
  const handler = new WikiHandler();
  let tmpDir: string;
  let repoDir: string;
  let wikiDir: string;
  let localConfig: LocalConfig;
  let teamConfig: TeamaiConfig;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-wiki-ns-'));
    vi.stubEnv('HOME', tmpDir);
    repoDir = path.join(tmpDir, 'repo');
    wikiDir = path.join(repoDir, '.wiki');
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/wiki-ns-test' },
      username: 'test', scope: 'user',
    });
    teamConfig = TeamaiConfigSchema.parse({ team: 'test', repo: 'local/wiki-ns-test', provider: 'git' });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fse.remove(tmpDir);
  });

  it('no manifest: single shared bundle', async () => {
    await fse.outputFile(path.join(wikiDir, 'Home.md'), '# home\n');
    await fse.outputFile(path.join(wikiDir, 'arch', 'a.md'), '# a\n');
    const items = await handler.scanTeamForPull(teamConfig, localConfig);
    expect(items).toHaveLength(1);
    expect(items[0].namespace).toBeUndefined();
  });

  it('manifest + active: shared bundle excludes project wikis, per-project bundles appear', async () => {
    await writeProjectManifest(repoDir, ['alpha']);
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/wiki-ns-test' },
      username: 'test', scope: 'user', projects: ['alpha'],
    });
    // Shared wiki collections.
    await fse.outputFile(path.join(wikiDir, 'team', 'Home.md'), '# team\n');
    await fse.outputFile(path.join(wikiDir, 'team', 'arch', 'a.md'), '# a\n');
    // Project-private wikis (a project owns MULTIPLE wikis).
    await fse.outputFile(path.join(wikiDir, 'alpha', 'tech', 't.md'), '# t\n');
    await fse.outputFile(path.join(wikiDir, 'alpha', 'product', 'p.md'), '# p\n');

    const items = await handler.scanTeamForPull(teamConfig, localConfig);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(['wiki', 'wiki/alpha']);
    expect(items.find((i) => i.namespace === 'alpha')?.sourcePath).toBe(path.join(wikiDir, 'alpha'));
  });

  it('shared bundle pull excludes project wiki dirs; project bundle mirror includes multiple wikis', async () => {
    await writeProjectManifest(repoDir, ['alpha', 'beta']);
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/wiki-ns-test' },
      username: 'test', scope: 'user', projects: ['alpha'],
    });
    await fse.outputFile(path.join(wikiDir, 'team', 'Home.md'), '# team\n');
    await fse.outputFile(path.join(wikiDir, 'alpha', 'tech', 't.md'), '# t\n');
    await fse.outputFile(path.join(wikiDir, 'alpha', 'product', 'p.md'), '# p\n');
    await fse.outputFile(path.join(wikiDir, 'beta', 'b.md'), '# b\n');

    const items = await handler.scanTeamForPull(teamConfig, localConfig);
    expect(items.map((i) => i.name).sort()).toEqual(['wiki', 'wiki/alpha']);
    for (const item of items) {
      await handler.pullItem(item, teamConfig, localConfig);
    }

    const localWiki = path.join(tmpDir, '.wiki');
    expect(await fse.pathExists(path.join(localWiki, 'team', 'Home.md'))).toBe(true);
    // Project alpha's two wikis both landed.
    expect(await fse.pathExists(path.join(localWiki, 'alpha', 'tech', 't.md'))).toBe(true);
    expect(await fse.pathExists(path.join(localWiki, 'alpha', 'product', 'p.md'))).toBe(true);
    // Inactive project beta must not be mirrored.
    expect(await fse.pathExists(path.join(localWiki, 'beta'))).toBe(false);
  });

  it('scanLocalForPush skips pages under inactive project namespaces', async () => {
    await writeProjectManifest(repoDir, ['alpha', 'beta']);
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/wiki-ns-test' },
      username: 'test', scope: 'user', projects: ['alpha'],
    });
    await fse.ensureDir(path.join(repoDir, '.wiki'));
    const localWiki = path.join(tmpDir, '.wiki');
    await fse.outputFile(path.join(localWiki, 'team', 'Home.md'), 'local home\n');
    await fse.outputFile(path.join(localWiki, 'alpha', 'tech', 't.md'), 'local t\n');
    await fse.outputFile(path.join(localWiki, 'beta', 'b.md'), 'local b\n');

    const items = await handler.scanLocalForPush(teamConfig, localConfig);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(['alpha/tech/t.md', 'team/Home.md']);
  });

  it('cleanupInactiveNamespaces removes matching inactive project dirs, keeps modified ones', async () => {
    await writeProjectManifest(repoDir, ['alpha', 'beta']);
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/wiki-ns-test' },
      username: 'test', scope: 'user', projects: [],
    });
    await fse.outputFile(path.join(wikiDir, 'alpha', 'tech', 't.md'), '# t\n');
    await fse.outputFile(path.join(tmpDir, '.wiki', 'alpha', 'tech', 't.md'), '# t\n');
    await fse.outputFile(path.join(wikiDir, 'beta', 'b.md'), '# repo b\n');
    await fse.outputFile(path.join(tmpDir, '.wiki', 'beta', 'b.md'), '# LOCAL-EDITED\n');

    const removed = await handler.cleanupInactiveNamespaces(localConfig);
    expect(removed).toEqual(['alpha']);
    expect(await fse.pathExists(path.join(tmpDir, '.wiki', 'alpha'))).toBe(false);
    expect(await fse.pathExists(path.join(tmpDir, '.wiki', 'beta', 'b.md'))).toBe(true);
  });
});