# 后续消息通知的成功消费覆盖（2026-09-28）

## 问题与边界

P45 的当前运行已读取并回复后来的点名消息，Kernel 却继续执行为该消息排队的 Activation。目标是消除这次多余执行，不是按文字相似度删除回复。参考 Raft 按目标记录消费进度的行为，但 Loom 使用逐消息凭据并额外要求来源运行成功结算；不能用目标 MAX 已读位置、Provider 输出或进程退出单独代替完成证明。

唯一所有者为 Kernel。新增按 RunAttempt、Room、精确消息序号与 session generation 记录的读取凭据（schema 79）；schema 82 在 held 草稿上保存本轮精确输出窗口及送达状态，没有第二个队列。旧数据不回填消费证明。

## 确认与结算

1. 经认证的 `message-read` / `room-read` 保存本运行、同房间实际返回的精确消息；线程身份从账本推导，截断遗漏不记。CLI 成功完成输出回调后才回传隐藏的 `readReceiptId`；网络丢失、EPIPE 或输出超时不算送达。该收据既不推进 Room cursor，也不证明消费。跨房间历史不进入本次覆盖证明。
2. 只有先有 CLI 输出收据，成功发帖且模型显式提供 `basedOnRoomSeq` 时，只确认该目标、该序号以内、本 Run 已保存的精确读取。`--final` 后关闭消费证明写入，进程收尾阶段迟到的工具读取或确认不再扩大集合；被 hold 或仅服务端推导的序号不算确认；幂等重放不得扩大第一次发帖的确认集合。显式 `revise-draft` 的窄补充路径见下节，不能以其服务端新鲜度上界替代精确凭据。
3. 无需回复时，后续 `message-check` 冻结此前已有 CLI 输出收据的读取集合，返回不透明的检查 UUID；原有 Worker ACK 回显 UUID，确认该检查页时同时确认此集合。UUID 只在本 Run/Room 有效，不进入模型正文。原 Activation 的 toSeq 和订阅 cursor 不扩大，不允许 Worker 提交任意未来序号。检查之后才读取的消息不能借先前 ACK 确认。
4. 来源 Activation 通过原有 ACK、终止证明、业务义务及首轮检查且无待发 held 草稿后，结算该来源成功 Run 覆盖的后续候选。仅 Role 实例、同房间、同 generation、未被领取且无 Placement/RunAttempt 的普通消息通知适用。
5. 候选区间内**属于该实例 Inbox 的所有事件**必须都是允许的消息通知，并具有同一成功来源运行的确认凭据；Task 来源/typed obligation 继续检查，未知业务事件不优化。部分覆盖不拆分，整单保留。
6. 同事务取消重复通知，记 `activation.cancelled`（reason=covered_by_successful_run，含来源 Activation/RunAttempt/consumer 与精确序号）；候选状态为 cancelled 而非 completed，保持原有完成所需 ACK 不变量；不伪造 RunAttempt、exit 或候选 ACK，不改 Inbox/Task/唤醒链计数。来源成功时主结算，两个领取入口在预留资源前用同一函数补偿。

## held 修订的精确证明（2026-10-04）

P96 中 Astra 收到 Sol 的后来消息，被 hold 后修订成功，但 held 输出只有呈现记录、没有逐 Run 输出收据，导致该消息又启动一次只读运行。修复由 Kernel 保留原成功结算规则，补齐缺失的送达与消费两步：

- 新建草稿已绑定原模型回复意图时，在草稿 `read_proof_json` 冻结本 Run、实例、Room、session generation、精确后来消息序号、整个返回窗口摘要及随机收据。仅当前来源 Room 的 Role 实例适用。旧草稿的 NULL 不补写；重放只复用同运行、同窗口的原收据。
- Worker CLI 隐藏收据，在完整 stdout 文本或 stderr JSON 的写回调完成后，调用现有 `read-received`。文本正文被截断或遗漏附件元数据时，整批不确认送达；JSON 保留完整返回内容。输出失败、超时或收据请求失败保持“已保存草稿、不可重发原请求”的错误语义，不自动重发帖子。收据只是输出输送证明，不声称模型已读。
- 仅第一次成功提交该草稿的 `revise-draft`，在同一事务、原 ACK/final 结算之前，把已送达窗口里的精确消息转为现有逐 Run 消费凭据。核对修订事件、草稿、作者及线程身份；不使用修订的新鲜度上界扩大集合。原 Activation 的 `toSeq`、ACK 与 Inbox 不变。
- 失败／再次被 hold、放弃、普通替换、原样发送、幂等重放都不走这个确认入口。final 后、跨运行或 session generation 失配不能补写。来源运行失败、候选含未覆盖消息、私聊或既有调度禁区时，原取消条件继续阻止消除通知。

本补丁只消除具备上述完整证明的重复执行；截断窗口仍保留后续通知。它不改变点名范围、普通发帖／final 语义或提供额外模型调用，不证明整体成本达标。专项 Kernel、Host 输出与真实 HTTP→CLI 夹具均按本路径验证；实际模型复验及效率门禁需要另行授权。

## 必测边界与交付顺序

先复现：读取并回复后不再启动后续轮；无需回复但经 check 确认后不空跑。再覆盖洞、失败/缺终止证明、错误目标、跨实例/私聊、reset、新尾部、Task、已预留/重试、ACK 前后读取交错、幂等和删除清理。

先设计与测试，后最小实现；沿用现有 CLI 工具，不改四家驱动、不改 UI、不增提示词规则；收到新消息的读取工具仅增加一次本机隐藏输出收据请求，不增加模型生成或重复正文。完整免费检查通过后按既有备份与空闲守卫部署。付费三实例对照需单独明确授权；本批不能宣称真实 CLI token/延迟已验收。

## 上游依据与有意差异

- 本地发布源码 Raft Computer 1.0.32：`raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.32/slices/packages/daemon/dist/dist-CI7CMKZV.js:8694–8740`，SHA-256 `ecec84c95092e92c63ee545e7bf6921b54abf1c37cde0d63513098c48f3d0a92`。`recordConsumedRead/recordConsumedSeqs` 实际保存目标最大序号与 readOrder；9647 行在非 withheld 的 held 响应里也推进消费序号。这不能直接作为 Loom 的成功处理证明，本实现不复制该高水位结算语义。Raft 中央调度未在这些本地切片中，不能据此宣称已核实其服务端去重算法。
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`，`server/internal/handler/comment.go:2654–2705`：以显式点名决定触发，另有受限的 assignee/leader 回退；不是本次的“已被其他执行处理”的证明算法。保留 Loom 已裁定的唤醒范围，不引入新的队列或会话 owner。
- 两者仅作本地行为核查，没有复制源码；Raft 发布 bundle 保持 analysis-only，Multica 自有许可证与附加条件不因本次核查发生复用或再分发。新算法由 Kernel 的现有信任边界决定；对应 P45 独立评估位于 `~/.loom/reviews/2026-09-28-codex-read-covered-activation.md`。

## schema 82 验证记录（2026-10-04）

Kernel 专项组 45 项、Host 输出相关组 91 项与 HTTP→CLI 贯通 3 项通过；红测包含缺失收据、origin 命令入口及错误反射泄露，HTTP→CLI 另以隔离的 HEAD Host 验证旧实现两项预期失败，未回滚共享源码。完整 `npm run check` 通过：核心 2,790 通过、22 跳过，Web 487、控制台 59、效率门禁单测 236，全部零失败；格式、diff 与文档本地链接检查通过。

正式服务空闲备份并优雅重启至 schema 82，两库与297个文件备份验证通过，11类业务表哈希不变，35份历史草稿无证明回填；真实 Chrome 页面与 Role／频道记忆认证读取通过。测试证明取消条件及执行路径，不证明模型成本已下降；P96 真实复验与效率门禁未运行。部署版本和备份见 [status §1](status.zh-CN.md#1-环境与服务)。

## 原 schema 79 验证记录（2026-09-28）

专项 29 项免费测试通过（Kernel 17、HTTP→CLI 输出收据及确认桥 1、Worker check 8、读取输出 3），包括原复现、只读确认、读取洞、失败与缺 ACK/终止证明、私聊隔离、线程目标、session reset、任务、幂等、held 草稿与 schema 78→79 无回填迁移。先记录红测，再实现；取消语义、held 草稿、final 后迟到工具及读取响应丢失边界也分别复现失败后修复。

正式库的临时副本迁移预检通过，原库在预检期间保持 schema 78。完整检查与正式部署结果随后记录于 status 当前页；未运行付费 CLI，不宣称 P45 实际模型讨论或效率门禁已通过。

频道删除清单首次全仓检查发现未登记新表，随后补入生产清理列表及定向清理测试（删除清理与覆盖测试合跑 34 项通过）。有 Role 实例的频道仍按现有 MVP 规则拒绝删除，本批不开放该能力。最终验收以固定代码后的完整检查为准。

最终固定代码的 `npm run check` 已完整通过（核心 2,682 通过、22 跳过；Web 481、控制台 59、效率门禁单测 235，全部零失败）；类型、格式与 diff 检查通过。正式 4176 已空闲备份并重启至 schema 79，消息、RunAttempt、Role 配置与 session 绑定表内容哈希未变，预热保持关闭。浏览器因管理策略校验不可用未能完成页面验收；P45 真实模型讨论及效率门禁未复跑。详见 status §1。
