# Plan — 团队仓 Wiki 的检索与原文引用（006）

Status: in_progress（P2 实现与验证完成，提交 `6b12c7a`/`1cdd9b7`/`1fc8063`；
待需求方验收与独立评审，验收通过后置 completed）

基线：`v0.26.0-beta.5`（上游最新 tag，需求方指定）
工作区：已从 worktree 收敛回主工作目录 `/root/teamai-cli`（分支
`feat/get-command`，合并提交 `e06c2cf`）；`feat/wiki-source-path-mapping`
分支保留，后续在其上实现 006。

## P0 基线对齐（需求方前置要求）

- [x] `git fetch upstream --tags`：确认上游最新为 `v0.26.0-beta.5`
      （2026-09-28，`upstream/main` = `5fb316c`）
- [x] 从该 tag 建 worktree 与特性分支（未直接改主工作目录）
- [x] 复核基线现状：`sharing` 无 wiki 段；`src/recall.ts` 的 `.wiki/` 仅输出
      `File:`/`Sources:` 纯文本；`.wiki/` 不在召回索引内
- [x] **已确认**：新基线**不带** fork 线的 003/004 语义与 `get` 命令
      （需求方决策，spec §9）——本需求在裸 `v0.26.0-beta.5` 上独立落地，
      自持「`docs/<pid>/` 团队仓命名空间」这一只读约定
- [x] 装依赖并确认工具链：`npm ci` + `npx tsc --noEmit`
- [x] **基线对照（v0.26.0-beta.5 裸 tag）**：
      - typecheck：26 个错误，全部在 `src/__tests__/namespace-resolver.test.ts`
        （基线固有，非本需求引入）
      - 全量单测：**7 failed / 5226 passed / 7 skipped（336 文件，6 个文件失败）**
        ——`contribute-self-learnings`(2)、`github-provider`(1)、
        `import-mr-learnings-checkout`(2)、`namespace-resolver`(文件级)、
        `post-pull`(1)、`skill-content`(1)
      - `npm run lint` 在本机不可用：`oxlint` 未安装（`sh: 1: oxlint: not found`）

## P0.5 仓库收敛（需求方追加要求，2026-09-28）

- [x] 干跑评估合并冲突（`git merge-tree`）：`feat/get-command` ×
      `feat/wiki-source-path-mapping` 冲突 4 个文件
- [x] 冲突解决原则（需求方决策）：**以上游为准，丢掉 fork 的 docs/wiki 语义**
- [x] 实际解决：
      - `src/pull.ts`、`src/resources/docs.ts` → 取上游（上游以
        `pullDocs`/`resolveDesiredDocs` 重写了投递逻辑，fork 的逐文件
        `pullItem` 已被替换）
      - `docs/usage-guide.md`、`docs/usage-guide.zh-CN.md` → 取上游措辞
      - `src/push.ts` → `pushableTypes` 收敛为上游的
        `['skills','rules','env','agents']`（自动合并残留了 fork 的 docs/wiki）
      - `src/types.ts` → `sharing.docs.localDir` 默认值回到上游 `~/.teamai/docs`
        （自动合并残留 fork 的 `~/docs`，导致上游 2 个投递用例失败）
      - `src/get-cmd.ts` → 跟随上游改名 `resolveDocsLocalDir` →
        `resolveDocsDestination`
      - `src/__tests__/docs.test.ts` → 断言改为上游投递目标
      - `skill-data/core/references/commands.md` → 用
        `npx vitest run --update` 重新生成（fork 的 `get` 命令进入命令表）
- [x] 合并结果验证：typecheck 26 个基线错误（零新增）；
      全量单测 **6 failed / 5243 passed**（零新增回归，且比基线少 1 个）
- [x] 合并提交：`e06c2cf`（双父 merge commit，父为 `9995df2` 与 `70821ca`）
- [x] 主工作目录 `git reset --hard e06c2cf` 收敛；`npm run build` 重建 dist
- [x] 移除全部 worktree：`.worktrees/feat-wiki-source-map`、
      `.worktrees/tmp-merge-test`、`/root/teamai-baseline`、
      `/root/teamai-cli-merge2`、`/root/teamai-cli-wt-003`、
      `/root/teamai-upstream-baseline` —— 现在只剩 `/root/teamai-cli`
- [x] 005 草案：本地任何分支均无此文件（仅存于旧 tag `v0.23.0-bhnan.0`），
      需求方确认无需删除

## P1 需求文档（本阶段产出）

- [x] `docs/006-wiki-source-citation-mapping/intent.md`
- [x] `docs/006-wiki-source-citation-mapping/spec.md`
- [x] `docs/006-wiki-source-citation-mapping/plan.md`（本文件）
- [x] 需求方确认 intent/spec 的开放问题 → 结论回写 spec §9
- [x] 需求方两次指示继续实现（2026-09-28 后半与下一轮），P2 已开工

## P2 实现（进行中）

### P2-1 配置模型 ✅

- [x] `src/types.ts`：`SharingConfigSchema` 新增可选 `wiki`
      （`sources: [{ id, map?: [{ from, to }] }]`），沿用「可选而非 default」
      惯例；`allow` 按奥卡姆不实现（spec §9.3）
- [x] 提供 defaulted 读取视图 `getWikiSharing()`，供 recall 消费
- [x] 类型导出：`WikiPathMap` / `WikiSourceConfig` / `WikiSharingConfig`

### P2-2 锚点解析与校验 ✅（`src/utils/wiki-source-anchor.ts`）

- [x] `mapAnchorPath(...)` → 克隆内相对路径（显式 `map` 优先 → 默认
      「项目根相对 → `docs/<pid>/`」→ 无命中 `unmapped`）
- [x] `verifyWikiSource(...)` → 四条判定 + 封闭状态枚举（`verified`/
      `missing`/`out_of_scope`/`content_changed`/`unmapped`/`unverifiable`）
- [x] 允许范围按 `realpath` 判定，拒绝符号链接逃逸
- [x] 单测 11 例全绿：`src/__tests__/wiki-source-anchor.test.ts`
- [x] **解耦确认**：CLI 只消费 frontmatter `sources[]` 契约（`{path, sha256}`），
      不依赖生成页面的工具；默认映射 `docs/…` → `docs/<pid>/…` 只是约定，
      其他形态靠配置 `map` 覆盖

### P2-3 接入输出 ✅

- [x] `src/recall.ts`：新增 `--wiki-page <repo相对路径>` 模式（解析单页锚点，
      隐含 `--json`）+ 普通 `recall --json`（结果 JSON 化）
- [x] `src/index.ts`：为现有 `recall` 命令加 `--json` / `--wiki-page` 选项
      （不新增子命令）
- [x] 未配置 `sharing.wiki` 时完全不激活（`--wiki-page` 不依赖配置即可用）
- [x] 页面路径校验（必须 `.wiki/` 前缀、无 `..`）；页面不存在/未初始化 → 报错
      退出码 1

### P2-4 测试 ✅

- [x] 单测：映射 × 四条判定 × 全部状态枚举 + 边界表（缺/非法 sha256、符号
      链接逃逸、URL/目录锚点、`../` 形态、绝对路径）
- [x] 单测：未配置 wiki 时既有 recall 测试零回归（recall 5 个测试文件 43 例）
- [x] E2E（真实 CLI，真实团队仓 + 沙箱夹具）：verified / content_changed /
      missing 三态真实输出全部验证通过（见下方「E2E 记录」）
- [x] 全量回归：6 failed / 5254 passed —— 与合并基线一致，**零新增回归**

### P2-5 文档与 skill 同步（进行中）

- [x] `skill-data/core/references/commands.md`：`npx vitest run
      commands-reference -u` 重新生成（`--json`/`--wiki-page` 入表）
- [ ] `docs/usage-guide.md` + `docs/usage-guide.zh-CN.md`：新增「Wiki 引用
      校验」章节（待需求方确认入口形态后落笔）
- [ ] 受影响的 `skill-data/`（若 Agent 使用方式变化）；grep 旧措辞

## E2E 记录（2026-09-28，真实 CLI，`dist/index.js`）

| 场景 | 命令 | 结果 |
|---|---|---|
| 真实团队仓 verified | `recall --wiki-page ".wiki/teamai-cli/docs-wiki/topics/usage-guide.md"` | 两条锚点 `verified`，`resolved` 指向 `docs/teamai-cli/…`，sha256 与 frontmatter 记录一致 |
| 内容篡改 | 同上（目标文件追加一行） | `content_changed`，reason 带 expected/actual |
| 文件删除 | 同上（删目标文件） | `missing`，reason 带路径 |
| 全量回归 | `npx vitest run` | 6 failed（基线固有）/ 5254 passed，零新增 |

## 测试策略

- **单测**：四条判定与状态枚举全覆盖（纯函数易穷举），含失败分支与边界表。
- **E2E**：真实夹具团队仓（`.wiki/<pid>/docs-wiki/` + `docs/<pid>/`），
  用 build 产物跑真实 CLI，验证可引用路径可被打开且哈希一致；改一位后
  状态翻转。
- **零回归**：全量单测与基线对照；未配置时输出快照比对。

## 风险与回滚

| 风险 | 应对 |
|---|---|
| 团队仓 `.wiki/` 布局不规范（目录名含点、多 pid 同名） | 按 003 既有的集合 id 安全段校验拒绝非法目录；同名给出候选要求消歧 |
| 锚点把引用指向仓库任意文件（读越界） | 允许范围硬边界 + 真实路径判定（spec §2.3/§6） |
| 克隆落后远端导致大面积 `content_changed` | 如实报状态并提示 `teamai pull`；不静默引用（这正是本需求要防的引用错误） |
| 配置字段过度设计（`allow`） | 如无真实放宽需求则删除，只留 `id` + `map` |
| 校验在大仓库上的耗时 | 只对输出中出现的锚点做校验（≤ 输出条数 × 锚点数），不做全仓扫描 |
| 基线切换带来的差异 | 特性分支独立，未触碰 `main`；可整体回退 |

## 未决（阻塞 Build 的开放问题）

2026-09-28 已全部由需求方确认，结论落在 spec §9：

1. ~~检索入口形态~~ → CLI **不输出** Wiki 位置，位置由 Agent 按目录规范定位
2. ~~新基线是否带上 fork 的 003/004 语义与 `get` 命令~~ → **不带**
3. ~~是否需要 `--json`~~ → **需要**

仅剩一处实现时按奥卡姆收敛的取舍：`sources[].allow` 是否保留（倾向删除，
见 spec §9.3）。
