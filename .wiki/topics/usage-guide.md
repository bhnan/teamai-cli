---
{"id":"usage-guide","type":"topic","title":"使用指南要点","aliases":["usage"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/usage-guide.md","sha256":"1efb90d9f086d45306f3fb512bf331e7fb847c6d1aa8cd04e9be7021d5d4b3c2"},{"path":"docs/usage-guide.zh-CN.md","sha256":"7568525ebaa97e4e85f0d622b1d440f0985ecf13518716c605f863e06dd8a47f"}],"relations":[{"type":"related","target":"requirement-007-project-sync-shared-get"}]}
---

# 使用指南要点

## Summary

`docs/usage-guide.md`（中英双语）的检索要点：初始化与 scope、多项目激活、push 六类 / pull 四类（007 边界）、共享 get/put、知识检索与贡献、006 的 Wiki 原文引用校验。

## Explanation and evidence

- **pull（007 边界）**：项目级四类资源同步（`skills`/`rules`/`env`/`agents`），仅在已初始化 project scope 内运行；无项目配置的目录报错并指引 `teamai init` + `teamai projects set <id>`，不再回退 user scope，`inheritUserScope` 不再生效。项目 `docs/`、`.wiki/` 由 push 单向发布，pull 零写入、不创建/清理镜像；随旧 pull 的协调动作（Hook/MCP reconcile、模型 profile 同步、usage 上报、postPull）拆分为显式命令（`hooks inject`、`mcp inject`、`models …`），不被 pull/get 隐式触发。写前打印 `[pull] scope: project=<id>, agent=<tool|all>, types=<list>`；`--types docs,wiki` 直接拒绝；`--agent`/`--skill`/`--rule` 收窄，省略 `--project` 时对目录全部激活项目生效。
- **push（007 边界）**：项目级六类发布；`--types docs,wiki` 把项目自己的 `docs/`、`.wiki/` 只读发布到团队仓 `docs/<project>/`、`.wiki/<project>/`，其他项目从 clone 读取（`recall` 亦在此索引）。单向发布安全：团队仓副本在他方上次发布后变更 → hold（报告、排除、非零退出），`--force` 只接管列出的冲突；项目原文删除 → pending-delete（交互确认后删团队仓副本）；无 `--project` 时单激活项目推导，多激活 + docs/wiki 推送停止并列出候选。
- **get（007）**：共享根 only 的单项安装/更新——`get skills <name> --agent <tool>` / `get rules <name> --agent <tool>` / `get list`；目标恒为所选 Agent 的 user/global 目录，不写项目目录；`--refresh` 只快进团队仓 clone（失败如实标注用了旧 clone）；重复 get 三方比较（unchanged / 安全 update / 本地编辑或双端变更 → conflict 不覆盖，`--force` 在展示后丢弃）；`--dry-run` 零写入；安装记录落 user 级 state。仅存在于 namespace 的名字（`skills/<ns>/<name>`）拒绝并指引 pull。**`get docs` / `get wiki` 已移除**。
- **put（007）**：`teamai put skills <path> | rules <file> [--namespace <ns>]` 反向发布单个本地 skill/rule 到团队仓共享根（默认，供全员 get）或 namespace（由 pull 投递）；走 provider 分支/PR 管线，不直接提交 clone 默认分支；`--dry-run` 打印 `Would publish … → skills/<name>`。
- **006 `recall --wiki-page`**（已合入）：团队仓 wiki 页 frontmatter `sources[]` 的 `{path, sha256}` 锚点经映射/校验后输出 JSON（verified/missing/out_of_scope/content_changed/unmapped/unverifiable），引用原文前必须 verified
- 检索团队仓 wiki 用 wiki 工具 + `WIKI_DIR` 指向克隆内集合，CLI 只做引用解析
- 多项目：`project` 是与 `role` 正交的第二维度；`teamai projects set` 激活
- SessionStart hook 自动 pull（项目范围四类入口）；`teamai contribute` 进知识库、`recall` 检索

## Sources

- [usage-guide.md](../../docs/usage-guide.md) · [usage-guide.zh-CN.md](../../docs/usage-guide.zh-CN.md)
