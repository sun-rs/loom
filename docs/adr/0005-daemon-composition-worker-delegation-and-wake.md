# ADR-0005：Daemon composition、Worker delegation 与 durable wake

状态：Accepted（E2 local，2026-08-25）

## 背景

`AgentHostDaemon` 原先只是 lifecycle wrapper：调用者仍需手工创建 Kernel、Worker HTTP service、RuntimeAdapter、AgentHost 与 instance lock。Worker token 又由 Agent PAT 对应的 actor context 签发。这会迫使真实 daemon 保存 Agent 的通用业务 credential，并且没有可执行入口、启动回滚、有限 shutdown 或 Outbox publisher。

## 决策

1. 新增独立 `@rah-os/daemon` composition root。它从严格、版本化 JSON 配置启动 RoomKernel、WorkerApplicationService、GenericProcessAdapter、AgentHost、OutboxWakeDispatcher 和 Unix socket lock，并负责失败回滚与逆序关闭。
2. Host secret 通过 `SecretProvider` 加载。当前 `FileSecretProvider` 只接受当前用户拥有、group/other 不可读写且不是 symlink 的 regular file；配置本身不保存 token。Keychain 是下一种 provider，不改变 daemon composition。
3. Worker grant 不再接受 `AuthenticatedActorContext`。已认证且当前活跃的 Host instance 只能为自己持有的 Activation、当前 RunAttempt、participant、Room、consumer 与 `toSeq` 签发不可伪造的 `AuthenticatedWorkerExecutionContext`。每次 Worker request 都重新检查 Host credential、daemon instance、lease、RunAttempt 与 RuntimeProcess；daemon 不需要 Agent PAT。
4. 每次 Host token authentication 产生新的 `instanceId`。Kernel heartbeat 只允许一个活跃 generation；新 generation 在旧 generation 正常 offline 或超过显式 `hostStaleAfterMs` 后接管。旧 Host context 和由它签发的 Worker grant 随即 fail closed。心跳记录 build version、protocol version 与 PID。
5. 正常 signal 先 drain；`drainTimeoutMs` 到期后 cancel 当前 runtime。start、recover、cancel 都有独立 deadline。cancel 无 terminal proof 时 durable quarantine，不能把 signal、timeout 或 CLI exit 冒充业务完成。
6. Kernel Outbox 仍是 durable truth。本机 dispatcher 只 lease `activation.requested` topic，发布 content-free wake 并在成功后 ack；LocalWakeSignal 只中断 AgentHost 的 poll wait。wake 可重复、可丢，固定 polling backstop 始终保留。
7. `PRAGMA user_version` 是当前最低 schema compatibility fence；比当前 Kernel 更新的数据库拒绝启动。配置 schema、daemon build/protocol version 与 Host health metadata 均显式记录。
8. 当前一个 daemon config 强制一个 Host credential 精确绑定一个 Agent participant 和一个 RuntimeProfile。多 participant runtime router 必须以后以独立 lane/capability 设计加入，不能让一个阻塞 CLI 串行拖住多个 Agent。

## 证据

- 默认确定性 gate 覆盖严格配置、secret 权限、composition restart、独立 daemon 进程、SIGTERM、deadline cancel、stale generation fencing、Worker grant fencing，以及 60 秒 polling 下由 Outbox wake 在测试 SLA 内启动工作。
- opt-in 本机真实 gate 已分别让 Codex、Kimi、OpenCode 与 Claude Code Sonnet 5 通过同一个 Worker `sync/ack` 协议。后续 ADR-0006 又让 Codex Luna 通过 Task `claim/start/progress/submit`。判定只读取 Kernel projection/event/cursor，不解析 stdout、JSONL、thinking 或 tool stream。

## 声明边界

- 这完成的是本机 daemon core，不是可安装的 Mac 产品。launchd、Keychain、签名/公证、自动升级、control/health endpoint 和 log rotation 仍未实现。
- ADR-0006 已实现最小 Task command slice，ADR-0007 已实现确定性本机 InputRequest/`waiting_input` 无 listening 闭环，ADR-0008 已实现 loopback Human sync/list/resolve Client slice，ADR-0014 已增加不授予 Agent PAT 的 Activation-scoped Room reply；Artifact、Review、Memory、完整 Web/PWA Client/hint surface 及 coding workflow 仍未实现。真实 Provider 尚未逐一复跑 Task/InputRequest/Room reply 新 gate。
- Host instance generation 在每次 privileged call 上重新校验；更强的设备证明、远端 Host、细粒度 RuntimeProfile capability 和 hostile same-user isolation 仍在范围外。
- content-free wake 当前是同进程本机 publisher。未来 WebSocket/SSE/remote transport 必须复用 Outbox lease/ack 语义，不能另建业务队列。
