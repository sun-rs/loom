# 任务卡 PILOT-MEMORY-0-FIX1（Auditor 复核必补项）

## 目标与验收

- 交付目标：按 Auditor 复核结论，在现有 `wt/pilot-memory-0`（基线 `65d3edcf`）上补齐 3 项最小修复：
  1. 更新 `skills/loom/SKILL.md`：简要写明项目层记忆 `.project/memory/{INDEX.md,items/<id>.md}` 的条目格式（`---` 包裹的单行 JSON 含 `id/scope/owner/source/verified` 及可选 `expires/supersededBy/keywords`，接 `# 标题`、空行和正文，单条 ≤200 tokens）、维护责任（Leader 写入已证实的坑/环境条件/入口，Auditor 裁决争议）及 `loom memory search` 查询入口。
  2. 在真实路径上自动重建 `INDEX.md`：在 `memory/project.mjs` 的 `projectMemoryPrompt(project)`（首轮注入）中调用 `syncMemoryIndex(project)`（或写入同步后的索引，注意避免重复扫描或保持简洁），确保真实运行中 `.project/memory/INDEX.md` 会被生成/更新。
  3. 补 1 个对应测试断言（在 `memory/memory.test.mjs` 或 `daemon/supervisor.test.mjs`）：验证通过 `projectMemoryPrompt` / 首轮注入的真实路径会生成/重建 `.project/memory/INDEX.md`。
- 验收标准：
  - `node --test memory/memory.test.mjs daemon/supervisor.test.mjs` 全绿（注：`cli/loom.test.mjs` 含 Unix socket 测试，在 worker 沙箱会 `listen EPERM`，**不要**在沙箱内跑 `cli/loom.test.mjs`，由 Leader 在沙箱外验收）。
  - 总净增行数（相对 `pilot-1` `1f529eca`）保持 ≤ 320 行（当前 238 行，本补丁预算 ≤ 60 行），且测试行数 ≤ 产品行数。
- 受影响的测试：`node --test memory/memory.test.mjs daemon/supervisor.test.mjs`
- 制品与原始证据：更新 `tasks/PILOT-MEMORY-0/RESULT.md` 补充本次修复与测试结果。

## 施工边界

- 工作目录：`/Users/sun/Code/loom-pilot/.worktrees/pilot-memory-0`
- 基线：`wt/pilot-memory-0` (`65d3edcf`)
- 可写范围：`skills/loom/SKILL.md`、`memory/project.mjs`、`memory/memory.test.mjs`、`daemon/supervisor.test.mjs`、`tasks/PILOT-MEMORY-0/`
- 红线：
  - 不读任何凭据；若调用 `loom` 一律用 `/Users/sun/.loom-cell/current/bin/loom`，严禁使用 PATH 中的 `loom`。
  - 不改 `pilot-1` 或 `main`；不 push；不碰可写范围外文件。
- 提交权限：允许在 `wt/pilot-memory-0` 上提交 1 个干净的 commit。
- 净行数预算上限：本补丁 ≤ 60 行（相对 `1f529eca` 累计 ≤ 320 行），测试行数 ≤ 产品行数。

## 停工

预算已超或下一步将超、事实与卡面不符、发现设计缺口，任一出现就立即停工并报 `BLOCKED`。

## 三行最终回复

禁止另发消息，结束时只回三行：

```text
DONE|BLOCKED|FAILED PILOT-MEMORY-0-FIX1
<一句交付结论或待裁决事项，可附制品路径>
Leftovers & deviations: none|<具体遗留、偏离或未验证项>
```
