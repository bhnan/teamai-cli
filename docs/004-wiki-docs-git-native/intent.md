# Intent — wiki/docs 是项目强相关的上下文资源：项目自身管理 + TeamAI 提供跨项目检索（004）

Status: draft（需求方语义已明确；实施细节待需求方整体规划后确认；未批准实施）

## 需求方定义（2026-09-19，核心语义）

> Team wiki——或者我所定义的 wiki 和 docs——这些对于 agent 来说是**上下文资源**，
> 但它们是**项目强相关**的，所以**由项目本身管理**。TeamAI 的管理方式只是提供
> **检索其他项目的相关资源**的能力。

逐条拆解：

1. **定位**：wiki/docs 是 agent 的**上下文资源**——供会话中检索、引用，为 agent
   提供项目与跨项目的知识背景。
2. **归属与版本管理**：**项目强相关** → 由项目本身的 Git 仓库管理
   （`docs/` 在项目本体仓 tracked；`.devwiki/` 等纳入项目 git）。代码管理、
   版本管理、多机一致性，全部由项目自身 Git 承担，TeamAI 不参与项目内容的
   跨机同步。
3. **TeamAI 的角色**：**跨项目上下文检索层**——各项目把知识发布到团队仓，
   TeamAI 提供（a）发布通道与（b）全量本地副本上的 recall 检索，使得在项目 X
   工作的 agent 能检索到其他项目的相关资源。

## 问题（为什么改）

- 现状（003 双向镜像）把团队仓的 docs/wiki 回拉进代码仓工作区
  （`/root/teamai-cli/.wiki/`、`docs/teamai-cli/`），被需求方认定为不合理污染
  ——「上下文资源」不该被镜像进代码仓。
- 双源问题：同一份 docs 同时被业务仓 Git 与团队仓两处管理。
- hook 的 session-start 自动 pull 无资源类型开关，把 docs/wiki 无差别拉进所有
  init 过的目录（归因见 003 change.md C2）。

## teamwiki 的事实基线（模型参照物，已查证）

- 组织：按项目 slug 存放（`teamwiki/evidence/code/<slug>/`），另含 `product/`
  与 `docs/` 视角页面
- 双编译器：AI 产 manifest（schema 约束）→ Node 确定性编译
  （src/wiki-engine/manifest-schema.ts）
- 双轨提取：AST 轨（web-tree-sitter WASM）+ 启发式轨；删除显式建模
  （src/wiki-engine/code-knowledge/code-incremental.ts：
  added/changed/deleted/affectedPages）
- 消费：本机克隆 → `teamai recall` 图谱引擎（BM25 + graph-boosted，
  src/rebuild-wiki-index.ts）

## 目标行为（新逻辑）

| 内容 | Git 家（版本管理） | TeamAI 角色 |
|---|---|---|
| 项目 docs（`docs/…`，项目本体仓 tracked） | 项目本体仓 | 发布通道（push/MR）+ 跨项目检索 |
| 项目 wiki（`.devwiki/` 等桥接目录，纳入项目 git） | 项目本体仓 | 同上 |
| 共享 skills/rules/agents/env | 团队仓 | pull 分发到工具目录（不变）|
| learnings | 团队仓 | contribute / recall（不变）|
| 共享 wiki 集合（`.wiki/<wiki-id>/`） | 团队仓 | 订阅制：显式声明才落地（倾向默认不落地，待定）|

- **发布**：项目内容 → 团队仓命名空间（`docs/<pid>/`、`.wiki/<pid>/<wiki-id>/`），
  供其他项目检索；发布机制（项目 Git → 团队仓）见开放问题 2
- **pull 不再回拉 docs/wiki**：项目内容不落地项目工作区——session-start 的
  pull 裁剪掉 docs/wiki 类型后，本次事故根因自然消失
- **删除传播**：Git 原生——项目仓删除提交即表达删除，随 Git 分发；团队仓侧
  发布快照随发布动作收敛
- **检索**：`teamai recall` 基于本地团队仓克隆全量副本（含其他项目），按需求
  方定义这就是能力本身，不做项目过滤

## 探索佐证（2026-09-19 查证事实，全部带出处）

**佐证 1 — teamwiki 的设计意图就是「集中存放 + 检索」：**
`docs/usage-guide.md:1239`：「`teamai import` parses a source code repo into a
structured knowledge graph (stored under the team repo's `teamwiki/` directory),
enabling structure-aware knowledge retrieval」。

**佐证 2 — teamai 不为 teamwiki 写任何 .gitignore（git 原生管理无工具干预）：**
`src/codebase-cmd.ts` / `src/codebase-extract.ts` / `src/wiki-engine/` 全链路
grep `gitignore` 零命中；extract 仅 mkdir + writeFile
（src/codebase-extract.ts:751,899）。src/ 全部会写 .gitignore 的代码共 4 处，
无一与 teamwiki 相关：`src/pkg/manifest.ts:26-30`（package-lock）、
`src/migrate.ts:422`（迁移备份目录自忽略）、
`src/utils/branch-worktree.ts:220,279-286`（reports/learnings 工作树）、
`src/init.ts:485-550`（self 单仓模式 .teamai/.gitignore）。
实证：`/root/bhn/trading/teamwiki` 不存在、`/root/bhn/trading/.gitignore` 无
teamwiki 条目。

**佐证 3 — 删除传播在 teamwiki 侧内建（git 原生 + 增量建模）：**
`src/wiki-engine/code-knowledge/code-incremental.ts:15-45` 显式返回
`{added, changed, deleted, affectedPages}`（工作区干净时走项目 git 的
commit-to-commit diff，无 git/脏工作区降级 sha256 全量扫描）；分发层的删除 =
团队仓 git 提交，随 Git 天然分发。

**佐证 4 — 消费端 = 本地全量副本 + 离线检索：**
`src/rebuild-wiki-index.ts` 从本机克隆 `teamwiki/evidence/code/<slug>/` 聚合
facts/nodes/edges/interfaces/callChains；`teamai recall` 检索根 = 本机克隆
teamwiki/（src/recall.ts:474）。实证：团队仓克隆
`/root/.teamai/projects/root-teamai-cli-b884478455d04826/team-repo/` 内尚无
teamwiki/（extract 未对本机项目跑过）。

**佐证 5 — extract 不自动分发：**
`src/codebase-extract.ts` 无 commit/push 逻辑；跨机分发 = 人工在团队仓克隆
commit/push（与「TeamAI 只做检索层、项目 Git 管内容」的语义一致）。

**佐证 6 — 003 已实现项目命名空间隔离（写/归属层）：**
PR #11/#13/#16 已合并；实证 hook E2E 后 `/root/teamai-cli` git status 仅
`?? .wiki/`、`?? docs/teamai-cli/`——trading 命名空间（`docs/trading/`）未
泄漏进 teamai-cli 目录。

**佐证 7 — 事故归因（读层回拉才是问题）：**
hook-dispatch session-start 的 pullHandler（src/hook-handlers.ts:494，
background）→ `pullForScope` 全量默认 resourceTypes（src/pull.ts:678）→
docs/wiki 落地业务仓。若按本需求裁剪掉 docs/wiki 类型，根因消除。

## 边界与开放问题（需求方思考后确定）

1. **发布机制**：项目 Git → 团队仓命名空间如何发布（复制快照 MR / 专用发布
   命令 / 其他）——本模型唯一需要新设计的分发环节
2. **pull 裁剪**：resourceTypes 配置化 vs 按内容归属（project-git）自动裁剪
3. **共享内容订阅默认值**：共享 wiki 集合默认不落地 vs 默认落地（倾向前者）
4. **`.devwiki` 桥（C2）归宿**：简化为发布源（push-only）后，C2 的 pull 侧
   排除/单一 home 逻辑回退范围
5. **hook 触发层**：session-start pull 裁剪 docs/wiki 后是否还需要触发层门控
   （预计不需要——拉不到上下文资源即无污染）

## 非目标（本需求不做）

- 不替代/不合并 `teamwiki/`（codebase wiki 用途不同：代码结构图谱 vs 知识内容）
- 不改 learnings/skills 的同步模型
- 不做存量数据迁移（需求方自行归置）
