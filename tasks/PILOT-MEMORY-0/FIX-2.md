# 任务卡 PILOT-MEMORY-0-FIX2（Auditor 第 1 轮复核阻断项修复）

## 目标与验收

- 交付目标：按 Auditor 对 `1bf07249` 的第 1 轮复核结论，在 `wt/pilot-memory-0`（基线 `1bf07249`）上完成以下 3 项精准修复：
  1. **`daemon/release.mjs` 补齐 `memory` 目录并加断言**：
     - 在 `daemon/release.mjs` 的 `source` 数组中加入 `'memory'`。
     - 在 `memory/memory.test.mjs` 中补 1 个断言：验证 `releaseDigest` 覆盖 `memory/` 目录（改动 `memory/` 内容会导致 `releaseDigest` 变化）。
  2. **更新 `skills/loom/SKILL.md` 补全项目记忆字段约束**（只改文档，不改事实检查器）：
     - `id` 与 `owner` 须用小写字母、数字和 `-`/`_`；
     - 日期（`verified`/`expires`）用 `YYYY-MM-DD`；
     - `source` 用项目内相对路径或 Git SHA；
     - `keywords` 是单个字符串（非数组）；
     - 标题与正文避免计数斜杠写法（如 `37/37`）和项目外路径；
     - 写完后用 `loom memory search` 确认条目可查到。
  3. **还原 `cli/loom.test.mjs` 中既有 `cli` 启动方式**：
     - 将 `cli/loom.test.mjs` 中的 `spawnSync(process.execPath, [executable, ...args], ...)` 还原为原样 `spawnSync(executable, args, ...)`，并在 `tasks/PILOT-MEMORY-0/RESULT.md` 简要记录本次修复。
- 验收标准：
  - `node --test memory/memory.test.mjs daemon/supervisor.test.mjs` 全绿（`cli/loom.test.mjs` 及全量 `npm test` 由 Leader 在沙箱外执行，**不要**在沙箱内跑 `cli/loom.test.mjs` 或 `npm test`）。
  - 累计净增行数（相对 `pilot-1` `1f529eca`，不含 `tasks/`）保持 ≤ 320 行（当前 239 行），且测试行数 ≤ 产品行数。
- 受影响的测试：`node --test memory/memory.test.mjs daemon/supervisor.test.mjs`
- 制品与原始证据：更新 `tasks/PILOT-MEMORY-0/RESULT.md`。

## 施工边界

- 工作目录：`/Users/sun/Code/loom-pilot/.worktrees/pilot-memory-0`
- 基线：`wt/pilot-memory-0` (`1bf07249`)
- 可写范围：`daemon/release.mjs`、`skills/loom/SKILL.md`、`memory/memory.test.mjs`、`cli/loom.test.mjs`、`tasks/PILOT-MEMORY-0/`
- 红线：
  - 不改事实检查器（`evidence/facts.mjs`）；不读任何凭据；若调用 `loom` 一律用 `/Users/sun/.loom-cell/current/bin/loom`。
  - 不改 `pilot-1` 或 `main`；不 push；若沙箱拒绝 `git commit`（`index.lock` 权限限制），保留工作区改动并立即报 `BLOCKED` 由 Leader 在沙箱外验收集成并提交，不要反复重试。
- 提交权限：允许在 `wt/pilot-memory-0` 提交（受沙箱限制时留给 Leader）。
- 净行数预算上限：本补丁 ≤ 40 行（相对 `1f529eca` 累计 ≤ 320 行），测试行数 ≤ 产品行数。

## 停工

预算已超或下一步将超、事实与卡面不符、发现设计缺口、或遇沙箱阻断，立即停工并报 `BLOCKED`。

## 三行最终回复

禁止另发消息，结束时只回三行：

```text
DONE|BLOCKED|FAILED PILOT-MEMORY-0-FIX2
<一句交付结论或待裁决事项，可附制品路径>
Leftovers & deviations: none|<具体遗留、偏离或未验证项>
```
