# Overview

TeamAI CLI fork（`@bhnan/teamai-cli`，基于上游 Tencent/teamai-cli 0.22.x）的核心演进：

1. **002**：原生 `teamai get` 子命令，docs 项目绑定，`.wiki/` 一等资源。
2. **003**：docs/wiki 逻辑项目命名空间（`docs/<pid>/`、`.wiki/<pid>/<wiki-id>/`），wiki 桥接目录（C2）。
3. **004**：docs/wiki 离开 pull/push 同步面，改为纯 Git 原生管理（对齐 `teamwiki/` 生命周期），TeamAI 只负责跨项目检索（recall）与按需 get。
4. **007**：边界收敛——push 项目级六类（docs/Wiki 单向发布）、pull 项目级四类、get 共享根 skills/rules 到 Agent 全局目录、新增 put；随 pull 的协调副作用拆为显式命令。

## 关键目录

- `docs/`：需求链（001-007，ai-native-sdlc 产物）+ designs + usage-guide + CI 文档
- `.wiki/`：本 Wiki（由 docs 摄取整理）
