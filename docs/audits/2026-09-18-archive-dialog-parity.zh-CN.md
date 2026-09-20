# 归档确认弹窗统一

## 2026-09-20 归档频道名下划线

按用户明确要求，服务器资料的 `.rah-settings-archive-name` 和正文
`.rah-rich-agent-reference` 共用 product.css 中的下划线规则：2px 粗细、
2px 偏移、`text-decoration-skip-ink: auto`，使字母下降笔画处自然避让。
复用已有正文实现，不从截图猜测新参数。移除 settings.css 的独立默认
细下划线规则；各自的字体、颜色、截断和点击导航保持原 owner。
来源延续本文件下述 Raft v1.16.0 与用户提供的对照截图，属于 RAH 样式复用。

`test-settings-archive-browser.mjs` 先复现 computed thickness 为 auto，
修复后 Chromium/WebKit 在 1440/390px 验证 underline、2px/2px 和 skip-ink，
同时沿原流程验证点击进入归档频道、恢复、未读及删除。隔离截图已检查；
未对正式频道执行归档、恢复或删除来验证样式。

本批类型检查、正式构建、sidebar-row/sq-btn 共享样式门禁及 diff 检查通过。
全量 check 仍被既有 `/v1/worker/message-present` 未登记阻断；全量格式
检查仍报告五个未修改的后台文件，本批文件格式通过。正式状态已备份，
服务使用构建 `46c6c504edd55e04` 重启。续验时服务进程已退出，已确认
原进程不存在后按原网络配置重新启动，并确认监听与新浏览器页面正常。
正式浏览器已确认加载共用 2px/skip-ink 规则；当前页面未列出归档频道，
因此正式卡片视觉验收未完成，卡片验证来自上述隔离浏览器，不冒充正式数据验收。

## 2026-09-19 中央弹窗响应式修复

同一下述 Raft bundle 的 `eo` 使用 `createPortal(..., document.body)`、
`fixed inset-0`、60% 黑色遮罩、`p-4` 和居中容器；`zs` 使用
384px 最大宽度及 24px 内边距。`C9e/S9e` 的 sm 按钮为 28px 高、
12px 字号、leading-none、10px 水平内边距。标题 18/28px、正文
14/22.75px、关闭按钮 32px 与 20px 图标沿用既有来源；修正确认按钮
行高为 12px，未按缩放截图猜测字号。

原中央弹窗嵌套在侧栏/正文中，响应式隐藏祖先时一同消失；另有移动端
样式把通用弹窗拉伸成全屏。共享 `ui-web/DialogLayer` 现在负责 body
portal，所有使用 rah-dialog-layer 的中央弹窗均采用该 owner。移除
通用窄屏全屏覆盖，视口保留 16px 留白，各窗口保留各自最大宽度，文本
换行、超高内容内部滚动。业务状态、确认回调与焦点/Escape 协议不变。

归档门禁先复现打开后缩至 320px 消失，再覆盖 320/600/1440px 连续
缩放、遮罩、文字/按钮规格、关闭/Escape。创建/运行时/重置表单增加同样
缩放回归。Chromium/WebKit 隔离浏览器验证不等同于 iPhone 实机或在线
Raft 同状态双边验收。

本批类型检查、正式构建、Chromium/WebKit 上述定向门禁和 diff 检查通过。
全量 check 仍因既有 `/v1/worker/message-present` 未登记失败；格式检查
仍报告五个后台文件。未改动这些文件。完整 Agent 控件门禁另有既有
390px header 私信按钮不可见断言失败；本批中央弹窗各 mode 定向通过。
正式实例已安全备份重启，构建身份 `6f391df07eaaa20b`；新浏览器正式页
1440/600/390/320px 连续缩放保持归档弹窗可见并可取消，未提交归档操作。

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

## 2026-09-19 归档管理入口

按照用户明确的归档态规则，频道设置隐藏头像旁添加入口、成员页底部
添加成员及公开/私密切换，保留删除和取消归档。服务器资料归档卡片在
取消归档右侧增加无文字删除图标，复用内部 `sq-btn`、`btn-red`、
`trash-2` 和频道删除确认窗口。红色沿用 Raft coral token，新增入口
属于本地产品扩展，不声称是上游逐字复制。

Web 页面负责显隐和确认，删除仍调用既有 `room.delete`，通过
`runRoomMutationAtLatest` 追平 Room sequence；Kernel 权限与删除事务
保持原有 owner。未引入新的删除业务路径。按钮提示位于上方，避免窄屏
右侧空间不足时气泡遮挡操作。

浏览器门禁先验证缺失入口失败，再覆盖归档设置/成员页显隐、图标引用、
红色、取消删除、确认删除、重载后消失及保持服务器资料页面。删除仅在
临时 Kernel 夹具执行，未删除用户正式频道。桌面与 390px 分别使用
Chromium 和 WebKit；这不等同于 iPhone 实机验收。

本次类型检查、定向浏览器门禁、正式构建及改动文件格式/diff 检查通过。
全仓 check 仍失败于既有 `/v1/worker/message-present` 未登记；全仓
format:check 仍报告五个后台调度文件，未改写它们。按用户既定授权完成
状态备份和正式重启，构建身份为 `ccf899ccad7788c4`，正式浏览器服务器
资料页正常加载。正式数据当前无归档频道，新增操作的完整验收来自隔离
Kernel 夹具；没有删除正式频道，没有提交或推送。

## 恢复后的导航、名称与未读

此节记录旧行为；当前“正文可见清除”的规则已被用户后续要求覆盖，见
[系统通知与恢复确认](2026-09-19-system-notices-and-restore-read.zh-CN.md)。

频道设置取消归档成功后关闭设置并切回聊天，失败继续保留设置和错误；
服务器资料入口仍留在服务器资料。归档/恢复系统通知优先使用授权成员的
displayName，缺省才使用 handle。按用户新增要求，HumanActivity 从既有
`room.unarchived` 事件和 Human read frontier 计算频道数字未读，包括
操作者自己恢复及没有普通消息的频道；不制造普通消息、不触发 Agent 投递。
Activity 消息卡片的分页范围保持不变，此扩展只影响频道导航未读。

共享可见阅读 hook 接受恢复通知的事件标识，只有正文实际可见才确认相应
Room sequence；读取旧消息不会清除后续恢复通知。手动标未读保留原普通
消息 head 校验，并包含最新恢复通知。成员 ACL、活动 Workspace、隐藏及
归档过滤仍由 Kernel owner 执行。单元/集成测试覆盖显示名、空频道、自己
恢复、重复命令、无权限、已读及再次标未读。浏览器覆盖成功关闭设置与
服务器资料恢复后的未读计数、进入正文后的清除。

本轮 27 项定向测试、Chromium/WebKit 门禁、类型检查与正式构建通过；
完整 check 与 format:check 仍为上文既有后台问题。备份后已重启正式
工作台，构建身份 `7928c810c701eab0`，新浏览器页面确认服务器资料正常
加载。本轮没有在正式数据中执行归档/恢复，没有 iPhone 实机验收。
