# Plan — 团队仓 Wiki 的检索与原文引用（006）

Status: draft（等待需求方对 intent/spec 的开放问题确认；确认后开工）

基线：`v0.26.0-beta.5`（上游最新 tag，需求方指定）
工作区：worktree `.worktrees/feat-wiki-source-map`，分支 `feat/wiki-source-path-mapping`

## P0 基线对齐（需求方前置要求）

- [x] `git fetch upstream --tags`：确认上游最新为 `v0.26.0-beta.5`
      （2026-09-28，`upstream/main` = `5fb316c`）
- [x] 从该 tag 建 worktree 与特性分支（未直接改主工作目录）
- [x] 复核基线现状：`sharing` 无 wiki 段；`src/recall.ts` 的 `.wiki/` 仅输出
      `File:`/`Sources:` 纯文本；`.wiki/` 不在召回索引内
- [ ] **待确认**：新基线是否带上 fork 线的 003/004 语义与 `get` 命令
      （`v0.26.0-beta.5` 无 `src/get-cmd.ts`；fork 的 7 个提交仍留在
      `feat/get-command` 与 `v0.23.0-bhnan.0` 上）
- [ ] 装依赖并确认工具链：`npm ci`（worktree 无 `node_modules`）+
      `npx tsc --noEmit` 基线绿灯
- [ ] 确认基线全量单测基线（记录既有失败数，作为零回归对照）

## P1 需求文档（本阶段产出）

- [x] `docs/006-wiki-source-citation-mapping/intent.md`
- [x] `docs/006-wiki-source-citation-mapping/spec.md`
- [x] `docs/006-wiki-source-citation-mapping/plan.md`（本文件）
- [ ] 需求方确认 intent/spec 的 9.1–9.3 开放问题 → 依确认结果修订 spec
- [ ] 获批后进入 P2（在此之前不改实现代码）

## P2 实现（待 P1 关闭）

### P2-1 配置模型

- [ ] `src/types.ts`：`SharingConfigSchema` 新增可选 `wiki`
      （`sources: [{ id, allow?, map?: [{ from, to }] }]`），沿用
      `hooks`/`mcp`/`coAuthor` 的「可选而非 default」惯例，保证既有
      `teamai.yaml` 字面量继续合法
- [ ] 提供 defaulted 读取视图（同 `getHooksSharing` 形态），供 recall 消费
- [ ] **待定（奥卡姆）**：`allow` 是否保留——若不打算真正放宽/收窄范围，
      按「拒绝过度设计」应删除该字段，硬编码 `docs/<pid>/`

### P2-2 锚点解析与校验（核心，纯函数 + 只读 IO）

- [ ] 新模块（建议 `src/utils/wiki-source-anchor.ts`，与 `recall-quality.ts`
      同级的单职责工具模块）：
  - `resolveAnchorPath(anchorPath, pagePath, map, pid)` → 克隆内相对路径
    （显式 `map` 优先 → 默认「项目根相对 → `docs/<pid>/`」→ 页面相对形态
    先归一化再套默认规则 → 无命中 `unmapped`）
  - `verifyAnchor(...)` → `{ status, resolved?, sha256?, reason? }`，
    实现 spec §4 的四条判定与封闭状态枚举
  - 允许范围判定按**真实路径**（`realpath`）比较，拒绝符号链接逃逸
- [ ] 复用而非重造：`sanitizeSources`（URL/目录过滤）与
      `extractSourceDescriptions`（`src/code-knowledge-recall.ts`）保持不动，
      新逻辑只做「锚点 → 可引用路径」这一段
- [ ] 安全边界：路径归一化后必须仍落在允许子树内（`..` 逃逸 →
      `out_of_scope`）；不读允许范围外的文件

### P2-3 接入输出

- [ ] `src/recall.ts`：在 `formatResults` 的 `Sources:` 段落输出 spec §5 的
      逐条状态（`path`/`status`/`resolved`/`sha256`/`reason`）
- [ ] 未配置 `sharing.wiki` 时**完全不激活**（输出与基线逐字节一致）
- [ ] **待确认（spec 9.1）**：Agent 如何拿到 Wiki 位置/页面——决定是否需要
      扩展现有命令输出（不新增命令）
- [ ] **待确认（spec 9.3）**：是否需要 `--json`

### P2-4 测试

- [ ] 单测：映射规则（显式覆盖/默认两种形态/无命中）× 四条判定 ×
      全部状态枚举（`verified`/`missing`/`ambiguous`/`out_of_scope`/
      `content_changed`/`unmapped`/`unverifiable`）
- [ ] 单测：边界表（无 `sha256`、非法 sha256 格式、符号链接、`..` 逃逸、
      URL/目录锚点、目标为目录、多候选同名）
- [ ] 单测：未配置 wiki 时 `formatResults` 输出与基线一致（快照）
- [ ] E2E（真实 CLI，夹具团队仓）：按 spec §8 的 1–4 条跑通

### P2-5 文档与 skill 同步

- [ ] `docs/usage-guide.md` + `docs/usage-guide.zh-CN.md`：新增「Wiki 引用
      校验」章节（配置形态 + 状态枚举 + 失败含义）
- [ ] 受影响的 `skill-data/`（若 Agent 使用方式变化）；grep 旧措辞
- [ ] 若命令/flag 有改动：`npx vitest run commands-reference -u` 重新生成
      `skill-data/core/references/commands.md`

## 测试策略

- **单测**：四条判定与状态枚举全覆盖（纯函数易穷举），含失败分支与边界表。
- **E2E**：真实夹具团队仓（`.wiki/<pid>/docs-wiki/` + `docs/<pid>/`），
  用 build 产物跑真实 CLI，验证可引用路径可被打开且哈希一致；改一位后
  状态翻转。
- **零回归**：全量单测与基线对照；未配置时输出快照比对。

## 风险与回滚

| 风险 | 应对 |
|---|---|
| 团队仓 `.wiki/` 布局不规范（目录名含点、多 pid 同名） | 按 003 既有的集合 id 安全段校验拒绝非法目录；同名给出候选要求消歧 |
| 锚点把引用指向仓库任意文件（读越界） | 允许范围硬边界 + 真实路径判定（spec §2.3/§6） |
| 克隆落后远端导致大面积 `content_changed` | 如实报状态并提示 `teamai pull`；不静默引用（这正是本需求要防的引用错误） |
| 配置字段过度设计（`allow`） | 如无真实放宽需求则删除，只留 `id` + `map` |
| 校验在大仓库上的耗时 | 只对输出中出现的锚点做校验（≤ 输出条数 × 锚点数），不做全仓扫描 |
| 基线切换带来的差异 | 特性分支独立，未触碰 `main`；可整体回退 |

## 未决（阻塞 Build 的开放问题）

1. 检索入口形态：位置如何交给 Agent（spec 9.1）
2. 新基线是否带上 fork 的 003/004 语义与 `get` 命令（spec 9.2、P0）
3. 是否需要 `--json` 机器可读通道（spec 9.3）
