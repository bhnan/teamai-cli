---
{"id":"design-gitcode-provider","type":"topic","title":"设计：GitCode Provider","aliases":["gitcode"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/designs/gitcode-provider.md","sha256":"ef8b055c2c7d9b535ed94f589058d18833f3a6a8a6b5945595e2dc0552c75846"}],"relations":[{"type":"related","target":"providers"}]}
---

# 设计：GitCode Provider

## Summary

为 `gitcode.com`（CSDN 旗下，Gitee/AtomGit 风格 v5 API）新增 provider 支持（Issue #361）：
`teamai init`/`push`/`fetchMergeRequest` 可用，认证走交互式贴 PAT（存 `~/.netrc`）。

## Explanation and evidence

- **关键结论：GitCode 是 Gitee 风格，不是 GitLab 风格**——API 域名独立
  （`api.gitcode.com/api/v5`）、Bearer 认证、whoami 字段 `login`、建 PR
  `POST /repos/{o}/{r}/pulls`（body `head/base/title/body`）、响应 `html_url`、
  个人建仓 `POST /user/repos`；以 GitLab provider 为骨架、按 Gitee 方言改写
- **认证选型**：不用 OAuth（无 device flow）、不嵌 gitcode-cli（npm 装不了），
  纯 REST + PAT；官方 MCP（gitcode-mcp）源码作为 API 契约还原方言
- **关键修复**：团队仓 clone 内嵌 `https://oauth2:<token>@...` 使 `git push` 能认证
  （GitLab 的一次性 extraHeader 会导致 push Access denied，实机复现）
- **端到端验证**（真实 CLI + 真实 GitCode 仓）：init 探测/认证/clone/成员注册、
  push 建分支 + 建 PR（`.../pull/1`）、fetchMergeRequest、HTTPS+SSH clone 全部通过
- 非目标：自托管企业版、OAuth 登录、gitcode-cli 依赖

## Related

- 与 [providers](providers.md) 的 provider 矩阵并列（github/gitlab/tgit/cnb/git 之外新增）

## Sources

- [gitcode-provider.md](../../docs/designs/gitcode-provider.md)
