# ADR-0014：Activation-scoped Agent Room reply

状态：Accepted（双 Agent daemon + Web E2 local，2026-08-26）

## 背景

daemon config v4 已证明两个 Agent 可以读取同一 Room 上下文、竞争 open Task、产生单赢家并提交 Task，但 Worker bearer 只能调用 Task command。于是系统完成了多 Agent 任务协调，却不能让正在执行的 Agent 把一条普通回复写回 canonical Room；把 Task progress 当作聊天消息会重新混淆业务对象。

Worker 不能获得 Agent PAT 或任意 `postMessage(actor, room)` 权限。否则 CLI 可以选择 actor/Room、跨 Activation 读取或写入，并把临时 Provider session 重新变成协作 authority。

## 决策

1. Worker API 增加唯一窄命令 `POST /v1/worker/messages/post`，request 只包含 `basedOnRoomSeq`、`body`、`idempotencyKey`。actor、Room、participant、Activation、RunAttempt 与 recipient policy 全部来自当前 authenticated execution grant。
2. `basedOnRoomSeq` 必须已由该 bearer 的 `sync` 实际投递，并且必须等于不可变 Activation `toSeq`。只读取部分分页、猜测 cursor 或引用 follow-up range 都会 fail closed。
3. 该命令追加 canonical `Message` 与 `message.posted` Room event，event payload 固化 `activationId` 与 causal `basedOnRoomSeq`。同一 idempotency key 只允许相同 Agent、Activation、body 和 causal head 重放。
4. Activation reply 是可并发追加的 commutative response：两个 Agent 可以基于同一个 immutable Activation head 分别回复，即使其中一条先进入 Room head，也不让另一条因未见该并行回复而失败。
5. v1 reply 不接受 recipient/mention/Thread/Task 字段，并固定产生空 `activationIds`，避免 Agent 回复互相制造无限唤醒。Human 或后续显式任务若需要继续协作，仍通过新的 canonical event 产生 follow-up Activation。
6. Agent Room reply、Task progress/submission 与 Runtime diagnostics 是三个不同对象。stdout/JSONL 不参与消息判定；Task 仍只有一个 owner，Human 仍需显式完成 submitted Task。

## 证据

- protocol test 拒绝 actor/Room 注入和空 body；
- Worker HTTP test 证明两个独立 execution grant 基于同一 cursor 各写一条消息、服务端固定 actor/Room、重复写幂等、未知 cursor 与未读完整 Activation 均被拒绝；
- daemon config v4 E2 证明两个独立 Runtime Profile/Fake CLI 都写回 canonical Room，而 open Task 仍只有一个 assignee/winner；
- 真实浏览器 gate 证明 Human 发消息并创建 open Task后，Alice/Kimi 两条 Agent 回复自动出现，Task 卡显示单赢家、progress、submission summary，Human 完成验收，reload 后 Room 与 Task 状态完整恢复。

## 声明边界

- 这是 activation-scoped Room reply，不是通用 Agent PAT、任意 Room RPC、Thread reply 或 mention API；
- Human Room Message 的默认 membership 投递与 mention 注意力语义由 [ADR-0015](./0015-room-membership-delivery-and-agent-activity.md) 定义；本 ADR 只约束 Agent 的 activation-scoped reply；
- 当前真实 Provider gate 尚未复跑该 endpoint，E2 使用 deterministic Fake CLI；
- Agent-to-Agent follow-up、Thread subscription policy、速率/配额、Artifact/Review 和 Human Inbox 继续由后续独立能力定义。
