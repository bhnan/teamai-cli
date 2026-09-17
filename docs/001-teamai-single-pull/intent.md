# Intent — teamai 单技能/单内容拉取到当前项目

Status: confirmed（需求方已确认范围与路线；进入 Design/Build，plan 获批前不改实现代码）

## 问题

teamai 的资源同步是全量单向的：`teamai pull` 按 scope 全量同步团队仓资源，`teamai skill exclude` 只能反向排除。缺少「把团队仓中的某一个 skill / rule / doc 拉到当前项目」的正向单选能力。实际场景（新项目只要某一个资源）目前只能人工 `cp`，无规范、易踩坑（namespace 布局、目标目录选择、与全量同步的关系）。

## 用户

- 本机 AI agent 会话的使用者（DSH / Claude Code / Codex）
- 未来 pull 到 `teamai-ops` skill 的团队成员的 agent（自然语言触发同一能力）

## 现状与已验证事实

- 官方命令面已核实（teamai-cli 0.24.0）：`pull` 无选择参数；`teamai skill` 仅 `list` / `show` / `exclude`
- 团队仓克隆就在本地（`~/.teamai/projects/<slug>/team-repo/`），单拉可零网络完成
- DSH 具备 hook 基础设施（`dsh-hook-protocol` + `dsh-hooks-claude-code` / `dsh-hooks-codex` 桥，兼容 command 型 hook），但 teamai 未提供 dsh 注入适配——与本需求无阻塞，仅作背景
- `/usr/local/bin/teamai-get` 原型脚本（流程叫停前起草）：**需求方决议推倒重写**，不作为实现基础

## 范围（已确认 + 追加）

- **skills + rules + docs 三类资源的单条拉取**均纳入本期
- **【追加】`.wiki` 类知识库内容**（独立 `.wiki/` 目录）：整库镜像 + **单页拉取**
- **【追加】docs 内容**：单文件 + 整目录（`--all`）
- **【追加】发现能力**：`list` 列出团队仓中可拉取的资源，再按名单拉——与 `teamai skill list` → 单技能拉取的体验同构
- 拉取方向：团队仓本地克隆 → 当前项目对应 agent 目录（skills）或项目内位置（rules / docs / .wiki）

## 约束

- 不修改 teamai npm 包内部（升级会被覆盖）；实现须独立于官方包版本演进
- 离线可用：只读本地团队仓克隆，不产生网络请求
- 与 `teamai pull` / `push` 语义共存：不破坏全量同步，明确「单拉副本」与「同步副本」的关系
- 目标目录遵循各 agent 官方约定（`.claude/skills/`、`.dsh/skills/`、`.cursor/rules/` 等）

## 成功标准

1. 一条命令完成：`teamai-get <type> <name>` → 资源落入目标位置 → 输出明确结果
2. 边界情形有清晰报错：资源不存在、未 init、namespace 歧义、目标同名冲突
3. 不影响 teamai 后续 pull/push（不产生同步冲突）
4. `teamai-ops` skill 更新为引用新命令，agent 可自然语言触发（「把 X 拉到这个项目」）

## 非目标

- 不做反向的单资源 push
- 不修改上游 teamai-cli 源码；**不向官方提 feature request**（需求方决议）
- 不做 rules 的 per-tool 格式渲染（如 Cursor `.mdc` frontmatter）
- 本命令不随团队仓自动分发给队友（teamai 同步面不含可执行脚本）

## 决议记录

| 开放问题 | 决议 |
|---|---|
| 本期范围 | skills + rules + docs 全纳入 |
| 实现路线 | A：伴生命令入库（`scripts/teamai-get`） |
| 原型脚本处置 | 推倒，按 spec 重写 |
| 上游 feature request | 不提 |

## 开放问题（范围追加）— 已全部决议

6. wiki 源位置 → **独立 `.wiki/`**（内容是文档型知识库而非 codebase，不用 `teamwiki/`）
7. wiki 粒度 → **整库镜像**保存全部内容（diff 查看区别）**+ 单页拉取**（与 skills 同构的「list → 单选」体验）
8. docs 粒度 → **单文件 + 整目录（`--all`）** 双模式
