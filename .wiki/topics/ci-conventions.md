---
{"id":"ci-conventions","type":"topic","title":"CI 约定（e2e-setup / code-erosion）","aliases":["ci"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-19","sources":[{"path":"docs/ci-e2e-setup.md","sha256":"34c253266ac14b847fa596d1242d2f5fe3a4389ef89f6fbafb983e6b699447c0"},{"path":"docs/ci-code-erosion.md","sha256":"434f0fc50da6c777bb14334e4cbf3473a1089908519e3191d04b078783b7a194"},{"path":"docs/ci-code-erosion.zh-CN.md","sha256":"e6f7e9d864efd19d445cae3ce8b0b8836624b8dad29785914c09247978678496"}],"relations":[]}
---

# CI 约定（e2e-setup / code-erosion）

## Summary

`ci-e2e-setup.md`：真实 CLI 端到端测试的搭建约定；`ci-code-erosion.md`：代码侵蚀（slop 指标）
工作流，防止 AI 生成代码的腐化。

## Explanation and evidence

- E2E：本地夹具团队仓 + build 产物 CLI（本会话 003/004 均按此执行）
- Code erosion：随 PR 的指标化检查（CI workflow `code-erosion.yml`）

## Sources

- [ci-e2e-setup](../../docs/ci-e2e-setup.md) · [ci-code-erosion](../../docs/ci-code-erosion.md) · [中文](../../docs/ci-code-erosion.zh-CN.md)
