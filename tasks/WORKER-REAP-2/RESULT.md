# WORKER-REAP-2 结果

- 分支 `infra/worker-reap-2`，基线 `63ef3b15`，工作树 `/Users/sun/Code/repos/loom-worker-reap-2`。
- 接手前任 Codex worker 的未提交改动并在此基础上补齐根因修复、热升级接管补齐、2 倍 TTL 显式双端告警与全量回归验证。

## 根因分析

1. **`BLOCKED` 结果永不进入空闲计时且拒绝 `loom release`**：`daemon/worker-retention.mjs` 中 `releaseConditions().workerResult` 默认 `allowBlocked = false`，`daemon/supervisor.mjs` 的 `reapSessions()` 仅在 `workerHandoff.ready` 时传入 `allowBlocked: true`，`loom release` 则始终以 `allowBlocked: false` 校验，导致所有 `BLOCKED` 结局的 worker 永远处于 `eligible = false`、`idleSince = null`、`remainingMs = null`，TTL 永不启动且 `loom release` 恒报 `"Worker has pending deliveries or its final result has no native delivery receipt"`。
2. **父级原生投递回执缺失永久阻塞释放**：`workerResult` 要求 `final.completion.body && !final.completion.unconfirmed` 且所有波次/续作汇报在 `inbox` 中均有父级原生 `received` 回执，同时 `pending()` 把待确认的结果投递也视作未结算在途投递；一旦父级回执缺失（父级长忙/失联/投递被拒/损坏/旧格式或无原生正文），`eligible` 永为 `false`，空闲计时永远无法启动。
3. **热升级接管的旧 worker 从未补齐 `idleSince`**：旧 release 下启动的 worker 在 `sessions/<addr>.json` 中缺少 `retention` 元数据；热升级接管路径 `supervisor.reattach()` 仅调用 `sessions.refresh()` 与 `sessions.upgradeSessions()`，未对已空闲的接管 worker 补齐 `idleSince`，而 `reapSessions()` 过去又只在 `eligible` 为真时才写 `idleSince` 且 `workerIdleSince()` 仅按当前 `streamId` 查 `turn-end`，导致接管后的旧 worker 长期保持 `idleSince = null`、`remainingMs = null`。
4. **2 倍 TTL 兜底缺口**：此前不存在超时未释放检测与 Status 计数；前任 WIP 仅在 `eligible` 分支且释放前触发告警、未覆盖 `!eligible` 长期滞留场景，且未向 Leader 发显式投递、未加入外置 Super 桌面通知路由（`desktopTypes`），在 `workerBoard`/`status` 离线路径中释放后计数也未排除已释放（`releasedAt != null`）的会话。

## RED 复现

在补齐实现前先编写/完善回归用例并运行定向 RED，均按预期失败（退出 1）：

- `daemon/supervisor.test.mjs`：
  - `starts retention for a BLOCKED result after the parent reads the result and allows release and resume`：`retention.eligible` 缺失（`undefined`）。
  - `starts retention, reports UNCONFIRMED to Leader, and releases on TTL when the parent result receipt is missing`：`retention.eligible` 缺失且未向 Leader 发送显式 `UNCONFIRMED` 通知。
  - `backfills idleSince on hot-upgrade reattach for adopted legacy workers without retention metadata`：`reattach` 后 `adoptedDone.retention.idleSince` 为 `null`（期望等于 `turn-end.at`）。
- `daemon/notifications.test.mjs`：`worker-release-timeout pushes explicitly to external desktop route when no managed Super exists` 桌面回调为空（`[]`），仅落 `log`。
- `cli/status-tui.test.mjs`：`Status TUI displays release timeout count on Board, Workers and detail views` 缺少 Board `Needs attention` 中的 `超时未释放 · STUCK-IDLE` 与 Workers 面板标题计数。

## 实现摘要

- **结果状态、回执上限与空闲起始时间**（`daemon/worker-retention.mjs`）：
  - `retentionStatus()` 暴露 `eligible`、`resultUnconfirmedAt`、`releaseTimeoutAt` 与仅在未释放且未关闭时为真的 `releaseTimedOut`。
  - `workerIdleSince()` 支持回退识别旧日志无 `streamId` 的 `turn-end`/`compaction_ended` 及传入的完成时间戳，避免热升级/老日志丢失空闲起点。
  - `releaseConditions().workerResultState()` 支持 `allowBlocked`、`allowUnconfirmed` 与回执超时上限 `workerResultReceiptMs`（默认 10 分钟）；父级确认读到结果（含 `DONE`/`BLOCKED`/`FAILED`/无正文结算）即视为 `confirmed` 立即进入计时，超过上限仍缺回执时判定 `stale`/`unconfirmed` 并允许在忽略过期结果投递的前提下放行计时与 `loom release`（跨卡复用 `requireNextCardReuse` 仍保持严格 `allowBlocked: false`、`allowUnconfirmed: false`）。
- **热升级补齐、未确认上报与 2 倍 TTL 双端显式兜底**（`daemon/supervisor.mjs`、`daemon/sessions.mjs`、`daemon/notifications.mjs`）：
  - `reattach()` 中新增 `backfillAdoptedRetention()`，对热升级接管的已空闲无头 worker 立即补齐 `idleSince`、`idleStream` 及已确认时的 `eligible`。
  - `reapSessions()` 在父级回执缺失满 10 分钟时记录 `resultUnconfirmedAt`/`resultUnconfirmedFor`，将结果标为 `UNCONFIRMED` 并通过 `notifyLeader()` 向 Leader 发显式投递（离线时由 `leaderSignals` 兜底且不重复），随后照常计时并在 TTL 到期后下线（保留原生会话与工作树供 resume）；若迟到回执到达则清除未确认标记。
  - `reapSessions()` 在尝试关闭/释放之后（含 `!eligible` 滞留、`keep`/`keepWarm` 或释放抛错场景）执行 `recordReleaseTimeout()`：凡处于 `idle`/`idle-warm` 超过 `2 * TTL` 仍未下线者，记录 `releaseTimeoutAt`，向 Leader 发显式投递并写 `worker-release-timeout` 通知；`tick()` 改为先 `reapSessions()` 再 `pushNotifications()` 保证同轮推送到托管 Super，同时将 `worker-release-timeout` 加入 `daemon/notifications.mjs` 的 `desktopTypes` 与 `incidents` 以便外部 Super 收到显式通知（不静默）。
  - `sessions.mjs` 在 `released()` 释放会话时清除 `releaseTimeoutAt`，避免已下线 worker 残留超时状态。
- **Status 看板、TUI 与 CLI 展示**（`daemon/status-board.mjs`、`cli/status.mjs`、`cli/status-view.mjs`）：
  - `workerBoard()` 修正以 `job.retention.releasedAt` 判断释放态，仅对在世未释放会话标记 `releaseTimedOut`；`attentionBoard()` 新增 `release-timeout` 项。
  - `board`、`status` RPC 与离线 `projectStatus()` 统一暴露 `releaseTimeoutCount`（排除已释放/已结束会话）。
  - Status TUI 在 Board `Needs attention`（`超时未释放`）、Board `Areas`、Workers 面板标题及 Worker 详情浮层展示超时未释放计数与状态，并为 `UNCONFIRMED` 增加告警色；`printStatus()` 输出 `Release timeouts · N 超时未释放` 并在 Worker 行标注 `超时未释放`。

## 验证

- `npm run lint`：`Loom lint passed (348 files).`
- 定向回归全部 GREEN：
  - `daemon/supervisor.test.mjs` 新增与更新用例（`BLOCKED` 计时/释放/恢复、回执缺失 10 分钟 `UNCONFIRMED` 上报与 TTL 下线恢复、热升级接管补齐 `idleSince`、2 倍 TTL 覆盖 `keepWarm` 与 `!eligible` 双端显式告警及释放清零、`invariant [persistence]` 重启持久化与单次告警幂等）5 项全通过。
  - `daemon/upgrade.test.mjs` 真实热升级全套 4/4 通过。
  - `daemon/notifications.test.mjs`、`cli/status-tui.test.mjs`、`cli/account-status.test.mjs` 20/20 通过（含外置桌面路由、Status TUI 3 宽度快照与 `超时未释放` 计数、`printStatus` 展示）。
- 全量 `npm test -- --test-concurrency=4`（含 `pretest` lint）：**1099/1099 通过，0 失败，0 跳过**。（注：不限并发的默认 `npm test` 出现 3 个无关子进程超时/竞争抖动：`account-wiring-codex-agy`、`hardening`、`holder`，单独复跑及 `--test-concurrency=4` 全量均 100% 通过。）
- `git diff --check` 通过。未触碰 pilot 终端，未读取凭据，未执行 `git push`。

STATUS: done
