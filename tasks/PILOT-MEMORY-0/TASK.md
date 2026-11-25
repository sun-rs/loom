# 任务卡 PILOT-MEMORY-0

## 目标与验收

- 交付目标：按 `tasks/MEMORY-0/docs/MEMORY.md` 的“项目”范围实现**记忆 v0（仅项目层）**：
  1. `.project/memory/{INDEX.md,items/<id>.md}` 读写约定：
     - 每条事实存为 `.project/memory/items/<id>.md`（单条 ≤200 tokens，复用 `lib/token-budget.mjs`），含结构化元信息（稳定 ID、scope=`project`、责任角色 `owner`、原件 `source`/引用路径或 SHA、核对日期 `verified`，可选到期日 `expires`、替代 ID `supersededBy`）。
     - `.project/memory/INDEX.md` 每条一行（可重建/同步维护），沿用 `.project/` 本地 Git 排除约定。
  2. 首轮注入：在 `daemon/sessions.mjs` 创建 `leader` 或 `auditor` 会话（`newJob`）时，若项目存在有效项目记忆，按 ≤400 tokens（复用 `lib/token-budget.mjs`）注入适用的索引片段（加载适用红线/章程/裁决入口及有效记忆索引行，跳过核对失败、已过期或已被替代的条目）。
  3. `loom memory search <query>` CLI 子命令（在 `cli/loom.mjs` 注册，逻辑放 `memory/` 与/或 `cli/memory.mjs`）：
     - 支持 `--project DIR`、`--json`（及可选写入/同步辅助命令，保持极简）。
     - 按标题/关键词匹配，返回最多 5 条、合计 ≤500 tokens（复用 `lib/token-budget.mjs`）。
  4. 核验与淘汰：
     - 写入、首轮注入与搜索前，复用 `evidence/facts.mjs` 的 `checkFacts` 核验条目引用的路径与 SHA。
     - 核对失败（存在 `misses`）、已过期（`expires` 早于当前日期）或已标注 `supersededBy` 的条目，自动退出首轮注入与默认搜索。
  5. **明确不做**：不做 Super 层、不做问答史检索、不做向量库、不做自动摘要；不改 `loomd` 投递保证与协议语义。
- 验收标准：
  - 新增单元测试覆盖：读写 `.project/memory/{INDEX.md,items/<id>.md}`、单条 ≤200 token 约束、`checkFacts` 核验失败退出注入与默认搜索、过期/被替代条目退出注入与默认搜索、`loom memory search` 最多 5 条且合计 ≤500 tokens、`leader`/`auditor` 首轮注入 ≤400 tokens（`worker` 不注入项目记忆索引）。
  - 受影响的测试全绿。
- 受影响的测试：`node --test memory/memory.test.mjs cli/loom.test.mjs daemon/supervisor.test.mjs`（只跑受影响的测试）。
- 制品与原始证据：`tasks/PILOT-MEMORY-0/RESULT.md`（记录设计要点、文件清单、净行数与测试结果）。

## 施工边界

- 工作目录：`/Users/sun/Code/loom-pilot/.worktrees/pilot-memory-0`
- 基线：`pilot-1` (`1f529eca`)，当前分支 `wt/pilot-memory-0`
- 可写范围：`memory/`（新建）、`cli/memory.mjs`（如需）、`cli/loom.mjs`、`daemon/sessions.mjs`、`daemon/supervisor.test.mjs`、`cli/loom.test.mjs`、`tasks/PILOT-MEMORY-0/`
- 红线：
  - 不读任何凭据（`~/.codex/auth.json`、`~/.codex/memories*`、Claude 凭据、agy token、`~/.loom-next/provider-homes`、`.env`、OpenCode 配置/key）。
  - 若需调用 `loom`，一律使用绝对路径 `/Users/sun/.loom-cell/current/bin/loom`，严禁使用 PATH 中的 `loom`；CLI 只用绝对路径不经 PATH。
  - 不改 `loomd` 投递保证与协议语义；不修改 `pilot-1`、`main` 或可写范围之外的文件；不 push；不碰 Solars、CCP、t17*、t4c、t13n。
  - Node ESM 零新增外部依赖。
- 提交权限：允许在当前分支 `wt/pilot-memory-0` 上提交干净的 commit。
- 净行数预算上限：320 行（产品代码 + 测试代码净增行数，不含 `tasks/PILOT-MEMORY-0/`）。
- 测试行数 ≤ 产品行数。

## 停工

预算已超或下一步将超、事实与卡面不符、发现设计缺口，任一出现就立即停工并报 `BLOCKED`，写明需要的裁决。

## 三行最终回复

禁止另发消息，结束时只回三行：

```text
DONE|BLOCKED|FAILED PILOT-MEMORY-0
<一句交付结论或待裁决事项，可附制品路径>
Leftovers & deviations: none|<具体遗留、偏离或未验证项>
```
