# ADR-0006：Task 业务协议与 causal Worker command

状态：Accepted（Task slice E2 local，2026-08-25）

## 背景

此前 daemon 只能证明外部 CLI 读取并确认了 Activation range。CLI 成功退出、cursor 已确认和“业务任务完成”是三个不同事实；若继续以 Runtime exit 代替 Task 状态，RAH OS 会重新落入旧 RAH 的 Session/Council 分裂与 transcript 推断。

同时，Activation lease 与 Task ownership 解决的是不同问题。前者决定哪个 Host 可以运行一次 CLI，后者决定哪个 Agent 正在承担业务工作。两者不能共用状态或随彼此完成而隐式迁移。

## 决策

1. Kernel 增加 canonical Task projection，最小状态机为：

   ```text
   todo -> claimed -> in_progress -> submitted -> completed
                              +-> waiting_input -> todo
   ```

   Agent 只能推进到 `submitted`；当前由 Task creator 显式验收为 `completed`。RunAttempt/RuntimeProcess/Activation 的结束永远不会自动改变 Task 状态。

2. `createTask` 在一个 SQLite transaction 内写 Task、`task.created`、assignee InboxItem、Activation 和 content-free wake Outbox。部分派生状态不可见。若一个 Activation range 通过 `task.created` 或 `input.resolved` 关联到分配给其 participant 的 Task，Task 尚未达到 `waiting_input/submitted/completed` 时，即使 delivery 已 ack 且 Runtime exit=0，Kernel 也拒绝完成 Activation；AgentHost 必须 durable retry。这样“进程成功但 Task 未提交或暂停”不会留下无后续唤醒的孤儿 Task。`waiting_input` 的详细规则由 ADR-0007 定义。

3. Task claim 有独立 `claimedBy/claimUntil`。`start/progress` 要求有效 claim，且会续期；`submit` 清除 claim。Worker service 在持有当前、未被 fence 的 execution grant 期间以 sidecar timer 调用 Kernel heartbeat，无需模型轮询，也不创建第二份 Task 状态。heartbeat 只更新 canonical lease projection，不追加 Room business event/Outbox；credential revoke、run terminal、lease expiry 或 service close 会停止续期。有效 claim 拒绝竞争命令；过期 claim 必须通过新的显式 `task.claimed` 重新领取并保留 previous state/owner/lease 证据。

4. Worker service 开放一个窄 `tasks/get` projection query 与五个严格 command endpoint：`claim/start/progress/request-input/submit`。请求不能携带 actor、Room、participant、Host、RunAttempt、responder 或 lease 时长；这些字段均由当前 Worker execution grant、Task projection 和 daemon config 固定。Task 必须属于该 Room/assignee，且其 `task.created` 或关联的 `input.resolved` 必须已落在当前 Activation range 内。

5. 每个命令必须带 `idempotencyKey` 与 `basedOnRoomSeq`。service 只接受同一 credential 已投递或由前一个成功命令产生的 causal cursor。业务幂等键应按 Task/operation 稳定，而不是按 Provider session 或 RunAttempt 生成；幂等重放验证业务参数但不要求新的 request 复用旧 RunAttempt 的 causal cursor。新 RunAttempt 先读取 canonical Task，在本次已投递 cursor 上重放旧步骤，并继续尚未落账的步骤。

6. Activation `toSeq` 不包含 lease/run 等随后产生的运行事件。Task freshness 因此忽略 `activation.*`、`inbox.*`、`run.*`、`runtime_process.*` 观察/投递事件；恢复同一 Task 时也忽略该 Agent 已经持久化的旧 `claimed/started/progressed/submitted` 步骤。任何人类事件、其他 actor、其他 Task、membership 或其他业务事实仍触发 `stale_context`。这不是第二条 ledger；所有事实仍位于同一 Room sequence，只是 freshness 明确区分业务输入、已知的同 Task 工作流与运行观察。

7. CLI stdout、JSONL、thinking 与 tool stream 不参与 Task 判定。gate 只查询 Task projection 与 durable Room events。

### 补充（2026-09-27，evo 验收缺陷 D1/D2）

- 决策 2 的完成义务只来自 Activation `toSeq` 之前已经存在的事实。经 `message.posted` 来源关联的 Task，只有其 `task.created` 的 `room_seq <= toSeq` 才构成义务；Agent 在本 Activation 运行期间用 `task-claim-message` 自建的 Task 不给本 Activation 追加义务，Task 停在 `in_progress` 合法，Activation 完成也不改变它。Human 显式分配、Agent 只 ACK 的原用例不变。
- 义务拒绝的错误文本带 `RAH_BUSINESS_OBLIGATION_UNMET` 标记（`packages/protocol/src/runtime-failure.ts`）。它不是 Runtime 故障：AgentHost 在本轮 `final` 回复已落账时不再重跑，直接以 `action_required` 进入隔离；未落账时仍按 recoverable 重试并计入同错 fence。带该标记、fence 为 blocked 且无存活运行的隔离不占用该参与者的执行 lane（`activationHoldsLanePredicate`），其他房间和私聊照常放置；Runtime 类 fence 仍占 lane。
- 重跑窗口陈述事实：此前尝试已提交的 final 回复（message、所在 Thread）与拒绝原因（`previousAttemptReplyMessageId/ReplyFinal/ReplyThreadId/Refusal`），不增加行为规则。
- Human 出口：`instance.activation.abandon` 取消一个被 blocked fence 停住的 Role 实例 Activation 并解除 fence，写 `instance.activation_abandoned` 与 `activation.cancelled`，不改写已结束的 RunAttempt，不改变 Task；也处置修复前留下的无标记 retry_blocked 隔离。
- 后续（未做）：删除 legacy SQL，改为 Human `createTask(assignee)`/assign 时冻结 typed `task_owner_follow_up`（2026-09-02 审计的原意），需迁移与回填。

## 证据

- protocol conformance 覆盖 strict Task projection、窄 query 和四种 Worker command request/response；
- Kernel 测试覆盖原子创建、完整状态机、错误 assignee、业务 stale context、active claim 冲突、无 Room event 的 lease heartbeat、过期重新领取、显式完成、未提交 Task 的 Activation completion proof，以及 causal cursor 变化时的跨 RunAttempt 幂等重放；
- Worker HTTP 测试覆盖 projection query、字段注入、未投递 causal cursor、命令串联、自动 heartbeat、幂等 retry 与 execution fencing；
- fake CLI 通过完整 `DaemonApplication -> GenericProcessAdapter -> Worker API -> RoomKernel` 链产生 `task.created -> task.claimed -> task.started -> task.progressed -> task.submitted`；故障 fixture 第一次在 `task.started` 后退出 7，第二个 RunAttempt 从 canonical projection 恢复且不重复业务事件；另一个只做 `sync/ack` 的真实子进程 fixture 被 Kernel 拒绝 completion，并由 AgentHost durable requeue；
- opt-in Codex CLI `gpt-5.6-luna` 在本机约 45.5 秒通过同一 Task gate。pass/fail 未读取其 transcript。

## 声明边界

- 当前没有 dependency、block/cancel/reassign、Artifact、Review evidence、worktree lease 或 verifier；`waiting_input` 当前只支持 creator responder 与文本 answer。`completed` 只是 creator 的显式验收，不等于完整 review 系统。
- Worker 只有 activation-scoped 单 Task query，没有通用 list；Room snapshot 也尚未包含 Task projection。过期 claim 恢复需要显式 reclaim command，而不是 heartbeat 复活过期 ownership。
- 当前已追加证明本机 SQLite/loopback config v4 双 participant daemon；仍不证明远端 Host、多租户、真实 mixed CLI 或 hostile same-user 隔离。
