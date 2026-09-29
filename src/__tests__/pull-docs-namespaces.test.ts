/**
 * 007: `pull` no longer delivers or withholds docs namespaces. Project docs
 * are one-way published by `push` and read from the team repo clone; pull
 * never copies them down, prunes them, or reacts to namespace declarations in
 * roles.yaml / projects.yaml. These tests pin that boundary on what lands (or
 * does not) on disk: the docs destination — and the project's own docs/
 * directory — must receive ZERO writes from pull.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fse from 'fs-extra';

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  requireInit: vi.fn(),
  loadState: vi.fn().mockResolvedValue({ lastPull: null }),
  saveState: vi.fn(),
  loadLocalConfigForScope: vi.fn(),
  loadTeamConfig: vi.fn(),
  detectProjectConfig: vi.fn().mockResolvedValue(null),
  loadStateForScope: vi.fn().mockResolvedValue({ lastPull: null }),
  saveStateForScope: vi.fn(),
}));

vi.mock('../utils/git.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../utils/git.js')>()),
  pullRepo: vi.fn().mockResolvedValue('Already up to date.'),
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

// pull() takes a real sync-lock; parallel workers would race on it.
vi.mock('../update.js', () => ({
  acquireLock: vi.fn().mockResolvedValue(true),
  releaseLock: vi.fn().mockResolvedValue(undefined),
}));

// The post-pull doctor checks are covered in pull-post-checks.test.ts; keep
// them out of the way so the docs assertions are the only thing observed.
vi.mock('../doctor.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../doctor.js')>(),
  resolveDoctorContext: vi.fn(),
  buildChecks: vi.fn(),
}));

import { pull } from '../pull.js';
import { loadTeamConfig, detectProjectConfig } from '../config.js';
import { log } from '../utils/logger.js';
import type { TeamaiConfig, LocalConfig } from '../types.js';

const ROLES_YAML = `
version: 1
roles:
  - id: frontend
    resources:
      knowledge: []
      skills: []
      docs: [frontend]
  - id: devops
    resources:
      knowledge: []
      skills: []
      docs: [devops]
`;

describe('pull: docs are out of pull\'s boundary (007)', () => {
  let tmpDir: string;
  let homeDir: string;
  let projectRoot: string;
  let repoPath: string;
  let teamConfig: TeamaiConfig;
  let localConfig: LocalConfig;

  /** The docs destination pull used to mirror into; in project scope a `~/`
   *  localDir resolves against the project root. */
  const docsDest = (): string => path.join(projectRoot, 'team-docs');
  const local = (rel: string): string => path.join(docsDest(), rel);
  const exists = (rel: string): Promise<boolean> => fse.pathExists(local(rel));
  const team = (rel: string, content: string): Promise<void> => fse.outputFile(path.join(repoPath, rel), content);
  const indexedDocs = async (): Promise<string[]> => {
    const index = await fse.readJson(path.join(projectRoot, '.teamai', 'search-index.json')) as {
      entries: Array<{ type: string; filename: string }>;
    };
    return index.entries.filter((entry) => entry.type === 'docs').map((entry) => entry.filename).sort();
  };

  beforeEach(async () => {
    tmpDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-pull-docs-ns-'));
    homeDir = path.join(tmpDir, 'home');
    projectRoot = path.join(tmpDir, 'proj');
    repoPath = path.join(projectRoot, '.teamai', 'team-repo');

    await team('manifest/roles.yaml', ROLES_YAML);
    await team('docs/guide.md', '# Guide\n');
    await team('docs/api/reference.md', '# API\n');
    await team('docs/frontend/components.md', '# Components\n');
    await team('docs/frontend/styling.md', '# Styling\n');
    await team('docs/devops/deploy.md', '# Deploy\n');

    // A project checkout with the claude tool installed, so the resource side
    // of the pull runs its normal path (what must NOT touch docs below).
    await fse.ensureDir(path.join(projectRoot, '.claude', 'skills'));

    vi.stubEnv('HOME', homeDir);

    teamConfig = {
      team: 'test',
      description: '',
      repo: 'https://example.com/test/repo.git',
      provider: 'github',
      reviewers: [],
      sharing: {
        skills: {},
        rules: { enforced: [] },
        docs: { localDir: '~/team-docs' },
        env: { injectShellProfile: true },
      },
      toolPaths: {
        claude: { skills: '.claude/skills', rules: '.claude/rules' },
      },
    };

    localConfig = {
      repo: { localPath: repoPath, remote: 'https://example.com/test/repo.git' },
      username: 'testuser',
      updatePolicy: 'auto',
      primaryRole: 'frontend',
      additionalRoles: [],
      resourceProfileVersion: 1,
      scope: 'project',
      projectRoot,
    };

    vi.mocked(loadTeamConfig).mockResolvedValue(teamConfig);
    vi.mocked(detectProjectConfig).mockResolvedValue(localConfig);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    process.exitCode = 0;
    await fse.remove(tmpDir);
  });

  it('copies no team docs down and deletes no local docs', async () => {
    // A file the old mirror would have overwritten with the team copy, and one
    // it would have pruned as absent from the team repo.
    await fse.outputFile(local('guide.md'), '# My local guide\n');
    await fse.outputFile(local('mine.md'), '# Only mine\n');

    await pull({});

    // Nothing was copied down...
    expect(await exists('api/reference.md')).toBe(false);
    expect(await exists('frontend/components.md')).toBe(false);
    expect(await exists('devops/deploy.md')).toBe(false);
    // ...and nothing was overwritten or deleted.
    expect(await fse.readFile(local('guide.md'), 'utf8')).toBe('# My local guide\n');
    expect(await fse.readFile(local('mine.md'), 'utf8')).toBe('# Only mine\n');
  });

  it('leaves the project\'s own docs/ directory untouched too', async () => {
    await fse.outputFile(path.join(projectRoot, 'docs', 'design.md'), '# Local design\n');

    await pull({});

    expect(await fse.readFile(path.join(projectRoot, 'docs', 'design.md'), 'utf8')).toBe('# Local design\n');
    expect(await fse.pathExists(path.join(projectRoot, 'docs', 'guide.md'))).toBe(false);
    expect(await fse.pathExists(path.join(projectRoot, 'docs', 'frontend'))).toBe(false);
  });

  it('docs namespace declarations in roles.yaml have no pull effect', async () => {
    // Leftovers from an older mirror run of the frontend namespace, plus the
    // namespace the active role does NOT declare. The old pull delivered
    // devops/ and withdrew unchanged frontend/ files; neither may happen now.
    await fse.outputFile(local('frontend/components.md'), '# Components\n');
    await fse.outputFile(local('frontend/styling.md'), '# Styling, my notes\n');

    localConfig.primaryRole = 'devops';
    vi.mocked(detectProjectConfig).mockResolvedValue(localConfig);

    await pull({});

    // Nothing of the now-active devops namespace was delivered...
    expect(await exists('devops/deploy.md')).toBe(false);
    // ...and nothing of the deactivated frontend namespace was withdrawn,
    // neither the unchanged copy nor the locally edited one.
    expect(await fse.readFile(local('frontend/components.md'), 'utf8')).toBe('# Components\n');
    expect(await fse.readFile(local('frontend/styling.md'), 'utf8')).toBe('# Styling, my notes\n');
  });

  it('docs namespace declarations in projects.yaml have no pull effect', async () => {
    await team('manifest/projects.yaml', 'version: 1\nprojects:\n  - id: billing\n    resources:\n      docs: [billing]\n');
    await team('docs/billing/invoices.md', '# Invoices\n');
    const billingMember: LocalConfig = { ...localConfig, projects: ['billing'] };
    vi.mocked(detectProjectConfig).mockResolvedValue(billingMember);

    await pull({});

    expect(await exists('billing/invoices.md')).toBe(false);
    expect(await exists('frontend/components.md')).toBe(false);
    expect(await exists('guide.md')).toBe(false);
  });

  it('never withdraws from the team repo when the docs destination is its docs/ directory', async () => {
    vi.mocked(loadTeamConfig).mockResolvedValue({
      ...teamConfig,
      sharing: { ...teamConfig.sharing, docs: { localDir: path.join(repoPath, 'docs') } },
    });
    await fse.ensureDir(docsDest());

    await pull({});

    // The team repo's own docs tree is a read-only source for pull.
    for (const rel of ['guide.md', 'api/reference.md', 'frontend/components.md', 'frontend/styling.md', 'devops/deploy.md']) {
      expect(await fse.pathExists(path.join(repoPath, 'docs', rel))).toBe(true);
    }
  });

  it('still indexes team docs for recall without deploying them', async () => {
    await pull({});

    // Recall keeps reading the repo copy through the search index...
    expect(await indexedDocs()).toEqual(['api/reference.md', 'frontend/components.md', 'frontend/styling.md', 'guide.md']);
    // ...while the destination stays empty.
    expect(await fse.pathExists(docsDest())).toBe(false);
  });

  it('rejects --types docs before touching anything', async () => {
    await pull({ types: 'docs' });

    expect(process.exitCode).toBe(2);
    expect(log.error).toHaveBeenCalledWith(expect.stringContaining('Resource type "docs" is not managed by pull'));
    expect(await fse.pathExists(docsDest())).toBe(false);
    expect(await fse.pathExists(path.join(projectRoot, '.teamai', 'state.json'))).toBe(false);
  });
});
