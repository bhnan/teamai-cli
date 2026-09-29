---
{"id":"design-git-native-memory","type":"topic","title":"设计：Git-Native 团队记忆系统（Hindsight 启发）","aliases":["git-native-memory","memory"],"status":"accepted","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/designs/git-native-memory.md","sha256":"986764b75d285a452335d654e19dfb79c2f10252c40f00713fd3cfb0615e79b1"}],"relations":[{"type":"related","target":"usage-guide"}]}
---

# 设计：Git-Native 团队记忆系统（Hindsight 启发）

## Summary

借鉴 Hindsight 的 retain/recall/reflect 三层记忆模型，用 Git + 本地搜索索引实现团队知识的
自动回忆：补全 `teamai contribute`（写入）缺失的「读出路径」，让 AI 工作时自动想起他人经验。
知识飞轮：写入 → 索引 → 搜索 → 投票 → 排序。

## Explanation and evidence

- 存储：learnings/ 进团队仓 + 本地 `search-index.json`（pull 时重建，零同步冲突）
- 搜索：关键词 + `Intl.Segmenter`（CJK 友好，无 embedding 成本）；vote 机制按用户 YAML、
  搜索触发、幂等（`user-votes/<user>.yaml`）
- 范围决策：Auto-Recall on SessionStart 已被 `teamai-recall` subagent + builtin-rules 主动检索
  取代（#106）；Recall 自动投票与 Frontmatter 标准化 ACCEPTED；Reflect 层（LLM meta-insights）
  DEFERRED（知识库冷启动不足 20 篇）
- 三层映射：Retain=`teamai contribute` ✅ · Recall=`teamai recall`（BM25+Segmenter）· Reflect 延后

## Related

- 与 [usage-guide](usage-guide.md) 的 recall/contribute 入口衔接

## Sources

- [git-native-memory.md](../../docs/designs/git-native-memory.md)
