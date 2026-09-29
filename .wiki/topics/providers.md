---
{"id":"providers","type":"topic","title":"Git 提供方支持","aliases":["provider"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/providers.md","sha256":"72d1389a37b14429fb643fa6bcd9d2c2512264048eba21e2246e0dcc658cff4f"}],"relations":[]}
---

# Git 提供方支持

## Summary

`docs/providers.md` 汇总支持的 Git 提供方（GitHub / GitLab / GitCode / tgit / cnb / 通用 git）与
`init` 格式、鉴权、push/MR 语义差异。

## Explanation and evidence

- 通用 git 提供方是传输层回退；团队仓本地路径 fixture 走 provider=git
- `init` 对未知 host 探测 self-hosted GitLab（GITLAB_URL/GITLAB_TOKEN）

## Sources

- [providers.md](../../docs/providers.md)
