# ADR-0029: canonical Task 生命周期与 Raft 五态看板

## 状态

已接受，2026-09-05。取代 ADR-0027 中关于独立编辑 `workflow_status` 的决定。

## 来源与问题

Raft 官方 [Tasks 文档](https://docs.raft.build/zh-cn/features/collaboration/tasks/) 将五态定义为同一条业务生命周期：`in_progress` 表示已经认领并开始，`in_review` 表示工作完成并等待审阅，`done` 表示已经审阅并完成，`closed` 表示取消且可重开。官方典型流程也是 Agent 认领、提交审阅、Human 批准后完成。五列、状态菜单、颜色、拖拽与卡片布局仍是 RAH OS 的 UI 对齐合同。

schema 44 曾允许 `workflow_status` 与八态 `Task.state` 分别写入。这会产生“看板显示完成但 Task 仍排队”、运行中卡片被移动后 Worker 因陈旧游标永久失去接续、依赖任务不启动，以及浏览器只验证标签却没有验证真正完成等故障。

## 决策

1. Kernel 的 `Task.state`、冻结提交、Review、取消栅栏与依赖唤醒共同构成唯一业务真相。`workflowStatus` 只是在协议中保留的 Raft 五列兼容投影，不能覆盖 `Task.state`。
2. 投影固定为：
   - `todo` → `todo`
   - `claimed | in_progress | waiting_input | blocked` → `in_progress`
   - `submitted` → `in_review`
   - `completed` → `done`
   - `cancelled` → `closed`
3. schema 48 启动迁移会修复旧矛盾行，并用数据库 trigger 禁止以后插入或更新出矛盾组合。公共 `Task` schema 同样拒绝矛盾投影。
4. `task.workflow.update` 保留为五态 UI 的单一 typed intent，不再是第二套状态机：
   - `closed` 委托 canonical cancel，并保留 Runtime cancellation fence；
   - `todo` 只从 `cancelled` 委托 canonical reopen；
   - `done` 只从 `submitted` 委托 canonical complete，并执行 Review gate；
   - `in_progress` 与 `in_review` 只能由真实认领/启动与冻结提交命令产生，状态菜单不能伪造。
5. Task creator 或 Human Room owner/admin 可以执行上述管理动作；Agent 和普通成员不能通过看板绕过所有权。事件仍记录真实 actor、目标 Task、`basedOnRoomSeq` 与精确 idempotency identity。
6. 完成 Task 时返回实际派生的 dependency-ready Activation IDs；重放不重复派生。幂等键若被复用于不同目标状态，必须返回冲突，不能把不同命令伪装成成功重放。
7. 前端继续显示 Raft 的五列、顺序、标签、颜色和同一个状态浮层。无 canonical 动作的项目保留在相同菜单位置但明确禁用并说明原因；Room Task 与全局 Tasks 继续复用同一组件和命令。
8. 浏览器验收必须在真实点击后独立读取 `task.list` 与 Room ledger，同时证明 `state=completed`、`workflowStatus=done`、`completedAt` 和对应 `task.completed` 事件。只检查卡片位置不再算业务通过。

## 结果

- UI 仍保持 Raft 可见合同，Kernel 不再让视觉整理改变“工作完成”的定义。
- Worker 的 causal cursor 不会因无效看板动作前移；真实取消仍可安全停止活动执行。
- Review、依赖唤醒和幂等冲突成为同一业务事务的一部分。
- 与 Raft 的刻意差异仅限于没有真实认领/提交证据时禁用迁移；该差异用于保护 RAH OS 的本地多 Agent 执行可靠性，不改变五态页面结构。
