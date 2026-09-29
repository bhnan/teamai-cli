import path from 'node:path';
import crypto from 'node:crypto';
import fse from 'fs-extra';
import { detectProjectConfig, loadLocalConfigForScope, loadTeamConfig, loadStateForScope, saveStateForScope } from './config.js';
import { resolveToolBaseDir, scopedToolPaths } from './types.js';
import type { GlobalOptions, LocalConfig, State, TeamaiConfig } from './types.js';
import { isToolInstalledForConfig } from './resources/base.js';
import { ruleFileExtensionForTool, usesCopilotInstructions, usesCursorMdcRules } from './resources/rule-format.js';
import { teamRuleToCursorMdc } from './resources/cursor-mdc.js';
import { teamRuleToCopilotInstructions } from './resources/copilot-instructions.js';
import { listDirs, listFilesRecursive, pathExists, readFileSafe } from './utils/fs.js';
import { pullRepo } from './utils/git.js';
import { log } from './utils/logger.js';
import { askSelection, isInteractive } from './utils/prompt.js';

/** The shared boundary `get` operates on (007): skills and rules only. */
const SHARED_TYPES = ['skills', 'rules'] as const;
type GetType = (typeof SHARED_TYPES)[number];

export interface GetOptions extends GlobalOptions {
  type?: string;
  name?: string;
  tool?: string;
  agent?: string;
  force?: boolean;
  refresh?: boolean;
}

export interface Ctx {
  repo: string;
  localConfig: LocalConfig;
  teamConfig: TeamaiConfig;
  scope: 'project' | 'user';
  projectRoot: string;
}

// ─── Pure helpers (unit-tested) ─────────────────────────

/** Reject path traversal (`..`/`.` segments) and absolute paths in resource names. */
export function isValidName(name: string): boolean {
  if (name.includes('..') || name.startsWith('/')) return false;
  return !name.split('/').some((s) => s === '.' || s.length === 0);
}

/**
 * Resolve a SHARED skill at the shared root (`skills/<name>/SKILL.md`, 007).
 * Namespace copies (`skills/<ns>/<name>`) are not shared sources; when the
 * name only exists under namespaces they are reported so the caller can point
 * the user at `pull` instead of guessing.
 */
export async function resolveSharedSkillSource(
  repoSkills: string,
  name: string,
): Promise<{ source: string | null; namespacedOnly: string[] }> {
  const flat = path.join(repoSkills, name, 'SKILL.md');
  if (await pathExists(flat)) return { source: path.join(repoSkills, name), namespacedOnly: [] };
  const namespacedOnly: string[] = [];
  for (const d of await listDirs(repoSkills)) {
    if (await pathExists(path.join(repoSkills, d, name, 'SKILL.md'))) namespacedOnly.push(`${d}/${name}`);
  }
  return { source: null, namespacedOnly: namespacedOnly.sort() };
}

/**
 * Resolve a SHARED rule at the rules root (`rules/<name>.md`, 007). Namespace
 * copies (`rules/<ns>/<name>.md`) are not shared sources and are reported as
 * `namespacedOnly` so the caller can point at `pull`.
 */
export async function resolveSharedRuleSource(
  repoRules: string,
  name: string,
): Promise<{ source: string | null; namespacedOnly: string[] }> {
  if (name.includes('/')) {
    // A segmented path targets a namespace tree; shared rules live flat at the
    // root, so report the copy without ever treating it as a shared source.
    const rel = name.endsWith('.md') ? name : `${name}.md`;
    return { source: null, namespacedOnly: (await pathExists(path.join(repoRules, rel))) ? [rel] : [] };
  }
  const base = name.replace(/\.md$/, '');
  const exactMd = path.join(repoRules, `${base}.md`);
  if (await pathExists(exactMd)) return { source: exactMd, namespacedOnly: [] };
  const namespacedOnly: string[] = [];
  for (const rel of await listFilesRecursive(repoRules)) {
    if (!rel.endsWith('.md')) continue;
    const parts = rel.split('/');
    if (parts.length === 2 && parts[1]!.replace(/\.md$/, '') === base) namespacedOnly.push(rel);
  }
  return { source: null, namespacedOnly: namespacedOnly.sort() };
}

/** Discover shared entries per type (what `get list` prints): shared root only. */
export async function listTypeEntries(repo: string, type: GetType): Promise<string[]> {
  const root = path.join(repo, type);
  if (!(await pathExists(root))) return [];
  if (type === 'skills') {
    const out: string[] = [];
    for (const d of await listDirs(root)) {
      if (await pathExists(path.join(root, d, 'SKILL.md'))) out.push(d);
    }
    return out.sort();
  }
  const files = await listFilesRecursive(root);
  return files.filter((f) => f.endsWith('.md') && !f.includes('/')).sort();
}

// ─── Shared-get tracking (007) ───────────────────────────

import { fileDigest, dirDigest } from './utils/digest.js';

export { fileDigest, dirDigest };

/**
 * What a repeat `get` may do with one shared resource, from the three-way
 * compare of source (S = team repo content), target (T = what is installed in
 * the agent's global directory now) and the recorded baseline (B = what this
 * machine last installed, from where). Pure: unit-tested without a repo.
 */
export type SharedGetPlan =
  | { action: 'install' }
  | { action: 'update' }
  | { action: 'unchanged' }
  | { action: 'conflict'; reason: 'unmanaged' | 'local-changes' | 'both-changed' };

export function planSharedGet(input: {
  hasRecord: boolean;
  sourceSha: string | null;
  targetSha: string | null;
  baselineSourceSha?: string;
  baselineDeployedSha?: string;
}): SharedGetPlan {
  const { hasRecord, sourceSha, targetSha, baselineSourceSha, baselineDeployedSha } = input;
  if (!hasRecord || baselineDeployedSha === undefined || baselineSourceSha === undefined) {
    return targetSha === null
      ? { action: 'install' }
      : { action: 'conflict', reason: 'unmanaged' };
  }
  if (targetSha === null) return { action: 'install' };
  if (targetSha === baselineDeployedSha) {
    return sourceSha === baselineSourceSha ? { action: 'unchanged' } : { action: 'update' };
  }
  return sourceSha === baselineSourceSha
    ? { action: 'conflict', reason: 'local-changes' }
    : { action: 'conflict', reason: 'both-changed' };
}

/** One recorded shared install, as persisted in state.sharedInstalls. */
type SharedInstallRecord = NonNullable<State['sharedInstalls']>[string];

function sharedInstallKey(type: 'skills' | 'rules', agent: string, name: string): string {
  return `${type}:${agent}:${name}`;
}

/**
 * The user-scope view of a config for resolving an agent's GLOBAL resource
 * directories: `get` installs into user-global targets even when it runs from
 * a project directory (007), so scope-only overrides (`userScope` paths,
 * `toolRoots`) apply and `resolveBaseDir` lands on HOME.
 */
function userScopeView(localConfig: LocalConfig): LocalConfig {
  return { ...localConfig, scope: 'user' };
}

/**
 * The config whose state holds shared install records: the USER-scope state
 * (~/.teamai), never a project partition. The record describes a machine-global
 * target, so it must read identically no matter which directory `get` runs
 * from; a record written into one project's partition would be invisible to the
 * next run from another directory and the same install would read as
 * `unmanaged`. When no user config exists (project-only machine), a synthetic
 * user view still lands on ~/.teamai via getDataHome.
 */
async function userStateConfig(ctx: Ctx): Promise<LocalConfig> {
  if (ctx.scope === 'user') return ctx.localConfig;
  try {
    const userConfig = await loadLocalConfigForScope('user');
    if (userConfig) return userConfig;
  } catch {
    // fall through to the synthetic user view below
  }
  return { ...ctx.localConfig, scope: 'user', dataHome: undefined };
}

/**
 * Which agent a shared get targets. An explicit `--agent` (or the legacy
 * positional tool) must name a configured agent; otherwise the single
 * installed agent derives, several installed agents ask interactively, and a
 * non-interactive run with several candidates fails instead of guessing.
 */
async function resolveTargetAgent(
  ctx: Ctx,
  field: 'skills' | 'rules',
  toolOption: string | undefined,
): Promise<string | null> {
  const userView = userScopeView(ctx.localConfig);
  const paths = scopedToolPaths(ctx.teamConfig, userView);
  if (toolOption) {
    const wanted = toolOption.toLowerCase();
    const match = Object.keys(paths).find((tool) => tool.toLowerCase() === wanted);
    if (!match) {
      fail(`Unknown agent "${toolOption}". Configured agents: ${Object.keys(paths).join(', ')}.`);
      return null;
    }
    return match;
  }
  const installed: string[] = [];
  for (const [tool, toolPath] of Object.entries(paths)) {
    if (toolPath[field] && (await isToolInstalledForConfig(tool, toolPath[field]!, userView))) {
      installed.push(tool);
    }
  }
  if (installed.length === 0) {
    fail(`No installed agent with a ${field} path. Run the agent once, or pass --agent <tool>.`);
    return null;
  }
  if (installed.length === 1) return installed[0]!;
  if (!isInteractive()) {
    fail(`Several agents are installed (${installed.join(', ')}). Pass --agent <tool> to pick the target.`);
    return null;
  }
  console.log('');
  console.log(`Which agent should this ${field === 'skills' ? 'skill' : 'rule'} be installed to?`);
  installed.forEach((tool, index) => console.log(`  ${index + 1}. ${tool}`));
  console.log('');
  const indices = await askSelection(
    `Choose agent [1-${installed.length}] (default: 1 = ${installed[0]}): `,
    installed.length,
    false,
  );
  const choice = indices && indices.length > 0 ? indices[0]! : 0;
  return installed[choice] ?? installed[0]!;
}

function describeConflict(plan: Extract<SharedGetPlan, { action: 'conflict' }>, target: string): string {
  switch (plan.reason) {
    case 'unmanaged':
      return `Target already exists and was not installed by \`teamai get\`: ${target}. `
        + 'Move it aside, or pass --force to take it over (its content will be replaced).';
    case 'local-changes':
      return `Target has local changes since the last get: ${target}. The team repo copy is unchanged. `
        + 'Keep your edits, or pass --force to discard them and reinstall the team copy.';
    case 'both-changed':
      return `Both sides changed: ${target} was edited locally and the team repo copy moved on. `
        + 'Reconcile them manually, or pass --force to overwrite the local copy with the team copy.';
  }
}

/** Persist (or replace) the install record after a successful write. */
async function recordSharedInstall(
  ctx: Ctx,
  record: {
    type: 'skills' | 'rules';
    name: string;
    agent: string;
    sourceRelPath: string;
    sourceSha: string;
    deployedSha: string;
  },
): Promise<void> {
  const state = await loadStateForScope(await userStateConfig(ctx));
  const entry: SharedInstallRecord = {
    type: record.type,
    name: record.name,
    agent: record.agent,
    sourceRelPath: record.sourceRelPath,
    sourceSha256: record.sourceSha,
    deployedSha256: record.deployedSha,
    lastSyncedAt: new Date().toISOString(),
  };
  state.sharedInstalls = { ...state.sharedInstalls, [sharedInstallKey(record.type, record.agent, record.name)]: entry };
  await saveStateForScope(state, await userStateConfig(ctx));
}

async function loadSharedInstall(
  ctx: Ctx,
  type: 'skills' | 'rules',
  agent: string,
  name: string,
): Promise<SharedInstallRecord | undefined> {
  const state = await loadStateForScope(await userStateConfig(ctx));
  return state.sharedInstalls?.[sharedInstallKey(type, agent, name)];
}

// ─── Command entry ──────────────────────────────────────

function fail(msg: string): void {
  log.error(msg);
  process.exitCode = 1;
}

function usage(hint?: string): void {
  if (hint) log.error(hint);
  log.error(
    [
      'Usage:',
      '  teamai get list [skills|rules]',
      '  teamai get skills <name> [--agent <tool>] [--refresh] [--force]',
      '  teamai get rules  <name> [--agent <tool>] [--refresh] [--force]',
      'Shared get installs into the chosen agent\'s user-global directory and never writes project files.',
      'Options: --refresh fast-forwards the local clone first (default: offline)',
    ].join('\n'),
  );
  process.exitCode = 1;
}

/** Why the legacy docs/wiki mirror modes are gone and what replaces them. */
function legacyMirrorRemoved(type: string): string {
  return `\`get ${type}\` has been removed. It used to mirror team ${type} into the local `
    + '(project) directory; project docs/wiki are now one-way published by `teamai push` '
    + '(docs/<projectId>/, .wiki/<projectId>/) and read from the team repo clone, and pull '
    + 'never deploys or cleans them.';
}

function namespacedOnlyError(kind: 'Skill' | 'Rule', name: string, copies: string[]): string {
  return `${kind} "${name}" exists only outside the shared area (under ${copies.join(', ')}). `
    + 'Namespace resources are not shared: they arrive via `teamai pull` where the namespace is active.';
}

async function printType(ctx: Ctx, type: GetType): Promise<void> {
  const entries = await listTypeEntries(ctx.repo, type);
  if (entries.length === 0) {
    log.info(`  (no shared ${type} in team repo)`);
    return;
  }
  for (const e of entries) log.info(`  ${e}`);
}

export async function detectContext(): Promise<Ctx | null> {
  let projectConfig: LocalConfig | null = null;
  try {
    projectConfig = await detectProjectConfig();
  } catch {
    projectConfig = null;
  }
  if (projectConfig) {
    const teamConfig = await loadTeamConfig(projectConfig.repo.localPath);
    if (!teamConfig) {
      fail('Team config (teamai.yaml) not found. Check your repo path.');
      return null;
    }
    return {
      repo: projectConfig.repo.localPath,
      localConfig: projectConfig,
      teamConfig,
      scope: 'project',
      projectRoot: projectConfig.projectRoot ?? process.cwd(),
    };
  }
  const userConfig = await loadLocalConfigForScope('user');
  if (!userConfig) {
    fail('teamai is not initialized. Run `teamai init` first.');
    return null;
  }
  const teamConfig = await loadTeamConfig(userConfig.repo.localPath);
  if (!teamConfig) {
    fail('Team config (teamai.yaml) not found. Check your repo path.');
    return null;
  }
  return {
    repo: userConfig.repo.localPath,
    localConfig: userConfig,
    teamConfig,
    scope: 'user',
    projectRoot: process.cwd(),
  };
}

export async function get(options: GetOptions): Promise<void> {
  const rawType = options.type;
  // The explicit agent flag wins; the legacy positional tool argument is an alias.
  const toolOption = options.agent ?? options.tool;
  if (rawType === 'docs' || rawType === 'wiki') {
    fail(legacyMirrorRemoved(rawType));
    return;
  }
  if (!rawType || rawType === 'list') {
    const ctx = await detectContext();
    if (!ctx) return;
    const filter = rawType === 'list' ? (options.name as GetType | undefined) : undefined;
    if (filter && filter !== 'skills' && filter !== 'rules') {
      usage(`\`get list\` covers the shared area only (${SHARED_TYPES.join('|')}).`);
      return;
    }
    if (!filter) log.info('[get] scope: shared, types: skills,rules');
    const types: GetType[] = filter ? [filter] : [...SHARED_TYPES];
    for (const t of types) {
      log.info(`[${t}]`);
      await printType(ctx, t);
    }
    return;
  }
  if (!(SHARED_TYPES as readonly string[]).includes(rawType)) {
    usage();
    return;
  }
  const type = rawType as GetType;
  const name = options.name;
  const force = options.force === true;
  if (name && !isValidName(name)) return fail(`Invalid path: ${name}`);

  const ctx = await detectContext();
  if (!ctx) return;

  if (options.refresh) {
    try {
      await pullRepo(ctx.repo);
    } catch (e) {
      // A failed refresh must not read as "up to date": the entries below come
      // from the existing clone at whatever revision it holds.
      log.warn(`Refresh failed, using the existing clone (may be stale): ${(e as Error).message}`);
    }
  }

  if (type === 'skills') {
    if (!name) {
      await printType(ctx, 'skills');
      return;
    }
    const { source: src, namespacedOnly } = await resolveSharedSkillSource(path.join(ctx.repo, 'skills'), name);
    if (!src) {
      if (namespacedOnly.length > 0) return fail(namespacedOnlyError('Skill', name, namespacedOnly));
      fail(`Skill not found in the shared area: ${name}. Available:`);
      await printType(ctx, 'skills');
      return;
    }
    const agent = await resolveTargetAgent(ctx, 'skills', toolOption);
    if (!agent) return;
    const userView = userScopeView(ctx.localConfig);
    const toolPath = scopedToolPaths(ctx.teamConfig, userView)[agent]!;
    const target = path.join(resolveToolBaseDir(agent, userView), toolPath.skills!, name);
    log.info(
      `[get] scope: shared, type=skills, resource=${name}, agent=${agent}, source=${src}, target=${target}`,
    );

    const sourceSha = await dirDigest(src);
    const targetSha = await dirDigest(target);
    const record = await loadSharedInstall(ctx, 'skills', agent, name);
    const plan = planSharedGet({
      hasRecord: record !== undefined,
      sourceSha,
      targetSha,
      baselineSourceSha: record?.sourceSha256,
      baselineDeployedSha: record?.deployedSha256,
    });
    if (plan.action === 'unchanged') {
      log.success(`✓ ${name} is up to date for ${agent} (${target})`);
      return;
    }
    if (plan.action === 'conflict' && !force) {
      fail(describeConflict(plan, target));
      return;
    }
    if (plan.action === 'conflict') {
      log.warn(`--force: overwriting the conflicted target ${target}`);
    }
    await fse.remove(target);
    await fse.ensureDir(path.dirname(target));
    await fse.copy(src, target);
    const deployedSha = await dirDigest(target);
    if (sourceSha === null || deployedSha === null) {
      return fail(`Cannot verify the installed copy at ${target}`);
    }
    await recordSharedInstall(ctx, {
      type: 'skills',
      name,
      agent,
      sourceRelPath: `skills/${name}`,
      sourceSha,
      deployedSha,
    });
    log.success(`✓ ${name} → ${target} (${plan.action === 'install' ? 'installed' : 'updated'})`);
    log.info('Tracked by `teamai get`; a later get reports conflicts instead of overwriting local edits.');
    return;
  }

  // type === 'rules'
  if (!name) {
    await printType(ctx, 'rules');
    return;
  }
  const { source: src, namespacedOnly } = await resolveSharedRuleSource(path.join(ctx.repo, 'rules'), name);
  if (!src) {
    if (namespacedOnly.length > 0) return fail(namespacedOnlyError('Rule', name, namespacedOnly));
    fail(`Rule not found in the shared area: ${name}. Available:`);
    await printType(ctx, 'rules');
    return;
  }
  const agent = await resolveTargetAgent(ctx, 'rules', toolOption);
  if (!agent) return;
  const stem = path.basename(src).replace(/\.md$/, '');
  const userView = userScopeView(ctx.localConfig);
  const toolPath = scopedToolPaths(ctx.teamConfig, userView)[agent]!;
  const destDir = path.join(resolveToolBaseDir(agent, userView), toolPath.rules!);
  const dest = path.join(destDir, `${stem}${ruleFileExtensionForTool(agent)}`);
  log.info(`[get] scope: shared, type=rules, resource=${stem}, agent=${agent}, source=${src}, target=${dest}`);

  const raw = await readFileSafe(src);
  if (raw === null) return fail(`Cannot read rule source: ${src}`);
  let deployedContent: string;
  if (usesCursorMdcRules(agent)) deployedContent = teamRuleToCursorMdc(raw);
  else if (usesCopilotInstructions(agent)) deployedContent = teamRuleToCopilotInstructions(raw);
  else deployedContent = raw;
  const sourceSha = crypto.createHash('sha256').update(raw, 'utf-8').digest('hex');
  const targetSha = (await pathExists(dest)) ? await fileDigest(dest) : null;
  const record = await loadSharedInstall(ctx, 'rules', agent, stem);
  // The baseline deployed digest tracks the RENDERED bytes this machine
  // wrote, so a local edit is detected per agent format, not per source.
  const plan = planSharedGet({
    hasRecord: record !== undefined,
    sourceSha,
    targetSha,
    baselineSourceSha: record?.sourceSha256,
    baselineDeployedSha: record?.deployedSha256,
  });
  if (plan.action === 'unchanged') {
    log.success(`✓ ${stem} is up to date for ${agent} (${dest})`);
    return;
  }
  if (plan.action === 'conflict' && !force) {
    fail(describeConflict(plan, dest));
    return;
  }
  if (plan.action === 'conflict') {
    log.warn(`--force: overwriting the conflicted target ${dest}`);
  }
  await fse.ensureDir(destDir);
  await fse.writeFile(dest, deployedContent, 'utf-8');
  // Mirror official RulesHandler: drop legacy `.md` copies that these tools ignore.
  if (usesCursorMdcRules(agent) || usesCopilotInstructions(agent)) {
    await fse.remove(path.join(destDir, `${stem}.md`));
  }
  const deployedSha = await fileDigest(dest);
  if (sourceSha === null || deployedSha === null) {
    return fail(`Cannot verify the installed copy at ${dest}`);
  }
  await recordSharedInstall(ctx, {
    type: 'rules',
    name: stem,
    agent,
    sourceRelPath: `rules/${stem}.md`,
    sourceSha,
    deployedSha,
  });
  log.success(`✓ ${stem} → ${dest} (${plan.action === 'install' ? 'installed' : 'updated'})`);
  log.info("Tracked by `teamai get`; a later get reports conflicts instead of overwriting local edits.");
}
