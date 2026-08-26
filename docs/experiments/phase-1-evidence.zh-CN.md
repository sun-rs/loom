# Phase 1 实验证据

## 目标

验证不同 Agent CLI 能否把 RAH Room 当作协作真相，并在不解析 stdout、JSONL 或原生 session 的情况下完成同一任务协议。

证据分为两组：旧 Python harness 是 **E2 candidate / local-only**；当前 TypeScript daemon 已提供仓库内可重复的 **E2 local delivery + minimum Task slice**。两者都不是 production 或完整 coding workflow 证明。

## 已验证运行时

| CLI         | 模型/配置              | 协议结果 | 进程结果                                  |
| ----------- | ---------------------- | -------- | ----------------------------------------- |
| Codex       | `gpt-5.6-sol`, low     | 通过     | 干净退出                                  |
| OpenCode    | 本机配置               | 通过     | 干净退出                                  |
| Claude Code | `claude-sonnet-5`, low | 通过     | 干净退出                                  |
| Kimi CLI    | 本机 Coding Plan       | 通过     | 完成协议后未自行退出，由 harness 超时终止 |

当次本机记录：Codex CLI `0.149.1` 约 `21.175s`，OpenCode `1.18.22` 约 `11.625s`，Claude Code `2.1.234` / Sonnet 约 `52.1s`；Kimi CLI `0.38` 在 `150s` 前完成业务协议，但进程未自行退出。版本、账户状态、网络与模型路由都会影响耗时，这些数字不是性能排名。

每个成功协议 Run 都由 Agent 显式产生：

```text
task.claimed -> task.started -> task.progressed -> task.submitted
```

验证器只读取 Room Kernel 的 Task projection 和 durable events。CLI 输出仅保存为诊断，删除输出文件不改变判断。

Codex 与 OpenCode 还在同一 Room/数据库中完成了顺序协作：OpenCode 使用自己的 consumer cursor 同步到 Codex 已完成的 Room 历史后，再认领后续 Task。

## 当前 TypeScript daemon gate

2026-08-25 在本机明确 opt-in 运行：

| CLI         | 版本/模型                       | Worker delivery | wall time |
| ----------- | ------------------------------- | --------------- | --------- |
| Codex       | 0.149.1 / `gpt-5.6-luna`        | `sync/ack` 通过 | 约 19.7s  |
| Kimi CLI    | 0.38.0 / 本机配置               | `sync/ack` 通过 | 约 25.6s  |
| OpenCode    | 1.18.22 / 本机配置              | `sync/ack` 通过 | 约 8.0s   |
| Claude Code | 2.1.234 / `claude-sonnet-5` low | `sync/ack` 通过 | 约 14.9s  |

四者均由 `DaemonApplication -> GenericProcessAdapter` 拉起，只收到 per-Activation Worker URL/token。测试只等待 Kernel Activation/cursor proof；CLI stdout/stderr 不参与 pass/fail。默认 `npm test` 跳过真实 gate，显式运行方式为：

```bash
RAH_REAL_CLI_GATE=codex node --test packages/daemon/test/real-cli-gate.test.ts
RAH_REAL_CLI_GATE=kimi node --test packages/daemon/test/real-cli-gate.test.ts
RAH_REAL_CLI_GATE=opencode node --test packages/daemon/test/real-cli-gate.test.ts
RAH_REAL_CLI_GATE=claude node --test packages/daemon/test/real-cli-gate.test.ts
```

在 Task slice 纳入当前仓库后，确定性 fake CLI 已通过完整 daemon 链产生：

```text
task.created -> task.claimed -> task.started -> task.progressed -> task.submitted
```

反向 fixture 让子进程只做 `sync/ack` 后 exit=0；Kernel 因 Task 仍为 `todo` 拒绝 Activation completion，AgentHost 将原 Activation durable requeue。它证明系统不会把 delivery 或成功退出误报为 Task submission。

恢复 fixture 使用短 Task lease：Worker Application Service 在 token 有效期间以 sidecar heartbeat 续租，不制造 Room event 或 Outbox；fake CLI 在 `task.started` 后故障退出，新 RunAttempt 通过 canonical Task query 和稳定业务幂等键恢复，只补写尚未发生的 `task.progressed/task.submitted`。最终事件链仍恰好只有一组 `created -> claimed -> started -> progressed -> submitted`，证明系统无需解析前一个 CLI session 的 JSONL 即可恢复业务工作。

InputRequest fixture 让第一个 fake CLI 在 `task.started` 后调用严格 `request-input` command：Kernel 创建 pending InputRequest、释放 claim、把 Task 置为 `waiting_input`，随后进程在 ack 原 range 前故障退出。第二个 RunAttempt 只通过不含 question/answer 的 canonical `input-status` 确认 pause、补 ack 后退出，原 Activation 完成且 InputRequest 不重复。等待窗口中 daemon 保持运行但 RunAttempt 数不增加。authenticated human 随后使用独立 daemon Client API 执行 pending list、Room sync 与 causal resolve；`input.resolved` 通过 Inbox/Activation/Outbox 唤醒第三个 CLI，它从 Room event 读取 answer、重新领取并提交同一 Task。最终业务链为 `task.created/claimed/started -> input.requested/resolved -> task.claimed/started/progressed/submitted`，不读取三个进程的 stdout/JSONL。

2026-08-25 又以 `gpt-5.6-luna` 明确 opt-in 运行 Codex CLI 0.149.1，约 45.5 秒完成同一 Task gate。测试等待 canonical Task projection=`submitted` 与 Activation=`completed`；Codex 的 prose、stdout、stderr、thinking 和 tool stream 均不参与判定。Kimi、OpenCode、Claude Code 本轮没有重复付费跑 Task gate，因此它们在当前 TypeScript 实现上的证据仍只到 delivery，不能沿用旧 harness 结果冒充新实现证明。

## 证明了什么

- CLI 只要能调用 shell 或 MCP，就可以服从统一 Room 业务协议。
- Provider session ID 不必成为协作聚合根。
- Task completion 可以与 process exit 分离。
- 独立 cursor 可以让多个 Agent 在同一 Room 中增量理解历史。

## 没有证明什么

- 没有验证生产认证、多租户或远端 Host。
- 旧 harness 没有验证 wake channel、Activation lease 或断线恢复；当前 daemon gate 已验证本机 Outbox wake、lease、SIGTERM/restart 和 polling backstop，但尚未验证远端断线。
- 没有验证 worktree、Artifact、Review。
- Kimi 暴露了真实的 process lifecycle/reap 问题。
- SQLite 原型不等于生产数据库迁移已经完成。
- 当前仓库已复现 canonical Task query/list、open Task 多 Agent 广播与 single-winner claim、release/block/assign/unblock/cancel、older-Task dependency ready wake、claim heartbeat、跨 RunAttempt 幂等恢复、InputRequest/`waiting_input` 无 listening 唤醒、Worker Task command 与 Human Task/InputRequest transport；但还没有 InputRequest cancel/expire/structured answer、Artifact、Review、完整 Client hint/MCP、Host credential 管理面/Keychain、Windows recovery 或完整 coding workflow。
- InputRequest gate 目前只使用确定性 fake process；human resolve 已走 authenticated loopback Client API，但尚未证明真实 Provider、Web/PWA/CORS/LAN transport 或系统 push notification。
- `submitted` 不等于 `completed`；当前只有 creator 的显式完成动作，尚无 frozen review evidence 或 verifier。

后续继续补这些未验证部分，同时保留“不解析 CLI 输出作为业务状态”的实验边界。
