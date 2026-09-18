# 归档确认弹窗统一

Raft v1.16.0 静态来源：
`https://app.raft.build/assets/index-CKeqacxz.js`，SHA-256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
侧栏归档调用 `zs`，传入 archiveChannelTitle、archiveChannelMessage、
相同标题的确认文字和 bg-brutal-orange。`zs` 使用 max-w-sm（384px）、
p-6（24px）、mb-4 标题间距、mb-5 正文间距、text-lg 标题、text-sm
leading-relaxed 正文、gap-3 操作间距，以及右上角 20px X 图标。
原始 bundle 仅用于分析，不作为运行依赖。

根因：RAH 频道设置使用已有 Raft 确认框，而侧栏右键另用带标题分割线的
通用表单，缺关闭按钮且确认按钮为白色。现在两个入口共用
`RoomArchiveConfirmation`，沿用 `.rah-channel-confirmation` 已有源码参数。
标题为“归档频道”，正文明确成员保留历史读取、禁止写入、侧栏隐藏、可取消
归档；确认按钮为橙色“归档频道”。侧栏保留 pending、错误及重试，使用相同
关闭和 Escape 协议。归档命令、权限和版本围栏没有变更。

`scripts/test-settings-archive-browser.mjs` 先复现侧栏标题/几何失败，再确认
1440px、390px 的宽度、边距、标题、按钮色、关闭/Escape、无横向溢出；
截图已检查。真实隔离 Kernel 归档、设置页阅读/恢复、刷新后可写回归通过。
类型检查与正式 Web 构建通过；全仓检查仍被后台新增
`/v1/worker/message-present` 未登记阻断，后台文件格式检查未通过。
本批文件格式及 diff 检查通过。没有正式重启部署、iPhone 实机或在线 Raft
同状态双边验收；没有提交或推送。

## 归档阅读与恢复入口

同一 Raft 发布源码的 `message.chatPanel.archived` 分支使用 border-2、
bg-brutal-orange/30、px-1.5、py-1、11px bold、leading-none 标识；
`message.chatPanel.archivedNotice` 使用 border-t-2、orange/20、p-3、
gap-2、text-sm bold，按钮调用 `Nt(true)` 打开频道设置。
本地以已有 orange/ink token 结构移植这些参数，未复制执行上游 bundle。
系统记录的英文文案和图标来自用户提供的 Raft 截图；不是已核实的上游
服务端生成代码。上游来源及授权边界沿用仓库 Raft reuse ledger。

根因是前端未消费现有 `room.archived` / `room.unarchived` 事件，且只禁用
输入框，没有归档阅读状态。`chat-timeline-presentation.ts` 现在按 Room
sequence 投影这些事件，复用时间线、日期和系统通知展示；不写合成消息，
不更改 Kernel 事务或历史。ChannelHeader 展示标识；ChatPane 用提示栏
替代 composer，恢复链接受已有频道管理权限控制，只打开频道设置。
设置/服务器资料仍直接发送既有取消归档命令。

重复恢复门禁另发现：从归档列表打开后，右侧设置恢复仅 map 活动列表，
却从归档列表删除该频道，导致 activeRoom 丢失。恢复现改为活动列表 upsert，
归档从活动列表移除并进入归档列表，保持当前选择。门禁断言恢复后的频道
标题仍存在，再执行一次归档与服务器资料直接恢复，验证完整闭环。

新增投影测试先确认事件被遗漏，再验证两种事件、操作人及顺序。
浏览器门禁覆盖两种恢复入口、重载持久状态、桌面/390px、标识、通知与
恢复后可写。截图没有实机 iOS 安全区域或在线 Raft 双边验收含义。
本批没有实现系统消息折叠汇总；保持既有逐条系统通知 owner，未新增
第二套分组或滚动模型。正式部署仍受上述后台全仓门禁阻断。
