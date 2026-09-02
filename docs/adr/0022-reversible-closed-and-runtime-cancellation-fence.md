# ADR-0022：可逆 Closed 与 Runtime cancellation fence

状态：Accepted\
日期：2026-08-29

## 背景

Raft 当前 Web bundle 将 Task `Closed` 作为可逆状态：`closed` 可以转换为 `todo` 或 `in_progress`，Task 卡使用 `PATCH /tasks/:id/status` 保存转换。RAH OS 不能只复制这个前端状态图；如果 Human 在 Agent CLI 仍运行时关闭并重开 Task，旧 Worker 与新负责人可能同时写入同一 Task。

## 决策

1. Raft `Closed` 映射为 canonical `Task.state = cancelled`。只有 Task creator Human 可以关闭；请求必须带 causal `basedOnRoomSeq`、稳定 idempotency key 和非空原因。
2. 如果被关闭 Task 正由一个 leased Activation 的 Agent 持有，Kernel 在同一 transaction 创建 `activation_cancellation_requests`。该记录固定 Activation、attempt、Task、participant、请求者、原因和时间。
3. 未解决请求立即使旧 Worker grant 抛出 `ExecutionFencedError`，并使 Host 续租抛出 `ActivationCancellationRequestedError`。Provider 输出、普通进程退出或 UI 状态变化均不能解除 fence。
4. AgentHost 收到请求后取消真实 Runtime。只有 RuntimeProcess terminal proof 已保存、RunAttempt 已结束为 `cancelled`、Placement resource 已释放后，Host 才可调用 `resolveActivationCancellation`。
5. resolution 将 leased Activation 与同 lane queued follow-up 合并，恢复为一个 queued Activation，并保存 `activation.cancellation_resolved`。因此关闭事件不会丢失，且不会并行启动第二个 Runtime。
6. `task.reopen` 只允许 creator 从 `cancelled` 恢复到 `todo`。只要该 Task 仍有未解决 cancellation request，Kernel 就拒绝重开。重开清除当前 cancellation/submission 投影，但保留 Message、Thread、TaskSubmission、Review 和 Room event 审计历史；负责人及次级角色选择保留。
7. lease-expiry 和 proven quarantine recovery 在确认无活动 Runtime 后也会解决对应 cancellation request，防止 AgentHost 崩溃把 Task 永久锁死。
8. Human Client、SDK、Web/PWA 共用 typed `task.reopen`。Web 使用 Raft 现有 dialog/button/token 协议，关闭原因字段为初始焦点，不使用 `prompt()` 或另一条移动端行为路径。

## 后续实现

- “强制改派”现已按本 ADR 的限制实现：durable operation 组合 cancel/fence/terminal proof/assign，而不是直接改 `assignee_id`。产品与验收见[安全强制改派合同](../product/2026-09-01-safe-task-reassignment-contract.zh-CN.md)和[真实浏览器验收](../audits/2026-09-01-safe-task-reassignment-verification.zh-CN.md)。
- 本 ADR 仍不允许任何改派越过旧 Runtime 的 terminal proof。
- RAH OS 暂不开放 Raft 前端状态图中的任意 Human `todo -> in_progress`；`claimed/in_progress/submitted/completed` 仍由现有 Task business command 和 Review proof 决定。
- Closed 不是删除。Task anchor、Thread 和不可变 evidence 不会被移除。

## 验证

- Kernel：运行中 Task 关闭后旧 Worker progress 被 fence；提前重开被拒绝；terminal proof + cancelled RunAttempt 后 lane 合并重排，再允许 `Closed -> Todo`。
- AgentHost：挂起 Fake Runtime 在 lease maintenance 观察到关闭后收到 cancel，保存 `SIGTERM`，RunAttempt 为 `cancelled`，Activation 回到唯一 queued lane。
- Client：protocol、v1/v2/v3 service、SDK 均验证 actor-free strict reopen command。
- Chrome：`1440x1000` 真实创建 Task、填写关闭原因、进入“已关闭”列、重开为待办；同一门禁继续覆盖 `390x844`。
- 应用内浏览器：实际点击同一流程，确认 required reason 初始焦点、刷新后状态投影和 console 无 error/warn。

## 结果

Closed 不再只是看板颜色，而是一个跨 Human、Kernel、Host、Runtime 与 Web 的可恢复终止协议。RAH OS 保留 Raft 的可逆体验，同时拒绝 Raft UI 状态转换无法证明的双执行风险。
