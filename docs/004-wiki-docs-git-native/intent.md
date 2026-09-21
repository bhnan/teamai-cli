# Intent — wiki/docs 对齐 teamwiki 模式：git 原生管理与传播（004）

Status: draft（方向已由需求方修正确认：参照 teamwiki 的方式，非「upload-only」；
细节待需求方思考后确认；未批准实施）

## 需求方结论（2026-09-19，修正后）

1. 命名与模型修正：**不是「upload-only」——是参照 teamwiki 的方式**：内容用
   Git 原生管理，传播用 Git 原生操作（commit/push），不引入 teamai 层的镜像
   扫描同步。
2. wiki 和 docs 参考该实现逻辑，但**不被 codebase wiki 替代**——用途不同
   （teamwiki 是代码结构图谱，docs/wiki 是人/工具维护的知识内容）。
3. teamwiki 本身也是绑定 Git 的：默认落在团队仓克隆
   （`~/.teamai/projects/<slug>/team-repo/teamwiki/`，src/codebase-cmd.ts:84），
   `--output <仓库根>` 时可落在项目本体仓——两种都是 Git 原生管理
   （src/codebase-cmd.ts 无任何自动 commit/push）。

## 问题（为什么改）

- 现状（003 双向镜像）把团队仓的 docs/wiki 回拉进代码仓工作区
  （`/root/teamai-cli/.wiki/`、`docs/teamai-cli/`），被需求方认定为不合理污染。
- 双源问题：同一份 docs 同时被业务仓 Git 与团队仓两处管理，需要「单一本地
  home」等补丁规避冲突。
- hook 的 session-start 自动 pull 会把 docs/wiki 无差别拉进所有 init 过的目录
  （归因见 003 change.md C2 归因段）。

## teamwiki 的事实基线（模型参照物，已查证）

- 组织：按项目 slug 存放（`teamwiki/evidence/code/<slug>/`），另含 `product/`
  与 `docs/` 视角页面
- 双编译器：AI 产 manifest（schema 约束）→ Node 确定性编译
  （src/wiki-engine/manifest-schema.ts）
- 双轨提取：AST 轨（web-tree-sitter WASM）+ 启发式轨，删除显式建模
  （src/wiki-engine/code-knowledge/code-incremental.ts 的
  added/changed/**deleted**/affectedPages）
- 传播：在承载它的 Git 仓库中人工 commit/push（codebase-cmd.ts 无自动分发）
- 消费：本机克隆 → `teamai recall` 图谱引擎（BM25 + graph-boosted）

## 目标行为（新逻辑）

| 内容 | Git 家 | 传播形态 |
|---|---|---|
| 项目 docs（`docs/…`，已在项目本体仓 tracked） | 项目本体仓 | 项目仓日常 push（团队协作既有流程）|
| 项目 wiki（`.devwiki/` 等桥接目录） | 项目本体仓（纳入项目 git） | 同上 |
| 共享 skills/rules/agents/env | 团队仓 | teamai pull 分发到工具目录（不变）|
| learnings | 团队仓 | contribute / recall（不变）|
| 共享 wiki 集合（`.wiki/<wiki-id>/`） | 团队仓 | 订阅制：目录显式声明才落地（倾向默认不落地，待定）|

- **删除传播**：Git 原生——提交即表达删除，随 Git 分发；不需要给 push 扫描
  补 deleted 检测（旧镜像模型的缺陷在此模型下不存在）
- **多机一致性**：由项目自身 Git 保证（clone/pull）；teamai 不参与项目内容的
  跨机同步
- **teamai pull 对 docs/wiki**：不再镜像回项目工作区（裁剪方式见开放问题）

## 需借鉴的既有设计

- `code-incremental.ts` 的增量/deleted 建模：作为「extract 与项目 git 对齐」
  的参照保留在 teamwiki 侧；docs/wiki 侧因转为 git 原生管理，无需复制该逻辑
- 003 已实现的命名空间布局（`docs/<pid>/`、`.wiki/<pid>/<wiki-id>/`）：作为
  团队仓侧的目录约定保留，语义从「同步目标」变为「发布目标」

## 边界与开放问题（需求方思考后确定）

1. **docs/wiki 的 Git 家二选一**：项目本体仓（`docs/` 已 tracked；`.devwiki`
   需纳入项目 git）vs 团队仓（teamwiki 默认模式）——决定发布/共享机制
2. 若 Git 家 = 项目本体仓：**项目 Git → 团队仓的发布机制**（submodule /
   复制快照 MR / 其他）——本模型唯一需要新设计的分发环节
3. teamai pull 对 docs/wiki 的裁剪方式（resourceTypes 配置化 vs 按 Git 家
   自动裁剪）
4. 非项目绑定的共享内容订阅默认值（默认不落地 vs 默认落地）
5. `.devwiki` 桥（C2 已实现的双向）在此模型下的归宿：简化为 push-only，
   C2 的 pull 侧排除/单一 home 逻辑回退
6. hook session-start 的 pull 裁剪与触发层门控（是否需要）

## 非目标（本需求不做）

- 不替代/不合并 `teamwiki/`（codebase wiki 用途不同）
- 不改 learnings/skills 的同步模型
- 不做存量数据迁移（需求方自行归置）
