# 任务卡 PILOT-OPENCODE-TUI-1-FIX1（更新 verify-opencode-tui.mjs：经候选 loomd 收件箱忙态排队投递 5 条）

## 目标与验收

- 交付目标：按 Auditor 对 `cac28bcb` 的第 1 轮复核结论，在 `wt/pilot-opencode-tui-1`（基线 `cac28bcb`）上更新 `tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs`，使第 2 项“5 条排队投递”真正经过**候选代码的 `loomd` 收件箱**并在**会话忙态**下以 `queue` 模式连续排队投递：
  1. 在隔离项目目录中，直接通过 Node 加载候选工作树的 `loomd` 收件箱与监督层（如 `createSupervisor` / `daemon/main.mjs` + `daemon/rpc.mjs`，**不调用**其他路径的 `loom` CLI 可执行文件；若需调用 `loom` CLI 一律按 R8 用 `/Users/sun/.loom-cell/current/bin/loom`），启动真实 OpenCode TUI 会话（`/opt/homebrew/bin/opencode`，模型 `deepseek/deepseek-flash`，不读任何凭据/配置）。
  2. **会话忙时经 `loomd` 收件箱以 `queue` 模式连续投 5 条**：
     - 先让会话进入忙态（例如发一条触发稍长回复的请求，确认进入忙态/未回到 idle），随即不等回到 `idle`，经候选代码 `loomd` 收件箱以 `mode: 'queue'` 连续提交 5 条独立 `deliveryId` 的短请求（如要求回 `Q1`..`Q5`）；
     - 记录每条投递提交时的排队状态（`phase: "queued"` / `status: "queued"`）、入队时间戳、以及最终送达/应答状态（`delivered` / `answered`）；
     - 通过 `/opt/homebrew/bin/opencode session export <sessionId> --standalone` 核对 5 条 `deliveryId` 在原生导出中各出现恰好 1 次（0 丢失、0 重复），并记录原生回复；
  3. 保留冷启动、双击 `esc` 中断续作（中断项不改产品代码）、人工草稿保护三项验证以及退出清理（临时 `hc` 窗格、隔离目录、隔离 `loomd` 均彻底清理）。
  4. 将结果写入脱敏的 `tasks/PILOT-OPENCODE-TUI-1/evidence.json`（不含任何凭据/key）。
- 验收标准：
  - `node --check tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs` 通过，`node --test adapters/opencode/adapter.test.mjs` 通过。
  - **沙箱分工**：因 Codex 沙箱禁止 OpenCode 写日志、创建 Unix socket/PTY 及写 `git index.lock`，**不要**在沙箱内执行真实 OpenCode 实测或 `git commit`，完成脚本更新与静态/单测检查后即可回报，由 Leader 在沙箱外执行 `node tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs` 实测、更新 `RESULT.md` 并提交。
- 受影响的测试：`node --check tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs && node --test adapters/opencode/adapter.test.mjs`
- 制品与原始证据：`tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs`（由 Leader 沙箱外运行生成 `evidence.json` 与更新 `RESULT.md`）。

## 施工边界

- 工作目录：`/Users/sun/Code/loom-pilot/.worktrees/pilot-opencode-tui-1`
- 基线：`wt/pilot-opencode-tui-1` (`cac28bcb`)
- 可写范围：`tasks/PILOT-OPENCODE-TUI-1/`（不修改产品代码）
- 红线：
  - 严禁读取任何凭据或 OpenCode 配置/key；OpenCode 用 `/opt/homebrew/bin/opencode`；若调用 `loom` CLI 一律用 `/Users/sun/.loom-cell/current/bin/loom`（R8）。
  - 不改 `pilot-1` 或 `main`；不 push；不改产品代码。
- 提交权限：留给 Leader 在沙箱外实测通过后提交。

## 停工

发现设计缺口、按 R8 无法经候选代码 `loomd` 驱动排队投递、或事实与卡面不符时，立即停工并报 `BLOCKED`。

## 三行最终回复

禁止另发消息，结束时只回三行：

```text
DONE|BLOCKED|FAILED PILOT-OPENCODE-TUI-1-FIX1
<一句交付结论或待裁决事项，可附制品路径>
Leftovers & deviations: none|<具体遗留、偏离或未验证项>
```
