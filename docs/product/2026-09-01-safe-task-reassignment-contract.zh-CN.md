# 安全强制改派产品与协议合同

日期：2026-09-01

## 1. 来源裁决

本功能按“Raft 产品行为 → Multica 后端经验 → RAH OS 最小安全映射”的顺序设计。

- **Raft** 提供 Human 在 Task 上选择负责人、确认动作并回到同一 Task/Thread 的产品合同。RAH OS 复用这一入口、候选人选择、取消/Escape/焦点与等待反馈，不复制 Raft 中央服务拓扑。
- **Multica** 的 Issue 分派、preview 与 enqueue predicate 证明“负责人变化应由单一服务决定并与实际启动条件一致”；但 `server/internal/service/issue_trigger.go` 明确说明 reassignment 不再取消旧 task。该做法允许旧工作存活，不满足 RAH OS “一个 Task 同时只有一个执行 owner”的本机产品不变量，因此只吸收 predicate/idempotency 经验，不复制其改派语义。
- **RAH OS** 复用已有 Closed cancellation request、Worker command fence、AgentHost Runtime terminal proof、单 Agent lane 与 canonical Task/Activation。新增代码只负责把这些既有 owner 组合成 durable reassignment operation。

## 2. Human 产品合同

只有同时满足以下条件时显示“安全改派”：

1. 当前 Human 是 Task creator 且仍是 Room member；
2. Client 已追到 Room 最新 sequence；
3. daemon 宣告 `taskReassignment` 与 `taskWrite` capability；
4. Task 为 `claimed` 或 `in_progress`，并且 `assigneeId === claimedBy`；
5. 目标 Agent 是当前 Room member，且不是原负责人、协作者或审阅者。

弹层必须：

- 显示 Task 编号/标题、目标 Agent 选择与必填原因；
- 初始焦点在目标选择；Escape、关闭按钮和 backdrop 在非提交中可关闭；
- 提交后禁用关闭与字段，并明确显示“等待原 Agent 停止”；
- 失败保留用户输入，不伪装为成功；成功后回到同一 Task 看板并刷新 canonical projection。

## 3. Canonical 后端协议

`POST /v3/client/tasks/reassign` 只接收 Human intent：`taskId`、`assigneeId`、`reason`、`basedOnRoomSeq` 与 `idempotencyKey`。actor、Room、旧负责人和 Runtime 均由认证上下文及 Kernel projection 解析。

事务顺序固定为：

1. ACL、creator、freshness、Task 状态、目标 Room Agent 与角色冲突检查；
2. 创建 `task_reassignment_operations`，同一 Task 只允许一条非终态 operation；
3. 在同一事务创建 task-scoped cancellation request、把 Task 投影为 `cancelled`、追加 `task.reassignment_requested`；
4. 旧 Worker grant 立即失效，Scheduler/Placement/RunAttempt 对该旧 Agent 的活动改派 operation fail closed；
5. AgentHost 终止真实 Runtime，并持久化 RuntimeProcess、RunAttempt、Placement 与 cancellation resolution 证据；
6. daemon 只在所有 terminal proof 成立后继续 operation；
7. 同一事务把 Task 恢复为 `todo`、写入新负责人、追加 `task.reassigned`，只唤醒新负责人；
8. 新 Agent 重新 `task-get → claim → start → progress/submit`。Worker 的稳定幂等键必须包含 participant ID、Task ID 与 operation，避免与旧负责人已经落账的命令冲突。

HTTP 返回、进程退出文本、UI polling 或 Task 被临时投影为 `cancelled` 都不是终止证明。旧 Runtime 未终止时绝不把 Task 交给新负责人。

## 4. 故障和重放

- 相同 Human idempotency key 与相同 intent 重放既有 operation；不同 intent 复用该 key 会冲突。
- daemon 等待终止证明有界超时；超时返回明确错误，operation 和 fence 仍持久保留，不把未知状态解释为成功。
- Host crash 由既有 Runtime orphan recovery/cancellation resolution 处理；在证据不足时保持关闭。
- 旧 Agent 的 progress、submit 或普通业务写入在改派请求落账后被 Kernel 拒绝。
- 新 Agent 与旧 Agent 的 Task command key 分域；同一新 Agent 的重试仍可 deduplicate。

当前本机产品门禁假定 AgentHost 能在 30 秒内给出终止证明。极端不可终止进程会安全失败并需要诊断；自动恢复未决 Human operation 的独立管理页尚未开放，不能把 fail-closed 误称为完整无人值守恢复。

## 5. 验收矩阵

- Protocol：strict request/response 与 durable operation schema。
- Kernel：旧 Worker 立即 fenced；terminal proof 前 continue 被拒绝；proof 后只产生一个新 owner/Activation；重放不重复。
- Daemon：轮询 terminal proof；超时保持关闭。
- Worker：`task.reassigned` 可见且新 owner 可读取 Task；跨负责人幂等键不冲突。
- Web：creator/capability/state gate、弹层焦点/Escape/backdrop、必填原因、等待状态。
- 真实 Chromium：1440×1000 与 390×844 完整业务门禁中，Alice 持有运行中 Task，Human 改派到 Kimi，Alice Runtime 先终止，Kimi 后续 claim/start 并进入 `in_progress/submitted`；同时回归 Room、DM、Thread、Files、长历史、Task、Review 与 InputRequest。

此合同只宣布本机单 Computer 安全改派。跨 Computer control transport 不在本批范围。
