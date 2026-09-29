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
import { resolveDocsDestination } from './resources/docs.js';
import { listDirs, listFilesRecursive, pathExists, readFileSafe } from './utils/fs.js';
import { pullRepo } from './utils/git.js';
import { log } from './utils/logger.js';
import { getUserHome } from './utils/home.js';
import { askSelection, isInteractive } from './utils/prompt.js';

const TYPES = ['skills', 'rules', 'docs', 'wiki'] as const;
type GetType = (typeof TYPES)[number];

/** The shared boundary `get` operates on (007): skills and rules only. */
const SHARED_TYPES: readonly GetType[] = ['skills', 'rules'];

export interface GetOptions extends GlobalOptions {
  type?: string;
  name?: string;
  tool?: string;
  agent?: string;
  all?: boolean;
  diff?: boolean;
  prune?: boolean;
  force?: boolean;
  refresh?: boolean;
}

interface Ctx {
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

/** Resolve `skills/<name>` or `skills/<ns>/<name>`; null when absent; throws on ambiguity. */
export async function resolveSkillSource(repoSkills: string, name: string): Promise<string | null> {
  const flat = path.join(repoSkills, name, 'SKILL.md');
  if (await pathExists(flat)) return path.join(repoSkills, name);
  const cands: string[] = [];
  for (const d of await listDirs(repoSkills)) {
    const cand = path.join(repoSkills, d, name, 'SKILL.md');
    if (await pathExists(cand)) cands.push(path.join(repoSkills, d, name));
  }
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    throw new Error(
      `'${name}' exists in multiple namespaces:\n  ${cands
        .map((c) => `${path.basename(path.dirname(c))}/${path.basename(c)}`)
        .join('\n  ')}`,
    );
  }
  return null;
}

/** Resolve a rule by exact relative path, `name`/`name.md`, or unique basename (any depth). */
export async function resolveRuleSource(repoRules: string, name: string): Promise<string | null> {
  const base = name.replace(/\.md$/, '');
  const exact = path.join(repoRules, name);
  if (await pathExists(exact)) return exact;
  const exactMd = path.join(repoRules, `${base}.md`);
  if (await pathExists(exactMd)) return exactMd;
  const cands: string[] = [];
  for (const rel of await listFilesRecursive(repoRules)) {
    if (!rel.endsWith('.md')) continue;
    const fileBase = path.basename(rel).replace(/\.md$/, '');
    if (fileBase === base || rel === name) cands.push(path.join(repoRules, rel));
  }
  if (cands.length === 1) return cands[0];
  if (cands.length > 1) {
    throw new Error(`'${name}' matched multiple rule files:\n  ${cands.join('\n  ')}`);
  }
  return null;
}

/** Resolve a doc by relative path; `.md` suffix optional (target keeps the real name). */
export async function resolveDocsSource(repoDocs: string, name: string): Promise<string | null> {
  const exact = path.join(repoDocs, name);
  if (await pathExists(exact)) return exact;
  const withMd = path.join(repoDocs, `${name}.md`);
  if (await pathExists(withMd)) return withMd;
  return null;
}

/** Discover pullable entries per type (what `get list` prints). */
export async function listTypeEntries(repo: string, type: GetType): Promise<string[]> {
  const dirFor: Record<GetType, string> = { skills: 'skills', rules: 'rules', docs: 'docs', wiki: '.wiki' };
  const root = path.join(repo, dirFor[type]);
  if (!(await pathExists(root))) return [];
  if (type === 'skills') {
    const out: string[] = [];
    for (const d of await listDirs(root)) {
      if (await pathExists(path.join(root, d, 'SKILL.md'))) {
        out.push(d);
        continue;
      }
      for (const sub of await listDirs(path.join(root, d))) {
        if (await pathExists(path.join(root, d, sub, 'SKILL.md'))) out.push(`${d}/${sub}`);
      }
    }
    return out.sort();
  }
  const files = await listFilesRecursive(root);
  return files.filter((f) => (type === 'docs' ? !hasDotSegment(f) : f.endsWith('.md') && !hasDotSegment(f))).sort();
}

/** Compare the team repo wiki against the local wiki (read-only). */
export async function computeWikiDiff(
  srcWiki: string,
  dstWiki: string,
): Promise<{ onlyInSrc: string[]; onlyInDst: string[]; changed: string[] }> {
  const srcFiles = (await pathExists(srcWiki))
    ? (await listFilesRecursive(srcWiki)).filter((f) => f.endsWith('.md') && !hasDotSegment(f)).sort()
    : [];
  const dstFiles = (await pathExists(dstWiki))
    ? (await listFilesRecursive(dstWiki)).filter((f) => f.endsWith('.md') && !hasDotSegment(f)).sort()
    : [];
  const dstSet = new Set(dstFiles);
  const srcSet = new Set(srcFiles);
  const onlyInSrc = srcFiles.filter((f) => !dstSet.has(f));
  const onlyInDst = dstFiles.filter((f) => !srcSet.has(f));
  const changed: string[] = [];
  for (const f of srcFiles) {
    if (!dstSet.has(f)) continue;
    const a = await readFileSafe(path.join(srcWiki, f));
    const b = await readFileSafe(path.join(dstWiki, f));
    if (a !== b) changed.push(f);
  }
  return { onlyInSrc, onlyInDst, changed };
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
  const state = await loadStateForScope(ctx.localConfig);
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
  await saveStateForScope(state, ctx.localConfig);
}

async function loadSharedInstall(
  ctx: Ctx,
  type: 'skills' | 'rules',
  agent: string,
  name: string,
): Promise<SharedInstallRecord | undefined> {
  const state = await loadStateForScope(ctx.localConfig);
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
      'Deprecated (legacy mirror, kept for compatibility):',
      '  teamai get docs <name>|--all [--prune]   # mirror team docs into the local docs dir',
      '  teamai get wiki [page] [--diff|--prune]  # mirror team wiki',
      'Shared get installs into the chosen agent\'s user-global directory and never writes project files.',
      'Options: --refresh fast-forwards the local clone first (default: offline)',
    ].join('\n'),
  );
  process.exitCode = 1;
}

function hasDotSegment(relativePath: string): boolean {
  return relativePath.split('/').some((segment) => segment.startsWith('.'));
}

function deprecationWarning(type: 'docs' | 'wiki'): void {
  log.warn(
    `[deprecated] \`get ${type}\` is a legacy mirror kept for compatibility. Project ${type} are now one-way `
      + 'published by `teamai push` and read from the team repo clone; this command may be removed in a future release.',
  );
}

async function printType(ctx: Ctx, type: GetType): Promise<void> {
  const entries = await listTypeEntries(ctx.repo, type);
  if (entries.length === 0) {
    log.info(`  (no ${type} in team repo)`);
    return;
  }
  for (const e of entries) log.info(`  ${e}`);
}

async function detectContext(): Promise<Ctx | null> {
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
  if (!rawType || rawType === 'list') {
    const ctx = await detectContext();
    if (!ctx) return;
    const filter = rawType === 'list' ? (options.name as GetType | undefined) : undefined;
    if (filter && !(TYPES as readonly string[]).includes(filter)) {
      usage();
      return;
    }
    if (!filter) {
      log.info('[get] scope: shared, types: skills,rules (docs/wiki: pass the type explicitly)');
    }
    // Default listing keeps to the shared boundary; docs/wiki stay reachable
    // for legacy users, with their deprecation said out loud.
    const types: GetType[] = filter ? [filter] : [...SHARED_TYPES];
    for (const t of types) {
      if (t === 'docs' || t === 'wiki') deprecationWarning(t);
      log.info(`[${t}]`);
      await printType(ctx, t);
    }
    return;
  }
  if (!(TYPES as readonly string[]).includes(rawType)) {
    usage();
    return;
  }
  const type = rawType as GetType;
  const name = options.name;
  const all = options.all === true;
  const diff = options.diff === true;
  const prune = options.prune === true;
  const force = options.force === true;

  // Option/type combination validation (fail fast before touching anything).
  if (diff && type !== 'wiki') return usage('`--diff` applies to wiki only');
  if (all && type !== 'docs') return usage('`--all` applies to docs only');
  if (prune && type !== 'wiki' && type !== 'docs') return usage('`--prune` applies to mirror modes only');
  if (type === 'wiki' && diff && prune) return usage('`--diff` is read-only; `--prune` not applicable');
  if (all && name) return usage('`--all` mirrors the whole directory; drop the name');
  if (diff && name) return usage('`--diff` previews the whole wiki; drop the name');
  if ((type === 'docs' || type === 'wiki') && toolOption) return usage('`--agent` applies to skills/rules only');
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

  switch (type) {
    case 'skills': {
      if (!name) {
        await printType(ctx, 'skills');
        return;
      }
      let src: string | null;
      try {
        src = await resolveSkillSource(path.join(ctx.repo, 'skills'), name);
      } catch (e) {
        fail((e as Error).message);
        return;
      }
      if (!src) {
        fail(`Skill not found in team repo: ${name}. Available:`);
        await printType(ctx, 'skills');
        return;
      }
      const agent = await resolveTargetAgent(ctx, 'skills', toolOption);
      if (!agent) return;
      // Resource identity is the repo-relative path (`ns/name`), so a flat and a
      // namespaced skill of the same leaf name never share a record.
      const identity = path.relative(path.join(ctx.repo, 'skills'), src).split(path.sep).join('/');
      const userView = userScopeView(ctx.localConfig);
      const toolPath = scopedToolPaths(ctx.teamConfig, userView)[agent]!;
      const target = path.join(resolveToolBaseDir(agent, userView), toolPath.skills!, name);
      log.info(
        `[get] scope: shared, type=skills, resource=${identity}, agent=${agent}, source=${src}, target=${target}`,
      );

      const sourceSha = await dirDigest(src);
      const targetSha = await dirDigest(target);
      const record = await loadSharedInstall(ctx, 'skills', agent, identity);
      const plan = planSharedGet({
        hasRecord: record !== undefined,
        sourceSha,
        targetSha,
        baselineSourceSha: record?.sourceSha256,
        baselineDeployedSha: record?.deployedSha256,
      });
      if (plan.action === 'unchanged') {
        log.success(`✓ ${identity} is up to date for ${agent} (${target})`);
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
        name: identity,
        agent,
        sourceRelPath: `skills/${identity}`,
        sourceSha,
        deployedSha,
      });
      log.success(`✓ ${identity} → ${target} (${plan.action === 'install' ? 'installed' : 'updated'})`);
      log.info('Tracked by `teamai get`; a later get reports conflicts instead of overwriting local edits.');
      return;
    }

    case 'rules': {
      if (!name) {
        await printType(ctx, 'rules');
        return;
      }
      let src: string | null;
      try {
        src = await resolveRuleSource(path.join(ctx.repo, 'rules'), name);
      } catch (e) {
        fail((e as Error).message);
        return;
      }
      if (!src) {
        fail(`Rule not found in team repo: ${name}. Available:`);
        await printType(ctx, 'rules');
        return;
      }
      const agent = await resolveTargetAgent(ctx, 'rules', toolOption);
      if (!agent) return;
      const rel = path.relative(path.join(ctx.repo, 'rules'), src);
      const stem = rel.replace(/\.md$/, '').split(path.sep).join('/');
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
      await recordSharedInstall(ctx, {
        type: 'rules',
        name: stem,
        agent,
        sourceRelPath: `rules/${rel}`.split(path.sep).join('/'),
        sourceSha,
        deployedSha,
      });
      log.success(`✓ ${stem} → ${dest} (${plan.action === 'install' ? 'installed' : 'updated'})`);
      log.info('Tracked by `teamai get`; a later get reports conflicts instead of overwriting local edits.');
      return;
    }

    case 'docs': {
      deprecationWarning('docs');
      const localDocsDir = resolveDocsDestination(ctx.teamConfig, ctx.localConfig);
      const repoDocs = path.join(ctx.repo, 'docs');
      if (all) {
        if (!(await pathExists(repoDocs))) return fail('No docs in team repo');
        await fse.ensureDir(localDocsDir);
        await fse.copy(repoDocs, localDocsDir, {
          overwrite: true,
          filter: (srcPath: string) => !path.basename(srcPath).startsWith('.'),
        });
        if (prune) {
          for (const rel of await listFilesRecursive(localDocsDir)) {
            if (hasDotSegment(rel)) continue;
            if (!(await pathExists(path.join(repoDocs, rel)))) {
              await fse.remove(path.join(localDocsDir, rel));
              log.info(`  − removed extra: ${rel}`);
            }
          }
        }
        log.info(`✓ docs mirrored → ${localDocsDir}`);
        return;
      }
      if (!name) {
        await printType(ctx, 'docs');
        return;
      }
      const src = await resolveDocsSource(repoDocs, name);
      if (!src) {
        fail(`Doc not found in team repo: ${name}. Available:`);
        await printType(ctx, 'docs');
        return;
      }
      const rel = path.relative(repoDocs, src);
      const dest = path.join(localDocsDir, rel);
      if (await pathExists(dest)) {
        if (!force) return fail(`Already exists: ${dest} (use --force to overwrite)`);
      }
      await fse.ensureDir(path.dirname(dest));
      await fse.copy(src, dest);
      log.info(`✓ ${rel} → ${dest}`);
      return;
    }

    case 'wiki': {
      deprecationWarning('wiki');
      const repoWiki = path.join(ctx.repo, '.wiki');
      const localWiki =
        ctx.scope === 'project' && ctx.localConfig.projectRoot
          ? path.join(ctx.localConfig.projectRoot, '.wiki')
          : path.join(getUserHome(), '.wiki');
      if (diff) {
        const d = await computeWikiDiff(repoWiki, localWiki);
        let any = false;
        for (const f of d.onlyInSrc) { log.info(`  + ${f} (team repo only)`); any = true; }
        for (const f of d.onlyInDst) { log.info(`  − ${f} (local only)`); any = true; }
        for (const f of d.changed) { log.info(`  ~ ${f} (differ)`); any = true; }
        if (!any) log.info('wiki is in sync');
        return;
      }
      if (name) {
        const src = await resolveDocsSource(repoWiki, name);
        if (!src) {
          fail(`Wiki page not found in team repo: ${name}. Available:`);
          await printType(ctx, 'wiki');
          return;
        }
        const rel = path.relative(repoWiki, src);
        const dest = path.join(localWiki, rel);
        if (await pathExists(dest)) {
          if (!force) return fail(`Already exists: ${dest} (use --force to overwrite)`);
        }
        await fse.ensureDir(path.dirname(dest));
        await fse.copy(src, dest);
        log.info(`✓ ${rel} → ${dest}`);
        return;
      }
      if (!(await pathExists(repoWiki))) return fail('No .wiki in team repo');
      await fse.ensureDir(localWiki);
      const copyRoot = repoWiki;
      await fse.copy(repoWiki, localWiki, {
        overwrite: true,
        filter: (srcPath: string) => srcPath === copyRoot || !path.basename(srcPath).startsWith('.'),
      });
      if (prune) {
        for (const rel of await listFilesRecursive(localWiki)) {
          if (hasDotSegment(rel) || !rel.endsWith('.md')) continue;
          if (!(await pathExists(path.join(repoWiki, rel)))) {
            await fse.remove(path.join(localWiki, rel));
            log.info(`  − removed extra: ${rel}`);
          }
        }
      }
      log.info(`✓ wiki mirrored → ${localWiki}`);
      return;
    }
  }
}
