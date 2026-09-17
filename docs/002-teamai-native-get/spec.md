# Spec — teamai 原生 `get` 子命令（teamai-cli 内实现）

Status: draft（随 plan 一并获批后实施）

## 命令接口

```text
teamai get list [type]
teamai get <type> [name] [tool] [options]

  type:  skills | rules | docs | wiki        # 与 001 spec 语义一致
  name:  资源名（wiki 省略 = 整库镜像）
  tool:  claude|dsh|codex|cursor|...（目标工具 id，同 toolPaths 键；省略 = scope 内全部已装工具）

Options:
  --all      docs 整目录镜像
  --diff     wiki 差异预览（不写入）
  --prune    镜像删除目标端多余文件
  --force    单条覆盖已存在副本
  --refresh  拉取前先 ff-update 本地团队仓克隆（缺省不联网，用现有克隆）
  --scope    继承全局 scope 约定（project/user），经 scopedToolPaths 解析目标
```

## 与 001 spec 的关系

行为语义**继承** `docs/001-teamai-single-pull/spec.md`（四种 type、单条/镜像、`--force` 覆盖保护、镜像保留本地多余、list 发现、报错内置 list），差异与扩展：

| 项 | 001（脚本） | 002（原生） |
|---|---|---|
| rules 渲染 | 裸拷贝 `.md` | 经 `ruleFileExtensionForTool` / rule-format 渲染为各工具原生格式（cursor 得到合法 `.mdc`） |
| 目标路径 | 脚本内硬编码映射 | `scopedToolPaths`（scope 感知，user/project 皆可） |
| skills namespaces | 简单目录探测 | 全 namespace 探测；**显式点名不做角色过滤**（用户显式指定资源时不应被角色屏蔽，与 001 行为一致；评审 Y5 修订） |
| docs 落点 | 硬编码 `./docs/` | **项目绑定**：默认落 `<projectRoot>/docs`（fork 修改官方默认，见下） |
| docs / wiki 上传 | 无 | **新增上传方向**：docs 与 wiki 的本地变更可经 `teamai push` 开 MR |
| 克隆新鲜度 | 永不联网 | 默认不联网；`--refresh` 走 `utils/git.pullRepo` |
| wiki 源 | 团队仓 `.wiki/` | 同左（`.wiki/` 为本团队自定义约定，与 `teamwiki/` codebase 图谱无关） |

## docs 与 wiki 的项目绑定与上传（本次核心扩展）

### docs 项目绑定（推翻官方默认）

- **默认落点**：`sharing.docs.localDir` 默认值由 `~/.teamai/docs` 改为 `~/docs`——project scope 下经既有 `~/` 前缀重根机制解析为 `<projectRoot>/docs`；user scope 落 `~/docs`
- **上传（推翻 no-op）**：`DocsHandler.scanLocalForPush` 改为扫描解析后的本地 docs 目录，与克隆 `docs/` 逐文件对比，**仅返回新增/内容有差异的文件**（per-file `ResourceItem`，`name` = 相对路径）；`pushItem` 把单个文件复制进克隆 `docs/<rel>`——随后走官方 push 管线（分支 + MR）
- **删除方向**：v1 不支持（官方 tombstone 机制后续再议）；在 `--help` 与文档中明示
- **双向镜像歧义缓解**：pull 侧仍为整体覆盖（官方语义不变）；push 侧仅呈现「与克隆有差异」的文件并经人工确认，与官方 push 交互一致

### wiki 一等资源（WikiHandler）

- `src/resources/wiki.ts` 新增 `WikiHandler extends ResourceHandler`，`type = 'wiki'`；注册进 `src/resources/index.ts`
- `src/types.ts`：`ResourceType` 联合类型追加 `'wiki'`；remove/status 等遍历注册表的命令自动获得 wiki（逐一核对）
- 源/目标：`<projectRoot>/.wiki/` ↔ 克隆 `.wiki/`（user scope 下为 `~/.wiki/`）
- `pullItem`：整库镜像（同名覆盖、**默认保留本地多余**）；`teamai pull` 每次会话自动执行
- `scanLocalForPush`：逐页 diff，仅返回新增/有差异页；`pushItem`：单页复制进克隆
- 删除方向 v1 不支持（同 docs）

### 多端同步（与 skills 同体验）

- **下行自动**：每台设备的每次 AI 会话由 SessionStart hook 自动 `teamai pull`——本 fork 下 docs 落 `<projectRoot>/docs`、wiki 镜像 `<projectRoot>/.wiki/`，与 skills 一样「会话一开就是最新的」，无需任何手动操作
- **上行走 MR**：本地改动 → `teamai push`（docs/wiki 经本次新增的扫描）→ MR → merge → 其余设备 pull 自动到达
- **删除语义（与 skills 的唯一差异，防误删）**：团队侧删除的文件在 pull 时**不会**自动删除本地副本（本地可能存有草稿）；确认要清理时用 `teamai get wiki --prune` / `get docs --all --prune` 显式执行
- **新设备接入**：安装 fork 构建版（`npm install -g github:bhnan/teamai-cli`，分支合入后）→ 项目内 `teamai init <团队仓>` → 首次会话即全量同步

## 代码触点（基于基线 6ed2515 勘察）

| 文件 | 动作 | 内容 |
|---|---|---|
| `src/get-cmd.ts` | 新增 | 命令实现：解析参数 → `requireInit`/`loadLocalConfigForScope` → 定位克隆 → 源解析 → 经 scopedToolPaths / 资源 Handler 写入 |
| `src/index.ts` | 修改 | 在 `pull` 注册块后按同款模式注册 `get [type] [name] [tool]`（懒加载 `import('./get-cmd.js')`） |
| `src/resources/wiki.ts` | 新增 | `WikiHandler`（pull 镜像 + push 扫描/单页写入） |
| `src/resources/docs.ts` | 修改 | 默认 localDir 项目绑定；`scanLocalForPush`/`pushItem` 实现上传 |
| `src/types.ts` | 修改 | `ResourceType` 加 `'wiki'`；docs localDir zod 默认值改 `~/docs` |
| `src/pull.ts` | 只读复用 | 导出 `scanRoleAwareSkills`、`buildRolePullContext` 供复用（如需导出调整，仅增不改） |
| `src/__tests__/get-cmd.test.ts` 等 | 新增 | vitest：临时夹具上验证源解析 / 目标选择 / 覆盖保护 / 组合校验 / 三类 Handler 行为 |

## 行为规则

沿用 001 spec 的行为规则 1–7（覆盖保护、镜像保留、diff 只读、多目标失败隔离、逐条 `✓` 输出、报错内置 list、与 pull 同步关系的提示），另加：

8. `--refresh` 失败（离线/冲突）→ 警告并继续使用现有克隆（不阻塞）
9. 未 init 时走 `requireInit` 既有报错（官方文案）
10. push 侧的 docs/wiki 差异上传由官方 `teamai push` 交互承担（确认清单、MR），`get` 自身不做上传

## 验收

1. `npm run typecheck`、`npm test`（含新增用例）通过，既有测试零回归
2. `npm run build` 产出 dist，源码安装后 `teamai get --help` 可用
3. E2E（真实团队仓 `/root/DeepTutor`）：list → 单 skill → 单 rule（cursor 渲染验证）→ docs 单条 + `--all` → wiki 单页 + 整库 + `--diff`
4. 上传 E2E：项目侧修改 `.wiki/` 一页 + `docs/` 一文件 → `teamai push` 出现对应差异项 → MR → merge → `teamai pull` 回来内容一致
5. 001 遗留清理完成（脚本移除、skill 引用改指向原生命令）
