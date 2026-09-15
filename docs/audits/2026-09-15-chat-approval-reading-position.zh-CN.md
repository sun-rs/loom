# 聊天审批弹窗、头像反馈与 PWA 返回

## 依据与边界

- 用户本批明确要求：头像不位移；PWA 人员资料用左返回；聊天任务标识不定位正文；PWA 标识打开仅含审批信息的中央弹窗。
- Raft 授权源码：`raft-ui/vendor/raft` build `666bab60d8658d9e382e2c286ce1e423231e8f31`，来源 https://app.raft.build 。`index-WTraJnrd.js` 的 `mu` 保存 message/avatar 槽位；现有本地 TaskDetailMetadata/TaskDetailHistory 是此前 db/t9、npt/spt 的结构移植。未声称读取到 iOS 原生源文件，也不把截图估算称为源码参数。
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`：`packages/views/issues/components/issue-detail.tsx` 的 metadata dialog 有有界滚动，移动属性面板采用 Sheet；本批按用户要求采用中央弹窗，不复制其业务状态。上游原文件与许可未改动，无外部运行依赖。

## 实现所有权

- identity-interactions：头像只变暗，不 translate；Human/Agent 共用 PanelHeaderAction，PWA 左返回、桌面右关闭。
- ChatTaskApproval：聊天标识的独立展示状态，不修改 App 的 Room、Thread、focusedMessageId 或 URL。其下桌面讨论复用 ThreadPane、MessageSession、runRoomMutationAtLatest；PWA 不挂载讨论和 composer。轮询维持同一 MessageSession 历史窗口。
- 任务元数据仍复用 TaskDetailMetadata / TaskAssigneeControl / TaskDetailHistory，协议与权限无新通道。时间线有分页以及 240px/30dvh 的滚动上限。
- dialog-protocol：关闭时恢复键盘焦点但不滚动来源。
- 任务大页/频道任务卡片的完整详情、搜索深链与阅读消息列保持原有入口语义。

## 验证

`test:web:chat-approval` 首次运行复现桌面/PWA 头像按下移动 1px 和手机任务标识全屏问题；加入长正文与消息列 DOM 身份、滚动位置、轮询后位置不变断言，以及人员资料返回按钮尺寸与位置检查。旧任务展示、首次点击测试改为分别验证精简审批和任务卡片完整讨论，未删除原讨论提交检查。最终检查、正式重启和视觉证据在交付时记录。

## 交付证据

- `npm run check`、`npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。
- Chromium / WebKit：`test-chat-approval-browser.mjs` 1440×900 与 390×844 通过。证据目录分别为 `rah-chat-approval-Hc9tiV` / `rah-chat-approval-zYi5vX`（系统临时目录）。滚动测试先完成并重新读取 Fake 数据，再测审批，避免把测试准备阶段的发送滚动当作审批行为；WebKit 不支持自动化 mouse.wheel，使用触摸阅读事件与显式滚动设置准备起点，点击/返回仍使用真实浏览器命中。
- 任务展示、手机首次点击与列表选中态回归通过；title-only retry 首次并行运行遇到 stale-context 409，单独重跑通过，未放宽产品屏障或测试断言。任务详情完整 gate 在 Chrome 两个尺寸验证状态、负责人、持久回复、重载、权限失败恢复、延迟响应关闭和嵌套 Escape。
- badge 审批为临时 UI 状态；刷新保留原 Room 路由，重新点击 badge 后持久讨论仍可读取。全局/频道任务卡片详情深链重载行为保留。
- 正式工作台确认空闲后备份到 `/Users/sun/.rah/backups/pre-restart-6b4cebcc-5c6f-4bbb-864a-abab162d5275`，正常停止原实例并启动新进程 26479。正式构建为 `42617f2fc15339b4b6b2fd854a38a440a031fff0e4a5713dfcb7b26881c3cc21`，原 Tailnet、LAN 和 loopback 地址保留。
- 新浏览器在原 Tailnet 地址使用真实 Solars 数据完成两种尺寸的审批弹窗、关闭后位置、轮询后位置与人员资料返回验收；证据 `rah-chat-approval-formal-Nok0lG`。没有发送真实消息、修改真实任务或运行付费模型。
- 原 LAN 地址另以真实 Room Agent 头像和 DM 标题头像验证两种尺寸的资料页开启/返回，证据 `rah-chat-identity-formal-VJmGTB`。
- 尚未进行实体 iPhone 触控验收、Raft 同环境双边实机比较。本次不 commit / push。
