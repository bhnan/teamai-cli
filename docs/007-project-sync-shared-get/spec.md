# Spec — 项目同步与共享资源获取（007）

Status: draft（Design；按已确认 intent 编写，待设计评审）

## 1. 行为模型

TeamAI 提供两种明确的同步域。命令调用必须先解析作用域，再构造文件级变更计划；不能从当前目录名猜测项目，也不能把项目资源回退到用户全局目录。

| 命令 | 域与方向 | 资源 | 主要目标 |
|---|---|---|---|
| `push` | 项目：当前项目 → 团队仓对应 namespace | skills、rules、docs、env、agents、wiki | 发布当前项目有权管理的资源；docs/Wiki 供其他项目参考 |
| `pull` | 项目：团队仓对应 namespace → 当前项目 | skills、rules、env、agents | 更新当前项目工具配置，不管理 docs/Wiki |
| `get` | 共享：团队仓共享区 → 指定 Agent 全局目录 | skills、rules | 首次获取或更新一个共享资源 |

不加入 shared push/pull。共享 get 不回传全局目录的编辑；需要贡献上游变更时，应走后续明确定义的团队资源编辑/贡献流程，不将其伪装为 get。

## 2. 调用与解析

建议复用现有命令，新增最少参数：

```text
teamai push --project <id> [--agent <tool>] [--types <list>] [--skill <name>] [--rule <name>]
teamai pull --project <id> [--agent <tool>] [--types <list>] [--skill <name>] [--rule <name>]
teamai get skills <name> --agent <tool> [--refresh] [--force]
teamai get rules <name> --agent <tool> [--refresh] [--force]
teamai get list [skills|rules] --agent <tool>
```

- push/pull 必须在已初始化的 project scope 中运行；`--project` 必须是该 scope 激活且团队 manifest 已声明的项目。参数缺失时仅在激活项目唯一时可推导，否则报错列出可选 ID。不接受 silent fallback 到 user scope。
- 当前 push 的 `--project` 用于目的 namespace；新行为要进一步验证 cwd/project binding，保证读取的是同一个业务项目，不能误把另一工作区文件发入目标项目。
- push 的 `--types` 默认六类；pull 仅允许 skills/rules/env/agents，默认四类。对 pull 显式传 docs 或 wiki 必须报错，不能开启隐藏回拉模式。非法类型、类型与 selector 不匹配、未知 Agent 或路径不明确时，在写入前失败。
- `--agent` 对 skills/rules/agents 选择工具来源或工具目标。单 Agent 已明确且没有歧义时可省略；多 Agent 情况要求指定或交互选择，非交互执行必须指定。
- push 发布 docs/wiki 时只读取项目原文、写入团队仓对应项目，不要求 Agent；指定 Agent 不改变发布位置。pull 不扫描、部署或清理项目 docs/wiki。env 是项目资源，由 env 配置和 handler 解析，不被当成某个 Agent 的 skill/rule 文件。
- `--skill`/`--rule` 限定单资源；同名资源有多个来源时要求完整相对路径或列出候选，不按 basename 猜测。
- get 只接受共享 namespace 的 skill/rule。目标固定为所选工具的全局资源目录，即使 cwd 位于项目内也不写入项目目录；项目 namespace 不作为 fallback。
- get 默认读已配置的团队仓本地 clone；`--refresh` 只刷新该 clone，不运行 pull 资源部署及其 Hooks/MCP/usage/postPull 等附带动作。
- 参数名仍须与 Commander 的现有全局选项校验，避免重复声明冲突；这是实现前的接口核查项，不改变上述行为契约。

## 3. 路径映射与资源归属

### 3.1 项目资源

映射必须由项目 ID 和资源类型唯一决定。skills/rules/env/agents 在 push/pull 两个方向使用；docs/Wiki 映射只服务 push 发布与团队仓内引用，不定义回拉到业务项目的目标。首版布局提案如下：

| 资源 | 项目来源/目标 | 团队仓来源/目标 | Agent 影响 |
|---|---|---|---|
| skills | 所选工具的项目 skills 目录 | manifest 中该项目声明的 skills namespace | 是 |
| rules | 所选工具的项目 rules 目录 | manifest 中该项目声明的 rules/knowledge namespace | 是 |
| docs（仅 push） | `<projectRoot>/docs/`，只读发布源 | `docs/<projectId>/`，发布目标 | 否 |
| env | 当前项目配置解析出的 env 资源 | manifest 声明的项目 env namespace | 否；按现有 env handler 部署 |
| agents | 所选工具的项目 agents 目录 | manifest 中该项目声明的 agents namespace | 是，具体由选定工具路径适配 |
| wiki（仅 push） | `<projectRoot>/.wiki/`，只读发布源 | `.wiki/<projectId>/`，发布目标，保留集合和页面结构 | 否 |

项目资源目录仍按 manifest 声明权限；目录存在不等于已声明归属。未声明、不可读取或映射缺失时显示 `unconfigured` / `unreadable` 并保留目标，不推断为空、不触发删除。

实现前需要核对现有 `projects.yaml` 是否已有可表达所有类型的资源字段。基线 schema 目前未把 wiki 列为 project resource type；若扩展 schema，旧 CLI 对未知字段的兼容方式必须先评估。配置不得把用户机器绝对路径提交到团队仓；本机项目根由现有 project config 解析。

### 3.2 共享资源

共享资源身份由团队仓明确共享的 skill/rule namespace 决定；项目专属 namespace 不共享。get 把指定资源适配后安装到 `scopedToolPaths` 对应的 user/global 工具位置。若多个团队仓同时声明相同共享资源 ID，get 要求用户显式选择仓绑定，不按 cwd 自动切换来源。

本机全局目标与团队仓共享源之间保存安装记录，至少包括团队仓身份、资源类型/name、Agent、源相对路径、源内容摘要、部署内容摘要及最后成功版本。凭据和远端 URL 中可能包含的 token 不写入此状态，也不回显。

### 3.3 跨项目参考与 Wiki 引用

其他项目从团队仓本地 clone 检索已发布的 docs/Wiki，不需要把它们复制进消费方业务项目。引用校验应使用页面的来源项目及其映射，不能把消费方项目 ID 当作来源项目。现有单页校验如何传递来源项目需在实施前核查；不能据此重新引入 docs/Wiki pull。

Wiki 页面内 `sources[].path` 按项目根相对路径解释；团队仓页面位置按 `.wiki/<projectId>/<collection>/...`。映射必须让该路径指向同一次发布的项目 doc，例如 `docs/a.md` → 团队仓 `docs/<projectId>/a.md`。复用现有 006 引用校验，只有文件在允许项目 docs 范围内且 SHA-256 匹配才为 verified。doc 更新但 Wiki 未重建时可返回 content_changed；同步不得篡改 sha256 或声称引用已验证。

Wiki 正文相对链接的自动改写不在本 spec 内；同步按字节复制并保留现有 frontmatter、集合与子目录。

## 4. 变更计划、覆盖和删除

push/pull/get 均在各自允许的资源范围内生成单项计划，比较源 S、目标 T 与上次成功同步基线 B。docs/Wiki 的 S 为项目原文、T 为团队仓发布副本；以下覆盖和删除只作用于发布目标，不作用于项目原文：

| 条件 | 行为 |
|---|---|
| 新资源，目标不存在 | 计划新增 |
| `S = T` | unchanged，不重写 |
| S 改变、T 仍等于 B | 可安全更新 T |
| S 未变、T 改变 | 保留 T，报告本地变更 |
| S/T 都改变且彼此不同 | conflict；该项不写入 |
| 无基线、目标已有不同内容 | unmanaged conflict；不自动接管 |
| 已跟踪资源从来源消失 | `pending-delete`；默认保留目标 |
| 目标存在从未由此映射管理的额外文件 | 保留 |

- 用户显式批准的 force/resolve 操作只作用于列出的冲突项；必须在执行前展示被覆盖路径。无 force 的安全项可以继续完成，冲突项不应阻塞所有独立资源，但整体退出码须反映未解决冲突。
- 删除需单独显示清单并显式确认；只有目标仍与其最后同步基线匹配才可删除。来源目录缺失、权限错误或未声明不能解释为“删除全部”。
- 文本格式转换资源（rules/agents）记录源摘要和部署摘要，以部署摘要判断目标是否被本地编辑。
- 成功项单独推进基线；失败/冲突项保留旧基线。操作中断后重试不重复破坏性写入。
- 文件写入前校验规范化路径及 realpath，拒绝项目根/团队仓根之外的源、目标、逃逸符号链接以及多个映射写入同一路径。对团队仓更新只通过既有 provider 的分支/PR/MR 发布流程，不 reset/stash 项目工作树。

## 5. 运行输出和副作用

每次输出解析后的项目/共享域、项目 ID（若适用）、Agent（若适用）、资源类型、来源和目标、added/updated/unchanged/conflict/pending-delete/unconfigured 数量。dry-run 输出同一计划但不写文件、不改状态、不提交发布、不执行 postPull。配置/路径错误和未解决冲突返回非零；无变化是成功。

项目 pull 只部署 skills/rules/env/agents 四类资源，不应借用完整 pull 后的所有副作用：Hook/MCP reconcile、模型切换、usage 上报和 postPull 均不因该命令隐式触发。需要保留的旧功能应有显式独立入口。共享 get 同样没有这些副作用。

pull 更新团队仓 clone 时可能得到已发布的 docs/Wiki，这是团队仓副本更新，不等于部署到业务项目。无论首次、重复、强制或自动 pull，项目原文及历史镜像目录都不因 pull 创建、覆盖、清理或删除。

原有 session-start Hook 当前会触发普通 pull；升级后必须调用符合项目范围契约的入口，并传入/解析同一个项目身份。缺少安全项目绑定时跳过写入并报告，而不是执行旧的全资源部署路径。

复制成功、团队仓发布成功、远端 PR/MR 合并、Recall 索引刷新分别报告；不得用其中一项推断其他项已完成。

## 6. 失败和边界行为

- 未初始化、项目不匹配、共享源有歧义、单项有歧义：操作前失败并显示可操作原因。
- 网络不可用：本地项目 push 准备可保留为 pending；pull/get 使用旧 clone 时必须清楚标记版本。带 `--refresh` 时刷新失败则不得谎称最新。
- 远端拒绝、权限失败、PR/MR 创建失败：显示本地准备与远端发布分别状态，不推进远端成功标记。
- 部分资源失败：报告逐项结果；无冲突项可按计划完成，失败项保留基线，下一次可重试。
- Wiki/doc 哈希不符：文件同步结果与引用验证结果分开；显示 content_changed，不自动重写引用记录。
- dry-run、取消确认、无变化均为零写入；不能只保证“文件未变”却在后台改变同步基线或索引。

## 7. 兼容迁移与非目标

- 这是 push/pull scope 与 get 默认落点的行为变化；发布前须提供从旧 user/project 配置到新项目绑定的迁移说明和可预览迁移。
- 旧 `get docs/wiki` 用户不得静默迁入新路径；先提供明确弃用提示或保留原行为的显式兼容入口。
- 迁移只生成预览计划，不自动移动、删除或覆盖已有项目 docs/Wiki。旧 docs 镜像目标原样保留但停止由 pull 管理，清理需独立授权；不得把旧 get docs/wiki 迁成 pull 的文档模式。
- 本需求不添加共享级 docs/wiki/env/agents，不把自定义 Wiki 搜索纳入 Recall，也不更改 project-wiki 的输出格式。
- 精确配置 schema、共享 namespace 标记和 force/delete CLI 选项仍需按本 spec 完成实现前核查；若核查发现与已确认 intent 冲突，回到 Design 修订，不自行扩展需求。
