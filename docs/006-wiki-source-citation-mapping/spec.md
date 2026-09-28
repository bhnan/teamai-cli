# Spec — 团队仓 Wiki 的检索与原文引用（006）

Status: draft（随 plan 一并获批后实施）

基线：`v0.26.0-beta.5`。承接 [intent.md](./intent.md) 的问题陈述与约束；
本文只描述行为、规则、接口与边界，不描述具体代码结构（见 plan.md）。

## 1. 术语

| 术语 | 含义 |
|---|---|
| Wiki 集合 | 团队仓克隆内的 `<clone>/.wiki/<pid>/<name>wiki/`（004/003 命名空间约定；`<name>wiki` 目录名即集合 id） |
| Wiki 页面 | Wiki 集合内的 `.md` 文件（project-wiki skill 产出，frontmatter 为 JSON） |
| 锚点 | 页面 frontmatter `sources[]` 的单个元素：`{ path, sha256 }` |
| 引用 | 把锚点解析到本机可打开的真实文件，并判定其是否可被引用 |

## 2. 数据与来源约定

### 2.1 锚点的书写形态（输入契约，只读，不要求 skill 改动）

`path` 相对**项目根**书写。实测两种形态并存：

- frontmatter：`docs/usage-guide.md`（项目根相对）
- 正文相对链接：`../../docs/usage-guide.md`（相对当前页面）

`sha256` 是原文字节内容的 SHA-256 十六进制小写摘要，在**项目工作区**下计算。

### 2.2 目标位置的推导（不使用本机绝对路径）

同一个锚点在两台机器上必须解析到各自的真实文件，因此配置**不写绝对路径**：

```
锚点 path ──[映射规则]──▶ 团队仓克隆内相对路径 ──[运行时拼接克隆根]──▶ 真实绝对路径
                            例如 docs/<pid>/usage-guide.md        <cloneRoot>/docs/...
```

`<cloneRoot>` 由本地配置 `repo.localPath` 在运行时解析；`<pid>` 取当前目录
激活的项目（`projects`；恰好一个时的唯一项）。

### 2.3 允许范围

引用目标必须落在**团队仓克隆的 `docs/<pid>/` 子树内**（配置可显式放宽/收窄，
见 3.2）。范围外的候选即使存在也不得作为引用——这是防止锚点把引用指向仓库
任意文件（含 `.git/`、其他项目命名空间）的硬边界。

## 3. 配置（团队仓 `teamai.yaml`）

### 3.1 形态

在既有 `sharing` 下新增可选 `wiki` 段（可选而非 `.default`，沿用本文件既有
惯例：`sharing.hooks` / `sharing.mcp` / `sharing.coAuthor`，保证既有
`teamai.yaml` 字面量继续合法）：

```yaml
sharing:
  wiki:
    sources:
      - id: docs-wiki           # Wiki 集合 id（用于让调用方指名检索）
        # 可选：覆盖该集合的允许范围，缺省为 docs/<pid>/
        allow: [docs]
        # 可选：显式路径映射，写在默认规则之前生效
        map:
          - from: docs/         # 锚点 path 的前缀（项目根相对）
            to: docs/teamai-cli/ # 团队仓克隆内相对路径前缀
```

- `id` 必须通过与 `.wiki/<pid>/` 下实际目录名的一致性校验；配置了不存在的
  集合 → 该来源标记为不可用并给出原因，不静默忽略。
- 未配置 `sharing.wiki` 时，本需求的所有行为不激活（既有行为不变）。

### 3.2 映射规则（默认 + 覆盖）

按顺序匹配，**首个命中生效**：

1. **显式覆盖**：`map[].from` 为锚点 `path` 的前缀 → 替换为 `to`。
2. **默认规则（项目根相对）**：`path` 以 `docs/` 开头 → 重写为 `docs/<pid>/`。
3. **默认规则（页面相对形态）**：`path` 含相对段（`../`）→ 先按页面所在
   目录归一化为项目根相对路径，再套用规则 2。
4. **无规则命中**：该锚点标记 `unmapped`（不可引用），不做猜测。

规则 2/3 是同一约定（「项目根相对 → 项目命名空间」）的两种书写形态，
因此默认开箱可用；只有团队仓布局与约定不一致时才需要写 `map`。

## 4. 解析与校验（引用才校验）

对**每个锚点**独立执行，四条判定全部通过才算可引用：

| # | 判定 | 失败状态 |
|---|---|---|
| 1 | 映射后得到克隆内相对路径 | `unmapped` |
| 2 | 该路径**唯一**命中一个真实文件（不存在 → 失败；同名多命中 → 失败） | `missing` / `ambiguous` |
| 3 | 真实路径在允许范围内（3.2/2.3） | `out_of_scope` |
| 4 | 读到的字节内容 SHA-256 与锚点 `sha256` 一致 | `content_changed` |

- **只有 1–4 全通过**的锚点判定为可引用（`verified`），可被 Agent 直接引用；
  其余一律标注不可引用，并携带上表的状态与人类可读原因。
- 锚点**缺 `sha256`**：无法证明内容一致 → 不可引用（`unverifiable`），
  不得降级为「存在即可引用」。
- 锚点 `path` 为 URL、目录（尾斜杠）或空 → 不参与引用（既有的
  `sanitizeSources` 语义），不报错。
- 校验是**只读**的：不下载、不写文件、不修改页面、不产生副作用。

### 4.1 校验的作用面

- 校验**只作用于被引用的锚点**，不作用于检索：页面能否被检索到与锚点是否
  可引用互不决定。
- 一个页面的多个锚点彼此独立：一条不可引用不影响同页其他锚点，也不使整页
  不可用（整页降级已在需求确认中排除）。
- 校验**不缓存**结果：`sha256` 是内容一致性的断言，缓存会让「内容已变化」
  在缓存有效期内被误报为可引用。

## 5. 输出形态（CLI 负责并给结论）

调用方（Agent）需要机器可判定的结论，而不是自己去猜路径。因此每个锚点输出：

```
Sources:
  - path: docs/usage-guide.md            # 锚点原文（页面里写的）
    status: verified                     # verified | missing | ambiguous |
                                         # out_of_scope | content_changed |
                                         # unmapped | unverifiable
    resolved: /…/team-repo/docs/teamai-cli/usage-guide.md   # 仅 verified 时给出
    sha256: 9437297…                     # 仅 verified 时给出（实读摘要）
```

- `status` 取值是**封闭枚举**，调用方可直接判定，不需要解析自然语言。
- 不可引用的锚点输出 `status` 与 `reason`（如
  `reason: sha256 mismatch (expected 9437297…, actual a915b6d…)`）。
- 人类可读输出保持英文；不改变既有 `recall` 在未激活本需求时的输出。

## 6. 边界与失败行为

| 情况 | 行为 |
|---|---|
| 未配置 `sharing.wiki` | 本需求全部行为不激活，既有输出逐字节不变 |
| 团队仓克隆不存在 / `.wiki/` 不存在 | 明确提示（英文），不报栈、不静默返回空 |
| 配置的 `id` 在克隆内不存在 | 该来源标记不可用 + 原因（列出克隆内实际存在的集合 id） |
| 多个 `<pid>` 下存在同名集合 | 给出候选（含各自 pid 与路径），要求消歧；不得任选其一 |
| 无激活项目（`scope: user`） | `<pid>` 无从推导 → 明确报「需在项目作用域或有激活项目的目录下使用」，不做猜测 |
| 目标路径是符号链接 | 解析后仍须落在允许范围内（按真实路径判定），否则 `out_of_scope` |
| 锚点 `path` 试图越出仓库（`../../..` 逃逸） | 归一化后越界 → `out_of_scope` |
| 克隆未 ff、内容落后远端 | 校验如实失败（`content_changed`/`missing`），提示可 `teamai pull`；不静默引用 |
| `sha256` 非 64 位十六进制 | 视为格式非法 → `unverifiable`，不参与比对 |

## 7. 兼容与影响面

- 既有 `recall` 的默认检索面、评分、阈值、投票、质量记录**均不改变**。
- 既有配置解析保持宽松：`sharing.wiki` 缺席时 `TeamaiConfigSchema` 不受影响。
- 双语文档：`docs/usage-guide.md` 与 `docs/usage-guide.zh-CN.md` 同步新增
  「Wiki 引用校验」章节；`skill-data/` 中受影响的 skill 同步（若行为变更涉及
  agent 使用方式）。
- 不触碰 `.wiki/` 的内容与 project-wiki skill 的产出。

## 8. 验收（对应 intent 成功标准）

1. 夹具团队仓：`.wiki/<pid>/docs-wiki/topics/usage-guide.md` 的
   `sources: [docs/usage-guide.md]` 在 `docs/<pid>/usage-guide.md` 存在且
   哈希一致时 → `verified` 且 `resolved` 指向该文件，Agent 可直接打开。
2. 同夹具把 `docs/<pid>/usage-guide.md` 内容改一位 → 同锚点 `content_changed`
   且带 expected/actual，仍可打开但明确不可引用。
3. 删除目标文件 → `missing`；把锚点改为同时匹配两个候选 → `ambiguous`；
   锚点改为 `../secrets/x.md` → `out_of_scope`。
4. 未配置 `sharing.wiki` 时，`recall` 输出与基线逐字节一致（快照对比）。
5. 单测覆盖四条判定 × 全部状态枚举；E2E 在真实夹具仓库上跑通第 1、2 条。

## 9. 开放问题（需需求方确认后才进入 Build）

1. **检索入口**：`.wiki/` 页面当前不在召回索引内，因此「按 Wiki 页面检索」
   在 CLI 侧没有触发点。已确认「不新增 CLI 命令」「按目录规范推导位置」，
   但推导出的**位置如何交给 Agent**（Agent 自己按约定读克隆目录 vs CLI 输出
   该路径）尚未确认——两种都符合已确认约束，但决定本需求是否需要扩展现有
   命令的输出。
2. **新基线是否带上 fork 的 003/004 语义与 `get` 命令**：本 spec 的默认映射
   依赖「`docs/<pid>/` 项目命名空间」这一**团队仓目录约定**（003/004 已确立，
   且本机团队仓克隆已是该布局）。若新基线不引入 fork 的 `get` 命令，本需求
   仍可自持该约定（只读解析，不依赖同步机制）——需确认这一取舍。
3. **校验结果是否需要机器可读通道**：第 5 节的 YAML 样式输出对人类与 Agent
   都可读，但既非严格 JSON 也非既有格式。是否要求 `--json`？
