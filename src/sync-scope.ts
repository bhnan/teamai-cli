/**
 * Scope resolution shared by `push`, `pull` and `get` (007).
 *
 * The three commands are project-scoped (pull/push) or shared-scoped (get)
 * file operations. Before any of them touches a file it must resolve an
 * explicit scope: which logical project, which agent's tool paths, which
 * resource types. None of that may be guessed from the folder name or fall
 * back silently to the user-global directories.
 */
import type { LocalConfig, TeamaiConfig, ToolPaths } from './types.js';
import { scopedToolPaths } from './types.js';
import { loadProjectsManifest, listProjectIds, type ProjectsManifest } from './projects.js';

/** The only resource types a project `pull` may deploy (007 boundary). */
export const PULL_RESOURCE_TYPES = ['skills', 'rules', 'env', 'agents'] as const;
export type PullResourceType = (typeof PULL_RESOURCE_TYPES)[number];

/** The resource types a project `push` may publish (docs/wiki are one-way). */
export const PUSH_RESOURCE_TYPES = ['skills', 'rules', 'docs', 'env', 'agents', 'wiki'] as const;
export type PushResourceType = (typeof PUSH_RESOURCE_TYPES)[number];

export class ScopeError extends Error {
  constructor(message: string, readonly exitCode = 2) {
    super(message);
    this.name = 'ScopeError';
  }
}

/**
 * Parse a comma-separated `--types` list against the allowed set for the
 * command. `docs` and `wiki` are named separately in the pull rejection so no
 * hidden mirror mode can be reached through them.
 */
export function parseResourceTypes<T extends string>(
  input: string | undefined,
  allowed: readonly T[],
): T[] {
  if (!input) return [...allowed];
  const requested = input.split(',').map((t) => t.trim()).filter(Boolean);
  if (requested.length === 0) {
    throw new ScopeError(`--types cannot be empty. Allowed: ${allowed.join(', ')}.`);
  }
  for (const type of requested) {
    if ((type === 'docs' || type === 'wiki') && !(allowed as readonly string[]).includes(type)) {
      throw new ScopeError(
        `Resource type "${type}" is not managed by pull. Project docs and wiki are one-way published by push; `
        + 'read published copies from the team repo clone instead.',
      );
    }
    if (!(allowed as readonly string[]).includes(type)) {
      throw new ScopeError(`Unknown resource type "${type}". Allowed: ${allowed.join(', ')}.`);
    }
  }
  return [...new Set(requested)] as T[];
}

/** How a project-scoped command resolved the project it operates on. */
export interface ProjectScopeResolution {
  projectId: string;
  manifest: ProjectsManifest;
  /** True when the id was derived from a single active project, not passed in. */
  derived: boolean;
}

/**
 * Resolve the project a push/pull run operates on. `--project`, when given,
 * must be a project this directory has active AND the team manifest declares.
 * Without the flag the single active project derives; anything else is an
 * error listing the candidates — never a guess from the folder name.
 */
export async function resolveProjectScope(
  localConfig: LocalConfig,
  requestedId: string | undefined,
): Promise<ProjectScopeResolution> {
  if (localConfig.scope !== 'project' || !localConfig.projectRoot) {
    throw new ScopeError(
      'teamai must run inside an initialized project scope for this command. '
      + 'Run `teamai init` in your project directory (scope defaults to project). '
      + 'A user-scope install cannot sync project resources.',
    );
  }
  const manifest = await loadProjectsManifest(localConfig.repo.localPath);
  const active = localConfig.projects ?? [];
  const known = manifest ? new Set(listProjectIds(manifest)) : new Set<string>();

  if (requestedId !== undefined) {
    if (!known.has(requestedId)) {
      throw new ScopeError(
        manifest
          ? `Project "${requestedId}" is not declared in manifest/projects.yaml. Declared: ${[...known].join(', ') || '(none)'}.`
          : 'This team repo defines no projects (no manifest/projects.yaml), so --project cannot be resolved.',
      );
    }
    if (!active.includes(requestedId)) {
      throw new ScopeError(
        `Project "${requestedId}" is not active in this directory. Active: ${active.join(', ') || '(none)'}. `
        + `Run \`teamai projects set ${requestedId}\` to activate it first.`,
      );
    }
    return { projectId: requestedId, manifest: manifest!, derived: false };
  }

  if (active.length === 1 && known.has(active[0]!)) {
    return { projectId: active[0], manifest: manifest!, derived: true };
  }
  if (active.length === 1) {
    throw new ScopeError(
      `Active project "${active[0]}" is not declared in manifest/projects.yaml. Ask an admin to add it, or clear it with \`teamai projects set\`.`,
    );
  }
  throw new ScopeError(
    active.length === 0
      ? 'No active project in this directory. Pass --project <id> or run `teamai projects set <id>`. '
        + `Declared projects: ${[...known].join(', ') || '(none)'}.`
      : `Multiple projects are active here (${active.join(', ')}). Pass --project <id> to pick one.`,
  );
}

/**
 * The single project a no-flag docs/wiki publish may derive, when it matters.
 * A team without project partitioning (no manifest, no active projects) has
 * nothing to derive — the caller reports `unconfigured` and skips publishing
 * rather than guessing. `ambiguous` names the candidates when several are
 * active and none was named.
 */
export async function deriveSingleActiveProject(
  localConfig: LocalConfig,
): Promise<{ projectId: string | null; ambiguous?: string[] }> {
  const manifest = await loadProjectsManifest(localConfig.repo.localPath);
  const known = manifest ? new Set(listProjectIds(manifest)) : new Set<string>();
  const active = (localConfig.projects ?? []).filter((id) => known.has(id));
  if (active.length === 1) return { projectId: active[0]! };
  if (active.length > 1) return { projectId: null, ambiguous: active };
  return { projectId: null };
}

/**
 * `teamConfig.toolPaths` narrowed to one agent, so a `--agent` run scans,
 * deploys and records only that agent's directories. Unknown agent ids fail
 * before anything is written.
 */
export function filterToolPathsForAgent(
  teamConfig: TeamaiConfig,
  localConfig: LocalConfig,
  agent: string | undefined,
): Record<string, ToolPaths> {
  const all = scopedToolPaths(teamConfig, localConfig);
  if (!agent) return all;
  const wanted = agent.toLowerCase();
  const match = Object.keys(all).find((tool) => tool.toLowerCase() === wanted);
  if (!match) {
    throw new ScopeError(
      `Unknown agent "${agent}". Configured agents: ${Object.keys(all).join(', ')}.`,
    );
  }
  return { [match]: all[match]! };
}
