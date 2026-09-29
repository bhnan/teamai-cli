/**
 * 007 boundary: `pull` is a four-type project resource sync and no longer
 * runs the hooks or MCP reconcile in ANY mode — `teamai hooks` / `teamai mcp`
 * own those, behind their own explicit entry points. These tests pin that
 * boundary through `pull()` itself (the orchestration layer, the same way the
 * previous #822 tests did) and keep the dry-run no-write guarantees for the
 * resource types pull still deploys.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  detectProjectConfig: vi.fn(),
  loadLocalConfigForScope: vi.fn(),
  loadStateForScope: vi.fn().mockResolvedValue({ lastPull: null, lastPullRev: null }),
  loadTeamConfig: vi.fn(),
  requireInit: vi.fn(),
  saveStateForScope: vi.fn(),
}));

vi.mock('../utils/git.js', () => ({
  getHeadRev: vi.fn().mockResolvedValue('abc1234'),
  pullRepo: vi.fn().mockResolvedValue('already up to date'),
}));

vi.mock('../utils/logger.js', () => ({
  log: {
    debug: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn(), dim: vi.fn(), persist: vi.fn(),
  },
  spinner: vi.fn(() => ({
    fail: vi.fn().mockReturnThis(), info: vi.fn().mockReturnThis(),
    start: vi.fn().mockReturnThis(), stop: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(), warn: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('../roles.js', () => ({
  loadRolesManifest: vi.fn().mockResolvedValue({
    version: 1,
    roles: [{
      id: 'dev',
      name: 'Dev',
      description: '',
      resources: { knowledge: ['common'], skills: ['common'], learnings: ['common'], agents: [] },
    }],
    defaults: { shareTarget: 'primary-role' },
  }),
  resolveRoleResourceNamespaces: vi.fn(() => ({
    knowledge: ['common'], skills: ['common'], learnings: ['common'], agents: [],
  })),
  // The entry resolver asks which roles this member holds, to apply the 0.25.0
  // per-entry `roles:` rule. Without it the mock is incomplete and the
  // resolution throws, which pull swallows into a debug line.
  activeRoleIds: vi.fn(() => ['dev']),
}));

// Isolation: pull() takes a real sync-lock. Parallel vitest workers sharing
// that path race and skip/error, so these tests mock the lock.
vi.mock('../update.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

// The end-of-pull checks are exercised in pull-post-checks.test.ts; keep them
// out of the way here so a warning under test is the only thing on the wire.
vi.mock('../doctor.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../doctor.js')>(),
  resolveDoctorContext: vi.fn(),
  buildChecks: vi.fn(),
}));

// Mocked so the "pull never reconciles MCP" boundary can be asserted. The real
// implementation is covered by mcp-reconcile.test.ts; this file is about the
// wiring in pull. The spread keeps every other export real, so a symbol this
// file does not know about still resolves.
vi.mock('../mcp-reconcile.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../mcp-reconcile.js')>(),
  reconcileMcpForConfig: vi.fn().mockResolvedValue({ changes: [], wrote: false }),
}));

// Same treatment for hooks: pull must not reach for the reconcile even when a
// hooks.yaml exists in the team repo.
vi.mock('../hooks.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../hooks.js')>(),
  reconcileTeamHooksForConfig: vi.fn().mockResolvedValue({ ok: true, defs: [] }),
}));

import { detectProjectConfig, loadStateForScope, loadTeamConfig, saveStateForScope } from '../config.js';
import { log } from '../utils/logger.js';
import { pull } from '../pull.js';
import { reconcileTeamHooksForConfig } from '../hooks.js';
import { reconcileMcpForConfig } from '../mcp-reconcile.js';
import type { LocalConfig, TeamaiConfig } from '../types.js';

describe('pull leaves hooks and MCP reconciliation to their own commands', () => {
  let tempDir: string;
  let homeDir: string;
  let projectRoot: string;
  let repoPath: string;
  let localConfig: LocalConfig;

  beforeEach(async () => {
    tempDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-pull-hooksmcp-'));
    homeDir = path.join(tempDir, 'home');
    projectRoot = path.join(tempDir, 'proj');
    repoPath = path.join(tempDir, 'team-repo');
    vi.stubEnv('HOME', homeDir);

    // A project checkout with the claude tool installed, so a skills deploy
    // has a real target directory to (not) write into.
    await fse.ensureDir(path.join(projectRoot, '.claude', 'skills'));
    await fse.ensureDir(path.join(repoPath, 'manifest'));
    await fse.writeFile(path.join(repoPath, 'manifest', 'roles.yaml'), 'version: 1\n');

    localConfig = {
      repo: { localPath: repoPath, remote: 'owner/repo' },
      username: 'tester',
      scope: 'project',
      projectRoot,
      additionalRoles: [],
    };
    const teamConfig: TeamaiConfig = {
      team: 'test',
      description: '',
      repo: 'owner/repo',
      provider: 'github',
      reviewers: [],
      sharing: {
        skills: {}, rules: { enforced: [] }, docs: { localDir: '' }, env: { injectShellProfile: true },
      },
      toolPaths: {
        claude: { skills: '.claude/skills', rules: '.claude/rules', settings: '.claude/settings.json' },
        // Pi ships in every team's default toolPaths; it stays configured so a
        // regression that reintroduces the hooks pass has the same reach.
        pi: { skills: '.pi/skills', rules: '.pi/rules', claudemd: 'AGENTS.md' },
      },
    };

    vi.mocked(detectProjectConfig).mockResolvedValue(localConfig);
    vi.mocked(loadTeamConfig).mockResolvedValue(teamConfig);
    vi.mocked(loadStateForScope).mockResolvedValue({ lastPull: null, lastPullRev: null } as never);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    process.exitCode = 0;
    await fse.remove(tempDir);
  });

  /** A team hook scoped with the deprecated per-entry `roles:` key. */
  async function writeHooksWithDeprecatedRoles(): Promise<void> {
    await fse.ensureDir(path.join(repoPath, 'hooks'));
    await fse.writeFile(
      path.join(repoPath, 'hooks', 'hooks.yaml'),
      [
        'hooks:',
        '  - id: lint',
        '    description: Lint',
        '    event: PostToolUse',
        '    command: teamai hook-dispatch post-tool-use',
        '    roles: [dev]',
        '',
      ].join('\n'),
    );
  }

  it('does not run the hooks reconcile on a dry run, so its warnings never surface', async () => {
    await writeHooksWithDeprecatedRoles();

    await pull({ dryRun: true, force: true });

    expect(reconcileTeamHooksForConfig).not.toHaveBeenCalled();
    // The deprecated `roles:` warning belonged to the reconcile pass; pull
    // must neither resolve nor repeat it.
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('per-entry `roles:`'));
    const debugLines = vi.mocked(log.debug).mock.calls.map(([m]) => String(m));
    expect(debugLines.some((l) => l.includes('Would apply') || l.includes('Reconciled'))).toBe(false);
  });

  it('writes no hook settings or manifest on a dry run', async () => {
    await writeHooksWithDeprecatedRoles();

    await pull({ dryRun: true, force: true });

    // Even with a hooks.yaml present, nothing hook-shaped is written and no
    // state is recorded.
    expect(await fse.pathExists(path.join(projectRoot, '.claude', 'settings.json'))).toBe(false);
    expect(await fse.pathExists(path.join(projectRoot, '.teamai', 'managed-hooks.json'))).toBe(false);
    expect(saveStateForScope).not.toHaveBeenCalled();
  });

  it('does not run the hooks reconcile on a real pull either', async () => {
    await writeHooksWithDeprecatedRoles();

    await pull({ force: true });

    expect(reconcileTeamHooksForConfig).not.toHaveBeenCalled();
    expect(await fse.pathExists(path.join(projectRoot, '.claude', 'settings.json'))).toBe(false);
    const debugLines = vi.mocked(log.debug).mock.calls.map(([m]) => String(m));
    expect(debugLines.some((l) => l.includes('Reconciled'))).toBe(false);
  });

  it.each([
    ['dry run', { dryRun: true, force: true }],
    ['real pull', { force: true }],
  ] as const)('does not run the MCP reconcile on a %s', async (_mode, options) => {
    await pull(options);

    expect(reconcileMcpForConfig).not.toHaveBeenCalled();
    // Nor claim MCP changes it did not make.
    const lines = vi.mocked(log.info).mock.calls.map(([m]) => String(m));
    expect(lines.some((l) => l.includes('Restart your AI tool session'))).toBe(false);
    expect(lines.some((l) => l.includes('Would make'))).toBe(false);
  });

  it('previews the resources pull still owns on a dry run without writing them', async () => {
    await fse.ensureDir(path.join(repoPath, 'skills', 'alpha'));
    await fse.writeFile(
      path.join(repoPath, 'skills', 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: test\n---\nbody\n',
    );

    await pull({ dryRun: true, force: true });

    expect(log.info).toHaveBeenCalledWith(expect.stringContaining('[dry-run] Would pull 1 skills'));
    // The preview wrote nothing: no skill, not even the built-in stub.
    expect(await fse.readdir(path.join(projectRoot, '.claude', 'skills'))).toEqual([]);
    expect(saveStateForScope).not.toHaveBeenCalled();
  });

  it('a real pull does write the resource, so the dry-run absence is the dry run', async () => {
    await fse.ensureDir(path.join(repoPath, 'skills', 'alpha'));
    await fse.writeFile(
      path.join(repoPath, 'skills', 'alpha', 'SKILL.md'),
      '---\nname: alpha\ndescription: test\n---\nbody\n',
    );

    await pull({ force: true });

    expect(await fse.pathExists(path.join(projectRoot, '.claude', 'skills', 'alpha', 'SKILL.md'))).toBe(true);
    expect(saveStateForScope).toHaveBeenCalled();
  });
});
