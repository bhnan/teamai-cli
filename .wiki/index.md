# TeamAI CLI fork — Wiki 索引

这个 Wiki 把 `docs/` 下的需求链（001-007）、设计文档、使用指南与 CI 约定整理为结构化知识，提供稳定的检索入口。

- [overview](overview.md) — 项目概览
- [purpose](purpose.md) — Wiki 用途与边界
- [schema](schema.md) — 页面类型与关系
- [log](log.md) — 变更日志

## 主题页

### 需求链
- [requirement-001-single-pull](topics/requirement-001-single-pull.md) — `teamai get` 单资源拉取（001，脚本原型→原生）
- [requirement-002-native-get](topics/requirement-002-native-get.md) — 原生 `get` 子命令 + docs 项目绑定 + wiki 一等资源（002）
- [requirement-003-docs-wiki-namespaces](topics/requirement-003-docs-wiki-namespaces.md) — docs/wiki 逻辑项目命名空间（003，含 C1/C2）
- [requirement-004-git-native](topics/requirement-004-git-native.md) — docs/wiki 纯 Git 原生管理，TeamAI 只做跨项目检索（004）
- [requirement-006-wiki-source-citation-mapping](topics/requirement-006-wiki-source-citation-mapping.md) — 团队仓 Wiki 的检索与原文引用（006，`recall --wiki-page`）
- [requirement-007-project-sync-shared-get](topics/requirement-007-project-sync-shared-get.md) — 项目同步与共享资源获取：push 六类 / pull 四类 / 共享 get 收紧 + put（007）

### 设计
- [design-namespaces-isolation](topics/design-namespaces-isolation.md) — 命名空间与隔离机制全景：上游投递模型 vs 004 Git 原生（合并上游 2026-09-27 考证）
- [design-multi-project](topics/design-multi-project.md) — 多项目管理：project 维度
- [design-data-layout](topics/design-data-layout.md) — 机器数据目录布局与分区
- [design-gitcode-provider](topics/design-gitcode-provider.md) — GitCode 平台 provider（#361）
- [design-git-native-memory](topics/design-git-native-memory.md) — Git-Native 团队记忆系统（Hindsight 启发）
- [design-management-backend](topics/design-management-backend.md) — Management backend 提案（#341）
- [design-team-intelligence-platform](topics/design-team-intelligence-platform.md) — 团队智能平台（会话 + 用量分析）
- [design-dashboard-unified](topics/design-dashboard-unified.md) — Unified dashboard
- [design-model-profiles](topics/design-model-profiles.md) — Model profile 管理
- [design-skill-serving](topics/design-skill-serving.md) — 从 CLI 提供内置 skill 内容

### 使用与运维
- [usage-guide](topics/usage-guide.md) — 使用指南要点（含 006 `--wiki-page`、007 边界）
- [providers](topics/providers.md) — Git 提供方
- [ci-conventions](topics/ci-conventions.md) — CI 约定（e2e-setup / code-erosion）
- [product-overview](topics/product-overview.md) — 产品概览（三层架构）
- [windows-hooks](topics/windows-hooks.md) — Windows 上 hooks 触发指南
