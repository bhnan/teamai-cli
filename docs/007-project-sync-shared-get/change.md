# 007 项目同步与共享获取：变更记录

## 2026-09-30：多 Wiki 根目录自动发现与项目发布

Status: intent_confirmed_design_pending
日期：2026-09-30

本文记录已确认的需求和边界，不代表功能已经实现。用户已确认自动匹配多个 Wiki 根目录的方向；目标存储布局、兼容策略和配置接口在设计阶段确定。

### 背景与问题

一个项目可以同时维护 `.wiki/`、`.dev_wiki/` 等多个 Wiki，分别承担业务知识、开发知识等用途。用户希望沿用这些本地目录，通过项目级 `push` 一次发现并发布，供其他项目从团队仓检索和引用。

此前核对的 v0.26.0-beta.5-bhn.0.4 实现只扫描项目根目录下的 `.wiki/`，发布至团队仓 `.wiki/<projectId>/`。同级 `.dev_wiki/` 不会被扫描。仅扩展扫描目录还不足以完成需求：多套 Wiki 可能都有 `index.md`，来源文档路径也可能相同，必须同时保留 Wiki 身份、隔离发布目标并正确解析 docs 引用。

### 已确认的需求

#### 1. 自动发现

- 只检查当前项目根目录的直接子目录，对目录名应用正则 `^\..*wiki$`，区分大小写。
- 正则表达的是“以点开头，以小写 wiki 结尾，中间可以为空”。用户描述中的 `.***wiki` 不是实际正则语法。
- 命中的每个目录作为独立 Wiki 根目录，递归处理其中可发布的内容并保留内部相对路径。
- 根目录发现不递归进入子项目、依赖目录等位置；名称匹配的普通文件不视为 Wiki。
- 不要求重命名或移动业务项目原有 Wiki，不修改 `project-wiki` skill。

| 项目根目录条目 | 是否作为 Wiki 根目录 |
| --- | --- |
| `.wiki/` | 是 |
| `.dev_wiki/` | 是 |
| `.researchwiki/` | 是 |
| `.wiki_backup/` | 否 |
| `wiki/` | 否 |
| `.dev_Wiki/` | 否 |
| `child/.wiki/` | 否，不是项目根目录的直接子目录 |
| `.testwiki` 普通文件 | 否 |

#### 2. 发布和隔离

- 复用项目级 `push` 的 Wiki 类型入口，例如 `teamai push --project A --types wiki`。
- 默认发布该项目下所有符合规则且未被排除的 Wiki 根目录。
- 资源身份至少包含“项目 ID + Wiki 根目录名 + 根内相对文件路径”，不能仅按文件名区分。
- 不同 Wiki 的同名页面不能覆盖；目标碰撞必须在写入前报告并阻止相关发布。
- 支持明确排除某个 Wiki 根目录，满足实验 Wiki 暂不发布的需要；具体配置字段或选项待设计，不将示例当成现有接口。
- Agent 选择不改变 Wiki 来源及目标位置。

#### 3. 引用和检索

- TeamAI 维护从项目内源文件路径到团队仓实际发布路径的映射，检索时保留来源项目、Wiki 根目录及文件路径。
- Wiki 页面自身的相对链接、Wiki 到 docs 的引用、来源元数据都需要按其原有基准解析，再定位到发布后的目标。
- 不得通过单纯替换目录字符串推断所有引用；映射存在歧义时报告具体来源和候选位置。
- docs 未发布、目标缺失或无法解析时明确报告，不伪造可访问的链接，不声称引用已经修复。
- 不依赖作者电脑的绝对路径；使用团队仓副本的其他项目应能访问对应已发布 docs。
- 集合子目录与 Wiki 根目录是不同层级：一个根目录内部可以继续拥有多个集合，不能因增加根目录发现而丢失原集合标识。

#### 4. 预览与删除保护

- 预览列出解析出的项目、匹配及排除的根目录、来源到目标映射、文件增删改和冲突。
- `dry-run` 不写资源、状态、索引或发布记录。
- 某个根目录缺失、被排除或改名，不自动解释为删除其全部已发布内容。
- 源文件删除按明确的删除确认流程处理；不得影响其他 Wiki 根目录或其他项目的内容。

#### 5. 兼容与既有边界

- 已有 `.wiki/` 发布目标和引用可能依赖 `.wiki/<projectId>/`；不得无提示改变这些路径。
- 若引入统一的 Wiki 根目录层级，必须明确旧文件、来源映射、发布基线和索引的迁移方式及回退方案。
- 项目 `pull` 仍只处理 skills、rules、env、agents，不部署或清理 docs/Wiki。
- docs/Wiki 仍只通过项目 `push` 单向发布，供其他项目参考；共享 `get` 边界不变。

### 设计阶段待确定

1. 团队仓布局：保留旧 `.wiki` 布局并为新增根目录安排隔离目标，或统一增加根目录层级并执行显式迁移。两者都必须验证碰撞和引用兼容，本文未选择最终方案。
2. 排除规则的配置位置与语法；是否需要本期提供单个 Wiki 选择能力。后者并非当前已确认的必需功能。
3. 根目录内部隐藏条目和符号链接的处理规则；不能仅因支持隐藏根目录而放宽所有内容扫描。
4. 与已有 Wiki 集合配置、引用解析及发布状态的衔接；实现前审查这些状态的所有读写入口。

### 验收场景

- 项目 A 同时包含 `.wiki/index.md`、`.dev_wiki/index.md`：一次 Wiki push 发现两者，目标互不覆盖。
- `.wiki_backup/`、普通文件和嵌套子项目 `.wiki/` 不被当作新的 Wiki 根目录。
- 排除 `.dev_wiki/` 后，本次不发布它，也不清除它此前发布的内容。
- 两套 Wiki 分别引用同一个或不同的 docs：在另一项目中指定发布后的 Wiki 路径，可定位到正确的已发布 docs。
- 旧 `.wiki` 引用按最终兼容方案仍可访问；若需要迁移，预览能展示迁移影响并要求明确执行。
- 一个 Wiki 根目录被删除或改名时，不发生隐式整库删除；其他根目录及项目内容不受影响。
- dry-run 展示上述差异，执行前后文件和发布状态不变。

### 后续交付

本变更归属 007-project-sync-shared-get，按用户要求记录于 change.md，不新建需求目录。后续在本条变更内补充设计决策、实施步骤、验证结果及交付状态，明确目标布局、接口、映射与兼容策略后再推进实现。当前交付仅为变更需求记录，未修改代码、运行测试或发布资源。

### 实现记录 — 2026-09-30（设计决策与交付）

Status: implemented（见下方验证记录；发布另行授权）

设计阶段四个待定项按以下决策落地（即上轮评审给出的倾向，需求方确认实现）：

1. **团队仓布局**：每个 Wiki 根按自身目录名平行展开——`.wiki/<projectId>/` 保持原目标不动（零迁移：旧引用、`recall --wiki-page` 校验、发布基线键全部不受影响），其余根发布到 `<根目录名>/<projectId>/`（如 `.dev_wiki/<projectId>/`）。`state.publishedFiles` 基线键即仓内相对路径，新根的键天然带根前缀，与旧键零冲突，无基线迁移。未采用"统一根目录层级"方案：它要求旧文件、基线、索引整体迁移，收益仅是团队仓顶层更整洁。
2. **排除配置**：首期提供 push 选项 `--exclude-wiki-root <name>`（可重复），校验名字形状（点开头、小写 wiki 结尾）且要求 `--types` 含 wiki；不动 manifest schema。"单个 Wiki 选择"按本变更第 2 节判断为非必需，未实现。
3. **根内隐藏条目与符号链接**：沿用既有防线——内容扫描继续跳过隐藏条目（`hasDotSegment`），不因根目录名以点开头而放宽；目标写入仍走 push 既有分支/PR 流程。
4. **状态衔接**：`publishedFiles` 基线、pending-delete、006 引用校验三处读写入口均按根前缀泛化；`matchWikiSourceCollection` 提取为纯函数（按 `<wikiRoot>/<pid>/<collection>/` 匹配 wiki source config），`recall --wiki-page` 路径校验接受任意 Wiki 根前缀。

删除保护落实：pending-delete 遍历基线时，Wiki 根**缺失**（改名/移走）→ 明确报告 "wiki root <name> is absent from the project … stays untouched" 并跳过其全部基线；根**被排除** → 跳过且不产生任何 pending-delete。只有"根在且未被排除、其中单个源文件消失"才走原有显式删除确认流程，且不影响其他根或项目。

代码触点：`src/utils/wiki-roots.ts`（新增：`isWikiRootName`/`discoverWikiRoots`/`matchWikiPublishPrefix`/`parseWikiPagePath`）、`src/resources/wiki.ts`（多根扫描、`<root>/<pid>/` 目标、根前缀资源名）、`src/resources/base.ts`（`ScanForPushOptions.excludeRoots`）、`src/push.ts`（`--exclude-wiki-root` 校验与传递、pending-delete 泛化与根保护）、`src/recall.ts` 与 `src/utils/wiki-source-anchor.ts`（任意根前缀解析）、`src/index.ts`（选项注册）。

验证：

- 单元：`wiki-roots.test.ts`（判定表含 change.md 全部 8 个边界条目、目录/文件/嵌套区分、前缀解析）、`wiki-source-map.test.ts`（任意根下的集合匹配，纯函数无文件系统依赖）、`get-cmd.test.ts` WikiHandler 多根/同名隔离/排除用例更新。
- 真实 CLI E2E（`scripts/e2e-007.sh`，扩至 63/63 通过）：多根一次发布且同名 `index.md` 互不覆盖；`.wiki_backup/`、`.dev_Wiki/`、嵌套 `child/.wiki/` 不发布；`push --types wiki --dry-run` 列出发现的根且远端分支数不变；`--exclude-wiki-root .dev_wiki` 后 `.wiki` 更新照常发布、`.dev_wiki` 远端副本原样保留；根改名缺席后其已发布内容仍在 main 且日志明确报告 absent 保护。
- 门槛：`npx tsc --noEmit` 通过；`npm run lint` 仍为 3 条预存警告（零新增）；`npx vitest run` 全量除本机预存的 21 个失败（init + wiki-source-anchor 的 macOS tmpdir realpath 环境问题）外全绿；`commands.md` 经 `commands-reference -u` 再生成（新增 `--exclude-wiki-root` 行）；双语 usage-guide 同步。

边界保持不变：pull 仍只处理 skills/rules/env/agents；docs/Wiki 仍仅 push 单向发布；共享 get 边界不变；`project-wiki` skill 未修改。
