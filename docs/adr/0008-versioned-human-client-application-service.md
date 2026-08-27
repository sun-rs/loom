# ADR-0008：版本化 Human Client Application Service

状态：Accepted（collaboration P2/P3 loopback Human API + full current RahClient surface + daemon E2 local，2026-08-26）

## 背景

Room-first Kernel 已经拥有 principal authentication、Room ACL、ordered event、durable cursor、Task 与 InputRequest，但浏览器或桌面客户端若直接打开 SQLite、调用 Kernel object，便会复制业务 owner，并无法跨进程或跨设备演进。复用 Worker API 也不成立：Worker bearer 是短命的 Activation/RunAttempt authority，而 Human client 使用长期 principal identity，二者的权限、游标和生命周期不同。

同时，仅提供一个返回事件的 HTTP endpoint 仍不足以证明可靠 sync。若客户端可以任意提交 `afterSeq/throughSeq`，一次错误或恶意请求就能把自己的 durable cursor 越过从未收到的 Room 事件，破坏“响应丢失后可以重放”的不变量。

## 决策

1. 新增独立 Human HTTP adapter（兼容类名 `ClientApplicationService`）。它与 `WorkerApplicationService` 可以在同一 daemon process 中使用同一个 Core，但使用独立监听端口、路由和 bearer authority：

   ```text
   Human principal PAT -> /v1|v2|v3/client/* -> HumanApplicationPort -> RoomKernel
   Host-derived WAT    -> /v1/worker/*    -> Worker execution port -> RoomKernel
   ```

   HTTP adapter 不持有第二套 Room/Task/InputRequest 状态，也不得依赖整个 `RoomKernel`；它只依赖冻结的 `HumanApplicationPort`，不接受任意 SQL、shell command、actor、responder 或 Worker scope。Core direct use 与 transport 的完整关系由 [ADR-0013](./0013-human-application-port-and-transport-boundary.md) 约束。

2. 当前 Client API 版本为 `3`。v1 保留原 Task/InputRequest/sync/ack 路由；v2 保留 collaboration P2 discovery/Room collaboration surface；managed Workspace/Room create 与 `workspaceWrite/roomWrite` capability 只在 v3 暴露，避免严格旧客户端因未知字段或 route 被静默破坏。v2/v3 共享的 surface 为：

   | Route family                                       | Authority / result                                                     |
   | -------------------------------------------------- | ---------------------------------------------------------------------- |
   | `GET /v2                                           | v3/client/health`                                                      | content-free build/protocol/schema/capability/state |
   | `POST .../workspaces/list`, `.../rooms/list`       | authenticated principal 可见的 Workspace/Room discovery                |
   | `POST .../rooms/sync`, `.../rooms/acknowledge`     | authenticated member snapshot、ordered delta 与 durable receipt ack    |
   | `POST .../rooms/members/*`                         | Room ACL 下的 list/add/remove/role，写入要求 causal/idempotent command |
   | `POST .../messages/list`, `.../messages/post`      | paginated canonical Message query/send 与 durable attention 派生       |
   | `POST .../threads/list`, `.../create`, `.../reply` | Room-owned Thread/query/reply，不接受 Provider session identity        |
   | `POST .../tasks/*`                                 | canonical Task list/create/assign/unblock/cancel/complete              |
   | `POST .../input-requests/list`, `.../resolve`      | canonical projection 与 designated-responder causal resolution         |

   v3 另提供 `POST .../workspaces/create` 与 `POST .../rooms/create`。前者原子创建 Workspace、唯一 control Room 和 Human owner；后者只能由 control Room owner/admin 执行，以 `basedOnControlRoomSeq` 做 freshness，并同时记 control ledger 与新 Room 首事件。

   v3 还提供 `POST .../principals/me`、`POST .../agents/list` 与 `POST .../agents/onboard`：`principals/me` 只返回当前 credential 对应的 server-owned Human projection，供客户端把 capability 与 canonical role 结合；Agent list 必须指定当前 Workspace 的 `controlRoomId`，只返回调用 Human 在该 scope 可访问的 AgentDefinition/current revision/handle；onboard 只接受 definition identity，且 definition control Room 与目标 Room 必须属于同一 Workspace，由 Kernel 解析 enabled participant 后加入目标 Room，body 不能注入 `participantId`。

   数据 route 每次都重新认证 principal PAT；actor 来自 credential，不来自 body。Room membership、designated responder、fresh context 与 idempotency 继续由 Kernel 强制。health 无需 bearer，但 schema 严格且不返回 Host ID、participant ID、token、路径或 Room 数据。

3. sync 使用两阶段 delivery proof。服务按 `credential hash + Room + consumer` 暂存已实际返回的 cursor：

   - 未显式传 `afterSeq` 时，从 Kernel durable cursor 恢复；
   - 显式 continuation 只能来自已 durable ack 的位置、向后安全重放的位置，或本 credential 实际收到的 cursor；
   - `cursorBefore` 报告投递前的 durable cursor，`cursorAfter` 报告本页实际投递位置；向后分页重放时前者允许大于后者，客户端必须按自己请求的 `afterSeq` 验证页连续性；
   - `throughSeq` 只能确认已收到的 cursor，或幂等重试一个已经 durable ack 的 cursor；
   - 服务重启会丢弃暂存 proof，但不会推进 durable cursor；客户端从旧 ack 位置重同步并取得新 proof 即可。

   暂存 proof 不是业务真相，也不能替代 `subscription_cursors`。每个 consumer 的未确认 cursor 集有上限，避免无界内存增长。

4. `resolve` 复用 protocol-owned `InputRequestResolveRequest/Response`。客户端必须先 sync 到最新 Room sequence，再携带 `basedOnRoomSeq`；若期间出现新 event，Kernel 返回 `stale_context`，客户端重新 sync 后重试。成功 resolution 原子产生 `input.resolved`、Task `waiting_input -> todo`、requester Inbox/Activation/Outbox；客户端 HTTP 成功本身不拉起或完成 CLI。

5. daemon config 升级到 schema v2，并要求显式 `client.bindHost/client.port`。当前只允许 `127.0.0.1`；测试可使用 port `0` 取得临时端口。Client service 在 runtime probe 和其他依赖准备后启动，daemon shutdown 时先停止接受 Client 请求，再关闭 Worker 和 Kernel；`DaemonApplication.clientOrigin()` 只在本次运行期间可见。

6. 当前不实现 CORS、SSE/WebSocket hint 或 LAN binding。这样不会以 wildcard CORS 提前暴露 PAT，也不会把 hint 误作顺序真相。Browser/PWA 接入前需另行实现明确 allowed origins、配对/credential storage 与 transport conformance；客户端仍以 reconnect → sync → ack 恢复。

## 证据

- protocol fixture 证明 Client API v1/v2/v3 schema 严格、transport-neutral，拒绝 `actorId/responderId` 注入、第二个 control Room kind 和越界 page size；
- standalone HTTP fixture 证明 v1/v2 compatibility、v3 managed create、server-owned `principal.me`、Workspace-scoped Agent list/onboard、无 token=401、非成员=403、错误 responder=403、stale context=409，并覆盖 Workspace/Room discovery、成员角色、Message/Thread、分页 sync、显式 ack、durable ack 幂等、Task/InputRequest 查询和 resolution；
- 同一 fixture 证明 invented continuation/ack 被拒绝，且 health 不泄露 credential；
- `client-core` fixture 证明同一 consumer 在 durable cursor 已领先时，浏览器冷启动仍从 `afterSeq=0` 取得 snapshot、分页重放、逐页 ack，并拒绝 gap/divergent history；
- daemon InputRequest fixture 中，Human 使用 Client API 完成 list → sync → resolve；等待期间无新 RunAttempt，resolution 后 content-free wake 拉起新 CLI session 并提交原 Task；
- daemon lifecycle fixture 证明 Client endpoint 仅在 daemon 运行期间存在，并随 shutdown 关闭。

## 声明边界

- 当前 `RahClient` 已覆盖全部现有 v3 Human route；尚无后端 owner 的 Workspace/Room archive、Agent provisioning/editor/lifecycle、Inbox query/resolve、Artifact/Review、Run Inspector、hint subscription 或 daemon control command，也不会由 SDK 提前发明。现有 HTTP schema/route 是 SDK 的可执行 contract，不是 UI state owner。
- 当前 loopback HTTP 可供本机 shell、测试和未来 desktop bridge 使用；尚不能声明 raft-ui、普通浏览器或 iOS PWA 已接通。
- principal provisioning/revocation 管理面、Keychain、device pairing、CORS/TLS/LAN、rate limit 与审计导出尚未实现。
- Client delivery proof 当前是 daemon-memory evidence；重启后的预期恢复动作是重同步，不是确认旧 HTTP response。
- Client API v1/v2/v3 与 daemon config v2/v3/v4 是不同版本轴；Kernel schema 当前为 v8，也独立演进。
