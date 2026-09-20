# 系统通知显示名、分组与恢复确认

## 当前合同

本次用户要求覆盖此前“正文可见即清除恢复未读”的约定：自动恢复跳转、
地址直达和刷新不确认恢复通知；点击聊天侧栏的对应频道才确认。当前频道
仍有未读时，这次点击保持正文打开，不同时取消选择；没有未读时仍可反选。

单一 owner 为 Kernel HumanActivity 的既有 `human_activity_frontiers`。
`activity.mark` 增加可选 `source`：`viewport` 自动阅读不得越过尚未确认的
首条 `room.unarchived`；`channel-list` 在同一受权 Room 中确认至最新恢复
事件（调用可传 throughSeq=0），不代替之后普通消息的可见阅读。没有 source
的既有显式 read/done/unread 语义不变。线程阅读不受频道恢复围栏影响。
确认使用单调持久游标，刷新、迟到的低序列阅读不会撤销；没有第二套客户端
未读存储，也不创建普通消息或 Agent 激活。可见阅读 hook 采用服务端实际
返回的 frontier，避免把被围栏截断的请求误记成完全已读。

通知作者/成员名经当前授权 Workspace identity projection 合并，优先
displayName，再回退 handle。历史事件保持原 actor/participant ID；不改写
历史文本或按同名 Agent 匹配。现有聊天系统通知中的人员字段包括归档、
恢复操作者和新增成员；提醒标题属于用户正文，不做字符串替换。

## 上游证据与移植边界

Raft v1.16.0：<https://app.raft.build/assets/index-CKeqacxz.js>，SHA-256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
授权及来源边界沿用 [reuse ledger](2026-08-29-raft-multica-reuse-ledger.zh-CN.md)。
分析文件 `/private/tmp/raft-20260916-audit/web-index.js` 的 `fpe` 按连续系统
消息分组，`Qot` 生成摘要，`ppe` 负责展开。上游为超过一条即分组；本地按
用户明确要求采用超过两条，日期分隔仍保留，不跨本地日期折叠。

结构移植 `ppe` 的居中摘要：上下 6px，按钮 4px/8px 内边距、6px gap、
12px 字号和图标、50% 黑色正文/35% 图标，hover 75% 黑色。aria-expanded
及原生键盘按钮；默认折叠、点击再次收起。展开集合归 ChatPane，稳定事件
ID 保留轮询和虚拟列表重挂载后的展开状态，切频道清空。沿用现有
MessageTimeline 测量/滚动 owner，不引入另一套虚拟列表。
这属于结构移植与 RAH glue，不是字节复制；原 bundle 仅供分析。
Multica 不替代此已有 Raft 分组合同；持久未读继续使用本地 Room owner。

## 验证

新增测试先复现显示名回退错误、三条未分组、viewport 清除恢复未读，再实现。
`chat-timeline-presentation.test.ts` 覆盖阈值及日期边界；
`global-discovery.test.ts` 覆盖持久恢复未读、ACL、后续普通消息和迟到确认。
`test-settings-archive-browser.mjs` 使用临时真实 Kernel 与 Fake provider，
覆盖设置恢复、服务器资料恢复、显示名、分组展开/收起、刷新和侧栏点击。
这不代表已在正式数据上归档/恢复，也不代表在线 Raft 同条件双边验收。

定向 30 项测试、类型检查、Chromium/WebKit 归档浏览器流程、频道反选
回归与正式构建通过；390/1440px 截图已检查。全仓 check 仍阻于既有
`/v1/worker/message-present` 未登记；format:check 报告五个未改动的
后台文件。Web 单元测试 447 通过、7 个既有静态断言失败，涉及旧报告问题
入口、头像、活动页 showMore、portal 和 reaction 样式源码匹配；未据此
宣称全仓绿色。

正式状态经 restart guard 检查、备份后重启，构建身份
`c543081aa14ec1ac`。新浏览器在正式 `latency-pair-0917` 看到 Hakase
归档/恢复显示名和默认“有 8 条系统消息”，展开、收起、刷新与窄屏截图
通过，无 pageerror。未修改正式频道归档状态；恢复未读的完整业务验证
来自隔离真实 Kernel。没有付费 CLI 测试、提交或推送。
