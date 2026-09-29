---
{"id":"design-skill-serving","type":"topic","title":"设计：从 CLI 提供内置 skill 内容","aliases":["skill-serving","builtin-skills"],"status":"accepted","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/designs/skill-serving.md","sha256":"408338caa5526deafd6c2e2b3d728eaabfa85223a0aea7da0cd660574b482ad9"}],"relations":[{"type":"related","target":"design-team-intelligence-platform"}]}
---

# 设计：从 CLI 提供内置 skill 内容

## Summary

内置 skill 内容**随 CLI 版本化**（Issue #678）：打包进 npm 包、由安装后的二进制按需打印，
`teamai skill get core` 在版本 X 上逐字节打印版本 X 的指令，无需 pull。升级 CLI 即更新，
没有别的同步面。

## Explanation and evidence

- 问题：`deployBuiltinSkills` 把三整个 skill 目录复制进每个 agent（176 KB/agent，
  team-wiki-codebase SKILL.md 单文件 38KB 全读），且 agent 指令与所描述二进制分版本
- 形态：唯一部署单元 `skills/teamai/SKILL.md`（~2 KB stub）；`skill-data/` 永不部署，
  由 `teamai skill get core/setup/wiki/share` 按需打印（--full 含 commands.md 等）
- 按需读取：session start 读 stub frontmatter → 任务匹配读 stub body → `skill get` 取详情
- 语义：`BUILTIN_SKILL_NAMES` 只含单一名；`skills/` 保持「这里全是部署物」不变式

## Related

- skill-data 组织结构与 teamai-ops 的「skill 目录 + stub 一行」约定一致

## Sources

- [skill-serving.md](../../docs/designs/skill-serving.md)
