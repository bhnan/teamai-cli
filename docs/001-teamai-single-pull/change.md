# Change Log — 001-teamai-single-pull

## C1 — 交付后方向调整：实现载体由外挂脚本改为 teamai-cli 原生子命令

- **日期**：2026-09-17
- **来源**：需求方反馈——不应以外挂脚本实现，应克隆 teamai-cli 项目在项目内原生实现（「从项目的角度去实现」）；001 的实现载体选型被判定为错误方向
- **影响**：
  - 001 基线交付物（`scripts/teamai-get`、`/usr/local/bin/teamai-get`、`teamai-ops` skill 中的引用）将被 002 的原生 `teamai get` 子命令取代，002 交付后移除
  - 原生实现可修复脚本的两个已知限制：rules 的 per-tool 格式渲染（复用 `ruleFileExtensionForTool`）、user/project scope 感知（复用 `scopedToolPaths`）
- **去处**：转入新需求目录 [`docs/002-teamai-native-get/`](../002-teamai-native-get/intent.md)（目标代码库为 fork 仓库 `/root/teamai-cli`，独立重走 Plan → Design → Build 流程）
- **状态**：已接受（需求方明确指示）；001 三份文档冻结为历史基线，不再修改
