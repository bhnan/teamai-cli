# Log

- 2026-09-19：初始创建——基于 `docs/`（001-004 需求链 + designs + usage-guide + providers + CI）摄取整理。
- 2026-09-27：新增 [design-namespaces-isolation](topics/design-namespaces-isolation.md)——上游合并（84d8ba7）时对命名空间/隔离机制的全景考证：ns=目录名恒等约定、manifest=行为开关、三层装配（内容/声明/成员）、投递四种命运、上游 docs 检查（#669）的出身与移除依据、fork ns≡pid 约定、005 提案衔接。
- 2026-09-29：**按 docs 变化同步（merge `1f41d39`，007 线）**。新增 [requirement-007-project-sync-shared-get](topics/requirement-007-project-sync-shared-get.md)（intent/spec/plan 三源，push 六类 / pull 四类 / 共享 get 收紧 + put）；重写 [usage-guide](topics/usage-guide.md)（刷新双源哈希，补 007 语义）；002/003 页补充 007 修订注记与关系；索引/purpose/overview/config 的需求链范围改为 001-007。`.wiki/` 已纳入 git 管理（含 `.state/`）。
