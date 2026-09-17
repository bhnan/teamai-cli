# Spec — teamai-get 单资源 / 知识库拉取命令

Status: draft（随 plan 一并获批后实施）

## 接口

```text
teamai-get list [type]
teamai-get <type> [name] [tool] [options]

  list:  列出团队仓中可拉取的资源（省略 type = 四类全部列出）
  type:  skills | rules | docs | wiki
  name:  资源名（wiki 省略 name = 整库镜像；给出 name = 单页拉取）
  tool:  claude|dsh|codex|cursor|codebuddy|qoder|kiro|zcode|joycode|opencode
         （仅 skills/rules 使用；省略 = 当前项目下所有已存在的工具目录）

Options:
  --all     docs 整目录镜像模式
  --diff    wiki 差异预览，不写入任何文件
  --prune   镜像模式下删除目标端多余文件（缺省保留）
  --force   单条模式下覆盖已存在副本（镜像模式不需要——覆盖是其语义）

环境变量 TEAMAI_REPO：覆盖团队仓克隆路径（测试用）；
缺省从 `teamai status` 输出的 local: 字段取得。
```

> 便利约定：skills / rules / docs 省略 name 时等价于 `list <type>`（先看有什么再拉）。

## 典型流程（list → 单选拉取，与 `teamai skill list` 同构）

```text
$ teamai-get list wiki          # 先看有什么
  Home.md
  arch/a.md
  arch/b.md

$ teamai-get wiki arch/a.md     # 再单独拉一页
✓ arch/a.md → .wiki/arch/a.md

$ teamai-get wiki               # 或整库镜像（保存全部内容）
$ teamai-get wiki --diff        # 随时查看团队仓 vs 本地的区别
```

## 源与目标

| type | 源（团队仓克隆内） | 目标（当前项目） | 粒度 |
|---|---|---|---|
| skills | `skills/<name>/`，否则探测 `skills/*/<name>/` | `<tool-root>/skills/<name>/`（整目录复制） | 单条 |
| rules | `rules/<name>(.md)`，否则探测 `rules/*/<name>(.md)` | `<tool-root>/rules/<name>.md`（单文件） | 单条 |
| docs | `docs/<name>`（支持子路径；**`.md` 后缀可省略**，目标保留真实文件名） | `./docs/<name>` | 单条 |
| docs --all | `docs/` 整目录 | `./docs/` | 镜像 |
| wiki | `.wiki/<page>` | `./.wiki/<page>`（单页，保持相对路径） | 单页 |
| wiki（无 name） | `.wiki/` 整目录 | `./.wiki/` | 整库镜像 |

工具→根目录映射：`claude→.claude  dsh→.dsh  codex→.codex  cursor→.cursor  codebuddy→.codebuddy  qoder→.qoder  kiro→.kiro  zcode→.zcode  joycode→.joycode  opencode→.opencode`

## 行为规则

1. **list**：按 type 递归列出可拉取项——skills 列目录名（含 namespace 前缀显示）、rules 列 `.md` 相对路径、docs 列文件相对路径、wiki 列 `.md` 相对路径；目录为空/不存在时提示「团队仓暂无该类资源」；未知 type 打印 usage
2. **单条模式**（skills / rules / docs / wiki 单页）：目标已存在且无 `--force` → 拒绝并提示（exit 1）
3. **镜像模式**（wiki 无 name / docs --all）：同名文件直接覆盖（同步语义）；**默认不删除目标端多余文件**（本地独有内容不丢失），`--prune` 才删除
4. **wiki `--diff`**：输出源与目标的 `diff -rq` 差异摘要，不写入；目标不存在时提示「将新建整库」
5. **多目标**（skills/rules 省略 tool）：复制到当前项目下**已存在**的工具目录；一个都不存在时——skills 兜底创建 `.claude` 与 `.dsh`，rules 报错要求显式指定 tool（dsh 无 rules 目录约定，rules 拉取时自动跳过并提示）
6. 逐条输出 `✓ <name> → <dest>`；单个目标失败不中断其余目标，最终存在任一失败则 exit 1
7. 报错情形（均非零退出）：未 init / 克隆缺失；type/tool 非法（打印 usage）；资源不存在（**列出该项可用资源**，即内置 list）；namespace 多处同名且无法唯一解析（列出候选）

## 与 teamai 同步的关系

- skills / rules 的单拉副本可能被下次 `teamai pull` 的同名全量同步覆盖（pull 为权威），命令输出需附带一次此提示
- `./docs/`、`./.wiki/` 不在 teamai 官方同步面上（官方 docs 知识留在克隆内供 recall），不会被 pull 覆盖
- 不触碰 `~/.teamai/` 状态、不触发官方迁移逻辑、零网络请求

## 已知限制（明示，不算缺陷）

- rules 不做 per-tool 格式渲染（如 Cursor `.mdc` frontmatter 不生成）
- wiki / docs 镜像是文件级覆盖，不做 Markdown 内容级合并
- 脚本不随团队仓自动分发（teamai 同步面不含可执行脚本）；队友获取方式见 plan
