---
{"id":"design-namespaces-isolation","type":"topic","title":"命名空间与隔离机制全景：上游投递模型 vs fork 004 Git 原生模型","aliases":["namespace-model","namespaces"],"status":"implemented","freshness":"fresh","verified_at":"2026-09-27","sources":[{"path":"docs/004-wiki-docs-git-native/spec.md","sha256":"7ddd2d76c6aeb5aed5c1e3055deee4d6dedfb23b4c75f805c0951bb6302f8d21"},{"path":"docs/004-wiki-docs-git-native/intent.md","sha256":"11dec63b363436369001b467aff012aadaa720ba7b7da03b30c8be1d5fc6ed78"},{"path":"docs/003-docs-wiki-project-namespace/spec.md","sha256":"087a5c156217e850380a0900bc0bd79b607daa4e75b784c592acdc8a7c33b6e6"}],"relations":[{"type":"describes","target":"requirement-004-git-native"},{"type":"related","target":"requirement-003-docs-wiki-namespaces"},{"type":"related","target":"design-multi-project"}]}
---

# 命名空间与隔离机制全景：上游投递模型 vs fork 004 Git 原生模型

> 2026-09-27 合并上游（84d8ba7，135 提交）时的考证结论。核心代码依据：
> `src/manifest-schema.ts`（轴与命名约束）、`src/resource-namespaces.ts`（激活集合）、
> `src/resources/docs.ts` 的 `resolveDesiredDocs`（路径切分）、`src/projects.ts`（manifest 装载）。

## 0. 一句话对比

| | 上游的 Docs | 我们的 Docs（004） |
|---|---|---|
| 本质 | **被投递的资源**：pull 把它镜像进本地目录 | **Git 原生上下文**：内容留在克隆里，要时自取 |
| pull | 搬运工（copy + prune + namespace 撤回） | 只做 git ff，**零落地** |
| localDir | 投递目的地（pull 持续维护） | 仅 `get docs` 的按需取回目标 |
| 隔离边界 | manifest 声明的投递集（管理员配） | **git 仓库访问权**，teamai 层零 ACL |

## 1. 身份约定：namespace 名 = 目录名（恒等，无例外）

**`docs/checkout/` 的 namespace 就是 `checkout`。** 代码即 `file.indexOf('/')`——第一段路径切出来就是名字，没有 alias、没有映射表、没有第二来源。

**资源轴 → 仓库根目录**（schema 层固定约定）：

| manifest 轴 | 仓库目录 | 备注 |
|---|---|---|
| `skills` | `skills/` | |
| `knowledge` | `rules/` ⚠️ | 唯一名字不同的（历史叫法） |
| `learnings` | `learnings/` | |
| `agents` | `agents/` | |
| `docs` | `docs/` | 保留字 `team-codebase`（大小写折叠） |
| （无独立轴） | `claudemd/` | 跟 knowledge 轴 |

命名约束的根因：**ns 就是路径段**——单段（无 `/ \ :` 控制字符）、非 Windows 设备名（`CON`/`COM1`…）、大小写折叠全局唯一（`frontend` vs `Frontend` 在 Win/macOS 是同一目录）。

**推理方式（四步）**：看到 `docs/checkout/guide.md` → ① 资源根 `docs/`；② ns = 第一段 `checkout`；③ 查 manifest 有无声明；④ 声明者是否激活于我。

## 2. manifest = 行为开关，不是身份登记（易混点）

| 问题 | 答案 | 由谁决定 |
|---|---|---|
| `docs/checkout/` 的 namespace 叫什么？ | **checkout**（恒等） | 目录名（约定） |
| 它按 namespace 规则对待吗？ | 看声明 | manifest（开关） |

- **未声明** → 共享投递，全员收到（`checkout` 退化为路径里一段普通目录名）
- **已声明** → 定向投递给激活者；失活时 pull 撤回未修改副本
- 两个静默坑（git/上游 doctor 都不查，005 的地盘）：**有目录没声明** = 泄密给全员；**有声明没目录** = 静默无内容

## 3. 三层装配：内容层 / 声明层 / 成员层

```
内容层   docs/<ns>/ …                （唯一真源：仓库目录）
           ▲
声明层   projects.yaml / roles.yaml  （谁激活哪些 ns：resources.<轴>: [ns…]）
           ▲
成员层   目录 config 的 projects 字段 + 角色  （我在哪些 project / 有哪些 role）
```

- **Project = 逻辑身份**（manifest 一条声明，不是仓库/目录），id 规则比 ns 严（字母数字 `. _ -`，要敲命令行）
- **上游激活轴 = role ∪ project**（宽，ns 名任意）；**fork 消费约定 = project only 且 ns ≡ pid**（`docs/<pid>/` 目录名就是项目 id）
- **多对多**：一个 project 可声明多个 ns（`docs: [a, b]`——上游完全合法；⚠️ fork 的 `get` 只认 ns≡pid，非 pid 名的 ns 会退化成共享目录，别这么写）
- 解析链：目录 projects → 各 project 的 `resources.docs` → 并集 = 激活集 → pull 投递这些 ns + 共享根

## 4. 投递行为映射（pull 后 ns 目录的四种命运）

| 资源 | 形态 | 例 |
|---|---|---|
| skills | 🏷️ **拍平** | `skills/<ns>/<skill>/` → `<tool>/skills/<skill>/`（同名替换根条目） |
| agents | 🏷️ **拍平** | `agents/<ns>/<name>.yaml` → `<tool>/agents/<name>.<工具扩展名>` |
| rules/claudemd | 🔄 **替换** | `rules/<ns>/<name>.md` → `rules/<name>.md` 位置（claudemd 为托管区块） |
| docs（上游） | 📁 **保留** | `docs/<ns>/x` → `<localDir>/<ns>/x`（目录结构原样） |
| learnings | 🏠 **不动** | 留在克隆，recall 去读 |

路径解析三层：scope→base（user=HOME，project=projectRoot）→ `toolPaths.<tool>` 相对拼接 → 特殊资源（docs 的 `~/` 重锚定）。

## 5. 上游 doctor 的 `Team docs delivered` 检查（已随合并移除）

- **出身**：PR #669（52525a9，2026-09-20）——分叉基座上连 `doctor-delivery.ts` 都不存在，整个投递检查家族（skills/rules/agents/MCP/env/docs）都是上游分叉后新建
- **目的**：防"幻影成功"——pull 声称 "Synced N docs" 时验收磁盘实况。四种失败模式：缺失（`isFile`，目录占名/断链算缺）、陈旧（prune 残留）、空目录残留、目标不可巡检；namespace 过滤与 pull/recall 同源
- **设计哲学**：检查走写入路径的**同一解析接缝**（"the write path and the check cannot answer differently"）
- **004 下移除的依据**：投递不存在 → 验收无指涉对象（烟雾测试证实每次 pull 误报 + 修复建议指向不存在的动作）。fork 的检查空间转移到 005：克隆健康、manifest↔仓库一致性、get 镜像卫生

## 6. 用户视角要点（反复确认过的心智模型）

1. **ns 名 = 目录名**，永远成立；manifest 只是行为开关
2. **namespace 按受众切，不按文档类型切**——想分类用普通子目录（反正共享）；想限受众才上 ns
3. **不按人划分**：没有"张三的目录"；作者**没有**可见性决定权——上游=管理员 manifest，我们=git 仓库访问权
4. **两代模型都做了项目区分**：差别在轴宽（role∪project vs project-only）和作用面（投递过滤 vs 检索视线）
5. **真"秘密"走 git 层**（独立私有仓/分支），teamai 两代都不做 per-author ACL
6. 设计实操：受众相同 → 一个 ns；受众不同 → 按受众拆 ns；声明与文档同一 PR 提交

## 7. fork（004）落地语义

- pull：skills/rules/env/agents 照旧；docs/wiki **零落地**；`get docs --all` 时 `defined`（项目 id 集）决定哪些一级目录算 ns 目录；`get wiki` → `<projectRoot>/.wiki/`
- wiki 仓库结构双层：`.wiki/<pid>/<wiki-id>/`
- 消费：recall 索引本地克隆（跨项目）+ `get` 显式按需（显式路径不受激活集限制，Y5 规则）

## Sources

- [004 intent](../../docs/004-wiki-docs-git-native/intent.md) · [004 spec](../../docs/004-wiki-docs-git-native/spec.md) · [003 spec](../../docs/003-docs-wiki-project-namespace/spec.md)
- 代码：`src/manifest-schema.ts` · `src/resource-namespaces.ts` · `src/resources/docs.ts`（resolveDesiredDocs）· `src/projects.ts`
