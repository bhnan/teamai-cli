# Spec — docs/wiki 逻辑项目命名空间

Status: draft（随 plan 一并获批后实施）

## 团队仓命名空间布局（核心约定）

```text
team-repo/
  docs/                      # 共享根：始终对所有人同步（与现状一致）
    <project-id>/            # 项目私有文档：仅该项目激活时同步
    ...
  .wiki/
    <wiki-id>/               # 共享 Wiki 集合：始终对所有人同步
    <project-id>/            # 项目私有 Wiki 家目录
      <wiki-id>/             # 该项目的一个 Wiki（一个项目可有多个）
    ...
  manifest/projects.yaml     # 唯一新增来源：定义 project id 集合（已有，不改 schema）
```

**归属判定规则（路径即归属）：** 对 `docs/`、`.wiki/` 的第一层子目录名 X：
X ∈ 已定义 project id → 项目私有命名空间；否则 → 团队共享。
project id 的来源是 `manifest/projects.yaml`（`loadProjectsManifest`），
不新增任何 manifest 字段。

**保留词约定（文档化，防误用）：** 共享 docs/wiki 目录名不得与任何已定义
project id 相同，否则被当作项目私有命名空间处理（管理员避免；与 skills 的
ns 同名冲突同属管理员责任）。

## 同步语义

### pull

| 路径 | 同步条件 |
|---|---|
| `docs/` 根文件与共享子目录 | 总是 |
| `docs/<pid>/` | pid ∈ 活动项目 |
| `.wiki/<wiki-id>/`（共享） | 总是 |
| `.wiki/<pid>/<wiki-id>/` | pid ∈ 活动项目 |

- 活动项目 = `localConfig.projects`（`teamai projects set` 产物）
- 每类资源拆成多个 `ResourceItem`（整目录 bundle）
  - docs：`{name: 'docs', sourcePath: <clone>/docs, relativePath: 'docs/'}`（共享根）
    与 `{name: 'docs/<pid>', sourcePath: <clone>/docs/<pid>, relativePath: 'docs/<pid>/'}`
  - wiki 同理：共享根 `.wiki/` 之下过滤出共享子目录（第一层名字 ≠ project id），
    与 `.wiki/<pid>/` 各成一个 bundle
- 镜像语义不变：同名覆盖、**保留本地多余**（`--prune` 才删）
- **命名空间清理**：去激活项目（manifest 仍定义、但不在 `localConfig.projects`）
  → pull 时删除本地 `<projectRoot>/docs/<pid>/` 与 `<projectRoot>/.wiki/<pid>/`
  （与 skills/learnings 的 inactive namespace cleanup 对齐；只清命名空间级目录，
  不动共享根内容）。**数据安全护栏**：仅当本地目录内容与团队仓对应目录
  逐文件一致（无本地独有、无本地修改）才删除；否则保留并警告
  （与 `skillSafeToRemove` 同哲学，防误删本地草稿）。`--dry-run` 报告候选不删除
- dry-run 分别报告「Would sync N docs / N wiki」及清理项

### push（scanLocalForPush）

- 本地扫描范围 = 共享根 + 活动项目命名空间。相对路径天然携带前缀
  （`docs/<pid>/x.md`、`.wiki/<pid>/<wiki-id>/x.md`），`pushItem` 落点不变
- 去激活项目的本地目录**不呈现**为 push 差异（不属于"我的"资源；
  与 pull 清理规则一致）

### get

- `get docs <name>` / `get wiki <page>`：解析 = 共享根 + 活动项目命名空间
  逐目录探测；歧义（多个候选）→ 按 001 规则 7 列出候选并 exit 1
  （与 skills 的 namespace 歧义语义完全一致）
  - 显式带 `<pid>/` 前缀的 name：直接按相对路径解析（用户显式点名时不被
    活动集屏蔽，与 Y5 修订的 skills 语义一致）
- `get docs --all` / `get wiki`（整库镜像）：同步共享 + 活动项目命名空间；
  `--prune` 额外清理去激活命名空间的本地目录
- `get wiki --diff`：对比范围同上
- `get list docs/wiki`：列出文件相对路径（天然含命名空间前缀）
- 未 init / 组合校验 / 覆盖保护等既有规则不变

### status / list

- `status`：docs/wiki 计数覆盖命名空间下全部文件（现有递归计数不变）
- 列表类展示沿用既有相对路径输出；无额外命令面

## 代码触点

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/resources/docs.ts` | 修改 | `scanTeamForPull` 按命名空间拆 bundle；`scanLocalForPush` 过滤共享+活动；新增 `cleanupInactiveNamespaces`（或复用 pull 侧通用清理） |
| `src/resources/wiki.ts` | 修改 | 同上；共享 wiki 只取第一层非 project id 目录；bundle 化扫描 |
| `src/pull.ts` | 修改 | docs/wiki 分支改为遍历多 bundle + 命名空间清理挂钩（对齐 skills/learnings 清理） |
| `src/get-cmd.ts` | 修改 | `resolveDocsSource` 命名空间感知解析；镜像模式范围；歧义候选输出 |
| `src/status.ts` | 只读复用（核对计数含命名空间） | — |
| `src/projects.ts` | 只读复用 | `loadProjectsManifest` / `listProjectIds` |
| 测试 | 新增/修改 | `docs-namespace.test.ts`、`wiki-namespace.test.ts`（含清理 dryRun/数据安全用例）；`get-cmd.test.ts` 补命名空间用例；Step-3 接线由 E2E 记录覆盖 |
| 文档 | 同步 | `usage-guide.md`/`.zh-CN.md` 多项目章节、wiki/docs 章节；本目录三件套 |

## 行为规则（在 001/002 行为规则基础上的增量）

1. 共享根永远同步——项目成员必然可见 `docs/` 根与共享 `.wiki/<wiki-id>/`
2. 项目私有内容只对活动项目可见（pull 侧）；显式 `get docs <pid>/...` 例外（Y5 语义）
3. 去激活清理的边界 = manifest 定义的命名空间集；数据安全护栏
   （`dirContentEqual` 逐字节比对 + `hasVcsMetadataRecursive` VCS 元数据检查，
   与 `skillSafeToRemove` 同哲学）保证本地独有/修改内容绝不丢失——
   内容与团队仓完全一致的目录才删除，此时删除不损失任何数据
4. 与 project id 同名的共享目录视为项目命名空间（保留词，文档化警告）
5. 逐文件删除方向仍不支持（沿用 002；防误删），清理仅限命名空间级

## 验收

1. `npm run typecheck`、`npm test`（含新增用例）零回归
2. 双项目夹具 E2E（本地团队仓克隆 + 两个 logical project）：
   - 项目 A 激活：pull 后 `docs/A/`、`.wiki/A/w1/` 存在；项目 B 的目录不存在
   - `projects set B` 后 pull：B 的内容出现，A 的内容清理
   - push：仅共享 + 活动项目差异被扫描（相对路径含前缀）
   - get：`get docs A/x.md`、`get wiki A/w1/p.md` 成功；歧义列出候选
   - status：计数含命名空间文件
3. 无 manifest / 无活动项目 → 行为与现状完全一致（回归对照）