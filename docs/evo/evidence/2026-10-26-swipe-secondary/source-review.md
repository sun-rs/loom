# 动态滑动静音／取消关注（2026-10-26）

参照锁定 Web1.21.34 ThreadsInbox-CM-EY6gw.js 的 bn/Tt/Y/Gt；来源URL与摘要见 activity-swipe-manifest.json。按钮使用已锁定原生 dn recipe（官方72px动作槽、full-swipe时次要按钮收缩），沿用 Ht 处理器；页面参数与业务操作为显式结构移植。授权/notices沿用adoption.json，不宣称整段上游业务store复用。

取消关注：activity.list已经提供isFollowing，DiscoveryRow现传递这一已存在字段，只有明确true的消息列显示按钮。点击再读thread.followers，通过原有ThreadActivityClient写activity.follow，保留接受行的throughSeq；未知结果只读取，不重发。成功显示官方toast撤销，撤销重新读状态再关注。当前follow协议无关系版本；因此撤销不能区分另一客户端期间再次取消关注的意图（与上游布尔回设同类限制），不声称版本化恢复。

静音：使用useSearchEntities原先已有sidebar.get结果决定是否展示，没有增加列表请求；仅channel行提供。点击重新读取偏好，用ManagementClient/sidebar.patch/WriteIntentSlot及expectedVersion提交，结果未知保留原请求并显示已有OperationStatus核实入口。成功撤销必须仍是本次回执版本，拒绝覆盖其他偏好更新；这比上游重新切换最新布尔值更保守，保留Loom版本围栏。

不增加后端接口、模型调用、逐行轮询或第二业务store。读取和操作期间阻止重复手势；owner卸载后不从已结束的初始读取继续发起变更，toast也被关闭。已发请求仍以持久状态和既有核实路径为准。

验收包括假接口的版本保护、关注前沿、失败重读不重发、卸载阻断及页面绑定；真实浏览器只核对加载/布局/控制台，无真实用户静音或关注数据变更。真机触屏及真实撤销仍是明确未验收项。
