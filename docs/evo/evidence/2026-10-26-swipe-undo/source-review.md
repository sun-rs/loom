# 滑动完成的撤销提示（2026-10-26）

参照已锁定 Web1.21.34 ThreadsInbox-CM-EY6gw.js 的 Gt/f/p/_ 及 Wt。源URL/原始摘要见 activity-swipe-manifest.json；授权与 notices 沿用 adoption.json。本批是结构移植，未将改写的控制器标成原文复用。界面提示使用官方 raft-ui toast.success/action/onClose，未创建新的提示UI。

官方 done 撤销不是后端回滚：先隐藏一行、显示可撤销提示，关闭提示才提交；撤销则取消未提交动作。Gt 同时检查更新的活动序列，页面隐藏/退出时提交已接受的待办手势。Loom后端只有read/done/unread，不能将unread冒充done回滚。

ActivitySwipeUndo只拥有单个尚未提交的UI手势，不是业务状态或执行队列。新手势先结算上一项；旧toast回调凭token不能提交后来的动作。hook隐藏当前行，真正提交仍调用已有markActivity(row,'done')，使用接受手势时的throughSeq；新序列出现时取消手势。分页暂时不可见不等于新增事实。普通完成按钮与右键操作没有改为延迟提交。

页面visibilitychange/pagehide/unmount的结算是尽力提交；浏览器强制结束不能保证网络送达，重开仍以持久activity状态为准。不新增后台任务、重试、业务缓存或后端接口。真实触屏、系统级浏览器退出、滑动静音/取消关注仍不在本批完成声明内。

静音/取消关注核对：协议已有isFollowing，但当前DiscoveryRow未携带；取消关注可继续绑定现有ThreadActivityClient，必须保留未知状态重读及失败不重发。频道静音走频道偏好版本，不能把旧活动行当作最新偏好。两项滑动按钮本批未接，不宣称全套官方动作齐全。
