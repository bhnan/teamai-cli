/**
 * `teamai put` (007) — publish one local skill or rule into the team repo's
 * SHARED area. The counterpart of `get`: what `put` publishes to
 * `skills/<name>` / `rules/<name>.md` is exactly what every teammate can
 * `teamai get` into their agent's global directory.
 *
 * Destination is the shared root by default; `--namespace <ns>` targets
 * `skills/<ns>/<name>` for a role/project namespace. Publishing goes through
 * the same provider branch/PR flow as `push` (`pushGroup`): the clone's
 * default branch is never committed to directly and the local working tree is
 * rolled back if any step fails.
 */
import os from 'node:os';
import path from 'node:path';
import { loadStateForScope, saveStateForScope } from './config.js';
import { detectContext } from './get-cmd.js';
import { pushGroup } from './push.js';
import { assertSafeResourceName } from './utils/path-safety.js';
import { pathExists } from './utils/fs.js';
import { log } from './utils/logger.js';
import type { GlobalOptions, ResourceItem } from './types.js';

const PUT_TYPES = ['skills', 'rules'] as const;
type PutType = (typeof PUT_TYPES)[number];

export interface PutOptions extends GlobalOptions {
  type?: string;
  name?: string;
  namespace?: string;
}

function fail(msg: string): void {
  log.error(msg);
  process.exitCode = 1;
}

function usage(hint?: string): void {
  if (hint) log.error(hint);
  log.error(
    [
      'Usage:',
      '  teamai put skills <path> [--namespace <ns>]',
      '  teamai put rules  <path> [--namespace <ns>]',
      'Publishes one local resource into the team repo shared area via the provider branch/PR flow.',
      'Default destination is the shared root (skills/<name>, rules/<name>.md); --namespace targets skills/<ns>/<name>.',
      'The shared root is what `teamai get` serves to every teammate.',
    ].join('\n'),
  );
  process.exitCode = 1;
}

/** Expand `~` and resolve the user-supplied source reference to an absolute path. */
export function resolvePutSourcePath(input: string): string {
  if (input.startsWith('~')) {
    return path.join(os.homedir(), input.slice(1).replace(/^[/\\]+/, ''));
  }
  return path.resolve(input);
}

/**
 * Build the team-repo-relative destination for a put (pure, unit-tested):
 * the shared root by default, a namespace dir with `--namespace`.
 */
export function putRelativePath(type: PutType, name: string, namespace?: string): string {
  const leaf = type === 'rules' ? `${name}.md` : name;
  return namespace ? `${type}/${namespace}/${leaf}` : `${type}/${leaf}`;
}

export async function put(options: PutOptions): Promise<void> {
  const rawType = options.type;
  if (!rawType || !(PUT_TYPES as readonly string[]).includes(rawType)) {
    usage(rawType ? `Unknown resource type "${rawType}". put publishes skills or rules.` : undefined);
    return;
  }
  const type = rawType as PutType;
  const input = options.name;
  if (!input) {
    usage(`put ${type} needs a local ${type === 'skills' ? 'skill directory' : 'rule file'} path.`);
    return;
  }
  if (input.includes('..')) return fail(`Invalid path: ${input}`);

  const namespace = options.namespace;
  if (namespace !== undefined) {
    try {
      assertSafeResourceName(namespace);
    } catch (e) {
      return fail(`Invalid --namespace argument: ${(e as Error).message}`);
    }
  }

  const ctx = await detectContext();
  if (!ctx) return;

  const sourcePath = resolvePutSourcePath(input);
  let name: string;
  if (type === 'skills') {
    if (!(await pathExists(path.join(sourcePath, 'SKILL.md')))) {
      return fail(`Not a skill directory (no SKILL.md): ${sourcePath}`);
    }
    name = path.basename(sourcePath);
  } else {
    if (!(await pathExists(sourcePath)) || !sourcePath.endsWith('.md')) {
      return fail(`Not a rule file (.md): ${sourcePath}`);
    }
    name = path.basename(sourcePath).replace(/\.md$/, '');
  }
  try {
    assertSafeResourceName(name);
  } catch (e) {
    return fail(`Invalid ${type.slice(0, -1)} name "${name}": ${(e as Error).message}`);
  }

  const relativePath = putRelativePath(type, name, namespace);
  const existsInRepo = await pathExists(path.join(ctx.repo, relativePath));
  const item: ResourceItem = {
    name,
    type,
    sourcePath,
    relativePath,
    status: existsInRepo ? 'modified' : 'new',
    namespace,
  };

  log.info(
    `[put] scope: shared, type=${type}, resource=${name}, destination=${relativePath} `
      + `(${namespace ? `namespace ${namespace}` : 'shared root'}), source=${sourcePath}`,
  );

  if (options.dryRun) {
    // Read-only resolution above touched nothing; publishing (team repo copy,
    // branch, PR, pending-push record) all happen inside pushGroup, which a
    // dry run never reaches.
    log.info(
      `[dry-run] Would publish ${sourcePath} → ${relativePath} `
        + `(${namespace ? `namespace ${namespace}` : 'shared root'}) via the provider branch/PR flow. `
        + 'Nothing was written and no branch was pushed.',
    );
    return;
  }

  const pushState = await loadStateForScope(ctx.localConfig);
  const outcome = await pushGroup({
    group: { items: [item] },
    teamConfig: ctx.teamConfig,
    localConfig: ctx.localConfig,
    pushState,
    includeTeamConfig: false,
  });
  await saveStateForScope(pushState, ctx.localConfig);

  if (outcome === 'failed') {
    process.exitCode = 1;
    return;
  }
  if (outcome === 'nochange') {
    log.success(`✓ ${relativePath} is already up to date in the team repo`);
    return;
  }
  // 'pushed' and 'pr-failed' both have the branch on the remote; pushGroup
  // already reported the PR outcome and set the exit code for pr-failed.
  log.info(
    outcome === 'pushed'
      ? `Once merged, teammates install it with: teamai get ${type} ${name} --agent <tool>`
      : 'The branch is on the remote; create the PR manually, then teammates can install it with '
        + `\`teamai get ${type} ${name} --agent <tool>\`.`,
  );
}
