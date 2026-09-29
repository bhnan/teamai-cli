import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fse from 'fs-extra';
import os from 'node:os';
import {
  PULL_RESOURCE_TYPES,
  PUSH_RESOURCE_TYPES,
  parseResourceTypes,
  resolveProjectScope,
  deriveSingleActiveProject,
  filterToolPathsForAgent,
  ScopeError,
} from '../sync-scope.js';
import { loadProjectsManifest } from '../projects.js';
import type { LocalConfig } from '../types.js';

vi.mock('../projects.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../projects.js')>()),
  loadProjectsManifest: vi.fn(),
}));

function makeConfig(overrides: Partial<LocalConfig> = {}): LocalConfig {
  return {
    repo: { localPath: '/tmp/team-repo', remote: 'https://example.com/team/repo.git' },
    username: 'tester',
    scope: 'project',
    projectRoot: '/tmp/project',
    additionalRoles: [],
    ...overrides,
  } as LocalConfig;
}

function manifestOf(...ids: string[]) {
  return {
    version: 1,
    projects: ids.map((id) => ({
      id,
      name: id,
      description: '',
      resources: { knowledge: [], skills: [], learnings: [], agents: [] },
    })),
  };
}

describe('parseResourceTypes', () => {
  it('defaults to the full allowed list', () => {
    expect(parseResourceTypes(undefined, PULL_RESOURCE_TYPES)).toEqual(['skills', 'rules', 'env', 'agents']);
    expect(parseResourceTypes(undefined, PUSH_RESOURCE_TYPES)).toEqual([
      'skills', 'rules', 'docs', 'env', 'agents', 'wiki',
    ]);
  });

  it('parses and dedupes a comma-separated list', () => {
    expect(parseResourceTypes('skills, env ,skills', PULL_RESOURCE_TYPES)).toEqual(['skills', 'env']);
  });

  it('rejects unknown types', () => {
    expect(() => parseResourceTypes('skills,bogus', PULL_RESOURCE_TYPES)).toThrow(ScopeError);
  });

  it('rejects an empty list', () => {
    expect(() => parseResourceTypes(' ,', PULL_RESOURCE_TYPES)).toThrow(ScopeError);
  });

  it('rejects docs and wiki for pull with the one-way message, not a hidden mirror', () => {
    for (const type of ['docs', 'wiki']) {
      try {
        parseResourceTypes(type, PULL_RESOURCE_TYPES);
        expect.unreachable(`${type} should be rejected`);
      } catch (e) {
        expect(e).toBeInstanceOf(ScopeError);
        expect((e as Error).message).toContain('not managed by pull');
      }
    }
  });

  it('accepts docs and wiki for push', () => {
    expect(parseResourceTypes('docs,wiki', PUSH_RESOURCE_TYPES)).toEqual(['docs', 'wiki']);
  });
});

describe('resolveProjectScope', () => {
  beforeEach(() => {
    vi.mocked(loadProjectsManifest).mockReset();
  });

  it('refuses a user-scope config instead of falling back to global resources', async () => {
    await expect(resolveProjectScope(makeConfig({ scope: 'user', projectRoot: undefined }), 'p1'))
      .rejects.toThrow(/initialized project scope/);
  });

  it('rejects a --project id the manifest does not declare', async () => {
    vi.mocked(loadProjectsManifest).mockResolvedValue(manifestOf('alpha') as never);
    await expect(resolveProjectScope(makeConfig({ projects: ['alpha'] }), 'beta'))
      .rejects.toThrow(/not declared in manifest\/projects\.yaml/);
  });

  it('rejects a declared project that is not active in this directory', async () => {
    vi.mocked(loadProjectsManifest).mockResolvedValue(manifestOf('alpha', 'beta') as never);
    await expect(resolveProjectScope(makeConfig({ projects: ['alpha'] }), 'beta'))
      .rejects.toThrow(/not active in this directory/);
  });

  it('derives the single active project without a flag', async () => {
    vi.mocked(loadProjectsManifest).mockResolvedValue(manifestOf('alpha') as never);
    const resolved = await resolveProjectScope(makeConfig({ projects: ['alpha'] }), undefined);
    expect(resolved.projectId).toBe('alpha');
    expect(resolved.derived).toBe(true);
  });

  it('errors with candidates when several projects are active and none was named', async () => {
    vi.mocked(loadProjectsManifest).mockResolvedValue(manifestOf('alpha', 'beta') as never);
    await expect(resolveProjectScope(makeConfig({ projects: ['alpha', 'beta'] }), undefined))
      .rejects.toThrow(/Multiple projects are active here \(alpha, beta\)/);
  });

  it('errors when no project is active', async () => {
    vi.mocked(loadProjectsManifest).mockResolvedValue(manifestOf('alpha') as never);
    await expect(resolveProjectScope(makeConfig({ projects: [] }), undefined))
      .rejects.toThrow(/No active project/);
  });
});

describe('deriveSingleActiveProject', () => {
  beforeEach(() => {
    vi.mocked(loadProjectsManifest).mockReset();
  });

  it('derives the one active project that is declared', async () => {
    vi.mocked(loadProjectsManifest).mockResolvedValue(manifestOf('alpha', 'beta') as never);
    const derived = await deriveSingleActiveProject(makeConfig({ projects: ['beta'] }));
    expect(derived.projectId).toBe('beta');
    expect(derived.ambiguous).toBeUndefined();
  });

  it('returns null without ambiguity for a team without project partitioning', async () => {
    vi.mocked(loadProjectsManifest).mockResolvedValue(manifestOf() as never);
    const derived = await deriveSingleActiveProject(makeConfig({ projects: [] }));
    expect(derived.projectId).toBeNull();
    expect(derived.ambiguous).toBeUndefined();
  });

  it('names the candidates when several are active', async () => {
    vi.mocked(loadProjectsManifest).mockResolvedValue(manifestOf('alpha', 'beta') as never);
    const derived = await deriveSingleActiveProject(makeConfig({ projects: ['alpha', 'beta'] }));
    expect(derived.projectId).toBeNull();
    expect(derived.ambiguous).toEqual(['alpha', 'beta']);
  });

  it('ignores active ids the manifest does not declare', async () => {
    vi.mocked(loadProjectsManifest).mockResolvedValue(manifestOf('alpha') as never);
    const derived = await deriveSingleActiveProject(makeConfig({ projects: ['ghost'] }));
    expect(derived.projectId).toBeNull();
  });
});

describe('filterToolPathsForAgent', () => {
  const teamConfig = {
    repo: 'r',
    toolPaths: {
      claude: { skills: '.claude/skills', rules: '.claude/rules' },
      codex: { skills: '.codex/skills', rules: '.codex/rules' },
    },
  } as never;

  it('returns every tool path without an agent', () => {
    const all = filterToolPathsForAgent(teamConfig, makeConfig(), undefined);
    expect(Object.keys(all).sort()).toEqual(['claude', 'codex']);
  });

  it('narrows to the named agent, case-insensitively', () => {
    const one = filterToolPathsForAgent(teamConfig, makeConfig(), 'Claude');
    expect(Object.keys(one)).toEqual(['claude']);
  });

  it('fails on an unknown agent before any write', () => {
    expect(() => filterToolPathsForAgent(teamConfig, makeConfig(), 'cursor')).toThrow(ScopeError);
  });
});

describe('publish helpers on disk', () => {
  let tmp: string;
  beforeEach(async () => {
    tmp = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-sync-scope-'));
  });
  afterEach(async () => {
    await fse.remove(tmp);
  });

  it('resolveProjectScope rejects a manifest that cannot be parsed', async () => {
    vi.mocked(loadProjectsManifest).mockRejectedValue(new Error('Invalid projects manifest: boom'));
    await expect(resolveProjectScope(makeConfig({ projects: ['alpha'] }), 'alpha'))
      .rejects.toThrow(/Cannot resolve|Invalid projects manifest/);
  });
});
