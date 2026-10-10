# Inbox、Activation 与 AgentHost

## Composer 停止与重发

Composer 的 Stop 复用 Room Agent SOS 与 Runtime terminal proof，作用域为当前
Room 的所有执行通道，消息列共享所属 Room。`resumeOnMessage: true` 仅用于
Composer：停止后接受的新 Human 消息、消息列回复或 Task 创建会提供恢复指导，
但必须等全部旧 Runtime 的终止证明后才解除 hold。停止中收到修正内容不丢弃，
最后一份证明落库时可独立于 HTTP 调用者完成恢复。启动失败与停止竞态下，
`retryActivation` 优先解析既有 cancellation，不能跨 attempt 重试遗留停止目标。
设置页原有 SOS 默认仍需显式 Resume。发送不清除原消息、不改 Task 状态；忙碌时
继续发送复用既有 durable follow-up 合并。详见
[Composer 合同](../design/composer-controls.md)。

Human 可以把已有的 Composer 停止升级为持续 Room SOS 暂停：再次请求 Stop 且
`resumeOnMessage` 为 false（或省略），追加新的停止请求事件并更新该 operation
的有效请求，保留原始事件、hold 和 attempt-scoped 终止目标。旧请求重放、迟到的
Composer Stop、新 Human 消息、Task 创建/取消通知都不能降低暂停级别；只能通过
带新鲜 Room 序号和指导的显式 Resume 恢复。该围栏持久化并跨 daemon 重启保持。
暂停期间的 Inbox 和 queued Activation 保留，不能冒充已读或已完成；没有租约且
被 stopped SOS hold 阻止领取的队列属于静止工作，不等于正在执行的进程。
证据与边界见[持续暂停修复](../audits/2026-09-18-council-persistent-pause.zh-CN.md)。

## 1. 四种事实必须分开

```text
Room event committed
  -> InboxItem pending
  -> Activation queued
  -> wake hint delivered
  -> Activation leased
  -> RunAttempt created
  -> runtime started/resumed
  -> room_sync pulled
  -> explicit acknowledged/responded/verified
```

- Room event：发生了什么。
- InboxItem：哪个 participant 应关注。
- Activation：是否需要运行 agent。
- wake hint：提醒 AgentHost 拉取 Activation；允许重复和丢失。

wake hint、PTY write、process spawn、RPC 返回和 exit code都不推进 read、ack 或 Task 状态。

系统分别记录：

```text
outbox_persisted
  -> hint_dispatched
  -> host_received
  -> activation_leased
  -> run_started
  -> context_delivered
  -> agent_synced
  -> inbox_acknowledged/responded
```

每一项都是独立证据；前一项不能推导后一项。这比把“通知已发送”误当作“Agent 已看到”更容易审计，也便于定位丢失发生在哪一层。

## 2. Visibility、Attention、Activation

- Visibility：Room ACL 决定谁有权以后读取事件。
- Attention：mention、DM、thread subscription、Task ownership、dependency 和 InputRequest 决定谁进入 Inbox。
- Activation：优先级、预算、busy lane、去抖和策略决定是否启动模型。

普通运行状态/trajectory 不会激活 Agent。Human 顶层 Room Message 按 Room membership 投递；Agent 顶层 Message 则给同 Room 内除发送者之外的已启用 Agent 派生注意力，Thread 回复只给 canonical thread subscribers。两者都只是信号而非回复义务，Agent 可以在目标已完成或没有增益时只 ack。定向 mention、DM、Task assignment、dependency resolved 和 `input.resolved` 默认产生定向 Activation。显式 open Task 的 `task.created` 也投递给当前 Room 的全部 Agent member，但这些 Activation 只是候选注意力，Kernel 仍只允许一个 Agent 原子成为 Task owner；loser 不会被 winner 的未完成 Task 阻塞。

### 2.1 Agent Thread subscription

Agent Thread 关注由 Kernel 的 `agent_thread_follows` 持久表拥有，不从浏览器当前页或 Provider transcript 猜测。`thread.created` 的精确收件人、Thread 内的精确 mention，以及 Agent 在 Thread 成功发布的消息都会写入 follow；后续普通 Thread reply 只投递给仍在关注的 enabled Agent。Worker 可以通过 activation-scoped `thread-unfollow` 显式取消关注；该命令携带已投递或本 Activation 已产生的 causal cursor 与稳定幂等键。取消后普通回复不再唤醒它，后续精确 mention 会重新关注并恢复普通投递。

首次 Agent 回复的目标由 causal event 的 canonical `threadId` 决定。`thread.created` 和后续 `message.posted` 使用同一个 route owner，Task Thread 仍以 Task domain 的 canonical threadId 优先。schema 31 初始化会从历史 Agent Thread 消息和含 `recipientIds + threadId` 的事件回填可证明的关注关系；显式 unfollow 记录优先，不能被重复初始化覆盖。

这移植的是 Raft 可见的产品/CLI 合同：官方 Web bundle 暴露 Human follow/unfollow/followed 请求，Agent CLI 合同暴露 `/threads/unfollow`；官方文档明确“参与或被 mention 自动 follow、可 unfollow、后续 mention 可再次触达”。Raft 中央 Server 的数据库实现不可见，因此本地 SQLite 事务、causal guard 与幂等事件属于 RAH OS 的可靠本地映射，不宣称逐字复制未知服务端代码。

## 3. 合并与串行 lane

解除闲置 Task 的负责人后，已有 `task.unassigned` attention 继续进入普通持久投递。
被投递的下一 Activation 可将该事件作为对应 Task 的执行来源；仍须匹配 Room、
接收者 Inbox、Task ID 和冻结范围，不允许仅凭当前看板可见性认领未来任务。
该事件授予参与接手的资格，不强制每个收到开放任务通知的 Agent 都认领。
这是 Raft “清除后重新开放”行为的本地适配，不宣称官方使用相同的事件与租约结构。

同一个 AgentParticipant 在同一时刻最多拥有一个 active lane。

Room 的持久 SOS hold 同时约束 legacy lease 和 Placement 候选查询。
停止完成但纠正消息尚未到达时，scheduler 不得提前预留旧 queued 范围；
显式恢复或新 Human 消息解除 hold 后，沿既有 queued 合并路径接纳新范围。
仍需旧执行的 terminal proof，不能以可见回复代替终止。2026-09-18 回归覆盖
纠正输入在 terminal proof 前后两种到达顺序，见
[Placement 竞态修复](../audits/2026-09-18-latency-p0-repair.zh-CN.md)。

- queued 状态的多条事件合并到一个 Activation，扩展 `fromSeq/toSeq`。
- 已 leased/running 时到达的新消息形成或扩展下一个 queued Activation。
- Agent 每次运行先 `room_sync`，一次拉取该 cursor 范围内的完整增量。
- Activation 完成不自动把 Inbox 标为 acknowledged；读取、接受和业务完成分别记录。
- AgentHost 完成 Activation 前，指定 runtime consumer 必须显式确认 cursor 至少达到该 Activation 的 `toSeq`；process exit 0 不能替代此证明。
- RuntimeProfile 只描述可执行能力，不能承载 Agent 身份。Kernel 为每次新 launch claim 在 `AgentRuntimeContext` 中冻结 canonical participant handle、Definition revision 与 Policy/Placement；本机和远程 Host 都把同一份 context 注入子进程。旧 v1 Computer 可暂时缺少 handle，新 claim 必须提供。这样多个 Agent 共享同一 Runtime Offer 时不会继承某个种子 Agent 的名称或提示词。

`room_sync` 返回 continuation token，但不能仅因 HTTP/RPC 返回就永久推进消费位置。实现必须采用 client-owned continuation token，或 `deliver -> ackCursor` 两阶段协议；即使响应在服务端提交后丢失，客户端也必须能安全重放同一批事件。

2026-09-18 的真实忙时追加验收再次确认一个未闭合差异：当前 Run 可经 target read
和显式 post 回复后续消息，但冻结 `toSeq` 以外的 queued Activation 仍会另起一次
运行来完成交付确认。原生投递回执、共享 target read position、已有回复均不能单独
充当这次 Activation 的消费证明。后续修复必须由 Kernel 将实际 runtime 的有界
交付确认与 Task 义务一并闭合，覆盖失败、未读页、新事件与跨 Room 情况；不能由
adapter 删除 queued work 或在 post 后杀进程。见
[运行时对齐证据](../audits/2026-09-18-runtime-scheduling-alignment.zh-CN.md)。

Worker `message-check` 在输出成功后的 ACK 事务内，同时记录该页实际交付的
`message.posted` 的 target read position。Application Service 保存页内序号，
Kernel 验证 Room 与 Activation 范围，并按 Root/Thread 分别单调推进；HTTP 调用者
不能自报已读消息序号。未输出、未确认、未返回的下一页与后来到达的消息均不推进。
普通 sync ACK 不自动变成 target read，交付回执也不证明模型理解、Inbox 已处理或
Task 已完成。实现与 Raft 1.0.32 对照见
[交付与长请求修复](../audits/2026-09-17-reply-delivery-and-opencode-timeout-repair.zh-CN.md)。

## 4. AgentHost

AgentHost 常驻，CLI 不必常驻：

```ts
interface RuntimeAdapter {
  readonly recoveryDrivers?: readonly string[];
  probe(profile: RuntimeProfile): Promise<RuntimeAvailability>;
  start(
    input: ActivationEnvelope,
    lifecycle: { registerPrepared(run: RunHandle): Promise<void> },
  ): Promise<RunHandle>;
  resume?(input: ActivationEnvelope, sessionRef: string): Promise<RunHandle>;
  cancel(run: RunHandle): Promise<RunExit>;
  reap(run: RunHandle): Promise<RunExit>;
  recover?(input: RuntimeRecoveryInput): Promise<RunExit>;
}
```

`start` 是两阶段协议：runtime 先创建“尚未启动目标”的可恢复 owner，再调用 `registerPrepared` 持久化 descriptor；只有该 callback 成功后才能产生 target side effect。返回 handle 必须与 prepared handle 一致，Kernel 才写 `run.started`。因此 Host 在 launch 前、launch 后/`run.started` 前崩溃，都有可对账的 durable state；准备失败或 handle 不匹配时必须取消已准备 runtime，不能静默遗留进程。

`cancel` 成功返回 terminal `RunExit` 才能作为进程已终止的证明；抛错或无 terminal 结果时，Host 必须把 Activation 隔离，不能立即重排并启动第二个 runtime。

Human 关闭正在执行的 Task 时，Kernel 另写 attempt-scoped `activation_cancellation_requests`，而不是把 UI 的 `cancelled` 投影当成进程终止。未解决请求同时 fence Worker grant 和 Host lease renewal；AgentHost 必须先 cancel Runtime、保存 terminal RuntimeProcess、结束 RunAttempt 并释放 Placement，才能 resolve 请求、合并同 lane queued follow-up 并恢复唯一 queued Activation。`task.reopen` 在 unresolved request 存在时 fail closed。详见 [ADR-0022](../adr/0022-reversible-closed-and-runtime-cancellation-fence.md)。

Host 负责认证连接、capacity、Activation lease、heartbeat、timeout、process group、cancel 和 orphan reap。`resume/liveInput/nativeEvents` 是 capability；不支持时用新 session + Room briefing。

Host 在启动、重连和固定 reconciliation interval 主动查询 queued/expired Activation。wake 只降低延迟。每个部署必须声明最大 reconciliation interval 与恢复 SLA，并用 100% wake loss 场景验证它。

当前本机 daemon 已实现 topic-filtered Outbox dispatcher：只 lease `activation.requested`，发布无正文 LocalWakeSignal 来中断 poll wait，成功后才 ack Outbox，失败则 durable retry。确定性测试把 Host polling 故意设为 60 秒，仍在 2 秒门禁内完成新消息 Activation；原有 no-wake 测试证明 publisher 不可用时 polling 仍能恢复。

## 5. 不用模型等待人类

Agent 向人类提问时：

1. 创建 `InputRequest`；
2. Task 进入 `waiting_input`；
3. 当前 Run 结束；
4. 人类任意时间回复；
5. `input.resolved` 产生 InboxItem 和 Activation；
6. Host 重新启动或恢复 Agent。

这条链路现已在 canonical Kernel、Worker HTTP 和完整 fake daemon fixture 中实现。`request-input` 把 Task claim 释放并给 designated human responder 创建 Inbox，但不为 human 创建 Agent Activation；原 RunAttempt 在写入 terminal proof 后结束。authenticated human resolve 原子产生 `input.resolved`、requester Inbox、新 Activation 与 content-free wake，新 CLI session 从 Room event 读取 answer，并继续原 Task。若 human 在旧 CLI 退出前快速回复，`input.requested` 仍证明旧 Activation 已经合法暂停，`input.resolved` 已进入 follow-up Activation；Kernel 不会因为 Task 提前回到 `todo` 而重复原 RunAttempt。

等待期间不运行 LLM turn，也不调用 `room_wait/channel_wait_new`。MCP wait 最多是秒级实验性快路径，不能拥有可靠投递。当前 Human 已可通过 loopback Client API sync/list/resolve，Phase 4A Web 已完成 Room/Thread/Task recovery slice；fake daemon E2 证明 resolution 会唤醒新 CLI，双 Agent browser gate 又证明 Activation reply 与单 winner Task 可回到同一 Room。content-free browser hint、完整 PWA 与 push notification publisher 尚未实现。

## 6. 恢复语义

- Host 离线：Activation 保持 queued。
- wake 丢失：Host 重连主动 lease pending Activation。
- wake 重复：同一 Activation 只能被一个有效 lease owner 执行。
- Host 在创建 RunAttempt 前崩溃：`leaseUntil` 到期后可重新领取。
- Host 在 `starting/running` RunAttempt 存在时失联：Kernel 将 RunAttempt 标记为 `orphaned`，将 Activation 标记为 `quarantined` 并冻结该 participant lane；不能仅凭 lease 到期启动第二个 runtime。
- 每个可能产生启动副作用的 runtime 先有持久 `RuntimeProcess(prepared)` 与 opaque recovery descriptor，成功后转为 `active`。兼容 adapter 通过独立、周期续租并按 attempt fencing 的 recovery lease 竞争对账；只有 terminal proof 写入后才能解除 quarantine。多个 recovery Host 不能同时拥有同一 orphan，旧 attempt 不能提交新 lease 下的结果。
- 已验证的 Runtime 终止证明与 orphaned RunAttempt 收口在同一 Kernel 事务内完成：零退出码且无 signal 记为 `exited`，其余记为 `failed`，保留原失联诊断并写 `run.finished`。这不是 Task 完成或 Inbox 已读证明。启动时仅修复已存在匹配 `run.termination_proven` 事件与终止投影的遗留 orphan，不改写已完成的 RunAttempt，也不绕过 recovery lease 或重试隔离围栏。实现与证据见[批次 A/B 接手收口](../audits/2026-09-17-ab-takeover-closure.zh-CN.md)。
- Agent busy：新事件进入持久 follow-up；支持原生 direct/steer 时同时发送提示，不另起执行 lane，传输接纳不等于业务交付确认。
- CLI 不退出：Host 周期复查实际 runtime 存活；不能只因总时长达到旧上限而终止仍存活的运行。探测失败或无此能力时仍经 cancel、kill process group、reap 记录 RunAttempt failure；Task 独立保留。
- daemon signal 先进入 drain；超过 `drainTimeoutMs` 后才 cancel 当前 runtime。start/recover/cancel 各有独立 deadline，cancel deadline 到期且无 terminal proof 时 quarantine，而不是无限阻塞 shutdown 或伪造退出。
- Runtime 明确失败时，Host 将 Activation 延迟重排；若已有 queued follow-up，先把范围合并回原 Activation 并取消重复 lane。默认退避按 Raft 可见源码使用 10 秒基准、5 分钟封顶。
- 同一规范化 recoverable Runtime 错误指纹连续出现三次时，Kernel 写入 durable `activation_retry_fences`，把 Activation 保持为 fail-closed `quarantined` 并停止该 Agent lane 的普通 lease/reconcile；前两次和第三次分别留下 `activation.retry_scheduled` / `activation.retry_blocked`。Human 获得指向准确 Room 的系统通知。普通 quarantine 解除不能绕过该 fence，只有显式 Agent restart/reset 的 disable→enable 生命周期合并 follow-up、记录 `activation.retry_resumed` 后才能恢复。Raft 的 `actionRequired` 与 sticky terminal 分支现由结构化 `retryDisposition` 直接进入同一 fail-closed quarantine，不消耗三次指纹计数；普通 retry 使用 10 秒基准、5 分钟封顶和最多 10% 正向 crypto jitter。
- Human 明确停止 Room 时，可以撤销该 Room 已有完整终止证明的隔离执行，记为 `cancelled` 并保留错误历史与取消事件；这不是 retry 或完成。未终止 Runtime、孤立 Run、未释放 Placement 仍阻止操作，Inbox、Task 和读位置不被伪造。见[超时与隔离撤销修复](../audits/2026-09-18-runtime-timeout-and-quarantine.zh-CN.md)。
- Reminder 的 `roomId/messageId` 是不可变来源锚点，`targetRoomId` 是触发事实和 owner-only Activation 的目标；`--channel #slug` 只在同一 active Workspace 内解析，并在 schedule 与 fire 两次验证 Reminder owner 的 Room membership。Thread anchor 同时冻结 `threadId/rootMessageId`。同 Room Thread 的 `reminder.fired` 只投影到该 Thread；跨 Room receipt 留在目标 Room，并通过 typed message permalink 回到来源消息/Thread。Reminder mutation 仍不推进 Room seq，只有 fire 写 canonical Room fact。
- 长 Run 由 Host supervisor 周期 heartbeat 并续租；timeout 时调用 Runtime cancel。只有 cancel 返回 terminal exit 并持久化 termination proof，才记录 `timed_out` 并重排；无法证明终止时隔离 lane。受控 fixture 已验证活动 POSIX process group 的 `SIGTERM`→`SIGKILL`、leader 先退出时的同组 descendant cleanup，以及 AgentHost→外部 worker→Room `sync/ack` delivery proof。跨进程 fixture 在 target launch 后、`run.started` 前硬杀原 AgentHost，随后验证 `starting + prepared` orphan/quarantine、identity-authenticated group cleanup 和签名 result，不依赖持久 PID/PGID；独立 Fake Host/Kernel fixture 验证 recovery lease 跨原到期点续租与 attempt fencing。fake daemon 已验证 canonical Task query、token-free sidecar claim heartbeat、跨 RunAttempt 幂等恢复、InputRequest 无 listening 唤醒及 `claim/start/progress/submit`；Codex Luna gate 已验证真实 CLI 的最小 Task submit。主动 `setsid`/double-fork 的 escape、Windows tree kill、supervisor artifact GC、真实 Provider InputRequest，以及 Artifact/Review 完整链路仍未验证。

## 7. 因果新鲜度

Agent 提交 claim、status、artifact 或 answer 等业务 mutation 时携带 `basedOnRoomSeq`。若 Room 在该序号之后出现了与目标对象相关的新事件，Kernel 不得静默接受旧上下文写入，而应：

1. 对纯计算、无副作用的动作直接拒绝本次 mutation；
2. 返回 `stale_context` 与最小增量；
3. 创建或扩展 follow-up Activation，让 Agent 重新同步后再提交；
4. 只有显式策略允许时才能审计式 override。

普通 Agent Room reply 直接实现 Raft held-draft 语义：根消息和同 Thread 各自比较最新 `message.posted`；旧草稿写入 `held_message_drafts`，返回有限 `newerMessages`，不进入 canonical Room，并由已落账的 peer Message 产生 follow-up Activation。follow-up 可正常改写、发送保存原稿（再次检查）、保持静默；只有原稿已经再次被 hold、响应明确建议后，才允许显式 send-anyway。保持静默不写假事件，十分钟有效期到达后由 Kernel 维护解析为 expired。Task 等其他 mutation 继续使用 `stale_context`。两类判断都由业务 Kernel 持久执行，不依赖某个 CLI session 是否仍然活着。

最终输出提交与同轮普通发帖共存时，Kernel 保留原 `basedOnRoomSeq`，只从新鲜度候选消息中排除有持久证据证明由**当前 Run、本人、同一目标**新提交的消息。来源映射和消息在同一事务写入，旧消息或幂等重放不能补归属；它不是另一份消息记录或已读游标。任何夹在自身帖子之前、之间或之后的相关 Human／其他执行新事实仍触发 hold，不能用最新自身帖序号抬高整个窗口。普通帖子可以是进度，不生成最终回复标记，也不能据其正文吞掉后续原生最终回复；既有显式 final、取消、未知写不重发和 delivery ACK 围栏保持。实现与验证状态见 [evo 当前状态](../evo/status.zh-CN.md)。

### 7.1 Activation 的业务履约证明

`acknowledge` 只证明 Agent 已经读取到指定 Room 序号；Runtime 退出只证明本次进程已经终止。两者都不能证明 reviewer 已审查、复开的 Task 已继续、改派后的新负责人已处理，或驳回后的返工已产生结果。

Task／Review domain 在派生 attention 的同一事务中，把需要强制完成的动作冻结为 `activation_obligations`。当前类型包括：

- `task_review`：绑定 `taskId + submissionId + reviewer participantId + sourceEventId`；只有该 reviewer 对当前 submission 写入 canonical Review，或该 submission 已被后续状态取代，Activation 才可结束；
- `task_owner_follow_up`：绑定 `taskId + owner participantId + sourceEventId`；复开、改派或 `changes_requested` 后，当前负责人必须把 Task 推进到 `waiting_input`、`blocked`、`submitted`、`completed` 或 `cancelled`，失去该 Task 所有权也可解除旧义务。

`completeActivation` 的顺序固定为 delivery cursor proof → Runtime terminal proof → typed obligations → 兼容旧 Task 入口的 legacy proof。legacy proof 只认 `toSeq` 之前已存在的 Task（2026-09-27 起，见 ADR-0006 补充）：Agent 在本 Activation 内自行 claim 的 Task 不构成本 Activation 的义务。义务拒绝带 `RAH_BUSINESS_OBLIGATION_UNMET` 标记，其 blocked fence 不占执行 lane，由 Human 经 `instance.activation.abandon` 处置。schema 升级会为仍处于 `queued / leased / quarantined` 的旧 Activation 回填可确定的 reviewer／返工义务；已经结束的历史 Activation 不被伪造重开，正式迁移前必须检查是否存在未完成 Task。普通 Room 对话没有业务义务，允许读后静默。

## 8. Task claim 恢复

Activation lease 与 Task ownership 是两套状态。当前 Worker Application Service 在有效 execution credential 存续期间，以不产生 Room event/Outbox 的 sidecar heartbeat 续租本 Agent 的 `claimed/in_progress` Task；credential revoke、execution fencing 或服务关闭会停止续租。新 RunAttempt 先查询 canonical Task projection，再用稳定业务幂等键重放已完成命令并从当前 Activation cursor 继续；旧命令的原始因果序号不成为业务幂等内容。过期 ownership 不能被 heartbeat 复活，必须显式 reclaim，并保留新的 `task.claimed` 历史。依赖检查与更丰富的恢复策略仍待后续 Task workflow 实现。

## 2026-09-08 基础协作目标与读取边界

Worker `message-post` 支持显式 `threadId`，`null` 表示 Room 顶层。省略时只有单一投递目标可自动路由；多 Thread 或 Room/Thread 合批必须选择目标。旧 Thread 不要求出现在本次 Activation，但必须属于当前 Room、其创建事实不晚于已投递 Activation cursor。HTTP 保留已 sync 的 causal cursor 检查；Host 代际、运行实例、租约、成员与 Agent enabled 围栏不变。已读的新事实不能偷偷扩大执行凭据的 `toSeq`；较新 Thread 写入仍等待 follow-up Activation。唯一窄补充是当前 Worker 本人在同一 Run 的 canonical `task.created` 明确创建的 Task Thread；该来源证明由 `worker-task-scope` 共享，回复仍使用原写入 cursor，并通过相同 freshness/held draft 与 active Run 围栏。

收件人属于发布时的服务器派生结果，不作为 Worker 原消息意图的幂等内容。相同身份、Activation、正文、目标和发送方式的重试复用旧 event；成员或 Thread 关注变化不重新投递。held draft 固定原 Thread，rehold 的原请求也可重放其旧回执。

普通 Room Agent 可读取同 Room Task、冻结 Submission、已发布 Message/Task 附件；不要求预设审查角色或本次 Activation 投递 Task。未发送附件与跨 Room 附件不可读。认领、提交、正式 Review 等 mutation 继续执行独立的 delivery/ownership/lease 检查。本 Run 本人 canonical `task.created` 可作为自己新建 Task 的来源证明，从而允许创建后立即 start；它不能授权其他 Run、其他 Agent 或任意只读取得的 Task。Human 通过对话临时指派审计，Agent 读取证据后在明确 Thread 回复；只有历史 Task 已显式设置 reviewer 时才适用兼容正式 Review 流程。

普通 Worker 讨论附件由现有 `RoomFiles` 负责 prepare、真实 bytes 上传完成、取消和 GC，不要求先建 Task。消息与附件 consumed 在原 Kernel 事务一起提交，held draft 保存不可替换的附件快照，取消后原回执仍可重放但不能再次发布文件。Task Artifact reservation 继续受 Task/Run/claim 约束，不能经普通附件路径消费。见 [本批附件证据](../audits/2026-09-08-worker-discussion-attachments-closure.zh-CN.md)。

`task-trajectory` 只收集 canonical Task mutation 明确关联的 Run，并返回 `scope=task_linked_run_diagnostics`。同一个 Run 可以处理其他工作，所以这既不是逐工具 Task 归属，也不是完成/正确性的证明。没有相关 Run 的 Task 返回空轨迹，不用同 Agent 后续活动补足。当前查询仍展示当前 assignee 的关联 Run，释放后无 assignee 保持不可查询。

来源、最小本地适配、RED/GREEN 与限制见[本批审计](../audits/2026-09-08-collaboration-core-closure.zh-CN.md)。

### Worker 基础读取的唯一 owner

`WorkerReadService` 组合现有 Room/Message/Principal/Task 投影，通过严格的协议、Worker HTTP 和 CLI 提供历史 before/after/around、精确消息与 Thread 定位、当前 Room 成员及 handle、可见身份资料、Task 看板和 canonical 生命周期历史。actor 与 Room 只取有效 execution grant；每次读取重新检查 enabled Agent membership。读取不要求先认领 Task，不 ACK Inbox，不添加已知写入 cursor，也不扩大当前 Activation 的执行范围。

历史与 Task history 在第一次查询时冻结本 Room 的 `next_seq-1`，分页使用同一 `discoveryPage` owner 的 Room 序号模式；不能以可复用的 SQLite 全局 rowid 代替 Room 的单调序号。Task 列表以 `task.created` 的 Room 序号冻结候选，但返回当前 Task 投影，明确不是历史快照。成员与 profile 同样反映当前可见身份；Agent 展示名、描述和头像取 current revision，角色指令、私有记忆与运行凭据不出现在该 profile。

读取可以看到当前 Room 中晚于 Activation `toSeq` 的事实；这不授权用该事实写入或 ACK，后续执行仍由 durable follow-up 承接。响应按完整 UTF-8 JSON（包含分页字段）限制为 512 KiB，分页保留完整记录并留出封包空间；单条过大显式拒绝，不截正文、不跳过记录或返回无限空分页。源码依据与本批验证见 [Agent API 映射](../product/raft-agent-api-contract-map.zh-CN.md) 及 [Worker 基础读工具收口](../audits/2026-09-08-worker-read-tools-closure.zh-CN.md)。

### Worker 自身公开资料的因果边界

`WorkerSelfProfileService` 只把当前有效 execution 绑定到本人 enabled AgentDefinition，并复用 `workspace-agent-profile` 的唯一 revision writer。`profile-self-get` 返回公开展示字段，以及本人资料 control Room 的 `writeContext={controlRoomId,controlRoomSeq,expectedRevisionId}`；不返回角色指令或私有记忆，不读取其他 control Room 事件，不增加工作 Room 的 known cursor、ACK 或执行范围。此接口提供明确写依据，不证明模型已经读懂资料，也不新增 grant 内的读取回执槽。

`profile-update` 必须显式携带这份 control Room 位置与 revision CAS。工作 Room 的当前有效 execution 和成员资格只证明本人身份；control Room 序号不能当成工作 Room 的 `basedOnRoomSeq`。更新只接受 displayName、description、avatarKey，同一事务写单个新 revision 和一条 `agent.profile_updated`，标注 `metadataOnly`、来源工作 Room 和 Run。该事务不变更现行 RunAttempt 的冻结 manifest、执行租约或记忆身份；下次运行由原 Placement owner 选到新 revision。有效身份的完全相同重试返回原持久回执，命令改变则冲突，Human 并发 revision 更新不会被覆盖。

`profile-avatar-publish` 复用 daemon 的 `ProfileImageStore`、现有 5 MiB 图片上限、内容校验、immutable image key 和 `ProfileImageLifecycleService` 的 upload intent/GC。HTTP 在读取 bytes 前、记录 intent 时和返回前重验凭据与执行资格。Worker 随后用显式 profile CAS 绑定本人上传 intent；其他 Agent 的公开头像 key/intent、未完成上传和 raw URL 都不是授权。既有本人头像和官方预设可以继续使用。上传失败或 CAS 冲突留下的未绑定对象走原 GC，不能通过新的 Worker facade 绕过 Task Artifact 的发布证据。来源与分层测试见 [自身资料及头像收口](../audits/2026-09-08-worker-self-profile-closure.zh-CN.md)。

Worker JSON facade 在等候请求正文前及正文读取完成后都认证 bearer，防止上传请求期间撤销凭据却继续沿缓存 grant 写入。Kernel 的 live Run 围栏与应用服务 bearer 的撤销是两层独立校验，任何一层失效都不能接受 mutation。

普通附件与 Task Artifact 的异步 PUT 同样传入动态 facade 授权函数；`RoomFiles` 在其原三个 owner 检查点复验。最终 rename 后、同步提交 completed 之前没有可跳过的授权窗口；拒绝时走原 failed 和文件清理逻辑，不先完成存储再仅返回 401。

## Worker 父任务恢复的单一状态 owner

Worker `/v1/worker/tasks/unblock` 复用 `task-unblock-service.ts` 中原 Human unblock 事务。Human 仍为 creator 权限；Worker 只允许有效 Run 中当前 assignee 本人恢复自己最近阻塞且已在 `toSeq` 内可见的 Task。当前成员必须 enabled，未完成依赖、pending Human input 或相关新事实必须拒绝；不把 read 工具返回的新事实当作写授权。

解除阻塞只写 `todo`、`task.unblocked` 和既有派发工作；不认领、不把 unblocked 伪装成 created、不扩 grant。当前 Run ACK 原 delivery cursor 后退出，下一 Activation 正常交付事件并允许 claim/start/submit，最终完成仍由 Human。合法幂等重放没有第二条事件/Outbox，事件失败回滚整个事务。

同一共享 owner 还提供 creator 的闲置 Task assign/unassign 与 source Message 唯一 convert。任务管理不等于执行 claim；权限不能退化为所有 Room 成员可改。具体边界和当前证据见 [Task 管理与父任务恢复](../audits/2026-09-08-worker-task-management-closure.zh-CN.md)。

## 2026-09-08：完整 Task amendment 与同步字节边界

Task 修改沿既有 `task_updated` attention 向非修改者的负责人派生通知；新的 `task.amended` 事件可作为下次 Activation 的 Task 关联证据，不替代 claim、执行锁或验收。Room 同步在原事件数上限外增加独立的 2 MiB JSON 响应上限，计入 snapshot 和 envelope，逐行读取完整事件前缀；`cursorAfter` 仅为实际返回末条，未返回的事件留到下页。Worker 仍须通过已经返回的 cursor 继续或 ACK，不能用最新 Room seq 跳过未读事实。详见[本批来源、权限及验证](../audits/2026-09-08-task-amend-upload-capabilities.zh-CN.md)。

## Task 真删除的事务边界（2026-09-08）

Task 删除由 kernel/task-deletion.ts 的 TaskDeletionService 独占。Human deleteTask 与 Worker tasks/delete、SDK task.delete、CLI task-delete 仅委派。请求携带 roomId 与 taskId，删除后仍以当前认证/成员身份定位原 Room 内 task.deleted 幂等事件；合法重放不依赖已移除投影，也不因新 Worker grant 尚无原游标回执而失去持久结果。

删除事务移除 Task 私有关系和投影，保留 Message/Thread、发布附件、历史 Room event、Outbox 与 Run/进程证据。发布文件解除 Task 外键，未发布上传置 canceled 并沿 RoomFiles 既有 GC 回收。legacy obligation 的启动回填只排除有更晚 task.deleted 证明的旧 Task 义务。编号分配读取持久已用 taskNumber，不能复用被删除的最大编号。

授权和执行限制复用现有 Room/Worker owner：Human creator 或 Room owner/admin；Worker 本人 creator、同 Room 当前有效成员与 active execution，原冻结范围或本 Run 创建来源、因果 freshness。存在 active claim、Task 关联 Run 尚未 terminal、未解决取消/重分配/输入、其他 Task 依赖时拒绝删除。删除不推断任务完成，不自动停止 Provider，也不释放依赖。当前删除 attention 仅通知现有有效 Agent creator/assignee。

这是对 Raft 已证实 Task metadata 真删除行为的本地适配；Raft 中央 server 对原讨论/已发布文件与 active execution 的具体处置未知。不得把本地 409 流程宣称为 Raft 原样行为。

## Agent 频道静音的注意力边界（2026-09-08）

- 单一 owner：`AgentChannelAttentionService` / `agent_channel_attention`，键为 participantId×roomId。Worker scope 决定身份与当前 Room；不接收任意目标身份，不复用 Human sidebar 偏好。schema v53 由根统一发布。
- `channel-mute` / `channel-unmute` 只修改当前已加入普通 Channel 的未来普通 Activity 投递；每次成功事务写 projection、一个 `channel.attention_changed` Room event 和现有 room.event Outbox。已接受 Inbox、Activation、RunAttempt 不撤回；Room 历史和读取权限不变；解除静音不编造被抑制期间的新 Inbox。
- 唯一 attention 过滤位于 `RoomEventWriter.deriveAttention` 的 Inbox/Activation/obligation/Outbox 派生前。个人 mention、DM、followed Thread 独立穿透。普通 room_policy、task_available/task_updated/task_review 和开放 dependency 广播被抑制；Task 当前事件 title/description 的真实个人 handle mention 可穿透，使用现有 mention parser。
- RAH 明确差异：typed task_assigned/task_collaboration、Human input_resolved 和显式 task_owner_follow_up/task_review obligation、依赖就绪时真正当前 assignee 的责任投递仍保留。这是已有 Task 责任安全性适配，不能说所有 Task 等同 @mention 或 Raft Server 已实测该规则。
- 认证/因果：Worker facade 在 JSON await 后重验 bearer，Kernel 在事务中重验执行与当前 enabled membership。偏好事件 receipt 可链接后续偏好操作，不能扩大 Task execution cursor。旧 key 绑定 Room、actor、mutation 种类及设定值；重试返回原事件与当前 setting，不回滚后续 setting。新 key 若基于较旧 setting seq 则拒绝。归档/数据库失败完整回滚。
- Room 删除 graph 同时擦除 agent_channel_attention；根的 attachment_comment_links 按授权加入 graph，位于 room_files/messages 之前擦除。
- 本批未做跨 Room mute 写授权、Human 设置 UI、自动静音策略、模型实跑或官网双边写操作；根负责总检查与正式备份重启。

### 跨频道静音接线（2026-09-08 续批）

`channel-mute/channel-unmute` 保留原当前 Room 调用；可增加成对的
`--target <channel> --context-receipt <receipt>`，先用已有 `room-read --target`
取得完整目标窗口，再以其 throughRoomSeq 修改本人偏好。目标解析、当前执行/双边成员和签名
复用 WorkerTargetContext，不复制 grant，不向原 knownRoomSeqs 加入目标事件。
拒绝 Thread、DM、control 和非成员；新偏好不能覆盖晚于所呈现窗口的偏好事实。
无关普通消息不改变偏好写入因果条件。准确旧 intent 回放可使用原已过期签名凭据，
但始终复验有效 Run/成员，且不重新投递、不回滚较新设置。权限和普通 Activity 过滤仍沿单一 owner。

## 重启后的 Activation 代际校验

Activation 的执行授权按当前 `attempt_count` 对应的 Run／Placement 校验 Host generation。已终止的历史 Run 保留原 Host、退出来源和代际围栏，不阻挡新 attempt 的合法领取；新 Host 也不得修改旧 Run。真实中断反例与修复见[恢复修复验收](../audits/2026-09-08-core-recovery-repair.zh-CN.md)。

## Human 已完成任务静默重开

2026-09-15：`human-task-edit.ts` 作为唯一 owner，Human `task.workflow.update` 将 completed
改为 todo 时，仍原子更新 Task、追加 Room event、保留版本和幂等校验，但不派生 Agent
Inbox/Activation。界面“重新打开任务”不是重新委派执行。closed/cancelled 后退回重做、
重新指派及后续显式消息仍沿用各自投递合同；Worker 的证据式状态接口不变。
见 [本批验证及用户要求](../audits/2026-09-15-message-touch-selection-export.zh-CN.md)。

## 新 Agent 首次初始化

产品 #all 存在时，新身份 provision 与定向 `agent.first_run_requested` 在同一
Kernel 事务提交，通过现有 Inbox → Activation → AgentHost → RunAttempt 调度。
Workspace `agentAllChannelGreetingEnabled` 默认开启，设置只影响随后创建的身份；
关闭仍初始化但不发介绍。请求与保留发送键均绑定 participant ID，同名不合并。
报到完成由实际 message.posted 证明，读取确认或成功退出不能替代；提交后跨执行
尝试的重试返回同一消息。停止、删除、离线恢复使用原有围栏，无新的任务或调度队列。
无 #all 的 headless Workspace 不调度，也不回退到 control Room。
来源、一次性条件、异步能力发布限制及测试见
[首次报到审计](../audits/2026-09-20-agent-first-run-greeting.zh-CN.md)。
