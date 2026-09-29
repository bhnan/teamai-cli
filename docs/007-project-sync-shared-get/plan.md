# Plan — 项目同步与共享资源获取（007）

Status: draft（基于 intent 确认及 spec 草案；待需求方评审批准后开始实现）

## 实施前约束

- 当前只完成 SDLC 文档；未修改 CLI 代码或真实资源。需求方已明确 push 六类、pull 四类、共享 get 两类，docs/Wiki 仅发布供跨项目参考。
- 实施前须需求方批准 spec 与本 plan，并在独立 Git worktree 中工作，遵守根 `AGENTS.md`。不在主工作目录改代码。
- 设计评审如决定改变项目/共享边界、冲突语义或迁移行为，先修订 intent/spec/plan 并重新确认，不边编码边扩大范围。

## 阶段与工作项

### P0 — 完成设计核查

- [ ] 逐项将 spec 与现有 `projects.yaml`、roles manifest、工具路径适配及 wiki mapping schema 对照，冻结唯一配置承载处。
- [ ] 冻结项目 Wiki 声明方式、共享 namespace 标记及资源身份键。
- [ ] 冻结 `--types`、`--agent` 与 `--skill`/`--rule` 和旧 `get` positional tool 参数之间的兼容规则。
- [ ] 冻结删除确认交互、局部冲突是否允许其他项继续、退出码和远端 provider 发布状态定义。
- [ ] 更新 spec，确认所有约定具有可测试的输入、目标路径、结果和失败条件。

### P1 — 实现前读码与隔离工作区

- [ ] 在新 worktree 基于当前目标分支检查 `src/index.ts`、`src/types.ts`、`src/manifest-schema.ts`、`src/resource-namespaces.ts`、`src/push.ts`、`src/pull.ts`、`src/get-cmd.ts`、`src/resources/{docs,wiki,env,skills,rules,agents}.ts`、`src/utils/wiki-source-anchor.ts`、`src/hook-handlers.ts`。
- [ ] 绘制状态文件所有 reader/writer：项目副本基线、共享 get 安装记录、pull revision cache、namespace placement、reports/learnings 状态；复用现有状态模型能做到时不增加第二套账本。
- [ ] 确认哪些副作用现由普通 pull 主入口而不是资源 handler 发起，并给每个保留/迁移副作用指定显式 owner。

### P2 — 运行时代码（审批后）

按可独立审查的顺序实现：

1. **Scope 解析与命令校验**：在现有 push/pull 接口中明确 project ID、绑定项目根和 Agent，拒绝 user-scope fallback；shared get 明确共享仓源与全局目标。
2. **共享 get 跟踪**：单 skill/rule 查找、安装基线、更新计划、本地冲突保护、refresh 行为；保持不触发完整 pull 的副作用。
3. **项目工具资源**：将 skills/rules/agents 与 env 约束到选中项目及 Agent，保留现有格式转换和 provider 发布流程。
4. **项目 docs/Wiki 发布**：实现项目原文 → 团队仓对应项目的单向发布映射、目标冲突和显式删除；删除 pull 的 docs/Wiki 部署及清理入口；集成 006 来源项目引用校验，供其他项目参考。
5. **Hook 与迁移**：更新 session-start pull 入口；添加可预览旧配置迁移，确保缺失绑定时不写入文件。
6. **输出/索引**：统一报告计划与逐项结果；只在内容确实更新且策略允许时触发索引刷新，分别报告索引状态。

所有文件先验证 scope containment 和 realpath，再应用原子写入。每个子步骤只覆盖 spec 要求，不顺手增加 shared 资源类型或批量功能。

### P3 — 验证

以下是计划，不是已运行的测试：

- 单元：命令参数矩阵、project/shared 资源解析、Agent 路径适配、manifest 缺项、路径逃逸、三方差异表、格式转换双摘要、删除保护、状态部分成功。
- 集成：四类工具资源验证项目 push/pull round-trip；docs/Wiki 验证单向 push 发布后由另一项目读取团队仓副本，并核验 verified/content_changed；get 在 Claude/Codex 两个隔离全局目录单项更新。
- pull 文档隔离：为项目 docs/Wiki 和历史镜像目标设置已有文件及本地草稿，验证首次、重复、force、自动 Hook pull 前后文件摘要完全一致；显式传 docs/wiki 类型时拒绝执行。
- 失败注入：网络刷新失败、远端拒绝、权限错误、拷贝中断、取消删除、存在本地改动。
- Hook：从项目 SessionStart 入口运行，验证传递准确项目身份，只同步 skills/rules/env/agents 四类，不写入或清理 docs/Wiki、不执行 postPull/usage/MCP 等非 spec 副作用。
- 按根 AGENTS.md 更新中英文 usage guide 和受影响 skills；命令变化后生成 `skill-data/core/references/commands.md`。
- Build 后用真实 CLI 对临时夹具执行代表性 E2E，记录准确 CLI 版本、输入、输出与前后文件摘要。然后运行项目要求的 build、typecheck、lint、测试；每条记录包含实际退出码。
- 在记录独立只读 review 结果并修复发现后，才将 plan 标为 completed。没有执行的检查保持未完成，不编造结果。

### P4 — 发布准备

- [ ] 评估上游/旧 fork 用户升级时的配置、Hook、get docs/wiki 和 docs 镜像迁移。
- [ ] 准备发布说明、升级步骤、行为变化、已知限制及可逆迁移/回滚步骤。
- [ ] 审核 PR diff、文档/skill 同步及 CI；部署或发布需要另行的明确发布授权。

## 预期主要代码触点

| 文件/区域 | 计划职责 | 验证重点 |
|---|---|---|
| `src/index.ts` | 注册参数与互斥/组合校验 | help、Commander 参数解析 |
| `src/types.ts`、`src/config.ts` | project identity、必要同步状态 | 旧配置解析、迁移、secret 不落盘 |
| `src/manifest-schema.ts`、`src/resource-namespaces.ts` | 项目资源声明与共享归属 | 旧 CLI 兼容、未知资源安全处理 |
| `src/push.ts` | project-only 六类扫描与既有 provider 发布 | 不扫描共享全局目录、不误发其他项目 |
| `src/pull.ts`、`src/hook-handlers.ts` | project-only 四类部署和自动入口，移除 docs/Wiki 镜像路径 | 不回退 user scope、不带入未声明副作用 |
| `src/get-cmd.ts` | shared skills/rules 到单 Agent 全局目录及增量更新 | 不写项目目录、不跨团队猜源 |
| `src/resources/*.ts` | 四类工具资源 handler；docs/wiki 仅项目读取与团队仓发布 | mapping、diff、冲突、delete、安全写入 |
| `src/utils/wiki-source-anchor.ts`、`src/recall.ts` | 将 docs 发布映射用于原文引用校验 | hash 状态如实，不改 frontmatter |
| `skill-data/`、`docs/usage-guide.*` | 操作入口和用户文档 | 多语言行为一致，明确不是已部署状态 |

实际改动以 P1 读码为准；若实现可通过扩展现有 handler 完成，移除不需要的触点，避免无用抽象。

## 风险与回滚

- **scope 误判写错目录**：项目绑定 ID/root 同时校验；歧义失败关闭；dry-run 显示绝对读写位置。
- **docs/Wiki 覆盖原创**：pull 和迁移均不写项目原文或旧镜像目录；push 只读原文，对团队仓发布副本做冲突保护，显式删除也只作用于团队仓已托管副本。
- **上游和 Agent 并发编辑 skill**：逐项安装状态，冲突保留本地；force 只对预览列出的项生效。
- **旧 Hook 调用旧行为**：部署新版前识别 Hook 版本，不能只改交互 CLI 而漏掉 session-start 路径。
- **索引与文件不同步**：索引刷新单独标状态，文档发布成功不等于 recall 已可检索。
- 回滚前备份本机状态文件和受管理输出；关闭新自动入口后再恢复旧二进制。不得用 reset/stash 丢弃用户工作区变化。

## 计划状态

待需求方评审本 spec 与本 plan。当前没有代码改动、测试、安装、配置迁移或远端发布证据；不可标记 completed。
