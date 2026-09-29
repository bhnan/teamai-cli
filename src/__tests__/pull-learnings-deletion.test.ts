import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fse from 'fs-extra';

const testRoot = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-pull-learnings-delete-'));
const originalHome = process.env.HOME;
process.env.HOME = path.join(testRoot, 'home');

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  requireInit: vi.fn(),
  loadState: vi.fn().mockResolvedValue({ lastPull: null, lastPullRev: null }),
  saveState: vi.fn(),
  loadLocalConfigForScope: vi.fn(),
  loadTeamConfig: vi.fn(),
  detectProjectConfig: vi.fn().mockResolvedValue(null),
  loadStateForScope: vi.fn().mockResolvedValue({ lastPull: null, lastPullRev: null }),
  saveStateForScope: vi.fn(),
}));

vi.mock('../utils/git.js', () => ({
  pullRepo: vi.fn().mockResolvedValue('already up to date'),
  getHeadRev: vi.fn().mockResolvedValue('abc1234'),
  // No learnings checkout exists, so the index's ownership probe passes (#808).
  isGitRepo: vi.fn().mockResolvedValue(false),
}));

vi.mock('../utils/logger.js', () => ({
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), dim: vi.fn(), persist: vi.fn() },
  spinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('../source.js', () => ({ pullSources: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../hooks.js', () => ({
  injectHooksToAllTools: vi.fn().mockResolvedValue(undefined),
  reconcileTeamHooksForConfig: vi.fn().mockResolvedValue({ ok: true, defs: [] }),
}));
vi.mock('../mcp-reconcile.js', () => ({
  reconcileMcpForConfig: vi.fn().mockResolvedValue({ changes: [], wrote: false }),
}));
vi.mock('../team-push.js', () => ({ reportUsageToTeam: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../usage-tracker.js', () => ({
  readUsageEvents: vi.fn().mockResolvedValue([]),
  truncateUsageAfterReport: vi.fn().mockResolvedValue(undefined),
  capUsageEvents: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../roles.js', () => ({
  loadRolesManifest: vi.fn().mockResolvedValue({
    version: 1,
    roles: [],
    defaults: { shareTarget: 'primary-role' },
  }),
  resolveRoleResourceNamespaces: vi.fn(() => ({ knowledge: [], skills: [], learnings: [] })),
}));
vi.mock('../update.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

const { pull } = await import('../pull.js');
const { detectProjectConfig, loadTeamConfig } = await import('../config.js');
const { getUserSearchIndexPath, getProjectSearchIndexPath } = await import('../types.js');
const { loadIndex } = await import('../utils/search-index.js');
import type { LocalConfig, TeamaiConfig } from '../types.js';

const repoPath = path.join(testRoot, 'team-repo');
const projectRoot = path.join(testRoot, 'project');
const localConfig: LocalConfig = {
  repo: { localPath: repoPath, remote: 'https://example.test/team/repo.git' },
  username: 'alice',
  updatePolicy: 'auto',
  additionalRoles: [],
  scope: 'project',
  projectRoot,
};
const teamConfig: TeamaiConfig = {
  team: 'test',
  description: '',
  repo: 'https://example.test/team/repo.git',
  provider: 'git',
  reviewers: [],
  sharing: {
    skills: {},
    rules: { enforced: [] },
    docs: { localDir: '' },
    env: { injectShellProfile: false },
  },
  toolPaths: {},
};

describe('pull — learning deletion propagation through the project index (issue #458)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await fse.remove(repoPath);
    await fse.remove(projectRoot);
    await fse.remove(getUserSearchIndexPath());
    await fse.outputFile(path.join(repoPath, 'learnings', 'shared-a.md'), '---\ntitle: shared a\n---\n');
    await fse.outputFile(path.join(repoPath, 'learnings', 'shared-b.md'), '---\ntitle: shared b\n---\n');
    vi.mocked(detectProjectConfig).mockResolvedValue(localConfig);
    vi.mocked(loadTeamConfig).mockResolvedValue(teamConfig);
  });

  afterAll(async () => {
    process.env.HOME = originalHome;
    await fse.remove(testRoot);
  });

  it('drops an upstream-deleted learning from the project search index (007)', async () => {
    // 007: pull is project-scoped and indexes learnings straight from the
    // repo, so an upstream deletion leaves the index on the next pull.
    await pull({ silent: true });
    let index = await loadIndex(getProjectSearchIndexPath(localConfig));
    expect(index?.entries.map((entry) => entry.title).sort()).toEqual(['shared a', 'shared b']);

    await fse.remove(path.join(repoPath, 'learnings', 'shared-b.md'));
    await pull({ silent: true, force: true });

    index = await loadIndex(getProjectSearchIndexPath(localConfig));
    expect(index?.entries.map((entry) => entry.title)).toEqual(['shared a']);
  });
});
