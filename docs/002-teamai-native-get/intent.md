# Intent — teamai 原生 `get` 子命令（在 teamai-cli 项目内实现）

Status: draft（待需求方确认后进入 Design）

## 问题

001 以外挂脚本（bash `teamai-get`）实现了单资源拉取，但该方案存在结构性缺陷：

1. **无法正确渲染**：rules 的 per-tool 格式（Cursor `.mdc` frontmatter 等）只能裸拷贝，官方有现成的 `ruleFileExtensionForTool` 却用不上
2. **scope 感知缺失**：project/user 两种 scope、roles/namespaces 过滤都要脚本自己猜，官方有 `scopedToolPaths` / `scanRoleAwareSkills`
3. **双头维护**：官方 CLI 演进（工具矩阵、路径约定变化）不会带动脚本，必然腐化
4. **分发无解**：脚本不随团队仓同步，队友拿不到

正确方向（需求方指示）：**克隆 teamai-cli 项目，把该能力作为原生子命令实现**。

## 目标代码库

- Fork 仓库：`https://github.com/bhnan/teamai-cli`（已 fork，公开）
- 本地克隆：`/root/teamai-cli`（origin = fork，upstream = Tencent/teamai-cli，基线 `6ed2515`）
- 上游 Tencent/teamai-cli **不直接修改**；改动落在 fork 的特性分支

## 用户

- 需求方本人（从源码构建安装后使用 `teamai get`）
- 团队成员（若后续选择从 fork 安装或向上游提 PR——后者需需求方另行授权）

## 约束

- 技术栈遵从项目现状：TypeScript + commander（`src/index.ts` 注册）+ tsup 构建 + vitest 测试
- **不修改 `pull` / `push` / `status` 等既有命令的行为**（纯增量）
- 复用官方既有设施：`scopedToolPaths`、`getHandler`/资源 Handler、`ruleFileExtensionForTool`、`requireInit`/`loadLocalConfigForScope`、`utils/logger`、`utils/git`
- 行为语义沿用 001 spec 已验收的定义（四种 type、单条/镜像、覆盖保护、list 发现），仅实现载体升级

## 成功标准

1. `npm run build` 通过；`node dist/index.js get --help` 可用
2. 新增 vitest 单测覆盖核心解析与目标选择逻辑，且既有测试套件不回归
3. 从源码构建安装后，在 `/root/DeepTutor` 真实团队仓上 E2E 验证 001 spec 的 T1–T13 等价用例
4. 原生实现修复 001 的已知限制：cursor 拿到 `.mdc` 正确渲染的 rules
5. 001 遗留物清理：`/usr/local/bin/teamai-get` 与 `scripts/teamai-get` 移除，`teamai-ops` skill 改为引用原生命令

## 非目标

- 不向上游 Tencent/teamai-cli 提 PR / issue（如需另行授权）
- 不改动 wiki 的内容级合并；`.wiki/` 仍为独立目录约定
- 不做 `put`（反向推送到团队仓）——如需要另立 003

## 决策追加（需求方，2026-09-17）

1. **docs 必须与项目绑定**：project scope 下 docs 默认落 `<projectRoot>/docs`（推翻官方默认 `~/.teamai/docs` 及其 no-op 上传语义）
2. **推翻官方 docs no-op**：`DocsHandler.scanLocalForPush` 改为扫描本地 docs 目录相对团队仓克隆的差异 → `teamai push` 可为 docs 开 MR（上传方向打通）
3. **wiki 为一等资源**：新增 `WikiHandler`（`ResourceType` 增加 `'wiki'`）——push 自动扫描 `<projectRoot>/.wiki/`、pull 自动整库镜像，`teamai get wiki` 提供单页/整库/diff 精细操作

## 已知开放问题

1. 子命令名定为 `get`（与 git 习惯一致）；备选 `pull --select`。默认 `get`，Design 阶段可复核
2. 拉取前是否自动 ff-update 本地克隆：默认**不刷新**（离线语义，与 001 一致），提供 `--refresh` 选项调用既有 `pullRepo`
