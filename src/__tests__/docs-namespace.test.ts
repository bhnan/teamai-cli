import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fse from 'fs-extra';
import { DocsHandler } from '../resources/docs.js';
import { LocalConfigSchema, TeamaiConfigSchema, type LocalConfig, type TeamaiConfig } from '../types.js';

function writeProjectManifest(repoPath: string, ids: string[]): Promise<void> {
  return fse.outputFile(
    path.join(repoPath, 'manifest', 'projects.yaml'),
    `version: 1\nprojects:\n${ids.map((id) => `  - id: ${id}\n    name: ${id}\n    resources:\n      knowledge: [${id}]\n      skills: [${id}]\n      learnings: [${id}]\n`).join('')}`,
  );
}

describe('DocsHandler project namespaces (003)', () => {
  const handler = new DocsHandler();
  let tmpDir: string;
  let repoDir: string;
  let docsDir: string;
  let localConfig: LocalConfig;
  let teamConfig: TeamaiConfig;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-docs-ns-'));
    vi.stubEnv('HOME', tmpDir);
    repoDir = path.join(tmpDir, 'repo');
    docsDir = path.join(repoDir, 'docs');
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/docs-ns-test' },
      username: 'test', scope: 'user',
    });
    teamConfig = TeamaiConfigSchema.parse({ team: 'test', repo: 'local/docs-ns-test', provider: 'git' });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await fse.remove(tmpDir);
  });

  it('no manifest: single shared bundle, unchanged behavior', async () => {
    await fse.outputFile(path.join(docsDir, 'shared.md'), 'shared\n');
    await fse.outputFile(path.join(docsDir, 'sub', 'nested.md'), 'nested\n');
    const items = await handler.scanTeamForPull(teamConfig, localConfig);
    expect(items).toHaveLength(1);
    expect(items[0].namespace).toBeUndefined();
    expect(await handler.countBundleFiles(items[0], localConfig)).toBe(2);
  });

  it('manifest + active projects: shared bundle excludes project dirs, project bundles appear', async () => {
    await writeProjectManifest(repoDir, ['alpha', 'beta']);
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/docs-ns-test' },
      username: 'test', scope: 'user', projects: ['alpha'],
    });
    await fse.outputFile(path.join(docsDir, 'shared.md'), 'shared\n');
    await fse.outputFile(path.join(docsDir, 'alpha', 'a.md'), 'a\n');
    await fse.outputFile(path.join(docsDir, 'alpha', 'deep', 'a2.md'), 'a2\n');
    await fse.outputFile(path.join(docsDir, 'beta', 'b.md'), 'b\n');

    const items = await handler.scanTeamForPull(teamConfig, localConfig);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(['docs', 'docs/alpha']);
    expect(items.find((i) => i.namespace === 'alpha')?.sourcePath).toBe(path.join(docsDir, 'alpha'));
    // Shared bundle count excludes project dirs; project bundle counts its files.
    const shared = items.find((i) => i.namespace === undefined)!;
    const alpha = items.find((i) => i.namespace === 'alpha')!;
    expect(await handler.countBundleFiles(shared, localConfig)).toBe(1);
    expect(await handler.countBundleFiles(alpha, localConfig)).toBe(2);
  });

  it('pull of shared bundle does not install project namespace dirs', async () => {
    await writeProjectManifest(repoDir, ['alpha']);
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/docs-ns-test' },
      username: 'test', scope: 'user', projects: [],
    });
    await fse.outputFile(path.join(docsDir, 'shared.md'), 'shared\n');
    await fse.outputFile(path.join(docsDir, 'alpha', 'a.md'), 'a\n');

    const items = await handler.scanTeamForPull(teamConfig, localConfig);
    expect(items).toHaveLength(1); // only shared (alpha NOT active)
    await handler.pullItem(items[0], teamConfig, localConfig);

    expect(await fse.pathExists(path.join(tmpDir, 'docs', 'shared.md'))).toBe(true);
    // alpha is a defined project namespace but not active → must NOT be installed.
    expect(await fse.pathExists(path.join(tmpDir, 'docs', 'alpha'))).toBe(false);
  });

  it('pull of a project bundle installs only that project namespace', async () => {
    await writeProjectManifest(repoDir, ['alpha', 'beta']);
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/docs-ns-test' },
      username: 'test', scope: 'user', projects: ['alpha'],
    });
    await fse.outputFile(path.join(docsDir, 'shared.md'), 'shared\n');
    await fse.outputFile(path.join(docsDir, 'alpha', 'a.md'), 'a\n');
    await fse.outputFile(path.join(docsDir, 'beta', 'b.md'), 'b\n');

    const items = await handler.scanTeamForPull(teamConfig, localConfig);
    for (const item of items) {
      await handler.pullItem(item, teamConfig, localConfig);
    }

    expect(await fse.pathExists(path.join(tmpDir, 'docs', 'shared.md'))).toBe(true);
    expect(await fse.readFile(path.join(tmpDir, 'docs', 'alpha', 'a.md'), 'utf8')).toBe('a\n');
    expect(await fse.pathExists(path.join(tmpDir, 'docs', 'beta'))).toBe(false);
  });

  it('scanLocalForPush skips local files under inactive project namespaces', async () => {
    await writeProjectManifest(repoDir, ['alpha', 'beta']);
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/docs-ns-test' },
      username: 'test', scope: 'user', projects: ['alpha'],
    });
    await fse.ensureDir(path.join(repoDir, 'docs'));
    const localDocs = path.join(tmpDir, 'docs');
    await fse.outputFile(path.join(localDocs, 'shared.md'), 'local shared\n');
    await fse.outputFile(path.join(localDocs, 'alpha', 'a.md'), 'local a\n');
    await fse.outputFile(path.join(localDocs, 'beta', 'b.md'), 'local b\n');

    const items = await handler.scanLocalForPush(teamConfig, localConfig);
    const names = items.map((i) => i.name).sort();
    expect(names).toEqual(['alpha/a.md', 'shared.md']);
  });

  it('cleanupInactiveNamespaces removes matching inactive project dirs, keeps modified ones', async () => {
    await writeProjectManifest(repoDir, ['alpha']);
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/docs-ns-test' },
      username: 'test', scope: 'user', projects: [],
    });
    // Repo copy + identical local copy (was synced while active, now deactivated).
    await fse.outputFile(path.join(docsDir, 'alpha', 'a.md'), 'a\n');
    await fse.outputFile(path.join(tmpDir, 'docs', 'alpha', 'a.md'), 'a\n');
    // Modified local copy of the same namespace → must be kept.
    await fse.outputFile(path.join(tmpDir, 'docs', 'modified', 'm.md'), 'm\n');
    await writeProjectManifest(repoDir, ['alpha', 'modified']);
    await fse.outputFile(path.join(docsDir, 'modified', 'm.md'), 'DIFFERENT\n');

    const removed = await handler.cleanupInactiveNamespaces(teamConfig, localConfig);
    expect(removed).toEqual(['alpha']);
    expect(await fse.pathExists(path.join(tmpDir, 'docs', 'alpha'))).toBe(false);
    // Modified copy kept, with a warning.
    expect(await fse.pathExists(path.join(tmpDir, 'docs', 'modified', 'm.md'))).toBe(true);
  });

  it('cleanup dryRun reports candidates without removing', async () => {
    await writeProjectManifest(repoDir, ['alpha']);
    localConfig = LocalConfigSchema.parse({
      repo: { localPath: repoDir, remote: 'local/docs-ns-test' },
      username: 'test', scope: 'user', projects: [],
    });
    await fse.outputFile(path.join(docsDir, 'alpha', 'a.md'), 'a\n');
    await fse.outputFile(path.join(tmpDir, 'docs', 'alpha', 'a.md'), 'a\n');

    const dry = await handler.cleanupInactiveNamespaces(teamConfig, localConfig, true);
    expect(dry).toEqual(['alpha']);
    expect(await fse.pathExists(path.join(tmpDir, 'docs', 'alpha', 'a.md'))).toBe(true);
  });
});