# ADR-0020：Task 意图、单一负责人和次级角色

状态：accepted；evo 的创建入口政策已由目标合同 §3a（2026-10-01）替代，本文保留 main 历史及其余有效不变量。

## 背景

Room 中的 Human 消息既可能是普通讨论，也可能是需要持续执行、进度、恢复和验收的工作。如果把“使用工具”“读取文件”或“查询日期”直接等同于 Task，会重复 Raft 中简单问答被错误认领为 `#1/#2` 的体验问题；如果所有 Agent 都能独立认领同一 Task，又会产生冲突写入和重复执行。

同时，复杂工作通常需要协作和审阅。它们不能破坏一个 Task 只有一个执行 owner 的约束，也不能依赖客户端临时状态。

## 决策

1. Human 未勾选“作为任务”的顶层消息默认是普通 Message。读取文件、搜索互联网、调用工具或查询日期本身都不是 Task 证据。
2. Human 可以显式创建 Task，并选择一个负责人、零个或多个协作者、零个或多个审阅者。开放 Task 不得携带次级角色；先指定负责人，才能配置次级角色。
3. Agent 只在消息明确要求长期或多步骤执行、持久修改或制品、持续进度/恢复、委派或验收时，才可调用 `task-claim-message` 将当前 Activation 中的 Human 顶层 Message 原子转换为 Task。Agent 必须提交分类理由。
4. `source_message_id` 唯一约束与同一 transaction 中的创建、分配和 claim 形成竞争门禁。多个 Agent 同时判断为 Task 时只有一个成功；冲突方停止重复执行并服从已有 owner。
5. Task 始终只有一个负责人和一个执行锁。协作者在创建后收到 `task_collaboration` Activation，并把证据写入 canonical Task Thread；审阅者只在 `task.submitted` 后收到 `task_review` Activation，并把审阅结论写入同一 Thread。
6. 同一 Agent 可以同时是协作者和审阅者。Activation 可以合并多项业务事件，因此消费者必须逐项履行同一批次中的全部角色，不能用互斥分支只处理第一个角色。
7. 释放或取消负责人时同时清除次级角色，使开放 Task 回到可竞争且无隐含委派的状态。

## 所有权

- Protocol 定义 Task 角色、Agent 自动认领命令和 Activation reason。
- Kernel 原子验证 Room membership、写入 `task_participants`、派生 Inbox/Activation，并维护单 owner 不变量。
- Worker Application Service 只暴露 causal command，不自行分类或伪造 actor。
- Runtime standing prompt 解释分类阈值；具体 Agent CLI 负责语义判断，但 Kernel 决定最终竞争结果。
- Web/PWA 只提交显式 Human 选择并投影 canonical Task，不在页面中猜测 Agent 意图。

## 验收

- 普通日期/时间问答不会产生 Task。
- 显式 Task 的负责人、协作者和审阅者可在浏览器配置并刷新恢复。
- 协作证据和审阅证据进入唯一 Task Thread；同一 Activation 合并两种角色时两项都执行。
- 两个 Agent 对同一 Message 自动认领时只生成一个 Task、一个 assignee 和一个执行结果。
- 桌面与 `390x844` 使用同一协议和组件路径。

2026-08-29 的验收证据同时覆盖了三家真实 CLI 与正式 Web 浏览器：日期问答得到三条 Message、零 Task；持久修改请求在未勾选 Task 时只得到一个 `submitted` Task、一个 Kimi owner、两条同 owner Thread 回复和精确工作区制品。数据库中同一 `source_message_id` 的 Task 计数为一。桌面与 `390x844` 的 Task、Room 抽屉和 Thread 走同一 canonical projection，控制台无错误。

## 后果

该设计保留 Raft 的单 winner 优点，同时把“是否成为 Task”的阈值收紧为可说明、可审计的业务意图。Agent 的语义判断仍可能出错，因此 Human 显式 Task 是最高优先信号；自动转换必须保留理由，后续可据真实误判样本调整 standing prompt，而不改变 Kernel 协议。

## 2026-09-14：Human 任务编辑对齐 Raft

用户明确撤回将人工状态编辑限制为执行/提交/审阅派生动作的产品规则。
Human creator/Room manager 通过 `task.workflow.update` 可以选择全部五个业务状态，
包括完成回待办/待确认、关闭回任意状态。状态仍写 canonical Task state，由原触发器
生成 workflow_status；不恢复第二份可分歧的工作流真相。

人工“进行中”允许无执行 claim；人工“待确认/完成”允许没有 Agent 提交证据。
这些操作记录 Human 编辑事件，不伪造 RunAttempt、claim、submissionSummary 或冻结制品。
真正 Worker 的 claim、start、submit、review 和证据式 completeTask 仍验证各自执行权限。
Task schema 中 claim owner/expiry 必须成对；执行阶段根据实际 claim 展示，人工进行中
不代表 Runtime 正在运行。已有提交、审阅和历史记录保留。

Human 负责人编辑允许 Room 内 Human/Agent 或未指派；统一使用
assign/unassign 接口。2026-09-20 对齐 Raft：完成状态拒绝人工指派和取消指派，
须先重新打开；待办、进行中、待确认和已关闭沿用原权限控制。删除 Agent 的系统清理
仍解除所有状态任务的负责人而保留任务状态，不受人工编辑限制。将次级角色成员提升为 owner 时移除其冲突角色；取消负责人清除
次级角色。单一 owner 不变。旧 Worker claim 原子撤销，已有停止请求负责真实进程终止；
停止未完成前拒绝新 claim，界面仍可继续编辑最新的意图。不是通过前端隐藏限制规避后端。
变更、事件、通知/Outbox 在同一事务；保留权限、最新 Room seq 与精确幂等校验。
