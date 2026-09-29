import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fse from 'fs-extra';

// 007: `pull` is a project-scope-only, four-type resource sync. A directory
// without a project config fails with migration guidance (exit code 2) and
// syncs nothing — the user scope is never loaded, inherited or otherwise. A
// project directory syncs exactly that project scope; user-global resource
// directories are never written, and the coordination passes an older pull
// bundled in (hooks/MCP reconcile, usage reporting) no longer run from pull.

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
}));

vi.mock('../utils/logger.js', () => ({
  log: {
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    dim: vi.fn(),
    persist: vi.fn(),
  },
  spinner: vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  })),
}));

// Stub the cross-team source pull so we can assert which scope it runs against
// without doing any real git work.
vi.mock('../source.js', () => ({
  pullSources: vi.fn().mockResolvedValue(undefined),
}));

// These passes were removed from pull (007): `teamai hooks` / `teamai mcp` own
// them now. The mocks stay so a regression that wires them back into pull is
// caught by the "not called" assertions below.
vi.mock('../hooks.js', () => ({
  injectHooksToAllTools: vi.fn().mockResolvedValue(undefined),
  reconcileTeamHooksForConfig: vi.fn().mockResolvedValue({ ok: true, defs: [] }),
}));

vi.mock('../mcp-reconcile.js', () => ({
  reconcileMcpForConfig: vi.fn().mockResolvedValue({ changes: [], wrote: false }),
}));

vi.mock('../team-push.js', () => ({
  reportUsageToTeam: vi.fn().mockResolvedValue(true),
}));

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

// Isolation: pull() takes a real ~/.teamai/.sync-lock. Parallel vitest workers
// sharing that path race and skip/error, so these tests mock the lock.
vi.mock('../update.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

// The post-pull doctor checks are exercised in pull-post-checks.test.ts; keep
// them out of the way so a scope message under test is the only thing printed.
vi.mock('../doctor.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../doctor.js')>(),
  resolveDoctorContext: vi.fn(),
  buildChecks: vi.fn(),
}));

import { pull } from '../pull.js';
import {
  loadLocalConfigForScope,
  loadTeamConfig,
  detectProjectConfig,
  loadStateForScope,
  saveStateForScope,
} from '../config.js';
import { getHeadRev } from '../utils/git.js';
import { pullSources } from '../source.js';
import { log } from '../utils/logger.js';
import { reconcileTeamHooksForConfig } from '../hooks.js';
import { reconcileMcpForConfig } from '../mcp-reconcile.js';
import { reportUsageToTeam } from '../team-push.js';
import { capUsageEvents, truncateUsageAfterReport } from '../usage-tracker.js';
import { releaseLock } from '../update.js';
import { SYNC_LOCK_FILENAME, type TeamaiConfig, type LocalConfig } from '../types.js';

const NO_PROJECT_MSG = 'teamai pull runs in a project scope, but this directory has none.';

describe('pull scope isolation (007: project scope only)', () => {
  let tmpDir: string;
  let homeDir: string;
  let userRepoPath: string;
  let projectRoot: string;
  let projectRepoPath: string;
  let teamConfig: TeamaiConfig;
  let userConfig: LocalConfig;
  let projectConfig: LocalConfig;

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-scope-iso-'));
    homeDir = path.join(tmpDir, 'home');
    userRepoPath = path.join(tmpDir, 'user-repo');
    projectRoot = path.join(tmpDir, 'proj');
    projectRepoPath = path.join(projectRoot, '.teamai', 'team-repo');

    for (const repo of [userRepoPath, projectRepoPath]) {
      await fse.ensureDir(path.join(repo, 'skills'));
      await fse.ensureDir(path.join(repo, 'rules'));
    }
    // A user-scope repo whose resources the OLD inherited pull deployed into
    // the user-global directories. The new pull must never touch them.
    await fse.ensureDir(path.join(userRepoPath, 'skills', 'org-safe-review'));
    await fse.writeFile(
      path.join(userRepoPath, 'skills', 'org-safe-review', 'SKILL.md'),
      '---\nname: org-safe-review\ndescription: safe review workflow\n---\n',
    );
    await fse.ensureDir(path.join(userRepoPath, 'env'));
    await fse.writeFile(
      path.join(userRepoPath, 'env', 'env.yaml'),
      'variables:\n  - key: USER_SECRET\n    value: must-not-inherit\n',
    );
    await fse.ensureDir(path.join(homeDir, '.claude', 'skills'));
    await fse.ensureDir(path.join(projectRoot, '.claude', 'skills'));

    vi.stubEnv('HOME', homeDir);

    teamConfig = {
      team: 'test',
      description: '',
      repo: 'https://git.woa.com/test/repo.git',
      provider: 'tgit' as const,
      reviewers: [],
      sharing: {
        skills: {},
        rules: { enforced: [] },
        docs: { localDir: '' },
        env: { injectShellProfile: true },
      },
      toolPaths: {
        claude: { skills: '.claude/skills', rules: '.claude/rules' },
      },
    };

    userConfig = {
      repo: { localPath: userRepoPath, remote: 'https://git.woa.com/test/repo.git' },
      username: 'userscope',
      updatePolicy: 'auto',
      additionalRoles: [],
      scope: 'user',
    };

    projectConfig = {
      repo: { localPath: projectRepoPath, remote: 'https://git.woa.com/test/proj.git' },
      username: 'projscope',
      updatePolicy: 'auto',
      additionalRoles: [],
      scope: 'project',
      projectRoot,
    };

    vi.mocked(loadTeamConfig).mockResolvedValue(teamConfig);
    vi.mocked(getHeadRev).mockResolvedValue('abc1234');
    vi.mocked(loadStateForScope).mockImplementation(async (localConfig) => ({
      lastPull: localConfig.scope === 'project' ? '2026-04-01' : null,
      lastPullRev: localConfig.scope === 'project' ? 'abc1234' : null,
      lastPush: null,
      pushedRules: [],
      pushedSkills: [],
      pushedEnvVars: [],
      pendingPushes: [],
      lastUpdateCheck: null,
      availableUpdate: null,
    }));
    vi.mocked(detectProjectConfig).mockResolvedValue(null);
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    process.exitCode = 0;
    await fse.remove(tmpDir);
  });

  /** Nothing anywhere may be synced: no user load, no state, no source pull. */
  async function expectNothingSynced(): Promise<void> {
    expect(loadLocalConfigForScope).not.toHaveBeenCalled();
    expect(pullSources).not.toHaveBeenCalled();
    expect(loadStateForScope).not.toHaveBeenCalled();
    expect(saveStateForScope).not.toHaveBeenCalled();
    // The user repo's resources never reach the user-global directories.
    expect(await fse.readdir(path.join(homeDir, '.claude', 'skills'))).toEqual([]);
    expect(await fse.pathExists(path.join(homeDir, '.teamai', 'env.sh'))).toBe(false);
  }

  it('no project config: fails with guidance and exit code 2 without syncing anything', async () => {
    vi.mocked(detectProjectConfig).mockResolvedValue(null);

    await pull({});

    expect(process.exitCode).toBe(2);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining(NO_PROJECT_MSG));
    await expectNothingSynced();
  });

  it('no project config: a silent run persists the guidance instead of printing it', async () => {
    vi.mocked(detectProjectConfig).mockResolvedValue(null);

    await pull({ silent: true });

    expect(process.exitCode).toBe(2);
    expect(log.persist).toHaveBeenCalledWith(expect.stringContaining(NO_PROJECT_MSG));
    expect(log.error).not.toHaveBeenCalled();
    await expectNothingSynced();
  });

  it('unreadable project config: stops before anything is synced (#784)', async () => {
    vi.mocked(detectProjectConfig).mockImplementation(async (_cwd, onUnreadable) => {
      onUnreadable?.(path.join(projectRoot, '.teamai', 'config.yaml'), 'Not enough permissions');
      return null;
    });

    await pull({});

    expect(process.exitCode).toBe(1);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Nothing was synced'));
    await expectNothingSynced();
  });

  it('project directory: syncs only the project scope and never loads the user scope', async () => {
    vi.mocked(detectProjectConfig).mockResolvedValue(projectConfig);

    await pull({ silent: true });

    // The user scope is never loaded — not even to decide whether to skip it.
    expect(loadLocalConfigForScope).not.toHaveBeenCalled();
    // The project scope was really synced and recorded.
    expect(loadStateForScope).toHaveBeenCalledWith(expect.objectContaining({ scope: 'project', projectRoot }));
    expect(saveStateForScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: 'project', projectRoot }),
    );
    // Source pull still runs, against the project config.
    expect(pullSources).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pullSources).mock.calls[0][0]).toMatchObject({
      scope: 'project',
      projectRoot,
    });
    // The partition sync-lock was taken and released for the project scope.
    expect(
      vi.mocked(releaseLock).mock.calls.some(
        ([lock]) => typeof lock === 'string' && path.basename(lock) === SYNC_LOCK_FILENAME,
      ),
    ).toBe(true);
    // User-global resource directories are untouched by a project pull.
    expect(await fse.readdir(path.join(homeDir, '.claude', 'skills'))).toEqual([]);
    expect(await fse.pathExists(path.join(homeDir, '.teamai', 'env.sh'))).toBe(false);
    expect(await fse.pathExists(path.join(homeDir, '.teamai', 'learnings'))).toBe(false);
  });

  it('inheritUserScope is ignored: a project pull never inherits user resources', async () => {
    projectConfig.inheritUserScope = true;
    vi.mocked(detectProjectConfig).mockResolvedValue(projectConfig);
    // Resolve to a live user config so any accidental load would deploy it.
    vi.mocked(loadLocalConfigForScope).mockResolvedValue(userConfig);

    await pull({ silent: true });

    expect(loadLocalConfigForScope).not.toHaveBeenCalled();
    expect(loadStateForScope).not.toHaveBeenCalledWith(expect.objectContaining({ scope: 'user' }));
    expect(saveStateForScope).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ scope: 'user' }),
    );
    expect(log.info).not.toHaveBeenCalledWith('project scope detected, inheriting user-scope resources and knowledge');
    // The user repo's skill/env stay out of the user-global directories.
    expect(await fse.pathExists(path.join(homeDir, '.claude', 'skills', 'org-safe-review'))).toBe(false);
    expect(await fse.pathExists(path.join(homeDir, '.teamai', 'env.sh'))).toBe(false);
    // External sources stay bound to the active project scope.
    expect(pullSources).toHaveBeenCalledTimes(1);
    expect(vi.mocked(pullSources).mock.calls[0][0]).toMatchObject({ scope: 'project' });
  });

  it('reports the resolved scope and the four-type boundary before any write', async () => {
    vi.mocked(detectProjectConfig).mockResolvedValue(projectConfig);

    await pull({});

    expect(log.info).toHaveBeenCalledWith(
      expect.stringContaining('[pull] scope: project=shared (no project partitioning), agent=all, types=skills,rules,env,agents'),
    );
  });

  it('no longer auto-reports usage from pull, in any scope or mode', async () => {
    vi.mocked(detectProjectConfig).mockResolvedValue(projectConfig);

    await pull({ silent: true });

    expect(reportUsageToTeam).not.toHaveBeenCalled();
    expect(truncateUsageAfterReport).not.toHaveBeenCalled();
    expect(capUsageEvents).not.toHaveBeenCalled();
  });

  it('does not run the hooks or MCP reconcile that `teamai hooks` / `teamai mcp` own', async () => {
    vi.mocked(detectProjectConfig).mockResolvedValue(projectConfig);

    await pull({ silent: true });

    expect(reconcileTeamHooksForConfig).not.toHaveBeenCalled();
    expect(reconcileMcpForConfig).not.toHaveBeenCalled();
  });
});
