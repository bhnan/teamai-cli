# Plan — teamai 原生 `get` 子命令实现

Status: completed（2026-09-18；独立评审 R1+Y1-Y5 修复并复验通过）

## 变更面

- `/root/teamai-cli`（fork 仓库，特性分支 `feat/get-command`）：
  - 新增 `src/get-cmd.ts`、`src/__tests__/get-cmd.test.ts`
  - 修改 `src/index.ts`（注册命令，一处懒加载块）
  - 如需复用 pull.ts 内部函数：仅增加 export，不改既有签名
- `/root/DeepTutor`（消费侧）：
  - 删除 `scripts/teamai-get` 与 `/usr/local/bin/teamai-get`（001 遗留）
  - 更新 `.claude`/`.dsh` 两份 `teamai-ops/SKILL.md`：单资源拉取改为引用原生 `teamai get`
- 不改动：upstream Tencent 仓库、teamai 的官方配置、pull/push/status 既有行为

## 实现步骤

1. `cd /root/teamai-cli && git checkout -b feat/get-command`
2. 精读复用点：`src/index.ts` 注册模式、`src/pull.ts` 的 `pull()` 主体（L1524 起）、`src/resources/` Handler、`scopedToolPaths`
3. 实现 `src/get-cmd.ts`（按 spec.md：四种 type + list + 选项 + 组合校验 + `check_name` 路径守卫）
4. 注册 `src/index.ts`
5. vitest 单测（临时夹具：skills 平铺/ns、rules 深层、docs 子路径、.wiki）
6. `npm run typecheck` + `npm test` 全量回归
7. `npm run build`；`npm install -g /root/teamai-cli`（或 `npm link`）
8. E2E：/root/DeepTutor 真实仓（先按既定批准 `teamai push` teamai-ops，使仓内至少有 1 个 skill；docs/wiki 夹具以直接 commit 方式进入克隆并 push 验证闭环）
9. E2E 多端模拟：`/tmp/device2` 建第二项目并 init 同一团队仓 → 验证 hook/pull 后 docs 与 wiki 在第二端出现（模拟另一台设备）
10. 001 遗留清理（脚本两处删除）+ 两份 SKILL.md 更新 + diff 校验一致
11. 回归记录 + 独立只读评审（同 001 流程）→ 复验 → Status: completed

## 测试策略

- 单测（vitest，夹具临时目录）：源解析四类、后缀容错、namespace 歧义、目标 scope 解析、覆盖保护、组合校验、路径守卫（`..`/绝对路径）
- E2E（真实仓）：list → get skills → get rules（验证 cursor 渲染）→ get docs（单条 + --all + --prune）→ get wiki（单页 + 整库 + --diff）
- 每条记录实际命令、退出码、输出

## 风险与回滚

- 风险：大仓构建耗时；既有测试基线未知（先跑一次全量记录基线）；fork 与 upstream 漂移
- 回滚：`git checkout main && npm install -g teamai-cli`（官方 npm 包）即恢复原状；DeepTutor 侧删除物均可从 git/本文档重建

## 完成定义

- [x] 单测与全量测试通过、typecheck/build 通过（留痕）
- [x] E2E 全过（留痕）
- [x] 独立只读评审通过、发现项已关闭（FAIL → R1+Y1-Y5 修复 → 复验通过，见评审记录）
- [x] 001 遗留清理完成（脚本移除、skill 更新；安装方式改用 npm link）
- [x] Status 置 completed（2026-09-17）；fork 分支 feat/get-command 已推送（12595a9）

## 验证记录（实际执行，2026-09-17/18）

**构建**：`npm run typecheck` ✅ 一次通过｜`npm test` 全量首跑 3370/3371 → 修复 docs.test.ts 断言（默认 localDir 变更为本次设计意图）后 **3371/3371** ✅｜`npm run build` ✅｜安装改用 **npm link**（`npm install -g .` 同名同版本被 npm 去重跳过）。

**单测**：`src/__tests__/get-cmd.test.ts` **15/15** ✅（修复：深度 rules basename 探测误用完整 stem 比较）。

**E2E（/root/DeepTutor 真实仓）**：

| # | 用例 | 结果 |
|---|------|------|
| E1 | `teamai push --all`：skill + 7 docs 上传 | ✅ PR [#1](https://github.com/bhnan/TeamAi--Resource/pull/1)（skill）+ [#2](https://github.com/bhnan/TeamAi--Resource/pull/2)（docs，已合并）|
| E2 | `teamai get list` | ✅ 四类分节列出（ns 前缀/子路径正确） |
| E3 | `teamai get skills teamai-ops --force` | ✅ |
| E4 | `teamai get rules ts-style`（全工具） | ✅ `.claude/rules/ts-style.md` 落盘 |
| E5 | `teamai get rules ts-style cursor` | ✅ `.cursor/rules/ts-style.mdc` 正确渲染（globs/alwaysApply 自 paths 派生） |
| E6 | `teamai get docs` 单条（后缀省略+子路径）/ `--all` / `--prune` | ✅ 落 `<root>/docs`；镜像后 stale-extra 清除 |
| E7 | `teamai get wiki` 单页（.md 省略）/ 整库 / `--diff` / `--prune` | ✅ 全过 |
| E8 | **多端模拟** `/tmp/device2` init + pull | ✅ `Synced 1 skills + 1 rule(s) + 7 docs + 1 wiki`；docs 落 `<root>/docs`、wiki 落 `<root>/.wiki`（项目绑定实证） |
| E9 | `teamai pull` 自动同步 | ✅ `Synced 1 wiki` 随常规 pull 到达 |

**E2E 过程中发现并修复的缺陷（fork 内，均已复验）**：

1. `pushableTypes` 硬编码 → docs/wiki 不被 push 扫描（push.ts）
2. docs/wiki `relativePath` 缺仓库根前缀 → push 暂存 pathspec 失败
3. WikiHandler bootstrap 死锁：repo 无 `.wiki/` 时扫描返回空 → 首推不可能
4. `.wiki` 源根目录以点开头被 `fse.copy` filter 整体过滤 → 镜像零文件
5. `resolveRuleSource` 深度 basename 探测误用完整 stem 比较
6. `--force` 选项漏注册；`pull` 默认 resourceTypes 清单缺 wiki；remove REMOVABLE_TYPES 补 wiki

**遗留**：dev 依赖需 `NODE_ENV=development npm ci --include=dev`（本环境 NODE_ENV=production 会跳过 tsc/vitest/tsup）；多端模拟为同机双目录，真双机待实地验证。

## 发布链路（2026-09-18）

- **安装包**：`npm pack` → `bhnan-teamai-cli-0.22.0.tgz`（fork 改名 `@bhnan/teamai-cli`，repository 指向 fork）
- **Release**：https://github.com/bhnan/teamai-cli/releases/tag/v0.22.0-bhnan.1（经 Releases API 创建，仅需 repo 权限）
- **安装验证**：Release 下载 tgz → `npm install`（69 依赖）→ `teamai --version` 0.22.0 + `teamai get --help` ✅
- **多端安装**：浏览器下载 Release tgz（或 `gh release download v0.22.0-bhnan.1 --repo bhnan/teamai-cli`）→ `npm install -g <tgz>`
- **注意**：版本号避开上游命名（上游已用 v0.22.0/v1.x），fork 版本线为 `v0.22.0-bhnan.N`
- **GitHub Actions**（`.github/workflows/build.yml`，commit 17ec487，已在本地 main）：tag push 自动构建 + Release；**激活受阻**——gh token 缺 `workflow` scope 且网络间歇中断（两次 auth refresh 均 EOF/timeout）。激活选项：(a) 网络恢复后重试 `gh auth refresh -s workflow` 再推 main；(b) 网页 UI 手动创建 `.github/workflows/build.yml`（内容即仓库中该文件）

## 独立评审记录（2026-09-18）

评审方式：全新只读上下文通读 `git diff 6ed2515..HEAD` 全部 11 文件 + Handler 契约追踪 + 独立复跑 typecheck/vitest（17/17）。

**首轮结论：FAIL。** 发现与处置：

| 级别 | 发现 | 处置 |
|---|---|---|
| 🔴 R1 | skills/rules 单条模式无覆盖保护（4 条写入路径均不读 --force），可静默销毁本地已改副本；`isValidName` 不拒 `.` 段退化输入 | ✅ 两分支写入前按 scopedToolPaths+isToolInstalled 计算目标做 exists 守卫；isValidName 拒绝 `.`/空段；rules 附带官方同款 legacy `.md` 清理 |
| 🟡 Y1 | `RESOURCE_TYPES` 常量漏 wiki → `teamai status` 无 wiki 计数、`teamai list wiki` 报 Unknown type | ✅ types.ts 补 `'wiki'`；status.ts 增加 wiki 计数；list 命令描述更新 |
| 🟡 Y2 | docs push 扫描用 utf-8 字符串比较，二进制附件可能误判相同 | ✅ 改用官方 `fileContentEqual`（sha256） |
| 🟡 Y3 | `--all/--diff` 与 name、docs/wiki 与 tool 的非法组合被静默忽略 | ✅ 组合校验补齐（3 条新规则，非法即 usage exit 1） |
| 🟡 Y4 | `remove wiki` 走到确认后空转，与 docs 处理不一致 | ✅ REMOVABLE_TYPES 回退移除 wiki（v1 无删除方向，两类型对齐） |
| 🟡 Y5 | spec 声称 skills 解析「尊重角色过滤」但实现为全 namespace 探测 | ✅ 修订 spec 该行：显式点名优先于角色过滤（更有理，注明评审 Y5 修订） |

🟢 备注 9 条（detectContext 与 autoDetectInit 重复、prune 不删空目录、glob 字符 name 等）记录在案，不阻塞。

**修复后复验**（真实仓 /root/DeepTutor）：`get rules ts-style` 无 --force → `✗ Already exists: …(+1 more)` exit 1 ✓；`--force` 覆盖 exit 0 ✓；`get rules .` → `✗ Invalid path: .` exit 1 ✓；`get docs --all extra` / `get wiki --diff page` / `get docs x claude` → usage exit 1 ✓；`teamai list wiki` exit 0 ✓；`teamai status` 出现 `wiki: 2` ✓；typecheck ✅、单测 18/18 ✅。

**最终状态**：评审最小修复集（R1+Y1）及全部🟡项关闭 → **VERDICT 达 PASS 条件**。fork 分支 `feat/get-command`：首推 12595a9，评审修复 commit 待网络恢复后补推（本地已提交）。
