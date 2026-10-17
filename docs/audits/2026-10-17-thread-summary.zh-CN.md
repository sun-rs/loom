# 消息列摘要真实投影与首条未读定位

## 问题及来源

ChannelTimeline 原先把每条消息列的 participantIds 固定为空、unreadCount 固定为 0、firstUnreadMessageId 固定为 null；点击回调只传根消息 ID，丢弃官方 focusedMessageId。已有 ThreadWorkspace 的有界定位/可见已读逻辑并没有缺失，不能因此重建消息列。

官方来源仍为 [Raft a98ae003246a0360872a77d76dec2fccd0347ef7](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，FSL-1.1-ALv2，沿用 owner 授权。完整链为 ChannelTimeline → 官方 MessageItem.threadSummary → ThreadRepliesBadge → handleOpenThreadReplies.focusedMessageId → Loom 路由 → 原生 ThreadPanel 的有界消息窗。官方 ThreadRepliesBadge 只显示回复数/未读数/草稿，不显示参与人头像；本批没有自编头像条。官方服务端 channelService 的 participants_by_threads 和 unread_by_threads 明确区分实际回复作者、关注状态及读游标；本地使用既有 Loom 规则，自己的消息不算 Human 未读。

## 变更和所有者

- Protocol 的 Thread 增加可选 viewerSummary，仅 thread.list 返回。包含真实回复作者去重 ID、当前 Human 的未读回复数和首条未读消息 ID；创建/事件/持久化 Thread 投影不写入这份查看者信息。
- Kernel 在成员检查后，用现有 discovery_messages、human_activity_frontiers 与 human_thread_follows 做一次批量 SQL 只读聚合；前端不逐消息列请求正文、不下载全历史、不维护第二套已读计数。没有迁移、队列、激活、提示词或模型执行变化。
- 隐式关注沿用现有 Human followers 判定（创建者、根消息作者或实际回复作者），显式取消优先。取消关注不显示未读徽章，重新关注恢复尚未读过的回复；不改动态对显式提及的特殊呈现规则。频道和消息列使用各自读位置，自己的回复不增加未读。
- ChannelTimeline 把投影传入原生组件。聊天主路由及搜索/动态详情路由都保留 focusedMessageId，定位首条未读；已有 ThreadWorkspace/MessageSession 继续拥有有界窗口、蓝色高亮和可见区域已读。读状态更新仍走原先接口，无新增自动重试。

## 验证

TDD：原实现缺少 viewerSummary，参与人集合断言失败；实现后 Kernel 验证去重作者、两条他人未读、自身消息排除、频道已读不消费消息列、局部已读、取消/恢复关注及非成员拒绝。首版测试错误地用全 Room head 标记频道已读，被既有范围围栏拒绝；测试改为频道根消息序号，产品围栏不改。

定向 Kernel 协作/动态/新投影测试 30 项通过，前端消息列 client/activity/adaptation 检查通过，类型、产品构建、格式及 diff 通过。浏览器在 1440×1000、390×844/DPR1 的真实 Kernel/API/Gateway 隔离环境中构造 60 条回复：先读 5 条，摘要显示 55 条新回复，点击定位第 6 条且高亮；可见区域读取减少未读但不把 60 条全部消费；完整已读后重新打开频道不再显示未读文案。无真实或付费模型。

[证据](../evo/evidence/2026-10-17-thread-summary/summary.json)。本批只补这一条业务链，没有宣称通知/语言/更新日志空项或动态刷新恢复也已完成。
