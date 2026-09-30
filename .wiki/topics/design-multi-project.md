---
{"id":"design-multi-project","type":"topic","title":"设计：多项目管理（project 维度）","aliases":["multi-project"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/designs/multi-project-management.md","sha256":"05bd16a627854a234bd98f2ac33cb10abdefc417a43ca8463d4255322ffd6f22"}],"relations":[{"type":"related","target":"design-data-layout"}]}
---

# 设计：多项目管理（project 维度）

## Summary

`project` 是独立于 `role` 的第二个分发维度：`manifest/projects.yaml` 定义逻辑项目，
目录激活（`teamai projects set` / `teamai init --project`）决定同步哪些命名空间。
003 扩展（Extension 003 节）把 docs/wiki 以路径即归属纳入。

## Explanation and evidence

- role = 职能，project = 归属；命名空间取并集，无优先级覆盖
- learnings 由 project 独占命名空间（`learnings/<pid>/`）；docs/wiki 003 起路径归属
- 无 join/leave 命令——项目归属跟随工作目录
- 向后兼容：无 manifest 行为不变

## Related

- [design-data-layout](design-data-layout.md) 决定机器数据分区

## Sources

- [multi-project-management](../../docs/designs/multi-project-management.md)
