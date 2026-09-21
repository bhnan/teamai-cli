# Plan — wiki/docs 对齐 teamwiki 模式：纯 Git 原生管理（004）

Status: draft（待需求方批准 spec 后实施）

## 实现步骤

### P0 基线确认
- [ ] 复核 003/C2 相关代码现状（docs/wiki handler、pull/push 注册点、桥接逻辑）
- [ ] 存量镜像清单确认（/root/teamai-cli/.wiki/、docs/teamai-cli/；trading 侧不归 teamai 管）

### P1 pull 侧退役
- [ ] `src/pull.ts`：默认 `resourceTypes` 移除 `docs`/`wiki`；删除 docs/wiki 分支与 Step-3 命名空间清理挂钩
- [ ] 确认 git ff 步骤不受影响（克隆内容更新机制保留）

### P2 push 侧退役
- [ ] `src/push.ts`：`pushableTypes` 移除 `docs`/`wiki`

### P3 handler 简化
- [ ] `src/resources/docs.ts`：删除 pull/push/清理/countBundleFiles；保留 `resolveDocsLocalDir`、`countDocFiles`
- [ ] `src/resources/wiki.ts`：删除桥接（listBridges 等）与 pull/push 逻辑；保留 `localWikiDir` 等 get/status 需要的方法
- [ ] `src/resources/namespace-utils.ts`：按引用情况删除或瘦身
- [ ] `src/types.ts`：移除 `ResourceItem.localDir`
- [ ] `src/resources/index.ts`：注册表核对

### P4 测试重写
- [ ] `docs-namespace.test.ts` / `wiki-namespace.test.ts`：改为 get/list/status 语义用例
- [ ] `docs.test.ts` 及 pull/push 相关用例同步
- [ ] 全量回归（基线 10 个既有失败不变）

### P5 存量镜像清理
- [ ] 删除 `/root/teamai-cli/.wiki/`、`docs/teamai-cli/`（历史残留，pull 不再生成）
- [ ] `.gitignore` 按需补条目（可选）

### P6 文档与 skill 同步
- [ ] `usage-guide.md` / `usage-guide.zh-CN.md`：pull/push 语义、wiki/docs 章节重写为 git 原生模式
- [ ] `teamai-ops` skill：发布方式改为「团队仓克隆内编辑 + git commit/push」描述（同步到本机 DSH 副本 + 团队仓 MR）
- [ ] 本目录三件套随分支提交

### P7 E2E（真实 CLI）
- [ ] 克隆内编辑 → git push → 他端 pull（git ff）→ recall 命中
- [ ] pull 后项目根零新增 docs/wiki 目录
- [ ] push 不再列 docs/wiki；get/status 正常

## 测试策略
- vitest：handler 语义用例 + 全量回归
- E2E：本地夹具团队仓 + 真实 CLI（build 产物）

## 风险与回滚
- recall 对克隆 docs/ 的索引需确认（docs/<pid>/ 内容可检索是消费端闭环的关键）
- get 的落点语义保持显式（用户主动），不自动
- 分支可整体回退（feature 分支，未触碰 main）
