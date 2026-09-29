---
{"id":"requirement-007-project-sync-shared-get","type":"topic","title":"007 — 项目同步与共享资源获取（get 收紧 + put 新增）","aliases":["shared-get","put"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-29","sources":[{"path":"docs/007-project-sync-shared-get/intent.md","sha256":"5448716927cc17585342c21945e75942a4e345945f21deefe1eb38ef694fb68c"},{"path":"docs/007-project-sync-shared-get/spec.md","sha256":"c5844419bc9450dbb60c9e88e35b80fb61b4b69e081aa2c78b2f2198d658f2f9"},{"path":"docs/007-project-sync-shared-get/plan.md","sha256":"926ef2344cedcf87f4bacbf9909cf1da6fa0f55a7099deedd0ac05d8f0a7f794"}],"relations":[{"type":"supersedes","target":"requirement-002-native-get"},{"type":"related","target":"requirement-003-docs-wiki-namespaces"},{"type":"related","target":"requirement-004-git-native"},{"type":"related","target":"requirement-006-wiki-source-citation-mapping"}]}
---

# 007 — 项目同步与共享资源获取（get 收紧 + put 新增）

## Summary

确认的同步边界：`push` 项目级**六类**发布（skills/rules/docs/env/agents/wiki，其中 docs/Wiki 单向发布供跨项目参考）；`pull` 项目级**四类**部署（skills/rules/env/agents，显式拒绝 docs/wiki）；`get` 共享级仅 skills/rules，安装到指定 Agent 全局目录；新增反向命令 `put`。变更以三方基线比较保护本地修改；pull/get 不附带协调副作用。代码已随 `0.26.0-beta.5-bhn.0.2/.0.3/.0.4` 发布线合入；SDLC plan 的 P4（发布准备）未开始。

## Explanation and evidence

- **边界**（spec §1）：push = 当前项目 → 团队仓对应项目 namespace；pull = 团队仓对应 namespace → 当前项目（四类）；get = 团队仓**共享区** → 指定 Agent 全局目录。不提供 shared push/pull；共享 get 不回传全局目录编辑，贡献上游变更走后续明确定义的编辑/贡献流程。
- **调用形态**（spec §2）：`push/pull --project <id> [--agent <tool>] [--types <list>] [--skill <name>] [--rule <name>]`；`get skills|rules <name> --agent <tool> [--refresh] [--force]`；`get list [skills|rules]`。pull 显式传 docs/wiki 必须报错；省略 `--project` 时 pull 对当前目录全部激活项目生效，push 多激活时必须显式指定。
- **覆盖/删除语义**（spec §4，比较源 S、目标 T、上次同步基线 B）：`S=T` unchanged；仅 S 变 → 安全更新 T；T 远端变 → 保留并报告（hold）；S/T 双变且不同 → conflict 不写入；来源消失 → `pending-delete`（仅交互确认后删除，且 T 仍等于 B）；无基线目标已有内容 → unmanaged conflict 不接管；`--force`/resolve 只作用于列出项，冲突不阻塞其他独立资源但退出码非零。
- **需求方复核修正**（plan 2026-09-29 复核）：① 移除 `get docs/wiki` 镜像与 `--all/--diff/--prune`（显式传入即非零退出，指引 push 单向发布 + 团队仓副本读取）；② get 源解析收紧为共享根（`skills/<name>/`、`rules/<name>.md`），仅存在于 namespace 的名字报错并列副本、指引 pull；③ `sharedInstalls` 安装记录始终落 user 级 state（`~/.teamai/state.json`），保证换目录重复 get 判定一致。
- **`put` 新增**（需求方拍板，get 的同型反向命令）：`teamai put skills <path> | rules <file> [--namespace <ns>]` 把本地单个 skill/rule 经既有 provider 分支/PR 管线（pushGroup：回滚、marketplace 刷新、PR 复用）发布到共享根；`--namespace` 发布到角色/项目 namespace（由 pull 投递）。
- **`--dry-run`**（第二轮复核）：get/put 支持全局 dry-run，零写入（get 报告 Would install/update、已最新或将命中的冲突；put 不进 pushGroup，不复制团队仓、不推分支、不开 PR）；`get --refresh` 在 dry-run 下仍快进 clone。
- **副作用边界**（spec §5/§7）：pull/get 不隐式触发 Hook/MCP reconcile、模型切换、usage 上报、postPull；团队仓 clone 更新带回的 docs/Wiki 只是副本，不等于部署到业务项目；session-start Hook 必须改走项目范围四类入口。旧 `get docs/wiki` 用户与旧 docs 镜像提供可预览迁移，不自动迁移；pull 不再回退 user scope，`inheritUserScope` 不再生效。
- **验证**（plan）：`scripts/e2e-007.sh` 37/37 通过（项目目录零写入、user state 记录、namespace-only 拒绝、`get docs/wiki` 拒绝、put→合并→`get --refresh` 回环、双项目激活 pull 等）；`npx tsc --noEmit`、`npm run build` 通过；双语 usage-guide 与 skill-data 已同步。

## Related

- 重定义 [requirement-002-native-get](requirement-002-native-get.md) 的 get 语义（共享根 only、去 docs/wiki、user 级安装记录）
- 与 [003 命名空间](requirement-003-docs-wiki-namespaces.md)、[004 Git 原生](requirement-004-git-native.md)、[006 原文引用校验](requirement-006-wiki-source-citation-mapping.md) 衔接（docs/Wiki 发布布局沿用 `docs/<projectId>/`、`.wiki/<projectId>/`）

## Sources

- [intent](../../docs/007-project-sync-shared-get/intent.md) · [spec](../../docs/007-project-sync-shared-get/spec.md) · [plan](../../docs/007-project-sync-shared-get/plan.md)
