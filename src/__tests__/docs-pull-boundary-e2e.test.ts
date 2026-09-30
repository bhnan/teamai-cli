import { afterAll, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import fse from 'fs-extra';

const cli = fileURLToPath(new URL('../../dist/index.js', import.meta.url));
let sandbox: string;

// 007 regression (change.md 2026-09-30, doctor/docs mirror): with docs in the
// team repo and NO local mirror, a project pull writes nothing into the
// project docs, `--force` creates no mirror either, and doctor neither fails
// over the missing mirror nor stays silent about a leftover one.
afterAll(async () => {
  if (sandbox) await fse.remove(sandbox);
});

it('pull leaves project docs alone and doctor needs no docs mirror', async () => {
  sandbox = await fse.mkdtemp(path.join(os.tmpdir(), 'teamai-docs-boundary-e2e-'));
  const home = path.join(sandbox, 'home');
  const projectRoot = path.join(sandbox, 'project');
  const seed = path.join(sandbox, 'seed');
  const remote = path.join(sandbox, 'team.git');
  const clone = path.join(projectRoot, '.teamai', 'team-repo');
  // The default sharing.docs.localDir (~/.teamai/docs) in project scope.
  const legacyMirror = path.join(projectRoot, '.teamai', 'docs');
  const env = {
    ...process.env, HOME: home, USERPROFILE: home, FORCE_COLOR: '0',
    GIT_CONFIG_GLOBAL: path.join(sandbox, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'TeamAI Test', GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'TeamAI Test', GIT_COMMITTER_EMAIL: 'test@example.com',
    GIT_TERMINAL_PROMPT: '0',
  };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: 'pipe' });
  const run = (...args: string[]) => execFileSync(process.execPath, [cli, ...args], {
    cwd: projectRoot, env, encoding: 'utf8', stdio: 'pipe', timeout: 60_000,
  });
  const doctorReport = () => JSON.parse(spawnSync(process.execPath, [cli, 'doctor', '--json'], {
    cwd: projectRoot, env, encoding: 'utf8', timeout: 60_000,
  }).stdout);

  await fse.ensureDir(home);
  await fse.outputFile(path.join(seed, 'teamai.yaml'), [
    'team: docs-boundary-test',
    `repo: ${remote}`,
    'provider: git',
    'reviewers: []',
    '',
  ].join('\n'));
  await fse.outputFile(path.join(seed, 'manifest', 'projects.yaml'), [
    'version: 1',
    'projects:',
    '  - id: docs-demo',
    '    name: Docs Demo',
    '    resources:',
    '      skills: []',
    '',
  ].join('\n'));
  await fse.outputFile(path.join(seed, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\ndescription: d\n---\n');
  // What other projects consume: shared docs plus this project's published copy.
  await fse.outputFile(path.join(seed, 'docs', 'guide.md'), 'team guide');
  await fse.outputFile(path.join(seed, 'docs', 'docs-demo', 'published.md'), 'published copy');
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'add', '-A');
  git(seed, '-c', 'commit.gpgsign=false', 'commit', '-qm', 'seed');
  git(sandbox, 'clone', '-q', '--bare', seed, remote);
  await fse.ensureDir(projectRoot);
  git(projectRoot, 'clone', '-q', remote, clone);
  await fse.outputFile(path.join(projectRoot, '.teamai', 'config.yaml'), [
    'repo:',
    `  localPath: ${clone}`,
    `  remote: ${remote}`,
    'username: tester',
    'scope: project',
    `projectRoot: ${projectRoot}`,
    'updatePolicy: skip',
    'enabledAgents: [claude]',
    'projects: [docs-demo]',
    '',
  ].join('\n'));
  // The project's own docs are the push source; pull must leave them exactly
  // as they are, and a pre-007 mirror is exactly what it must not touch.
  await fse.outputFile(path.join(projectRoot, 'docs', 'my-doc.md'), 'project original');
  await fse.outputFile(path.join(legacyMirror, 'stale.md'), 'old mirror copy');

  run('pull', '--force');

  // No mirror is created or restored, and the leftover is neither pruned nor
  // read: doctor's docs answer comes from the clone, not from here.
  expect(await fse.readFile(path.join(legacyMirror, 'stale.md'), 'utf8')).toBe('old mirror copy');
  expect((await fse.readdir(legacyMirror)).sort()).toEqual(['stale.md']);
  expect(await fse.readFile(path.join(projectRoot, 'docs', 'my-doc.md'), 'utf8')).toBe('project original');

  const report = doctorReport();
  const docsCheck = report.checks.find((check: { name: string }) => check.name === 'Team docs readable in the team repo clone');
  expect(docsCheck).toBeDefined();
  expect(docsCheck.ok).toBe(true);
  expect(report.checks.find((check: { name: string }) => check.name === 'Team docs delivered')).toBeUndefined();
  expect(report.notes.some((note: string) => note.startsWith('Legacy docs mirror:') && note.includes(legacyMirror))).toBe(true);

  // The legacy mirror gone changes nothing: doctor stays green with no mirror
  // at all — the state the old check failed over.
  await fse.remove(legacyMirror);
  const withoutMirror = doctorReport();
  expect(withoutMirror.checks.find((check: { name: string }) => check.name === 'Team docs readable in the team repo clone').ok).toBe(true);
  expect((withoutMirror.notes ?? []).some((note: string) => note.startsWith('Legacy docs mirror:'))).toBe(false);
}, 120_000);
