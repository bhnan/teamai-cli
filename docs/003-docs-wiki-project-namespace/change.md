# Change Log — 003-docs-wiki-project-namespace

基线：plan.md Status: completed（2026-09-18）。以下为完成后的需求方确认调整，
逐条记录意图、行为差异、实施与验证；已接受的条目构成本需求的修订基线。

## C1 — teamai-ops skill 同步 003 命名空间语义（2026-09-18）

- **触发**：需求方指出 003 新的 docs/wiki 处理逻辑未更新到 `teamai-ops` skill。
  查证确认两处缺口：① 003 P7 文档清单遗漏该 skill；② 002 的 `teamai get`
  原生命令措辞也从未同步到团队仓副本（`~/.dsh/skills/` 在 push 扫描面之外，
  002 的本地修改无法被 `teamai push` 察觉）。
- **行为差异**（skill 内容层，CLI 无改动）：
  - 新增「docs / wiki 项目命名空间（003）」章节：路径即归属布局
    （`docs/<pid>/`、`.wiki/<wiki-id>/` 共享、`.wiki/<pid>/<wiki-id>/` 项目私有
    多 Wiki）、同步范围 = 共享根 + 激活项目、去激活清理数据安全护栏、
    第一层 project id 保留词
  - 命令映射/单资源拉取补命名空间路径（`<pid>/…`、`<pid>/<wiki-id>/<page>`）、
    歧义列候选、镜像/diff/prune 范围
  - 操作细节补：push 跳过去激活命名空间；pull 报告清理项
- **实施**：
  - 本机 `~/.dsh/skills/teamai-ops/SKILL.md` 更新（DSH 直接生效）
  - 团队仓 `skills/teamai-ops/SKILL.md` 经分支
    `teamai/update-teamai-ops-skill` 开 MR（bhnan/TeamAi--Resource PR #12）
- **验证**：skill 逐条对照 003 E2E 已验证的 CLI 行为（pull 清理 + dry-run
  报告、get 前缀解析/歧义、push 扫描过滤）；合并后本机与团队仓副本一致
  （`diff` 通过）。
- **状态**：已实施并合并（PR #12 merged 2026-09-18；桥接条目补录见 C2 后续与 PR #14，已合并）。

## C2 — wiki 桥接目录：`.<name>wiki/` 自动接入 push/pull（2026-09-18）

- **触发**：需求方在 trading 项目把 `.devwiki/`（工具维护的开发知识库）手工
  归置到团队仓 `.wiki/trading/devwiki/` 后指出：`.devwiki` 的后续更新无法自动
  push（push 扫描面只有 `.wiki/`）。需求方确认设计：**项目根下所有
  `.<name>wiki/` 目录都按 `.wiki/` 的最基础逻辑处理——本质上就是
  `.wiki/<project>/<name>wiki/`**（目录名即集合 id，零配置，不限定 devwiki）。
- **行为差异**（CLI）：
  - **发现**：project scope + 恰好一个激活且已定义的项目时，项目根下形如
    `.<name>wiki/` 的目录（`.wiki` 本身除外，集合 id 过安全段校验）成为该项目
    私有集合的本地 home；0 个或 ≥2 个激活项目 → 桥接不生效（警告）
  - **push**：桥接目录逐文件 diff（只收 `.md`、跳点段——`config.json`、
    `.state/` 等天然排除）→ MR 项路径带完整前缀 `.wiki/<pid>/<name>wiki/<rel>`
  - **pull**：团队仓 `.wiki/<pid>/<name>wiki/` 镜像回桥接目录（覆盖同名、
    保留本地独有）；桥接集合不再重复镜像到本地 `.wiki/<pid>/` 下
    （单一本地 home，防双源冲突），`.wiki/` push 扫描同样跳过它们
  - **get**：`get wiki` 镜像/`--diff`/单页对桥接集合路由到 `.<name>wiki/`
  - 单向性说明：桥接是双向镜像（与 `.wiki` 同逻辑），但源目录通常由工具生成
    ——工具重新生成即覆盖，属预期
- **实施**：`src/types.ts`（ResourceItem.localDir 覆盖）、
  `src/resources/wiki.ts`（listBridges/发现 + push/pull/计数桥接感知）、
  `src/get-cmd.ts`（get wiki 镜像/diff/单页路由）；测试
  `wiki-namespace.test.ts` +8 桥接用例（含多桥并存、任意命名、
  非法集合 id `.my.wiki` 跳过、非 md/点文件过滤、`.wiki` 自身与非 wiki
  点目录不误伤、manifest 未定义项目时桥接失效）
- **边界补充**：桥接集合 id 比 manifest SAFE_ID 更严——禁止含点
  （`.my.wiki` 会在 `.wiki/<pid>/` 下产生嵌套路径歧义），实现于
  `listBridges` 候选过滤
- **验证**：typecheck ✓；全量 3393 tests（10 个既有失败与基线一致，零回归）；
  真实 CLI E2E（/tmp/e2e-003 夹具 trading 项目）：pull 后 `.devwiki/` 收到
  团队仓 12→2 页镜像且本地独有保留、`.wiki/<pid>/devwiki` 不重复落地；
  push 扫描列出 `trading/devwiki/*` 修改与新增项，与 `.wiki` 主源共存 ✓
- **状态**：已实施（分支 `feat/docs-wiki-project-namespace`）。
