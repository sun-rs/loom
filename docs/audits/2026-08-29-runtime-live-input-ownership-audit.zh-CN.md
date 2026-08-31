# Runtime live input / steer 所有权审计

状态：**协议边界已裁决，生产写入尚未启用**（2026-08-29）。

本文只回答一个问题：当 Agent 正在一个 Provider turn 中工作，Room 又出现新消息时，RAH OS 能否直接把正文写入 CLI stdin 或 Codex `turn/steer`。结论是：**当前不能把正文直接注入；现有 follow-up Activation 是正确的可靠基线。** Raft 的 busy path 也不是把聊天正文当作第二条不可审计输入流，而是发送有界的 inbox 提示，再让 Agent 调用权威 message API 拉取。

## 1. Raft 已验证行为

获授权的 Raft Computer `1.0.18` bundle 显示：

- Codex runtime 声明 `inFlightWake=steer`、`busyDeliveryMode=direct`；busy 时编码为带 `threadId + expectedTurnId` 的 `turn/steer`，idle 时才使用新的 `turn/start`。
- busy notice 由 pending inbox 投影生成，带目标/计数等提示；它要求 Agent 在自然边界运行 `raft message check`，并不把 Provider session 当成消息账本。
- notice 有 session/turn fence、重复 fingerprint、compaction/review boundary、失败重排和 runtime-error backoff；写入 stdin 明确不推进 server cursor。
- 真正的消息消费、读取和业务 mutation 仍由 Raft message API 负责。Provider 对 steer 的接受也不等于消息已读、已处理或业务已完成。

这部分应移植的是“content-free/bounded hint + authoritative pull + identity fence”，不是简单调用一次 `turn/steer`。

## 2. RAH OS 当前可靠路径

RAH OS 的当前不变量是：

1. queued 状态的新事件合并进同一 Activation 范围；
2. Agent 已 leased/running 时，新事件形成或扩展下一个 queued Activation；
3. 当前 Worker credential 只允许读取冻结的 `fromSeq..toSeq`，只可 ack 本 credential 实际收到的 cursor；
4. 当前 Run 结束后，同一 participant lane 串行领取 follow-up Activation；Codex/Kimi 用 Host 私有 Provider session resume，但 Room/Message 仍是唯一业务真相。

因此现在的路径虽然比 Raft 的 busy notice 慢一个 turn，却不会漏消息、不会并发运行同一 Agent，也不会让旧 credential 越过冻结的因果范围。它是正式产品可用的可靠降级，不是静态 UI 假实现。

## 3. 禁止的捷径

在以下协议出现前，不得只给 `RuntimeAdapter` 添加一个 `send(text)`，也不得把 Room Message 正文直接交给 Provider：

- 旧 Activation 的 `toSeq` 没有原子扩展，Worker credential 无权读取新范围；
- Provider `turn/steer` 的 RPC success 不是 canonical delivery acceptance；
- stdin 写成功不能推进 Inbox/cursor，也不能吞掉 follow-up Activation；
- crash、重复 hint、迟到响应和 session replacement 时无法以稳定 identity 对账；
- 直接正文注入会形成与 Worker API 并列的第二条消息来源，并绕过 `basedOnRoomSeq` freshness fence。

## 4. 未来可实现的最小协议

若产品数据证明一个 turn 的额外延迟不可接受，必须按以下顺序实现：

1. Kernel 原子签发 `RuntimeInboxNotice`，固定 `noticeId`、participant、Room、queued Activation、`throughSeq` 和 unread-set digest；notice 只描述“有更新”，不含消息正文。
2. Host 只能把该 notice 投递给精确的 active RuntimeProcess generation、Provider session 和 active turn；Codex 使用 `expectedTurnId`，其他 Provider 必须有等价 fence。
3. Runtime adapter 回报 `accepted | rejected | unknown`，并保留 request identity。`accepted` 只表示 Provider 接受提示，不推进 Room cursor。
4. Agent 仍通过 Worker application service 拉取。若允许当前 credential 读取 follow-up 范围，Kernel 必须原子扩展执行 grant，并把每个实际返回的 cursor 加入 delivered set；不能仅修改内存中的 `toSeq`。
5. 只有 Worker `acknowledge` 可形成 delivery proof；当前 Run 未处理的新范围继续保留在 queued Activation，不能因 steer success 被删除。
6. duplicate、disconnect、compaction/review、provider busy、session replacement 和 Host crash 都必须有 fake protocol + process supervisor 黑盒。

## 5. 当前裁决

- `turn/steer`/SDK steer 属于 L1 延迟优化，不是本机正式产品闭环的 P0 前置条件。
- 当前不修改 `RuntimeAdapter`，避免先产生一个无法证明 delivery 的半协议。
- 下一优先级仍是完善各 Provider 的结构化 transport、watchdog 与产品验收；等 Kernel notice/grant 扩展有单一 owner 后，再接 Codex/Kimi 的 native steer。

该裁决与 [Inbox、Activation 与 AgentHost](../architecture/delivery-and-activation.zh-CN.md)、[Runtime Adapter 与观察平面](../architecture/runtime-adapter-and-observation.zh-CN.md) 共同构成约束；后续实现不得只改 Provider driver 绕过它。
