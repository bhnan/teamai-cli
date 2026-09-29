import { describe, expect, it } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { putRelativePath, resolvePutSourcePath } from '../put-cmd.js';

describe('resolvePutSourcePath', () => {
  it('expands ~ to the home directory', () => {
    expect(resolvePutSourcePath('~/skills/my-skill')).toBe(
      path.join(os.homedir(), 'skills/my-skill'),
    );
    expect(resolvePutSourcePath('~')).toBe(os.homedir());
  });

  it('resolves relative paths against cwd and keeps absolute ones', () => {
    expect(resolvePutSourcePath('my-skill')).toBe(path.resolve('my-skill'));
    expect(resolvePutSourcePath('/abs/skill')).toBe(path.resolve('/abs/skill'));
  });
});

describe('putRelativePath', () => {
  it('targets the shared root by default', () => {
    expect(putRelativePath('skills', 'deploy')).toBe('skills/deploy');
    expect(putRelativePath('rules', 'style')).toBe('rules/style.md');
  });

  it('targets a namespace directory with --namespace', () => {
    expect(putRelativePath('skills', 'deploy', 'backend')).toBe('skills/backend/deploy');
    expect(putRelativePath('rules', 'style', 'backend')).toBe('rules/backend/style.md');
  });
});
