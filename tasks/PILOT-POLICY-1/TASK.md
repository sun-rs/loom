# 任务卡 PILOT-POLICY-1

## 目标与验收

- 交付目标：修正 `examples/policy.json` 中过时的 "Claude 暂停 / deny claude" 约定，使示例中每个高级角色（`super`、`leader`、`auditor`）均列出两家不同厂商的候选项，不锁死单一厂商（遵循裁决 R4）。
  - 移除 `note` 中的 `Claude is paused in this example.`。
  - 从顶层 `deny` 中移除 `{ "cli": "claude" }`（保留对 `luna` / `gpt-6-luna` 的拒绝示例）。
  - 确保 `roles.super.preferred`、`roles.leader.preferred`、`roles.auditor.preferred` 各列两家不同厂商（如包含 `claude`、`codex`、`agy` 的合理组合，且保持 `auditor` 首选与 `worker` 首选不同厂商以符合 `vendorFamily: "different-from-workers"`）。
  - 检查 `cli/loom.test.mjs` 中对 `examples/policy.json` 的校验，确保测试全绿且覆盖“claude 不再被示例 deny 且高级角色各含两家厂商”。
- 验收标准：
  - `examples/policy.json` 为合法 JSON，不含 `Claude is paused` 及 `deny` 中的 `{ "cli": "claude" }`，且 `super`/`leader`/`auditor` 各有 2 个不同 `cli` 厂商。
  - `node --test cli/loom.test.mjs` 全绿。
- 受影响的测试：`node --test cli/loom.test.mjs`（只跑受影响的测试，不跑全量 `npm test`）。
- 制品与原始证据：`tasks/PILOT-POLICY-1/RESULT.md`（简要记录改动与测试输出摘要）。

## 施工边界

- 工作目录：`/Users/sun/Code/loom-pilot/.worktrees/pilot-policy-1`
- 基线：`pilot-1` (`1f529eca`)，当前分支 `wt/pilot-policy-1`
- 可写范围：`examples/policy.json`、`cli/loom.test.mjs`、`tasks/PILOT-POLICY-1/`
- 红线：
  - 不读任何凭据（`~/.codex/auth.json`、`~/.codex/memories*`、Claude 凭据、agy token、`~/.loom-next/provider-homes`、`.env`、OpenCode 配置/key）。
  - 若需调用 `loom`，一律使用绝对路径 `/Users/sun/.loom-cell/current/bin/loom`，严禁使用 PATH 中的 `loom`；CLI 只用绝对路径不经 PATH。
  - 不修改 `pilot-1`、`main` 或可写范围之外的任何文件；不 push；不碰 Solars、CCP、t17*、t4c、t13n。
- 提交权限：允许在当前分支 `wt/pilot-policy-1` 上提交 1 个干净的 commit（不含无关未跟踪文件）。
- 净行数预算上限：30 行（净行数为产品代码与测试改动的新增减删除，不含 `tasks/PILOT-POLICY-1/RESULT.md`）。
- 测试行数 ≤ 产品行数。

## 停工

预算已超或下一步将超、事实与卡面不符、发现设计缺口，任一出现就立即停工并报 `BLOCKED`，写明需要的裁决。

## 三行最终回复

禁止另发消息，结束时只回三行：

```text
DONE|BLOCKED|FAILED PILOT-POLICY-1
<一句交付结论或待裁决事项，可附制品路径>
Leftovers & deviations: none|<具体遗留、偏离或未验证项>
```
