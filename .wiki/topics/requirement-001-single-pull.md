---
{"id":"requirement-001-single-pull","type":"topic","title":"001 — teamai-get 单资源拉取","aliases":["single-pull","teamai-get"],"status":"superseded","freshness":"fresh","verified_at":"2026-09-19","sources":[{"path":"docs/001-teamai-single-pull/intent.md","sha256":"7301e8909f9fc9c0f6795749d093d163ae53eb9d7c338bdc49f5d59e7029f7c1"},{"path":"docs/001-teamai-single-pull/spec.md","sha256":"675caa76b9483446599998085cf4764ff55082f8eb3b7cf848fda5a7fbeeda91"},{"path":"docs/001-teamai-single-pull/plan.md","sha256":"93ca0cf5fcf4b766a9ea9ec04af1a4ca335ce8573dec632ab311f54386e0ceb9"},{"path":"docs/001-teamai-single-pull/change.md","sha256":"bdfff25299893c7851f6c0cb6cc4766acc1891d899cc3834b5b502600ab2df83"}],"relations":[{"type":"supersedes","target":"requirement-002-native-get"}]}
---

# 001 — teamai-get 单资源拉取

## Summary

以外挂 bash 脚本 `teamai-get` 实现单资源/单页拉取（skills/rules/docs/wiki 四类，单条 + 镜像），
解决 `teamai pull` 全量同步缺乏「单选」能力的问题。后被 002 原生实现取代。

## Explanation and evidence

- 接口：`teamai-get list [type]` / `teamai-get <type> [name] [tool]`；docs 支持 `--all`、wiki 支持 `--diff`/`--prune`
- 规则：单条同名需 `--force`；镜像保留本地多余；`--prune` 才删
- 局限（明示）：rules 不做 per-tool 渲染；wiki/docs 不做内容级合并；脚本不随团队仓分发
- 遗留：002 将其「以原生子命令实现」并清理脚本

## Related

- 被 [requirement-002-native-get](requirement-002-native-get.md) 取代

## Sources

- [intent](../../docs/001-teamai-single-pull/intent.md) · [spec](../../docs/001-teamai-single-pull/spec.md) · [plan](../../docs/001-teamai-single-pull/plan.md) · [change](../../docs/001-teamai-single-pull/change.md)
