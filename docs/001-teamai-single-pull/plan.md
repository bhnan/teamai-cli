# Plan — teamai-get 实现

Status: completed（2026-09-17；T1–T13 + 评审修复复验全部通过）

## 变更面

- 新增 `scripts/teamai-get`（bash，`set -euo pipefail`，无第三方依赖）
- 删除原型 `/usr/local/bin/teamai-get`（决议：推倒重写），新版安装到同路径
- 更新 `.claude/skills/teamai-ops/SKILL.md` 与 `.dsh/skills/teamai-ops/SKILL.md`（保持一致）：命令映射表补充 wiki / docs --all；「单技能拉取」一节改为引用 `teamai-get`
- 不改动：teamai npm 包、`~/.teamai/` 官方配置、其他仓库文件

## 实现步骤

1. 移除原型脚本 `/usr/local/bin/teamai-get`
2. 按 spec 实现 `scripts/teamai-get`（四种 type；`--all` / `--diff` / `--prune` / `--force`；`TEAMAI_REPO` 覆盖）
3. `bash -n` 语法检查；安装到 `/usr/local/bin/teamai-get`
4. 同步更新两份 `teamai-ops` SKILL.md 并 `diff` 校验一致
5. 验证（下表）全部通过后，更新本文件状态与 intent 关联说明

## 测试策略

夹具：`TEAMAI_REPO=/tmp/teamai-fixture`，内含
`skills/{alpha,ns/beta}/SKILL.md`、`rules/{gamma.md,ns/delta.md}`、`docs/{epsilon.md,sub/zeta.md}`、`.wiki/{Home.md,arch/a.md}`

| # | 用例 | 预期 |
|---|------|------|
| T1 | skills 平铺拉取（alpha，省略 tool） | 落入 .claude 与 .dsh 两处，双 ✓ |
| T2 | skills namespace 解析（beta） | 从 skills/ns/beta 唯一解析成功 |
| T3 | rules 拉取（gamma） | .claude/rules/gamma.md 落盘；dsh 被跳过且有提示 |
| T4 | docs 单文件（epsilon） | ./docs/epsilon.md 落盘 |
| T5 | docs --all（含本地多余文件） | 镜像覆盖 + 本地多余保留；加 --prune 后多余被删 |
| T6 | wiki 整库镜像 | .wiki/ 全部内容落盘；本地独有页默认保留 |
| T7 | wiki --diff | 仅输出差异摘要，目标文件时间戳/内容不变 |
| T8 | 同名已存在无 --force | 拒绝 exit 1；加 --force 覆盖成功 |
| T9 | 不存在的 name | 非零退出并列出可用资源（内置 list） |
| T10 | 未 init 环境（无 status local 且无 TEAMAI_REPO） | 报错提示 teamai init |
| T11 | list 无参 / list wiki | 四类分别列出可用项；空类型提示「暂无该类资源」 |
| T12 | wiki 单页拉取（arch/a.md，省略 .md 后缀亦可） | 落盘 ./.wiki/arch/a.md；同名无 --force 拒绝 |
| T13 | wiki 单页不存在（nope.md） | 非零退出并列出可用页面 |

每条用例记录实际命令、退出码与输出到本文件验证小节。

## 风险与回滚

- 风险：镜像模式覆盖目标同名文件（同步语义，spec 已明示）；`--prune` 误删——删除范围严格限定在目标镜像目录内
- 回滚：删除脚本 + 还原两份 SKILL.md 即可，无持久状态、无远程影响

## 完成定义

- [x] T1–T13 实测通过且输出留痕于本文件
- [x] 独立只读评审（fresh 上下文）通过，发现项已解决
- [x] 本文件 Status 置 completed（2026-09-17）
- [ ] 交付后按既定批准执行 `teamai push`（teamai-ops 两种拷贝去重为一个 skill）

## 独立评审记录（2026-09-17）

评审方式：全新只读上下文全文精读 + 独立夹具实证；`/usr/local/bin` 安装件与仓库源码逐字节一致（PARITY_OK）。

**结论：FAIL → 修复后复验通过。** 发现与处置：

| 级别 | 发现 | 处置 |
|---|---|---|
| 🔴-1 | skills `name` 未拒绝 `..`，`rm -rf`+`cp` 可越出工具目录（评审员已实证） | ✅ 新增统一 `check_name` 守卫（`*..*|/*`），覆盖 skills/rules/docs/wiki 全部入口 |
| 🔴-2 | docs 单文件 `name` 同类穿越，可覆盖项目根任意文件（已实证） | ✅ 同上 |
| 🟡-3 | 循环体内裸命令失败会中断其余目标，违反 spec 行为规则 6 | ✅ skills/rules 逐目标 `&&` 链 + 失败继续；mirror_dir 逐文件隔离 + `MIRROR_FAIL` 汇总退出码 |
| 🟡-4 | rules 的 list（全深度）与 resolve（maxdepth 2）不一致 | ✅ resolve 改为「精确相对路径优先 + 全深度 basename 探测」，与 list 对齐 |
| 🟡-5 | 选项/type 组合不校验，`docs --all --diff` 会意外写入 | ✅ 组合白名单校验，非法组合 usage exit 1 |
| 🟢 | status 解析尾随空白、symlink 不对称、help 退出码等 8 条备注 | 采纳两条低成本项（尾随空白 trim、`--help` exit 0）；其余记录在案不改 |

**修复后复验**：穿越用例（`skills ../../pwn`、`docs ../evil`、`rules ../../x`、`wiki ../evil`）全部 `✗ 非法路径` exit 1 且未落地文件；T1/T2/T3/T4/T12 回归通过；`rules a/b/deep` 精确相对路径与 `rules deep` 全深度探测均成功（修复②：find `-print0` 与 `read -d ''` 分隔符匹配）；选项组合 3 例全部 exit 1；`--help` exit 0。

### 遗留备注（不阻塞，供后续参考）

- 镜像/单条的 symlink 处理不对称（单条保留 symlink，镜像跳过）
- `--prune` 仅删文件，清理后可能遗留空目录
- name 含 glob 字符（如 `ga*`）会被当作通配符——行为怪但不危险

## 验证记录（实际执行）

环境：Ubuntu 24.04 / bash。夹具 `TEAMAI_REPO=/tmp/teamai-fixture`；测试项目 `/tmp/teamai-get-test`（含 `.claude`、`.dsh`、`.claude/rules`）。安装路径 `/usr/local/bin/teamai-get`。

| # | 结果 | 关键证据（摘录） |
|---|------|------|
| T1 | ✅ | `✓ alpha → .claude/skills/alpha` + `✓ alpha → .dsh/skills/alpha`，exit 0 |
| T2 | ✅ | `✓ beta → .claude/skills/beta`（自 `skills/ns/beta` 解析） |
| T3 | ✅ | `✓ gamma.md → .claude/rules/gamma.md`；显式 dsh → `✗ dsh 无 rules 目录约定，跳过`，exit 1 |
| T4 | ✅（修复后） | 首测发现缺陷①；修复后 `✓ epsilon.md → ./docs/epsilon.md`，完整名与子路径（`sub/zeta`）均通过 |
| T5 | ✅ | `--all` 镜像 2 文件；`local-only.md` 保留；`--prune` 后移除 |
| T6 | ✅ | 整库镜像 2 文件；本地 `local-note.md` 保留；`--prune` 移除 |
| T7 | ✅（修复后补证） | 团队侧修改 a.md 后 `--diff` 输出 `Files …/a.md differ`；连续两次 `--diff` md5 不变（不写入）；整库镜像后 md5 更新、diff 归零 |
| T8 | ✅ | 无 `--force` → `✗ 已存在 …（加 --force 覆盖）` exit 1；`--force` 覆盖成功 |
| T9 | ✅ | `✗ 团队仓中找不到 skill：nope` + 列出可用（alpha、ns/beta），exit 1 |
| T10 | ✅ | `✗ 未找到团队仓克隆…`，exit 1 |
| T11 | ✅ | `list` 按 [skills][rules][docs][wiki] 分节列出；`list wiki` 仅列 wiki；空类型提示「暂无」 |
| T12 | ✅ | 单页拉取 `✓ arch/a.md → ./.wiki/arch/a.md`；已存在时拒绝、`--force` 成功；省略 `.md` 解析成功 |
| T13 | ✅ | `✗ 找不到 wiki 页：nope.md` + 列出可用页面，exit 1 |

### 测试中发现并修复的缺陷

1. **docs 单文件省略 `.md` 后缀解析失败**（T4 首测失败）→ 增加 `name` / `name.md` 双重解析，目标保留真实文件名；spec.md「源与目标」表已同步
2. **`local drel=… ddest="…$drel"` 同语句引用触发 `set -u` unbound variable**（T4 修复回归时暴露）→ 拆分为两条 `local` 语句
3. 说明：T8a / T12 首轮的「已存在拒绝」由前序镜像用例产生，属正确的覆盖保护行为，非缺陷
