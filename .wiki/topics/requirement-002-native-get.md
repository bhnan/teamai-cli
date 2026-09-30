---
{"id":"requirement-002-native-get","type":"topic","title":"002 — 原生 teamai get + docs 绑定 + wiki 一等资源","aliases":["native-get"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-19","sources":[{"path":"docs/002-teamai-native-get/intent.md","sha256":"397b7307e70f69d8867ee90775aa4ed1c68fead18f22ff04bea8266a0aadb3e9"},{"path":"docs/002-teamai-native-get/spec.md","sha256":"64b2bc57effeb2a396a9feb6dda2d43bc3c7f9fed548be38a3db7ae1ddfb9133"},{"path":"docs/002-teamai-native-get/plan.md","sha256":"87992ce84619d92e849d79ceb89e1a2fa862250343351c1d0f7288764f3ba02d"}],"relations":[{"type":"supersedes","target":"requirement-001-single-pull"},{"type":"related","target":"requirement-003-docs-wiki-namespaces"},{"type":"related","target":"requirement-007-project-sync-shared-get"}]}
---

# 002 — 原生 teamai get + docs 绑定 + wiki 一等资源

## Summary

在 fork 内把 `teamai get` 实现为原生子命令：单资源拉取 + list 发现 + 镜像/diff/prune；
docs 落点绑定项目根；`.wiki/` 成为一等资源（push 扫描 + pull 镜像）。

## Explanation and evidence

- `teamai get list [type]`、`teamai get <type> <name> [tool]`；docs 支持 `--all`，wiki 支持 `--diff`/`--prune`
- docs 项目绑定：`sharing.docs.localDir` 默认 `~/docs` → project scope 落 `<projectRoot>/docs`
- wiki 一等资源：`WikiHandler`（pull 镜像、push 逐页 diff 开 MR）
- 新设备接入：`npm install -g github:bhnan/teamai-cli` + `teamai init <团队仓>`
- **007 修订**（见 [requirement-007-project-sync-shared-get](requirement-007-project-sync-shared-get.md)）：`get` 收窄为共享根 skills/rules → 指定 Agent 全局目录；`get docs/wiki` 镜像与 `--all/--diff/--prune` 已移除（显式传入非零退出，指引 push 单向发布）；namespace-only 名字拒绝并指引 pull；安装记录 `sharedInstalls` 落 user 级 state；新增反向命令 `put`。docs 落点绑定改为 push 单向发布到团队仓 `docs/<projectId>/`

## Related

- 取代 [requirement-001-single-pull](requirement-001-single-pull.md)；为 [003 命名空间](requirement-003-docs-wiki-namespaces.md) 打基础

## Sources

- [intent](../../docs/002-teamai-native-get/intent.md) · [spec](../../docs/002-teamai-native-get/spec.md) · [plan](../../docs/002-teamai-native-get/plan.md)
