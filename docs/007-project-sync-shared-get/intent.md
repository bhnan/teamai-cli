# Intent — 项目同步与共享资源获取（007）

Status: confirmed（需求方于 2026-09-29 确认问题与范围；进入 Design）

日期：2026-09-29。当前讨论基线：TeamAI CLI fork `051b92a`（`0.26.0-beta.5-bhn.0.1`）。

## 问题

TeamAI 目前的命令职责和用户的资源管理方式不匹配：

1. 团队仓中的全局 skill 更新后，缺少面向指定 Agent、指定 skill 的简单更新方式。`get` 能下载指定资源，但重复获取时怎样识别远端更新、保护本地改动，还需明确。
2. 项目自己的 docs 更新后，无法通过 `push` 同步到团队仓。当前 fork 的 push 不扫描 docs；现有 pull 的 docs 行为是下行镜像，可能覆盖或清理本地文档。
3. 项目同步、共享资源获取和完整环境部署的边界不清晰，可能让用户为更新一个资源运行范围过大的 pull。

用户受影响者：在多个 Agent 和项目之间复用团队技能的成员、维护项目文档的成员，以及负责团队资源配置的管理员。

## 目标范围

本需求只讨论两种资源范围及各自的命令职责：

| 范围 | 命令职责 | 资源 |
|---|---|---|
| 项目级发布 | `push` 把项目资源发布到团队仓对应项目；docs/Wiki 供其他项目检索参考 | skills、rules、docs、env、agents、wiki |
| 项目级拉取 | `pull` 把工具配置更新到当前项目目录 | skills、rules、env、agents |
| 共享级 | `get` 从团队仓共享区获取或更新到明确选择的 Agent 全局目录 | skills、rules |

明确约束：

- push/pull 均是项目级路径操作，不提供共享级 push/pull。
- 共享资源通过 get 获取和更新；用户需要能指定 Agent 和 skill/rule。
- 项目操作支持指定 Agent。Agent 选择仅用于适用的工具资源；docs/Wiki 归属项目，不因 Agent 而重复或改变目录。
- docs/Wiki 由源项目维护，push 单向发布到团队仓对应项目，供其他项目参考；pull 不回拉、不覆盖、不清理项目 docs/Wiki。
- 不修改 project-wiki skill。TeamAI 负责将发布后的 Wiki 来源映射到 doc，并保留哈希校验语义。
- 本轮请求是重新按 SDLC 整理文档；不因此开始 CLI 实现、部署、安装版本或发布。

## 成功标准（需求方已确认，按最新边界修正）

1. 项目级 push/pull 明确显示并只操作已选项目的源和目标；不会回退为全局资源操作。
2. 项目目录中的 docs/Wiki 变更能发布到团队仓对应项目路径，供其他项目从团队仓副本检索并引用；pull 对本地 docs/Wiki 零写入，不创建文档同步目标。
3. 共享 get 能指向明确团队仓共享资源、Agent 全局目标和指定 skill/rule；重复获取可区分无变化、可安全更新和本地冲突。
4. 本地已修改资源、两端并发修改及来源删除都有可见结果；未经确认不丢弃用户修改或删除文件。
5. 每条命令报告已解析的作用域、资源、来源/目标及成功、跳过、冲突状态；共享 get 不执行完整 pull 的额外同步副作用。
6. 文档覆盖兼容行为和自动 Hook 入口，确保手动及会话自动 pull 都不管理项目 docs/Wiki。

## 非目标

- 不提供共享资源 push/pull，亦不把共享 get 作为本机全局副本的回传通道。
- 不把共享级 docs、Wiki、env、agents 加入 get。
- 不重做 Wiki 搜索，不修改 project-wiki skill，不把自定义 `.wiki` 与原生 `teamwiki/` 合并。
- 不以本次文档整理授权代码修改、真实目录同步、安装、提交或远端发布。

## 当前证据和假设

已核对 fork 基线：push 当前扫描 skills/rules/env/agents；普通 pull 默认同步 skills/rules/docs/env/agents，并在 pull 流程中执行其他协调；get 当前可选 skills/rules/docs/wiki。上述目标范围属于需求提案，不能当作已实现行为。

路径示例暂按项目根 `docs/` → 团队仓 `docs/<project-id>/`，项目根 `.wiki/` → 团队仓 `.wiki/<project-id>/` 表达。实际项目可能使用其他目录，需在设计阶段确认是否读取现有 `teamai.yaml` 配置或增加项目映射。

## 需求方确认

需求方在飞书评审中明确纠正并确认最终边界：push 处理项目六类资源，其中 docs/Wiki 单向发布供其他项目参考；pull 仅处理 skills/rules/env/agents，不管理 docs/Wiki；共享级 get 只处理 skills/rules。遇到本地修改或双端冲突时默认保留并报告；删除默认只报告，明确确认后才传播。

该目录此前一次性生成的提案草稿因跳过需求确认而撤回；当前 spec/plan 按已确认的 intent 重新建立。
