# 后续消息通知的成功消费覆盖（2026-09-28）

## 问题与边界

P45 的当前运行已读取并回复后来的点名消息，Kernel 却继续执行为该消息排队的 Activation。目标是消除这次多余执行，不是按文字相似度删除回复。参考 Raft 按目标记录消费进度的行为，但 Loom 使用逐消息凭据并额外要求来源运行成功结算；不能用目标 MAX 已读位置、Provider 输出或进程退出单独代替完成证明。

唯一所有者为 Kernel。新增按 RunAttempt、Room、精确消息序号与 session generation 记录的读取凭据（schema 79），没有第二个队列。旧数据不回填消费证明。

## 确认与结算

1. 经认证的 `message-read` / `room-read` 保存本运行、同房间实际返回的精确消息；线程身份从账本推导，截断遗漏不记。CLI 成功完成输出回调后才回传隐藏的 `readReceiptId`；网络丢失、EPIPE 或输出超时不算送达。该收据既不推进 Room cursor，也不证明消费。跨房间历史不进入本次覆盖证明。
2. 只有先有 CLI 输出收据，成功发帖且模型显式提供 `basedOnRoomSeq` 时，只确认该目标、该序号以内、本 Run 已保存的精确读取。`--final` 后关闭消费证明写入，进程收尾阶段迟到的工具读取或确认不再扩大集合；被 hold 或仅服务端推导的序号不算确认；幂等重放不得扩大第一次发帖的确认集合。
3. 无需回复时，后续 `message-check` 冻结此前已有 CLI 输出收据的读取集合，返回不透明的检查 UUID；原有 Worker ACK 回显 UUID，确认该检查页时同时确认此集合。UUID 只在本 Run/Room 有效，不进入模型正文。原 Activation 的 toSeq 和订阅 cursor 不扩大，不允许 Worker 提交任意未来序号。检查之后才读取的消息不能借先前 ACK 确认。
4. 来源 Activation 通过原有 ACK、终止证明、业务义务及首轮检查且无待发 held 草稿后，结算该来源成功 Run 覆盖的后续候选。仅 Role 实例、同房间、同 generation、未被领取且无 Placement/RunAttempt 的普通消息通知适用。
5. 候选区间内**属于该实例 Inbox 的所有事件**必须都是允许的消息通知，并具有同一成功来源运行的确认凭据；Task 来源/typed obligation 继续检查，未知业务事件不优化。部分覆盖不拆分，整单保留。
6. 同事务取消重复通知，记 `activation.cancelled`（reason=covered_by_successful_run，含来源 Activation/RunAttempt/consumer 与精确序号）；候选状态为 cancelled 而非 completed，保持原有完成所需 ACK 不变量；不伪造 RunAttempt、exit 或候选 ACK，不改 Inbox/Task/唤醒链计数。来源成功时主结算，两个领取入口在预留资源前用同一函数补偿。

## 必测边界与交付顺序

先复现：读取并回复后不再启动后续轮；无需回复但经 check 确认后不空跑。再覆盖洞、失败/缺终止证明、错误目标、跨实例/私聊、reset、新尾部、Task、已预留/重试、ACK 前后读取交错、幂等和删除清理。

先设计与测试，后最小实现；沿用现有 CLI 工具，不改四家驱动、不改 UI、不增提示词规则；收到新消息的读取工具仅增加一次本机隐藏输出收据请求，不增加模型生成或重复正文。完整免费检查通过后按既有备份与空闲守卫部署。付费三实例对照需单独明确授权；本批不能宣称真实 CLI token/延迟已验收。

## 上游依据与有意差异

- 本地发布源码 Raft Computer 1.0.32：`raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.32/slices/packages/daemon/dist/dist-CI7CMKZV.js:8694–8740`，SHA-256 `ecec84c95092e92c63ee545e7bf6921b54abf1c37cde0d63513098c48f3d0a92`。`recordConsumedRead/recordConsumedSeqs` 实际保存目标最大序号与 readOrder；9647 行在非 withheld 的 held 响应里也推进消费序号。这不能直接作为 Loom 的成功处理证明，本实现不复制该高水位结算语义。Raft 中央调度未在这些本地切片中，不能据此宣称已核实其服务端去重算法。
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`，`server/internal/handler/comment.go:2654–2705`：以显式点名决定触发，另有受限的 assignee/leader 回退；不是本次的“已被其他执行处理”的证明算法。保留 Loom 已裁定的唤醒范围，不引入新的队列或会话 owner。
- 两者仅作本地行为核查，没有复制源码；Raft 发布 bundle 保持 analysis-only，Multica 自有许可证与附加条件不因本次核查发生复用或再分发。新算法由 Kernel 的现有信任边界决定；对应 P45 独立评估位于 `~/.loom/reviews/2026-09-28-codex-read-covered-activation.md`。

## 验证记录

专项 29 项免费测试通过（Kernel 17、HTTP→CLI 输出收据及确认桥 1、Worker check 8、读取输出 3），包括原复现、只读确认、读取洞、失败与缺 ACK/终止证明、私聊隔离、线程目标、session reset、任务、幂等、held 草稿与 schema 78→79 无回填迁移。先记录红测，再实现；取消语义、held 草稿、final 后迟到工具及读取响应丢失边界也分别复现失败后修复。

正式库的临时副本迁移预检通过，原库在预检期间保持 schema 78。完整检查与正式部署结果随后记录于 status 当前页；未运行付费 CLI，不宣称 P45 实际模型讨论或效率门禁已通过。

频道删除清单首次全仓检查发现未登记新表，随后补入生产清理列表及定向清理测试（删除清理与覆盖测试合跑 34 项通过）。有 Role 实例的频道仍按现有 MVP 规则拒绝删除，本批不开放该能力。最终验收以固定代码后的完整检查为准。

最终固定代码的 `npm run check` 已完整通过（核心 2,682 通过、22 跳过；Web 481、控制台 59、效率门禁单测 235，全部零失败）；类型、格式与 diff 检查通过。正式 4176 已空闲备份并重启至 schema 79，消息、RunAttempt、Role 配置与 session 绑定表内容哈希未变，预热保持关闭。浏览器因管理策略校验不可用未能完成页面验收；P45 真实模型讨论及效率门禁未复跑。详见 status §1。
