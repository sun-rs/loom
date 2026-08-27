# Worker Application Service

状态：`sync/ack`、Activation-scoped Room reply、Task `claim/start/progress/release/block/request-input/submit` 与 InputRequest 无 listening 恢复已达到本机 E2；Human Task coordination 与 InputRequest resolve 已由独立 Client service 提供。Artifact/Review command、远端 transport 和 production daemon endpoint 尚未实现。

## 1. 目的与 owner

外部 Agent CLI 不能直接打开 Kernel SQLite，也不能靠 stdout/JSONL 告诉 Host“我读过消息”。本机 AgentHost 为每次 Activation 发放短期 worker credential，进程通过 loopback HTTP 调用窄 application service：

```text
AgentHost lease Activation
  -> issue per-Activation credential
  -> spawn GenericProcessAdapter
  -> POST /v1/worker/sync
  -> Kernel returns canonical Room snapshot/delta
  -> POST /v1/worker/acknowledge
  -> Kernel persists consumer cursor
  -> optional POST /v1/worker/messages/post
  -> append one activation-scoped canonical Agent reply
  -> POST /v1/worker/tasks/get
  -> read canonical Task projection
  -> optional POST /v1/worker/tasks/input-status
  -> POST /v1/worker/tasks/claim|start|progress|release|block|request-input|submit
  -> Kernel persists Task projection + Room events
  -> process exits; credential revoked
  -> AgentHost verifies delivery proof and completes Activation
```

RoomKernel 始终是业务 owner。HTTP service 只做认证、scope、输入验证和 Kernel application call；GenericProcessAdapter 只做进程生命周期；Fake/Provider CLI 的输出仍是观察数据。

## 2. 当前接口

| Endpoint                              | 客户端可提交字段                             | 服务端固定字段                                            |
| ------------------------------------- | -------------------------------------------- | --------------------------------------------------------- |
| `POST /v1/worker/sync`                | 可选 `afterSeq`                              | actor、Room、consumer、Activation participant、`toSeq`    |
| `POST /v1/worker/acknowledge`         | `throughSeq`                                 | actor、Room、consumer                                     |
| `POST /v1/worker/messages/post`       | `basedOnRoomSeq`、`body`、`idempotencyKey`   | actor、Room、Activation、空 recipients                    |
| `POST /v1/worker/tasks/get`           | `taskId`                                     | actor、Room、Inbox delivery、Activation range             |
| `POST /v1/worker/tasks/input-status`  | `taskId`                                     | actor、Room、Inbox delivery、redacted latest InputRequest |
| `POST /v1/worker/tasks/claim`         | `taskId`、`idempotencyKey`、`basedOnRoomSeq` | actor、Room、assignee、claim lease                        |
| `POST /v1/worker/tasks/start`         | `taskId`、`idempotencyKey`、`basedOnRoomSeq` | actor、Room、assignee、claim lease                        |
| `POST /v1/worker/tasks/progress`      | 前述字段 + `progress`                        | actor、Room、assignee、claim lease                        |
| `POST /v1/worker/tasks/release`       | 前述基础字段                                 | actor、Room、owned claim                                  |
| `POST /v1/worker/tasks/block`         | 前述基础字段 + `reason`                      | actor、Room、owned in-progress claim                      |
| `POST /v1/worker/tasks/request-input` | 前述基础字段 + `question`                    | actor、Room、assignee、creator responder                  |
| `POST /v1/worker/tasks/submit`        | 前述基础字段 + `summary`                     | actor、Room、assignee                                     |

`afterSeq` 只有在同一 credential 曾收到过该 cursor 时才可用。这既支持分页，也防止 worker 直接跳到 Activation head。每次 sync 又被 grant 的 `toSeq` 硬截断，因此运行期间新到达的消息会留给 follow-up Activation，旧 credential 不会越界读取。`throughSeq` 必须是 service 已经向该 credential 返回过的 `cursorAfter`；任意自报序号以 `409` 拒绝。

所有公开 request/response/error envelope 与 credential scope 均由 `@rah-os/protocol` 的严格 Zod schema 拥有；application service 不再维护第二套字段定义。以后新增 Task/Artifact/Review endpoint 也必须先增加 protocol schema 和 conformance test。

Room reply 要求 `basedOnRoomSeq` 已由当前 bearer 实际收到且精确等于 Activation `toSeq`。它不接受 actor、Room、recipient、Thread 或 Task 字段；Kernel 固定使用 grant participant/Room/Activation，写入 `message.posted` 并返回空 `activationIds`。两个 execution 可以基于同一个 immutable Activation head 并发追加各自回复，不因另一条并行回复先落账而丢失。详细边界见 [ADR-0014](../adr/0014-activation-scoped-agent-room-reply.md)。

Task command 的 `basedOnRoomSeq` 必须是同一 credential 已经收到的 sync cursor，或前一个成功 Task command 返回的 event sequence。Task 必须属于 grant 固定的 Room，且关联 Task 的 canonical event 必须通过 Inbox 实际投递并位于本次 Activation range；仅猜到 ID 不构成权限。open Task 候选可读取并竞争 claim，但 claim 成功后的 mutation 必须持有当前 participant 的 active claim。业务幂等键应稳定绑定 Task/operation，不能绑定易失的 CLI session 或 RunAttempt。恢复 RunAttempt 先通过 `tasks/get` 读取 canonical projection；幂等 replay 不要求复用旧执行的 causal cursor，尚未落账的新步骤仍受当前 Room freshness 约束。

`request-input` 只接受 question，不允许 Worker 选择 responder。Kernel 将 Task creator 固定为当前 designated responder，原子创建 InputRequest、清除 claim 并把 Task 置为 `waiting_input`；该 response 会让 service 停止 sidecar heartbeat。人类 resolve 不属于 Worker bearer surface，而是经独立 `/v2/client/input-requests/resolve`（兼容 v1）使用 principal PAT；两种 authority 不可互换。

`input-status` 只返回 latest `inputRequestId/taskId/state`，明确排除 question/answer。它用于 Worker 在 InputRequest 已 commit、原 Activation ack 前崩溃后的新 session：确认 pause 已持久化，补 ack 后退出。answer 只有在 `input.resolved` 真正进入该 execution 的 Activation range 时才由 `sync` 交付。

当前没有通用 `/run`、通用 Message RPC、任意 Kernel method、任意 Room ID 或 shell endpoint，也没有 Task list、Artifact/Review endpoint。Worker 已增加严格的 Activation reply、`release` 与 `block` command；后续命令仍须逐个加入严格 schema，不能开放反射式 RPC。

## 3. Credential 边界

- token 使用 256-bit 随机值，service 只在内存中保存 SHA-256 hash；
- grant 由当前 authenticated Host instance 派生，固定绑定 Host credential/generation、Activation、Room、participant、consumer、RunAttempt 和目标序号；daemon 不持有 Agent PAT，也不会得到通用 Agent actor authority；
- 每次请求都重新验证 Activation lease、当前 RunAttempt 和 RuntimeProcess 状态；lease 过期、执行代次变化或 terminal proof 写入后，即使 token 尚未过 TTL 也返回 `execution_fenced`；
- profile env 与 worker request 都不能覆盖这些 server-owned 字段；
- token 有绝对 TTL，进程 exit 或 spawn failure 时由 environment lease 立即 revoke；
- claim/start/progress 成功后，service 用当前 execution grant 在 `taskClaimHeartbeatIntervalMs` 周期自动续租到 `taskClaimLeaseMs`；timer 不调用模型、不写 Room event，在 release、block、request-input、submit、credential revoke/expiry、execution fence 或 service close 时停止；
- service 固定监听 `127.0.0.1` 的随机端口，响应带 `Cache-Control: no-store`；
- 请求体上限 64 KiB，只接受 endpoint 白名单字段。

loopback 不是身份。Bearer scope 才是当前隔离边界；token 泄露给同一用户下的恶意本机进程仍属于尚未解决的主机隔离问题。未来可评估 Unix domain socket、peer credential、macOS sandbox/Keychain，但不能因此把 SQLite 暴露给 worker。

## 4. 已证明与未证明

确定性 fixture 已证明：

- AgentHost 拉起一个真实 Node 子进程；
- 子进程只靠临时 token 完成安全 continuation 的 `sync/ack`；另有 501 条消息跨 500-event 页上限的确定性测试，证明多页 cursor 只能沿已投递位置前进；
- 同一子进程通过四个窄 endpoint 完成 Task `claim/start/progress/submit`，Task projection 与 event chain 是唯一 pass/fail 依据；
- 两个独立 Worker execution 基于同一 Activation head 各写一条 canonical Room reply，actor/Room 由服务端固定，reply 不创建 Activation loop；
- strict Worker endpoint 已验证显式 `block(reason)` 会释放 claim、写 canonical evidence 并通知 creator；进程状态本身不会推断 block；
- activation-scoped query 返回 canonical Task projection；短 claim lease 下等待超过原 lease 后，后续 command 仍因 sidecar heartbeat 成功；
- 第一个 RunAttempt 在 `task.started` 后失败时，第二个 RunAttempt 可查询 projection、重放旧步骤并继续，最终不产生重复业务事件；
- Worker 通过严格 `request-input` command 原子释放 claim 并把 Task 置为 `waiting_input`；daemon fixture 证明 CLI 随即退出且等待期间不创建新 RunAttempt，人类 resolve 后的新 Activation 通过 `input.resolved` 重新获得原 Task scope；
- InputRequest commit 后、原 range ack 前故障时，重试 Worker 通过 redacted status query 收敛，不重复 request，也不越界读取 answer；
- 只做 `sync/ack` 后 exit=0 的 Task-assigned 子进程不能完成 Activation，AgentHost 会把原 Activation durable requeue；
- 未投递的 causal cursor、错误 assignee、Activation range 外 Task、字段注入、active claim 竞争与较新的业务上下文均 fail closed；Task command 的稳定幂等键可跨 RunAttempt 重放；
- AgentHost 不解析 stdout，仍能从 Kernel cursor 完成 Activation；
- 未投递 cursor、伪造 continuation/Room 字段、过期 token、过期 Activation lease 和 terminal execution 的 token 均被拒绝；
- spawn failure 也会释放 credential environment lease。

POSIX Generic process 的 identity-safe Host-exit recovery 已由独立受控 fixture 证明；Host token 只存 hash，已签发 context 会在每次 Kernel Host 操作时重新校验，credential revoke 或 daemon generation 接管会立即 fence 旧 Host/Worker context。fake MultiLane gate 已证明两个 Agent 都能回复同一 Room、竞争同一 open Task 时只有一个 owner且 loser 可正常结束；dependency 未就绪不 wake，最后一个 dependency 完成后从 canonical event 派生 Activation。真实 Codex/OpenCode/Kimi/Claude Code Sonnet 均已通过相同 `sync/ack` 链路，其中 Codex Luna 已进一步通过完整 Task gate；真实 Provider 尚未复跑 Activation reply。尚缺：InputRequest cancel/expire/structured answer、Artifact/Review、MCP/CLI façade、剩余 Human Client command/hint surface、Host credential 的受认证管理 API/Keychain 存储/轮换审计、Windows recovery 和完整故障矩阵。
