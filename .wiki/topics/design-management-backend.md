---
{"id":"design-management-backend","type":"topic","title":"设计：Management backend（#341 提案）","aliases":["management-backend"],"status":"proposed","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/designs/management-backend.md","sha256":"70f1e05b19e447faf6daf84b29779cd0fa2e7521db23a368d469a5fc8efde302"},{"path":"docs/designs/management-backend.zh-CN.md","sha256":"26f527dcbcfadafdfb5c82eefd2a16eed7184d0628d24f1a3ccd597bfea89b2c"}],"relations":[{"type":"related","target":"design-data-layout"},{"type":"related","target":"design-multi-project"}]}
---

# 设计：Management backend（#341 提案）

## Summary

未来管理后端的**提案设计**（Issue #341）：覆盖已发布资源与成员生成数据，普通用户无需 Git/
凭据/仓库 URL/贡献流程。首交付物即本文档 + 中文版；实现需先通过列出的决策与验收门。
本设计不新增 Go 服务、Web 控制台或 CLI 行为变更。

## Explanation and evidence

- 范围：能力映射覆盖 teamai.yaml/skills/rules/docs/env/agents/hooks/mcp/learnings/culture/
  claudemd/tags/manifest/members/stats/votes/sessions/removed 的现状 → 后端记录形态
- 领域模型：`Organization -> Team -> Project` 管理层级；`WorkspaceBinding` 连接用户+设备+项目
- 验收门：A01–A13（导入审计、身份（J1）、设备注册（J2）、租户隔离（J3）、两项目并发发布（J4）、
  幂等/ETag、中断恢复、吊销/离线租约、恶意输入、卸载保留、重放恢复、备份恢复、双语等价）
- 非目标（本 PR）：Go 服务、Web 控制台、CLI 行为变化、生产 OAuth 认证声明、改 usage-guide
- 开放决策：参考存储/部署、SSO 与组同步、租户管理员权限、评审法定人数、密钥投递等

## Related

- 依赖 [design-data-layout](design-data-layout.md)（本地分区 vs 逻辑项目）与
  [design-multi-project](design-multi-project.md)（project/role 选择器）的既有区分

## Sources

- [management-backend.md](../../docs/designs/management-backend.md) · [中文版](../../docs/designs/management-backend.zh-CN.md)
