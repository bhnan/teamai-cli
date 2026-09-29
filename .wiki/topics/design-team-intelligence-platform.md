---
{"id":"design-team-intelligence-platform","type":"topic","title":"设计：Team Intelligence Platform（会话 + 用量分析）","aliases":["intelligence-platform","sessions","stats"],"status":"accepted","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/designs/team-intelligence-platform.md","sha256":"81a022e9bd673573bfdbf0f1aa07257b13f5984ed76fd5532dfc91084e43b4b7"}],"relations":[{"type":"related","target":"design-git-native-memory"},{"type":"related","target":"usage-guide"}]}
---

# 设计：Team Intelligence Platform（会话 + 用量分析）

## Summary

把 TeamAI 从「skill 共享 CLI」升级为**团队智能平台**：每次 AI 会话贡献共享知识（尤其 AI 工具误用
模式），skill 有用量指标，系统主动帮助发现有价值工具。核心：会话记录、skill 用量追踪、
团队用量聚合、健康度/推荐。

## Explanation and evidence

- 会话收集：collect-then-summarize（Stop hook 不直调 LLM，避免递归与 token 成本）；
  有价值才推送（工具错误/重试/新模式），`~/.teamai/sessions/<year-month>.md` 按月聚合
- Skill 追踪：PostToolUse hook + JSONL（`~/.teamai/usage.jsonl`，避免并发竞争）；`teamai stats` 聚合
- 团队聚合：pull 自动聚合为 `stats/<user>.yaml`；上报与 learnings 走独立孤儿分支 worktree
  （`teamai-reports` / `teamai-learnings`），不再直推默认分支（#484/#485）
- 工程决策：健康分 = usage(0-60) + freshness(0-40)；删 `push --stats` 只用 auto-report；
  `teamai track` 用 TS CLI 命令；复用 `utils/git.ts` 与 `hooks.ts` 最小 diff
- 安全：JSONL 只含 skill 名+时间戳，无会话内容；session 摘要不含代码/敏感数据；90 天保留
- 非目标：贡献者排行榜、跨团队 marketplace、web 实时看板、ML 推荐、Cursor hook（等 API 稳定）

## Related

- 与 [design-git-native-memory](design-git-native-memory.md) 同属「团队记忆/知识飞轮」方向；
  stats/session 入口见 [usage-guide](usage-guide.md)

## Sources

- [team-intelligence-platform.md](../../docs/designs/team-intelligence-platform.md)
