# TeamAI CLI

CLI for syncing team skills, rules, docs, and env across AI coding tools. Package: [`teamai-cli`](https://www.npmjs.com/package/teamai-cli).

TypeScript, Node 20+ (`npm run lint` needs ^20.19 or >=22.12), tsup (ESM), Vitest. Commands: `npm run build`, `npx tsc --noEmit`, `npm run lint`, `npx vitest run`, `npm run test:e2e`.

## Git

- Default branch: `main`. Worktrees and PRs based on `origin/main`.
- PR only to `Tencent/teamai-cli`. Before push, check `git log origin/main..HEAD`; rebase or cherry-pick if unrelated commits appear.
- **必须使用 Worktree**：改代码前先 `EnterWorktree`，禁止在主工作目录修改。

## Rules

- CLI user-facing output must be English. No Chinese in production code. Tests assert English output.
- Keep bilingual docs in sync (`README` / `*.zh-CN.md`, `docs/usage-guide.*`). Behavior changes must update every affected doc (including `docs/designs/`); grep old wording before opening the PR.
- **README 精简**：尽量少改动 README，保持简洁。确需改动时，所有语言版本（`README.md` 及全部 `README.*.md`，改前先 `ls README*` 确认清单）必须全部改完并保持一致。
- **`skill-data/` 与文档同等对待**：那是 agent 真正读到的内容。行为变更必须同步更新受影响的 skill（`core` / `setup` / `wiki` / `share`），并在 PR 前 grep 旧措辞。
- `skill-data/core/references/commands.md` 由 Commander 命令表生成，改动命令或 flag 后运行 `npx vitest run commands-reference -u` 重新生成。
- 部署到 agent 的只有 `skills/teamai/SKILL.md`（发现入口），保持与版本无关：新增工作流是在 `skill-data/` 下加目录 + 在 stub 里加一行，不要把内容写进 stub。
- **奥卡姆剃刀**：避免过早添加新 CLI 命令；非必要不加；优先复用或扩展现有命令与选项。

## TeamAI 资源范围与同步边界

以下是当前产品约定。它们描述目标行为和实现约束；如果现有代码与此不一致，应在变更说明中明确区分“当前实现”和“目标行为”，不能把旧行为当作边界依据。

- **项目级 `push`**：从当前项目发布六类资源到团队仓对应的项目命名空间：`skills`、`rules`、`docs`、`env`、`agents`、`wiki`。`docs` 和 `wiki` 只做单向发布，目的是让其他项目从团队仓副本检索和引用；它们不因 Agent 选择而改变路径。
- **项目级 `pull`**：只把团队仓当前项目配置更新到当前项目的四类资源：`skills`、`rules`、`env`、`agents`。`pull` 不扫描、创建、覆盖、清理或删除项目 `docs`、`Wiki`，也不得通过自动 Hook、force 或兼容路径绕过这一限制。团队仓 clone 更新时带回的 docs/Wiki 副本不等于部署到业务项目。
- **共享级 `get`**：只获取或更新团队仓共享区的指定 `skill` 或 `rule`，目标是明确选择的 Agent 全局目录。共享级不通过 `push`/`pull` 处理，也不把项目专属资源或 docs/Wiki 作为共享资源。
- **作用域和 Agent**：`push`、`pull`、`get` 必须解析明确的项目或共享作用域，不能仅凭当前文件夹名称猜测归属，也不能静默回退到用户全局目录。Agent 选择只影响适用的工具资源路径；项目 docs/Wiki 始终归项目所有。
- **保护规则**：同步前必须展示解析出的项目、Agent、资源类型、来源和目标。未声明、路径不明确、冲突或来源删除时保留用户内容并报告；删除和 force 覆盖必须单独、显式确认。`dry-run` 不写文件、状态、索引或发布记录。
- **副作用边界**：项目 `pull` 和共享 `get` 不应隐式执行完整环境部署、Hook/MCP reconcile、模型切换、usage 上报或其他与所选资源无关的协调副作用。需要执行时必须有明确、独立的入口。

### TeamAI 命令能力说明

这些命令不是同一个“同步”动作，而是分别负责初始化、资源分发、运行配置、知识管理和可观测性。使用前先确定命令所属的作用域；新增或修改命令时，必须同步更新对应 `skill-data`、双语文档和命令参考。

#### 初始化、查看与诊断

- `init [repo]`：建立本地 TeamAI 配置，连接团队仓，登记成员和项目；可选择 project/user scope、激活项目和 Agent。它负责建立连接和配置，不代表已经把全部资源部署到工具中。
- `list [type]`：列出团队或本地资源，可按 `skills`、`rules`、`docs`、`env`、`agents`、`hooks`、`mcp` 等类型查看，并可按来源或 Agent 筛选；环境变量默认脱敏。
- `status`：比较本地与团队仓的资源差异，帮助判断哪些资源新增、修改或缺失；`--all` 可查看所有项目分区及孤立分区。
- `doctor`：检查 provider、配置文件、资源路径、Hook 和安装状态，输出可修复的问题；它用于诊断，不应被当作同步命令。

#### 项目、共享资源与运行配置

- `push`：按项目作用域发布本地资源。目标项目由 manifest 和显式项目绑定确定；当前边界是发布六类资源，其中 docs/Wiki 只单向发布到团队仓对应项目，供其他项目参考。
- `pull`：按项目作用域把团队资源更新到本地 AI 工具。当前边界只处理 `skills`、`rules`、`env`、`agents` 四类，不管理项目 docs/Wiki，也不应隐式执行无关协调副作用。
- `get`：从共享命名空间获取或更新指定的 skill/rule 到指定 Agent 的全局目录；不把项目资源回退为共享资源，也不执行完整 `pull`。
- `projects`：维护多项目 manifest，查看、设置、添加、更新或移除当前目录激活的逻辑项目；它决定项目资源分发范围，不能仅凭文件夹名称推断归属。
- `roles`：维护角色和资源命名空间，设置当前成员角色及可用 namespace；它解决“谁能看到哪些团队资源”，与 `projects` 的项目筛选轴分开。
- `tags`：给 skill/rule 添加或移除标签，并管理订阅；订阅标签会筛选同步到本地的 skills/rules，不替代项目 scope。
- `env`：查看、添加、更新或删除团队环境变量，可写入角色或项目 env namespace；敏感值默认掩码，不能把值写入日志或提交内容。
- `hooks`：查看、注入或移除 TeamAI Hook；Hook 只负责触发既定工作流，不能借自动入口绕过 pull 的四类资源边界。
- `mcp`：查看、注入或移除团队 MCP 服务及各 Agent 的安装状态；它是运行配置管理，不等于项目 pull 的资源集合。
- `models`：管理模型 gateway profile、API 配置和 Agent 的模型切换/恢复；模型切换是独立运行配置操作，不应由 pull 隐式触发。

#### 团队知识与代码库知识

- `recall [query]`：检索已经纳入索引的团队 learnings/知识，可选择检索深度、查看相关性或提交正负反馈；它只搜索已建立的索引，不等于读取任意项目 docs。
- `contribute`：把会话总结或指定的 Markdown 知识贡献到团队仓，形成可检索的 learning；发布前要确认目标 scope 和将要共享的内容。
- `import`：从本地目录、远程仓库、组织、MR/PR 或 iWiki 导入知识，生成学习资料、代码库摘要或增量知识产物；可预览、跳过增强或要求人工审核。
- `codebase`：提取代码结构和依赖图，维护 `teamwiki` 代码库知识，执行 lint、reconcile 或深度 enrich；它面向知识产物，不是项目 docs/Wiki 的 pull 镜像功能。

#### 使用记录与团队观察

- `stats`：查看本机 skill 使用统计，可按仓库或时间段聚合；它读取本地事件记录，不改变资源内容。
- `session`：保存和查看编码会话摘要；只有显式使用 push 选项时才会把经隐私清理的摘要贡献到团队仓。
- `digest`：生成周期性的团队活动摘要，汇总已记录并允许汇总的活动。
- `dashboard`：启动本地 Web 仪表盘，查看会话、资源和使用情况；它是观察入口，不负责同步资源。

命令输出应说明解析出的作用域、项目、Agent、资源类型、来源、目标和结果；不能用 `list`、`status`、`recall` 或 `dashboard` 的成功来推断 `push`、`pull` 或远端发布已经完成。

## PR 前测试

改动运行时行为的 PR（docs-only / tests-only 之外），`npm run build` 后必须用真实 CLI 对本次改动做端到端验证，不能只跑 type check / unit test；**一次代表性的 real-CLI 运行即可**，把实际通过的验证记录贴进 PR。docs-only / tests-only 的改动无需 e2e 记录。

不要求覆盖下面的完整 provider × agent 矩阵——额外 provider / agent 的覆盖交给 CI，或在本地环境不具备时说明即可：

- Agent：Claude、Codex、CodeBuddy、OpenCode
- Provider：`git`、`gitlab`、`github`

## Self review before push

Review the whole branch diff, not only the last change. For every piece of
shared state, list every reader and every writer.

## Code Review Rules

- The PR description must document sufficient testing. For a PR that changes
  runtime behavior (anything beyond a docs-only or tests-only diff), that
  includes an end-to-end / real-CLI verification record, not only unit tests
  or type checks — flag such a PR that lacks one as `[P1 blocking]`. A
  docs-only or tests-only PR needs no e2e record; do not flag it for that.
  Do NOT require a full provider × agent matrix — one representative real-CLI
  run is enough. Missing coverage of extra providers (`gitlab`/`github`) or
  agents (`Codex`/`CodeBuddy`/`OpenCode`) is at most `[P3 nit]` when the author
  has flagged it as untestable in this environment or deferred to CI, never
  `[P1 blocking]`. A test record naming an older commit than the head is a
  note, not a blocking finding; the body may have been edited after the review
  pass started.
- Do not over-review. Report only findings you are confident are real in the
  current diff. Do not cap how many findings you report: every real bug should
  surface in one pass, not be deferred to a later one. Instead, gate severity
  by evidence — every `[P1 blocking]` must cite either a concrete failure
  scenario (the input or state that triggers it and the resulting misbehavior)
  or the exact `## Code Review Rules` item it breaks. A finding that can cite
  neither is at most `[P2 non-blocking]`; a speculative or theoretical risk
  that needs an unlikely precondition to trigger is at most `[P3 nit]`. Never
  restate a finding already resolved in the current diff.
- Reject over-engineering. Favor the smallest code that solves the problem;
  flag speculative abstractions, unused flexibility or config, error handling
  for cases that cannot occur, and new CLI commands added where an existing
  command could be reused or extended.
- Changes must be surgical. Every changed line should trace directly to the
  PR's stated goal; flag unrelated drive-by edits.
- Label every finding with an explicit severity a first-time reader can
  understand — never a bare `P1`/`P2`/`P3` code. Keep the `P` marker but spell
  out what it means inline on each finding, using the PR author's language:
  `[P1 blocking]` for issues that must be fixed before merge,
  `[P2 non-blocking]` for suggestions that do not block merge, and `[P3 nit]`
  for minor or optional polish, theoretical edge cases, and coverage deferred
  to CI. (In Chinese, `[P1 阻断]` / `[P2 非阻断]` / `[P3 可选]`.)
