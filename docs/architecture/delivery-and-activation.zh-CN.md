# Inbox、Activation 与 AgentHost

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

普通状态消息不会自动激活全体 Agent。定向 mention、DM、Task assignment、dependency resolved 和 `input.resolved` 默认产生定向 Activation。唯一例外是显式 open Task：`task.created` 投递给当前 Room 的全部 Agent member，但这些 Activation 只是候选注意力，Kernel 仍只允许一个 Agent 原子成为 Task owner；loser 不会被 winner 的未完成 Task 阻塞。

## 3. 合并与串行 lane

同一个 AgentParticipant 在同一时刻最多拥有一个 active lane。

- queued 状态的多条事件合并到一个 Activation，扩展 `fromSeq/toSeq`。
- 已 leased/running 时到达的新消息形成或扩展下一个 queued Activation。
- Agent 每次运行先 `room_sync`，一次拉取该 cursor 范围内的完整增量。
- Activation 完成不自动把 Inbox 标为 acknowledged；读取、接受和业务完成分别记录。
- AgentHost 完成 Activation 前，指定 runtime consumer 必须显式确认 cursor 至少达到该 Activation 的 `toSeq`；process exit 0 不能替代此证明。

`room_sync` 返回 continuation token，但不能仅因 HTTP/RPC 返回就永久推进消费位置。实现必须采用 client-owned continuation token，或 `deliver -> ackCursor` 两阶段协议；即使响应在服务端提交后丢失，客户端也必须能安全重放同一批事件。

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

等待期间不运行 LLM turn，也不调用 `room_wait/channel_wait_new`。MCP wait 最多是秒级实验性快路径，不能拥有可靠投递。当前 human 已可通过 loopback Client API sync/list/resolve，fake daemon E2 证明 resolution 会唤醒新 CLI；Web/PWA 接入、content-free hint 与 push notification publisher 尚未实现。

## 6. 恢复语义

- Host 离线：Activation 保持 queued。
- wake 丢失：Host 重连主动 lease pending Activation。
- wake 重复：同一 Activation 只能被一个有效 lease owner 执行。
- Host 在创建 RunAttempt 前崩溃：`leaseUntil` 到期后可重新领取。
- Host 在 `starting/running` RunAttempt 存在时失联：Kernel 将 RunAttempt 标记为 `orphaned`，将 Activation 标记为 `quarantined` 并冻结该 participant lane；不能仅凭 lease 到期启动第二个 runtime。
- 每个可能产生启动副作用的 runtime 先有持久 `RuntimeProcess(prepared)` 与 opaque recovery descriptor，成功后转为 `active`。兼容 adapter 通过独立、周期续租并按 attempt fencing 的 recovery lease 竞争对账；只有 terminal proof 写入后才能解除 quarantine。多个 recovery Host 不能同时拥有同一 orphan，旧 attempt 不能提交新 lease 下的结果。
- Agent busy：新事件进入下一次 Activation，不并发注入。
- CLI 不退出：Host timeout 后 cancel、kill process group、reap 并记录 RunAttempt failure；Task 独立保留。
- daemon signal 先进入 drain；超过 `drainTimeoutMs` 后才 cancel 当前 runtime。start/recover/cancel 各有独立 deadline，cancel deadline 到期且无 terminal proof 时 quarantine，而不是无限阻塞 shutdown 或伪造退出。
- Runtime 明确失败时，Host 将 Activation 延迟重排；若已有 queued follow-up，先把范围合并回原 Activation 并取消重复 lane。
- 长 Run 由 Host supervisor 周期 heartbeat 并续租；timeout 时调用 Runtime cancel。只有 cancel 返回 terminal exit 并持久化 termination proof，才记录 `timed_out` 并重排；无法证明终止时隔离 lane。受控 fixture 已验证活动 POSIX process group 的 `SIGTERM`→`SIGKILL`、leader 先退出时的同组 descendant cleanup，以及 AgentHost→外部 worker→Room `sync/ack` delivery proof。跨进程 fixture 在 target launch 后、`run.started` 前硬杀原 AgentHost，随后验证 `starting + prepared` orphan/quarantine、identity-authenticated group cleanup 和签名 result，不依赖持久 PID/PGID；独立 Fake Host/Kernel fixture 验证 recovery lease 跨原到期点续租与 attempt fencing。fake daemon 已验证 canonical Task query、token-free sidecar claim heartbeat、跨 RunAttempt 幂等恢复、InputRequest 无 listening 唤醒及 `claim/start/progress/submit`；Codex Luna gate 已验证真实 CLI 的最小 Task submit。主动 `setsid`/double-fork 的 escape、Windows tree kill、supervisor artifact GC、真实 Provider InputRequest，以及 Artifact/Review 完整链路仍未验证。

## 7. 因果新鲜度

Agent 提交 claim、status、artifact 或 answer 等业务 mutation 时携带 `basedOnRoomSeq`。若 Room 在该序号之后出现了与目标对象相关的新事件，Kernel 不得静默接受旧上下文写入，而应：

1. 对纯计算、无副作用的动作直接拒绝本次 mutation；
2. 返回 `stale_context` 与最小增量；
3. 创建或扩展 follow-up Activation，让 Agent 重新同步后再提交；
4. 只有显式策略允许时才能审计式 override。

这吸收了 Raft 的 freshness hold 思路，但把判断放在业务 Kernel，而不是依赖某个 CLI session 是否仍然活着。

## 8. Task claim 恢复

Activation lease 与 Task ownership 是两套状态。当前 Worker Application Service 在有效 execution credential 存续期间，以不产生 Room event/Outbox 的 sidecar heartbeat 续租本 Agent 的 `claimed/in_progress` Task；credential revoke、execution fencing 或服务关闭会停止续租。新 RunAttempt 先查询 canonical Task projection，再用稳定业务幂等键重放已完成命令并从当前 Activation cursor 继续；旧命令的原始因果序号不成为业务幂等内容。过期 ownership 不能被 heartbeat 复活，必须显式 reclaim，并保留新的 `task.claimed` 历史。依赖检查与更丰富的恢复策略仍待后续 Task workflow 实现。
