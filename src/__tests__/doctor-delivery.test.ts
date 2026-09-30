import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fse from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

vi.mock('../config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../config.js')>()),
  detectProjectConfig: vi.fn().mockResolvedValue(null),
  loadLocalConfig: vi.fn(),
  loadTeamConfig: vi.fn(),
}));

vi.mock('../utils/logger.js', () => ({
  log: {
    debug: vi.fn(), error: vi.fn(), info: vi.fn(), success: vi.fn(), warn: vi.fn(), dim: vi.fn(),
  },
  setStderrOnly: vi.fn(),
}));

import { loadLocalConfig, loadTeamConfig } from '../config.js';
import { log } from '../utils/logger.js';
import { buildChecks, resolveDoctorContext, type Check } from '../doctor.js';
import { buildDocsCheck, buildLegacyDocsMirrorNote } from '../doctor-delivery.js';
import type { LocalConfig, TeamaiConfig } from '../types.js';

/**
 * The delivery check: what `pull` said it synced, against what an agent can
 * actually read on disk (#598). Everything else in the registry verifies
 * plumbing; this one verifies the payload.
 */
describe('doctor — skills delivered on disk', () => {
  let tempDir: string;
  let homeDir: string;
  let repoPath: string;
  let localConfig: LocalConfig;
  let teamConfig: TeamaiConfig;

  const CLAUDE_SKILLS = ['.claude', 'skills'];

  async function writeTeamSkill(name: string): Promise<void> {
    const dir = path.join(repoPath, 'skills', name);
    await fse.ensureDir(dir);
    await fse.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n`);
  }

  /** A correctly delivered copy, the way pullItem leaves one. */
  async function deliver(segments: string[], name: string): Promise<void> {
    const dir = path.join(homeDir, ...segments, name);
    await fse.ensureDir(dir);
    await fse.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n`);
  }

  async function deliveryCheck(tool = 'claude'): Promise<Check> {
    const ctx = await resolveDoctorContext();
    if (!ctx) throw new Error('expected a resolved doctor context');
    const check = (await buildChecks(ctx)).find((c) => c.name === `Skills delivered to ${tool}`);
    if (!check) throw new Error(`no delivery check for ${tool}`);
    return check;
  }

  beforeEach(async () => {
    tempDir = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-delivery-'));
    homeDir = path.join(tempDir, 'home');
    repoPath = path.join(tempDir, 'team-repo');
    vi.stubEnv('HOME', homeDir);

    await writeTeamSkill('alpha');
    await writeTeamSkill('beta');
    await fse.ensureDir(path.join(homeDir, ...CLAUDE_SKILLS));

    localConfig = {
      repo: { localPath: repoPath, remote: 'owner/repo' },
      username: 'tester',
      scope: 'user',
      additionalRoles: [],
    };
    teamConfig = {
      team: 'test',
      description: '',
      repo: 'owner/repo',
      provider: 'git',
      reviewers: [],
      sharing: {
        skills: {}, rules: { enforced: [] }, docs: { localDir: '' },
        env: { injectShellProfile: false },
      },
      toolPaths: { claude: { skills: '.claude/skills' } },
    };

    vi.mocked(loadLocalConfig).mockResolvedValue(localConfig);
    vi.mocked(loadTeamConfig).mockResolvedValue(teamConfig);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    await fse.remove(tempDir);
  });

  it('passes when every desired skill is on disk', async () => {
    await deliver(CLAUDE_SKILLS, 'alpha');
    await deliver(CLAUDE_SKILLS, 'beta');

    const check = await deliveryCheck();

    expect(await check.check()).toBe(true);
    expect(check.source).toBe('local');
  });

  it('fails and names the skill the tool never received', async () => {
    await deliver(CLAUDE_SKILLS, 'alpha');

    const check = await deliveryCheck();

    expect(await check.check()).toBe(false);
    expect(check.fix).toContain('beta');
    expect(check.fix).not.toContain('alpha');
    // Not a plain `teamai pull`: this check is printed at the end of one, and a
    // scope whose team repo has not moved is skipped, so it cannot restore this.
    expect(check.fix).toContain('teamai pull --force');
  });

  it('counts the rest rather than printing every name', async () => {
    // A fresh machine is missing everything. The fix is a line a human reads,
    // not the whole desired set pasted into the terminal.
    for (let i = 0; i < 9; i += 1) await writeTeamSkill(`extra-${i}`);

    const check = await deliveryCheck();

    expect(await check.check()).toBe(false);
    expect(check.fix).toContain('and 6 more');
    expect(check.fix).not.toContain('extra-8');
  });

  it('does not warn about a Codex conflict while only reading', async () => {
    // buildDeliveryChecks resolves destinations without a sourcePath. Codex's
    // shared-directory reconciliation needs the team copy to prove two copies
    // are identical, so without one there is nothing to decide: a read-only
    // `doctor` must not report a conflict the write path would have settled.
    teamConfig.toolPaths = { codex: { skills: '.codex/skills' } };
    await fse.ensureDir(path.join(homeDir, '.codex', 'skills'));
    for (const name of ['alpha', 'beta']) {
      await deliver(['.agents', 'skills'], name);
      await deliver(['.codex', 'skills'], name);
    }

    const check = await deliveryCheck('codex');

    expect(await check.check()).toBe(true);
    expect(log.warn).not.toHaveBeenCalledWith(expect.stringContaining('Codex skill conflict'));
  });

  it('asks the skills write path whether a tool is installed', async () => {
    // OpenClaw lives at its workspace directory, not at the tool root. A tool
    // root with no workspace passes a generic probe while skill delivery skips
    // the tool entirely, which is "reported success, received nothing" inside
    // the command whose job is to catch it (#598).
    teamConfig.toolPaths = { openclaw: { skills: '.openclaw/skills' } };
    localConfig.enabledAgents = ['openclaw'];
    await fse.ensureDir(path.join(homeDir, '.openclaw'));

    const ctx = await resolveDoctorContext();
    if (!ctx) throw new Error('expected a resolved doctor context');
    const installed = (await buildChecks(ctx)).find((c) => c.name === 'openclaw is installed');

    expect(installed).toBeDefined();
    expect(await installed!.check()).toBe(false);
  });

  it('passes once that tool\'s workspace is there', async () => {
    teamConfig.toolPaths = { openclaw: { skills: '.openclaw/skills' } };
    localConfig.enabledAgents = ['openclaw'];
    await fse.ensureDir(path.join(homeDir, '.openclaw', 'workspace', 'skills'));

    const ctx = await resolveDoctorContext();
    if (!ctx) throw new Error('expected a resolved doctor context');
    const installed = (await buildChecks(ctx)).find((c) => c.name === 'openclaw is installed');

    expect(installed).toBeDefined();
    expect(await installed!.check()).toBe(true);
  });

  it('reports each installed tool separately', async () => {
    teamConfig.toolPaths = {
      claude: { skills: '.claude/skills' },
      codex: { skills: '.codex/skills' },
    };
    await fse.ensureDir(path.join(homeDir, '.codex', 'skills'));
    await deliver(CLAUDE_SKILLS, 'alpha');
    await deliver(CLAUDE_SKILLS, 'beta');
    await deliver(['.codex', 'skills'], 'alpha');

    expect(await (await deliveryCheck('claude')).check()).toBe(true);
    expect(await (await deliveryCheck('codex')).check()).toBe(false);
  });

  it('counts a codex skill in the shared .agents/skills directory as delivered', async () => {
    teamConfig.toolPaths = { codex: { skills: '.codex/skills' } };
    await fse.ensureDir(path.join(homeDir, '.codex', 'skills'));
    await deliver(['.agents', 'skills'], 'alpha');
    await deliver(['.agents', 'skills'], 'beta');

    expect(await (await deliveryCheck('codex')).check()).toBe(true);
  });

  it('asks nothing of a tool that is not installed', async () => {
    teamConfig.toolPaths = {
      claude: { skills: '.claude/skills' },
      codex: { skills: '.codex/skills' },
    };
    await deliver(CLAUDE_SKILLS, 'alpha');
    await deliver(CLAUDE_SKILLS, 'beta');

    const ctx = await resolveDoctorContext();
    if (!ctx) throw new Error('expected a resolved doctor context');
    const names = (await buildChecks(ctx)).map((c) => c.name);

    expect(names).toContain('Skills delivered to claude');
    expect(names).not.toContain('Skills delivered to codex');
  });

  it('asks nothing of an excluded skill', async () => {
    localConfig.excludedSkills = ['beta'];
    await deliver(CLAUDE_SKILLS, 'alpha');

    expect(await (await deliveryCheck()).check()).toBe(true);
  });

  // The write succeeded, so no write-time gate has anything to report — and the
  // agent still never discovers the skill (#372's class).
  describe('delivered but invisible', () => {
    it('fails when SKILL.md is gone', async () => {
      await deliver(CLAUDE_SKILLS, 'alpha');
      await fse.ensureDir(path.join(homeDir, ...CLAUDE_SKILLS, 'beta'));

      const check = await deliveryCheck();

      expect(await check.check()).toBe(false);
      expect(check.fix).toContain('beta');
      expect(check.fix).toMatch(/unreadable/i);
    });

    it('fails when the frontmatter does not parse', async () => {
      await deliver(CLAUDE_SKILLS, 'alpha');
      const beta = path.join(homeDir, ...CLAUDE_SKILLS, 'beta');
      await fse.ensureDir(beta);
      await fse.writeFile(path.join(beta, 'SKILL.md'), '---\nname: [oops\n---\n# beta\n');

      expect(await (await deliveryCheck()).check()).toBe(false);
    });

    it('fails when the frontmatter name does not match the directory', async () => {
      await deliver(CLAUDE_SKILLS, 'alpha');
      const beta = path.join(homeDir, ...CLAUDE_SKILLS, 'beta');
      await fse.ensureDir(beta);
      await fse.writeFile(path.join(beta, 'SKILL.md'), '---\nname: renamed\ndescription: d\n---\n');

      const check = await deliveryCheck();

      expect(await check.check()).toBe(false);
      expect(check.fix).toContain('beta');
    });

    it('separates what was never delivered from what is unreadable', async () => {
      const beta = path.join(homeDir, ...CLAUDE_SKILLS, 'beta');
      await fse.ensureDir(beta);
      await fse.writeFile(path.join(beta, 'SKILL.md'), '---\nname: renamed\n---\n');

      const check = await deliveryCheck();
      const fix = check.fix ?? '';

      // alpha never arrived; beta arrived broken. Same tool, different cause.
      expect(fix.indexOf('alpha')).toBeGreaterThan(-1);
      expect(fix.indexOf('beta')).toBeGreaterThan(-1);
      expect(fix).toMatch(/not delivered/i);
      expect(fix).toMatch(/unreadable/i);
    });

    it('accepts extra frontmatter fields', async () => {
      await deliver(CLAUDE_SKILLS, 'alpha');
      const beta = path.join(homeDir, ...CLAUDE_SKILLS, 'beta');
      await fse.ensureDir(beta);
      await fse.writeFile(
        path.join(beta, 'SKILL.md'),
        '---\nname: beta\ndescription: d\nallowed-tools: [Read]\nversion: 2\n---\n',
      );

      expect(await (await deliveryCheck()).check()).toBe(true);
    });
  });

  // Docs are consumed from the team repo clone, not delivered (007): pull
  // never writes or prunes a local mirror, so the check reads the clone's own
  // docs/ tree, and a mirror an older release left is only a cleanup note.
  describe('team docs', () => {
    const CHECK = 'Team docs readable in the team repo clone';

    async function writeTeamDoc(...segments: string[]): Promise<void> {
      const file = path.join(repoPath, 'docs', ...segments);
      await fse.ensureDir(path.dirname(file));
      await fse.writeFile(file, '# doc\n');
    }

    async function docsCheck(): Promise<Check | undefined> {
      const ctx = await resolveDoctorContext();
      if (!ctx) throw new Error('expected a resolved doctor context');
      return (await buildChecks(ctx)).find((c) => c.name === CHECK);
    }

    beforeEach(() => {
      // Deliberately configured, and deliberately never written: the check
      // must ask nothing of the legacy mirror directory (007).
      teamConfig.sharing.docs.localDir = '~/team-docs';
    });

    it('passes when the clone holds every doc and no local mirror exists', async () => {
      await writeTeamDoc('guide.md');
      await writeTeamDoc('api', 'reference.md');

      const check = await docsCheck();

      expect(check).toBeDefined();
      expect(await check!.check()).toBe(true);
    });

    it('stays green while a legacy mirror sits in place, stale content included', async () => {
      await writeTeamDoc('guide.md');
      await fse.outputFile(path.join(homeDir, 'team-docs', 'old', 'retired.md'), 'stale');
      await fse.outputFile(path.join(homeDir, 'team-docs', '.keep'), 'hidden');

      const check = await docsCheck();

      expect(check).toBeDefined();
      expect(await check!.check()).toBe(true);
    });

    it('fails and names a doc the clone can no longer read', async () => {
      // A name occupied by something other than a file — here a link to a
      // directory — lists as a doc but reads as none.
      await writeTeamDoc('guide.md');
      const outside = path.join(tempDir, 'outside');
      await fse.ensureDir(outside);
      await fse.symlink(outside, path.join(repoPath, 'docs', 'linked.md'), process.platform === 'win32' ? 'junction' : 'file');

      const check = await docsCheck();

      expect(await check!.check()).toBe(false);
      expect(check!.fix).toContain('linked.md');
      expect(check!.fix).not.toContain('guide.md');
      expect(check!.fix).toContain(path.join(repoPath, 'docs'));
    });

    it('asks nothing when the team repo ships no docs', async () => {
      expect(await docsCheck()).toBeUndefined();
    });

    // The same filter recall indexes (#707): a docs namespace this member does
    // not have active is not owed, so it is not read either.
    it('expects only the active namespace\'s docs, and does not read an inactive namespace\'s', async () => {
      await fse.outputFile(
        path.join(repoPath, 'manifest', 'projects.yaml'),
        'version: 1\nprojects:\n  - id: alpha\n    resources:\n      docs: [alpha]\n  - id: beta\n    resources:\n      docs: [beta]\n',
      );
      localConfig.projects = ['alpha'];
      await writeTeamDoc('alpha', 'gateway.md');
      await writeTeamDoc('beta', 'billing.md');
      // A dangling link where beta's second doc sits: unreadable, and never stat'ed.
      await fse.symlink('nowhere', path.join(repoPath, 'docs', 'beta', 'broken.md'));

      const check = await docsCheck();

      expect(check).toBeDefined();
      expect(await check!.check()).toBe(true);
      expect(check!.fix).toBeUndefined();
    });

    it('names the reason when the delivered set cannot be resolved', async () => {
      await writeTeamDoc('guide.md');
      await fse.ensureDir(path.join(repoPath, 'manifest'));
      await fse.writeFile(path.join(repoPath, 'manifest', 'roles.yaml'), 'roles: [oops\n');

      // Called directly: through buildChecks, the doctor-stage rules builder
      // hits the same broken manifest first and throws (a pre-existing gap,
      // not this check's contract). The pull-stage post-checks reach this.
      const ctx = await resolveDoctorContext();
      if (!ctx) throw new Error('expected a resolved doctor context');
      const check = (await buildDocsCheck(ctx))[0];

      expect(check.name).toBe('Team docs can be resolved from the team repo');
      expect(await check.check()).toBe(false);
      expect(check.fix).toContain('recall cannot index docs');
    });

    // The mirror an older release may have left is a note, not a check: it
    // must not gate doctor, only tell the user where the leftover sits.
    describe('legacy docs mirror note', () => {
      async function mirrorNote(): Promise<string[]> {
        const ctx = await resolveDoctorContext();
        if (!ctx) throw new Error('expected a resolved doctor context');
        return buildLegacyDocsMirrorNote(ctx);
      }

      it('names the leftover directory and says it may be deleted', async () => {
        await writeTeamDoc('guide.md');
        await fse.outputFile(path.join(homeDir, 'team-docs', 'guide.md'), 'old mirror copy');

        const notes = await mirrorNote();

        expect(notes).toHaveLength(1);
        expect(notes[0]).toContain(path.join(homeDir, 'team-docs'));
        expect(notes[0]).toContain('delete');
      });

      it('says nothing without a mirror', async () => {
        await writeTeamDoc('guide.md');

        expect(await mirrorNote()).toEqual([]);
      });

      it('says nothing when the localDir is not a dedicated directory', async () => {
        await writeTeamDoc('guide.md');
        // The team repo itself, and the home directory: both overlap live
        // state, so neither may be advised for deletion.
        teamConfig.sharing.docs.localDir = repoPath;
        expect(await mirrorNote()).toEqual([]);
        teamConfig.sharing.docs.localDir = '~';
        expect(await mirrorNote()).toEqual([]);
      });
    });
  });

  // The command whose job is reporting bad state must not stack-trace on it.
  it('reports a team repo it cannot resolve a desired set from, instead of throwing', async () => {
    // The same skill in two active role namespaces: scanRoleAwareSkills throws.
    localConfig.primaryRole = 'dev';
    await fse.ensureDir(path.join(repoPath, 'manifest'));
    await fse.writeFile(path.join(repoPath, 'manifest', 'roles.yaml'), [
      'version: 1',
      'roles:',
      '  - id: dev',
      '    resources:',
      '      knowledge: []',
      '      skills: [one, two]',
      '      learnings: []',
      '      agents: []',
      '',
    ].join('\n'));
    for (const ns of ['one', 'two']) {
      const dir = path.join(repoPath, 'skills', ns, 'clash');
      await fse.ensureDir(dir);
      await fse.writeFile(path.join(dir, 'SKILL.md'), '---\nname: clash\n---\n');
    }

    const ctx = await resolveDoctorContext();
    if (!ctx) throw new Error('expected a resolved doctor context');
    const checks = await buildChecks(ctx);

    const resolution = checks.find((c) => c.name === 'Skills to deliver can be resolved');
    expect(resolution).toBeDefined();
    expect(await resolution!.check()).toBe(false);
    expect(resolution!.fix).toContain('clash');
  });

  it('never writes to the tool directory it inspects', async () => {
    await deliver(CLAUDE_SKILLS, 'alpha');

    await (await deliveryCheck()).check();

    expect(await fse.readdir(path.join(homeDir, ...CLAUDE_SKILLS))).toEqual(['alpha']);
  });
});
