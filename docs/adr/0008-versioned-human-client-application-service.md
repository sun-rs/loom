# ADR-0008：版本化 Human Client Application Service

状态：Accepted（collaboration P2 loopback Client API + daemon E2 local，2026-08-26）

## 背景

Room-first Kernel 已经拥有 principal authentication、Room ACL、ordered event、durable cursor、Task 与 InputRequest，但浏览器或桌面客户端若直接打开 SQLite、调用 Kernel object，便会复制业务 owner，并无法跨进程或跨设备演进。复用 Worker API 也不成立：Worker bearer 是短命的 Activation/RunAttempt authority，而 Human client 使用长期 principal identity，二者的权限、游标和生命周期不同。

同时，仅提供一个返回事件的 HTTP endpoint 仍不足以证明可靠 sync。若客户端可以任意提交 `afterSeq/throughSeq`，一次错误或恶意请求就能把自己的 durable cursor 越过从未收到的 Room 事件，破坏“响应丢失后可以重放”的不变量。

## 决策

1. 新增独立 `ClientApplicationService`。它与 `WorkerApplicationService` 可以在同一 daemon process 中共享一个 `RoomKernel`，但使用独立监听端口、路由和 bearer authority：

   ```text
   Human principal PAT -> /v1|v2/client/* -> AuthenticatedActorContext -> RoomKernel
   Host-derived WAT    -> /v1/worker/* -> WorkerExecutionContext    -> RoomKernel
   ```

   Client service 不持有第二套 Room/Task/InputRequest 状态，不接受任意 SQL、shell command、actor、responder 或 Worker scope。

2. 当前 Client API 版本为 `2`。v1 保留原 Task/InputRequest/sync/ack 路由和窄 health capability；collaboration P2 的新增路由与扩展 capability 只在 v2 暴露，避免严格 v1 客户端因未知字段被静默破坏。v2 surface 为：

   | Route family                                       | Authority / result                                                     |
   | -------------------------------------------------- | ---------------------------------------------------------------------- |
   | `GET /v2/client/health`                            | content-free build/protocol/schema/capability/state                    |
   | `POST .../workspaces/list`, `.../rooms/list`       | authenticated principal 可见的 Workspace/Room discovery                |
   | `POST .../rooms/sync`, `.../rooms/acknowledge`     | authenticated member snapshot、ordered delta 与 durable receipt ack    |
   | `POST .../rooms/members/*`                         | Room ACL 下的 list/add/remove/role，写入要求 causal/idempotent command |
   | `POST .../messages/list`, `.../messages/post`      | paginated canonical Message query/send 与 durable attention 派生       |
   | `POST .../threads/list`, `.../create`, `.../reply` | Room-owned Thread/query/reply，不接受 Provider session identity        |
   | `POST .../tasks/*`                                 | canonical Task list/create/assign/unblock/cancel/complete              |
   | `POST .../input-requests/list`, `.../resolve`      | canonical projection 与 designated-responder causal resolution         |

   数据 route 每次都重新认证 principal PAT；actor 来自 credential，不来自 body。Room membership、designated responder、fresh context 与 idempotency 继续由 Kernel 强制。health 无需 bearer，但 schema 严格且不返回 Host ID、participant ID、token、路径或 Room 数据。

3. sync 使用两阶段 delivery proof。服务按 `credential hash + Room + consumer` 暂存已实际返回的 cursor：

   - 未显式传 `afterSeq` 时，从 Kernel durable cursor 恢复；
   - 显式 continuation 只能来自已 durable ack 的位置、向后安全重放的位置，或本 credential 实际收到的 cursor；
   - `throughSeq` 只能确认已收到的 cursor，或幂等重试一个已经 durable ack 的 cursor；
   - 服务重启会丢弃暂存 proof，但不会推进 durable cursor；客户端从旧 ack 位置重同步并取得新 proof 即可。

   暂存 proof 不是业务真相，也不能替代 `subscription_cursors`。每个 consumer 的未确认 cursor 集有上限，避免无界内存增长。

4. `resolve` 复用 protocol-owned `InputRequestResolveRequest/Response`。客户端必须先 sync 到最新 Room sequence，再携带 `basedOnRoomSeq`；若期间出现新 event，Kernel 返回 `stale_context`，客户端重新 sync 后重试。成功 resolution 原子产生 `input.resolved`、Task `waiting_input -> todo`、requester Inbox/Activation/Outbox；客户端 HTTP 成功本身不拉起或完成 CLI。

5. daemon config 升级到 schema v2，并要求显式 `client.bindHost/client.port`。当前只允许 `127.0.0.1`；测试可使用 port `0` 取得临时端口。Client service 在 runtime probe 和其他依赖准备后启动，daemon shutdown 时先停止接受 Client 请求，再关闭 Worker 和 Kernel；`DaemonApplication.clientOrigin()` 只在本次运行期间可见。

6. 当前不实现 CORS、SSE/WebSocket hint 或 LAN binding。这样不会以 wildcard CORS 提前暴露 PAT，也不会把 hint 误作顺序真相。Browser/PWA 接入前需另行实现明确 allowed origins、配对/credential storage 与 transport conformance；客户端仍以 reconnect → sync → ack 恢复。

## 证据

- protocol fixture 证明 Client API v1/v2 schema 严格、transport-neutral，拒绝 `actorId/responderId` 注入和越界 page size；
- standalone HTTP fixture 证明无 token=401、非成员=403、错误 responder=403、stale context=409，并覆盖 Workspace/Room discovery、成员角色、Message/Thread、分页 sync、显式 ack、durable ack 幂等、Task/InputRequest 查询和 resolution；
- 同一 fixture 证明 invented continuation/ack 被拒绝，且 health 不泄露 credential；
- daemon InputRequest fixture 中，Human 使用 Client API 完成 list → sync → resolve；等待期间无新 RunAttempt，resolution 后 content-free wake 拉起新 CLI session 并提交原 Task；
- daemon lifecycle fixture 证明 Client endpoint 仅在 daemon 运行期间存在，并随 shutdown 关闭。

## 声明边界

- 当前不是完整 `RahClient`：尚无 Workspace/Room create/archive、Inbox query/resolve、Artifact/Review、Run Inspector、hint subscription 或 daemon control command；现有 HTTP schema/route 是 SDK 的可执行 contract，不是 UI state owner。
- 当前 loopback HTTP 可供本机 shell、测试和未来 desktop bridge 使用；尚不能声明 raft-ui、普通浏览器或 iOS PWA 已接通。
- principal provisioning/revocation 管理面、Keychain、device pairing、CORS/TLS/LAN、rate limit 与审计导出尚未实现。
- Client delivery proof 当前是 daemon-memory evidence；重启后的预期恢复动作是重同步，不是确认旧 HTTP response。
- Client API v1/v2 与 daemon config v2/v3/v4 是不同版本轴；Kernel schema 当前为 v7，也独立演进。
