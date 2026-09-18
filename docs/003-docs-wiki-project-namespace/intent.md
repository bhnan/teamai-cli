# Intent — docs/wiki 支持逻辑项目命名空间（003）

Status: draft（需求方已确认范围与关键决策，随 spec/plan 一并获批后实施）

## 问题

团队仓目前只有 skills / knowledge(claudemd) / learnings / agents 四类资源支持
「逻辑项目命名空间」（`manifest/projects.yaml` 中 schema 硬性只认这四类，
`docs/`、`.wiki/` 被排除在外）。后果：

1. **docs 无法按项目隔离**：`docs/` 整目录平铺共享，多项目共用一个团队仓时，
   项目 A 的文档会推送给所有人；本地 `<projectRoot>/docs` 与团队仓 `docs/`
   是全量镜像，无法表达「这部分属于项目 X」。
2. **wiki 无法按项目隔离，更无法表达「一个项目多个 Wiki」**：`.wiki/` 整库镜像，
   全团队同步；单个项目需要多个独立的 Wiki（如技术 Wiki + 产品 Wiki）时没有
   任何命名空间维度。
3. 与 learnings 的既有模型不一致：learnings 早已支持根共享 + `learnings/<project-id>/`
   私有，docs/wiki 却仍是平铺。

## 用户

- 需求方本人（多项目共用一个团队仓的使用者）
- 团队成员（不同项目成员应只看到自己项目的 docs/wiki）

## 目标（需求方决策，2026-09-18 已确认）

1. **docs 支持项目命名空间**：`docs/` 根目录保持全团队共享；`docs/<project-id>/`
   为项目私有文档，只有激活该项目的目录才同步。与 learnings 模型一致。
2. **wiki 支持项目命名空间 + 额外 Wiki 命名空间**：路径两级结构——
   - `.wiki/<wiki-id>/`：全团队共享 Wiki（Wiki 集合）
   - `.wiki/<project-id>/<wiki-id>/`：项目私有 Wiki；**一个项目可有多个 Wiki**，
     `<wiki-id>` 就是那层「额外命名空间」
   - 路径即归属：第一层目录名与已定义 project id 相同 = 项目私有命名空间，
     其余 = 团队共享；无需在 manifest 里登记 docs/wiki 归属。
3. **存量数据归置：不在本需求范围内**（需求方另行处理现有平铺数据）。

## 约束

- 技术栈遵从项目现状：TypeScript + commander + tsup + vitest
- 不修改 `pull`/`push`/`status` 等命令的既有行为语义（在 docs/wiki 分支上做
  命名空间扩展，非破坏性）
- 复用既有设施：`loadProjectsManifest` / `listProjectIds`（`src/projects.ts`）、
  资源 Handler 体系（`src/resources/`）、`resolveResourceNamespaces`
- 向后兼容：无 projects manifest、无活动项目的目录行为完全不变；
  已定义的 project id 是第一层目录的唯一保留词（与 project id 同名的共享
  docs/wiki 目录视为项目命名空间，管理员避免该命名）
- 删除语义沿用 002：docs/wiki 的逐文件删除不自动发生（防误删）；
  本需求只做「去激活项目的命名空间级清理」（与 skills/learnings 的
  namespace cleanup 对齐）

## 成功标准

1. 激活项目时才同步 `docs/<pid>/` 与 `.wiki/<pid>/<wiki-id>/`；共享根始终同步
2. 项目去激活后，下次 pull 清理本地对应命名空间目录（沿用 skills/learnings 清理语义）
3. `teamai push` 只呈现共享 + 活动项目命名空间的差异（含命名空间前缀的相对路径）
4. `teamai get docs/wiki` 支持命名空间路径解析；歧义（共享/项目同名）列出候选；
   镜像模式同步共享 + 活动项目命名空间
5. `teamai status` 计数涵盖命名空间下的 docs/wiki 文件
6. 单测 + 真实 CLI E2E：双逻辑项目（A 激活 / B 未激活）隔离验证，
   pull/push/get/status 全链路
7. `npm run typecheck`、`npm test` 零回归

## 非目标

- 不改 manifest schema：`docs`/`wiki` 不加入 `resources` 键（路径即归属，
  奥卡姆剃刀，避免与路径模型重复的声明层）
- 不做存量平铺数据的自动迁移/归置
- 不改 wiki 的内容级合并语义（仍是文件级镜像）
- 不向上游 Tencent/teamai-cli 提 PR（如需另行授权）

## 已知开放问题

1. `get list wiki/docs` 的展示：命名空间条目以 `<pid>/<wiki-id>` 前缀显示
   （与 rules 的 namespace 前缀显示一致），无歧义时是否压缩省略？→ 实现时保持
   前缀全显示（对得上团队仓真实相对路径）
2. ~~去激活清理的边界~~（已解决）：清理以 manifest 定义集为边界；数据安全护栏
   （`dirContentEqual` 逐字节 + VCS 元数据检查）保证只有与团队仓完全一致的本地
   目录才被删除——即使手工创建过内容雷同的目录，删除也不损失任何数据