# Raft ↔ RAH OS 双边真实浏览器逐功能验收报告

日期：2026-08-29\
审计批次：`parity-20260829-live-c`\
结论：**核心聊天室、私聊、普通 Thread 与 Task 执行主链成立；Raft 全产品等价尚未收口。**

## 1. 验收方法与边界

本轮不是静态截图审查，也不是“代码写完即完成”。同一浏览器会话固定为 `1280×720 / DPR 1`，依次操作：

1. 已登录的 Raft 官方 Web `https://app.raft.build/s/hakasemac`；
2. RAH OS 双 Agent Fake CLI fixture `http://127.0.0.1:4174`，用于可重复的多 Agent、成员和刷新实验；
3. RAH OS 仅暴露本机 OpenCode 的真实 CLI fixture `http://127.0.0.1:4175`，用于证明真实 Provider、任务认领、频道和私聊不是 Fake CLI 假象。

每项判定同时区分：

- `pass`：浏览器实际得到同类业务结果，且本地使用 canonical daemon 状态；
- `partial`：主结果成立，但入口、状态、恢复、信息密度或生命周期仍不等价；
- `fail`：官方入口可用，而本地禁用、无 handler 或业务结果不同。

## 2. 本轮固定对象

### 2.1 Raft 官方

- Channel：`parity-core-20260829`
- Channel ID：`ca806598-6298-4b05-bf26-3ec882689449`
- Agent：`ParityAuditorA`
- Agent ID：`c0af3b25-898c-433a-858c-1c9887d7f04c`
- Runtime / Model：OpenCode / DeepSeek V4 Flash
- Agent DM ID：`eeeb5b7d-a7df-4f40-b273-bcbf8c4ee1bf`
- Task #1：`Parity task A: produce one verified next step`
- Task #2：`Parity task B: thread-scoping check`（由 Agent 在执行 Task #1 后创建）

### 2.2 RAH OS Fake CLI

- Channel：`parity-core-20260829`
- Channel ID：`room_176d3466-02d7-4db0-8560-98a3a8752132`
- Human↔Alice DM：`room_2a0cc84b-2afa-4d6b-a2af-5eb761576910`
- 新建 Agent：`ParityAuditorA`

### 2.3 RAH OS 真实 OpenCode

- Channel：`Agent Council`
- Channel ID：`room_dbfeea37-d5cf-472c-b741-2e11d3f5129e`
- Human↔OpenCode DM：`room_de12d3ac-7d79-4e27-98f4-abbcb46eb1b5`
- Task #1：`Parity task OpenCode: report one verified repository fact`

## 3. 双边逐功能结果

| 模块                                     | Raft 官方真实结果                                                                                      | RAH OS 真实结果                                                                                   | 判定                                      |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| 创建 Channel                             | 创建公开频道，填写名称/描述并一次加入 Alice、Kimi                                                      | 创建同名频道、写入名称/描述并一次加入 Alice、Kimi                                                 | pass                                      |
| 多 Agent 频道                            | Human 发一次消息，Alice、Kimi 各产生一次独立回复；新建 `ParityAuditorA` 后它主动加入并补充回复         | Fake fixture 中 Alice、Kimi 各一次 canonical 回复；真实 OpenCode 对频道消息回复 `OpenCode`        | pass                                      |
| 成员范围                                 | 设置抽屉显示 1 Human + 2 Agent；成员决定投递                                                           | 标题人数为 3，移出 Agent 后后续消息不再投递给它；Direct Room 成员不可增删                         | pass                                      |
| Human↔Agent 私聊                         | 从 Agent 顶部 `更多操作 → 私信` 进入；Alice 和 `ParityAuditorA` 均真实回复                             | 从 Agent 聊天标签进入；Fake Agent 和真实 OpenCode 均回复，composer 使用 `@Agent`                  | partial：结果相同，入口不同               |
| 普通消息 Thread                          | hover 后打开消息列，首次回复创建 Thread；URL 带 `thread`，刷新自动恢复右侧消息列                       | 同一 hover/首次回复/摘要；本轮修复后 URL 带 `roomId:rootMessageId`，刷新自动恢复                  | pass                                      |
| 创建 Task                                | 官方弹窗支持一次输入多条任务；创建 #1 后 Channel Agent 收到任务                                        | 本地弹窗额外提供描述与负责人；真实 OpenCode 收到未指派任务                                        | partial：结果成立，表单协议不同           |
| Task Agent 生命周期                      | `ParityAuditorA` 原子认领 #1，进入进行中，提交后待确认；Alice/Kimi 也在任务讨论回应                    | 真实 OpenCode 原子认领、开始、写入 progress、submit；浏览器显示待确认                             | pass                                      |
| Human 审核                               | Human 把 #1 从待确认改为完成，Task 讨论留下状态记录                                                    | Human 点击“确认完成”，看板从待确认移动到完成                                                      | pass                                      |
| Task 讨论                                | Task 根消息携带 `#1 @ParityAuditorA`，专属消息列显示任务回复                                           | Task 根消息显示 `Task #1`，专属 Thread 含 progress/submit 两条回复并可刷新恢复                    | pass                                      |
| Agent 创建                               | managed 表单选择 Computer、Runtime、Model；新 Agent 自动启动、读 inbox、onboarding、自我介绍并处理待办 | managed 表单能选 Runtime/Model；新 Agent 可立即私聊回复，但创建后没有等价 onboarding/inbox 自运行 | partial                                   |
| Agent 停止/恢复                          | 停止后显示“已停止——重启前不会接收消息”；启动经历启动中并恢复可唤醒状态                                 | 暂停后显示“已暂停”，恢复后可再次处理消息                                                          | partial：基本状态成立，restart/reset 缺失 |
| Agent 动态                               | 聚合显示 Message received、Thinking finished、命令、工具、输出、空闲等结构化轨迹                       | 真实 OpenCode 轨迹可见；本轮修复流式 text/thinking 被拆成数十行的问题                             | partial：仍缺部分官方事件命名/筛选        |
| 全局 Search                              | 搜索审计频道得到 6 条结果，覆盖频道、普通消息和消息列，并有发送者/范围/频道/时间/排序筛选              | rail 入口仍 disabled                                                                              | fail                                      |
| Human Activity / Inbox                   | 14 条进行中、2 条未读；聚合 Channel、DM、普通 Thread、Task #1/#2，支持全部/未读/提及与标记完成         | rail 入口仍 disabled；Agent trajectory 不能替代 Human Inbox                                       | fail                                      |
| Notifications                            | 独立通知中心入口与 overlay                                                                             | rail 入口仍 disabled                                                                              | fail                                      |
| Computer                                 | 自动选中 Mac-Studio，显示 OS、Computer 版本、Runtime、Agent、创建者、恢复/诊断/重启/升级/删除前置条件  | 显示 Host、Offer、RuntimeProfile、Executable 与 Agent 绑定；须手动选中，OS/版本/创建者/操作缺失   | partial                                   |
| Files / reaction / bookmark / attachment | Channel/DM 均有 Files 标签、回应、收藏、媒体和文件入口                                                 | Files 是明确 unavailable；回应、收藏、附件 handler 未接入                                         | fail                                      |

## 4. 关于 `#1/#2 @Agent` 与“单独消息列”的确定性协议

用户截图中的 `#2 @Alice` 不是普通回复随机触发的标签。本轮从真实 DOM 和 Task #1/#2 行为得到四条规则：

1. **普通根消息**没有 Task 编号；只有 Human/Agent 显式点击“在消息列中回复”或调用 Thread reply 后，才产生普通 Thread 和回复摘要。
2. **Task 必须绑定一个 source Message**。Task 创建后，该根消息显示 `#编号` 与负责人；任务的讨论、progress、submit 和状态通知进入绑定 Thread。
3. **看板新建、composer 的“作为任务”、Message 转 Task**是不同入口，但都必须收敛到同一 `taskId + sourceMessageId + threadId` 关系，不能由 UI 猜测。
4. 本轮 Raft 的 Task #1 触发 Agent 自主协作；`ParityAuditorA` 又创建 Task #2 并指派 Alice，Alice/Kimi 继续开普通 Thread 做范围实验。因此界面看起来像“不规律触发”，实际是 Agent 的业务命令在连续创建 Task 和 Thread，而不是 CSS 或 hover 随机行为。

这个机制也有产品风险：一个 Task 可以诱发 Agent 新建 Task、多个普通 Thread 和大量跨 Agent 回复，主频道迅速变得嘈杂。RAH OS 不应机械复制这种涌现结果，而应协议化为：

- `message.thread.open/reply` 只能显式创建普通 Thread；
- `task.create/convert` 原子创建或绑定唯一 source Message 与唯一 Task Thread；
- `task.progress/submit/review` 只能写入该 Task Thread；
- Agent 创建新 Task 必须是显式 Worker command，并接受 Workspace policy/role 控制；不得把普通自然语言回复误判成 Task；
- inbox/notification 只投影已有 canonical 事件，不得再次制造 Thread 或 Task。

RAH OS 当前的 canonical `Task.sourceMessageId`、`Thread.rootMessageId` 和 `Message.threadId` 已符合这个方向。本轮真实 OpenCode Task 显示为一个 Task 根消息、一个绑定 Thread、两条任务回复，没有复制 Raft Task #1→#2 的非必要级联。

## 5. 本轮发现并已修复

### 5.1 Thread 刷新丢失

原行为：本地打开 Thread 后 URL 只有 `?room=...`；刷新保留回复摘要，但关闭右侧消息列。Raft URL 持有 `thread=<room>:<rootMessage>` 并自动恢复。

修复：

- URL 写入 `room + thread`；
- popstate 和首次加载恢复 root message；
- 关闭 Thread 时移除 query；
- 真实浏览器已验证打开、刷新、回复内容与右侧 pane 均恢复；
- `scripts/run-real-browser-gate.mjs` 增加真实 reload 回归。

### 5.2 Agent 动态被流式 chunk 淹没

原行为：真实 OpenCode 的输出被拆成几十个“回复”条目，甚至单个条目只有一个字或符号。

修复：

- UI projection 只在同一 participant、Room、RunAttempt、runtime run、entry kind 和 subagent 内合并连续 text/thinking chunk；
- tool/status/RunAttempt 边界绝不跨越；
- 原始 trajectory 仍保留给安全诊断导出；
- 浏览器复验从数十个碎片收敛为一个完整回复条目。

## 6. 仍未收口的最高优先级

### P0：Human 工作闭环

1. 全局 Activity / Inbox；
2. 全局 Search；
3. Notifications；
4. 搜索/收件箱结果返回精确 Channel、DM、Thread、Task deep link。

这三项在 Raft 是日常导航主链，在 RAH OS 仍 disabled，因此不能宣称“正式产品等效”。

### P0：Agent 创建后的自治启动协议

Raft 新 Agent 本轮真实执行了：启动 → inbox check → onboarding → freshness check → 加入 Channel → Channel/Thread 回复 → MEMORY 写入。RAH OS 新 Agent 目前是“可被消息唤醒”，尚无等价的 onboarding/inbox application protocol。应明确区分：

- Definition 创建成功；
- enabled/paused 生命周期；
- 是否存在待处理 inbox Activation；
- Worker 启动、空闲、退出和下一次唤醒；
- 发送前 freshness/causal cursor 检查。

### P1：Agent 与 Computer 产品操作

- Agent 顶部菜单统一为私信/停止或启动/重启或重置；
- role permissions、env、external Agent；
- Computer OS/版本/创建者、自动选中、注册远程 Host、诊断/恢复/升级操作；
- 所有 enabled 控件必须有 typed application command、receipt、error 和刷新恢复。

### P1：消息附件与动作

补 reaction、bookmark、attachment 上传/下载、Files 页面及 Channel/DM 共用回归。

## 7. 收口判断

可以确认：

- RAH OS 的 Channel、Direct Room、真实 OpenCode CLI、普通 Thread、Task claim/progress/submit/Human complete 不是静态演示；
- 多 Agent 投递范围、Agent 身份、消息与 Task 持久化 owner 已形成可用核心；
- 本轮两个直接影响人类体验的缺陷已修复并在浏览器复验。

不能确认：

- 全部 Raft 页面和交互 100% 等效；
- Search、Human Inbox、Notifications、Files、完整 Agent/Computer 生命周期已完成；
- Agent 自治 onboarding 与 Raft 已等效。

因此最终评级是：**核心协作主链已闭环；正式本机产品仍有 P0 产品导航与 Agent 自治启动缺口，尚不能宣布完全收口。**

## 8. 官方审计对象保留说明

本轮在用户明确授权的官方 Workspace 中创建了上述 Channel、Agent、DM 和 Task，并发送审计消息。未执行删除，因为删除是不可逆/破坏性操作，需要独立确认。它们同时保留了本报告的可回查证据。
