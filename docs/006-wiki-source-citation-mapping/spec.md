# Spec — 团队仓 Wiki 的检索与原文引用（006）

Status: draft（开放问题已由需求方确认，见 §9；实现待 plan 获批）

基线：`v0.26.0-beta.5`。承接 [intent.md](./intent.md) 的问题陈述与约束；
本文只描述行为、规则、接口与边界，不描述具体代码结构（见 plan.md）。

## 1. 术语

| 术语 | 含义 |
|---|---|
| Wiki 集合 | 团队仓克隆内的 `<clone>/.wiki/<pid>/<name>wiki/`（004/003 命名空间约定；`<name>wiki` 目录名即集合 id） |
| Wiki 页面 | Wiki 集合内的 `.md` 文件，frontmatter 携带 `sources[]` 契约（`{path, sha256}`） |
| 锚点 | 页面 frontmatter `sources[]` 的单个元素：`{ path, sha256 }` |
| 引用 | 把锚点解析到本机可打开的真实文件，并判定其是否可被引用 |

## 2. 数据与来源约定

### 2.1 锚点的书写形态（输入契约）

页面 frontmatter 的 `sources[]` 是唯一输入契约：每个元素为
`{ path, sha256 }`，其中 `path` 是**页面撰写时所依据的原文路径**（对
authoring 项目根相对，如 `docs/usage-guide.md`），`sha256` 是那版本原文
字节内容的 SHA-256 十六进制小写摘要。

CLI 只按此契约读取，**不依赖任何生成该页面的工具**：不 import、不假设
skill 行为。默认映射只处理 `docs/…` 形态（项目根相对 → 项目命名空间）；
其他形态靠配置的 `map` 显式覆盖，CLI 不做猜测（`../`、绝对路径等 →
`unmapped`）。

### 2.2 目标位置的推导（不使用本机绝对路径）

同一个锚点在两台机器上必须解析到各自的真实文件，因此配置**不写绝对路径**：

```
锚点 path ──[映射规则]──▶ 团队仓克隆内相对路径 ──[运行时拼接克隆根]──▶ 真实绝对路径
                            例如 docs/<pid>/usage-guide.md        <cloneRoot>/docs/...
```

`<cloneRoot>` 由本地配置 `repo.localPath` 在运行时解析；`<pid>` 取当前目录
激活的项目（`projects`；恰好一个时的唯一项）。

### 2.3 允许范围

引用目标必须落在**团队仓克隆的 `docs/<pid>/` 子树内**（实现按真实路径
`realpath` 判定，符号链接逃逸 → `out_of_scope`）。范围外的候选即使存在也
不得作为引用——这是防止锚点把引用指向仓库任意文件（含 `.git/`、其他项目
命名空间）的硬边界。

## 3. 配置（团队仓 `teamai.yaml`）

### 3.1 形态

在既有 `sharing` 下新增可选 `wiki` 段（可选而非 `.default`，沿用本文件既有
惯例：`sharing.hooks` / `sharing.mcp` / `sharing.coAuthor`，保证既有
`teamai.yaml` 字面量继续合法）：

```yaml
sharing:
  wiki:
    sources:
      - id: docs-wiki           # Wiki 集合 id（.wiki/<pid>/ 下的目录名）
        # 可选：显式路径映射，写在默认规则之前生效
        map:
          - from: docs/         # 锚点 path 的前缀（项目根相对）
            to: docs/teamai-cli/ # 团队仓克隆内相对路径前缀
```

- 配置了不存在于克隆的集合 id → 该来源的显式 `map` 不生效，回退默认约定
  （映射本身永不因配置缺失而失败）。
- 未配置 `sharing.wiki` 时，本需求的所有行为不激活（既有行为不变）。
- **`allow` 字段不实现**（实现时按奥卡姆收敛，见 §9.3）：允许范围固定为
  `docs/<pid>/`，没有真实的放宽/收窄需求。

### 3.2 映射规则（默认 + 覆盖）

按顺序匹配，**首个命中生效**：

1. **显式覆盖**：`map[].from` 为锚点 `path` 的前缀 → 替换为 `to`。
2. **默认规则（项目根相对）**：`path` 以 `docs/` 开头 → 重写为 `docs/<pid>/`。
3. **无规则命中**（含 `../` 页面相对形态、绝对路径、非 docs/ 路径）：
   该锚点标记 `unmapped`（不可引用），**不做猜测**。

规则 2 是默认约定，开箱可用；团队仓布局与约定不一致（或锚点用其他形态）
时，用 `map` 显式覆盖——**映射规则完全由配置决定，CLI 不依赖页面的产生方式**。

## 4. 解析与校验（引用才校验）

对**每个锚点**独立执行，四条判定全部通过才算可引用：

| # | 判定 | 失败状态 |
|---|---|---|
| 1 | 映射后得到克隆内相对路径 | `unmapped` |
| 2 | 该路径命中**一个**真实存在的文件 | `missing` |
| 3 | 真实路径在允许范围内（2.3，按 realpath 判定） | `out_of_scope` |
| 4 | 读到的字节内容 SHA-256 与锚点 `sha256` 一致 | `content_changed` |

> 注：`ambiguous`（多候选命中）在实现中**不可达**——每条锚点经前缀映射
> 恰好产生一个候选路径，不存在多候选分支；故状态枚举不含 `ambiguous`。

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

调用方（Agent）需要机器可判定的结论，而不是自己去猜路径。**主通道是
`recall --wiki-page <repo相对路径> --json`**——Agent 从团队仓克隆读到 Wiki
页面后，让 CLI 解析该页的锚点；输出为严格 JSON（§9.2 的结构，每锚点一个
对象）：

```
{
  "page": ".wiki/teamai-cli/docs-wiki/topics/usage-guide.md",
  "projectId": "teamai-cli",
  "sources": [
    { "path": "docs/usage-guide.md",
      "mapped": "docs/teamai-cli/usage-guide.md",
      "status": "verified",
      "resolved": "/…/team-repo/docs/teamai-cli/usage-guide.md",
      "sha256": "9437297…" },
    { "path": "docs/usage-guide.zh-CN.md",
      "status": "content_changed",
      "reason": "sha256 mismatch (expected a915b6d…, actual 0f3c1ab…)" }
  ]
}
```

- `status` 取值是**封闭枚举**：`verified` | `missing` | `out_of_scope` |
  `content_changed` | `unmapped` | `unverifiable`，调用方可直接判定。
- 不可引用的锚点输出 `status` 与 `reason`（如
  `sha256 mismatch (expected … , actual …)`）。
- `--wiki-page` **隐含 `--json`**；普通 `recall --json` 输出既有结果字段 +
  `sources`（与 text 版同构）。
- 人类可读输出保持英文；不改变既有 `recall` 在未激活本需求时的输出。

## 6. 边界与失败行为

| 情况 | 行为 |
|---|---|
| 未配置 `sharing.wiki` | 本需求全部行为不激活，既有输出逐字节不变 |
| `--wiki-page` 指向克隆内不存在的页面 | 明确报错（英文）+ 退出码 1，不静默返回空 |
| 页面路径非 `.wiki/` 前缀或含 `..` | 拒绝（退出码 1），不做路径穿越 |
| 配置的 `id` 在克隆内不存在 | 该来源的显式 `map` 不生效，回退默认约定；映射不因配置失败 |
| 无激活项目（`scope: user` 或 `projects` 非单数） | `projectId` 为空 → 默认映射 `docs/…` → 报告 `no active project id`，不做猜测 |
| 目标路径是符号链接 | 解析后仍须落在允许范围内（按真实路径判定），否则 `out_of_scope` |
| 克隆未 ff、内容落后远端 | 校验如实失败（`content_changed`/`missing`），提示可 `teamai pull`；不静默引用 |
| `sha256` 非 64 位十六进制 | 视为格式非法 → `unverifiable`，不参与比对 |
| 锚点 `path` 为 URL / 目录（尾斜杠）/ 空 | 不参与引用（URL/目录不是文件锚点），不报错 |

## 7. 兼容与影响面

- 既有 `recall` 的默认检索面、评分、阈值、投票、质量记录**均不改变**。
- 既有配置解析保持宽松：`sharing.wiki` 缺席时 `TeamaiConfigSchema` 不受影响。
- 双语文档：`docs/usage-guide.md` 与 `docs/usage-guide.zh-CN.md` 同步新增
  「Wiki 引用校验」章节；`skill-data/` 中受影响的 skill 同步（若行为变更涉及
  agent 使用方式）。
- 不触碰 `.wiki/` 的内容与页面本身；只读消费 frontmatter 契约。

## 8. 验收（对应 intent 成功标准）

1. 夹具团队仓：`.wiki/<pid>/docs-wiki/topics/usage-guide.md` 的
   `sources: [docs/usage-guide.md]` 在 `docs/<pid>/usage-guide.md` 存在且
   哈希一致时 → `verified` 且 `resolved` 指向该文件，Agent 可直接打开。
2. 同夹具把 `docs/<pid>/usage-guide.md` 内容改一位 → 同锚点 `content_changed`
   且带 expected/actual，仍可打开但明确不可引用。
3. 删除目标文件 → `missing`；锚点改为 `../secrets/x.md` → `unmapped`
   （页面相对形态不做猜测）；符号链接指向范围外 → `out_of_scope`。
4. 未配置 `sharing.wiki` 时，`recall` 输出与基线逐字节一致（快照对比）。
5. 单测覆盖四条判定 × 全部状态枚举；E2E 在真实夹具仓库上跑通第 1、2 条。

## 9. 需求方确认（2026-09-28）

原有三个开放问题已由需求方确认，作为本 spec 的决策基线：

| # | 问题 | 确认结论 |
|---|---|---|
| 1 | 新基线是否带上 fork 的 003/004 语义与 `get` 命令 | **不带**。本需求在裸 `v0.26.0-beta.5` 上独立落地；只读解析团队仓克隆的 `.wiki/` 与 `docs/<pid>/`，不依赖 fork 的同步机制 |
| 2 | 推导出的 Wiki 位置如何交给 Agent | **CLI 不输出 Wiki 位置**，只在文档/skill 里写清目录规范；Agent 按规范自行定位页面 |
| 3 | 是否需要机器可读通道 | **需要**。`recall` 增加 `--json`（含 `--wiki-page` 锚点解析模式） |

### 9.1 Wiki 位置的规范（由文档承载，非 CLI 输出）

```
<teamRepoClone>/.wiki/<projectId>/<name>wiki/
```

- `<teamRepoClone>` = 本地配置 `repo.localPath`（运行时解析，配置里不写绝对路径）
- `<projectId>` = 当前目录激活的项目（`projects` 恰好一个时的唯一项）
- `<name>wiki` = 集合 id，即调用方指名的「某个 wiki」

CLI 不提供位置查询命令；位置不可推导时（无激活项目、同名多集合）由 §6 的
边界行为在**解析阶段**如实报告，不在检索阶段猜测。

### 9.2 `--json` 通道（实现为两个模式）

**模式 A — `recall --wiki-page <repo相对路径>`**（隐含 `--json`）：Agent 把
从克隆读到的 Wiki 页面路径交给 CLI，CLI 解析该页 frontmatter 的 `sources[]`
并逐个映射/校验，输出 §5 的结构（`page` / `projectId` / `sources[]`）。

**模式 B — `recall <query> --json`**：既有结果 JSON 化（`title`/`type`/
`scope`/`score`/`file`/`sources`），与 text 版同构；不含未经校验的
`verified`（普通结果无锚点解析，`sources` 仅透传 codebase 图谱的原文列表）。

### 9.3 实现时的取舍（已落地）

- **`allow` 字段不实现**：允许范围固定 `docs/<pid>/`，无真实放宽需求。
- **`ambiguous` 状态不实现**：每条锚点经前缀映射恰好一个候选（见 §4 注）。
- **页面相对形态不映射**：默认约定只重写 `docs/…` 形态；`../`、绝对路径等
  不在默认范围内，需显式 `map` 覆盖，否则 `unmapped`（不做猜测）。
