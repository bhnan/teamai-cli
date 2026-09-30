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

### 后续问题 — 2026-09-30：doctor 仍要求已废弃的 docs 镜像

#### 现象

团队仓本地 clone 的 `docs/` 已有 455 篇文档，但项目作用域下的 `.teamai/docs/` 没有镜像时，`teamai doctor` 仍可能使 `Team docs delivered` 检查失败。将用户作用域的 `~/.teamai/docs/`（相同 revision）复制到项目作用域的 `.teamai/docs/` 后，doctor 变为通过；执行 `pull --force` 不能修复缺失镜像。

#### 原因

旧版实现把 `sharing.docs.localDir` 当作下行镜像目标：项目作用域下的 `~/docs` 会重锚定到项目根目录，`DocsHandler.pullDocs()` 从团队仓 clone 的 `docs/` 复制文档，并由 `pruneDocs()` 清理目标中团队包不存在的可见文件。旧版 `doctor` 的 `buildDocsCheck()` 延续了这一契约，逐文件比较本地镜像与团队仓 docs。

007 已将项目 `pull` 的资源边界收窄为 `skills`、`rules`、`env`、`agents`，docs/Wiki 只通过项目 `push` 单向发布到团队仓，消费项目直接从团队仓副本检索。当前 `pull` 不再调用 `DocsHandler.pullDocs()`，`pull --force` 也不会写入或清理项目 docs。`doctor` 的 docs 检查仍保留旧镜像假设，造成“pull 不负责修复、doctor 却要求存在”的契约冲突。复制镜像能使检查变绿，只证明旧检查的文件比较满足，不能证明当前 pull 会继续维护它。

#### 需求与修复方向

- 保持 007 边界：项目 `pull` 对 docs/Wiki 零写入、零覆盖、零清理；不得为使 doctor 通过而重新引入镜像部署。
- 将 `Team docs delivered` 从项目本地交付检查中移除，或改为检查团队仓 docs 副本、来源映射和索引是否可用；不再要求 `.teamai/docs/` 或 `sharing.docs.localDir` 存在。
- `sharing.docs.localDir` 作为旧版本遗留配置保留兼容读取，但不参与当前 pull/doctor 的通过条件；旧镜像允许用户手工清理。
- 增加回归验证：团队仓有 docs、项目本地没有旧镜像时，`pull` 不写入项目 docs，`doctor` 不因旧镜像缺失失败；项目 push 后，团队仓副本和检索来源仍可核验。

当前记录的是需求和问题定位，尚未修改 doctor 实现。

#### 实现记录 — 2026-09-30

选择了修复方向的第二条：doctor 的 docs 检查改为验证团队仓副本本身，而不是移除检查。

- `src/doctor-delivery.ts` `buildDocsCheck()` 重写：
  - 检查名从 `Team docs delivered` 改为 `Team docs readable in the team repo clone`。检查内容变为：`resolveDocsForDirectory()` 解析本机应收到的 docs 集合（与 recall 索引同一过滤器，#707），并逐一验证这些文件在团队仓 clone 的 `docs/` 下可读（`isReadableFile`，防目录占名/悬空链接）。不再读取、比较或要求 `sharing.docs.localDir` 镜像；解析失败时输出 `Team docs can be resolved from the team repo`（说明 recall 无法索引 docs）而不是建议 `pull --force`。
  - 旧镜像不再影响通过条件：新增 `buildLegacyDocsMirrorNote()`，当 `sharing.docs.localDir`（兼容读取，仅此用途）指向一个仍存在的目录时，doctor 在 notes（信息行，非检查）里提示该目录由旧版 pull 写入、不会再被写入或清理、可手工删除。localDir 不是独立目录（与团队仓或 home/项目根重叠，即旧 pull 自己也会拒绝写入的位置）时不给删除建议。`informational` 检查形态被有意排除：它失败仍会翻转 doctor 整体 `ok`，等于让旧镜像参与通过条件。
  - `unresolvableCheck()` 的类型收窄为 `skills | agents`。
- `src/resources/docs.ts`：`containsPath()` 导出，供镜像提示复用旧 pull 的目录独立性规则；`listStaleDocDirectories()` 随旧检查一并删除（已无任何调用方）。`DocsHandler` 的镜像机制（`pullDocs` 等）未动，`uninstall` 仍用它定位并清除旧镜像。
- 测试：
  - `src/__tests__/doctor-delivery.test.ts`：`team docs` 块按新契约重写——clone 可读且无镜像时通过（原始问题场景）；旧镜像存在（含 stale 内容）时检查仍绿；clone 中不可读的文档被点名；无 docs 时无检查；只读激活 namespace 的 docs；解析失败时报原因；`legacy docs mirror note` 三例（提示/无镜像沉默/非独立目录沉默）。
  - `src/__tests__/docs-prune-e2e.test.ts` 删除（断言 007 前的 user-scope 镜像行为，与当前边界矛盾，属预存失败），新增 `src/__tests__/docs-pull-boundary-e2e.test.ts`：真实 CLI + git remote，项目作用域 `pull --force` 后无 `.teamai/docs` 镜像、预置旧镜像原样保留、项目 `docs/` 原文不变、doctor 的 docs 检查通过、notes 提示旧镜像；删除旧镜像后 doctor 依然通过且无提示。
- 文档：`docs/usage-guide.md` / `usage-guide.zh-CN.md` doctor 段落改为新检查名与新行为；`docs/designs/multi-project-management.md` 的 `Team docs delivered` 句子同步并标注镜像为 legacy。
- 验证：`npx tsc --noEmit` 通过；`npm run lint` 3 条预存警告（零新增）；`npx vitest run` 全量除本机预存的 21 个失败（init + wiki-source-anchor）外全绿；`npm run build` 后 `npx vitest run --config vitest.e2e.config.ts docs-pull-boundary-e2e` 通过（真实 CLI 记录见上）。

边界保持不变：项目 `pull` 对 docs/Wiki 零写入、零覆盖、零清理；本变更只动 doctor 的读取面与一条信息提示。

### 后续变更 — 2026-09-30：Wiki 默认根与显式附加根

需求方重新确认 Wiki 的发现和发布边界，覆盖本变更前面“自动处理所有 `^\\..*wiki$` 根目录”的设计：

- 默认只处理项目根目录下的 `.wiki/`。
- `.dev_wiki/`、`.researchwiki/` 等其他目录默认忽略，即使名称符合 `^\\..*wiki$` 也不自动发布。
- 其他 Wiki 只能通过显式参数或配置指定；未指定时不得扫描、上传、清理或生成 pending-delete。
- 显式指定后，为每个 Wiki 分配稳定的发布名称，统一放在团队仓的 `.wiki/` 下。例如 `project_wikiA` 和 `project_wikiB` 的目标分别为：

  ```text
  .wiki/project_wikiA/...
  .wiki/project_wikiB/...
  ```

- 显式名称是团队仓中的 Wiki 身份，不能只用源目录 basename 推断；同名目标必须在写入前报告冲突并停止相关发布。
- 既有默认 `.wiki` 的发布路径和引用保持兼容；增加显式 Wiki 时不能覆盖既有 `.wiki` 内容，也不能改变 docs/Wiki 的项目级 push、pull 零写入边界。
- `dry-run` 必须列出默认发现的 `.wiki`、显式指定的附加 Wiki、目标路径以及被忽略的目录；未显式指定的附加目录不参与删除判断。

此前实现记录中的“所有匹配根目录自动发布”、`--exclude-wiki-root` 作为首期主要选择机制，以及将附加根发布到各自顶层（如 `.dev_wiki/<projectId>/`）的方案均由本决定覆盖。具体 CLI 参数或配置字段名称待实现设计确定，但必须支持显式源目录到目标 Wiki 名称的映射。

当前只更新需求边界，尚未修改代码或验证命令；实现后需补充多根发现、显式映射、目标冲突、旧 `.wiki` 兼容及未指定目录不产生副作用的测试记录。

### 后续变更 — 2026-09-30：docs 支持显式源路径发布

需求方补充确认：docs 也需要支持通过显式路径上传到团队仓，不应被固定的项目根 `docs/` 目录限制。

- 默认行为保持项目 docs 的既有约定：项目级 `push --types docs` 发布项目声明的默认 docs 来源，目标仍位于团队仓对应项目命名空间 `docs/<projectId>/`。
- 增加显式 docs 源路径能力（具体 CLI 参数或配置字段名称待实现设计确定），允许一次指定一个或多个项目内路径；路径必须经过项目根约束校验，不能读取项目外的任意目录。
- 显式路径发布到团队仓 `docs/<projectId>/` 下的稳定相对路径，保留源路径的相对层级，避免不同 docs 源中的同名文件互相覆盖。源路径到目标路径的映射必须出现在 dry-run 和发布结果中。
- 同一目标文件发生多个源映射、远端基线冲突或源路径越界时，发布前报告并阻止受影响文件；不能静默覆盖。
- 未显式指定的 docs 目录不参与本次扫描、上传、删除判断或 pending-delete；显式路径缺失也不能解释为删除整个默认 docs 包。
- 该能力仍是 docs 的单向项目 `push`；项目 `pull` 不因支持显式 docs 路径而恢复 docs 镜像或向业务项目写入 docs。消费项目从团队仓副本检索和引用。

实现时需要补充路径规范化、目录/文件选择、目标映射、冲突保护、dry-run 和跨平台路径测试，并与 Wiki 的显式根目录映射保持一致的“来源—目标—基线”记录格式。

#### 实现记录 — 2026-09-30（Wiki 默认根与显式附加根 + docs 显式源路径）

需求方确认命名方案：名称内嵌项目 ID——Wiki 显式源发布到 `.wiki/<projectId>_<wikiName>/`，docs 显式源发布到 `docs/<projectId>_<docsName>/`（后者覆盖上一节"发布到 `docs/<projectId>/` 下稳定相对路径"的旧表述）。接口采用可重复的 CLI 选项 `--wiki-source <dir>=<name>`、`--docs-source <dir>=<name>`；暂未加 manifest 配置字段。

- `src/utils/wiki-roots.ts`：`matchWikiPublishPrefix` 识别三种键——默认 `.wiki/<pid>/`、命名 `.wiki/<pid>_<name>/`（携带 `name`）、旧版 beta 的 `<rootName>/<pid>/`（标记 `legacy`）。`wikiPublishTarget(repoRoot, pid, name?)` 统一目标推导。`discoverWikiRoots` 保留但只用于报告被忽略的同级目录；`parseWikiPagePath` 同时接受新旧布局（recall 校验用途）。
- `src/resources/wiki.ts`：扫描改为"默认 `.wiki`（存在才发布，目标不变）+ 显式 `wikiSources`"。每次扫描输出一行 `[wiki] default root: .wiki → .wiki/<pid>/; source <dir> → .wiki/<pid>_<name>/; ignored (not specified): <dirs>`，dry-run 由此列全三类信息。条目 `relativePath` 携带命名命名空间，冲突闸门（unmanaged/baseline 对比）按既有机制自动覆盖新目标。
- `src/resources/docs.ts`：`publishTargetDir(localConfig, pid, name?)`；`scanLocalForPush` 改为多源扫描——默认 `docs/`（整树，含与显式源重叠的部分）+ 每个 `docsSources` 条目到 `docs/<pid>_<name>/`；默认 `docs/` 缺失时显式源仍可发布。新增 `matchDocsPublishPrefix`（默认/命名两种前缀）。
- `src/resources/base.ts`：`ScanForPushOptions.excludeRoots` 移除，新增 `NamedPublishSource` 与 `wikiSources`/`docsSources`。
- `src/push.ts`：
  - `parseNamedSources`（纯解析）：`<dir>=<name>` 语法、名称字符集（字母数字开头，`[A-Za-z0-9._-]`）、重复名称/目录、重新指定默认源（`.wiki`/`docs`）一律拒绝。`push()` 在写任何文件前完成解析 + `--types` 配对 + 文件系统校验（目录必须解析进项目根且存在，`isDirectory`）；`pushCore`（self 模式重入）只重跑纯解析。
  - pending-delete 重写：基线键经 `matchWikiPublishPrefix`/`matchDocsPublishPrefix` 解析后——legacy 布局整体跳过并报告一次；命名源本次未指定 → 整体跳过并报告"Kept everything published as <name>"；源目录缺失（改名/移走）→ 整体跳过并报告（对默认 `.wiki`/`docs` 同样生效，比旧实现多了 docs 侧的改名保护）；仅"源在且被指定、单个原文消失"才进入显式删除确认流程。
  - `--exclude-wiki-root` 及其校验/传递全部移除（被本决定明确覆盖）。
- `src/index.ts`：注册 `--wiki-source`/`--docs-source`（collect 可重复）；`skill-data/core/references/commands.md` 经 `commands-reference -u` 再生成。
- `src/utils/wiki-source-anchor.ts`：`resolveWikiPageSources` 的允许范围按映射目标推导——`docs/<pid>/` 或 `docs/<pid>_<name>/` 命名空间均视为本项目的可引用范围（realpath 逃逸检查不变），使 wiki 页面可以引用显式 docs 源发布的文件。
- 测试：`wiki-roots.test.ts`（新前缀判定表：默认/命名/`demo2` 非误判/legacy/跨项目拒绝 + `wikiPublishTarget`）；`get-cmd.test.ts`（WikiHandler：默认忽略未命名根、命名源发布到 `.wiki/proj_dev/`、同名隔离）；`publish-handlers.test.ts`（DocsHandler：命名源与默认包并存、无默认 `docs/` 时仍可发布命名源）。
- e2e（`scripts/e2e-007.sh`，扩至 77/77 通过，真实 CLI）：默认 `.wiki` 单根发布且 `.dev_wiki` 不带选项不发布；`--wiki-source .dev_wiki=dev` 发布到 `.wiki/demo_dev/` 且与默认根同名页隔离；dry-run 列出默认根/忽略同级；未指定命名源时本地改动与目录缺失都不触发删除（"Kept everything published as dev"）；`--docs-source docs/api=api` 发布 `docs/demo_api/` 且默认包照常覆盖 `docs/api/`；六项 flag 校验（缺 `=`、名称含 `/`、越界路径、目录不存在、`--types` 不含对应类型、重指定默认源）全部以非零退出拒绝。
- 门槛：`npx tsc --noEmit` 通过；`npm run lint` 3 条预存警告（零新增）；`npx vitest run` 全量除本机预存的 21 个失败（init + wiki-source-anchor，失败项与基线逐一一致）外全绿；双语 usage-guide（push 单向发布段、`--wiki-page` 段）同步。

边界保持不变：项目 `pull` 仍只处理 skills/rules/env/agents；docs/Wiki 仍单向发布；`dry-run` 零写入；旧 `.wiki/<pid>/` 目标与既有引用兼容，beta 版已发布到 `<rootName>/<pid>/` 的存量副本不迁移、不清理，仅报告。
