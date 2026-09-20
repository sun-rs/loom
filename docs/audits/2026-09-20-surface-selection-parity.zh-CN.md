# 大页选择记忆、窄屏主内容与成员列表

来源：2026-09-20 重新读取 Raft production HTML，仍为 release/v1.16.0，
commit `ba2a1dbac175595f28dfe1c09e4df2556d59ac0c`。发布脚本
`https://app.raft.build/assets/index-CKeqacxz.js` SHA-256：
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
原始公开 bundle 只用于分析；采用参数与行为结构，非字节复制。沿用既有
Raft/Multica reuse ledger 的 provenance，Multica runtime 实现不涉及此导航界面。

Raft `lx`（约 offset 3500853）普通行 text-sm/font-medium，选中 font-bold；
成员渲染 `ou`（3542460 附近）名称 text-sm、最多 70%，描述 text-xs/text-black/40、
基线排列 gap-1；行双击调用私信打开动作。RAH 成员与私信行复用
chat-surface.css 的 14px/20px 名称、12px/16px 描述及 sans 字体。
删除成员列表独立 13px 名称、10px mono 描述。未读加粗使用 canonical
activity summary 的 unreadCount，与原数字标识消费同一投影。

本批采用用户确认的主从视图规则：窄屏有已选内容显示右侧，否则显示列表。
Room 空选择继续用 `?surface=room`，缩窄后打开列表。成员默认选择第一个
可用 Agent；已打开的 Agent、人类资料、关系图在窄屏展示详情。移动端返回
列表保留当前成员身份，桌面恢复后仍选中；返回列表不是删除选择记忆。

导航偏好唯一 owner 为 apps/web/workspace-switcher-state.ts。沿用 Human/
Workspace 隔离的现有 key，为 room/agents 各保留最后 URL；其他大页不会覆盖。
URL 仍拥有当前页面与浏览器历史。记忆只存导航标识，不存消息或业务投影。
成员页路由和聊天内临时资料 peek 分离，peek 不写成员页记忆。
成员行双击复用 onOpenDirectRoom → room.direct.open，沿用 Kernel 私信唯一性、
取消 hiddenDms 及原有并发请求合并；不按名称创建第二个 Room。

验证：频道反选浏览器测试先复现缩窄只显示空正文；成员测试先复现 13px，
关系图 unit 先复现 mobile detail=false。Chromium/WebKit 覆盖页面往返、设置
刷新、成员与关系图/人类资料、关闭私信再双击打开、字体与窄屏；归档门禁
用真实 Kernel 恢复事件验证未选中频道的数字与加粗、点击清除。
真实 Raft 页面已读取；未完成同视口双边响应式全流程，不宣称双边验收。
无真实付费 CLI 执行，浏览器数据来自临时真实 Kernel 与 Fake CLI。

检查：类型检查、正式 Web 构建、13 个路由/偏好 unit、Chromium/WebKit
大页门禁、Chromium/WebKit 频道反选门禁、Chromium 归档未读门禁通过。
私信门禁写入隔离测试消息，关闭后双击重开仍为同一 URL 且原消息可见。
sidebar-row/sq-btn 浏览器规格门禁及 catalog 重新生成通过；规格同步登记
新的选中/未读字重，不扩大例外预算。全量 check 到既有未登记
`/v1/worker/message-present` 失败；format:check 仍报告五个未修改后台文件。

正式状态经 restart guard 检查和备份后重启；构建 `8d9bd46b2ebdde30`，
Web build `562ad2f63ed04615d57fed902ceb308cf2d896d4fce81de893b6ec75c91f4eea`。
新浏览器真实数据验证 1440→390px：成员默认 Claude 资料继续展示，频道
空选择变为完整聊天列表；截图已检查。正式页面无发送、关闭/删除私信操作；
关闭重开和测试消息保留验证仅在隔离状态进行。没有提交或推送代码。

## 关闭私信重新打开的侧栏延迟修复

2026-09-20 发现：Kernel 的 `room.direct.open` 已在同一事务内通过
`humanSidebar.revealDirect` 取消 hiddenDms；App 只刷新 Room 并导航，
SidebarPreferencesProvider 的已确认快照则等待 5 秒轮询，导致正文与列表不同步。
本批由既有侧栏偏好 owner 暴露即时刷新入口；共享 openDirectRoom 动作在命令
成功后读取权威偏好，再完成导航。资料页私信按钮与成员头像双击共用该路径。
不添加客户端私信、隐藏状态副本或第二次 sidebar.patch。既有轮询保留作恢复，
强制刷新可与旧读取并行，版本检查阻止旧响应覆盖更新结果，Workspace世代检查
仍阻止跨空间应用。读取失败保留已确认快照及可见错误，仍可通过轮询恢复。

浏览器回归将 5 秒轮询延长为60秒，先复现关闭私信重开后正文出现但条目在1秒内
不存在；修复后 Chromium/WebKit 均通过。额外挂起打开前的旧 sidebar.get，
待成功重开并显示条目后释放，验证旧响应不会再次隐藏条目。测试继续验证同一URL、
历史消息保留及桌面/390px导航。此为本地客户端协调修复，源行为沿用上文 Raft
成员双击私信基线，不声称采用其内部缓存实现。

本修复类型检查、正式构建和diff检查通过；全仓库check及format检查仍分别停在
既有message-present未登记、5个未改文件格式问题。正式工作台经活动保护检查、
备份与优雅重启，当前构建为
`31a8954c203c9f4350c98cb4033fb14a80ad3cfc39b857a1101e6046532392c4`。
新浏览器验证真实成员列表与资料页正常渲染且无pageerror，截图已检查。
关闭/重新打开及延迟响应场景在临时真实Kernel、Fake CLI上验证，未变更正式用户
的私信开关或发送消息，未运行付费CLI；不将正式页面读取称为完整业务验收。

## 成员辅助文字与完整聊天列表选择记忆

同一 Raft 发布源的 `lx` 使用 text-sm/font-medium（14px/20px、500；选中700）；
`Vg` 使用 text-xs/font-bold/tracking-widest（12px/16px、700、0.1em），继承
font-display，仅计数 span 指定 font-mono、tracking-normal。人类行的youSuffix
嵌在text-sm姓名span内，仅添加text-black/40和ml-1，并非12px描述。
本批据此修正关系图、AGENT/人类分区标题与计数、自身标识，保留共享成员名称与
描述已有规格。字体映射使用维护中的sans/mono变量，不修改全局字体。

选择记忆此前仅保存surface=room，遗漏同属聊天列表的saved，以及窄屏列表的
search/activity。现由workspace-switcher-state现有owner将这四种入口归入room
记忆槽，agents保持独立；桌面聊天入口和移动主页均恢复记住的实际surface。
不存消息或业务状态，不让聊天侧栏资料peek覆盖成员路由。无效值、人类与Workspace
隔离保持原有约束。

TDD先复现saved回忆undefined及关系图字重400，修复后6项导航偏好单测通过。
Chromium/WebKit验证标题字号/字重/字距、自身标识字号，以及已保存→设置→刷新→
聊天仍选中已保存；继续覆盖成员资料、频道/私信和窄屏行为。Chromium首轮在后续
旧私信历史消息同步处超时，完整复跑通过；WebKit首轮通过。组件规格/目录同步、
类型检查、正式构建通过。全仓库check仍被既有message-present surface登记问题
阻断，format检查仍报告5个本批未改文件，未宣称全部检查通过。

正式工作台经活动保护、备份和优雅重启，当前构建
`062e7676cdff88ccc2789c035b7fa419b7ffa6f2c9b7ee94f887e55171e3b15b`。
新浏览器在真实成员页核对字体，实际执行已保存→设置→刷新→聊天恢复，检查截图；
390px下逐项验证saved/search/activity→设置→首页恢复对应入口。未修改正式消息或
Agent配置，未执行付费CLI。此为源码规格对齐与正式本地验证，非在线Raft双边验收。

## 聊天主导航被搜索／动态记忆劫持的修正

正式浏览器复现：进入 `?surface=activity`，点击主导航“聊天”，URL 仍停留在
activity。原因是偏好 owner 把独立的 search/activity 主导航也归入 CHAT_SURFACES，
返回聊天时再次恢复当前页面。这是本地记忆分类错误，不是按钮命中区域问题。
沿用本文既有 Raft 导航来源与单一偏好 owner，不新建导航状态机。

聊天记忆仅含 room（频道、私聊、空选择）及 saved；独立搜索／动态不覆盖它。
旧存储中 search/activity 目标在 recall 时视为无效，点击聊天后按正常房间选择恢复。
成员记忆与整个 Workspace 的最后位置存储保持原有作用域。

TDD 先确认搜索覆盖已选频道的断言失败，再收紧集合；7 项偏好单测通过。
新增 `scripts/test-chat-rail-return-browser.mjs`，用真实隔离 Kernel 检查从动态、搜索、
设置、成员返回 Room/Saved 与刷新恢复。Chromium 通过；正式构建、类型检查与 diff
检查通过。全仓 check 仍停在既有 message-present 登记缺失，format 仍有五个既有
wake/delivery 文件告警，本批未改写这些文件。

WebKit 同一门禁也通过。正式工作台通过 guard 与备份校验后优雅重启，备份 receipt
`pre-restart-794ccea6-71d7-4126-9d32-3372b8becd89`；Web build
`703d50409b57660b644da0a2ca24b82af6fd5d982cf260bc0df5eae9ba28c184`。
新进程监听正式端口，新的 Chromium 页面实点动态→聊天、搜索→聊天均成功，
`/tmp/rah-chat-rail-formal.png` 截图已检查。未发送消息、未启动付费 CLI、未提交推送。
