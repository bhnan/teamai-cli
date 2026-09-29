---
{"id":"requirement-006-wiki-source-citation-mapping","type":"topic","title":"006 — 团队仓 Wiki 的检索与原文引用","aliases":["wiki-source-citation","wiki-page"],"status":"accepted","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/006-wiki-source-citation-mapping/intent.md","sha256":"0e8c0757c3a52f49b08f9ceae13c095d59fa7ed1b380262e314fe5aaef3192e4"},{"path":"docs/006-wiki-source-citation-mapping/spec.md","sha256":"55f1ad2ae271dc8f492e7b7a153171a7527345c3fa6c157b36a74315ccdb98bb"},{"path":"docs/006-wiki-source-citation-mapping/plan.md","sha256":"42cfe50fae70484fd9c6fe22f67909d9310c9532220fa89477cb65ecedca20cd"}],"relations":[{"type":"related","target":"usage-guide"}]}
---

# 006 — 团队仓 Wiki 的检索与原文引用

## Summary

在裸 `v0.26.0-beta.5` 上游基线独立落地：团队仓克隆 `.wiki/<pid>/<name>wiki/` 页面
frontmatter 的 `sources[]`（`{path, sha256}` 锚点）经 `recall --wiki-page` 映射回
真实文件并校验，输出严格 JSON，供 Agent 判定能否引用原文。

## Explanation and evidence

- **问题**：项目 `.wiki/` 页面的 `sources[].path` 按项目根相对书写，发布到团队仓
  命名空间（`docs/<pid>/`）后解析不到；`sha256` 也可能指向旧版本——Agent 无法把
  引用落到真实原文，且三种失配对调用方不可区分
- **契约**：页面 frontmatter `sources[]` 是唯一输入契约；默认映射只处理 `docs/…`
  形态，其他形态靠 `sharing.wiki.sources[].map` 显式覆盖；允许范围硬边界 =
  团队仓克隆 `docs/<pid>/` 子树（realpath 判定，符号链接逃逸 → out_of_scope）
- **四条判定**（逐锚点独立）：unmapped → missing → out_of_scope → content_changed，
  全通过才 `verified`（可打开 `resolved` 原文）；缺 sha256 → `unverifiable`
- **职责分工**：团队仓 wiki 检索归 wiki 工具（`WIKI_DIR` 指向克隆内集合），CLI
  只做引用解析（`recall --wiki-page`，隐含 `--json`）；不新增第二检索器
- **需求方决策**（2026-09-28）：新基线不带 fork 003/004 与 `get`；CLI 不输出 Wiki
  位置（规范由文档承载）；`allow` 字段与 `ambiguous` 状态不实现
- **状态**：plan in_progress（实现与验证完成，提交 6b12c7a/1cdd9b7/1fc8063，
  待需求方验收与独立评审）

## Related

- 与 [usage-guide](usage-guide.md) 的 `recall --wiki-page` 章节互证（006 已合入）

## Sources

- [intent](../../docs/006-wiki-source-citation-mapping/intent.md) · [spec](../../docs/006-wiki-source-citation-mapping/spec.md) · [plan](../../docs/006-wiki-source-citation-mapping/plan.md)
