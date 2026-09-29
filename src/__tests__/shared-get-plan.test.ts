import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fse from 'fs-extra';
import os from 'node:os';
import { planSharedGet, dirDigest, fileDigest } from '../get-cmd.js';

const S1 = '1111111111111111111111111111111111111111111111111111111111111111';
const S2 = '2222222222222222222222222222222222222222222222222222222222222222';
const S3 = '3333333333333333333333333333333333333333333333333333333333333333';

describe('planSharedGet', () => {
  it('installs when there is no record and no target', () => {
    expect(planSharedGet({ hasRecord: false, sourceSha: S1, targetSha: null }))
      .toEqual({ action: 'install' });
  });

  it('reports an unmanaged conflict when an untracked target already exists', () => {
    expect(planSharedGet({ hasRecord: false, sourceSha: S1, targetSha: S2 }))
      .toEqual({ action: 'conflict', reason: 'unmanaged' });
  });

  it('reinstalls when a tracked target disappeared locally', () => {
    expect(planSharedGet({
      hasRecord: true, sourceSha: S1, targetSha: null, baselineSourceSha: S1, baselineDeployedSha: S2,
    })).toEqual({ action: 'install' });
  });

  it('stays unchanged when source and target match their baselines', () => {
    expect(planSharedGet({
      hasRecord: true, sourceSha: S1, targetSha: S2, baselineSourceSha: S1, baselineDeployedSha: S2,
    })).toEqual({ action: 'unchanged' });
  });

  it('updates safely when the source moved and the target is still at the baseline', () => {
    expect(planSharedGet({
      hasRecord: true, sourceSha: S2, targetSha: S1, baselineSourceSha: S1, baselineDeployedSha: S1,
    })).toEqual({ action: 'update' });
  });

  it('reports local changes when only the target moved', () => {
    expect(planSharedGet({
      hasRecord: true, sourceSha: S1, targetSha: S3, baselineSourceSha: S1, baselineDeployedSha: S2,
    })).toEqual({ action: 'conflict', reason: 'local-changes' });
  });

  it('reports both-changed when source and target both moved apart', () => {
    expect(planSharedGet({
      hasRecord: true, sourceSha: S2, targetSha: S3, baselineSourceSha: S1, baselineDeployedSha: S1,
    })).toEqual({ action: 'conflict', reason: 'both-changed' });
  });
});

describe('digest helpers', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-digest-'));
  });
  afterEach(async () => {
    await fse.remove(tmp);
  });

  it('fileDigest hashes content', async () => {
    const file = path.join(tmp, 'a.md');
    await fse.writeFile(file, 'hello', 'utf-8');
    const first = await fileDigest(file);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    await fse.writeFile(file, 'world', 'utf-8');
    expect(await fileDigest(file)).not.toBe(first);
  });

  it('dirDigest distinguishes absent from empty and tracks content', async () => {
    const dir = path.join(tmp, 'skill');
    expect(await dirDigest(dir)).toBeNull();
    await fse.ensureDir(dir);
    const empty = await dirDigest(dir);
    expect(empty).toMatch(/^[0-9a-f]{64}$/);
    await fse.writeFile(path.join(dir, 'SKILL.md'), 'one', 'utf-8');
    const one = await dirDigest(dir);
    expect(one).not.toBe(empty);
    // Same content under a different file name is a different digest.
    await fse.remove(path.join(dir, 'SKILL.md'));
    await fse.writeFile(path.join(dir, 'OTHER.md'), 'one', 'utf-8');
    expect(await dirDigest(dir)).not.toBe(one);
  });
});
