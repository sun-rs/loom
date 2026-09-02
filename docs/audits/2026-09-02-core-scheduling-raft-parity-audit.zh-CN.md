# RAH OS 核心调度与 Raft 业务合同一致性审计

日期：2026-09-02

审计对象：`/Users/sun/Code/repos/rah_os` 当前工作树

Git 基线：`e5398be6223d96a78548d781303fcea2cf2586ff`

结论级别：P0 发布阻断审计；同日第一批修复复核见下节

## 同日第一批修复复核

本报告首次审计发现的四条 completion-proof P0 已按报告建议落地为 typed obligation，而不是继续扩充一段事件名 SQL：

- schema 30 新增 `activation_obligations`，冻结 Activation、participant、source event、Task 和 submission 身份；
- reviewer 的 `task.submitted` 写入 `task_review` 义务；`task.reopened`、`task.reassigned` 和 `review.submitted(changes_requested)` 为当前负责人写入 `task_owner_follow_up`；
- `completeActivation` 在 delivery 与 Runtime terminal proof 之后逐条验证业务义务，缺失时以 `TaskSubmissionProofError` fail closed；
- schema 29 的 active Activation 迁移回填已有回归；正式库只读检查为 `quick_check=ok`、26 个 Activation 全部 completed、0 个未结束 Task，因此没有需要猜测恢复的历史搁置工作。

TDD 证据：四条旧实现均先稳定失败，再在实现后通过；schema 29 active reviewer 迁移反例也通过。相关 Kernel／Application／AgentHost／Daemon 组合回归共 72 项通过。

报数主路径增加了真正的双子进程 gate：两个独立 Fake CLI 通过正式 Worker HTTP、Activation lease、sync/ack、activation-scoped message post 与 completion 流程并发运行，最终只产生 `1…10`，发言者逐条交替，所有 Activation 完成。隔离 Web fixture 又由真实浏览器按 Enter 发送同一问题；DOM 实际显示 Kimi/Alice 严格交替到 10，SQLite 同时证明十条数字消息按 Room seq 单调落账、11 个 Activation 全部 completed、无 held draft 遗留。该 gate 不消费 wake hint，因而同时证明 durable polling 路径；但尚未把“接力中途重启 daemon”“busy 跨 Room 合并”加入同一个报数用例。

发布复核补充：仓库全量 `npm run check` 通过（package tests 739 项，其中 737 通过、2 项真实 Provider 用例按约定跳过；Web 155 项；parity regression 34 项；typecheck 通过），`format:check`、`git diff --check`、生产 Web 构建均通过。隔离的真实 Chrome 工作台门禁验证了 390×844、Agent 回复、会话恢复、持久重启和浏览器无缝重连。正式状态在重启前后均为 `quick_check=ok`、schema 30、26 个 Activation 全部 completed、26 个 RunAttempt 全部 exited、26 个 RuntimeProcess 全部 terminated，且没有活动 Task 或未结 obligation；完整状态备份位于 `backups/formal-pre-restart-20260902-023100/state`。正式浏览器刷新后没有 `JSON.parse`、`NetworkError` 或重连错误，既有 OpenCode/Kimi `1…10` canonical 消息仍严格交替显示。

因此本报告在第一批结束时的裁决是：**四条 completion-proof P0 已修复并完成隔离浏览器验证，具体报数故障的主路径已关闭；当时 held draft 四结局、Thread subscription／首路由、poison retry、Reminder，以及报数中途重启／busy 变体仍是 P1 或待补 gate。** 后续第二、三批已继续关闭其中 Thread 与 held-draft 生命周期；下文保留首次审计时的证据和修复依据，不能把其中“尚未修复”段落误读为当前代码状态。

## 同日第二批修复复核：Thread route 与 Agent subscription

P1-A 与 P1-C 已按 Raft 可见合同合并关闭：

- `thread.created`、Thread `message.posted` 和 Task Thread 现在由同一个 `worker-message-routing` owner 选择回复目标；首个 Agent 回复不再掉回 Room 根部；
- schema 31 新增 durable `agent_thread_follows`，精确点名和成功参与自动 follow；普通 Thread 回复只唤醒当前 followers；
- 新增 activation-scoped `thread-unfollow` protocol、Worker HTTP 和本机 CLI。它要求可信 causal cursor 和稳定 idempotency key，重复调用返回同一 canonical `thread.unfollowed`；
- 显式 unfollow 后普通回复不再投递，后续精确 mention 会 refollow；初始化从历史 Agent Thread 消息与可证明的 mention 事件回填，且不会覆盖已有显式 unfollow；
- standing Worker contract 明示 Thread 自动路由、follow/unfollow 与 re-mention 规则，Provider 不再自行编造 target 或 recipient。

来源边界必须精确表述：`vendor/raft/index-WTraJnrd.js` 可见 Human `/channels/threads/follow`、`/channels/threads/unfollow`、`/channels/threads/followed` 和 Agent `/threads/unfollow` 合同，官方 Threads 文档给出 auto-follow / unfollow / re-mention 产品语义；Raft 中央 Server 的 subscription 表与 mutation 实现不在已授权本地材料中。因此本批优先复用了 Raft 的接口和行为，而 SQLite owner、事务回填、causal/idempotency fence 是本地等价实现，不能冒充 byte-copy。

TDD 先稳定复现 `thread.created` 首答 `threadId=null`，再验证首答入 Thread、普通 follower 投递、显式 unfollow、幂等重放、普通静默、精确 re-mention 恢复、Worker HTTP/CLI 映射及 schema 历史回填。定向 25 项与 typecheck 全部通过。全仓复核随后通过：package tests 共 741 项（739 通过、2 项真实 Provider 用例按约定跳过）、Web 155 项、parity regression 34 项；`format:check`、`git diff --check` 与 trusted-proxy production Web build 均通过。

正式发布前只读确认 schema 30、`quick_check=ok`、26 个 Activation 全部 completed、26 个 RunAttempt 全部 exited、26 个 RuntimeProcess 全部 terminated，且 Task 与未结 obligation 均为 0。在线一致性备份位于 `/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-restart-20260902-060117/state`，两份 SQLite 备份均为 `quick_check=ok`。优雅停止后正式库迁移至 schema 31，最终 PID 19910 监听 `127.0.0.1:4173`，正式入口脚本为 `/assets/index-Bw2nieIK.js`。

第一次冷页复核还发现发布命令只生成了普通验证目录，runner 因而冻结了旧的 `dist-workbench` 并落入 Human token 门；这不是业务数据或 Thread 迁移故障。交付前已显式执行 `npm run build:web:workbench`、再次重启并重新冷开。最终浏览器实际显示 Mac-Studio、1 个频道、4 个本机 Agent、既有 OpenCode/Kimi `1…10` 严格交替历史；进入 Kimi 私信及整页刷新均成功。页面中的 `RAH Client request failed`、`JSON.parse`、`NetworkError`、`Failed to fetch`、`Human access token` 计数均为 0，控制台 error/warn 为 0。没有发送正式消息或调用付费 Provider。

第二批结束时尚未关闭的核心 P1 是 held draft 四结局、poison retry、Reminder，以及报数中途 daemon restart／busy 跨 Room 组合 gate；held draft 已由下述第三批继续关闭。

## 同日第三批修复复核：Held Draft 四路径与持久闭环

本批先读取已授权的 Raft Computer 包和共享合同，再实现本地 daemon 映射，没有根据博客自行发明一套草稿机制：

- `raft-computer-1.0.18` 的 `chunk-ZHWD6VKE.js` 可见 `planAgentInboxSideEffect`、`heldPlan` 与 `prepareAgentApiSideEffectForward`：新消息到达时进入 held plan，并向 Agent 暴露 `check_messages`、`send_draft` 与受控 `send_anyway`；
- `raft-0.0.17/package/dist/index.js` 可见按 Agent/target 保存正文、附件、`savedAt`、`reholdCount`、`seenUpToSeq`，十分钟 TTL，以及 `--send-draft` / `--anyway` 的 CLI 约束；
- Raft shared `agentApiContract.ts` 可见 `sendDraft`、`continueAnyway`、`draftReholdCount`、`draftReplacedExisting`、`seenUpToSeq` 与响应 `continueAnywaySuggested`。

RAH OS schema 32 据此补齐 durable `held_message_drafts` 生命周期：保存原稿发送前重新执行 target-specific freshness；未变化时解析为 `sent_unchanged`，再次变化时由新草稿继承 lineage 并将旧草稿解析为 `reheld`；普通修改发送解析为 `revised`；保持沉默不制造假的 Room 事件，十分钟后由 Kernel 初始化／Activation 租约维护解析为 `expired`；只有已经重复 hold 且响应明确建议后，才能显式 `--anyway`，成功解析为 `sent_anyway`。同一 idempotency key 稳定重放同一 held 或 sent 结果，普通消息协议不存在通用 override。

来源边界同样必须保留：已授权材料不包含 Raft 中央 Server 判断 `continueAnywaySuggested` 的精确阈值。RAH OS 使用“第二次 hold 后建议”的保守阈值，并把 `source_held_draft_id`、resolution、resolved time 和到期维护放入本地 Kernel；这是围绕 Raft 可见合同的可审计本地增强，不声称逐字复制不可见服务端实现。

TDD 覆盖同一草稿的稳定 held 重放、follow-up 原稿重查并发送、再次 hold、首次强制发送拒绝、第二次 hold 后显式 anyway、正常改写、三种发送分支幂等重放、schema 旧表迁移与十分钟边界到期。全仓 `npm run check` 通过：package tests 743 项（741 通过、2 项真实 Provider 用例按约定跳过）、Web 155 项、parity regression 34 项、typecheck 通过；`format:check`、`git diff --check`、生产 Web build 与隔离 Chrome 浏览器门禁均通过。所有自动化使用临时状态与 fake Provider，没有调用真实付费 Provider，也没有使用 GPT-5.6 Ultra。

正式状态重启前完成在线一致性备份，路径为 `/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-restart-20260902-062750/state`，Room／Registry 备份均为 `quick_check=ok`。优雅重启后正式库为 schema 32、`quick_check=ok`、26 个 Activation 全部 completed，且没有遗留 held draft。真实浏览器冷开仍显示 Agent Council 既有 OpenCode/Kimi `1…10` 严格交替历史；切换 Kimi 私聊并整页刷新后深链和空态保持。`RAH Client request failed`、`JSON.parse`、`NetworkError`、`Failed to fetch`、`Human access token` 均为 0，浏览器日志为 0；未向正式 Room 发消息或调用 Provider。

第三批后，held-draft 四路径和 durable resolution 已关闭。第三批结束时，poison Activation 的有界 retry／blocked／Human escalation 仍未关闭；该项已由下述第四批继续处理。

## 同日第四批修复复核：Raft Runtime error fingerprint fence

本批继续以已授权 Raft Computer 源码为第一来源，而不是为失败次数另造经验值。`raft-computer-1.0.18/source-slices/packages/daemon/dist/chunk-ZHWD6VKE.js:30621-30623` 明确给出 Runtime 错误投递退避基准 10 秒、上限 5 分钟、相同错误指纹熔断阈值 3；`:31000-31047` 则证明普通相同指纹错误累计三次后清理 restart snapshot、把 Agent 置为 inactive 并结束该 Runtime，`stickyTerminalFailure` 与 `actionRequired` 不走普通指纹计数路径。

RAH OS schema 33 据此增加 durable `activation_retry_fences`，并保持本地 Room-first 分层：

- Runtime 失败仍必须先取得 termination proof、结束 RunAttempt、释放 Placement，并把 queued follow-up 的 Room 范围原子合并回原 Activation；
- 规范化后的同一错误指纹第一次、第二次写入 `activation.retry_scheduled`，第三次写入 `activation.retry_blocked`，Activation 进入 `quarantined`，该 Agent lane 不再被普通 lease 或自动 quarantine reconcile 重新启动；
- 默认生产退避从 1 秒收紧为 Raft 的 10 秒基准，沿用 5 分钟封顶；显式测试如果要立即验证恢复，必须在隔离配置中声明零退避，不能反向改变生产合同；
- `activation.retry_blocked` 进入 Agent 跨 Room 动态，并向 Room 的 Human 成员投递带 typed Room target 的系统通知；普通 `resolveActivationQuarantine` 不能绕过该 fence；
- 用户执行已有“重启／重置”控制时，disable→enable 的受控生命周期会解析该 fence、合并可能新增的 follow-up 范围、写入 `activation.retry_resumed` 并重新排队。自动失败循环不能自行解锁。

这里有两项刻意保留的来源边界。第一，RAH 的协议 Activation 枚举没有新增一个只服务 UI 的 `blocked` 值，而是用既有 fail-closed `quarantined` 加独立 typed fence 表表达；这避免让客户端猜数据库状态。第二，当前指纹来自规范化错误文本，退避是确定性指数；Raft 对 Provider 结构化 `actionRequired`／sticky terminal 分类和 jitter 的全部内部路径尚未完整移植。因此可以宣布“同指纹永久错误无限启动 Provider”这一 P1 主风险关闭，不能宣布所有 Runtime 错误分类与 Raft 逐分支同构。

TDD 先复现第三次相同 Runtime 错误仍会继续 queued，再验证两次 schedule、第三次 blocked、后续 lease 为空、Human push、普通 quarantine 解除被拒，以及显式 restart 合并 follow-up 后恢复。隔离 AgentHost、Kernel 和 workspace-management 定向回归全部通过。完整 `npm run check` 随后通过：package tests 共 744 项（742 通过、2 项真实 Provider 用例按约定跳过）、Web 155 项、parity regression 34 项，typecheck、`format:check` 与 `git diff --check` 均通过。两个故意制造一次可恢复失败的旧 daemon 测试显式固定自己的 1 秒／零退避，避免把 5 秒测试 deadline 反向变成生产合同；生产仍使用 Raft 10 秒基准。

正式重启前只读确认 schema 32、`quick_check=ok`、26 个 Activation 全部 completed、26 个 RunAttempt 全部 exited、26 个 RuntimeProcess 全部 terminated。在线一致性备份位于 `/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-restart-20260902-065424/state`，Room／Registry 两份 SQLite 备份均为 `quick_check=ok`。production workbench 重建后优雅重启，新 PID 37563 监听 `127.0.0.1:4173`；正式库迁移至 schema 33，仍为 `quick_check=ok`、26 个 Activation 全部 completed、0 个 retry fence。

真实浏览器冷开正式 Council 后，既有 OpenCode/Kimi `1…10` 仍严格交替显示；切换 Kimi 私信并整页刷新，typed Room 深链保持且空态正确。`RAH Client request failed`、`JSON.parse`、`NetworkError`、`Failed to fetch`、`Human access token` 均为 0，浏览器日志为 0。隔离 Chrome gate 另外在 390×844、临时状态与 fake Provider 下通过。没有向正式 Room 发消息、制造正式 poison failure 或调用真实付费 Provider。

第四批后仍不能宣称核心调度全量等同 Raft：明确剩余项是 Reminder authoritative schedule／fire receipt、报数中途 daemon restart 与 busy 跨 Room 组合门禁，以及上述结构化 Runtime 错误分类/jitter 的精细一致性。

## 同日第五批修复复核：Raft Reminder 权威调度与持久投递

本批先冻结已授权 Raft Computer / CLI / Web 合同，再在本地 Kernel 中建立等价 owner，没有把浏览器定时器或 Agent 页空态当成 Reminder：

- `raft-computer-1.0.18/source-slices/packages/daemon/dist/chunk-ZHWD6VKE.js:21770-21840,22520-22615,23120-23220,37090-37830` 给出 schedule/list/cancel/snooze/update/log、持久 receipt、1 秒基准／60 秒封顶／8 次／15 分钟 deadline 的投递重试及 owner scope；
- `raft-0.0.17/package/dist/index.js:54080-54465` 给出 `--delay-seconds`、`--fire-at`、`--repeat`、message anchor、list status、短 ID、snooze、update 与 recurrence grammar；
- 当前冻结 Web `AgentDetailPanel-DKwoNvgK.js` 的 `Vo`／`Go` 给出 `status=scheduled` 查询、loading/error/retry/empty、时间／重复／消息引用卡片、事件增量和重连重读合同。

RAH OS schema 34 据此增加 `reminders`、`reminder_events`、`reminder_command_receipts` 和 `reminder_fire_receipts`。`ReminderService` 是唯一调度真相：schedule 必须绑定 owner、可见 Room、因果 cursor 与唯一 message anchor；所有变更都有稳定 command receipt；到期先落 fire receipt，再写 canonical `reminder.fired` 和 owner-only Inbox/Activation；daemon `ReminderReconciler` 只驱动到期协调并报告 exhausted receipt，不能代替 Kernel 决定投递结果。重启后未确认 receipt 会继续按 Raft 上述退避重试；重复提醒按已确认 recurrence 重新排期。

Worker HTTP 与 `rah reminder` 已覆盖 schedule/list/cancel/snooze/update/log；Human API 只提供授权后的 Agent scheduled read model。Agent Reminder tab 改为官方形状的请求生命周期、空态、失败重试、时间／重复卡片与 typed 本地消息导航。Web 仍以 2 秒有界 polling 实现增量，而不是复制 Raft 中央 socket；这改变传输拓扑，不改变 authoritative read model。RAH 当前只有本地 `roomId/messageId`，没有官方 public permalink，因此普通点击走 typed internal navigation，不能宣称修饰键打开官方 permalink 已对齐。

隔离真实浏览器扩展验收时又发现并关闭一条因果缺陷：早期实现会为 schedule/cancel/snooze/update 自创不可见的 Room event，却不向 Worker 返回新 Room seq，导致同一 Activation 无法同时“回复 + 建提醒”。Raft 可见合同把 Reminder 编辑保存在独立权威对象，只有 fire 才在锚点留下系统事实；本地据此移除四类编辑对 Room ledger 的推进，保留 `reminder_events` 审计和 fired Room fact。Kernel 回归证明 schedule 前后 Room seq 不变且同一 delivered cursor 仍可回复。

本批还关闭了一个会制造假能力的边界：Raft CLI 可见 `--channel`，但当前本地表没有分离“锚点来源 Room”和“投递目标 Room”。该参数此前会被解析后静默丢弃；现在会在任何 HTTP 请求前显式拒绝。跨 Room Reminder 目标必须先补 canonical target、ACL 和 receipt 语义，不能用字符串绕过 Room owner。

TDD 覆盖 anchored schedule/idempotency、owner-only due delivery、receipt-before-wake、失败重试、recurrence、Worker HTTP/CLI 和 Web source contract。完整 `npm run check` 通过：package tests 751 项（749 通过、2 项真实 Provider 用例按约定跳过）、Web 156 项、parity regression 34 项；typecheck 通过。新增隔离 production workbench Chrome gate 让 Fake Agent 通过正式 Worker HTTP 在回复后创建未来 Reminder，跨 daemon 重启保留；浏览器实际打开 Agent→提醒看到非空卡片，点击消息引用回到原消息，随后在 390×844 通过且控制台无错误。Firefox production gate 也在 1440×1000 和 390×844 通过。

正式发布前只读确认 schema 33、`quick_check=ok`、26 个 Activation 全部 completed、26 个 RunAttempt 全部 exited、26 个 RuntimeProcess 全部 terminated，且没有活动 Task。在线一致性备份位于 `/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-restart-20260902-080125/state`，Room／Registry 两份 SQLite 备份均为 `quick_check=ok`。PID 37563 优雅停止后，新 PID 51179 以同一 `node scripts/run-local-workbench.mjs` 入口监听 `127.0.0.1:4173`；正式库迁移至 schema 34，历史执行计数保持不变，Reminder 与 fire receipt 均无遗留待处理项。

正式真实浏览器冷开后，Agent Council 既有 OpenCode/Kimi `1…10` 十条消息仍严格交替显示；页面正文与控制台中的 `JSON.parse`、`NetworkError`、`Failed to fetch`、`Human token` 和 error 日志均为 0。点击 Kimi 头像打开真实 Agent 动态，Reminder tab 通过 Human scheduled API 返回“暂无提醒”；切换 Kimi 私聊后右侧 Agent 面板立即关闭，typed Room URL 与私聊空态正确。该核验没有向正式 Room 发消息、创建正式 Reminder 或调用付费 Provider。

第五批关闭了“Reminder 完全缺失”这一 P1，但仍不宣称核心调度全量等同 Raft。明确剩余是：跨 Room `--channel` 目标、官方 permalink／修饰键分支、锚定 Thread 的系统消息呈现、报数中途 daemon restart 与 busy 跨 Room 组合 gate，以及结构化 Runtime `actionRequired`／sticky／jitter 的逐分支一致性。

## 同日第六批修复复核：单 Agent busy、跨 Room 排队与重启接力

本批没有把“busy 时多条消息都塞进一个跨 Room Activation”当作 Raft 对齐。先复核已授权 Raft Computer 源码，再冻结本机等价合同：

- `raft-computer-1.0.18/source-slices/packages/daemon/dist/chunk-ZHWD6VKE.js:30700-30708,30749-30757,30765-30790` 显示 `RuntimeBusyDeliveryCoordinator`、`AgentStartCoordinator` 和 no-process residency invariant 共同保证一个 Agent 只有一条 queued／starting／running 驻留链；
- 同文件 `:12020,3074-3094,33148-33462` 显示 busy 消息先经 `queueAgentInboxMessage` 去重并留在 Agent inbox，只向当前 turn 写入按 target 汇总、无正文的通知；Agent 在自然断点自行 `check_messages`，而不是 daemon 把消息正文注入正在运行的模型步骤；
- 同文件 `:30652,30915-30938,32199-32320,32658,32934` 显示 Runtime 重启期间 `startingInboxes` 保存 pending delivery，并与 restart snapshot 一起在重新 spawn 后排空。Raft 中央 Server 的持久消息表不在本地授权包中，因此这里只主张 daemon 可见的驻留、缓冲和投递合同，不假装复制不可见实现。

RAH OS 的本地映射刻意保留 Room-first 所有权：`AgentParticipant` 全局最多一条 leased／quarantined Activation；同一 Room 的 busy 事件合并进一个 queued follow-up；不同 Room 各保留一个带自身 seq range 的 queued Activation。跨 Room 不能错误合并，因为一个 Activation 的 causal cursor、ack 与 completion proof 都是 Room-scoped。SQLite 是这里的 restart buffer，AgentHost 只串行 lease；它不是 Raft 中央内存 inbox 的逐字移植，但满足相同可观察不变量。

新增两个真实 Worker 子进程组合 gate：

1. 双 Agent 通过正式 Worker HTTP 严格交替报数；第四个数字落账后关闭 Worker service／Kernel、重开同一数据库并重新认证 Host，之后继续到 `10`，无重复、跳号或同一 Agent 连续发言。
2. 一个 Agent 在主 Room 的真实子进程被 pre-sync barrier 挂住时，主 Room 连入两条、第二 Room 连入两条消息；系统始终只有一条 leased lane 和一个 Runtime，同 Room 合并、跨 Room 保留两条 queued follow-up。daemon 在 busy 中途超过 drain deadline 后先取消 Runtime、记录 terminal proof 并把工作保持为 durable queued；数据库重开后两条 Room range 串行完成，只有被中断的 Activation `attemptCount=2`，无 active／orphaned RunAttempt、无未终止 Runtime，两个 Room 的 Worker cursor 均达到各自 completed Activation 的 `toSeq`。

这个红绿过程只暴露了测试边界：原报数测试直接调用 `AgentHost.reconcileOnce()`，模拟优雅重启前没有把旧 Host 标为 offline，重认证因正确的 split-brain fence 被拒绝。测试现按真实 daemon 边界显式下线旧 Host；生产 Kernel／AgentHost 不需要修改。由此可宣布 **restart/busy 组合门禁已关闭**，但不能扩大为结构化 Runtime 错误分类、跨 Room Reminder 和 Thread permalink 等剩余合同也已关闭。

完整复核通过：定向三个 Worker 集成用例全部通过；`npm run check` 的 package tests 共 752 项（750 通过、2 项真实 Provider 用例按约定跳过）、Web 156 项、parity regression 34 项，typecheck 通过；`format:check`、`git diff --check` 和 production Workbench build 通过。隔离真实 Chrome gate 再次覆盖 390×844、Agent reply、持久重启、Provider session resume 与浏览器无缝重连。所有新增自动化都使用临时数据库、fake Provider 和真实本地子进程，没有调用付费 Provider 或 GPT-5.6 Ultra。

正式发布前发现 4173 已无监听，且没有可优雅停止的旧 HTTP owner；只读检查仍为 schema 34、`quick_check=ok`、26 个 Activation 全部 completed、26 个 RunAttempt 全部 exited、26 个 RuntimeProcess 全部 terminated，活动 Activation／Run／Runtime／Task 都为 0。在线一致性备份位于 `/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-restart-20260902-093549/state`，Room／Registry 两份 SQLite 备份均为 `quick_check=ok`。随后以冻结 production assets 启动正式 `node scripts/run-local-workbench.mjs`；最终 PID 63480 监听 `127.0.0.1:4173`，`/_rah/health` 返回 online，持久计数不变。

正式真实浏览器冷开并整页刷新后，Agent Council 的 OpenCode／Kimi `1…10` 仍逐条严格交替；`JSON.parse`、`NetworkError`、`Failed to fetch`、`Human access token`、`RAH Client request failed` 正文计数均为 0，console error／warn 为 0。截图又核对了当前 Workspace 标识、Room／DM 列表、消息头像／presence、连续数字和 Composer 边界；本轮没有发送正式消息、触发真实 Agent 或改动正式业务状态。

## 同日第七批修复复核：structured Runtime、跨 Room Reminder 与 Thread permalink

本批继续直接采用已授权 Raft Computer 的可见分支语义，而不是把所有错误和链接合成一个布尔值：

- `chunk-ZHWD6VKE.js` 的 Runtime error delivery policy 显示 `actionRequired` 与 sticky terminal 绕过普通 fingerprint fence；recoverable 错误采用 attempt 指数退避、5 分钟上限和最多 10% 的正向 jitter。RAH OS 因此新增 provider-neutral `RuntimeFailure/retryDisposition`，由 native `runtime_error` trajectory 进入 `RunExit`，再经 AgentHost 送入 Kernel。认证／登录错误一次进入 action-required quarantine；input-too-large、model configuration 和 zero-evidence terminal 一次进入 sticky quarantine；普通错误才累计三次同指纹。无结构化轨迹的非零退出仍保守视为 recoverable，不解析 stdout/stderr。
- Raft `rah reminder schedule --channel` 的 `channel` 是 fire receipt 目标，不会改写来源消息锚点。schema 36 因此保留 `roomId/messageId`，另存 `targetRoomId` 与可选 `threadId/rootMessageId`；`#slug` 只在当前 active Workspace 内解析，并在 schedule/fire 双重检查 owner membership。触发事件进入 target Room 且只派生 owner Inbox/Activation；同 Room Thread receipt 只显示在线程内，跨 Room receipt 留在目标 Room并链接回来源消息/Thread。
- Reminder 卡片和 fire receipt 改为真正的 `<a href>` typed internal permalink。普通左键由 Client 的 ACL-safe `navigation.resolve` 接管；Cmd/Ctrl/Shift/Alt/中键不拦截，因而可复制、刷新或在新标签打开。该链接是本地受权导航，不是公开分享 URL；Raft 尚未由本批证明的 DM target 语法也没有自行发明。

TDD 先稳定复现三条失败：`--channel` 被拒、跨 Room request 被 strict schema 拒绝、Thread anchor 丢失；Web 侧又先复现无 receipt projection、Reminder 卡片仍是 button、modifier 分支不存在。实现后，Kernel/CLI/迁移、Adapter→AgentHost→Kernel structured failure、Room/Thread receipt 与 typed navigation 定向回归均通过。Thread receipt 后续又增加 Room-sequence 穿插回归，防止系统回执被固定挪到所有回复之前。

完整自动化复核通过：`npm run check` 的 package tests 共 760 项（758 通过、2 项真实 Provider 用例按约定跳过）、Web 159 项、parity regression 34 项；`format:check`、`git diff --check`、typecheck 与 production Workbench build 通过。隔离 Chrome 工作台覆盖 Fake Agent 回复、持久重启、Provider session resume、浏览器无缝重连与 390×844；Firefox 工作台覆盖 1440×1000、390×844 和持久状态。Firefox 门禁额外发现快捷回应项受旧通用选项样式影响而水平偏移 2px，现已恢复 28×28、18px sprite 居中、4px 圆角，并把收藏／回应摘要稳定放在同一 flex 行。

正式发布前只读确认 schema 36、`quick_check=ok`、26 个 Activation 全部 completed、26 个 RunAttempt 全部 exited、26 个 RuntimeProcess 全部 terminated，且没有活动 Task 或待触发 Reminder。在线一致性快照位于 `/Users/sun/Library/Application Support/RAH OS/backups/pre-scheduling-20260902-G1hZiV`，Room／Registry 两份 SQLite 均为 `quick_check=ok`。精确 PID `74278` 收到 `TERM` 后正常退出；第一次普通后台子进程虽然短暂返回 health online，却随启动 shell 一起被回收，真实浏览器立即暴露 `Failed to fetch`。该短暂状态没有被算作验收。最终正式进程由持久 exec owner 启动，PID `84830` 监听 `127.0.0.1:4173`，`/_rah/health` 持续返回 online，历史计数和 schema 均保持不变。

新的 in-app Browser 标签页在正式进程上线后整页刷新，typed URL 自动恢复到 Agent Council。DOM 与截图共同显示 Mac-Studio、1 个频道、4 个本机 Agent，以及 OpenCode／Kimi 严格交替的 `1…10`；页面中的 `Failed to fetch`、`JSON.parse`、`NetworkError`、`重新连接` 均为 0，console error／warn 为 0，页面无横向溢出。本次正式核验没有发送消息、创建 Reminder、启动真实 Provider 或修改业务状态；因此它证明正式部署与既有 canonical 历史可读，不把 Fake gate 冒充所有真实 Provider 的 structured error 覆盖。

## 结论先行

首次审计时，RAH OS 已经具备正确的 Room-first 主骨架：durable Room ledger、Inbox、Activation、content-free wake、显式 `room_sync` / ack、per-Agent 单执行 lane、Task 单一负责人、Outbox 恢复，以及工作树中新加入的 target-specific freshness / held draft。它不是一套依赖 Provider transcript 或页面状态驱动业务的临时实现。

但首次审计时不能宣称核心调度与 Raft 产品合同一致，也不能宣称“报数问题已经完成修复”。本轮发现一个确定的 P0 根因：`completeActivation` 只证明“消息已读、Runtime 已终止”和少数 Task 入口事件，没有证明当前 Activation 携带的全部业务义务已完成。它漏掉 reviewer 审查、Task 复开、Task 改派和驳回返工。四条隔离反例都能让 Agent 只执行 `sync/ack` 后退出 0，随后 Activation 被错误标记 `completed`，Task 却停留在 `todo` 或 `submitted`，且没有后续 queued Activation，工作永久搁置。

因此裁决是：

1. **P0：Activation completion proof 不完整，必须先修。** 这是 RAH 自身不变量和 Raft 式“唤醒后查询并完成明确业务动作”的共同违约。
2. **P0 gate：当前 held-draft 改造只在未提交工作树和局部 fake 测试中成立。** 尚无完整的双 Agent `1 -> 20`、重启、丢 wake 和真实浏览器闭环证据，不能以“已有 held 表”替代端到端证明。
3. **P1（首次审计状态）：Thread 首事件路由、Agent thread follow、Reminder、poison Activation 处置和 held draft 四种结局仍未对齐。** 同日第二至第五批已经依次关闭这些主合同；其精细剩余以上述各批复核为准。
4. **应保留 RAH 的本地增强。** 强制稳定幂等键、durable Outbox、local daemon 单一真相和显式 Runtime termination fence 都比可见 Raft CLI 合同更强，不应为了表面同构而撤回。

## 审计范围与证据等级

本轮只审计会影响“谁被唤醒、看到了什么、是否可以结束、是否产生下一步”的业务链：

```text
Room event
  -> recipient / subscription policy
  -> Inbox item
  -> Activation / per-Agent lane
  -> content-free wake
  -> sync / delivery cursor / ack
  -> explicit Room or Task action
  -> completion proof / retry / recovery
```

纳入：Room、DM、Thread、mention、Task claim / review / reopen / reassign、held draft、Reminder、busy follow-up、幂等与重启恢复。

不纳入：Raft 中央账号、套餐、计费、跨服务器 relay 和中央 Server 部署拓扑。

证据顺序：

1. 已授权的冻结 Raft Computer 1.0.18 源码，SHA-256 `20f16d...fd0e`；
2. Raft docs mirror，commit `126af666...`；
3. [Raft 官方 AX / held-draft 博客](https://raft.build/resources/blog/is-having-agents-in-the-room-meant-to-be-chaotic/)；
4. [Lifecycle](https://docs.raft.build/features/agents/lifecycle/)、[External Agents](https://docs.raft.build/features/agents/external/)、[Messages](https://docs.raft.build/features/messaging/messages/)、[Channels](https://docs.raft.build/features/messaging/channels/)、[Threads](https://docs.raft.build/features/messaging/threads/)、[Activity](https://docs.raft.build/features/messaging/activity/)、[Reminders](https://docs.raft.build/features/agents/reminders/)；
5. RAH OS 当前源码、SQLite 隔离反例、fake Runtime 和定向测试。

本轮无法取得新的 Raft 登录态实页运行证据；因此不把博客或前端 bundle 推断成未知 Server 内部实现。冻结源码能证明的是 Computer daemon、本地 Agent API proxy、CLI 和共享 wire/schema；Raft Server 的 recipient selection、subscription 持久化、数据库 claim 锁、重投和服务端幂等仍不可见。

## Raft 可确认的业务合同

| 合同                   | 可确认行为                                                                                                                                | 对 RAH 的约束                                                                                   |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Room activation        | 已加入频道的 Agent 收到新消息后可被激活；未加入者通常不收普通消息，mention 是额外触达路径；Stopped Agent 不响应                           | 投递依据 canonical membership / state，不可由 UI 当前页或 Provider session 决定                 |
| Inbox / wake           | 正文保留在可查询 Inbox；wake hint 不携带正文；Agent 醒来后主动 pull。未 pull 的内容不进入上下文且仍可恢复                                 | WebSocket / wake 只是提示，真实正文、cursor 和 ack 必须 durable                                 |
| 单 Agent lane          | 每个 Agent 有一个启动/执行通道；不是所有 Agent 全局串行                                                                                   | busy 时应合并或排队 follow-up，不能丢事件，也不能并发启动同一 Agent                             |
| Freshness / held draft | Room 可在推理期间前进。旧草稿先 held，再由 Agent选择 revise、send-as-is（仍重查）、stay silent；反复 held 后才可显式 send anyway          | 并发回复不能都直接进入 Room；silent 是正式结果，held 需要可结束的生命周期                       |
| Thread                 | 参与 Thread 或被 mention 会 auto-follow；后续回复形成通知；可 unfollow，后续 mention 可再次触达                                           | 需要 durable Agent subscription，而不只是从当前消息 recipient 临时推断                          |
| Task                   | Human 把消息转成 Task 不等于 claim；claim 冲突必须只有一个赢家                                                                            | 保持 Human 标记与 Agent claim 分离；原子 auto-claim 可以作为 RAH 防重适配，但必须显式记录       |
| Reminder               | Server-authoritative schedule；到时只唤醒创建 Reminder 的 Agent，并在锚定消息/Thread留下系统事实；Computer 保存 fire receipt 并有有界重试 | Reminder 不是前端 tab 或普通 timeout；必须有 canonical schedule、receipt 和 owner-only delivery |

关键冻结源码入口：

- held/freshness：`chunk-ZHWD6VKE.js` 的 `planAgentInboxSideEffect`、`planFirstTouchRecentContext`、`heldPlan`、`prepareAgentApiSideEffectForward`；CLI 的 `handleMessageSend`、`formatHeldSendOutput`、`markSendFailureDraftSaved`；
- Inbox/wake：`projectAgentInboxSnapshot`、`localAgentApiInboxResponse`、`localAgentApiEventsResponse`、`localAgentApiInboxAckResponse`、`drainInbox`；
- one-Agent lane：`AgentStartCoordinator`、`AgentStartPendingDeliveryBuffer`、`pumpAgentStartQueue`、`deliverMessage`；
- Reminder：`REMINDER_AGENT_INBOX_REGISTRY`、`ReminderCache`、`buildScheduleBody`、`runReminderAck`；
- Task：shared `agentApiContract` 的 claim / conflict / convert schema；可见 CLI 中 convert 不自动 claim。

## RAH OS 当前映射

| 层                  | 当前实现                                                                                                      | 裁决                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Room truth          | `room_events` 每 Room 单调 seq，mutation、projection、Outbox 同事务                                           | 对齐且应保留                                                     |
| Inbox / Activation  | `RoomEventWriter.deriveAttention` 原子写 Inbox、创建或扩展 queued Activation、写 content-free wake outbox     | 对齐主语义                                                       |
| Delivery proof      | `room_sync` + `subscription_cursors` + explicit ack；wake/process/input/exit 均不算已读                       | 强于仅靠进程成功的实现                                           |
| Per-Agent lane      | 一个 AgentParticipant 至多一个 active execution；busy 事件进入 durable follow-up                              | 对齐主语义                                                       |
| Human Room message  | membership delivery，mention 增加 attention 而不把 Room 退化为 mention-only                                   | 对齐                                                             |
| Agent Room reply    | 当前工作树会为其他 enabled Agent 派生 attention，并执行根消息/同 Thread target-specific freshness             | 方向对齐，但未提交且验证不足                                     |
| held draft          | `held_message_drafts` 保存 loser 草稿，同 idempotency key 稳定重放；成功新回复会把同目标旧草稿标为 `replaced` | 只有 held/replaced；缺 silent/revise/recheck/anyway 的完整状态机 |
| Task owner          | single owner、lease、claim conflict、reviewer/collaborator 分工                                               | 模型正确；completion proof 有 P0 缺口                            |
| DM                  | canonical 两人 direct Room、membership 不可随意变更，Human-Agent pair 复用                                    | 基础对齐；通知/mute 的精确边界仍需 E2                            |
| Agent Thread follow | schema 31 durable subscription；mention/参与 auto-follow；显式 unfollow；re-mention 恢复；统一首答 route      | 已按可见 Raft 合同对齐；中央 Server 内部实现不可见               |
| Reminder            | 只有导航/不可用空态，没有 Kernel / Protocol schedule owner                                                    | 缺失                                                             |

## P0：Activation completion proof 会吞掉未完成业务

问题位于 `packages/kernel/src/room-kernel.ts:4537-4587`。当前 SQL 只把下列事件关联为 assignee 的未完成 Task：

- `task.created`
- `task.assigned`
- `task.unblocked`
- `task.released`
- Task source `message.posted`
- `input.resolved`
- dependency-ready `task.completed`

它没有覆盖 `task.reopened`、`task.reassigned`、`review.submitted(changes_requested)`，也没有为 reviewer 的 `task.submitted` 建立“必须产生当前 submission 的 canonical Review”这一义务。更根本的问题是，它把 completion proof 写成一段事后猜测事件类型的 SQL，而不是验证 Activation 创建时已经冻结的业务义务。

独立临时 SQLite + fake Runtime 反例：

| 反例          | Agent 实际只做                                                        | 错误结果                                                               |
| ------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Reviewer 沉默 | 收到唯一 `task.submitted`，sync / ack / exit 0                        | Activation=`completed`；Task=`submitted`；Review count=`0`；queued=`0` |
| Task 复开     | 收到 `task.reopened`，sync / ack / exit 0                             | Activation=`completed`；Task=`todo`；queued=`0`                        |
| 安全改派      | 新 owner 收到 `task.reassigned`，sync / ack / exit 0                  | Activation=`completed`；Task=`todo`；新旧 lane 排空后 queued=`0`       |
| Reviewer 驳回 | owner 收到 `review.submitted(changes_requested)`，sync / ack / exit 0 | Activation=`completed`；Task=`todo`；queued=`0`                        |

这些反例证明：standing prompt 即使写得完全正确也不能充当服务端 proof。模型可以忽略提示、工具调用失败或 Provider 提前退出；Kernel 仍必须 fail closed。

### 必须采用的修复方向

不要只在 `IN (...)` 中补三四个事件名。应由 Task/Review domain 在派生 attention 时同步生成不可变 `activation_obligation`（或等价的 typed obligation projection），至少区分：

- `delivery_only`：普通协作消息；允许 ack-only 静默；
- `task_owner_action`：claim/start 后必须进入 waiting_input / blocked / submitted / cancelled 等合法结果；
- `task_rework_action`：reopen/reassign/changes_requested 后必须产生当前负责人的新工作结果；
- `task_review_action`：指定 reviewer 必须对当前 submission 产生唯一 canonical Review；
- `task_collaboration_action`：只允许写明确范围内的证据，不能冒充 owner mutation。

`completeActivation` 应先验证 delivery 与 Runtime terminal proof，再逐条询问 obligation owner 是否已有可证明结果；缺失时拒绝 completion 并进入受控 retry / blocked / escalation，而不是用 Agent exit 0 推断完成。Task obligation 的生命周期必须绑定 task id、submission id / digest、participant role 和 causal event，防止旧 Review 或旧 submission 被误用。

## 其他确定差距

### P1-A：`thread.created` 的首次 Agent 回复被写到根消息

**2026-09-02 状态：已修复。** 统一 route owner 直接读取 canonical `threadId`；首答、HTTP 与持久投递反例均通过。以下保留原始发现作为回归依据。

`collaboration-service.ts:1231-1246` 的 `thread.created` payload 只有 `recipientIds`；`worker-message-routing.ts:15-28` 却只读取 `payload.recipients` 来解析 reply Thread。隔离复现中 Activation 唯一事件是 `thread.created`，预期 Thread ID 非空，实际 Agent Message 的 `threadId=null`，recipient count=`0`。

修复应统一 thread route owner，不允许 create 与 subsequent reply 使用两套 payload 推断。随后补 durable Agent auto-follow / unfollow / re-mention，而不是继续从单条 causal event 猜订阅。

### P1-B：held draft 只有“被 hold”和“后来被替换”

**2026-09-02 状态：已修复。** schema 32 已实现 revised、sent unchanged、reheld、sent anyway、expired 五种 durable resolution；保存原稿发送会重查 freshness，普通请求不能绕过，十分钟 TTL 与 lineage／幂等回归均已通过。以下保留原始发现作为回归依据。

当前 schema 只有 `held | replaced`。缺少：

- revise 后关联旧 draft；
- send-as-is 的再次 freshness check 与 rehold 次数；
- stay-silent / expired 的 durable resolution；
- repeated holds 后显式 send-anyway 的权限与审计；
- retention / GC owner。

并发 loser 在 follow-up 中选择 ack-only 后，所有 Activation 可以完成，但旧草稿仍永久保持 `held`。应按 Raft 已有 `heldPlan` / send CLI 合同移植状态与命令语义；`send anyway` 必须是反复 held 后的显式动作，不能变成普通绕过开关。

### P1-C：Agent Thread subscription 不完整

**2026-09-02 状态：已修复。** schema 31、auto-follow、explicit unfollow、re-mention、历史回填和 Worker CLI/API 已形成闭环。以下保留原始发现作为回归依据。

RAH 目前有 Human `human_thread_follows`，没有等价的 Agent subscription owner。Raft 的“参与或被 mention 后 auto-follow、可 unfollow、再次 mention 可触达”无法仅靠当前 Message recipient 快照完整表达。

### P1-D：Reminder 缺失

**2026-09-02 状态：主合同与本轮精细项已修复。** schema 34 已建立 canonical Reminder、command/fire receipt、owner-only wake、持久重试、recurrence、Worker HTTP/CLI 与 Agent scheduled read model；schema 36 又关闭同 Workspace `#room` target、Thread/root anchor、Room/Thread receipt 和 typed internal permalink。DM target、公开分享 URL和非空官方双边不在该结论中。以下“当前只有空态”是首次审计发现，不代表当前工作树。

首次审计时只有 Agent 页 navigation enum / 空态，没有 canonical Reminder、schedule、fire receipt、author-only wake 和 retry。修复必须优先移植 Raft `ReminderCache` / receipt / CLI wire 语义，再映射到本地 daemon，不复制中央 Server 拓扑。

### P1-E：poison Activation 可无限重试

**2026-09-02 状态：主风险与本轮结构化分支已修复。** schema 33 已按 Raft 可见的 10 秒基准、5 分钟上限、三次相同 recoverable 错误指纹阈值建立 durable fence；schema 35 又让 `actionRequired`／sticky terminal 绕过计数并立即隔离，普通 retry 使用最多 10% 正向 crypto jitter。只有能发出 native structured runtime-error 的 Provider 路径可获得精确分类；无结构化证据的非零退出仍保守 recoverable。以下保留原始发现作为回归依据。

`agent-host.ts:910-923` 对失败统一 retry，`1115-1123` 只把退避封顶到五分钟，没有 attempt ceiling 或 `blocked/escalated` terminal。永久错误的 runtime 配置或凭据会无限启动 Provider。架构文档写了 retry / block / escalate 由 policy 决定，但实现只有 retry。

### P1-F：Agent-to-Agent 链没有 Kernel 级 availability guard

当前 standing prompt 要求“最新 Room 状态、最多一步、目标完成后静默”；但 Kernel 根回复会继续唤醒所有其他 enabled Agent。隔离测试可让 A/B 合法交替写入六条消息并继续得到第七个 queued Activation。对报数等显式 turn-taking 不能粗暴设置很低的次数上限，但仍需可观察的链 id、预算/熔断和 Human escalation，防止 Provider 不遵守 prompt 时无限消耗。

这不是用“禁止 Agent 消息唤醒 Agent”解决；Raft 的关键恰恰是 peer message 进入 Room 后让下一位基于最新状态继续。安全阀只能防失控，不能破坏正常轮流协作。

### P2：需要验证但尚不能判错的边界

- DM 的 always-notify 与 workspace / room mute 精确优先级；
- idle、disabled、stopped、Computer offline 的 delivery / wake 差异；
- busy 期间跨 Room 事件的主不变量与本地映射已经冻结并通过重启组合 gate；Raft 中央 Server 是否在服务端进一步跨 target 批处理仍不可见，不能把 RAH 的 per-Room queued Activation 冒充其内部表结构；
- Raft Server 侧 freshness 二次校验、message send idempotency 和 recipient DB 实现。可见 Raft CLI schema 虽允许 `idempotencyKey`，当前 body builder 没有实际设置，send 不确定结果反而提示不可确认/不要盲重试；RAH 的强制稳定幂等键应保留。

## 报数问题的准确裁决

旧行为的问题不是“两个 Agent 不够聪明”，而是两个独立 Activation 基于同一个旧 Room head 同时完成，Agent Message 又没有形成可靠 peer follow-up，导致双方都提交 `1` 后链条结束。

当前工作树的新逻辑已经修正两块底座：

1. 先提交者的 canonical Message 会为另一 Agent 创建 follow-up Activation；
2. 后提交者基于旧 head 的草稿会被 held，不进入 Room。

这能阻止第一轮双写，但还不能证明完整报数成立。正式 gate 必须覆盖：

- 两个 Agent 从相同 Human Activation 并发启动；
- Room 最终严格为 `1,2,...,20`，无重复、无跳号；
- 每次最多一条 next step，达到目标后双方静默；
- loser held 后进程退出，follow-up 由 durable state 继续；
- hold 后重启 daemon / AgentHost 仍可恢复；
- 丢弃 100% wake hints 后由 poll / lease 恢复；
- busy 期间新消息不丢、不并发启动同一 Agent；
- 浏览器只显示 canonical Room Message，不显示草稿或 Provider diagnostic。

当前 `1…10` 双进程、真实浏览器主路径、第四个数字后的持久重启，以及单 Agent busy 跨 Room + drain deadline + 数据库重开组合 gate 均已通过。`1…20` 只是更长样本，不再是独立业务语义缺口；structured Runtime、同 Workspace `#room` Reminder target 和 Thread receipt/permalink 也由第七批关闭。剩余边界是所有真实 Provider 的结构化错误覆盖、DM Reminder target、公开分享 URL 与不可见 Raft 中央内部实现，而不是报数主调度链仍缺一次 prompt。

## 已执行验证

当前工作树的定向绿测：

```text
node --test packages/application-service/test/worker-application-service.test.ts
10 passed

node --test packages/kernel/test/room-kernel.test.ts
46 passed

node --test packages/daemon/test/local-cli-runtime-spec.test.ts packages/agent-host/test/worker-cli.test.ts
10 passed
```

这些是首次审计阶段的底座测试。修复阶段已追加四条 completion-proof 红测、schema 29 active migration 回填、双外部 Agent 子进程和浏览器报数 gate，并通过本节前述全量检查。所有自动化仍使用临时数据库与 fake Runtime；没有调用真实付费 Provider，也没有用 GPT-5.6 Ultra 做测试。

## Raft-first 修复与验收顺序

1. **P0 红测先行**：把 silent reviewer、reopen、reassign、changes_requested 四条反例写成 Kernel / AgentHost 回归；先确认旧实现失败。
2. **显式业务 obligation**：由 Task/Review attention owner 创建 typed obligation；`completeActivation` 统一校验，不再维护第二套事件字符串猜测器。
3. **P0 调度 E2（已完成）**：fake 双 Agent 严格 `1 -> 10`，并覆盖并发、全丢 wake、第四个数字后的持久重启，以及单 Agent busy 跨 Room／daemon drain deadline／数据库重开；所有路径均经过 AgentHost / Worker API，busy 组合还经过真实 AgentHostDaemon，而不是只测 Kernel 方法。
4. **held-draft 四路径**：已完成。复用 Raft Computer 的 held plan、CLI 输出、十分钟 TTL 与再次 freshness 语义，补 durable resolution、lineage、rehold count 和受控 anyway；不可见的中央阈值明确标为本地适配。
5. **Thread**：先修 `thread.created` route，再增加 durable Agent follow owner和 follow/unfollow/re-mention E2。
6. **retry policy**：为 poison Activation 增加 attempt policy、blocked/escalated 状态和 Human 可见诊断；不让永久错误无限消耗 Provider。
7. **Reminder（主合同及本轮精细项已完成）**：schema 34 的 authoritative schedule + durable fire receipt + owner-only wake 保留；schema 36 进一步关闭同 Workspace `#room` target、Thread receipt 和 typed permalink。DM target 与公开分享 URL 不在已证明范围。
8. **双边与真实浏览器**：最后才做登录态 Raft 行为复核、RAH 桌面/390px浏览器、刷新/重启、通知和 canonical timeline 审查。

每一批都必须遵守 TDD、fake provider、临时 `RAH_HOME`；不得用 GPT-5.6 Ultra 做测试。本批在全量门禁、状态只读检查和一致备份完成后，已优雅重启正式 daemon，并以真实浏览器刷新复核。

## 最终判断

RAH OS 的总体架构方向与 Raft 一致：把协作事实放在 Room / Inbox / Activation，而不是模型上下文、Provider transcript 或页面内存里。当前最大的风险也不在这套架构选择，而在“Activation 可以何时结束”的证明不完整。这个 P0 会让任何写得再好的 Agent prompt 都失去保障。

因此当前状态应表述为：**核心调度骨架成立，Raft 式 peer wake、held freshness、Task/Review typed completion proof、Thread follow、poison retry、Reminder、重启／busy 组合，以及 structured Runtime、同 Workspace `#room` Reminder target 和 Thread receipt/permalink 已进入工作树。首次审计发现的 completion-proof P0 与本轮指定精细缺口已关闭，但这仍不等于所有 Provider 都产生结构化错误，也不包含 DM Reminder target、公开分享 URL、不可见 Raft 中央表结构或所有真实 Provider 故障分支。**
