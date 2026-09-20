# 消息列提及误订阅全部成员修复

## 根因和 owner

正式 Room 事件证据：Human 的消息正文仅 `@Claude`，但 `requestedRecipientIds`
含 5 个当前 Agent。`App.submitThreadReply` 错把 `availableAgentIds` 作为新增接收人；
`ChatTaskApproval.submit` 也把全部启用成员提交给 `thread.reply`。
Kernel 合法地把显式接收人记为关注者，因此属于客户端请求构造错误，不是头像计数错误。
截图消息列原有参与者已删除，首次读取为 0，所以隐藏组件符合此前用户要求。

保留既有 Raft 消息列关注模型：提及/发言形成关注，后续普通回复通知已有关注者；
不因普通回复自动添加整个频道。来源与许可沿用
[提及与关注控件证据](2026-09-14-mention-and-thread-follow-controls.zh-CN.md)
及现有 Kernel `agent-thread-subscriptions` 合同。此修复为 RAH glue，未移植上游代码。

两个前端入口复用 `mentionedRoomAgentIds`，在已授权、可用成员范围内解析正文；
账号大小写、代码/URL 排除和身份区分保持既有协议规则。
已有关注者的通知仍由 Kernel `listFollowingAgentThreadRecipients` 负责，前端不合并关注者。

## 复现与修复验证

`test-thread-mention-recipients-browser.mjs` 在隔离真实 Kernel 与 Fake CLI 中添加两个频道成员，
向新空消息列仅提及一人。修复前实际提交两个 ID，断言失败。
修复后验证显式提及只提交一个 ID、普通回复提交空新增名单、关注者保持一人、刷新持久化，
并覆盖任务审批框的回复请求。已有 `agent-thread-subscription.test.ts` 验证 Kernel 关注通知。

## 定向数据恢复

只处理截图对应消息列：读取原始事件及关注记录，确认四个额外 Agent 的关注时间与
误请求一致、来源为 mention，并且他们在该消息列没有发言。
操作前创建 SQLite 一致性备份及关注记录 JSON；通过现有已鉴权
`thread.follower.remove` 命令移除这四人，而非直接修改数据库。
结果仅 Claude 为当前关注者；历史消息、旧已删除 Agent 记录和已经发生的通知不改写。
首次无 Origin 的 API 检查被 CSRF 防护拒绝且未产生变更，随后通过同源浏览器请求完成。

最终部署和检查结果见后续记录。

## 交付验证

隔离浏览器两个发送入口、普通回复、刷新持久化通过；Kernel 关注订阅 3 项测试、
类型检查和正式构建通过。已备份并安全重启，正式构建为
`1d56e0702f806a408cb6e71e9ab1c4e7b708765108a3200d964ef98af5783469`。
正式页桌面 1440px／窄屏 390px 首次打开与刷新均显示 1 人，名单只有 Claude，
证明重启回填不会恢复被移除的误订阅。正式浏览器未发送消息。

全仓 `check` 仍停于既有 `/v1/worker/message-present` 未登记；`format:check`
仍为此前五个其他文件，非本次引入。本次文件格式及 `git diff --check` 通过。

## 关注者移除提示条

Raft 发布包 `web-index.js`（SHA256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`）
的 `G9` 使用 `timeout: 5e3`、`dismissible: false`；Toast viewport 在
hover/focus 时暂停计时。Multica `packages/ui/components/ui/sonner.tsx`
包装 Sonner，无此关注者专属几何规格。RAH 保留现有绿色提示样式，结构移植
5 秒展示计时及 hover/focus 暂停；内容宽度、左下角排列参考官方截图，非声称
逐字复制上游 CSS。后端 undoExpiresAt 仍是独立的撤销安全上限。

`scripts/test-thread-header-menu-browser.mjs` 增加按钮紧邻正文、悬停超过
5 秒仍保留、离开后自动消失的浏览器断言。修改前紧凑宽度断言失败。

## Composer 发送后的最新位置

消息列与任务审批共用 ThreadPane；其成功发送分支此前只清除草稿，未请求滚动。
新增浏览器回归在 18 条历史回复中滚离底部后发送，修改前距底部仍为 567px。
本次在成功返回且仍为同一 root message 时，重新激活既有 useTaskInitialScroll
的尾部定位；延迟消息加载与内容尺寸变化沿用该 owner 的观察机制，用户在正文
滚动或操作后释放定位。不引入新的历史缓存、滚动状态机或业务订阅。
频道与私聊保留 ChannelPane 既有发送成功 scrollToLatest 路径。

Raft 发布包的消息视图 scrollToBottom 会重新激活尾部跟随标志并清除旧锚点；
本次采用本地已有定位 owner 的接线修复，不声称复制 Raft 实现。检索 Multica
chat 视图没有可直接替换此 Room/Thread 定位 owner 的接口。
`test-composer-send-scroll-browser.mjs` 覆盖消息列、任务审批、频道、私聊的
发送后底部位置，并保留只提及单个 Agent 的接收人断言。

### 提示条定位纠正：页面底部居中

再次核对同一 Raft 发布包的 `zre → e4 → t4 → Bwt`：使用页面 Portal、
`placement: bottom-center`、默认 `strategy: fixed`；`Yu` 对应
`bottom-4 left-1/2 -translate-x-1/2`，viewport 宽度上限 24rem，屏幕两侧
各留 1rem。因此此前按消息列左下角排列的实现不符合页面级定位，现已替代。
Multica 的 Sonner 包装没有该关注者提示的独立定位，继续采用 Raft 依据。

RAH 复用 ui-web DialogLayer 的 body portal，固定视口底部 16px、水平居中，
最大宽度 384px；提示本身保持内容宽度和悬停／聚焦暂停的 5 秒计时。
三栏浏览器回归修改前中心 x=1224.77（视口宽 1440），修改后要求 x=720；
同时断言 body portal、底部 16px、390px 窄屏中心 x=195，避免面板布局影响定位。

### 直接移除、撤销恢复提示与按钮反馈

Raft 同版本 `G9` 的移除按钮直接执行移除请求；成功后 Toast action 调用恢复，
恢复成功再调用 `To.success(thread.followers.restored)`。`Bwt` 为成功提示提供
32px 可关闭 X；`MUe` 与 toast close 的 hover 为上移 1px、增加阴影，active
为偏移 1px 并去掉阴影。RAH 移除原二次确认入口，保留 pending 禁重复操作及
失败提示；撤销成功将提示替换为“已恢复 … 的关注。”，重新开始 5 秒计时，
支持关闭按钮。按钮样式为来源支撑的结构移植，使用本地阴影 token。

浏览器测试先以“仍出现确认对话框”失败；补充直接移除、撤销成功文案、两个
按钮悬停变换及 X 关闭断言，原取消确认测试改为直接移除失败的错误恢复测试。

本批验证：消息列菜单浏览器回归（含桌面／390px 定位、悬停阴影、撤销恢复、
关闭、计时暂停）及 typecheck 通过，正式 Web bundle 构建完成。
全仓 check 仍受 `/v1/worker/message-present` 未登记阻断；format:check
仍有既存的五个非本批文件问题，本批文件格式与 diff 检查通过。
正式重启的安全检查发现三个活动 Activation，未停止原服务；本批尚未部署，
不能将隔离浏览器通过描述为正式页面验收。

后续快速模式间距修复批次在活动任务结束后完成安全备份重启，包含本批关注者
提示修改；正式表单页面已验证，关注者移除／恢复仍以隔离浏览器证据为准，未为
验收修改真实关注关系。

### 从正文打开消息列时默认显示最新回复

初始定位此前仅在 hideHeader 的任务审批路径启用；普通消息列遗漏接线。
新浏览器断言从频道正文点击 thread-preview，18 条回复已加载后仍距底部 659px，
在实现修改前失败。修复复用既有 useTaskInitialScroll，仅无明确 focusedMessageId
且未打开内部搜索的普通消息列以 rootMessageId 激活初始尾部定位；精确消息跳转
不启用此默认定位。回归发现内部搜索仍会被尾部跟随干扰后，加入 searchOpen
互斥条件，复测搜索轮询和显式下一个结果定位。
保持既有 Mutation／Resize 处理迟到正文、媒体、composer 布局变化，以及用户
wheel／touch／pointer／keyboard 接管后释放跟随。没有替换 Raft 对照中已确认的
本地滚动 owner，没有新增历史缓存或异步队列。

`test-composer-send-scroll-browser.mjs` 新增桌面／390px 从正文实际点击消息列，
要求最新位置距底部小于 4px；同时继续回归四种 composer 发送对齐。
`test-scroll-ownership-browser.mjs` 覆盖搜索定位与用户滚动所有权。

本批最终验证：打开消息列／四类发送回归通过，滚动所有权回归 failures 为空，
typecheck、正式构建、本批格式及 diff 检查通过。全仓 check／format:check
仍为此前接口登记和五个无关文件格式阻断。持久状态备份及安全重启完成；
正式新页面桌面／390px 初始底部位置小于 4px、重载检查通过，无测试消息发送。
