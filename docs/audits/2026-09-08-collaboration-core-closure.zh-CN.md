# 2026-09-08 基础协作主链收口

本批基于 `672c596` 后的当前工作树，遵守单 Human、本机、Room 对话临时指派审计的范围。不建立专职审计角色，不新增调度系统，不迁移分发栈。

## 来源与采用边界

- Raft `raft-computer@1.0.18` 授权提取源：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/packages/shared/src/agentApiContract.ts`。`agentApiSendBodySchema`（约 243 行）明确提供 `target`、`idempotencyKey`、`sendDraft`、`continueAnyway`、`seenUpToSeq`；`/search` 明确以绑定 Agent credential 的可见性读取消息；`/channel-members`、Task/history、附件读取为基础工具。
- 保留现有来源登记的版本与散列。本批没有直接复制 bundle，也没有冒称能看到 Raft 服务端实现：显式 Thread ID、持久回执、Room 读权限与单 Human responder 是适配既有 RAH owners 的最小本地实现。
- 现有 Multica reuse ledger 与现有 Task/Room owners 不提供优于本地执行围栏的替代。因此未引入第二队列、cursor 或 Task 状态，也没有为表面对齐放宽 mutation 权限。

## 已实现行为

| 行为         | 单一 owner 与边界                                               | 结果                                                                                                                             |
| ------------ | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 显式回复目标 | `worker-message-routing`；`threadId` 为 ID，`null` 为 Room 顶层 | 多目标合批要求选择目标；单目标默认兼容；旧 Thread 不要求在 Activation 范围出现，但其创建事实不得晚于写入 cursor，且只能同 Room   |
| 因果与身份   | 既有 Worker HTTP grant / Kernel execution                       | 没有 sync 证明时显式 Thread ID 仍不能写；Host、RunAttempt、lease、membership/Agent enabled 围栏保持                              |
| 消息幂等     | `collaboration-service`                                         | 比较原消息意图，复用发布时派生收件人；后续成员或关注变化不会重复发言或重新派生投递                                               |
| held draft   | 同一消息 owner                                                  | 固定原 Thread；rehold 重试先返回原回执，不因 source draft 已变为 reheld 而失败；同 key 改成 continueAnyway 仍冲突                |
| Human 输入   | `worker-task-scope` 选择 responder；原 Kernel 事务写状态        | 当前 Human creator 优先，否则只有唯一当前 Room Human 可响应；零/多候选拒绝；原回执保留原 responder                               |
| 临时审计读取 | `requireWorkerTaskVisibility` / `requireWorkerRoomVisibility`   | 同 Room 普通 Agent 可读取 Task、冻结 Submission 和 published 附件；不需要预设角色，也不要求本次 Activation 直接投递 Task         |
| 普通附件     | `RoomFiles`                                                     | 同 Room consumed Message 附件与 Task 附件均可读；pending、未发送与跨 Room 文件拒绝                                               |
| 任务修改     | 原 `requireWorkerTaskDelivery`、claim、freshness owners         | 只读权限不会获得认领/提交/正式 Review 等写权限                                                                                   |
| 轨迹证据范围 | `worker-task-trajectory`                                        | 只选 canonical Task mutation 明确引用的 Run；响应明确 `scope=task_linked_run_diagnostics`，不再把后续无关联 Run 当成本 Task 证据 |
| 默认提示词   | `standing-prompt-compiler`                                      | 普通对话审计读证据后显式回到 Task Thread；预设 reviewer 仅作为历史显式配置的兼容流程                                             |

初批没有额外状态表。`RoomKernel` 路由委托给既有 owner，初批 6,907 行降至 6,863 行，未提高 6,925 行门禁；后续普通附件批仅扩展现有 held draft 的附件快照字段，见下述增补。

## 测试与证据

本批隔离证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-collaboration-closure/`。

- `rah-collaboration-red.log`：真实临时 Kernel 复现多 Thread 错归属、旧 Task 读取被错误阻挡、成员变化回执冲突、Agent 来源 Task 无法请求当前 Human 输入。
- `rah-collaboration-draft-red.log`：原 draft rehold 成功后相同请求重试错误拒绝。
- `rah-trajectory-red.log`：同 Agent 后续无关联 Run 混入任务轨迹。
- `collaboration-closure.test.ts`：逐目标写入、旧 Task Thread、跨 Room/未来 Thread、零/唯一/多 Human、成员变化回放、held draft、普通 published 文件、完整临时审计读取与回帖，以及写入拒绝。
- Worker HTTP 回归保留真实服务与凭据，新增未 sync 拒绝和多目标必须明确选择。
- 原来两条回归曾把错误行为当作预期：自动选择最新 Thread、Agent creator 一律拒绝 Human 输入。本批按上面的正确行为重写预期，保留原操作链。
- Input API 用例使用 150 ms claim lease 与系统实时时钟，在并行负载下曾失败；已将该确定性状态合同测试改为固定 Kernel 时钟，未放宽产品 lease，也未删除请求/回放/claim 释放断言。
- TypeScript、模块边界与本批定向检查通过。最终受影响 Kernel/Protocol/Application Service 全包加 Worker CLI、standing prompt 回归共 429 项通过、0 失败，见 `rah-collaboration-suite-handoff.log`；模块边界 2 项通过。没有将中途失败日志称为通过。

## 证据边界与未完成

1. 本批是代码、自动化 Kernel/HTTP/CLI 验证；不构成真实模型审计能力证明，也不构成官网双边行为验收。未调用付费 CLI，未启动额外 agent 调度逻辑。
2. 轨迹是关联 Run 的诊断上下文；同 Run 可以处理多个任务，不提供每条工具调用的精确 Task 归属。当前查询仍面向当前 assignee；Task 释放后无 assignee 的旧轨迹读取维持原失败边界，不扩张历史所有者查询。
3. Room 内当前只读可以返回新事实，但不能默默扩宽运行凭据 `toSeq`；新于已投递 Activation 的 Thread 写入仍通过 follow-up Activation。刷新动态 Worker 执行范围不属于本批。
4. 初批尚缺的 Worker history/resolve/members/task-list/task-history 等基础工具已由同日合同映射批接续。本报告的 429 项是初批证据，后续代码与验证以该批报告和下述增补为准；不代表全部 Agent API 对齐。
5. 本批未提交、推送、重启正式实例。正式工作台构建、全局检查、浏览器验收及持久数据备份重启由主任务合并收口。

## 同日后续反例：创建自己负责的 Task 后无法立即执行

普通附件的 Task 边界回归重新打开一条历史“已完成”结论：Worker `task-create --assignee self` 已返回 claimed，但 Task 创建事件晚于本 Activation 的冻结 `toSeq`，随后 `task-start` 被当成未投递 Task 拒绝；同一新 Task Thread 的 `message-post` 也被拒绝。两条都有真实临时 Kernel 失败测试，不靠模型描述判断。

最小修复仍由 `worker-task-scope` 拥有来源证明：同 Room、同 participant、同 RunAttempt 的 canonical `task.created` 才能补充原先的 Activation 投递证明。Task 修改仍需当前 Run、claim、lease 与 stale 检查；显式 Thread 回复只对该来源确定的 Task Thread 允许新于原 `toSeq` 的目标，原写入 cursor 与消息 freshness/hold 保持。普通旧 Thread 的已有可见性规则不变，刚刚 read/sync 的任意新 Thread 不因此获权。

`collaboration-closure.test.ts` 新增本人创建→start→Thread 回复、其他当前 Agent 的未来 Thread 拒绝、读取后无权新 Thread 拒绝、新要求继续 hold、终止 Run 凭据拒绝，以及 Task 授权不转移到无关新 Run/另一 Agent。日志 `rah-own-created-task-red.log`、`rah-own-created-thread-red.log`、`rah-collaboration-final-source-proof.log` 记录对应 red/green。

另在附件增补中验证：已 hold 的附件随后取消，原相同请求必须返回已持久化的回执；回放不要求文件仍可发布，新发送仍拒绝 canceled/expired。其协议、存储、真实 CLI child 与剩余边界见 [普通讨论附件收口](2026-09-08-worker-discussion-attachments-closure.zh-CN.md)。
