# 频道提及、私信未读与 Agent 工作条验证（2026-09-03）

## 裁决

本批把四种此前混用或显示条件不完整的信号分开：

1. 频道中当前 Human 被精确 `@` 时，频道行显示黄色 `@`；它与未读数量是两个独立标记。
2. Direct Room（私信）无论正文是否含 `@`，侧栏都只显示粉色未读数量，不显示频道 `@`。
3. Room 列表底部不是当前私信 Agent 的常驻“在线”栏，而是 Workspace 全局最近工作条。仅最近 90 秒内的
   `thinking` / `working` 会显示；`online`、`error`、`offline` 都不进入，切换频道或私信不会改变其来源。
4. 静音频道的普通未读不会被丢弃：它显示 Raft 的灰色低强调计数；静音只抑制普通 Activity 卡片，精确
   mention 仍可同时显示黄色 `@`。

正文中当前 Human 的 `@self` 黄色标识已由共享富文本 owner 实现，本批浏览器门禁再次读取其最终
computed style，没有建立第二套正文解析。

## Raft 来源事实

证据来自 2026-09-03 已登录 Raft 正式页的只读实操，以及冻结 bundle
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`（SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`）：

- `AQe`（UTF-16 offset 约 `2710574`）把 unread 分成 loud / quiet：已加入且未静音时是 loud；未加入或
  静音时仍保留 quiet。频道行组件 `met`（约 `2736299`）分别读取 `unreadCounts[channelId]` 与
  `mentionFlags[channelId]`。mention 是 16×16、1px 黑框、黄色底、10px 居中 `@`，并有 `ml-1` 的 4px
  间距；静音频道同时显示 16×16、内部 12px 的 `bell-off`。loud count 是粉底白字，quiet count 是
  10px mono、black/50、无框无底。
- 同一 bundle 的 Direct Room 行 `fet/get` 只读取 `unreadCounts[dmId]`，没有把 `mentionFlags`
  投影成黄色 `@`。
- 全局 activity store 的过滤函数 `CL` 只接受 `working` / `thinking`，`Hse=9e4` 把活动保留 90 秒；
  `qj/Tot` 取全局最新项并接入 Workspace 侧栏的 `bottomSlot`，不是当前 DM 的派生状态。
- 工作条样式为 48px 高、上下 8px、左右 12px、14px mono；桌面 cream，移动端白底。正式 Raft 页面在
  Agent 在线但无近期工作时没有工作条，所以它是有界执行反馈，不是第二个常驻在线状态。

Raft Server 源码未随 Web/Computer 发布；本批没有宣称复制其服务端 unread/mention 数据库。
RAH OS 后端继续由自己的 canonical Room/read-frontier owner 产生事实。

## RAH OS owner 与改动

- `packages/kernel/src/human-activity.ts` 由 ACL、Human read frontier 和共享 mention parser 生成 canonical
  `unreadCount + hasMention`。`summary.rooms` 保留静音频道的 unread/mention，Activity 列表继续按静音规则过滤；
  本批未从 `Message.body` 或 React 本地状态反推侧栏提醒。
- `apps/web/src/attention-presentation.ts` 的 `sidebarRoomAttention()` 按 Room kind/mute 做有界投影：
  channel 可同时有 mention/count，静音 count 为 quiet，direct 永远抑制 mention 且保持 loud；数量负值/小数
  不能进入 UI。
- `apps/web/src/components/sidebar-attention.tsx` 是两个侧栏 section 共用的唯一注意力组件 owner：
  `ChannelRowIdentity` 把静音图标留在频道名称 flex 内，`RoomAttentionBadges` 只把 mention/unread 放在右侧。
  生产 icon、颜色 token、尺寸和可访问名称均在该组件及共享 CSS 中定义。`bell-off` 使用从 Raft 当前 bundle
  提取并锁定摘要的原始 Lucide 路径，不重新绘制图标。
- `packages/protocol/src/agent-presence.ts` 与 Kernel presence owner 增加 `activityAt`，让客户端使用服务端活动
  时间而不是轮询到达时间。
- `WorkspaceActivityFooter` 只消费 canonical Agent presence；`latestWorkspaceActivity()` 跨全部 Agent 选取
  最新 thinking/working，并按 Raft 的 90 秒窗口收起，不从所选 DM、最新消息或 Provider 日志伪造状态。
- 外观偏好沿用现有设备本地 owner，默认开启；关闭“显示实时 Agent 状态”会隐藏整条工作条并停止状态动画，
  不删除持久 Activity 记录。

提醒 badge 在点击 Room 后的清除仍由 Human read frontier 决定；没有为提醒新增 timeout，也没有让黄色 `@`
代替粉色未读数。90 秒 timeout 只属于独立的瞬态 Agent 工作条。

## 自动与真实浏览器验证

- TDD 先以错误预期失败，再修复：频道 mention/count 独立、静音频道 quiet count、DM 抑制 mention 且保持
  loud、online/error 不显示工作条、thinking/working 的全局择新和 90 秒边界均通过。
- `npm run check`、`npm run format:check`、`npm run build:web:workbench`、`npm audit --omit=dev`
  与 `git diff --check` 均通过；真实付费 Provider 用例按仓库合同跳过。
- `npm run test:web:message-timeline` 使用本机真实 Chrome，在 `1440×1000` 和 `390×844` 验证：
  - channel：黄色 `@` 与粉色 `3` 同时存在；direct：只有粉色 `4`；
  - mention 外框 16×16、icon 10×10、中心偏差 0、1px 黑框、4px 圆角、左侧 `ml-1=4px`；
  - unread 为 `rgb(254, 125, 168)` 粉底、白字、10px、16px 高；
  - 静音频道同时显示 16×16 `bell-off`（内部 12×12、black/40）与灰色 quiet count；真实几何断言证明
    `bell-off.left - channelName.right = 4px`，没有把铃铛推到右侧 unread 容器；
  - thinking 工作条为 48px、`思考中…`、14px、8/12px padding、黄点呼吸；online 样本为 0 条；
    移动端背景为白色；
  - 把设备偏好切到 false 后，工作条 computed `display=none`；恢复 true 后继续参加其余移动端检查；
  - 当前 Human 正文 mention 保持黄色、1px 黑框、零圆角、12.25px。
- 正式 `http://127.0.0.1:4173` 冷载入 `/assets/index-DmO-0kg_.js`，真实指针进入 Kimi DM、打开
  Agent 资料页，再通过资料页的 `#Agent Council` 链接返回 Channel；在线 Kimi 页面
  `liveAgentActivityBarCount=0`，返回 Channel 后 Agent 资料面板为 0。Channel/DM 均无历史状态残留，页面中
  可见错误为 0。隔离 Chrome 门禁的 warning/error console 与 failed response 也均为 0。

## 正式发布与数据安全

发布前 Room/Runtime Registry/Web Push 三库 `quick_check=ok`，活动 Activation、RunAttempt、
RuntimeProcess、Placement、InputRequest、执行中 Task、取消/改派/SOS/Computer operation、Outbox
lease 与 held draft 均为 0。owner-private 一致性备份位于
`/Users/sun/.rah/backups/pre-sidebar-attention-20260903-YGomNi`，三份 SQLite 备份再次通过
`quick_check`。

最终重启后 PID `71766` 监听 `127.0.0.1:4173`，health 为 `online`，入口资源为
`/assets/index-DmO-0kg_.js` 与 `/assets/index-E2XFTepK.css`；28 个 Activation、28 个 RunAttempt、
28 个 RuntimeProcess、38 条 Message、
6 个 Room、2 个 Workspace 在重启前后不变。同期已存在的 Room 生命周期施工把正式 schema 推进到 42；
它不是本批 sidebar/presence 改动，也没有被本报告冒充成本批功能。

按三份备份上限清理了已被更新快照覆盖的
`/Users/sun/.rah/backups/pre-rich-reference-final-20260902-3RfArz`；该旧目录已删除，不可从回收站恢复，
当前仍保留三份可验证快照。

## 保留边界

- 首轮实现误把工作条绑定当前 DM、包含 error、使用 16px 水平 padding，并丢失静音频道普通未读。独立
  subagent 审计依据同一 Raft bundle 指出后，本批回到上游函数重新修正；报告不隐藏这次纠偏。
- 二次独立只读审计指出静音 `bell-off` 与 mention `ml-1` 两项可见 P2；补齐后，第三轮审计进一步发现铃铛
  虽尺寸正确却位于右侧容器，真实门禁先复现 `gapFromName=1280.09375px`。本批随后按 Raft DOM 层级移入
  `ChannelRowIdentity`，修复后为精确 4px。末次独立只读审计裁决 P0=0、P1=0。协议中的 `activityAt` 仍保持
  optional 以兼容旧客户端，但 Kernel 所有 thinking/working 路径都会提供，缺失时 Web 安全地不显示工作条。
- 正式数据当前没有未读/mention 样本，因此正式页只读验收证明“无伪 badge、online 无工作条、切换/刷新
  无错误”；非空 badge 的精确视觉由使用生产组件的隔离真实 Chrome 门禁证明。
- 未调用真实 Provider，不能把 thinking 工作条门禁扩大为本次真实模型执行证据。
- 这三项对齐不等于全站或 Raft 所有权限/异常态完成。
