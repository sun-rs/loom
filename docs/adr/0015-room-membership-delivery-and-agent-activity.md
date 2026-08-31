# ADR-0015：Room membership 投递与 Agent activity

状态：Accepted（真实 daemon + 双 Fake CLI + desktop/mobile browser E2，2026-08-27）

## 背景

Raft 的 channel membership 是消息投递范围；`@mention` 是注意力信号，不是收件人过滤器。若 RAH OS 让用户在每条普通消息前重复勾选 Agent，会把长期 Room 协作关系降级成临时 recipient list，也会产生“Agent 已在 Room 中却没有收到消息”的隐性失败。

Kernel 原有 `postMessage` 是支持显式 recipients 的低层协作原语，仍适合派生事件和受控内部调用；它不应直接成为 Human 产品端口，否则 transport/UI 可以绕过 Room 产品语义。

## 决策

1. Human Application Port 只暴露 `postRoomMessage`。服务端从 canonical Room membership 派生全部 Agent recipients，默认 reason 为 `room_policy`。
2. Human request 中的 recipients 只能覆盖已加入 Room 的 Agent，并只用于 `mention` 等注意力原因；它不能缩小 membership 投递集合。
3. 普通聊天不显示逐消息 Agent 复选框。composer 展示 Room Agents 与可观察状态；`@Handle` 只改变对应 Agent 的 attention reason。Task 模式继续使用协议允许的单一 assignee 或全部 Room Agents 开放竞争。
4. Agent 状态由 canonical `Activation` 与 `RunAttempt` 推导为 `idle / waking / working / error`。Provider stdout、JSONL、思考文本与 session 状态不参与判定。
5. Human 查询只能读取当前 Room 已加入 Agent 的活动状态；Transport 通过窄 `HumanApplicationPort` 调用，不能读取任意 Host/Run 管理数据。
6. 浏览器测试可由 loopback-only 开发代理代签一次性 Human PAT；Token 不进入页面、URL、Local Storage 或测试输出。生产构建未配置该代理时仍要求正常认证。

## 证据

- Kernel test 证明无显式 mention 的 Human Room Message 唤醒全部成员 Agent；单一 mention 只提升该 Agent reason，不过滤其他成员。
- Kernel/API/SDK contract test 证明 activity 状态来自 Activation/RunAttempt，并受 Room membership 权限约束。
- 真实浏览器 gate 证明：初始 Alice 收到 Human Message 并回复；Human 在 Agent 页把 Kimi 加入 Room 后，包含 `@Kimi` 的下一条 Message 同时得到 Alice 与 Kimi 回复。
- 390×844 gate 证明 Rooms 抽屉、当前 Room 选择、Chat/Task/Agents 底部导航可用；重复选择当前 Room 不清空 projection。
- 同一 gate 证明开放 Task 产生一个 winner、进入 submitted，Human complete 后进入 completed，重载恢复消息、成员和 Task。

## 边界

2026-08-31 补充：[头像 presence 设计](../product/2026-08-31-agent-presence-closure.zh-CN.md)新增独立、只读、无内容的 `agent.presence.list`。上文第4–5项仍约束 Room 业务 activity；头像的在线/思考/工具/错误观察不再冒充该业务状态。它仅对 Human 可见的 Workspace Agent catalog 输出活动枚举与安全原因，不返回不可访问 Room 的身份或诊断内容；Host generation、lease 与进程终止事实覆盖历史轨迹。Provider 结构化事件只细分活进程的可观察状态，不改变 Task、Inbox 或 Activation。前台每秒对账、后台15秒降频，断线/未知不能以已安装 CLI 伪装在线。

- membership delivery 不代表每个 Agent 都必须对每条消息生成文本回复；是否回复由 Agent policy 决定，但每个成员都会获得 durable Inbox/Activation。
- Agent reply 仍按 [ADR-0014](./0014-activation-scoped-agent-room-reply.md) 使用 activation-scoped 窄命令，不产生 reply loop。
- `idle` 仅表示当前没有 queued/leased/quarantined Activation，不证明 Provider 在线；Runtime inventory、Host health 与 Agent activity 是三个不同观察面。
- content-free hint、Human Inbox/Activity 聚合、生产 pairing/Keychain 和真实多 CLI reply certification 仍是后续能力。
