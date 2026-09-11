# 原生忙时投递施工边界

后续实施记录见[Codex 原生忙时投递](./2026-09-11-codex-native-busy-delivery.zh-CN.md)。下文保留施工前状态，不能作为最新未实现清单。

## 施工前事实

成员角色修复单独验收，不与 Runtime 生命周期修改一起部署。下一批从 Codex 的运行中投递纵向链路开始，然后覆盖 Claude/Kimi，最后跑相同模型/effort 的双边组合；OpenCode 按上游 none 保留逐回合积压消费。本文是施工设计，不是功能已实现或验收通过。

当前 RuntimeAdapter 只有 start/cancel/reap/recover，没有运行中输入；GenericProcessAdapter 的直接启动与 process-supervisor.mjs 的托管启动均使用 stdin ignore。AgentHost 的 maintainRunLease 只维护 lease/heartbeat，不读取持久 follow-up 或推送 Runtime 提示。因此缩短启动轮询、修改 prompt、把 stdout 当 ACK 都不能补出这条链。

## 上游依据

Raft Computer 1.0.18 main.js SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，提取目录见 Runtime 双边预检报告。

- 769113 起 sendStdinNotification：关闭/空闲债务、session ready、退避、压缩/审阅边界、已贡献和重复指纹检查。
- 769235 起：projectAgentInboxSnapshot → formatAgentInboxDelta → runtimeProcessBindingFence.send；成功才记录通知指纹，失败重排；写入不等于已读。
- 759052 起 Codex encodeStdinMessage：存在 thread 且 canSteerBusy 才发送 turn/steer，携带 expectedTurnId；不能遇到空闲或过期 turn 自动发起另一个工作回合。
- 已记录的 Runtime 描述符：Claude gated；Codex/Kimi direct；OpenCode none/per_turn。Kimi SDK 与本地 Kimi ACP 并非同一传输，必须区分来源与本地接线。

另检查 Multica 当前 commit `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 server/pkg/agent/codex.go：有 turn/start 与恢复/运行观察，但该文件没有 turn/steer。此项采用 Raft 的具体投递实现，不把 Multica 的新回合启动当作忙时 steer。

## 按 owner 串行实施

1. **Kernel 的只读待通知投影**：从既有 Inbox/Activation 中获得此 Agent 尚待处理的精确 Room/Thread/Message 范围。限定当前 Host generation、RunAttempt/lease 和当前成员可见范围；有界分页/大小；不得新建第二套业务队列或把一次通知算 ACK。跨 Room 不能复用 origin 的序号作为另一 Room 的进度。
2. **AgentHost 的投递协调**：活跃 Run 持有明确 runtime handle；按上游去重、退避、会话就绪及终态守卫。指纹只用于有界传输抑制，进程重启可以丢失，持久 Inbox/follow-up 仍负责恢复。发送成功不完成原 Activation、后续 Activation 或 Task。
3. **现有 supervisor 私有通道**：扩展已认证控制面，绑定 runAttempt/runtimeRun/supervisor，限制消息大小和背压；直接与托管路径同合同。不能为了接 stdin 绕过 supervisor，不能误将旧 handle 的输入送给替换后的进程。
4. **Codex 原生接线**：对当前实际 thread/turn 使用 turn/steer。测试先证明同一未结束回合收到了追加，再证明显式 Room 工具回应落账。late response、turn ending、broken pipe、重复提示都保持 follow-up 可恢复。
5. **Claude 与 Kimi 各自能力**：在 Codex 纵向闭环后移植 gated/direct 对应机制；分别确认压缩/工具边界和追加语义。OpenCode 不人为增加上游没有的 busy steer。
6. **独立处理进程驻留**：busy steer 能在当前进程中完成，不代表跨 Activation 的常驻进程已完成。长期驻留还需续接短期 Worker 凭据、Agent 配置/模型切换、重启围栏及进程绑定，不能宣称几行 stdin 接线等于生命周期全面对齐。

## 每层通过条件

先 fake Runtime/时钟/数据库验证：忙中新增两条不丢原任务；同一提示不重复注入；不同 Thread 不合并丢目标；原回合结束的竞态不启动未授权新回合；旧 handle 不可写；注入失败/进程崩溃后 follow-up 仍在；通知本身不推进任何 canonical ACK/Task 状态。缺少目标信息时失败关闭，不能交给模型推导内部 ID。

再使用已授权真实模型，分别记录原消息、追加、第一次原生注入、追加显式回复、原任务结果、最终文件、实际 model/effort 与进程/回合 ID。双方都需要匹配前提并比较顺序、漏答/重复和时间。Task 自动认领与正确目标分开判定；合法 Task Thread 不当作跨 Room 串线。原 A→B 回归保留独立负对照。

未完成：上述生产投递链、原生组合实测及后续 UI。不可将这个设计或角色修复的测试结果算作忙时投递通过。
