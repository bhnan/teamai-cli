#!/usr/bin/env bash
# 007 representative E2E — real CLI against local git fixtures.
# Exercises: project-scope pull (4 types, docs rejected), one-way docs/wiki
# push (default .wiki only, named --wiki-source/--docs-source), pending-delete
# gate, shared get S/T/B tracking, user-scope rejection.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLI="$ROOT/dist/index.js"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/teamai-e2e-007-XXXXXX")"
export HOME="$WORK/home"
mkdir -p "$HOME"

pass=0; fail=0
step() { printf '\n=== %s\n' "$*"; }
ok()   { pass=$((pass+1)); echo "PASS: $*"; }
bad()  { fail=$((fail+1)); echo "FAIL: $*"; }
expect_file() { [ -f "$1" ] && ok "exists: $1" || bad "missing: $1"; }
expect_no_file() { [ ! -e "$1" ] && ok "absent: $1" || bad "should be absent: $1"; }

step "fixture: bare team repo"
TEAM="$WORK/team.git"
git init --bare -q -b main "$TEAM"
SEED="$WORK/seed"; git clone -q "$TEAM" "$SEED"
git -C "$SEED" config user.email t@t; git -C "$SEED" config user.name t
mkdir -p "$SEED/skills/demo/deploy" "$SEED/skills/onboarding" "$SEED/rules" "$SEED/rules/demo" "$SEED/manifest"
cat > "$SEED/teamai.yaml" <<YAML
team: demo-team
description: e2e fixture team
repo: file://$TEAM
provider: git
reviewers: []
toolPaths:
  claude:
    skills: .claude/skills
    rules: .claude/rules
    claudemd: CLAUDE.md
YAML
cat > "$SEED/manifest/projects.yaml" <<'YAML'
version: 1
projects:
  - id: demo
    name: Demo
    description: demo project
    resources:
      knowledge: [demo]
      skills: [demo]
      agents: []
YAML
printf -- '---\nname: deploy\ndescription: deploy workflow\n---\n\n# deploy skill\n' > "$SEED/skills/demo/deploy/SKILL.md"
printf -- '---\nname: onboarding\ndescription: shared onboarding skill\n---\n\n# onboarding skill\n' > "$SEED/skills/onboarding/SKILL.md"
echo "# style rule" > "$SEED/rules/style.md"
echo "# namespaced-only rule" > "$SEED/rules/demo/nsrule.md"
git -C "$SEED" add -A && git -C "$SEED" commit -qm "seed" && git -C "$SEED" push -q origin main

step "project scope config (init-equivalent fixture)"
# init's URL parser rejects bare local paths; seed the config it would write.
PROJ="$WORK/project"
CLONE="$WORK/team-clone"
git clone -q "$TEAM" "$CLONE"
git -C "$CLONE" config user.email p@p && git -C "$CLONE" config user.name p
mkdir -p "$PROJ/.teamai" && (cd "$PROJ" && git init -q -b main && git config user.email p@p && git config user.name p)
cat > "$PROJ/.teamai/config.yaml" <<CFG
repo:
  localPath: $CLONE
  remote: file://$TEAM
  kind: git
username: tester
updatePolicy: skip
scope: project
projectRoot: $PROJ
projects: [demo]
enabledAgents: [claude]
CFG
cd "$PROJ"
node "$CLI" doctor >/dev/null 2>&1
ok "project config seeded"

mkdir -p "$PROJ/.claude/skills" "$PROJ/.claude/rules"

step "pull: four types land, docs never deployed"
echo "# team doc" > "$SEED/docs-guide.md"
git -C "$SEED" add -A && git -C "$SEED" commit -qm doc && git -C "$SEED" push -q origin main
node "$CLI" pull >"$WORK/pull1.log" 2>&1; rc=$?
[ $rc -eq 0 ] && ok "pull exit 0" || bad "pull exit $rc"
expect_file "$PROJ/.claude/skills/deploy/SKILL.md"
expect_file "$PROJ/.claude/rules/style.md"
expect_no_file "$PROJ/.teamai/docs/docs-guide.md"
expect_no_file "$PROJ/docs-guide.md"

step "pull --types docs is rejected"
node "$CLI" pull --types docs >"$WORK/pull-docs.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "not managed by pull" "$WORK/pull-docs.log" && ok "docs type rejected" || { bad "docs type not rejected"; cat "$WORK/pull-docs.log"; }

step "push requires active --project"
node "$CLI" push --project other >"$WORK/push-bad.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -Eq "not active in this directory|not declared in manifest" "$WORK/push-bad.log" && ok "unknown/inactive project rejected" || { bad "inactive project accepted"; cat "$WORK/push-bad.log"; }

step "push: one-way docs and wiki publish (default .wiki only, others ignored)"
mkdir -p "$PROJ/docs" "$PROJ/.wiki/spec" "$PROJ/.dev_wiki" "$PROJ/.wiki_backup" "$PROJ/.dev_Wiki" "$PROJ/child/.wiki"
echo "# project handbook" > "$PROJ/docs/handbook.md"
echo "# wiki page" > "$PROJ/.wiki/spec/overview.md"
echo "# business index" > "$PROJ/.wiki/index.md"
echo "# dev index" > "$PROJ/.dev_wiki/index.md"
echo "# dev guide" > "$PROJ/.dev_wiki/guide.md"
echo "# ignored backup" > "$PROJ/.wiki_backup/ignored.md"
echo "# capital W" > "$PROJ/.dev_Wiki/capital.md"
echo "# nested child" > "$PROJ/child/.wiki/nested.md"
TEAMAI_NONINTERACTIVE=1 node "$CLI" push --all >"$WORK/push1.log" 2>&1; rc=$?
# provider git on a file:// remote opens no PR (exit 1); the pushed branch is the publish.
if [ $rc -eq 0 ] || grep -q "has been pushed" "$WORK/push1.log"; then ok "push published (rc=$rc)"; else bad "push failed rc=$rc: $(tail -5 "$WORK/push1.log")"; fi
# provider git pushes a teamai/* branch and opens no MR: merge them as a stand-in reviewer.
git -C "$SEED" fetch -q origin
git -C "$SEED" checkout -q main && git -C "$SEED" reset -q --hard origin/main
for b in $(git -C "$SEED" for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v 'origin/main$'); do
  git -C "$SEED" merge --no-edit -q "$b" || bad "merge of $b failed"
done
git -C "$SEED" push -q origin main
git -C "$SEED" show origin/main:docs/demo/handbook.md >/dev/null 2>&1 && ok "docs/demo/handbook.md on main" || bad "handbook not on main"
git -C "$SEED" show origin/main:.wiki/demo/spec/overview.md >/dev/null 2>&1 && ok ".wiki/demo/spec/overview.md on main" || bad "wiki page not on main"
git -C "$SEED" show origin/main:.wiki/demo/index.md >/dev/null 2>&1 && ok ".wiki/demo/index.md on main" || bad ".wiki index not on main"
git -C "$SEED" show origin/main:.wiki/demo_dev/index.md >/dev/null 2>&1 && bad ".dev_wiki was published without --wiki-source" || ok ".dev_wiki not published without --wiki-source"
git -C "$SEED" show origin/main:.wiki_backup/demo/ignored.md >/dev/null 2>&1 && bad ".wiki_backup was published" || ok ".wiki_backup not published"
git -C "$SEED" show origin/main:.dev_Wiki/demo/capital.md >/dev/null 2>&1 && bad ".dev_Wiki was published" || ok ".dev_Wiki (capital W) not published"
git -C "$SEED" show origin/main:child/.wiki/nested.md >/dev/null 2>&1 && bad "nested child wiki published" || ok "child/.wiki not published"

step "published baseline: unchanged second push is a no-op, remote edit is held"
TEAMAI_NONINTERACTIVE=1 node "$CLI" push --all >"$WORK/push2.log" 2>&1
grep -q "No new or modified resources to push" "$WORK/push2.log" && ok "second push no-change" || bad "second push not clean: $(grep -E 'Found|pushed' "$WORK/push2.log" | head -3)"
# Simulate a remote-side edit of the published doc.
git -C "$SEED" checkout -q main && git -C "$SEED" pull -q origin main
echo "# remote edit" >> "$SEED/docs/demo/handbook.md"
git -C "$SEED" add -A && git -C "$SEED" commit -qm "remote edit" && git -C "$SEED" push -q origin main
node "$CLI" pull -q >/dev/null 2>&1
echo "# local edit too" >> "$PROJ/docs/handbook.md"
sleep 1.2
TEAMAI_NONINTERACTIVE=1 node "$CLI" push --all >"$WORK/push3.log" 2>&1; rc=$?
grep -q "Held docs/demo/handbook.md" "$WORK/push3.log" && ok "both-changed conflict held" || bad "conflict not held: $(tail -5 "$WORK/push3.log")"
[ $rc -ne 0 ] && ok "conflict run exits non-zero" || bad "conflict run exited 0"
git -C "$SEED" show origin/main:docs/demo/handbook.md | grep -q "local edit too" && bad "held file was overwritten" || ok "remote copy untouched"

step "pending-delete: removing the project original offers deletion, non-interactive keeps it"
rm "$PROJ/docs/handbook.md"
sleep 1.2
TEAMAI_NONINTERACTIVE=1 node "$CLI" push --types docs,wiki --all >"$WORK/push4.log" 2>&1
grep -q "Kept docs/demo/handbook.md\|kept" "$WORK/push4.log" && ok "pending-delete kept non-interactively" || bad "pending-delete not kept: $(tail -5 "$WORK/push4.log")"

step "wiki: push --dry-run previews the default root and the ignored siblings"
echo "# wiki page v2" > "$PROJ/.wiki/spec/overview.md"
WIKI_DRY_BEFORE=$(git -C "$CLONE" ls-remote --heads origin | wc -l | tr -d ' ')
TEAMAI_NONINTERACTIVE=1 node "$CLI" push --types wiki --dry-run >"$WORK/push-wdry.log" 2>&1
WIKI_DRY_AFTER=$(git -C "$CLONE" ls-remote --heads origin | wc -l | tr -d ' ')
grep -q "default root: .wiki → .wiki/demo/" "$WORK/push-wdry.log" && ok "dry-run lists the default wiki root" || bad "default root line missing: $(grep '\[wiki\]' "$WORK/push-wdry.log" | head -1)"
grep -q "ignored (not specified): .dev_wiki" "$WORK/push-wdry.log" && ok "dry-run lists the ignored wiki sibling" || bad "ignored line missing: $(grep '\[wiki\]' "$WORK/push-wdry.log" | head -1)"
grep -q "\[wiki\] .wiki/spec/overview.md" "$WORK/push-wdry.log" && ok "dry-run lists the changed wiki page" || bad "dry-run preview missing the wiki item: $(tail -3 "$WORK/push-wdry.log")"
[ "$WIKI_DRY_BEFORE" = "$WIKI_DRY_AFTER" ] && ok "wiki dry-run pushed no branch" || bad "wiki dry-run changed remote branches"

step "named wiki source: --wiki-source .dev_wiki=dev publishes .wiki/demo_dev/"
TEAMAI_NONINTERACTIVE=1 node "$CLI" push --types wiki --wiki-source .dev_wiki=dev --all >"$WORK/push-wsrc.log" 2>&1; rc=$?
if [ $rc -eq 0 ] || grep -q "has been pushed" "$WORK/push-wsrc.log"; then ok "named-source push published (rc=$rc)"; else bad "named-source push failed rc=$rc: $(tail -5 "$WORK/push-wsrc.log")"; fi
grep -q "source .dev_wiki → .wiki/demo_dev/" "$WORK/push-wsrc.log" && ok "named source mapping reported" || bad "mapping not reported: $(grep '\[wiki\]' "$WORK/push-wsrc.log" | head -1)"
git -C "$SEED" fetch -q origin
git -C "$SEED" checkout -q main && git -C "$SEED" reset -q --hard origin/main
for b in $(git -C "$SEED" for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v 'origin/main$'); do
  git -C "$SEED" merge --no-edit -q "$b" || bad "merge of $b failed"
done
git -C "$SEED" push -q origin main
git -C "$SEED" show origin/main:.wiki/demo_dev/index.md >/dev/null 2>&1 && ok ".wiki/demo_dev/index.md on main" || bad "named wiki index not on main"
git -C "$SEED" show origin/main:.wiki/demo_dev/guide.md >/dev/null 2>&1 && ok ".wiki/demo_dev/guide.md on main" || bad "named wiki guide not on main"
git -C "$SEED" show origin/main:.wiki/demo/spec/overview.md | grep -q "v2" && ok ".wiki update published too" || bad ".wiki update missing"
git -C "$SEED" show origin/main:.wiki/demo/index.md | grep -q "# business index" && ok "same-named page stays isolated" || bad "default and named pages collided"

step "named wiki source: not specifying it keeps its published content untouched"
echo "# dev index v2" > "$PROJ/.dev_wiki/index.md"
TEAMAI_NONINTERACTIVE=1 node "$CLI" push --types wiki --all >"$WORK/push-unsup.log" 2>&1; rc=$?
if [ $rc -eq 0 ] || grep -q "has been pushed" "$WORK/push-unsup.log"; then ok "unspecified run published (rc=$rc)"; else bad "unspecified run failed rc=$rc: $(tail -5 "$WORK/push-unsup.log")"; fi
git -C "$SEED" fetch -q origin
git -C "$SEED" checkout -q main && git -C "$SEED" reset -q --hard origin/main
for b in $(git -C "$SEED" for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v 'origin/main$'); do
  git -C "$SEED" merge --no-edit -q "$b" || bad "merge of $b failed"
done
git -C "$SEED" push -q origin main
git -C "$SEED" show origin/main:.wiki/demo_dev/index.md | grep -q "# dev index$" && ok "unspecified named wiki untouched on main" || bad "unspecified named wiki changed on main"

step "named wiki source: an unspecified source never reads as delete-everything"
mv "$PROJ/.dev_wiki" "$PROJ/.dev_wiki_holding"
TEAMAI_NONINTERACTIVE=1 node "$CLI" push --types wiki >"$WORK/push-absent.log" 2>&1
grep -q "Kept everything published as dev" "$WORK/push-absent.log" && ok "unspecified source kept explicitly" || bad "unspecified-source protection missing: $(grep -i "pending-delete\|Kept" "$WORK/push-absent.log" | head -3)"
git -C "$SEED" show origin/main:.wiki/demo_dev/index.md >/dev/null 2>&1 && ok "unspecified source's published content still on main" || bad "unspecified source content vanished"
mv "$PROJ/.dev_wiki_holding" "$PROJ/.dev_wiki"

step "named docs source: --docs-source docs/api=api publishes docs/demo_api/ beside the default bundle"
mkdir -p "$PROJ/docs/api"
echo "# api reference" > "$PROJ/docs/api/reference.md"
TEAMAI_NONINTERACTIVE=1 node "$CLI" push --types docs --docs-source docs/api=api --dry-run >"$WORK/push-dsrc-dry.log" 2>&1
grep -q "source docs/api → docs/demo_api/" "$WORK/push-dsrc-dry.log" && ok "dry-run lists the docs source mapping" || bad "docs mapping missing: $(grep '\[docs\]' "$WORK/push-dsrc-dry.log" | head -1)"
TEAMAI_NONINTERACTIVE=1 node "$CLI" push --types docs --docs-source docs/api=api --all >"$WORK/push-dsrc.log" 2>&1; rc=$?
if [ $rc -eq 0 ] || grep -q "has been pushed" "$WORK/push-dsrc.log"; then ok "docs source push published (rc=$rc)"; else bad "docs source push failed rc=$rc: $(tail -5 "$WORK/push-dsrc.log")"; fi
git -C "$SEED" fetch -q origin
git -C "$SEED" checkout -q main && git -C "$SEED" reset -q --hard origin/main
for b in $(git -C "$SEED" for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v 'origin/main$'); do
  git -C "$SEED" merge --no-edit -q "$b" || bad "merge of $b failed"
done
git -C "$SEED" push -q origin main
git -C "$SEED" show origin/main:docs/demo_api/reference.md >/dev/null 2>&1 && ok "docs/demo_api/reference.md on main" || bad "named docs source not on main"
git -C "$SEED" show origin/main:docs/demo/api/reference.md >/dev/null 2>&1 && ok "default docs bundle still covers docs/api/" || bad "default docs scan lost docs/api/"

step "named sources: flag validation rejects bad syntax, escapes and unknown dirs"
node "$CLI" push --types wiki --wiki-source .dev_wiki >"$WORK/src-syntax.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "expects <dir>=<name>" "$WORK/src-syntax.log" && ok "missing = rejected" || bad "missing = accepted: $(tail -2 "$WORK/src-syntax.log")"
node "$CLI" push --types wiki --wiki-source ".dev_wiki=bad/name" >"$WORK/src-name.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "name .*must start with" "$WORK/src-name.log" && ok "slash in name rejected" || bad "slash in name accepted: $(tail -2 "$WORK/src-name.log")"
node "$CLI" push --types docs --docs-source "../outside=api" >"$WORK/src-escape.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "outside the project root" "$WORK/src-escape.log" && ok "path escape rejected" || bad "path escape accepted: $(tail -2 "$WORK/src-escape.log")"
node "$CLI" push --types wiki --wiki-source ".nope=api" >"$WORK/src-missing.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "not found inside the project root" "$WORK/src-missing.log" && ok "missing dir rejected" || bad "missing dir accepted: $(tail -2 "$WORK/src-missing.log")"
node "$CLI" push --types wiki --docs-source "docs/api=api" >"$WORK/src-types.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "does not include docs" "$WORK/src-types.log" && ok "types mismatch rejected" || bad "types mismatch accepted: $(tail -2 "$WORK/src-types.log")"
node "$CLI" push --types wiki --wiki-source ".wiki=main" >"$WORK/src-default.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "cannot re-specify" "$WORK/src-default.log" && ok "re-specifying the default rejected" || bad "default re-specification accepted: $(tail -2 "$WORK/src-default.log")"

step "shared get: install → unchanged → conflict → force (user-global only)"
CLAUDE_HOME="$HOME/.claude"; mkdir -p "$CLAUDE_HOME/skills"
node "$CLI" get skills onboarding --agent claude --dry-run >"$WORK/get-dry.log" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q "Would install" "$WORK/get-dry.log" && ok "get --dry-run previews install" || bad "get --dry-run preview missing: $(tail -3 "$WORK/get-dry.log")"
expect_no_file "$HOME/.claude/skills/onboarding"
node "$CLI" get skills onboarding --agent claude >"$WORK/get1.log" 2>&1; rc=$?
[ $rc -eq 0 ] && ok "get install exit 0" || bad "get install exit $rc: $(tail -3 "$WORK/get1.log")"
expect_file "$HOME/.claude/skills/onboarding/SKILL.md"
expect_no_file "$PROJ/.claude/skills/onboarding"
grep -q "skills:claude:onboarding" "$HOME/.teamai/state.json" && ok "install record in user-scope state" || bad "record missing from ~/.teamai/state.json"
if grep -rqs "skills:claude:onboarding" "$PROJ/.teamai/state.json" "$HOME/.teamai/projects/"; then bad "install record leaked into project state"; else ok "no install record in project state"; fi
node "$CLI" get skills onboarding --agent claude >"$WORK/get2.log" 2>&1
grep -q "up to date" "$WORK/get2.log" && ok "get unchanged reported" || bad "get unchanged not reported: $(tail -3 "$WORK/get2.log")"
echo "# local edit" >> "$HOME/.claude/skills/onboarding/SKILL.md"
node "$CLI" get skills onboarding --agent claude >"$WORK/get3.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "local changes\|Local" "$WORK/get3.log" && ok "local-changes conflict reported" || bad "local edit overwritten silently"
grep -q "# local edit" "$HOME/.claude/skills/onboarding/SKILL.md" && ok "local edit preserved" || bad "local edit lost"
node "$CLI" get skills onboarding --agent claude --force >"$WORK/get4.log" 2>&1; rc=$?
[ $rc -eq 0 ] && ok "force reinstall exit 0" || bad "force exit $rc"
grep -q "# local edit" "$HOME/.claude/skills/onboarding/SKILL.md" && bad "force did not overwrite" || ok "force overwrote"

step "shared get: rules install; namespace-only and docs/wiki rejected"
node "$CLI" get rules style --agent claude >"$WORK/get-rule.log" 2>&1; rc=$?
[ $rc -eq 0 ] && ok "get rules install exit 0" || bad "get rules exit $rc: $(tail -3 "$WORK/get-rule.log")"
expect_file "$HOME/.claude/rules/style.md"
node "$CLI" get skills deploy --agent claude >"$WORK/get-ns.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "outside the shared area" "$WORK/get-ns.log" && ok "namespace-only skill rejected" || bad "namespace-only skill accepted: $(tail -3 "$WORK/get-ns.log")"
node "$CLI" get skills demo/deploy --agent claude >"$WORK/get-ns3.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "outside the shared area" "$WORK/get-ns3.log" && ok "explicit namespace path rejected" || bad "explicit namespace path accepted: $(tail -3 "$WORK/get-ns3.log")"
node "$CLI" get rules nsrule --agent claude >"$WORK/get-ns2.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "outside the shared area" "$WORK/get-ns2.log" && ok "namespace-only rule rejected" || bad "namespace-only rule accepted: $(tail -3 "$WORK/get-ns2.log")"
node "$CLI" get docs handbook >"$WORK/get-docs.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "has been removed" "$WORK/get-docs.log" && ok "get docs rejected" || bad "get docs not rejected: $(tail -3 "$WORK/get-docs.log")"
node "$CLI" get wiki spec/overview >"$WORK/get-wiki.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "has been removed" "$WORK/get-wiki.log" && ok "get wiki rejected" || bad "get wiki not rejected: $(tail -3 "$WORK/get-wiki.log")"

step "put: publish a local skill to the shared area, then get it back"
mkdir -p "$WORK/local-skills/publish-me"
printf -- '---\nname: publish-me\ndescription: put e2e skill\n---\n\n# publish-me skill\n' > "$WORK/local-skills/publish-me/SKILL.md"
BRANCHES_BEFORE=$(git -C "$CLONE" ls-remote --heads origin | wc -l | tr -d ' ')
node "$CLI" put skills "$WORK/local-skills/publish-me" --dry-run >"$WORK/put-dry.log" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q "dry-run. Would publish" "$WORK/put-dry.log" && ok "put --dry-run previews publish" || bad "put --dry-run preview missing: $(tail -3 "$WORK/put-dry.log")"
BRANCHES_AFTER=$(git -C "$CLONE" ls-remote --heads origin | wc -l | tr -d ' ')
[ "$BRANCHES_BEFORE" = "$BRANCHES_AFTER" ] && ok "put --dry-run pushed no branch" || bad "put --dry-run changed remote branches"
node "$CLI" put skills "$WORK/local-skills/publish-me" >"$WORK/put1.log" 2>&1; rc=$?
if [ $rc -eq 0 ] || grep -q "has been pushed" "$WORK/put1.log"; then ok "put published (rc=$rc)"; else bad "put failed rc=$rc: $(tail -5 "$WORK/put1.log")"; fi
git -C "$SEED" fetch -q origin
git -C "$SEED" checkout -q main && git -C "$SEED" reset -q --hard origin/main
for b in $(git -C "$SEED" for-each-ref --format='%(refname:short)' refs/remotes/origin | grep -v 'origin/main$'); do
  git -C "$SEED" merge --no-edit -q "$b" || bad "merge of $b failed"
done
git -C "$SEED" push -q origin main
git -C "$SEED" show origin/main:skills/publish-me/SKILL.md >/dev/null 2>&1 && ok "skills/publish-me at shared root on main" || bad "publish-me not on main"
node "$CLI" get skills publish-me --refresh --agent claude >"$WORK/get5.log" 2>&1; rc=$?
[ $rc -eq 0 ] && ok "get publish-me after put exit 0" || bad "get publish-me exit $rc: $(tail -3 "$WORK/get5.log")"
expect_file "$HOME/.claude/skills/publish-me/SKILL.md"

step "pull without --project applies every active project; --project narrows"
cat > "$SEED/manifest/projects.yaml" <<'YAML'
version: 1
projects:
  - id: demo
    name: Demo
    description: demo project
    resources:
      knowledge: [demo]
      skills: [demo]
      agents: []
  - id: demo2
    name: Demo Two
    description: second project
    resources:
      skills: [demo2]
YAML
mkdir -p "$SEED/skills/demo2/extra"
printf -- '---\nname: extra\ndescription: demo2 skill\n---\n\n# extra skill\n' > "$SEED/skills/demo2/extra/SKILL.md"
git -C "$SEED" add -A && git -C "$SEED" commit -qm "demo2 project" && git -C "$SEED" push -q origin main
node "$CLI" pull -q >/dev/null 2>&1
expect_no_file "$PROJ/.claude/skills/extra"
# The first pull migrated the legacy in-repo config to the ~/.teamai partition.
CFG="$PROJ/.teamai/config.yaml"
[ -f "$CFG" ] || CFG="$(ls "$HOME"/.teamai/projects/*/config.yaml 2>/dev/null | head -1)"
[ -n "$CFG" ] && [ -f "$CFG" ] && ok "active config found: $CFG" || bad "no active project config found"
sed -i '' 's/^projects: \[demo\]$/projects: [demo, demo2]/' "$CFG"
node "$CLI" pull >"$WORK/pull-multi.log" 2>&1; rc=$?
[ $rc -eq 0 ] && ok "multi-active pull exit 0" || bad "multi-active pull exit $rc: $(tail -3 "$WORK/pull-multi.log")"
grep -q "project=demo,demo2" "$WORK/pull-multi.log" && ok "multi-active scope reported" || bad "scope line wrong: $(grep 'scope:' "$WORK/pull-multi.log" | head -1)"
expect_file "$PROJ/.claude/skills/extra/SKILL.md"
node "$CLI" pull --project demo >"$WORK/pull-narrow.log" 2>&1; rc=$?
[ $rc -eq 0 ] && grep -q "project=demo, agent" "$WORK/pull-narrow.log" && ok "pull --project narrows to one" || bad "narrowed pull wrong: $(grep 'scope:' "$WORK/pull-narrow.log" | head -1)"

step "user-scope directory: pull rejected with migration guidance"
mkdir -p "$WORK/elsewhere" && cd "$WORK/elsewhere"
node "$CLI" pull >"$WORK/pull-user.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "project scope" "$WORK/pull-user.log" && ok "user-scope pull rejected" || bad "user-scope pull accepted: $(tail -3 "$WORK/pull-user.log")"

step "results"
echo "PASS=$pass FAIL=$fail (workspace: $WORK)"
[ $fail -eq 0 ]
