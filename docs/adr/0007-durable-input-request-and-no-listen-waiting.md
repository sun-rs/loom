# ADR-0007：Durable InputRequest 与无 listening 等待

状态：Accepted（InputRequest slice E2 local，2026-08-26）

## 背景

Agent 提问后继续运行 MCP `room_wait`、短轮询或 Provider session，会把“用户多久回复”错误地变成一次 LLM turn 的生命周期，也会持续占用 token。仅把 Task 标为 blocked 也不够：若人类回复不能可靠地产生 Inbox、Activation 和新的执行权限，回复仍可能丢失，或迫使系统解析旧 CLI session 才知道从哪里继续。

## 决策

1. Task 状态机增加 `waiting_input`，Kernel 增加 canonical `InputRequest` projection：

   ```text
   Task in_progress
     -> InputRequest pending + Task waiting_input
     -> human resolution
     -> InputRequest resolved + Task todo
     -> new Activation
     -> Task claimed -> in_progress -> submitted
   ```

   `InputRequest` 固定记录 Room、Task、requester、designated responder、question、answer、resolution identity 与时间。pending projection 不允许携带伪 resolution evidence；resolved projection 必须拥有完整 evidence。当前最小策略把 human Task creator 固定为 responder，Worker 不能注入 responder、actor 或 Room；若 Task creator 不是 human，command 在写入任何状态前 fail closed，避免制造永远无人处理的 Inbox。

2. Worker 的 `tasks/request-input` 是严格 causal command，只允许持有有效 `in_progress` claim 的 Task assignee 调用。在一个 transaction 内，Kernel 创建 pending InputRequest、把 Task 置为 `waiting_input` 并清除 claim、追加唯一 `input.requested` Room event，再给 responder 创建 InboxItem。人类不会因此得到 Agent Activation；Worker service 看到 `waiting_input` 后停止该 Task 的 sidecar heartbeat。

3. `waiting_input` 是当前 Activation 的合法业务停点。Worker 确认原 Activation range 后可以退出，AgentHost 写 terminal proof 并完成 Activation；等待期间没有 RunAttempt、LLM turn、MCP listening 或 timer-owned session。Room event/Inbox 是提醒人的 durable truth，UI push 尚未实现。

4. 只有 authenticated designated responder 可以 resolve。`resolveInputRequest` 校验 causal cursor 与稳定 idempotency key，在一个 transaction 内冻结 answer/resolver/time、把 Task 恢复为 `todo`、追加 `input.resolved`，并给原 requester 派生 InboxItem、`input_resolved` Activation 与 content-free wake Outbox。answer 位于 canonical Room event，因此新 CLI session 通过 `sync` 读取，不需要旧 transcript。

5. Worker Task 权限和 Activation completion proof 同时识别两种 Task linkage：Activation range 内的 `task.created`，以及 payload 指向该 Task 的 `input.resolved`。因此回复后的新 execution 可以查询/认领原 Task；若只 ack 回复后退出，Kernel 会因该 Task 仍为 `todo/in_progress` 拒绝完成并 durable retry。Task 再次进入 `waiting_input` 或达到 `submitted/completed` 才能结束本次 Activation。若 human 在 requesting CLI 尚未退出前快速 resolve，当前 Activation 仍以其 range 之后、由当前 participant 写入的 `input.requested` 作为已暂停证明；它可以完成，而 `input.resolved` 已 durable 排入 follow-up Activation，不能因 Task 已回到 `todo` 误启原 Activation retry。

6. 每个 Task 最多一个 pending InputRequest，由数据库 partial unique index 强制。request 与 resolve 都使用业务幂等键；重试不会重复 event、Inbox 或 Activation，相同 key 携带不同 question/answer 会 fail closed。

7. Worker 另有 activation-scoped `tasks/input-status` query，只返回 latest `inputRequestId/taskId/state`，不返回 question 或 answer。若 CLI 在 `input.requested` 已提交但原 range 尚未 ack 时崩溃，重试 session 可据此确认 Task 已暂停、补 ack 后退出；只有 range 内实际收到 `input.resolved` 的 follow-up execution 才读取 answer 并继续。这样既不依赖旧 transcript，也不让旧 Activation 越界读取较新的业务内容。

8. Kernel schema 升级到 v3，并在初始化时原地迁移 v2 Task CHECK constraint；既有 Task 行必须完整保留。Provider session、stdout、JSONL、thinking 与 tool stream 不参与迁移或恢复。

## 证据

- protocol conformance 覆盖 `waiting_input`、严格 InputRequest resolution evidence 与 `request-input` request/response；
- Kernel fixture 覆盖原子 request、claim 释放、human Inbox-only attention、错误 responder、resolve 幂等、快速回复竞态、`input.resolved` Task scope、新 Activation 与双向 completion proof；
- migration fixture 保留 v2 Task，并证明新状态约束生效；
- Worker HTTP fixture 覆盖字段注入拒绝、canonical response、无内容泄露的 status query、幂等 replay 与 heartbeat cleanup；
- 完整 daemon fixture 第一个 fake CLI 在 InputRequest commit 后、ack 前故障退出；第二个 RunAttempt 通过 status query 补 ack 后退出，且不重复 InputRequest。等待窗口内 RunAttempt 数保持不变；human resolve 再触发新的 Activation/RunAttempt，新 CLI 从 Room event 读取 answer 并提交同一 Task。pass/fail 不读取子进程输出。

## 声明边界

- 当前 designated responder 固定为 Task creator；尚无多人候选、角色/policy routing、InputRequest cancel/expire、表单 schema、附件、敏感答案分级或超时升级。
- human resolve 已有受认证的 loopback daemon Client API，fake daemon E2 已通过该 transport 完成 `sync -> resolve -> new Activation`；尚未接入 Web/PWA、CORS、LAN 或 push。
- human Inbox 已 durable；APNs/Web Push/macOS notification publisher 和 UI 尚未实现。
- Task dependency、block/reassign/cancel 后续已由 [ADR-0011](./0011-task-coordination-v1.md) 实现；Artifact、Review、worktree lease 与 verifier 仍未实现。
- 真实 Provider 尚未复跑 InputRequest gate；当前只证明确定性本机 fake process 链路。
