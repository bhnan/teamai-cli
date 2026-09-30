---
{"id":"design-dashboard-unified","type":"topic","title":"设计：Unified dashboard","aliases":["dashboard"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/designs/dashboard-unified.md","sha256":"0d6651a207413b387bc51a7fab519eda33907cbbfd11cb6b09b895c9e207fdd1"},{"path":"docs/designs/dashboard-unified.zh-CN.md","sha256":"d13aedd284f666f6532e04e194e68104ff6caf587593cd987a5ff43aef68a311"}],"relations":[{"type":"related","target":"design-team-intelligence-platform"}]}
---

# 设计：Unified dashboard

## Summary

以炭蓝配色、四模块导航、中英双语 UI 与亮/暗/跟随系统主题的**统一看板**取代原「仅会话」布局；
数据全部来自既有本地采集器与 KB report 聚合，不引入远程资源。

## Explanation and evidence

- 四模块：Overview（会话/七日均值/KB 覆盖）、Team Execution（工具与仓库过滤、会话明细）、
  Team Context（KB 总量/覆盖/top 召回/作者表）、Team Improvement（趋势与维护指引）
- 实现：`dashboard-html.ts` 把 shell/样式/语言包/浏览器应用嵌进一个 HTML 响应；
  `/api/sessions`、`/events`、`/api/trends`、`/api/kb-summary`、`/kb-report` 保留，
  `/api/context` 复用 `buildVizData` + 30s 缓存
- 成本语义：`/api/trends` 新增 `avgSessionCostMicros`/`pricedSessions`（首 Stop 落该 7 日期的
  会话队列），旧 `avgRequestCostMicros` 与日桶不变
- 验证（2026-09-16）：tsc/build 过、234 文件/3268 测试过、离线 git/gitlab/github fixture E2E
  过、浏览器亮暗/中英/过滤/键盘可达性验证；本地数据 /api/* 全 200
- 工作区选择：all/user/project scope 切换；legacy 安装从启动目录/事件 anchor/会话目录发现

## Related

- 与 [design-team-intelligence-platform](design-team-intelligence-platform.md) 的会话/用量采集衔接

## Sources

- [dashboard-unified.md](../../docs/designs/dashboard-unified.md) · [中文版](../../docs/designs/dashboard-unified.zh-CN.md)
