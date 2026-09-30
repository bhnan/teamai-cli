# Wiki schema

- 页面类型：`topic`（主题页，存于 `topics/`）
- 源：`docs/**`（.md）
- 关系类型：`related` / `describes` / `depends_on` / `implements` / `verified_by` / `supersedes`
- 状态：proposed / accepted / implemented / released / superseded / unknown
- 新鲜度：fresh / stale / unknown（由源哈希重算）

页面用 JSON frontmatter 声明 id/type/sources(含 sha256)/relations。
