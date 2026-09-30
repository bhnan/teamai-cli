---
{"id":"design-model-profiles","type":"topic","title":"设计：Model profile 管理","aliases":["model-profiles","models"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/designs/model-profiles.md","sha256":"3a3e649c108681ee01499618e6ae12cb9e2ea0d83ca24874b1d3836c473ea2bd"},{"path":"docs/designs/model-profiles.zh-CN.md","sha256":"a07a3b8f948f20ecb399ad4b7445f64b4eb8fc269882b7d82d2c172df5ecc0ec"}],"relations":[{"type":"related","target":"usage-guide"}]}
---

# 设计：Model profile 管理

## Summary

团队发布**一个网关目录**（`models/models.yaml` + `models/<ns>/models.yaml`），让所有受支持
agent（Claude Code/Codex/OpenCode/CodeBuddy/WorkBuddy）共用；个人可保留私有网关，
不把团队 Git 仓变成密钥仓库。

## Explanation and evidence

- 目录格式：`id`/`name`/`base_url`/`api_key: ${API_KEY}`（占位符）/`model_groups`
  （protocols: anthropic/openai-responses/openai-chat-completions，按组声明、从不推断）
- 数据归属：团队 profile 入 git（无密钥）；个人 profile 与密钥在 `~/.teamai/models/`
  （`values.json`/`teams/<team>-<hash>.json`/`managed.json`，0600，非加密）
- 切换语义：仅 `teamai models switch` 后 pull 才重放团队目录；字段用户改过的不覆盖
- namespace 规则（#707）：`models/<ns>/` 只在激活时读取；namespace 覆盖根 profile 同名 id；
  两激活 namespace 同名或解析失败 → 该 pull 停止更新模型、agent 保持原样
- key 绑定：按 profile `id` + `base_url` 的 origin 绑定（`team:<id>@<origin>`），
  换网关需 `teamai models switch team:<id>` 重新录入
- agent 写入：Claude Code（settings.json.env）、Codex（top-level + model_providers）、
  OpenCode（providers）、CodeBuddy/WorkBuddy（models.json）；`auth.json` 永不触碰

## Related

- models 命令入口见 [usage-guide](usage-guide.md)

## Sources

- [model-profiles.md](../../docs/designs/model-profiles.md) · [中文版](../../docs/designs/model-profiles.zh-CN.md)
