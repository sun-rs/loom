# Codex 原生忙时投递：实现与局部验收

## 结论与边界

Codex 的 Kernel → Host → 认证 supervisor → 原运行 driver → `turn/steer` 已接通。隔离真实 Codex `gpt-5.6-luna / low` 实验中，原回复与追加回复都在同一个仍 running 的 RunAttempt 中完成，各一条、同 Room、无 Thread。不是全部 Runtime 或严格 Raft 双边组合验收。

真实记录：原请求 06:06:26.432Z；追加 06:06:44.268Z；原回复 06:07:33.986Z；追加回复 06:07:37.678Z。追加至回复 53.410 秒，原任务包含 `sleep 30`。原生 Provider 用户输入记录中有且只有一条 RAH inbox notice，实际模型与 effort 由进程参数和 Provider turn_context 双重确认。不能据此宣称旧的 192 秒与 Raft 22 秒已同条件调平。

最终代码第二次真实复验同样通过：追加至两回复完成约 50 秒，Provider 原生输入记录中仍只有一条通知；证据为 `real-codex-final-evidence.json`。

两次均仍存在一次后续 Activation 运行，但没有第二次业务回复；durable follow-up 没有因 stdin 写入被清除。这证明恢复保底保留，也暴露相对上游 contribution suppression 的剩余开销。应以真实 read/contribution 与 Activation 义务 owner 对照处理，不能在 adapter 中直接 ACK。

## 上游与本地接线

来源：授权提取的 Raft Computer 1.0.18 `main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，路径见[施工边界](./2026-09-11-native-busy-delivery-construction.zh-CN.md)及其 Runtime 预检引用。

- `sendStdinNotification` 769113/769235：既有 Inbox 投影、重复指纹抑制、写入失败恢复。
- `projectAgentInboxSnapshot` 737013 与 `formatAgentInboxDelta` 734232：按目标分组的未读提示，保留 sender handle、Message 和 Thread 寻址。
- `RuntimeTurnState` 758175：pending turn 与 post-tool steering gate；`encodeStdinMessage` 759052：`turn/steer` 携带当前 thread 和 `expectedTurnId`，不自动改用新 turn/start。
- `recordNoticeWritten` / `filterUncontributedMessages` 763021/763039：逐消息传输贡献去重；已推 X 后收到 Y，只推 Y，不重复推 X。
- `pendingDeliveryRequests` 759005：明确 RPC 拒绝与已经写入、回执未知分开。本地明确拒绝允许重试；超时/丢回执不重复注入相同指纹。

这是结构性移植，不是逐字复制。RAH glue 是 Kernel 只读查询、Host generation/lease/RunAttempt fence，以及已有 supervisor 认证管道中的有界输入与私有传输回执。回执不进入 Room 事件，也不证明已读或完成。Multica 的 Codex startup/resume 不含对应 steer，故该项采用 Raft 源码。

## Owner 与验证

Kernel 目前从 message.posted 的 pending Inbox 获取最新有界窗口，按成员关系与 target read position 筛选，保持 #channel / dm:@handle / Thread suffix，不加入第二套队列。当前 Run 原冻结范围不重复提醒；Stop、disabled、过期 lease、替换 Host 和终态 Run 不可读取。只读投影无 ACK 副作用。

Host 每秒检查一次，当前运行保留已写指纹和最多 256 个已写消息 identity；这些仅用于传输去重，不表示业务已读。排除发生在查询 LIMIT 之前；达到上限后交回持久 follow-up，不增长无界内存。Task 专用事件仍走既有 follow-up。失败仍由持久 Inbox/follow-up 兜底。GenericProcessAdapter 仅为 Codex profile 开启 nativeBusyInput；supervisor 校验原 run/supervisor/token 后写入目标 stdin，限制字节与背压。直接路径处理 EPIPE；挂起 write 有整体 deadline，不能阻塞取消。driver 必须观察匹配 turn/started；事件先于 RPC 回执时仅暂存身份，待回执确认同一 turn 后开放；工具边界暂缓，进展恢复；turn/completed 后不再 steer。

测试先复现没有 notifyBusy、Host 忙时无投递，再实现通过。独立审查发现的回执不明重复注入、turn-ready 缺失和整体超时问题均补了失败反例；Kernel Stop/disabled 检查另经内存移除反证。假 Provider 集成覆盖真实 supervisor、当前 turn 参数、重复抑制、明确拒绝重试、超长输入及终态拒绝。Windows 直接路径没有本机运行验收，不宣称已测。

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-11-native-busy/`。其中 `real-codex-evidence.json` 只保存模型/effort、原生输入和显式业务结果，不保存模型推理内容。

## 剩余顺序

1. 按 Raft 源码补 Claude gated / Kimi direct；OpenCode 保持 none。Codex 后续空运行抑制须在既有 Kernel contribution/Activation owner 收口。
2. 同 CLI/model/effort、同目标和追加触发条件，双边重跑多轮审计返工、双 Thread、跨 Room/DM、配置切换与恢复。原 A→B 回归仍单独保留。
3. 完成组合验证后，再处理已列明的 UI 局部差异。

跨 Activation 的常驻进程不是本批内容，不能将当前 turn 的原生 steer 宣称为生命周期全面对齐。没有提交或 push。

## 正式实例交付

最终源码的 `npm run check`、`npm run format:check`、`git diff --check` 通过。状态数据库与 Agent 工作区/记忆分别备份后，已优雅重启正式 4173 实例；原 43 条消息、32 个已完成 Activation 和 32 个已退出 Run 保留。Web 未改动，复用已验证的冻结 bundle。

重启后使用全新 Google Chrome 无头窗口（1440×900、DPR 2）实际点击侧栏切换 Room/DM、刷新并返回，历史消息可见，截图已人工检查，无 pageerror。Mac 锁屏使原生窗口操作不可用，因此这不是解锁后交互或 Raft 双边验收；正式进程、备份、截图和浏览器结果见证据目录中的 deployment.json 与 formal-browser.json。
