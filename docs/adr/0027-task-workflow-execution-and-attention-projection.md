# ADR-0027: Task 工作流、执行阶段与注意事项分层

## 状态

已被 [ADR-0029](./0029-canonical-task-lifecycle-and-raft-board.md) 取代。第 1–5 条仍作为历史投影背景；第 6–9 条允许独立 `workflow_status` 写入的决定不再有效。

## 背景

Raft 的用户可见 Task 看板固定为五个工作流状态：`todo`、`in_progress`、`in_review`、`done`、`closed`。RAH OS 的既有持久化模型还包含 `claimed`、`waiting_input`、`blocked`、`submitted`、`completed` 与 `cancelled` 等状态。这些值混合了三类天然不同的信息：工作流位置、当前执行阶段，以及是否需要人类介入。

如果前端直接显示持久化枚举，就会产生 Raft 中不存在的列、标签和筛选；如果直接删去额外状态，则会丢失原子认领、等待输入、阻塞原因和取消栅栏等后端证据，并破坏 ADR-0011、ADR-0020、ADR-0021、ADR-0022 的并发与审阅约束。

## 决策

协议包是 Task 生命周期投影的唯一所有者。所有客户端都使用同一投影，不在页面内自行推断。

1. `workflowStatus` 是 Raft 对齐的五态公开合同：
   - `todo` → `todo`
   - `claimed | in_progress | waiting_input | blocked` → `in_progress`
   - `submitted` → `in_review`
   - `completed` → `done`
   - `cancelled` → `closed`
2. `executionPhase` 是正交执行证据：`idle | claimed | running | cancelling`。
3. `attention` 是可选的人类介入证据：`waiting_input` 或带原因的 `blocked`。
4. `cancelling` 只能由真实的取消请求所有者提供，不能从 `cancelled` 或运行日志反推。
5. 页面、筛选、颜色、列标题和可访问语义只消费 `workflowStatus`；执行与注意事项只能作为次级说明，不能创建第六个工作流列。
6. schema 44 在既有八态执行存储旁增加独立 `workflow_status`，旧数据按确定映射回填；内部执行状态变化继续同步其自然工作流位置。协议在旧记录缺字段时仍保留兼容投影，不做破坏性重写。
7. Task 看板优先复刻 Raft：Room owner/admin 对齐 `deleteAnyTask` 能力，菜单按 Raft 顺序显示全部五态；普通成员按 Raft `Att/Itt` 转移图显示当前项与允许的后继项。所有写入统一使用 typed `task.workflow.update`，当前项保持可点击但不发起写入。页面不得依据认领、提交或审阅证据禁用 Raft 本来开放的状态。
8. `task.workflow.update` 只改变工作流位置并发布 canonical 事件，不派生 Agent Activation，也不把看板整理动作解释为新的执行输入；认领租约、运行阶段、等待输入、阻塞原因、提交和审阅证据仍由各自命令持有。额外一致性增强只能在这些后台 owner 中实现，不得再次改变 Raft 的五态菜单与卡片移动行为。
9. 频道内 Task Tab 与全局 Tasks 页面必须复用同一个 Raft 看板 owner；不允许频道页面另行展示“确认完成 / 关闭任务 / 重开”等第二套卡片流程。RAH OS 的审阅、取消栅栏与安全改派作为后台执行能力保留，只能在后续取得 Raft 对应入口证据后接入匹配的详情面板。

## 结果

- Raft 的五列、标签、颜色和筛选可以逐项审计。
- Raft owner/admin 可从状态菜单直接选择五态，普通成员获得相同顺序的 Raft 转移图；菜单不再暴露 RAH OS 内部执行限制。
- Room Task 与全局 Tasks 使用同一张卡片、同一拖拽引擎和同一状态命令，不再发生页面间业务流漂移。
- RAH OS 保留本地多 Agent 调度所需的强一致性证据。
- Room Task、全局 Tasks、Activity 和未来客户端不会各自维护一份不一致映射。
- 后续若扩展执行阶段，只需扩展正交维度；除非 Raft 的公开合同变化，否则不新增用户可见工作流状态。
