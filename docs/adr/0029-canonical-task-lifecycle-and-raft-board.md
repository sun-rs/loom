# ADR-0029: canonical Task 生命周期与 Raft 五态看板

## 状态

已接受，2026-09-05。取代 ADR-0027 中关于独立编辑 `workflow_status` 的决定。

**决策 4 整条已于 2026-09-14 被取代**，仅作为历史记录保留。用户明确撤回了把人工状态
编辑限制为"执行/提交/审阅派生动作"的产品规则，因此决策 4 的四条子规则
（`closed` 委托 canonical cancel、`todo` 只从 `cancelled` 重开、`done` 只从 `submitted`
完成并过 Review gate、`in_progress`/`in_review` 只能由真实认领与冻结提交产生）
**全部不再是当前实现依据**。当前实现 owner 是
[`packages/kernel/src/human-task-edit.ts`](../../packages/kernel/src/human-task-edit.ts)；
证据与理由见 [2026-09-14 Human 任务编辑对齐审计](../audits/2026-09-14-human-task-edit-parity.zh-CN.md)
与 [ADR-0020 的 "2026-09-14：Human 任务编辑对齐 Raft" 一节](./0020-task-intent-single-owner-and-secondary-roles.md)。

### 当前规则：Human 通过 `task.workflow.update` 的状态编辑

授权：actor 必须是该 Room 的成员，且是 Task creator 或 Room owner/admin
（`requireRoomMember` + `requireHumanTaskManager`）。Agent 与普通成员不能通过看板编辑。

转移：**五个业务状态两两可达，没有前驱状态限制**。人工编辑直接写 canonical
`Task.state`，由决策 2 的固定映射反向落库：

- `todo` → `state = todo`，事件 `task.reopened`
- `in_progress` → `state = in_progress`，事件 `task.workflow_updated`；**允许没有执行 claim**
- `in_review` → `state = submitted`，事件 `task.workflow_updated`；**允许没有 Agent 提交证据**
- `done` → `state = completed` 并写 `completed_at`，事件 `task.completed`；不经过 Review gate
- `closed` → `state = cancelled`，写 `cancellation_reason = "Closed by Human"` 与
  `cancelled_at`，事件 `task.cancelled`；这是 Human 编辑路径自己的写入，不再委托
  决策 4 所说的 canonical cancel 命令

每次人工状态写入都会清空 `claimed_by`、`claim_until`、`claim_until_ms`、
`blocked_reason`、`blocked_at`；`completed_at` 只在 `done` 时写，取消字段只在 `closed`
时写。`todo → in_progress` 且原本无负责人时，编辑者成为负责人。该 Task 上处于
`pending` 的 InputRequest 会被取消（原因 `Human changed Task status`），以免旧提问
覆盖更新的人工状态。人工编辑不伪造 RunAttempt、claim、`submissionSummary` 或冻结制品；
"进行中"不代表 Runtime 正在运行。

### 未被取代、仍然严格的围栏

- **Worker 执行权限**：claim、start、submit、review 与证据式 `completeTask` 各自验证
  执行身份与权限，人工编辑不产生 claim，也不能替代这些证据。
- **Runtime cancellation fence**：状态或负责人改变时，若该 Task 仍有 `claimed_by`，
  会通过 `requestActiveTaskExecutionCancellation` 发出真实的执行取消请求；停止未完成前
  拒绝新 claim。人工"关闭"不等于进程已终止，也不绕过终止证明。
- **终止证明与依赖唤醒**：不变；Activation 完成仍需终止证明，隔离/quarantine 解除仍需证明。
- **投影不变量**：`workflowStatus` 仍只是 canonical `Task.state` 的投影
  （决策 1、2、3），不存在第二套可分歧的工作流真相；schema 48 的数据库 trigger 与
  公共 `Task` schema 校验保持不变。
- **所有权、幂等与事件**：决策 5、6、7、8 全部有效——真实 actor、`basedOnRoomSeq`
  陈旧检查、精确幂等身份（同键不同目标状态必须冲突）、依赖唤醒返回值、前端五列合同、
  以及浏览器验收必须独立读取 `task.list` 与 Room ledger。

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
4. **（历史，2026-09-14 整条被取代，见上方"状态"一节）** `task.workflow.update` 保留为五态 UI 的单一 typed intent，不再是第二套状态机：
   - `closed` 委托 canonical cancel，并保留 Runtime cancellation fence；
   - `todo` 只从 `cancelled` 委托 canonical reopen；
   - `done` 只从 `submitted` 委托 canonical complete，并执行 Review gate；
   - `in_progress` 与 `in_review` 只能由真实认领/启动与冻结提交命令产生，状态菜单不能伪造。
5. Task creator 或 Human Room owner/admin 可以执行上述管理动作；Agent 和普通成员不能通过看板绕过所有权。事件仍记录真实 actor、目标 Task、`basedOnRoomSeq` 与精确 idempotency identity。
6. 完成 Task 时返回实际派生的 dependency-ready Activation IDs；重放不重复派生。幂等键若被复用于不同目标状态，必须返回冲突，不能把不同命令伪装成成功重放。
7. 前端继续显示 Raft 的五列、顺序、标签、颜色和同一个状态浮层。无 canonical 动作的项目保留在相同菜单位置但明确禁用并说明原因；Room Task 与全局 Tasks 继续复用同一组件和命令。
   （2026-09-14 起，对有权限的 Human 来说五个状态都有 canonical 动作，因此状态浮层不再
   因"缺少执行证据"而禁用任何一项；禁用只剩权限与陈旧上下文两种原因。）
8. 浏览器验收必须在真实点击后独立读取 `task.list` 与 Room ledger，同时证明 `state=completed`、`workflowStatus=done`、`completedAt` 和对应 `task.completed` 事件。只检查卡片位置不再算业务通过。

## 结果

（本节已按 2026-09-14 的当前规则更新；被取代的表述见下方"历史结果表述"。）

- UI 仍保持 Raft 可见合同，Kernel 不再让视觉整理改变"工作完成"的定义：
  `workflowStatus` 始终是 canonical `Task.state` 的投影，不是第二份真相。
- **人工状态迁移不再被禁用**。Human creator / Room manager 可在五态间任意迁移，
  与 Raft 的看板行为一致；人工"进行中/待确认/完成"不需要 claim、提交证据或 Review gate。
- 人工编辑不伪造执行事实：不产生 claim，不写 RunAttempt、`submissionSummary` 或冻结制品；
  界面上的"进行中"不代表 Runtime 正在运行。
- Worker 的 causal cursor 不会因看板动作前移；状态或负责人改变时，若该 Task 仍被认领，
  会发出真实的执行取消请求，停止未完成前拒绝新 claim。真实取消仍可安全停止活动执行。
- 依赖唤醒与幂等冲突仍是同一业务事务的一部分；Review 仍是 Worker 提交路径的一环，
  只是不再是 Human 把任务标记为完成的前置条件。

### 历史结果表述（2026-09-05，已被取代）

> 与 Raft 的刻意差异仅限于没有真实认领/提交证据时禁用迁移；该差异用于保护 RAH OS 的
> 本地多 Agent 执行可靠性，不改变五态页面结构。

该差异已由用户于 2026-09-14 撤回。保留此句仅为记录当时的决定，不作为当前实现依据。
