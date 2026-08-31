# Raft 官方教程监督基线

状态：**Active / implementation gate**（2026-08-27）。

本文把 Raft 官方使用教程转换成 RAH OS 可执行的产品验收约束。它不是视觉参考笔记，而是 Message、Task、Thread、Agent 与 Human Review 前后端交互的监督基线。

## 1. 权威来源与优先级

本轮基线来自 Raft 官方文档仓库 commit `a594cb0a5dc0993a14a80e15ca24988bb2756326`，并与以下公开页面核对：

- [Hand off your first task](https://docs.raft.build/hand-off-your-first-task/)
- [Divide the work](https://docs.raft.build/divide-the-work/)
- [Tasks](https://docs.raft.build/features/collaboration/tasks/)
- [Threads](https://docs.raft.build/features/messaging/threads/)

监督优先级：

1. 官方教程定义用户旅程、页面职责和可观察行为；
2. 已登录官方页面用于核对当前布局、文案、反馈和操作细节；
3. 授权 Raft UI snapshot 用于几何、字体、图标、颜色和 DOM/CSS 回归；
4. RAH OS ADR 定义认证、因果一致性、幂等、租约和恢复等更强安全约束。

若官方教程与本地实现冲突，不允许用“界面已经相似”判定完成。若官方可观察行为与 RAH OS 的安全约束有张力，保持相同用户语义，同时由后端使用 causal command、事务和 fail-closed 裁决实现。

## 2. 官方首条主业务闭环

官方教程定义的最小闭环如下：

```text
Human 描述工作
  -> 顶层 Message 成为 Task
  -> Task 获得频道内连续编号、状态和至多一个 owner
  -> Agent claim 并工作
  -> progress/result 写入该 Task 的 Thread
  -> Agent 将 Task 置为 In review
  -> Human 在 Thread 中审阅
  -> Human 标记 Done，或回复要求继续
```

因此，下列规则不可妥协：

- Task 不是脱离聊天记录的独立看板卡片，而是带追踪元数据的顶层 Message；
- 只有 Channel/DM 顶层 Message 可以成为 Task，Thread reply 不能转换为 Task；
- 每个 Task 有 Room 内连续编号、状态、可选 owner 和唯一 Thread；
- Task Message 是 Thread root；进展、问题、结果和审阅意见进入该 Thread；
- Agent 退出成功不等于 Task Done；Human Review 是独立业务裁决；
- 幂等重试不得生成第二个编号、Message、Thread 或回复。

### 2.1 普通 Message 的 Thread 可见时序

2026-08-27 在已登录的 Raft 原版账户中完成了普通消息、悬停操作条、空消息列和已有回复摘要的只读实操核对。该行为同时与授权 snapshot 的 `slack.html` / `styles.css` 一致：

```text
无回复的顶层 Message
  -> 默认不显示“0 条回复”或“开始 Thread”
  -> hover Message，右上角浮出操作条
  -> 点击“在消息列中回复”，打开以该 Message 为 root 的空消息列
  -> 仅打开不产生主聊天流可见摘要，也不应唤醒 Agent
  -> 提交首条回复后，主聊天流才持久显示“n 条回复 ›”
  -> 摘要最多展示最近三条回复的作者、正文截断和时间
```

原版空消息列使用 `channelId:messageId` 定位 root，而不是要求页面先存在一个可见的零回复 Thread 卡片。RAH OS 后端仍可持有 canonical `Thread` 对象，但 UI 必须遵守上述渐进披露；普通 Message 的 `thread.create` 推迟到首条回复提交阶段，创建事件本身不派生 Agent attention，实际回复事件才按收件人唤醒 Agent。Task 因业务不变量会在创建时拥有唯一 canonical Thread，即使 `replyCount = 0`，Chat 中仍只显示 hover 入口。

## 3. 官方状态到 RAH OS 协议的映射

| Raft 可见状态 | RAH OS canonical state                                  | 页面含义                                             |
| ------------- | ------------------------------------------------------- | ---------------------------------------------------- |
| Todo          | `todo`                                                  | 尚未开始；可以未指派，也可以预先指派一个 Agent       |
| In progress   | `claimed` / `in_progress` / `waiting_input` / `blocked` | 已有 owner；等待输入和阻塞仍属于执行阶段，不伪装完成 |
| In review     | `submitted`                                             | Agent 已提交结果，等待 Human 审阅                    |
| Done          | `completed`                                             | Human 已明确验收                                     |
| Closed        | `cancelled`                                             | 工作终止但未作为成功完成；保留原因和时间             |

内部细分状态可以比官方 UI 更严格，但不得在页面上制造第二套互相矛盾的生命周期。

## 4. 纵向验收矩阵

| 官方行为                            | Protocol / DB 真相                                                                                            | Human API / Client                                         | Web 可见反馈                                                     | 自动门禁                                               | 当前状态   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------ | ---------- |
| Composer “作为任务”发送             | `Task.taskNumber/sourceMessageId/threadId` 必填；一个 `task.created` event 原子投影 Message + Thread + Task   | `task.create` 返回同一 Task 关系；重复 key 返回原对象      | Chat 保留顶层消息并显示 `Task #n`；看板显示同一编号              | Kernel 锚点/幂等测试；真实 Chrome 检查 Chat 和 Board   | 已接通     |
| Task 拥有讨论 Thread                | `tasks.source_message_id` 是 `threads.root_message_id`；一对一唯一约束                                        | `thread.list/message.list` 可由 Task anchor 定位           | Chat 回复入口和看板“打开讨论”进入同一 Thread                     | Kernel 关系测试；Chrome 打开 Task Thread               | 已接通     |
| 普通 Message 打开/首条回复          | 打开为空的本地视图；首条回复时才创建 Thread，`thread.created` 不派生 attention，`message.posted` 才唤醒收件人 | `thread.create` + `thread.reply` 保持 causal/idempotent    | 默认无零回复条；hover 浮出回复；回复后显示计数和最近三条摘要     | Web source contract + 真实 Chrome Thread gate          | 已接通     |
| Agent 报告 progress                 | `task.progressed` 同事务更新 Task 并投影 Thread reply                                                         | Worker progress command 保持 causal/idempotent             | Thread 显示 Agent progress；看板可显示最新摘要                   | Kernel workflow 测试                                   | 已接通     |
| Agent 提交结果并进入 Review         | `task.submitted` 更新 `submitted`，投影结果回复                                                               | Worker submit 返回 canonical Task/event                    | 看板进入待确认；Thread 显示结果                                  | Kernel + Chrome worker-task gate                       | 已接通     |
| Human Review / Done                 | process exit 与 Task completion 分离；creator causal complete                                                 | `task.complete` 只接受可验收状态                           | Human 可从看板确认完成，也可先打开讨论                           | Kernel + Chrome complete gate                          | 已接通     |
| 已有顶层 Message 转换成 Task        | 复用原 `message_id` 和已有 Thread；分配新编号；Thread reply 由 Kernel 返回 `conflict`                         | 严格 `task.convert` command；title 只能来自原 Message      | 顶层 Message 右键/长按出现 `Convert to Task`，原地显示编号       | Protocol/Kernel/API + 本地真实 Chrome 全流程门禁       | 已接通     |
| 从 Task 页面新建                    | 与 Composer 共享 `task.create`；同事务生成连续编号、顶层 Message、唯一 Thread 与 Task                         | title 必填；description/assignee 可选；causal + idempotent | 工具栏“新建任务”打开 Raft dialog；卡片可回到 Chat anchor/Thread  | 本地真实 Chrome 覆盖创建、Agent submit、Human complete | 已接通     |
| Agent 运行状态的页面归属            | `RoomAgentActivity` 提供当前状态；`run_trajectory_entries` 保存 Provider 原生结构化轨迹                       | `agent.trajectory.list` 独立分页并逐页校验 ACL             | Chat 不显示诊断；详情头显示当前状态，“动态”显示运行轨迹          | Kernel/driver/SEA + 本地真实 Chrome/390px 门禁         | 已接通     |
| owner reservation / claim / release | Human `assign/unassign` 只改变未领取 `todo` 的预留负责人；Worker `claim/release` 独立持有执行锁，二者不得合并 | `task.assign/task.unassign` 与 Worker claim/release 分权   | creator 可在未领取卡片中分配/清除负责人；运行中不允许 Human 强抢 | Kernel/API/SDK + Chrome 分配、清除、刷新恢复门禁       | 主要接通   |
| Closed 可逆流转                     | 需要符合官方恢复语义且保留审计事件                                                                            | typed reopen command + Runtime cancellation fence          | Closed 项可恢复到 Todo                                           | Kernel/Host/Client/Web/真实浏览器均已验证              | **已接入** |

普通聊天另有两条不得与 Task 混淆的规则。第一，Room membership 决定 Human Message 的默认 Agent 投递范围，Agent 回写必须成为普通 Room Message，不能把 CLI stdout、固定测试回执或常驻投递说明当成聊天正文。第二，`waking / working / idle / error` 是 Agent 的执行诊断，不是用户 Message 的回复附件；Chat 消息流不得在最后一条用户消息下追加“正在准备响应/正在处理”。紧凑当前状态属于 Agent 列表、Agent 详情头或 Agent 私聊/详情上下文的状态条，诊断记录属于 Agent 的“动态”页。

RAH OS 保留 `RoomAgentActivity` 作为紧凑当前状态，同时新增与业务审计分离的 durable runtime trajectory。Codex app-server 的 turn/item notification 与 Kimi ACP `session/update` 被归一为 Raft 的 thinking/tool/text/status/compaction 词汇，经专用 fd3、RunAttempt/RuntimeRun identity 和 producer/server sequence 持久化；Agent“动态”读取该轨迹而非拼装 Room event。真实 Chrome 门禁先向 Alice 私聊发送 Message、等待 canonical reply，再检查动态与安全诊断复制；Fake CLI 负责无付费确定性回归，Chat DOM 仍不得出现执行诊断。

## 5. 数据关系与前后端职责

```text
Room
  ├─ RoomEvent(task.created) ── roomSeq / idempotency / actor
  ├─ Message(sourceMessageId) ── 顶层聊天锚点
  ├─ Thread(threadId) ───────── rootMessageId = sourceMessageId
  │    └─ Message(reply) ─────── progress / result / Human review
  └─ Task(taskId, taskNumber) ─ sourceMessageId + threadId + state + owner
```

- Kernel 是编号、关系、状态、权限和原子性的唯一 owner；
- Application Service 暴露 typed command/query，不拼装 UI 专用假状态；
- Client SDK 严格验证 Task anchor；Client Core 负责 Room sequence 和 stale retry；
- Web 只根据 canonical Task/Message/Thread 关系渲染 Chat、Board 和 Thread；
- Raft snapshot 只提供视觉证据，不拥有业务状态。

## 6. Definition of Done

任何声称“复刻了某个 Raft 功能”的改动，至少同时满足：

1. 指向一个官方教程步骤或明确记录官方页面实操证据；
2. 写出该行为的 canonical owner 和失败语义；
3. 先有 Protocol/Kernel 失败测试，再实现迁移、API 和 Client；
4. 页面上的每个启用控件都有真实 handler 和可观察反馈；
5. 真实 Chrome gate 覆盖主用户旅程，390×844 不破坏操作；
6. 老数据库迁移后仍满足关系和 foreign-key check；
7. 文档矩阵更新当前状态，不用静态 fixture 宣称业务已完成。

Closed 恢复现已接入：Human 关闭活跃 Task 会立即 fence 旧 Worker，Host 只有在 Runtime terminal proof 和 cancelled RunAttempt 成立后才恢复 Activation lane；提前重开会被拒绝。下一条优先实现项是把 Human 强制改派组合成同一 cancel/fence/resolve/assign 协议；Artifact/Files 仍不得伪装完成。

## 7. 浏览器核对记录

- 官方文档截图确认桌面入口为消息右键菜单 `Convert to Task`；官方教程确认移动端为长按、转换后消息内容保持不变；
- 本地真实 Chrome 门禁已验证：转换入口只出现在 Chat 顶层未转换消息；Thread reply 无入口；转换后原 Message 原地获得 `Task #n`，既有 Thread history、Agent progress/result 与 Human completion 全部保持同一条业务链；
- Tasks 页门禁已验证：“新建任务”弹窗提交 title、可选 description/assignee 后生成连续编号卡片；切回 Chat 可见同一顶层 Message，卡片“打开讨论”进入同一 Thread，并完成 Agent submit → Human complete；
- Task owner 门禁已验证：creator 在未领取 `todo` 卡片打开负责人菜单，按 Raft 官方 Tasks 提取值渲染 220px popover、32px header、36px row；Escape 关闭、清除负责人、重新分配以及页面刷新后的 canonical 恢复均通过。Human 预分配与 Worker claim/release 保持两个协议，不把下拉菜单选择冒充为执行锁；
- Closed 门禁已验证：官方当前 bundle 的 `closed -> todo|in_progress` 状态图作为产品语义输入；RAH OS 实现更严格的 `cancel request -> Worker fence -> Runtime terminal proof -> RunAttempt cancelled -> lane merge -> task.reopen`。真实 Chrome 和应用内浏览器均完成关闭原因弹窗、已关闭列、重开为待办和零 console error；
- 2026-08-27 已通过本机已登录 Chrome 实操官方 `app.raft.build`：普通无回复消息默认没有常驻 Thread 条；hover 后出现“在消息列中回复 / 添加回应 / 收藏消息”浮动操作条；点击回复进入以原 Message 为 root 的“消息列”，空态为“暂无回复”；已有回复的 Message 才显示回复数、最近回复作者/正文/时间摘要。核对过程没有向官方账户发送测试消息或修改已有数据。
- 同次已登录账户只读实操还确认了 Agent 状态的页面职责：Room 频道的 Message 流不显示执行诊断；Agent 详情默认打开“资料”，详情头与左侧 Agent 区域可显示当前紧凑状态；“动态”页显示“活动诊断”时间线；Agent 私聊/详情上下文底部可显示 `Message received`、`Tool finished` 等状态条。RAH OS 已据此移除 Chat 内联状态并建立 Agent 列表 → 资料/动态详情结构。
- 同日已在 4176 本地真实 CLI 实例核对修正结果：七条无回复消息的 `.thread-preview` 均不存在，hover 目标消息后浮出可用回复按钮，打开后显示 `消息列 — #Agent Council`、root Message、`暂无回复` 与消息列 composer；自动 Chrome gate 负责首条回复后的 canonical 创建、回复计数和最近回复摘要回归。
