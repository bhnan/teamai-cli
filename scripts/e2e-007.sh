#!/usr/bin/env bash
# 007 representative E2E — real CLI against local git fixtures.
# Exercises: project-scope pull (4 types, docs rejected), one-way docs/wiki
# push, pending-delete gate, shared get S/T/B tracking, user-scope rejection.
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
mkdir -p "$SEED/skills/demo/deploy" "$SEED/rules" "$SEED/manifest"
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
echo "# style rule" > "$SEED/rules/style.md"
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

step "push: one-way docs and wiki publish"
mkdir -p "$PROJ/docs" "$PROJ/.wiki/spec"
echo "# project handbook" > "$PROJ/docs/handbook.md"
echo "# wiki page" > "$PROJ/.wiki/spec/overview.md"
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

step "shared get: install → unchanged → conflict → force"
CLAUDE_HOME="$HOME/.claude"; mkdir -p "$CLAUDE_HOME/skills"
node "$CLI" get skills deploy --agent claude >"$WORK/get1.log" 2>&1; rc=$?
[ $rc -eq 0 ] && ok "get install exit 0" || bad "get install exit $rc: $(tail -3 "$WORK/get1.log")"
expect_file "$HOME/.claude/skills/deploy/SKILL.md"
node "$CLI" get skills deploy --agent claude >"$WORK/get2.log" 2>&1
grep -q "up to date" "$WORK/get2.log" && ok "get unchanged reported" || bad "get unchanged not reported: $(tail -3 "$WORK/get2.log")"
echo "# local edit" >> "$HOME/.claude/skills/deploy/SKILL.md"
node "$CLI" get skills deploy --agent claude >"$WORK/get3.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "local changes\|Local" "$WORK/get3.log" && ok "local-changes conflict reported" || bad "local edit overwritten silently"
grep -q "# local edit" "$HOME/.claude/skills/deploy/SKILL.md" && ok "local edit preserved" || bad "local edit lost"
node "$CLI" get skills deploy --agent claude --force >"$WORK/get4.log" 2>&1; rc=$?
[ $rc -eq 0 ] && ok "force reinstall exit 0" || bad "force exit $rc"
grep -q "# local edit" "$HOME/.claude/skills/deploy/SKILL.md" && bad "force did not overwrite" || ok "force overwrote"

step "user-scope directory: pull rejected with migration guidance"
mkdir -p "$WORK/elsewhere" && cd "$WORK/elsewhere"
node "$CLI" pull >"$WORK/pull-user.log" 2>&1; rc=$?
[ $rc -ne 0 ] && grep -q "project scope" "$WORK/pull-user.log" && ok "user-scope pull rejected" || bad "user-scope pull accepted: $(tail -3 "$WORK/pull-user.log")"

step "results"
echo "PASS=$pass FAIL=$fail (workspace: $WORK)"
[ $fail -eq 0 ]
