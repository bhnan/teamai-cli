# Intent — wiki/docs 对齐 teamwiki 模型：项目内容 upload-only（004）

Status: draft（需求方方向已定，细节待需求方思考后确认；未批准实施）

## 需求方结论（2026-09-19 原话归纳）

1. wiki 和 docs **参考 `teamwiki/` 的实现逻辑**（生命周期与分发模型），但**不能被 codebase wiki 替代**——目的不一样（teamwiki 是代码结构图谱，docs/wiki 是人/工具维护的知识内容）。
2. 本质要求：**项目内容只上传、不在多台机器之间做 teamai 层的相互更新**——多机一致性由**项目自身的 Git** 保证。

## 问题（为什么改）

- 现状（003 双向镜像）把团队仓的 docs/wiki 回拉进代码仓工作区（`/root/teamai-cli/.wiki/`、`docs/teamai-cli/`），被需求方认定为不合理污染。
- 双源问题：同一份 docs 同时被业务仓 git 与团队仓两处管理，需要「单一本地 home」等补丁规避冲突。
- hook 的 session-start 自动 pull 会把 docs/wiki 无差别拉进所有 init 过的目录（归因见下）。

## 归因（session-start 污染，已查证）

1. 触发层：`~/.claude/settings.json` 的 hook 注入是 HOME 级全局，无目录门控。
2. 分发层：`hook-dispatch session-start` 的 pullHandler（`src/hook-handlers.ts:494`，background）调用 `pullForScope` 时 `policy.resourceTypes` 不传 → 走全量默认（`src/pull.ts:678`）；且 pull 无按类型禁用的命令参数或配置字段。
3. 语义层：003 只隔离了项目命名空间；共享根（`docs/` 根、`.wiki/<wiki-id>/`）语义是「对所有 init 目录无条件同步」，且没有「目录性质（代码仓 vs 知识仓）」标记。

## 目标行为（新逻辑）

| 内容 | 归属管理 | teamai 的角色 |
|---|---|---|
| 项目 docs/wiki（`docs/`、`.devwiki/` 等桥接目录） | **项目自身 Git** | **只上传**：push（含删除传播）→ MR → 团队仓 `docs/<pid>/`、`.wiki/<pid>/<wiki-id>/`；**pull 不回拉** |
| 团队共享 skills/rules/agents/env | 团队仓 | pull 分发到工具目录（不变） |
| learnings | 团队仓 | contribute / recall（不变） |
| 共享 wiki 集合（`.wiki/<wiki-id>/`） | 团队仓 | 订阅制：目录显式声明才落地（默认不落地，倾向） |

- 多机一致性：由项目自身 Git 保证（clone/pull），teamai 不参与
- 非项目绑定内容才走 teamai 的 pull 体系

## 需借鉴的既有设计（删除传播）

`src/wiki-engine/code-knowledge/code-incremental.ts` 已把 `deleted` 显式建模
（工作区干净时用项目 git 的 commit-to-commit diff，否则降级 sha256 全量扫描 →
映射 affectedPages）。docs/wiki 的 push 扫描需补同款 deleted 检测与传播，
否则项目里删除的文档会在团队仓残留陈旧副本（当前 push 只报 new/modified）。

## 边界与开放问题（需求方思考后确定）

1. 删除传播形态：push 扫描本地 deleted 传播，还是约定「删除走 `teamai remove`」？
2. 非 git 项目目录的回退语义（upload-only 仍成立，但无 git 多机一致性）
3. 共享内容的订阅默认值（默认不落地 vs 默认落地）
4. hook session-start 的 pull 裁剪方式（resourceTypes 配置化 vs 按归属自动裁剪）
5. `.devwiki` 桥简化：只 push 不 pull 后，C2 的「单一本地 home/pull 排除」复杂度可消
6. 已落地的 C2（桥接双向）与本次方向的回退/改造范围

## 非目标（本需求不做）

- 不替代/不合并 `teamwiki/`（codebase wiki 用途不同）
- 不改 learnings/skills 的同步模型
- 不做存量数据迁移（需求方自行归置）
