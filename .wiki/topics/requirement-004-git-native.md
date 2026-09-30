---
{"id":"requirement-004-git-native","type":"topic","title":"004 — docs/wiki 纯 Git 原生管理与跨项目检索","aliases":["git-native"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-19","sources":[{"path":"docs/004-wiki-docs-git-native/intent.md","sha256":"11dec63b363436369001b467aff012aadaa720ba7b7da03b30c8be1d5fc6ed78"},{"path":"docs/004-wiki-docs-git-native/spec.md","sha256":"7ddd2d76c6aeb5aed5c1e3055deee4d6dedfb23b4c75f805c0951bb6302f8d21"},{"path":"docs/004-wiki-docs-git-native/plan.md","sha256":"cd0f08c885a2677f16a0ae37e646decd7b6e8d9089bab13c0fd832c624bf6bc5"}],"relations":[{"type":"supersedes","target":"requirement-003-docs-wiki-namespaces"},{"type":"related","target":"design-multi-project"}]}
---

# 004 — docs/wiki 纯 Git 原生管理与跨项目检索

## Summary

docs/wiki 离开 pull/push 同步面：项目强相关的**上下文资源**由项目（团队仓克隆）本身以
纯 Git 管理；TeamAI 只提供**跨项目检索**（recall 本地克隆索引）+ 按需 `teamai get`。

## Explanation and evidence

- 模型：docs/wiki 内容以 Git 原生方式管理在团队仓克隆内（`docs/<pid>/`、`.wiki/<pid>/<wiki-id>/`），发布 = 普通 `git commit/push`，删除 = git 提交天然传播
- pull 同步集 = `skills/rules/env/agents`；push 扫描面同；项目工作区**零落地**（无镜像、无桥接目录）
- 佐证（已查证）：`teamwiki/` 全链路无 gitignore 写入；`code-incremental.ts` 显式建模 deleted；extract 不自动分发
- 测试清理 + `update.test.ts` scoped 包名修复 → 套件零失败；发布 `0.22.0-bhnan.4`

## Related

- 取代 [003 命名空间](requirement-003-docs-wiki-namespaces.md) 的同步机制；沿用其目录布局约定

## Sources

- [intent](../../docs/004-wiki-docs-git-native/intent.md) · [spec](../../docs/004-wiki-docs-git-native/spec.md) · [plan](../../docs/004-wiki-docs-git-native/plan.md)
