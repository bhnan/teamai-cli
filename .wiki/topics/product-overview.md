---
{"id":"product-overview","type":"topic","title":"产品概览","aliases":["overview"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/product-overview.md","sha256":"d74cbd25edcf0a19c3547d97d8a5f5733199530a2074d38bbc7a6ee4fa8988c3"},{"path":"docs/product-overview.zh-CN.md","sha256":"cf553a373acb06d277e1fda0df5386c18c980d9700e52e1ad5752c21cb81199a"}],"relations":[{"type":"related","target":"usage-guide"},{"type":"related","target":"providers"}]}
---

# 产品概览

## Summary

TeamAI 产品架构三层：**Team Execution**（让每个 agent 按团队方式工作）、**Team Context**
（beta，让每个 agent 理解团队）、**Team Improvement**（beta，让每次执行改进团队）。
支持 GitHub/GitLab/GitCode/CNB/TGit/私有 Git 六大 provider。

## Explanation and evidence

- Team Execution：`init`/`pull`/`push`、skills、rules、agents、hooks、MCP、env
- Team Context：recall、learnings、codebase graph、teamwiki
- Team Improvement：friction-based share-learnings、sessions、digest、dashboard
- 分发控制：projects（目录绑定逻辑项目）、roles（role→namespace）、tags（订阅）、
  sources（订阅额外 skill 仓）；learnings 根共享、`learnings/<pid>/` 项目私有

## Related

- 各模块入口见 [usage-guide](usage-guide.md)；provider 矩阵见 [providers](providers.md)

## Sources

- [product-overview.md](../../docs/product-overview.md) · [中文版](../../docs/product-overview.zh-CN.md)
