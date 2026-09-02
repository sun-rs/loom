# Worker Application Service

状态：`sync/ack`、Activation-scoped Room reply、Task `claim/start/progress/release/block/request-input/submit/review`、Task-scoped `artifact-publish`、activation-scoped `rah worker` CLI 与 InputRequest 无 listening 恢复已达到本机 E2；Human Task coordination、Review evidence query 与 InputRequest resolve 已由独立 Client service 提供。跨机器 Worker transport 和 production LAN endpoint 尚未实现；managed MCP 已有 version-fenced 窄调用面。

## 1. 目的与 owner

外部 Agent CLI 不能直接打开 Kernel SQLite，也不能靠 stdout/JSONL 告诉 Host“我读过消息”。本机 AgentHost 为每次 Activation 发放短期 worker credential，进程通过 loopback HTTP 调用窄 application service：

```text
AgentHost lease Activation
  -> issue per-Activation credential
  -> spawn GenericProcessAdapter
  -> install token-free `rah` wrapper and publish absolute `RAH_WORKER_CLI`
  -> `"$RAH_WORKER_CLI" worker sync` -> POST /v1/worker/sync
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
  -> optional POST /v1/worker/artifacts/prepare + bounded binary PUT
  -> Kernel stages an explicit Task/Agent/RunAttempt-scoped artifact
  -> task submit atomically binds it to the submission Thread message and Room Files
  -> selected reviewer receives task.submitted and POST /v1/worker/tasks/review
  -> Kernel persists immutable Review bound to the current TaskSubmission
  -> process exits; credential revoked
  -> AgentHost verifies delivery proof and completes Activation
```

RoomKernel 始终是业务 owner。HTTP service 只做认证、scope、输入验证和 Kernel application call；GenericProcessAdapter 只做进程生命周期；Fake/Provider CLI 的输出仍是观察数据。

## 2. 当前接口

| Endpoint                              | 客户端可提交字段                                                       | 服务端固定字段                                            |
| ------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------- |
| `POST /v1/worker/sync`                | 可选 `afterSeq`                                                        | actor、Room、consumer、Activation participant、`toSeq`    |
| `POST /v1/worker/acknowledge`         | `throughSeq`                                                           | actor、Room、consumer                                     |
| `POST /v1/worker/messages/post`       | `basedOnRoomSeq`、`body`、`idempotencyKey`                             | actor、Room、Activation、空 recipients                    |
| `POST /v1/worker/tasks/get`           | `taskId`                                                               | actor、Room、Inbox delivery、Activation range             |
| `POST /v1/worker/tasks/input-status`  | `taskId`                                                               | actor、Room、Inbox delivery、redacted latest InputRequest |
| `POST /v1/worker/tasks/claim`         | `taskId`、`idempotencyKey`、`basedOnRoomSeq`                           | actor、Room、assignee、claim lease                        |
| `POST /v1/worker/tasks/start`         | `taskId`、`idempotencyKey`、`basedOnRoomSeq`                           | actor、Room、assignee、claim lease                        |
| `POST /v1/worker/tasks/progress`      | 前述字段 + `progress`                                                  | actor、Room、assignee、claim lease                        |
| `POST /v1/worker/tasks/release`       | 前述基础字段                                                           | actor、Room、owned claim                                  |
| `POST /v1/worker/tasks/block`         | 前述基础字段 + `reason`                                                | actor、Room、owned in-progress claim                      |
| `POST /v1/worker/tasks/request-input` | 前述基础字段 + `question`                                              | actor、Room、assignee、creator responder                  |
| `POST /v1/worker/tasks/submit`        | 前述基础字段 + `summary`                                               | actor、Room、assignee                                     |
| `POST /v1/worker/tasks/review`        | `taskId`、`basedOnRoomSeq`、`idempotencyKey`、`disposition`、`summary` | actor、Room、reviewer、当前 frozen submission             |
| `POST /v1/worker/artifacts/prepare`   | `taskId`、filename、MIME、size、`idempotencyKey`                       | actor、Room、RunAttempt、Blob owner                       |
| `PUT /v1/worker/artifacts/:id`        | 预约文件的原始字节，可选 SHA-256                                       | 当前 credential、预约 identity、精确长度与最终摘要        |

`afterSeq` 只有在同一 credential 曾收到过该 cursor 时才可用。这既支持分页，也防止 worker 直接跳到 Activation head。每次 sync 又被 grant 的 `toSeq` 硬截断，因此运行期间新到达的消息会留给 follow-up Activation，旧 credential 不会越界读取。`throughSeq` 必须是 service 已经向该 credential 返回过的 `cursorAfter`；任意自报序号以 `409` 拒绝。

所有公开 request/response/error envelope 与 credential scope 均由 `@rah-os/protocol` 的严格 Zod schema 拥有；application service 不再维护第二套字段定义。以后新增 Task/Artifact/Review endpoint 也必须先增加 protocol schema 和 conformance test。

Room reply 要求 `basedOnRoomSeq` 已由当前 bearer 实际收到且精确等于 Activation `toSeq`。它不接受 actor、Room、recipient、Thread 或 Task 字段；Kernel 固定使用 grant participant/Room/Activation。Kernel 从 `toSeq` 对应因果事件读取当前 participant 的 canonical recipient reason；只有 `thread_subscription` 才提取 `threadId`，在同一事务把回复写入该 Thread 并更新回复计数，CLI 不能猜测或覆盖 Thread。路由不能只读 Activation 初始 reason，因为 queued lane 会合并后续事件；例如根消息先建立 `room_policy` Activation、Thread 消息随后扩展 `toSeq` 时，仍必须按最新 Thread 事件投递。

发送前 Kernel 执行 Raft 风格的 target-specific freshness check：根消息只比较新的根 `message.posted`，Thread 回复只比较同 Thread。若 target 已前进，本次回复不写进 Room，而是持久化到 `held_message_drafts` 并返回 `state: held`、稳定 `heldDraftId`、`reholdCount`、`continueAnywaySuggested` 和有限的 `newerMessages`；相同 idempotency key 只能重放同一结果。Worker 可在 follow-up 中正常改写、用 `--send-draft --held-draft-id` 发送原稿（仍重查）、不发送，或仅在 `reholdCount=2` 后显式加 `--anyway`。普通编写请求没有 override 字段；草稿十分钟到期由 Kernel 初始化／Activation 租约维护解析。成功落账的根回复会为同 Room 内除发送者外的已启用 Agent 派生 attention，Thread 回复只派发给 canonical thread subscribers。Agent 消息只是可查询、可租约化的协作信号，不代表必须再发消息。详细边界和 Raft 来源边界见 [ADR-0014](../adr/0014-activation-scoped-agent-room-reply.md)。

Task command 的 `basedOnRoomSeq` 必须是同一 credential 已经收到的 sync cursor，或前一个成功 Task command 返回的 event sequence。Task 必须属于 grant 固定的 Room，且关联 Task 的 canonical event 必须通过 Inbox 实际投递并位于本次 Activation range；仅猜到 ID 不构成权限。open Task 候选可读取并竞争 claim，但 claim 成功后的 mutation 必须持有当前 participant 的 active claim。业务幂等键应稳定绑定 Task/operation，不能绑定易失的 CLI session 或 RunAttempt。恢复 RunAttempt 先通过 `tasks/get` 读取 canonical projection；幂等 replay 不要求复用旧执行的 causal cursor，尚未落账的新步骤仍受当前 Room freshness 约束。

`request-input` 只接受 question，不允许 Worker 选择 responder。Kernel 将 Task creator 固定为当前 designated responder，原子创建 InputRequest、清除 claim 并把 Task 置为 `waiting_input`；该 response 会让 service 停止 sidecar heartbeat。人类 resolve 不属于 Worker bearer surface，而是经独立 `/v2/client/input-requests/resolve`（兼容 v1）使用 principal PAT；两种 authority 不可互换。

`input-status` 只返回 latest `inputRequestId/taskId/state`，明确排除 question/answer。它用于 Worker 在 InputRequest 已 commit、原 Activation ack 前崩溃后的新 session：确认 pause 已持久化，补 ack 后退出。answer 只有在 `input.resolved` 真正进入该 execution 的 Activation range 时才由 `sync` 交付。

Artifact 入口只允许当前 credential 的 Agent 为同一 Room 内自己已 claim、处于 `in_progress` 的 Task 发布显式文件。请求不能提交 actor、Room 或 RunAttempt，也不能要求 daemon 读取 Computer 路径；`artifact-publish` 在 Agent 所在 Computer 上以 `O_NOFOLLOW` 打开普通非空文件后流式上传。未提交文件不进入 Room Files；`task-submit` 在同一事务中把该 Task/producer 的未归属完成文件绑定到提交 Thread message，并冻结进 TaskSubmission digest。

当前没有通用 `/run`、通用 Message RPC、任意 Kernel method、任意 Room ID 或 shell endpoint，也没有 Task list。Review 只有绑定 `task_review` Activation 与当前 submission 的严格 command；后续命令仍须逐个加入严格 schema，不能开放反射式 RPC。

## 3. `rah worker` transport

Provider 不需要也不应手写 bearer HTTP。AgentHost 为每个 Activation 在 credential 目录生成 mode `0700`、不含 token 的 `rah` wrapper，将目录置于最终 child `PATH` 首位，并以 `RAH_WORKER_CLI` 发布同一 wrapper 的绝对路径；standing prompt 固定调用 `"$RAH_WORKER_CLI" worker ...`，不依赖 Provider 的 login shell 是否保留 PATH。wrapper 调用固定的 TypeScript CLI，SEA 则经精确 `__worker-cli` 分派进入同一实现。CLI 只允许上表对应的 `sync/ack/message/task` 命令，把 flag 映射为严格 JSON；它拒绝重复/未知 flag、任意 URL、非 owner-private session file、超限参数与超限/非 JSON 响应，并使用 30 秒请求 deadline。Provider 看不到内部 tool-bin hint，不能通过 RuntimeProfile 注入 daemon-owned `RAH_AGENT_*` 或 `RAH_WORKER_*` 变量。

该 transport 只是 Worker application service 的本地客户端，不成为新的业务 owner。默认 standing prompt 和真实 CLI opt-in gate 都只教 Agent 逐条调用绝对 `RAH_WORKER_CLI`；受控 fake 外部进程与真实 Codex/Kimi/OpenCode 已实际通过 wrapper 完成 canonical Message/Task/ack。standing prompt 明确规定普通讨论只 `message-post` 一次；`task-claim-message` 成功后必须在同一 Activation 继续 `task-start -> work -> task-progress -> [artifact-publish] -> task-submit`，竞争冲突方 ack 原 cursor 后退出，不发布竞争性答复。只有 Agent 明确选定的结果文件才发布，不能扫描 cwd 或从 Provider 日志推断产物。被选中的 reviewer 必须使用 `task-review`，不能把 `message-post` 冒充 Review；`changes_requested` 唤醒 owner 产生新 submission。Windows wrapper 与完整跨机器故障门禁仍未实现。

## 4. Credential 边界

- token 使用 256-bit 随机值，service 只在内存中保存 SHA-256 hash；
- grant 由当前 authenticated Host instance 派生，固定绑定 Host credential/generation、Activation、Room、participant、consumer、RunAttempt 和目标序号；daemon 不持有 Agent PAT，也不会得到通用 Agent actor authority；
- 每次请求都重新验证 Activation lease、当前 RunAttempt 和 RuntimeProcess 状态；lease 过期、执行代次变化或 terminal proof 写入后，即使 token 尚未过 TTL 也返回 `execution_fenced`；
- profile env 与 worker request 都不能覆盖这些 server-owned 字段；
- token 有绝对 TTL；AgentHost 将它写入每 Activation 唯一 `0700` 目录内的 `0600` session file，并在该目录生成 token-free `rah` wrapper。Provider 只收到 session-file path、Worker origin 与非敏感 wrapper 绝对路径，不收到明文 bearer 或内部 tool-bin hint。进程 exit 或 spawn failure 时 environment lease 同时尝试立即 revoke 与删除精确目录；
- claim/start/progress 成功后，service 用当前 execution grant 在 `taskClaimHeartbeatIntervalMs` 周期自动续租到 `taskClaimLeaseMs`；timer 不调用模型、不写 Room event，在 release、block、request-input、submit、credential revoke/expiry、execution fence 或 service close 时停止；
- service 固定监听 `127.0.0.1` 的随机端口，响应带 `Cache-Control: no-store`；
- 请求体上限 64 KiB，只接受 endpoint 白名单字段。

loopback 不是身份。Bearer scope 才是当前隔离边界；token 泄露给同一用户下的恶意本机进程仍属于尚未解决的主机隔离问题。未来可评估 Unix domain socket、peer credential、macOS sandbox/Keychain，但不能因此把 SQLite 暴露给 worker。

## 5. 已证明与未证明

确定性 fixture 已证明：

- AgentHost 拉起一个真实 Node 子进程；
- 子进程通过 token-free `rah` wrapper 的绝对 `RAH_WORKER_CLI` 完成安全 continuation 的 `sync/ack`，并主动拒绝 legacy raw token 环境；另有 501 条消息跨 500-event 页上限的确定性测试，证明多页 cursor 只能沿已投递位置前进；
- 同一子进程通过四个窄 endpoint 完成 Task `claim/start/progress/submit`，Task projection 与 event chain 是唯一 pass/fail 依据；
- owner submission 原子冻结为 TaskSubmission，reviewer 只能对 Activation 实际投递的当前 submission 写一次 `approved|changes_requested` Review；旧 Review 不能完成新 submission；
- Agent 使用 token-free wrapper 从本机显式路径发布 Task Artifact；prepare 请求不泄漏主机路径或接受 actor/Room/RunAttempt，上传完成前和 Task 提交前均不出现在 Room Files；
- `task-submit` 原子把同 Task/producer 的未归属文件绑定到 submission Thread message、冻结 Artifact metadata/provenance/digest，并由 Room Files 读取同一 Message owner；真实浏览器已验证 Thread、Files、预览、下载入口和精确跳回提交回复；
- 两个独立 Worker execution 基于同一 Activation head 各写一条 canonical Room reply，actor/Room 由服务端固定，reply 不创建 Activation loop；
- `thread_subscription` Worker reply 由 Kernel 根据 Activation 因果事件固定写入原 Thread，更新 `reply_count/last_reply_at`，而请求仍无法注入 `threadId`；该路径另经真实 Codex Direct Room 浏览器主链验证；
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

POSIX Generic process 的 identity-safe Host-exit recovery 已由独立受控 fixture 证明；Host token 只存 hash，已签发 context 会在每次 Kernel Host 操作时重新校验，credential revoke 或 daemon generation 接管会立即 fence 旧 Host/Worker context。fake MultiLane gate 已证明两个 Agent 都能回复同一 Room、竞争同一 open Task 时只有一个 owner且 loser 可正常结束；dependency 未就绪不 wake，最后一个 dependency 完成后从 canonical event 派生 Activation。2026-08-29 的隔离付费门禁已让 Codex `gpt-5.6-sol/low`、Kimi `kimi-code/k3` 与 OpenCode `deepseek/deepseek-v4-flash/max` 在同一 Room 先完成普通 Message 三回复且零 Task，再对持久执行请求并发判定并收敛为一个 `submitted` Task、一个 owner 和两条同 owner Thread 回复；结论来自 Kernel Message/Task/Inbox 和工作区文件，不来自 stdout。正式 Web fixture 又从 Human 浏览器操作复现同一链路、Agent Activity 与 Kimi owner/Alice reviewer 的 frozen TaskSubmission/Review/Human completion；隔离真实浏览器随后证明 fake Agent 的显式 Artifact 随 submission 同时进入 Thread 与 Room Files，预览后 daemon 不崩溃，原消息 deep link 精确打开 submission Thread。它仍不证明 Kimi effort、frozen Git diff 或跨机器 Artifact transport。尚缺：InputRequest cancel/expire/structured answer、剩余 Human Client command/hint surface、Host credential 的受认证管理 API/Keychain 存储/轮换审计、Windows recovery 和完整故障矩阵。
