# Intent — 团队仓 Wiki 的检索与原文引用（006）

Status: draft（待需求方确认问题、范围与成功标准）

基线：`v0.26.0-beta.5`（需求方指定：以上游最新版本为基线落地）

## 问题

项目 `.wiki/` 由 project-wiki skill 生成，页面 frontmatter（JSON）里的
`sources[]` 记录了原文的**项目根相对路径**与**内容 SHA-256**，例如：

```
sources: [{"path":"docs/usage-guide.md","sha256":"9437297…"},
          {"path":"docs/usage-guide.zh-CN.md","sha256":"a915b6d…"}]
```

项目内容发布到团队仓命名空间后（`docs/<pid>/…`、`.wiki/<pid>/<name>wiki/`），
检索到的 Wiki 页面里这两样东西都失配：

1. **引用路径失配**：`sources[].path` 与正文相对链接（`../../docs/x.md`）
   按「项目根相对」书写，在团队仓克隆内解析不到任何文件。
2. **引用内容失配**：原文内容可能已变化，而 `sha256` 仍指向旧版本——即使
   路径被猜对，引用到的也可能不是 Wiki 页面所依据的那一版原文。

现状（2026-09-28 在本机实测，`v0.26.0-beta.5` 源码复核）：

- 团队仓克隆 `.wiki/<pid>/<wiki-id>/` 下的页面确实被检索到；页面里的
  `sources[].path`、`sha256` 都是齐全的。
- 但 `teamai recall` 对 `.wiki/` 只输出 `File:` 与 `Sources:` 两行纯文本
  （`src/recall.ts` 的 `formatResults`），`sources[].path` 没有机器可读通道，
  也不做任何解析、映射或校验。
- `sharing` 配置里没有 wiki 段（`src/types.ts` 的 `SharingConfigSchema`：
  skills/rules/docs/env/hooks/recall/contributeHint/coAuthor/mcp），recall
  里也没有任何 wiki source 映射或 sha256 校验（`git grep sha256` 在 `src/`
  仅命中测试与 webhook）。
- 因此该能力在最新上游同样**不存在**，不是在 fork 上重新发明已合并的东西。

**影响**：Agent 按 Wiki 页面检索后无法把引用落到真实原文——要么读不到，
要么把 Wiki 摘要当成原文引用，要么引用到内容已变的旧版本，且三者对调用方
不可区分。

## 用户与影响面

- **Wiki 消费方（Agent）**：按 Wiki 页面检索、需要引用原文的主路径使用者。
- **团队成员**：用自然语言指定 Wiki 名字发起检索的人。
- **Wiki 作者**：页面 frontmatter 里写了 `sources[]` 的人——引用可信度是其
  产出的直接质量指标。
- 涉及命令：`recall`（消费端）与 team repo 的 `teamai.yaml`（配置端）。
  `dsh` Web GUI 中的 TeamAI 面板属于 TeamWiki Recall 的语义侧，本需求只在
  CLI 侧落地解析与校验。

## 约束

- **不修改 project-wiki skill**：skill 产出的 frontmatter 形态视为输入契约
  （只读解析），不要求 skill 配合改动。
- **不新增 CLI 命令**（奥卡姆剃刀）：复用现有命令面。
- **不使用本机绝对路径**：Wiki 位置按团队仓目录规范推导；配置只写相对规则，
  克隆根在运行时由本地配置解析，不带机器相关性。
- **检索不校验、引用才校验**：Wiki 页面能否被检索到，与其引用的原文是否
  可引用，是两件事；强校验会让页面因为一条未被引用的 source 漂移而整体不可用。
- **不静默降级**：克隆内容不新鲜（未 ff）时，锚点校验会失败——此时如实报
  「不可引用 + 原因」，不得静默给出可能错误的引用。
- CLI 输出英文；双语文档（`usage-guide.*`）同步。

## 成功标准

1. 用户以自然语言指定某个 Wiki 后，Agent 能定位团队仓克隆内该 Wiki 的页面，
   并对命中页面给出**可引用**的原文路径。
2. `sources[].path` 的映射规则可配置（团队仓 `teamai.yaml`），且默认规则
   开箱可用（覆盖 `docs/x.md` 与 `../../docs/x.md` 两种书写形态）。
3. 每条 source 的引用状态可区分且带原因：`可引用` / `目标不存在` /
   `路径歧义` / `超出允许范围` / `内容已变化（sha256 不符）`。
4. 只有**成功读取且 SHA-256 校验通过**的原文才被标记为可引用；其余明确标注
   不可引用，绝不退化为「看起来像路径就当原文」。
5. 不影响现有召回行为：不传 wiki 相关信息时，`recall` 输出与 `v0.26.0-beta.5`
   完全一致（无回归）。
6. 单元测试覆盖映射与四类失败分支；E2E 在真实夹具团队仓上跑通「指定 wiki →
   命中页面 → 引用可打开且哈希一致」全链路。

## 非目标

- 不把项目自身 `.wiki/` 纳入默认召回，不改变 `recall` 的既有默认检索面。
- 不做 Wiki 内容同步/发布（发布仍是团队仓内的纯 Git 操作，见 004）。
- 不为 Wiki 页面做语义重排、摘要或改写。
- 不做「克隆是否落后远端」的检查（属 git fetch/ff 领域，见 005 草案）。
- 不做 doctor 健康检查扩展（005 的范围）。

## 开放问题（进入 Design 前需澄清）

1. **交付形态**：需求方已确认「不给路径型 CLI、按目录规范推导位置」与
   「CLI 负责映射与校验并输出结果」。但 `.wiki/` 页面当前**完全不在召回
   索引内**（`src/recall.ts` 的索引输入只有 learnings/docs/rules/skills 与
   `teamwiki/` 图谱）。若不进入索引，「按 Wiki 页面检索」在 CLI 侧没有触发点
   ——需要确认：Wiki 页面是否进入检索面（进入即改变默认检索结果，与
   非目标第 1 条张力），还是沿用 `teamai list`/`get` 的既有面承载。
2. **fork 特性是否带上新基线**：`v0.26.0-beta.5` 无 fork 的 `get` 命令与
   `sharing.docs.localDir: ~/docs` 项目绑定（`src/get-cmd.ts`、003/004 语义
   均只在 fork 线）。本需求的映射默认值依赖「项目命名空间 `docs/<pid>/`」
   这一约定——需确认新基线是否带上 fork 的命名空间语义，还是本需求自持
   该约定（不依赖 fork 命令）。
3. **用户作用域下的 wiki 定位**：`scope: user`（无激活项目）时
   `.wiki/<pid>/` 的 `<pid>` 无从推导——是按「项目根 + 单激活项目」限定可用，
   还是允许显式指定 pid？
4. **多 Wiki 同名**：团队仓存在多个同名 `<name>wiki` 集合时（不同 pid 下），
   是给出候选让调用方消歧，还是按激活项目过滤后唯一化？
