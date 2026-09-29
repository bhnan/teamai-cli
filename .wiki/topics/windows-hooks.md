---
{"id":"windows-hooks","type":"topic","title":"Windows 上的 hooks 触发（实践指南）","aliases":["windows","hooks-windows"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/windows-hooks.md","sha256":"0b59da9effdc0d2e4b05f0fb28ced235b32190fcaebbc8f8ec23d867ff378587"},{"path":"docs/windows-hooks.zh-CN.md","sha256":"f4df4eafd4acceb420bbfee02ad24e8e81eb7a26f2dcda8c56abec133cb7eeb0"}],"relations":[{"type":"related","target":"usage-guide"}]}
---

# Windows 上的 hooks 触发（实践指南）

## Summary

TeamAI CLI 在 Windows 上 hook 接线的实践指南（Claude Code/Codex/ZCode/CodeBuddy/Qoder/
WorkBuddy/Cline/Cursor/OpenCode）。旧版本曾用裸 `bash` launcher（WSL bash 是 Node 18，
解析不了 TeamAI bundle，`|| true` 掩盖失败），且从不写 codebuddy/workbuddy hooks。

## Explanation and evidence

- 当前 `teamai` 自处理 Windows：hook 命令经绝对 Git Bash 路径启动；每个 GUI 工具解析
  自己的 hook shell——WorkBuddy 用自带 PortableGit `sh.exe`，CodeBuddy 用 cmd.exe
- 持久用户侧修复（旧版本）：① agent settings 里用 Git Bash 绝对路径；② WSL wrapper
  经 cmd.exe 委托原生 Windows `teamai`（可扛住 pull 回退成裸 bash 的 hook）
- 验证：应用后 `teamai doctor` 六个工具健康，`hook-dispatch` 两条机制均 exit=0

## Related

- hooks 管理入口见 [usage-guide](usage-guide.md)

## Sources

- [windows-hooks.md](../../docs/windows-hooks.md) · [中文版](../../docs/windows-hooks.zh-CN.md)
