# ADR-0011：Task Coordination v1

状态：Accepted for implementation（2026-08-26）

## 背景

现有 Task slice 只支持 Human 在创建时指定一个 Agent。它证明了 `claim -> start -> submit -> human complete`，但没有证明聊天室中的多个 Agent 能看到开放工作并安全认领，也没有 release/reassign/block/cancel/dependency。因此当前 Core 能并发执行预分配任务，却还不是完整的多 Agent 协作业务核心。

## 决策

1. Task 可以是 assigned 或 open。`todo` Task 的 `assigneeId` 可为空；open Task 的 `task.created` 会投递给 Room 内全部 Agent member。每个 Agent 获得自己的 Inbox/Activation，但 Kernel transaction 只允许一个 Agent 把 Task 原子迁移为 `claimed`，并同时写入 `assigneeId/claimedBy/claimUntil`。失败竞争者只能观察 winner，不能获得第二份 Task ownership。
2. 同一 Task 永远只有一个写 owner。多人协作不采用“多个 Agent 同时 claim 同一 Task”，而使用父任务、子任务、dependency 与后续 Artifact/Review。这样避免并发修改一个业务 aggregate 时重新制造 Session/Council 双状态。
3. Agent 可显式 `release` 自己的 `claimed/in_progress` Task：Task 回到 open `todo`，清除 assignee/claim，并重新通知其他 Agent。Agent 可从 `in_progress` 显式 `block(reason)`：Task 进入 `blocked`，保留 assignee、释放 claim，并通知 creator；进程退出不能自行推断 block。
4. Task creator 可在无 active claim 的 `todo` 状态 assign/reassign；可把 `blocked` Task `unblock` 回 `todo`；可将任何非 terminal Task 显式 `cancel(reason)`。这些命令都要求 `basedOnRoomSeq`、稳定 idempotency key 和 Room membership。cancel 会清除 claim 并 fence 旧 Worker command，但不会把 runtime exit 当作取消证据。
5. Task state 扩展为：

   ```text
   open/assigned todo -> claimed -> in_progress -> submitted -> completed
                               |          +-> waiting_input -> todo
                               +-> released -> open todo
                                          +-> blocked -> todo
   any nonterminal -----------------------------> cancelled
   ```

   `blocked`、`waiting_input`、`submitted`、`completed`、`cancelled` 都允许当前 Activation 在 delivery proof 后结束；只有显式 Room command 改变业务状态。

6. dependency 只在 Task 创建时声明，并且只能引用同 Room 中已经存在的 Task；因此边天然从新 Task 指向旧 Task，不会形成环。Task 只有在所有 dependencies 都是 `completed` 时才可 claim。尚未 ready 的 Task 不产生 Agent Activation；完成一个 dependency 时，`task.completed` 在 payload 中记录本次变为 ready 的 Task IDs，并为其派生 Inbox/Activation。
7. 一个 Room event 可以让多个 Task ready，但每个 participant 对该 event 只生成一个 InboxItem；Activation 是“Room 有新工作”的提示，不是第二个 Task queue。Agent 从 event payload 和 canonical Task query 获取具体 Task。
8. open Task 的广播只面向当前 Room Agent members。候选能力/角色过滤、优先级、多个 assignee、Artifact/Review 和动态 dependency mutation 不进入 v1。

## Owner 与声明边界

- `packages/protocol`：Task projection、command/response schema、event payload contract。
- `packages/kernel`：Task/dependency transaction、原子 claim、权限、freshness、Inbox/Activation/Outbox 派生。
- Worker/Client HTTP、MCP、CLI、UI：仅翻译同一 command，不保存自己的 Kanban 或 claim 状态。

Task Coordination v1 完成只证明 canonical 多 Agent 认领与协作编排；它不等于 Artifact/Review、长期记忆、canonical workspace 或生产多 CLI daemon 已完成。

## 验收门禁

- 两个 Agent 收到同一 open Task，跨 Kernel connection 竞争只有一个 winner；
- loser Activation 可正常完成，不会被 winner 的 Task ownership 卡死；
- release 后其他 Agent 可认领，旧 execution 被 fence；
- block/unblock 和 cancel 都是显式、幂等、可审计 mutation；
- dependency 未完成时不能 claim、不能提前 wake；最后一个 dependency 完成后只产生一次 ready 派生；
- restart 后所有判断只依赖 SQLite canonical state，不依赖 CLI transcript/session。
