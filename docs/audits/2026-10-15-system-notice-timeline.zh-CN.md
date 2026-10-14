# 频道系统消息与未读投影纠偏

依据为 [raft-source a98ae003](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，FSL-1.1-ALv2，沿用 owner 授权。官方文件保持逐文件哈希不变；本地组合及出处记录于 `frontends/raft/adoption.json`。

## 根因与边界

Loom 的 `human-activity-notices.ts` 已把成员加入、频道恢复及符合条件的提醒事件计入侧栏未读，但原产品使用 `message.list`，只能取得普通 Message。故只有恢复事件的频道有未读数字，打开却显示“频道还没有消息”；仅使用 RoomSession 的近期同步事件也不能修复历史分页和冷启动。

本批按冻结后端的“已复现缺陷／必要兼容修复”范围新增只读 `room.timeline`，不改变调度、激活、模型上下文、持久化数据或未读计数规则。它不是另一套消息账本：普通消息保留 Message ID，系统通知保留 Room Event ID，二者通过 discriminated union 明确区分。不会向 messages 表补写假消息，不向模型注入系统提示。

| 层                       | 单一职责与约束                                                                                                                                                          |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| protocol                 | `client-room-timeline.ts` 定义消息／通知联合类型、请求／响应与有界游标。通知只公开事件身份、Room、序号、时间、类型和显示文字，不暴露事件内部 payload。                  |
| kernel                   | `room-timeline.ts` 认证 Human 和 Room 成员后读取现有投影；与未读计数复用同一 notice SQL；顶层消息与通知统一按 Room seq 排序、分页。线程正文和运行诊断不进入频道时间线。 |
| application-service／SDK | 同一认证只读操作 `POST /v3/client/rooms/timeline`，不复制领域处理。原 `message.list` 保持原有语义。                                                                     |
| client-core              | `RoomTimelineSession` 独占展示窗口与分页位置，校验 Room、顺序、边界和无进展分页；读取不调用 activity.mark 或消费确认。RoomSession 继续拥有写入因果屏障，两者职责不同。  |
| 官方 UI 组合             | `ChannelTimeline.tsx` 接收展示数据，通知映射为原生 `messageType=system`，通过原生 MessageItem 呈现；不用普通聊天气泡冒充通知。                                          |

## 官方组件规则

完整链路为 `ChatPanel.tsx renderChannelItem` → `systemMessageGrouping.ts` → `ThreadPanelSystemMessageGroupDisclosure.tsx` → `SystemMessageGroupDisclosure.tsx` → raft-ui system-message recipes；单行由 `MessageItem.tsx` 的 isSystem 分支 → SystemMessage／Time／Content 渲染。

直接复用以上组件及分组算法、时间格式、Tooltip、折叠按钮与键盘行为。连续系统消息默认折叠为摘要，点击展开，单行无头像、紧凑居中；原始 px-3 包裹和文字／间距参数保留。普通消息继续使用原有日期分隔、分组和相邻消息间距。展开状态是组件内展示状态，布局变化交给原生 timeline anchor owner。

本地差异：通知文字来自持久事件的中文展示投影，不从聊天正文猜测事件；缺失成员身份显示“已离开的成员”。系统通知只读，不接入消息发送／编辑／转发动作。上游 Web 使用服务端计数，本批不能凭客户端源码证明 Raft 服务端所有事件的计数细节；保留 Loom 已验证的通知资格与计数，不宣称服务端完全等同。

## 验证与保留缺口

先红后绿：空频道已有持久未读却渲染空内容；Kernel 缺少统一时间线；client-core 缺少相应分页 owner。测试覆盖通知与普通消息混合翻页、只含通知、事件身份、跨 Room 拒绝、线程排除、非法游标／预算，以及双尺寸原生折叠、展开、刷新持久可见、不隐式标已读。

正式页面另以现有数据只读核验，不创建测试消息或模型运行。最终检查和部署证据见 [本批记录](../evo/evidence/2026-10-15-system-notices/summary.json)。

未解决：可见窗口自动已读、通知单独的“标记未读”定位（现有菜单仍定位普通顶层消息）、完整私聊侧栏、搜索整页组合、实例 inspector／Fork／Side 及任务／设置页面。系统通知不自动成为搜索命中或动态消息卡片。本批不代表这些功能已经对齐。
