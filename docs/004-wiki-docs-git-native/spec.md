# Spec — wiki/docs 对齐 teamwiki 模式：纯 Git 原生管理（004）

Status: draft（随 plan 一并获批后实施）

## 需求定义（承接 intent）

wiki 和 docs 是 agent 的**上下文资源**，**项目强相关** → 由项目本身管理，
复用 **codebase wiki（`teamwiki/`）** 的实现方式：内容以 Git 原生管理，
传播以 Git 原生操作（commit/push）；TeamAI 只提供**跨项目检索**能力。
docs/wiki 不被 `teamwiki/` 替代——仍是独立资源类型，仅借其生命周期模型。

## 决策记录（2026-09-19 需求方确认：全部复用 codebase wiki 方式）

| # | 决策点 | 结论 |
|---|---|---|
| D1 | 发布机制 | **纯 Git**：在团队仓克隆内编辑 `docs/<pid>/`、`.wiki/<pid>/<wiki-id>/` → `git add/commit/push`；`teamai push` 的 docs/wiki 扫描/MR 机制退役 |
| D2 | pull 裁剪 | docs/wiki **移出 pull 同步集**（`src/pull.ts:678` 默认集只留 skills/rules/env/agents）；pull 对团队仓克隆仍做 git ff（既有行为）——他机内容更新靠 ff 到达克隆，**零落地项目工作区** |
| D3 | 共享层 | **不落地**：`docs/` 根文件与 `.wiki/<wiki-id>/` 共享集合不再镜像进任何目录；消费 = recall（克隆索引）+ `teamai get`（显式按需）|
| D4 | C2 回退 | 桥接目录机制**整体退役**：pull 侧 bundle/单一 home 排除、push 侧桥接扫描、`ResourceItem.localDir` 字段全部移除 |

## 目标行为

```
项目内容（docs/wiki）            TeamAI 角色
┌─────────────────────┐
│ 团队仓克隆            │← git ff（pull 的既有步骤）
│   docs/<pid>/       │← 人工编辑 + git commit/push（发布=纯 git）
│   .wiki/<pid>/…     │← 删除 = git 提交，天然传播
└─────────────────────┘
        │ recall（本地克隆索引，含其他项目）← 跨项目检索
        │ get（显式按需单条拉取）
        └ skills/rules/env/agents（teamai pull 分发，不变）
```

## 行为规则（各命令新语义）

1. **`teamai pull`**：同步集 = `['skills','rules','env','agents']`；对团队仓克隆仍执行 git ff（内容更新到达机制不变）；**不产生任何 `docs/`、`.wiki/` 镜像落地**
2. **`teamai push`**：docs/wiki 不再出现在扫描范围（`pushableTypes` 移除 docs/wiki）；skills/rules/env/agents 不变
3. **`teamai get`**：保留，语义不变——显式单条/镜像拉取（用户主动行为，不随 hook 自动发生）
4. **`teamai recall`**：不变——索引本机克隆（learnings + docs/ + teamwiki），跨项目可检索（这就是需求定义的能力）
5. **hook（session-start）**：仍触发 pull（git ff + skills 等）→ 克隆内容自动更新，**无工作区污染**（归因闭环）
6. **`teamai status`**：计数来自克隆（现有递归计数不变）
7. **`teamai list docs/wiki`**：列克隆内容（不变）
8. **删除传播**：git 原生——克隆内删除 → commit/push → 他机 ff 应用删除；无需 push 扫描 deleted 检测

## 代码触点

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/pull.ts` | 修改 | `resourceTypes` 默认集移除 `docs`、`wiki`；docs/wiki bundle 分支与命名空间清理挂钩移除 |
| `src/push.ts` | 修改 | `pushableTypes` 移除 `docs`、`wiki` |
| `src/resources/docs.ts` | 简化 | 移除 `scanTeamForPull`/`scanLocalForPush`/`pullItem`/`pushItem`/`cleanupInactiveNamespaces`/`countBundleFiles`；保留 `resolveDocsLocalDir`、`countDocFiles`（status 用）|
| `src/resources/wiki.ts` | 简化 | 同上；移除桥接（`listBridges` 等）与全部 pull/push 逻辑；保留 `localWikiDir`（get 用）|
| `src/resources/namespace-utils.ts` | 删除 | 若不再被引用则删除（含 `namespaceDirSafeToRemove`）|
| `src/types.ts` | 修改 | `ResourceItem.localDir` 字段移除 |
| `src/resources/index.ts` | 修改 | handler 注册表按需调整 |
| 测试 | 重写 | `docs-namespace.test.ts`/`wiki-namespace.test.ts` 改为 get/list/status 语义；`docs.test.ts`、`pull`/`push` 相关用例同步 |
| 文档 | 同步 | `usage-guide.md`/`.zh-CN.md`（pull/push 语义、wiki/docs 章节重写）；`teamai-ops` skill（发布方式改为纯 git 描述）|

## 兼容与回退

- **003 布局保留为团队仓约定**：`docs/<pid>/`、`.wiki/<pid>/<wiki-id>/` 仍是克隆内组织方式（recall 可索引），只是不再有同步机制
- **非 git 项目**：不构成问题——内容家始终是团队仓克隆（本身是 git 仓），与源项目是否 git 无关
- **存量镜像清理**（实施时执行）：删除本机 `/root/teamai-cli/.wiki/`、`docs/teamai-cli/`（pull 不再生成，属历史残留）；`/root/bhn/trading` 未 init、其 `.devwiki` 为工具自有目录，不归 teamai 管
- **C2 退役边界**：`<projectRoot>/.devwiki/` 等目录从 teamai 视野消失（不再扫描/镜像/桥接）；如需共享，人工纳入团队仓克隆 `.wiki/<pid>/devwiki/` 走 git

## 验收

1. `teamai pull` 后项目根**零新增** docs/wiki 目录（对比：改动前会出现 `.wiki/`、`docs/<pid>/`）
2. 克隆内编辑 `docs/teamai-cli/x.md` + git push → 另一目录 `teamai pull`（git ff）→ recall 可检索到新内容
3. `teamai push` 不再列出 docs/wiki 差异项
4. `teamai get docs/wiki` 单条与镜像可用；`teamai status` 计数正常
5. 全量单测零新增回归；E2E 记录贴入 plan
