# Worker Application Service

状态：`sync/ack`、Activation-scoped Room reply、Task `claim/start/progress/release/block/request-input/submit/review`、Task-scoped `artifact-publish`、activation-scoped `rah worker` CLI 与 InputRequest 无 listening 恢复已达到本机 E2；Human Task coordination、Review evidence query 与 InputRequest resolve 已由独立 Client service 提供。跨机器 Worker transport 和 production LAN endpoint 尚未实现；RAH 托管 MCP 已由用户明确退役，不再提供调用面。

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

下表是原执行主链的字段摘要，并非完整路由清单。当前逐项来源及差异以
[Raft Agent API 合同映射](../product/raft-agent-api-contract-map.zh-CN.md)为准。
2026-09-08 的新增面包括：

- Room 只读：`messages/history|resolve`、`room/members`、`server/info`、`profiles/get`、`tasks/list|history`。历史使用有界冻结分页，完整记录按 UTF-8 响应预算返回；读取不等于 ACK，不推进执行写入 cursor。
- 普通讨论附件：`attachments/prepare|cancel` 和 `attachments/:id` 的 PUT/GET，复用 Room Files 生命周期；显式 `message-post` 绑定后才是发布附件，不要求创建 Task。
- 闲置任务管理：`tasks/assign` 的 nullable assignee 及 `tasks/convert`，复用既有 Task 事务；仅本人创建的闲置 Task 可改派，转换消息不自动认领。
- 父任务恢复：`tasks/unblock` 复用 Human unblock 事务，只允许当前 assignee 恢复本人已在执行范围内阻塞的 Task；依赖完成、无 pending input、freshness 与执行围栏必须成立。解除后产生持久 attention，ACK/退出后由新 Activation claim/start，不把原 Run 临时扩大为新执行。
- 自身公开资料：`profile/self/get|update` 及 `PUT profile/self/avatar`。只允许本人名称、描述、头像，使用独立 control Room sequence 和 Agent revision CAS；不推进工作 Room frontier，不修改当前 Run 冻结上下文。头像复用既有 image store、upload intent 与 GC，不允许任意远程 URL 导入。

这些接口仍经过当前 execution、成员与认证围栏；新增读取能力不是通用业务写权限。

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

Room reply 要求 `basedOnRoomSeq` 为当前执行允许的因果位置。actor、Room 和 recipient 由服务端确定；Worker 可以显式传 `threadId` 或 `null`（顶层），CLI 对应互斥的 `--thread-id` / `--top-level`。目标必须在同一 Room 且已处于当前执行因果范围，或是本 Run 显式创建 Task 的 Thread。多个 Thread 合并唤醒不能用最后一条事件替所有消息决定回复位置；不明确的目标必须显式选择。held draft 冻结原目标及附件，幂等重试比较原始业务意图，不随成员或收件人变化重新解释。具体来源和反例见 [协作核心收口](../audits/2026-09-08-collaboration-core-closure.zh-CN.md)。

发送前 Kernel 执行 Raft 风格的 target-specific freshness check：根消息只比较新的根 `message.posted`，Thread 回复只比较同 Thread。若 target 已前进，本次回复不写进 Room，而是持久化到 `held_message_drafts` 并返回 `state: held`、稳定 `heldDraftId`、`reholdCount`、`continueAnywaySuggested` 和有限的 `newerMessages`；相同 idempotency key 只能重放同一结果。Worker 可在 follow-up 中正常改写、用 `--send-draft --held-draft-id` 发送原稿（仍重查）、不发送，或仅在 `reholdCount=2` 后显式加 `--anyway`。普通编写请求没有 override 字段；草稿十分钟到期由 Kernel 初始化／Activation 租约维护解析。成功落账的根回复会为同 Room 内除发送者外的已启用 Agent 派生 attention，Thread 回复只派发给 canonical thread subscribers。Agent 消息只是可查询、可租约化的协作信号，不代表必须再发消息。详细边界和 Raft 来源边界见 [ADR-0014](../adr/0014-activation-scoped-agent-room-reply.md)。

Task command 的 `basedOnRoomSeq` 必须是同一 credential 已经收到的 sync cursor，或前一个成功 Task command 返回的 event sequence。Task mutation 必须属于 grant 固定的 Room，且关联 Task 的 canonical event 必须通过 Inbox 实际投递并位于本次 Activation range，或有本 Run 本 Agent 的 `task.created` 原始事件证明；仅查询到 ID 不构成写权限。open Task 候选可读取并竞争 claim，但 claim 成功后的 mutation 必须持有当前 participant 的 active claim。业务幂等键应稳定绑定 Task/operation，不能绑定易失的 CLI session 或 RunAttempt。恢复 RunAttempt 先通过 `tasks/get` 读取 canonical projection；幂等 replay 不要求复用旧执行的 causal cursor，尚未落账的新步骤仍受当前 Room freshness 约束。

`request-input` 只接受 question，不允许 Worker 选择 responder。Kernel 优先选择仍在 Room 内的 Human creator；Agent 创建的 Task 则只在当前 Room 恰有一位 Human 时选择该 Human，零位或多位均拒绝，原子创建 InputRequest、清除 claim 并把 Task 置为 `waiting_input`；该 response 会让 service 停止 sidecar heartbeat。人类 resolve 不属于 Worker bearer surface，而是经独立 `/v2/client/input-requests/resolve`（兼容 v1）使用 principal PAT；两种 authority 不可互换。

`input-status` 只返回 latest `inputRequestId/taskId/state`，明确排除 question/answer。它用于 Worker 在 InputRequest 已 commit、原 Activation ack 前崩溃后的新 session：确认 pause 已持久化，补 ack 后退出。answer 只有在 `input.resolved` 真正进入该 execution 的 Activation range 时才由 `sync` 交付。

Artifact 入口只允许当前 credential 的 Agent 为同一 Room 内自己已 claim、处于 `in_progress` 的 Task 发布显式文件。请求不能提交 actor、Room 或 RunAttempt，也不能要求 daemon 读取 Computer 路径；`artifact-publish` 在 Agent 所在 Computer 上以 `O_NOFOLLOW` 打开普通非空文件后流式上传。未提交文件不进入 Room Files；`task-submit` 在同一事务中把该 Task/producer 的未归属完成文件绑定到提交 Thread message，并冻结进 TaskSubmission digest。

当前没有通用 `/run`、通用 Message RPC、任意 Kernel method、任意 Room ID 或 shell endpoint。Task list、历史、submission 和证据读取按同 Room 成员可见性授权；读到新任务不会让当前 Run 获得 claim/start 等写权限。Review 只有绑定 `task_review` Activation 与当前 submission 的严格 command；后续命令仍须逐个加入严格 schema，不能开放反射式 RPC。

## 3. `rah worker` transport

Provider 不需要也不应手写 bearer HTTP。AgentHost 为每个 Activation 在 credential 目录生成 mode `0700`、不含 token 的 `rah` wrapper，将目录置于最终 child `PATH` 首位，并以 `RAH_WORKER_CLI` 发布同一 wrapper 的绝对路径；standing prompt 固定调用 `"$RAH_WORKER_CLI" worker ...`，不依赖 Provider 的 login shell 是否保留 PATH。wrapper 调用固定的 TypeScript CLI，SEA 则经精确 `__worker-cli` 分派进入同一实现。CLI 只允许上表对应的 `sync/ack/message/task` 命令，把 flag 映射为严格 JSON；它拒绝重复/未知 flag、任意 URL、非 owner-private session file、超限参数与超限/非 JSON 响应，并使用 30 秒请求 deadline。Provider 看不到内部 tool-bin hint，不能通过 RuntimeProfile 注入 daemon-owned `RAH_AGENT_*` 或 `RAH_WORKER_*` 变量。

该 transport 只是 Worker application service 的本地客户端，不成为新的业务 owner。默认 standing prompt 和真实 CLI opt-in gate 都只教 Agent 逐条调用绝对 `RAH_WORKER_CLI`；受控 fake 外部进程与真实 Codex/Kimi/OpenCode 已实际通过 wrapper 完成 canonical Message/Task/ack。standing prompt 明确规定普通讨论只 `message-post` 一次；`task-claim-message` 成功后必须在同一 Activation 继续 `task-start -> work -> task-progress -> [artifact-publish] -> task-submit`，竞争冲突方 ack 原 cursor 后退出，不发布竞争性答复。只有 Agent 明确选定的结果文件才发布，不能扫描 cwd 或从 Provider 日志推断产物。被选中的 reviewer 必须使用 `task-review`，不能把 `message-post` 冒充 Review；`changes_requested` 唤醒 owner 产生新 submission。Windows wrapper 与完整跨机器故障门禁仍未实现。

## 4. Credential 边界

- token 使用 256-bit 随机值，service 只在内存中保存 SHA-256 hash；
- grant 由当前 authenticated Host instance 派生，固定绑定 Host credential/generation、Activation、Room、participant、consumer、RunAttempt 和目标序号；daemon 不持有 Agent PAT，也不会得到通用 Agent actor authority；
- 每次请求都重新验证 bearer、Activation lease、当前 RunAttempt 和 RuntimeProcess 状态；JSON body 异步读取结束后重新认证，二进制上传通过原 RoomFiles owner 检查在异步文件操作后、completed 提交前再次认证；lease 过期、执行代次变化或 terminal proof 写入后，即使 token 尚未过 TTL 也返回 `execution_fenced`；
- profile env 与 worker request 都不能覆盖这些 server-owned 字段；
- token 有绝对 TTL；AgentHost 将它写入每 Activation 唯一 `0700` 目录内的 `0600` session file，并在该目录生成 token-free `rah` wrapper。Provider 只收到 session-file path、Worker origin 与非敏感 wrapper 绝对路径，不收到明文 bearer 或内部 tool-bin hint。进程 exit 或 spawn failure 时 environment lease 同时尝试立即 revoke 与删除精确目录；
- claim/start/progress 成功后，service 用当前 execution grant 在 `taskClaimHeartbeatIntervalMs` 周期自动续租到 `taskClaimLeaseMs`；timer 不调用模型、不写 Room event，在 release、block、request-input、submit、credential revoke/expiry、execution fence 或 service close 时停止；
- service 固定监听 `127.0.0.1` 的随机端口，响应带 `Cache-Control: no-store`；
- 请求体上限 64 KiB，只接受 endpoint 白名单字段。

loopback 不是身份。Bearer scope 才是当前隔离边界；token 泄露给同一用户下的恶意本机进程仍属于尚未解决的主机隔离问题。未来可评估 Unix domain socket、peer credential、macOS sandbox/Keychain，但不能因此把 SQLite 暴露给 worker。

`task-submit` 在异步采集 Git 交付证据后、准备 patch Artifact 前，以及最终
TaskSubmission 事务前重验当前 Bearer。内部 patch 上传复用 RoomFiles 动态
授权检查；撤销或到期后不得提交 Task、创建 Submission 或绑定公开文件。
这是 RAH 已有认证合同的修复，不宣称已经证明 Raft 服务端采用相同时序。

RAH 托管 MCP 的目录/调用接口已退出产品范围；既往异步授权修复仅作为
历史证据保留，不重新启用该功能。见[退役决定](../product/managed-mcp-retirement.zh-CN.md)。
Room Worker CLI/HTTP 以及 Provider 自身工具通信不受该范围决定影响。

## 5. 已证明与未证明

本节保留历次主链证据；2026-09-08 新增工具分别以 [只读工具](../audits/2026-09-08-worker-read-tools-closure.zh-CN.md)、[普通讨论附件](../audits/2026-09-08-worker-discussion-attachments-closure.zh-CN.md)、[任务管理](../audits/2026-09-08-worker-task-management-closure.zh-CN.md)及[自身资料](../audits/2026-09-08-worker-self-profile-closure.zh-CN.md)为准。实现、确定性真实子进程、付费模型、官网对照与正式部署分别记录；任意一层不证明其余层。

确定性 fixture 已证明：

- AgentHost 拉起一个真实 Node 子进程；
- 子进程通过 token-free `rah` wrapper 的绝对 `RAH_WORKER_CLI` 完成安全 continuation 的 `sync/ack`，并主动拒绝 legacy raw token 环境；另有 501 条消息跨 500-event 页上限的确定性测试，证明多页 cursor 只能沿已投递位置前进；
- 同一子进程通过四个窄 endpoint 完成 Task `claim/start/progress/submit`，Task projection 与 event chain 是唯一 pass/fail 依据；
- owner submission 原子冻结为 TaskSubmission，reviewer 只能对 Activation 实际投递的当前 submission 写一次 `approved|changes_requested` Review；旧 Review 不能完成新 submission；
- Agent 使用 token-free wrapper 从本机显式路径发布 Task Artifact；prepare 请求不泄漏主机路径或接受 actor/Room/RunAttempt，上传完成前和 Task 提交前均不出现在 Room Files；
- `task-submit` 原子把同 Task/producer 的未归属文件绑定到 submission Thread message、冻结 Artifact metadata/provenance/digest，并由 Room Files 读取同一 Message owner；真实浏览器已验证 Thread、Files、预览、下载入口和精确跳回提交回复；
- 两个独立 Worker execution 基于同一 Activation head 各写一条 canonical Room reply，actor/Room 由服务端固定，reply 不创建 Activation loop；
- `thread_subscription` Worker reply 由 Kernel 根据 Activation 因果事件固定写入原 Thread，更新 `reply_count/last_reply_at`，早期版本的该路径经真实 Codex Direct Room 浏览器主链验证；当前显式目标与多 Thread 合并反例见上方 2026-09-08 协作审计，不能将早期证据扩展到新增行为；
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

## 2026-09-08：Worker 上传能力查询

`POST /v1/worker/attachments/capabilities` / `rah worker attachment-capabilities` 接受严格空对象。身份来自当前 Worker execution，并由既有 WorkerReadService 重新验证运行围栏及 Room 成员；不接受 actor、Room、Task、上传模式参数，不调用 sync/ACK、不产生事件、预约或写权限。

返回 `directUploadEnabled: false`、`directUploadThresholdBytes: null`、`maxBytes: 209715200`、`sessionExpiresInSeconds: 3600`。最大值由 protocol 的现行 `MAX_ATTACHMENT_BYTES` 持有；预约寿命由 `ATTACHMENT_UPLOAD_SESSION_EXPIRES_IN_SECONDS` 持有，并被普通消息及 Task artifact 的真正预约路径共同使用。false/null 表示本地没有 Raft 的预签名对象直传路径；3600 是本地预约有效期，不是对 Raft 中央服务配置的推断。查询值不是剩余磁盘/并发容量承诺；原有上传权限、精确字节验证、发布绑定、过期/取消与 GC 继续适用。

来源：Raft Computer 1.0.18 `attachmentUploadContract.ts:39–44,143–151` 的四字段能力合同，以及 `agentApiContract.ts:2019–2027` 的 Agent 入口。RAH 用现有 Worker POST facade 和本地限制值进行结构适配，不复制 S3、云订阅或大文件流式能力。Multica 当前源码仅借鉴现有上传 owner/限制模式，未新增依赖。

## 2026-09-08：Task amend

2026-09-08：Task 标题/描述修改由 `TaskAmendmentService` 单事务拥有，HumanApplicationPort/SDK `task.amend` 与 Activation-scoped Worker HTTP/CLI 只委派。权限为当前可发言成员，不复用 creator-only assignment；Worker 保留 active execution、current membership、Room 与因果范围围栏。只更新 Task 卡片及追加 `task.amended`，不更改原 Message、负责人、claim 或 Run。历史使用共用 `task-history-projection.ts` 安全投影 `changes.title/description.from/to`，幂等绑定 actor/Task/显式 patch；归档/撤销/旧上下文在事务内拒绝。

修改复用 `task_updated` 通知原 assignee（不自唤醒），下一 Activation 的 `task.amended` delivery 可识别原 Task，仍须原 claim/状态门禁。合法字段最坏 JSON 成本要求 Task history 独立 1 MiB 行/2 MiB 页/传输预算；Room 同步另有 protocol-owned `ROOM_SYNC_RESPONSE_MAX_BYTES=2 MiB`，SQLite iterator 累积包含真实 envelope/snapshot 的完整 prefix，cursorAfter 只到已返回末条。其它 Worker 读工具保持原限制。源证据、RED/GREEN、独立审计及远程 relay 限制见[本批收口记录](../audits/2026-09-08-task-amend-upload-capabilities.zh-CN.md)。

## 附件评论读取与定位元数据（2026-09-08）

Raft Computer 1.0.18 的 `attachmentCommentsList` 是 read 能力；官方 Web
1.12.0 的 `Lw` 通过 `/attachments/:id/comments` 创建/读取评论，并将返回的
Message 放入既有消息 store。`Q8e` 识别 `lines`、`csv-rows`、`md-section`、
`html-region` 和 `video-timestamp`。这些源码证明评论与 anchor 合同，不能证明
未知 Server 的数据库结构或解决/重新打开权限。

本地唯一 owner 为 Kernel `AttachmentCommentsService`：正文仍是 canonical
Thread Message，`attachment_comment_links` 只关联已发布附件、Message 和原样
`type/data` anchor。Thread 内附件复用所在 Thread，绝不创建嵌套 Thread；
一个父 Message 下的多个附件复用既有 Thread，读取按附件过滤；
这是适配 RAH 的单 Room/Thread 模型，不宣称与 Raft Server 内部拓扑相同。
创建 Thread、消息事件、附件关联和既有 attention/outbox 同事务提交；失败全部回滚。

Human SDK `file.comment` / `file.comments` 分别接
`/v3/client/files/comments/post` / `list`；Worker
`attachment-comments --attachment-id ID [--limit N] [--before-room-seq N]`
接 `/v1/worker/attachments/comments`。Worker 评论读取不产生写入；回复复用既有 `message-post --comment-attachment-id ID --thread-id ID`。
附件目标显式指定，不能把同一 Thread 内普通回复或其他附件的回复猜成该附件评论。
执行者、Room/Thread、附件可见性和原消息因果约束由既有 Worker 写 owner 校验。
需要暂存时，评论目标写入同一 held draft 的 metadata，后续 Run `send-draft` 原样恢复，
不允许调用者替换目标。评论标记、Message/Outbox 同事务提交。
每次读取重新认证当前 Run 和附件所在 Room 的成员关系；跨已加入 Room 的读取
不扩张原 Activation 的 ACK、Task 或消息写权限。未发布、取消或无权附件不暴露评论。

列表按最新有限页倒序选取、页内按消息顺序返回，锚定 `beforeRoomSeq` 向旧历史继续；
整行字节限制复用 Worker 读取预算，完整保留 anchor，超大单行明确失败。
读取不创建 Inbox/Activation，不确认投递。回应来自既有 `message_reactions` 与事件时间，
没有另建 reaction 状态。首次实现未声明 Raft 可选 `resolved/resolveAction` 语义已对齐，
也未声明浏览器评论面板、媒体点击定位已验收。

Kernel schema 53 包含附件评论关系与 Agent 频道注意力偏好，兼容迁移仍保留历史数据；
较旧 binary 必须因 schema 版本拒绝启动，不能忽略新持久状态后继续执行。

## 公开运行资料与身份自检（2026-09-08）

- `visibleWorkerProfile` 是只读公开资料唯一投影；`profiles/get`、`room/members`、`server/info` 共用。新metadata字段在schema为optional，当前新owner始终返回；旧消费者和历史fixture可兼容。
- `configured` 只返回实际 Agent current revision 关联 policy 的模型选择、reasoning、toolAccessMode，以及其明确 allowedOfferIds 的注册 runtime profile/model descriptors。`modelSelection` 区分绑定、能力类、runtime默认；`runtimeTargetsRestricted=false` 表示没有限定offer IDs，不把空数组伪报成无Runtime。每页最多16目标/16binding与模型，超额显式Truncated。
- `actualRun` 是当前可见Room内最近Run（state、起止时间可见），从其冻结placement读取runtime/model；不将当前配置冒充已运行，不泄露其他Room执行记录。无placement或runtime_default时无具体模型便保持null/缺失。
- Computer只返回真实hostId与现Host heartbeat报告的observedState/version/time；`reportedBuildVersion`不是当前服务版本。Kernel无可信hostname/name时字段缺失，不解析hostId或环境猜名字。
- creator来自首次Agent revision的created_by，不是最后编辑者，且必须是该可见Room成员；createdAgents也按该Room当前成员过滤，最多50项并显式truncated。不暴露executionPolicyRevisionId、role/instructions、memory refs、env/argv、host paths或provider transcript。
- `server/info.runtimeContext`独立返回本人profile，因此成员分页不含self时仍可自检。
- `POST /v1/worker/auth/whoami` / `rah worker whoami`严格空对象，返回当前认证scope和固定token REDACTED；`POST /v1/worker/version` / `rah worker version`严格空对象，生产daemon factory注入现DAEMON_BUILD_VERSION与协议版本；CLI另标真实invoked package name/version。测试独立Worker服务未注入版本时为null，不以安装包替代在线daemon信息。
- 读取没有Room event/ACK/任务mutation，不添加已知causal cursor。继承active execution、原Room enabled membership、当前目标可见性与await后bearer重验。
- 发布prompt给出这些入口及configured/actualRun、serving daemon/CLI carrier、缺数据边界。无付费模型/官网在线写入/前端改动，根统一总检和正式部署。

### 已加入 Room/DM 的读取、搜索和显式发送（2026-09-08）

Raft Computer 1.0.18 `agentApiContract.ts` 的 history/search/send 合同及
`dist-UT7IQEHX.js:62516` 确认：默认搜索 Agent 可见频道，指定 target 才缩小范围。
`WorkerReadTargets` 只解析当前成员可读的 Room/DM/Thread，不返回执行 grant；
读取其他 Room 不推进原 Activation 的 ACK、knownRoomSeqs 或 Task 权限。
`WorkerReadService` 复用 GlobalDiscovery 的搜索和分页 owner，支持发送者、时间、排序；
全局冻结 cursor 绑定各 Room head、查询与当前成员集合，成员集合变化要求重新查询。
这是本地有界实现，不宣称等同未知的中央 Server 排序分数。

跨目标 `room-read` 通过 `WorkerTargetContext` 复用 RoomSync 的最新尾窗、快照和连续分页，
Thread 另包含真实根消息和有界回复。唯一持久签名 key 位于 Kernel，凭据绑定 actor、Run、
目标、冻结 head、已呈现窗口和时限；不建立第二个队列或逐次回执表。
完整上下文才允许 `message-post --target --context-receipt`，仍由原 CollaborationService
原子发布事件、Inbox 和 Outbox。新事实要求重新读取；凭据不证明模型理解了上下文。
已成功 intent 可在原签名凭据过期后准确重放，但新写不能使用过期凭据，当前 Run 与成员校验始终有效。
完整目标响应预算 2 MiB，包含签名、Thread 和外围 metadata，不截断正文来伪造已交付。

跨目标附件预约/发布和跨目标 held draft 尚未接入，明确拒绝；原 Room 的对应能力不变。
不自动创建或加入陌生 Room/DM。源码 hash、Multica 比较、TDD 与两个独立反例见
[本批审计](../audits/2026-09-08-backend-six-gap-closure.zh-CN.md)及其目标上下文专项证据。

### 附件评论 Web 的真实目标与发送屏障（2026-09-08 续批）

`file.comments` 返回已认证已发布附件的 roomId/messageId，以及存在 Thread 时的
threadId/threadRootMessageId；后者始终取真正 Thread 根消息，不把附件所在的回复冒充根。
预览器通过这些字段复用 RoomSession/既有最新 Room mutation 屏障发布 `file.comment`，
不从当前路由猜 Room、不新建评论 ledger。评论提及复用现 Workspace 实体与当前 Room
成员的交集、现 mention parser；同一发送 intent 固定正文、锚点、收件人与幂等键，
丢回执重试不会因成员投影变化产生另一份投递。HTML sandbox 未新增执行桥，未知位置
明确不支持；PDF/image/audio 仅整文件评论。验收层级见
[附件评论前端记录](../audits/2026-09-08-attachment-comments-ui-closure.zh-CN.md)。

## 忙时追加消息的发送恢复

`messages/post` 的 held 响应可携带 canonical `recoveryTarget`（Room、DM 或带 Thread 的目标）。CLI 保留 JSON 并返回 `SEND_HELD_AS_DRAFT` 非成功退出，明确“未发送”。当前 Run 应使用 `room-read --target` 完整读取目标窗口，再以签名 contextReceipt 和 throughRoomSeq 原样 send-draft 或审阅后修订；不得仅因 hold 就 ACK 并退出。普通 sync/ACK 仍受原 Activation 范围约束，目标回执不授权 Task 操作，也不允许自动发布未经 Agent 决定的草稿。历史客户端可忽略新增可选字段，不能将 held 当作成功发送。

来源、失败实验与本批验证边界见[忙时草稿恢复审计](../audits/2026-09-09-busy-held-send-repair.zh-CN.md)。
