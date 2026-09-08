# Worker 闲置任务管理、消息转待办与父任务恢复

日期：2026-09-08。当前覆盖本地单 Human、多 Agent 的 `assign/unassign`、`convert` 与随后独立收口的 `unblock`；不包含 amend/delete、强制重新分配或 Agent 自行最终 done。来源是 Raft Computer 1.0.18 `agentApiContract.ts` 的 374/1653（负责人可设为 null）、407/1693（消息转换且不认领）；固定来源哈希和链接见 [合同映射](../product/raft-agent-api-contract-map.zh-CN.md)。实现为既有 RAH owner 复用与 facade，没有逐字复制未公开服务端。

## 当前实现

- `task-assignment-service.ts` 从既有 `RoomKernel.assignTask` 提取同一事务；Human 与 Worker 共用，不复制任务状态。清除负责人复用 `task-unassignment.ts`；原 Human freshness 默认语义保留。
- Worker 只能管理自己创建的 `todo` 且未认领 Task，目标必须是当前 Room enabled Agent。该 Task 必须已在执行的因果范围内，或有本 Run 的真实 `task.created` 证据。不能借新的 read 工具授权管理未来 Task，不能覆盖活跃 owner。
- `task-convert` 复用 `createTaskMutationTransaction`、source Message 唯一锚点与原 Thread；创建者为实际调用 Worker，原消息作者保持不变。转换只产生 todo，不认领；顶层消息必须属于当前 Room 且不晚于 `toSeq`。同源并发仍只有一个 Task。
- 所有请求先认证有效 Run/grant/成员，HTTP 使用原 known causal cursor。新事件保留真实 runAttemptId，成功回执可继续原 Task 因果链；合法幂等重试不重派发，目标退群后原成功回执仍可读取，发起者自身的认证与成员围栏不能绕过。
- CLI `task-assign --task-id ID --assignee AGENT_ID` 或 `--unassign`、`task-convert --message-id ID` 均显式携带 causal cursor 和稳定键。帮助与 standing prompt 指明“不认领”“本人创建且空闲”；Human 最终验收没有变化。
- Protocol 入口原 Task response schemas 按 owner 提取到 `task-response.ts`，公开导出兼容；source-size ratchet 未抬高。

## 当前验证证据

证据根目录：[Worker 当前收口证据](/Users/sun/Code/reviews/rah_os/2026-09-08-worker-read-tools)。

- 两条真实 grant HTTP 路由先 404 RED，再实现。CLI 缺命令和 prompt 缺必要指引分别 RED→GREEN。
- `worker-task-management.test.ts` 验证正常分配/清除、同源唯一、非创建者拒绝、活跃 owner 拒绝、新事实 stale、同 key 改目标冲突、撤销凭据；临时 DB 故障注入目标 membership 撤销后，原已发布事件重放无二次分配。
- 真实外部 Node child 使用实际 Worker CLI 完成 convert → assign teammate → clear → canonical task-history，验证没有 claim、同一 sourceMessageId/Thread 和唯一 Task。此处“真实子进程”是确定性 fake provider 测试，不是付费模型证据。
- 定向 10 项通过（含 source-size ratchet），见 `task-management-child-green.log`；`task-management-tsc.log` 为空且对应类型检查 exit 0。
- 相关包回归当次 467 项：466 通过，唯一失败为另一个并行批次新 self-profile 测试在模块落盘前的 import RED，日志 `task-management-package-regression.log` 原样保留。没有将该日志称为全套 GREEN；最终同一候选全仓检查由主交付记录。
- Task 管理独立审计最终 6 项通过，见 [review-closed.log](/Users/sun/Code/reviews/rah_os/2026-09-08-worker-management-independent/review-closed.log)。审计曾复现空正文转换与负责人/secondary role 重叠返回 500，两者现为明确 409；失败不留下 Task、角色变更或事件。正式 RED/GREEN 见 `task-management-edge-red.log` 与 `task-management-edge-green.log`。网页/正式部署/付费模型均不由上述测试自动推出。

## 父任务恢复闭环

Raft `taskUpdateStatus`（R1:1663）包含任务状态推进。本地沿既有 `unblockTask` owner 提取 `task-unblock-service.ts`，Human creator 权限与原事务语义保持；没有第二套 Task 状态。新 Worker `/v1/worker/tasks/unblock` 与 `task-unblock` 只接受 Task ID、明确 causal cursor 和幂等键，身份来自 grant。

- Worker 仅能恢复当前仍分配给本人的 blocked Task；最近一条 `task.blocked` 的 actor 必须为本人且序号不晚于本 Activation 的 `toSeq`。不能由只读新事实授权立即 undo 当前 Run 刚产生的 block。
- 当前 Room enabled membership、有效 Run/fence、known causal cursor 和新 Task/个人 attention 的 stale 检查仍成立。未完成依赖或 pending Human input 拒绝恢复。
- 接受后在同一事务写 todo 投影、`task.unblocked` 事件与原 attention/Outbox；不添加 claim、不扩当前 grant。Agent ACK 原始 sync cursor 并退出，下一 Activation 获得真实 task.unblocked 投递，再走正常 claim/start/progress/submit。
- 合法相同请求重放不添加事件或唤醒；并发不同键只有一个成功改变 blocked 状态。事件写入失败会回滚投影，重试仍安全。

### 当前候选实际证据

- `parent-unblock-red.log`：两个新增 HTTP 正反测试在缺路由时 404 RED；实现后本人恢复与七类拒绝（别的 blocker、改 owner、未来 block、依赖、pending input、stale、撤销成员）均通过。真实 credential.revoke 后重放仍 401。
- `parent-unblock-daemon-green.log`：实际 Daemon +外部 Node fake CLI 在 14 秒内跑完：Human 消息→parent claim/start→并行两个子任务→审计/返工→Human 完成两个子任务→Human 唤醒原 blocker→unblock→不同 Run claim/start/progress/submit→Human 完成 parent。关闭后用新 Kernel 连接读取，三个 Task 均 completed；断言 unblock 和重新 claim 的 runAttemptId 不同。
- 该确定性链最初超时，因为 fake CLI 已识别 task.unblocked 是业务事件却未将它解析为 taskId。修正测试 provider 的事件选择后全链通过；未为通过测试放宽产品投递围栏。原失败保留 `parent-unblock-chain.log`。
- 独立 [unblock-review.log](/Users/sun/Code/reviews/rah_os/2026-09-08-worker-management-independent/unblock-review.log) 3 项通过，另验并发、成功回执在新事实后重放、append 故障事务回滚、缺失本人 block 来源。该反例夹具显式使用历史 DB 数据，不能替代前述真实 block/Run 连续链。
- 最后产品冻结后，读工具/管理 HTTP/CLI/self-profile CLI/prompt/protocol 定向 28 项通过，见 `final-focused-regression.log`。全仓检查、正式重启与后续付费 CLI 门禁由主交付报告单独记录；本文件不将先前真实三 CLI 的“两个子任务 completed、parent blocked”证据改写成父任务已完成。

## 保留差异

- 附件-only 顶层 Message 没有正文时，convert 明确 409，提示建立有显式标题的 Task。这仍是适用差异；Raft convert schema（R1:407–410）只有 channel/message_id，无可选 title/description。本批未猜上游自动标题算法，不把拒绝当作完全等价。
- `amend` 与真正 `delete` 尚未新增；progress 不等于标题/描述修改，closed 不等于删除。Human 最终验收继续属于已批准本地合同。
- 批量参数与 Task 短号为便利差异：已有逐条操作可以达到多个独立 Task 的结果，但不承诺上游批量原子性；不能把便利参数未齐误记为整个任务闭环缺失。
