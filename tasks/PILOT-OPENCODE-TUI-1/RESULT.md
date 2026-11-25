# PILOT-OPENCODE-TUI-1 实测结果（第 2 轮 · 含经候选 loomd 收件箱忙态排队 5 条）

状态：**DONE**（4 项真实 OpenCode TUI 实测全部通过并留存脱敏原生对账证据，临时会话与 `hc` 窗格已彻底清理；`node --test adapters/opencode/adapter.test.mjs` 全绿）。

## 测试环境与参数

- CLI：`/opt/homebrew/bin/opencode`（`opencode v2.3.0`，绝对路径调用，未读取任何凭据或配置）
- 模型：`deepseek/deepseek-flash`
- 终端宿主：`hc 0.1.22` + `loom-pty` + 候选工作树 `daemon/supervisor.mjs` / `daemon/tui.mjs`（隔离项目目录，未调用任何其他路径的 `loom` CLI）
- 实测脚本：`tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs`
- 脱敏原生对账日志：`tasks/PILOT-OPENCODE-TUI-1/evidence.json`

## 4 项实测结果

| 实测项 | 结果 | 关键原生证据 |
| :--- | :--- | :--- |
| 1. 冷启动 | PASS | `elapsedMs: 3978`, `transport: "loom-pty"`, `paneId: "t3dh"`, `phase: "idle"`, `source: "hook"`, `screenKind: "idle"`, `empty: true`, `draft: ""`, `nativePhase: "idle"`, `ready: true` |
| 2. 5 条忙态排队投递（经候选 `loomd` 收件箱） | PASS | 启动轮（`deliveryId: 6ec3c253-c80e-4ed1-a851-bd7f8910148c`, `turnId: msg_21252deaf001PWEahZ5QMId5N4`, `endedAt: 1795603768506`）处于 `screen: "busy"` / `nativePhase: "busy"` 时，经候选 `loomd` 收件箱以 `mode: "queue"` 连续提交 5 条（入队时间戳 `1795603752054`–`1795603752090`，均早于忙态轮结束约 16s，全部返回 `phase: "queued"` / `status: "queued"`）；忙态轮结束后按序送达并全部终结为 `phase: "received"` / `status: "delivered"` / `deliveryStatus: "answered"`（`1795603768893`–`1795603775768`）；原生导出 `opencode session export --standalone` 核对 5 条 `deliveryId` 各出现 1 次（0 丢失、0 重复），原生回复 `["Q1","Q2","Q3","Q4","Q5"]` |
| 3. 一次中断续作 | PASS | 生成中（`interruptedDeliveryId: 48cfc62e-b14a-4784-8f60-5760395140aa`）触发双击 `esc`（按 OpenCode v2.3.0 `Press esc again to interrupt` 机制），原生导出确认 `nativeInterruptionCount: 1`、`interruptedTurnStatus: "interrupted"`；同窗格恢复后续作（`resumedDeliveryId: c1d48a42-00c5-4f1e-9275-7a40d26251fd`）获原生确认（回复 `"RESUMED_OK"`） |
| 4. 人工草稿不被覆盖 | PASS | 输入人工草稿 `"human draft"` 并保持超保护窗后触发 `host.submit`，返回 `{"kind":"refused","code":"composer-not-proven-empty"}`，原草稿保持完整且未泄漏到原生导出；清除草稿并等待保护窗结束后恢复投递（`afterClearDeliveryId: a58deef7-8a8d-44ae-8b1e-0e829ad506ce`）获原生确认（回复 `"DRAFT_OK"`） |

清理核验：`hc ls --json` 确认临时 `hc` 窗格（`t3dh`）及隔离临时目录均已清理（`remainingMatchingPanes: 0`）。

## 最小修复（保持第 1 轮代码改动不变，净增 10 行：产品 5 行 / 测试 5 行）

1. `adapters/opencode/index.mjs`（+4 行）：修复无 `effort` 时的 `model#undefined`、适配 OpenCode v2.3.0 页脚与忙态识别、占位符草稿归一化、`is_interrupt` 归一化与双击 `esc` 计划。
2. `daemon/tui.mjs`（+1 行）：`refreshOpenCode()` 通过 `absoluteCommand('opencode', 'opencode')` 解析绝对路径。
3. `adapters/opencode/adapter.test.mjs`（+5 行）：补齐上述场景回归断言。

## 遗留与运行观察（未改范围外文件）

- `host.interrupt()` 对 OpenCode 仍返回 `{"kind":"refused","code":"not-interruptible"}`：根因在卡外 `tui/providers.mjs:154`、`tui/index.mjs:213`、`daemon/sessions.mjs:196`，按 Auditor 结论本轮不改代码，由 Super 另行裁决。
- 运行观察：经 `loomd` 派发给 OpenCode TUI 时，因 `inbox/tui.mjs` 提交确认窗（900ms）内无独立后台 `refreshOpenCode`，单次 `submit` 首跳会报 `TUI submit unconfirmed`，随后在下一次 `tick()` 的 `refreshOpenCode` 自动对账为 `delivered`/`answered`，全流程 0 丢失、0 重复。

## 验收命令结果

- `node --test adapters/opencode/adapter.test.mjs`：1 项通过，0 失败
- `node tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs`：4 项全部通过且清理核验通过
