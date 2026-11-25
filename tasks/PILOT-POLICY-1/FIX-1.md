# 任务卡 PILOT-POLICY-1-FIX1（按 R10 与 Auditor 第 1 轮复核补齐全部 5 角色双厂商）

## 目标与验收

- 交付目标：按 Super 裁决 R10 第 2 点及 Auditor 对 `b2fdaffb` 的复核要求，在 `wt/pilot-policy-1`（基线 `b2fdaffb`）上完成以下精准修改：
  1. 修改 `examples/policy.json`：
     - `roles.reviewer.preferred`：保留现有 `codex` 第一顺位，新增第二顺位非 `codex` 候选（如 `{ "cli": "agy", "model": "gemini-4-neon", "effort": "high", "mode": "headless" }`）。
     - `roles.worker.preferred`：保留现有 `codex` 两档（`medium` 为第一顺位、`xhigh` 保留），新增一家非 `codex` 候选（如 `{ "cli": "agy", "model": "gemini-4-neon", "effort": "medium", "mode": "headless" }`）。
     - 不改任何产品代码（`preferred-fallback` 已支持第一顺位不可用才落第二家并告警）。
  2. 修改 `cli/loom.test.mjs`：
     - 将双厂商断言改为覆盖全部五个角色（`super`、`leader`、`auditor`、`reviewer`、`worker` 每个角色的 `preferred` 均包含至少 2 家不同 `cli` 厂商，即 `>= 2`）。
  3. 更新 `tasks/PILOT-POLICY-1/RESULT.md` 记录本次按 R10 扩充的结果。
- 验收标准：
  - `node -e "JSON.parse(require('fs').readFileSync('examples/policy.json','utf8'))"` 与 `git diff --check` 通过。
  - **注意**：`cli/loom.test.mjs` 含 Unix socket 测试，在 worker 沙箱会 `listen EPERM`，且沙箱禁止写 `git index.lock`；因此**不要**在沙箱内跑 `cli/loom.test.mjs` 或 `git commit`，由 Leader 在沙箱外执行 `node --test cli/loom.test.mjs` 验收并提交。
- 受影响的测试：Leader 在沙箱外执行 `node --test cli/loom.test.mjs`。
- 制品与原始证据：更新 `tasks/PILOT-POLICY-1/RESULT.md`。

## 施工边界

- 工作目录：`/Users/sun/Code/loom-pilot/.worktrees/pilot-policy-1`
- 基线：`wt/pilot-policy-1` (`b2fdaffb`)
- 可写范围：`examples/policy.json`、`cli/loom.test.mjs`、`tasks/PILOT-POLICY-1/`
- 红线：
  - 不读任何凭据；若调用 `loom` 一律用 `/Users/sun/.loom-cell/current/bin/loom`。
  - 不改 `pilot-1` 或 `main`；不 push；不改产品逻辑代码。
- 提交权限：留给 Leader 在沙箱外验收后提交。
- 净行数预算上限：相对 `pilot-1` (`1f529eca`) 累计 ≤ 30 行，测试行数 ≤ 产品行数。

## 停工

预算已超或下一步将超、事实与卡面不符、或发现设计缺口时立即停工并报 `BLOCKED`。

## 三行最终回复

禁止另发消息，结束时只回三行：

```text
DONE|BLOCKED|FAILED PILOT-POLICY-1-FIX1
<一句交付结论或待裁决事项，可附制品路径>
Leftovers & deviations: none|<具体遗留、偏离或未验证项>
```
