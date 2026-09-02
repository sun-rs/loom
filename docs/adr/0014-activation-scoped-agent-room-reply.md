# ADR-0014：Activation-scoped Agent Room reply

状态：Accepted（Raft Inbox + held-draft 协作收口，2026-09-02）

## 背景

daemon config v4 已证明两个 Agent 可以读取同一 Room 上下文、竞争 open Task、产生单赢家并提交 Task，但 Worker bearer 只能调用 Task command。于是系统完成了多 Agent 任务协调，却不能让正在执行的 Agent 把一条普通回复写回 canonical Room；把 Task progress 当作聊天消息会重新混淆业务对象。

Worker 不能获得 Agent PAT 或任意 `postMessage(actor, room)` 权限。否则 CLI 可以选择 actor/Room、跨 Activation 读取或写入，并把临时 Provider session 重新变成协作 authority。

## 决策

1. Worker API 增加唯一窄命令 `POST /v1/worker/messages/post`。普通编写分支只包含 `basedOnRoomSeq`、`body`、`idempotencyKey`；Raft 式保存草稿分支包含 `sendDraft: true`、`heldDraftId`、`basedOnRoomSeq`、`idempotencyKey`，只有反复 hold 后才能再带 `anyway: true`。actor、Room、participant、Activation、RunAttempt 与 recipient policy 全部来自当前 authenticated execution grant。
2. `basedOnRoomSeq` 必须已由该 bearer 的 `sync` 实际投递，并且必须等于不可变 Activation `toSeq`。只读取部分分页、猜测 cursor 或引用 follow-up range 都会 fail closed。
3. 该命令追加 canonical `Message` 与 `message.posted` Room event，event payload 固化 `activationId` 与 causal `basedOnRoomSeq`。同一 idempotency key 只允许相同 Agent、Activation、body 和 causal head 重放。
4. Room reply 使用 Raft 风格的 target-specific freshness contract。根消息只和根消息比较，Thread 回复只和同一 Thread 比较；若当前 target 已出现晚于 `basedOnRoomSeq` 的 `message.posted`，本次文本不进入 Room，而是以 `state: held`、稳定 `heldDraftId`、`reholdCount`、`continueAnywaySuggested`、有限 `newerMessages` 与遗漏计数返回。普通改写会关闭同目标旧草稿；`sendDraft` 从 Kernel 保存的正文取值且再次做同一 freshness check；第一次 rehold 后 `reholdCount=2` 才建议并允许显式 `anyway`。相同 idempotency key 对 held、send-as-is 和 send-anyway 都稳定重放，不能把普通编写请求变成绕过开关。
5. 保持静默不是一条伪造的 Room mutation。和 Raft CLI 一样，Agent 可以不发送；保存草稿的有效期固定为 Raft 可见实现的十分钟。Kernel 初始化和正常 Activation 租约维护会把到期草稿解析为 `expired`，新请求也按到期时间 fail closed。RAH 把 Raft CLI 的本地草稿转为 Kernel durable owner，因此额外记录 `source_held_draft_id`、resolution 和时间，属于本地可审计增强。
6. v1 reply 仍不接受 recipient/mention/Thread/Task 字段。Kernel 对根消息固定派生“同 Room 内除发送者之外的已启用 Agent”，对 Thread 回复固定派生该 Thread 因果事件的订阅者交集，并产生 canonical Inbox/Activation。Agent-originated Message 是注意力信号而不是回复义务；standing prompt 要求根据最新已提交消息决定是否回应，目标已完成时只 ack，避免递归闲聊，同时支持轮流报数等连续协作。
7. Agent Room reply、Task progress/submission 与 Runtime diagnostics 是三个不同对象。stdout/JSONL 不参与消息判定；Task 仍只有一个 owner，Human 仍需显式完成 submitted Task。

## 证据

- protocol test 拒绝 actor/Room 注入和空 body；
- Worker application-service test 证明两个独立 execution grant 基于同一 cursor 竞争时只追加先到的 Message，落后回复稳定返回同一 held draft；后续还证明 send-as-is 成功、再次 freshness/rehold、首次强制被拒、重复 hold 后 send-anyway、正常改写以及三种成功分支的幂等重放；
- schema 迁移测试证明旧草稿取得十分钟有效期，边界前可用、边界时 durable `expired`；
- 同一测试证明成功 Agent 回复为另一位已加入 Agent 创建 follow-up Activation，而发送者不会自唤醒；
- standing-prompt test 固定 Agent 消息的注意力语义、轮流协作时的最新消息规则、held draft 处理和目标完成后的静默规则；
- daemon config v4 E2 证明两个独立 Runtime Profile/Fake CLI 都写回 canonical Room，而 open Task 仍只有一个 assignee/winner；
- 真实浏览器 gate 证明 Human 发消息后多个 Agent Activation 都会执行，但 target-specific freshness 只让最先提交的一条 Agent 回复进入 Room，其余 Agent 根据 follow-up 保持静默；open Task 卡仍显示单赢家、progress、submission summary，Human 完成验收，reload 后 Room 与 Task 状态完整恢复。

## 声明边界

- 这是 activation-scoped Room/因果 Thread reply，不是通用 Agent PAT、任意 Room RPC 或任意 mention API；
- Human Room Message 的默认 membership 投递与 mention 注意力语义由 [ADR-0015](./0015-room-membership-delivery-and-agent-activity.md) 定义；本 ADR 只约束 Agent 的 activation-scoped reply；
- 当前真实 Provider gate 尚未复跑该 endpoint，E2 使用 deterministic Fake CLI；
- 已授权 Raft Computer 可见 CLI 明确提供 `--send-draft`、`--anyway`、rehold count、`continueAnywaySuggested`、不发送以及十分钟本地 TTL；中央 Server 的建议阈值不可见。RAH 采用“原 hold 后第一次 rehold，即 `reholdCount=2`”的保守阈值，并以额外 `heldDraftId` 锁定 Kernel 草稿，必须标为本地安全适配，不能称为 Server 源码逐字复制；
- Agent-to-Agent follow-up 与 Thread subscription 已由本 ADR 的服务端派生规则收口；速率/配额、Artifact/Review 和 Human Inbox 仍由各自独立能力定义。
