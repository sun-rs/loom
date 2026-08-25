# Daemon Core 运行架构

状态：本机单 participant core、最小 Task business slice、InputRequest 无 listening 恢复与 versioned Human Client API 已达到 E2 local；安装、完整客户端/管理面与协作业务尚未收口。

## 1. Composition 与 owner

```text
rah-os-daemon
  -> strict DaemonConfig(schemaVersion=2)
  -> SecretProvider -> authenticated Host instance
  -> RoomKernel(SQLite)
  -> ClientApplicationService(loopback HTTP, principal PAT)
  -> WorkerApplicationService(loopback HTTP)
  -> GenericProcessAdapter -> Agent CLI
  -> AgentHost reconciliation
  -> OutboxWakeDispatcher -> content-free LocalWakeSignal
  -> UnixSocketInstanceLock
```

`DaemonApplication` 只负责组合和生命周期，不成为第二个业务 Kernel。Room event、Inbox、Activation、RunAttempt、cursor 与 Outbox 仍以 SQLite ledger 为准；Runtime 输出与 daemon health 只是观察数据。

## 2. 启动与关闭

启动顺序：

1. 验证 owner-private state directory 与 Host secret；
2. 打开 Kernel，拒绝更新版本的 schema；
3. 认证 Host token，并验证 config 的 Host/participant 与 credential scope 精确相等；
4. 启动 loopback Worker service；
5. probe Runtime command；
6. 创建 wake dispatcher、AgentHost 与 instance lock；
7. 启动独立的 loopback Client service；
8. 注册带 generation/build/protocol/PID 的 online heartbeat；
9. 并行运行 reconciliation 与 Outbox publisher。

任一步失败都会停止已启动组件并关闭 Client/Worker/Kernel；各清理动作独立尝试，一个 close 失败不会阻止其余 owner 释放。`SIGINT/SIGTERM` 触发 `online -> draining -> offline`；当前执行可在 grace 内完成，超过 `drainTimeoutMs` 后受控取消。无法取得 terminal proof 时 lane quarantine，daemon 仍可退出并由下次 recovery 对账。

## 3. Worker authority

```text
Host credential
  -> active daemon instance generation
  -> current Activation + RunAttempt scope
  -> in-memory rah_wat_ token
  -> /v1/worker/sync + acknowledge
  -> /v1/worker/tasks/get|input-status|claim|start|progress|request-input|submit
```

daemon 不保存 Agent PAT。Worker token 不能调用普通 Agent message、任意 Kernel method或选择 actor、Room、participant、consumer、`toSeq` 与 Task lease。Task endpoint 只能操作本 Activation 已覆盖且分配给当前 participant 的 Task；causal cursor 必须由本 credential 已接收或产生。Host revoke、generation 被接管、lease 过期、run terminal 或 scope 不一致都会 fence token。

## 4. Wake 与 polling

Message transaction 原子写入 `activation.requested` Outbox。dispatcher 通过 topic filter lease 条目，先发布无正文 wake，再 ack Outbox；失败则 durable retry。LocalWakeSignal 只提前结束 `AgentHost.wait()`。即使所有 wake 丢失，Host 仍在 `pollIntervalMs` 内主动 reconciliation。

因此等待人的时间不占模型 token，也不要求 CLI session 长期 listening。用户几分钟后回复会产生新的 Activation；daemon 是否收到实时 hint 只影响延迟，不影响可恢复性。

## 5. Human Client authority

```text
principal PAT
  -> /v1/client/health|rooms/*|tasks/list|input-requests/*
  -> per-request authenticated actor
  -> Room ACL + canonical Kernel query/command
```

Client 和 Worker 使用独立端口与 authority。Client body 不能选择 actor/responder；Worker token 也不能升级为 Human PAT。当前 API v1 提供 content-free health/capabilities、Room `sync/ack`、Task/InputRequest list 和 designated-responder resolve。

Client continuation/ack 只能使用已持久确认或由当前 credential/consumer 实际收到的 cursor；daemon 重启会清空未确认的 delivery proof，因此客户端从 durable ack 位置重同步。当前只允许 loopback，未开放 CORS/hint/LAN，也尚未接入 raft-ui。完整决策见 [ADR-0008](../adr/0008-versioned-human-client-application-service.md)。

## 6. 当前配置与执行限制

- 一个 config = 一个 Host ID = 一个 Agent participant = 一个 Generic process profile；
- runtime `command/args/cwd/env` 是显式 argv，始终 `shell: false`；
- per-Activation Worker URL/token 由 daemon 注入，profile env 不能覆盖；
- paid Provider gate 是 opt-in，默认 `npm test` 不调用网络模型；
- `taskClaimLeaseMs` 是 daemon-owned Task claim 时限；`taskClaimHeartbeatIntervalMs` 驱动 Worker service sidecar 自动续租，不占模型 token，也不追加 Room event；
- 新 RunAttempt 通过 activation-scoped `tasks/get` 读取 canonical projection，重放稳定 Task command 并继续未落账步骤；credential release/fence 会停止旧 heartbeat；
- `request-input` 原子创建 canonical InputRequest、清除 claim 并把 Task 置为 `waiting_input`；CLI 随即退出。authenticated human 通过 Client API resolve，把 Task 恢复为 `todo`，再由 `input.resolved` Inbox/Activation/Outbox 唤醒新 RunAttempt；
- CLI 必须能执行 shell/MCP/ACP 动作来调用 Worker API。当前 L0 gate 用 shell 完成 `sync/ack + Task commands`，不解析 CLI 输出；
- Task 与进程生命周期正交：Agent exit/Activation completion 不会完成 Task；若 Activation 关联的 Task 尚未达到 `waiting_input/submitted/completed`，Kernel 拒绝 completion 并由 AgentHost durable retry；Agent 提交后仍需 creator 的显式 `completeTask`。

## 7. 下一道边界

Daemon core 下一步不是 UI，也不是更多 JSONL parser，而是：

1. Task list/dependency/block/reassign/cancel、InputRequest cancel/expire/structured answer，以及 Artifact/Review application commands；
2. ADR-0009 R0 pure planner 已完成，R1 Kernel Placement 骨架经过独立审计后的运行安全修复；下一步按 [Runtime Registry 与多 Lane 调度架构](./runtime-registry-and-multi-lane-scheduling.zh-CN.md) 完成 R1.1 trusted evidence/immutable offer observation，再推进 Host-local registry 与 MultiLaneAgentHost；
3. daemon control API、结构化日志、SSE/WebSocket content-free hint 与 supervisor artifact GC；
4. Keychain、launchd、签名/公证和升级兼容 gate；
5. 以现有 versioned Client API 为基础补齐 `RahClient` contract，并接入 UI；不得让 UI 直连 SQLite。
