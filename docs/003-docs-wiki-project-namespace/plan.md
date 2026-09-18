# Plan — docs/wiki 逻辑项目命名空间实现

Status: completed（2026-09-18：实现/测试/E2E/独立评审全部完成）

> 评审记录：独立只读评审（REQUEST CHANGES，10 项发现）→ 全部修复 →
> 复核 APPROVE（2026-09-18，10/10 RESOLVED，含逐条 file:line 证据）。

## 实现步骤

### P0 勘察与基线
- [x] 代码勘察：`docs.ts` / `wiki.ts` 均为整目录 bundle + 相对路径 diff；
      `pull.ts` docs/wiki 分支取 `items[0]` 单 bundle；`get-cmd.ts` 走
      `resolveDocsSource` 相对路径解析；`projects.ts` 已有
      `loadProjectsManifest` / `listProjectIds` 可复用
- [x] 基线确认：002 实现已在 origin/main；worktree 分支
      `feat/docs-wiki-project-namespace` 就绪

### P1 共享命名空间解析工具
- [x] 新增 `src/resources/namespace-utils.ts`：
      `loadDefinedProjectIds` / `activeProjectIds` / `isProjectNamespace` /
      `inactiveProjectIds` / `listSharedTopLevels` / `namespaceDirSafeToRemove`

### P2 docs wiki bundle 化扫描
- [x] `DocsHandler.scanTeamForPull`：共享根 bundle + 每活动项目 bundle
      （`item.namespace` 标记项目 bundle；空 manifest / 无活动项目退化为单 bundle）
- [x] `WikiHandler.scanTeamForPull`：同上（共享 wiki 集合 + 项目多 wiki 命名空间）
- [x] `scanLocalForPush`：两 handler 均过滤「defined 但 inactive」命名空间目录
- [x] `pullItem`：共享根复制时 filter 排除第一层 project 目录；
      项目 bundle 落点 `<local>/<pid>`
- [x] `countBundleFiles`（docs）：共享 bundle 排除项目目录计数

### P3 pull.ts 命名空间清理
- [x] docs/wiki 合并分支：遍历多 bundle、dry-run 汇总计数
- [x] Step 3 清理挂钩：`cleanupInactiveNamespaces`（docs 带 teamConfig；
      数据安全护栏 = `dirContentEqual` 逐字节 + `hasVcsMetadataRecursive`，
      否则保留+警告；dryRun 只报候选；Step-3 块外执行使 dry-run 可见）
- [x] 评审修正（2026-09-18 独立评审 REQUEST CHANGES → 已解决）：
      #1 护栏盲区（dotfile/.git/node_modules 不可见但被删）→ 改用
      `dirContentEqual` + `hasVcsMetadataRecursive`（skills 同款）；
      #2 dry-run 清理报告接入 pull 干线；#4 `get --prune` 删命名空间前加
      同一护栏；#5 `activeProjectIds` 过 `isSafeNamespaceSegment`；
      #6 非目录态安全 + 警告带 scope 前缀；#8 删除未用的
      `listSharedTopLevels`；#9 尾换行；#10 wiki 计数改按页数（countBundleFiles）；
      #3 文档对齐（清理边界 = manifest 定义集 + 护栏）
- [x] 无 manifest / 无活动项目 → 全部退化为现状

### P4 get-cmd.ts 命名空间感知
- [x] 新增 `resolveNamespacedSource(repoRoot, name, projectDirs)`：
      共享根 + 活动项目探测；显式 `<pid>/` 前缀直接解析；
      多候选 throw 列候选（调用处 try/catch → fail，与 skills 一致）
- [x] 镜像模式（docs --all / wiki 全库 / --diff / --prune）范围 =
      共享 + 活动项目；`--prune` 整体清掉去激活命名空间本地目录
- [x] `computeWikiDiff` 加可选范围过滤（defined/active），向后兼容
- [x] `listTypeEntries` 保持全量（相对路径天然含前缀；Y5 显式点名语义）

### P5 status 核对
- [x] `countDocFiles` / wiki 计数已递归覆盖命名空间文件（E2E 断言 docs:4 / wiki:4）

### P6 测试
- [x] 新增 `src/__tests__/docs-namespace.test.ts`（7 用例）、
      `wiki-namespace.test.ts`（5 用例）、
      `get-cmd.test.ts` 扩展（resolveNamespacedSource 5 用例 +
      computeWikiDiff 范围过滤 1 用例）
- [x] 全量回归：3389 tests / 3379 passed / 10 failed —— 与 origin/main 基线
      完全一致的 10 个既有失败（fork 包名相关 update 测试 5 + 无网络 push
      测试 4 + pkg-team-distribution 1），**零新增回归**
- [x] `npx tsc --noEmit` ✓ / `npm run build` ✓
- [x] 真实 CLI E2E（本地夹具团队仓 + 双项目，build 产物 dist 驱动）：
  - E2E-1 alpha 激活 pull：`docs/shared.md`+`docs/alpha/a-doc.md`、
    `.wiki/team/Home.md`+`.wiki/alpha/{tech,product}` 落地；beta 完全不可见 ✓
  - E2E-2 `projects set beta` + pull：beta 出现、`Removed inactive docs
    namespace(s): alpha` / `wiki namespace(s): alpha`、共享保留 ✓
  - E2E-3 数据安全：本地草稿 `docs/alpha/draft.md` → `Kept docs/alpha` 警告保留；
    无修改的 `.wiki/alpha` 正常清理 ✓
  - E2E-4 get：显式前缀拉未激活项目 `get docs alpha/a-doc` ✓；
    wiki `.md` 后缀省略 ✓；歧义 `'shared' exists in multiple namespaces`
    列候选 exit 1 ✓
  - E2E-5 push 扫描仅列激活项目命名空间差异（`beta/new-doc.md` 前缀路径，
    alpha 草稿不出现）✓；`get docs --all --prune` 整体移除 alpha ✓；
    status docs:4 / wiki:4 ✓

### P7 文档同步
- [x] `usage-guide.md` / `usage-guide.zh-CN.md`：多项目章节新增 Docs isolation
      与 Wiki namespaces 要点；角色章节「rules/docs 保持原有同步逻辑」
      修订为「docs/wiki 获得项目命名空间（角色不选择它们）」
- [x] `docs/designs/multi-project-management.md`：新增
      「Extension (003)」章节（路径即归属模型 + 数据安全 + 保留词）
- [x] 本目录三件套随分支提交

## 测试策略

- vitest 单测：临时夹具（fake 团队仓克隆 + fake localConfig）
- E2E：真实 CLI + 本地团队仓夹具（不触碰线上团队仓）
- 回归：`npm test` 全量 + 无 manifest 场景对照

## 风险与回滚

- pull 清理误删本地独有文件 → 清理仅限命名空间级目录且只对「与团队仓逐文件
  一致」的本地副本；有本地改动保留 + 警告；`--dry-run` 可预览
- 归属判定把共享目录误认成项目目录 → 仅当目录名命中已定义 project id；
  文档化保留词约定
- 分支可整体回退（worktree + 特性分支，未触碰 main）

## 兼容性

- 无 manifest：docs/wiki 退化为现有单 bundle 行为，零变化
- 有 manifest、无活动项目：只同步共享根（与「未激活项目的目录不减共享」一致）
- 现有 `docs/`、`.wiki/` 平铺数据：需求方后续自行归置，本需求不动存量

## 验证记录

- 2026-09-18 typecheck ✓ / build ✓ / vitest 3389（10 既有失败与基线一致）
- 2026-09-18 E2E 五组场景全过（见 P6；夹具 /tmp/e2e-003，CLI =
  `node dist/index.js`）