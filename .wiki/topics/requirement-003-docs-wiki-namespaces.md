---
{"id":"requirement-003-docs-wiki-namespaces","type":"topic","title":"003 — docs/wiki 逻辑项目命名空间","aliases":["namespaces"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-19","sources":[{"path":"docs/003-docs-wiki-project-namespace/intent.md","sha256":"4e70eb4bfdabadf8ebb2443884a16e1e9c85802a9a6b436fab74ff358569100d"},{"path":"docs/003-docs-wiki-project-namespace/spec.md","sha256":"087a5c156217e850380a0900bc0bd79b607daa4e75b784c592acdc8a7c33b6e6"},{"path":"docs/003-docs-wiki-project-namespace/plan.md","sha256":"cfa2d5a08b640502c2506eeb0f48aa32a70ec4f40c6c78d3a03e63b1ca111563"},{"path":"docs/003-docs-wiki-project-namespace/change.md","sha256":"a26d09643927569b87264c7934b4d2307324e745983f0d78804308357c69b271"}],"relations":[{"type":"related","target":"requirement-004-git-native"},{"type":"related","target":"requirement-007-project-sync-shared-get"}]}
---

# 003 — docs/wiki 逻辑项目命名空间

## Summary

docs/wiki 引入**路径即归属**的项目命名空间：`docs/<project-id>/` 项目私有，
`.wiki/<project-id>/<wiki-id>/` 项目私有（一个项目可多个 Wiki）。后续 C2 增加
`.<名字>wiki/` 桥接目录自动同步。004 将其整体重构为纯 Git 管理。

## Explanation and evidence

- 归属判定：第一层目录名命中 `manifest/projects.yaml` 定义的项目 id → 项目私有，否则共享
- 同步范围 = 共享根 + 激活项目命名空间；去激活清理带数据安全护栏（逐字节一致才删）
- C1：`teamai-ops` skill 同步 003 语义（PR #12/#14）
- C2：wiki 桥接目录 `.<名字>wiki/`（如 `.devwiki/`）——零配置，目录名即集合 id
- 独立评审：REQUEST CHANGES（10 项）→ 修复 → APPROVE；发布 `0.22.0-bhnan.3`
- **007 修订**（见 [requirement-007-project-sync-shared-get](requirement-007-project-sync-shared-get.md)）：pull 不再投递 docs/wiki——docs/wiki 由源项目 push 单向发布到 `docs/<projectId>/`、`.wiki/<projectId>/`，其他项目从团队仓 clone 读取；`docs/<ns>/` 命名空间仍门控成员 `recall` 的索引范围，但不再决定 pull 部署（pull 不部署任何 docs）

## Related

- 被 [requirement-004-git-native](requirement-004-git-native.md) 在管理模型上重构

## Sources

- [intent](../../docs/003-docs-wiki-project-namespace/intent.md) · [spec](../../docs/003-docs-wiki-project-namespace/spec.md) · [plan](../../docs/003-docs-wiki-project-namespace/plan.md) · [change](../../docs/003-docs-wiki-project-namespace/change.md)
