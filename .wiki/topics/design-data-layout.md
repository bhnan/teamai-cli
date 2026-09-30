---
{"id":"design-data-layout","type":"topic","title":"设计：机器数据目录布局与分区","aliases":["data-layout"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/designs/data-directory-layout.md","sha256":"be1f8bf5ca6c699962eddefd04ddf4bbb5d7b2703148be833bdfc0d135000917"}],"relations":[{"type":"related","target":"design-multi-project"}]}
---

# 设计：机器数据目录布局与分区

## Summary

机器本地数据从业务仓 `.teamai/` 迁到 `~/.teamai/projects/<slug>/`（按项目锚点分区），
实现业务仓**零残留**；worktree/子目录感知。

## Explanation and evidence

- 两个锚点：`projectAnchor`（主 worktree 路径，稳定身份）+ `workspaceRoot`（当前 worktree，资源落点）
- 分区命名：`<safe-path>-<sha256(前16)>`；legacy 分区自动迁移（原子 rename）
- 本机实例：`~/.teamai/projects/root-teamai-cli-b884478455d04826/`

## Related

- 与 [design-multi-project](design-multi-project.md) 的「路径即归属」共同支撑 003/004

## Sources

- [data-directory-layout](../../docs/designs/data-directory-layout.md)
