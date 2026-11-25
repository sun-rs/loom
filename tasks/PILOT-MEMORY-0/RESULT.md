# PILOT-MEMORY-0 验收记录

## 设计与使用

- 每条事实保存在 `.project/memory/items/<id>.md`。首段为 `---` 包裹的单行 JSON，含 `id`、`scope`（`project`）、`owner`、`source`、`verified`，以及可选的 `expires`、`supersededBy`、`keywords`。后接一级标题、空行及正文。日期使用 UTC 日历日。原件使用相对路径或 Git 对象 SHA；日期和引用由写入接口校验。
- `memory/project.mjs` 提供 `writeMemory(project, { id, scope, owner, source, verified, title, body, ...optional })` 和 `syncMemoryIndex(project)`。写入校验原件及正文引用，并更新 `INDEX.md`。索引是可重建的有效条目快照；首轮注入和搜索重新读取条目并核验，因此索引过时也不会带入失效内容。目录沿用 daemon 为 `.project/` 设置的本地 Git 排除。
- Leader 和 Auditor 的启动提示优先给出项目章程、红线和裁决入口，再加入容纳得下的完整索引行。红线摘录最多 150 tokens，章程路径保留供查阅全文。搜索按标题或关键词进行不区分大小写的子串匹配，返回标题和条目路径，可按需打开正文。所有上限以 `lib/token-budget.mjs` 估计。
- CLI 支持 `memory search <query> [--project DIR] [--json]`，JSON 输出为包含 `id`、`title`、`path` 的数组。

## 文件与净增行数

| 文件 | 净增行数 |
| --- | ---: |
| `memory/project.mjs` | 117 |
| `cli/loom.mjs` | 10 |
| `daemon/sessions.mjs` | 5 |
| `memory/memory.test.mjs` | 57 |
| `cli/loom.test.mjs` | 23 |
| `daemon/supervisor.test.mjs` | 26 |
| 合计（产品 132，测试 106） | 238 |

## 受影响的测试

`node --test memory/memory.test.mjs cli/loom.test.mjs daemon/supervisor.test.mjs`

首次验收发现 macOS 临时目录需要规范化后再交给事实核验，已修正。长标题 fixture 同时计入了元信息预算，已缩短以单独测试搜索上限。

结果：35 项通过，2 项失败，0 项跳过。

两个既有 CLI 用例在绑定 Unix socket 时收到 `listen EPERM`，分别覆盖 worker admission 和显式 switch profile。使用 `TMPDIR=/private/tmp` 缩短路径仍出现同一限制。

FIX-1 补充 Loom skill 的格式、维护职责和查询入口。首轮注入复用同步索引生成的行，并新增断言校验索引剔除了来源失效的旧条目。`node --test memory/memory.test.mjs daemon/supervisor.test.mjs` 通过 28 项，失败和跳过均为 0。FIX-1 的 CLI 用例留给 Leader 在沙箱外验收。

FIX-2 将 `memory/` 纳入 release digest，并用临时发布目录验证修改 `memory/project.mjs` 会改变摘要。Loom skill 补齐字段、正文和写后搜索约束。CLI 测试恢复 `spawnSync(executable, args, ...)`，以覆盖现有可执行入口。

`node --test memory/memory.test.mjs daemon/supervisor.test.mjs` 通过 29 项，失败和跳过均为 0。相对 `1f529eca` 累计净增 256 行（不含 `tasks/`，产品 134 行，测试 122 行）。CLI 测试及全量 `npm test` 由 Leader 在沙箱外验收。
