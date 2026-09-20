# 频道设置成员资料逐层返回

用户明确此处是有遮罩的设置侧栏内导航，而非正文分栏。返回和X可以同时出现，
语义分别是退出资料层回到成员列表、关闭整个设置侧栏。

RoomSettingsDialog 已持有 profile/view 与正确的 onBack/onClose；不新增历史栈。
根因是 AgentDetailHeader 和 HumanProfilePane 在收到 onClose 时把返回点击和标签
覆盖成了关闭/返回聊天。现在标题栏分别使用 onBack、onClose；AgentDirectoryPane
在没有 onPanelBack 的普通聊天入口才回退 onClose，保留原分屏行为。
本地导航回调接线修复，不声称复制Raft发布代码，也不更改数据、权限、URL或业务状态。

新增 settings-profile-back 浏览器回归先复现点击返回后drawer消失，再通过：
1440/390内层返回恢复成员列表，重复进入/返回，桌面X关闭整个drawer，窄屏逐层回设置。
已有room-member-layout先复现Human相同问题，修正后继续验证。
活动分栏/刷新/关闭浏览器回归通过，明确区分两种呈现上下文。

验证结果：新增Agent返回测试、既有完整成员页面回归（含Human资料返回）、活动分栏回归
均通过。类型检查、正式构建及diff检查通过；全仓check仍被既有worker/message-present
登记阻断，format仍为既有5文件问题。

正式部署未完成：两次重启尝试均在停止进程之前被在途Activation守卫拒绝。
随后只读检查仍有3个running RunAttempt，未强制停止或取消Agent工作。
待部署构建为`57c8084cd13ea6ab688168adc730b949b5abbbeee1e0053708741faaa51e99fb`；
不能将隔离浏览器通过声称为正式页面已更新。

后续横条修复批次已成功完成备份和正式重启，本修复一同部署。
正式页面 1440px／390px 再次验证返回成员管理、桌面关闭抽屉均通过。
