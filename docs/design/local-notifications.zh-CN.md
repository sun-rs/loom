# 本地系统通知（2026-10-23）

Owner 已授权本地优先通知。页面运行期间无需浏览器厂商推送服务；关闭或挂起后的后台唤醒仍使用可选 Web Push。该区别是传输机制，不改变通知资格或业务事实。

## 所有者与流程

- Kernel `HumanNotifications.local` 在认证 Human 与工作区成员权限内，以 Room 事件作为唯一来源，复用 `RoomWebPushProjection` 的提及、私信、关注与静音规则。
- SDK `notification.local` 对应 POST `/v3/client/notifications/local`，只读；不修改未读、Inbox、Activation 或通知已读状态。
- 前端每5秒读取，单次最多100事件，后续页间隔100ms，请求10秒超时。Web Locks 限制每个浏览器／工作区一个读取者；不支持时由共享 Service Worker 去重展示。
- 首次从当前事件头开始；重连从本机保存的标量传输位置继续，仅展示最近15分钟通知。传输位置不是业务消费凭据，不存聊天正文。
- Service Worker 同时接收本地 message 与原 Web Push，沿用当前页面抑制和点击导航；Cache 仅保留最近500个通知ID回执，不保留正文。显示与回执不能跨系统原子提交，因此崩溃边界不承诺 exactly-once。

## UI 与来源

复用锁定官方 `LoomNotificationStatus` 生成组件的结构及样式，生成器增加文案参数，官方源文件不改。本地卡片是 Loom 传输扩展；后台推送卡片保持现有配置。记录见 `frontends/raft/loom/ui-contract.json`。本地显示复用现有官方来源的 Service Worker 注册／激活逻辑，不调用 PushManager.subscribe 或外部请求。

## 使用与边界

设置 → 通知 → 启用本地通知 → 测试本地通知。仅本地使用时，可停用可选后台推送；已有其他浏览器的订阅不自动删除。授权和开关按当前浏览器来源／工作区保存。

LAN 的系统通知仍需可信 HTTPS，这是浏览器安全上下文限制，和是否经外网无关；localhost 可用 HTTP。页面关闭、系统休眠或浏览器冻结标签页时本地轮询不保证运行。手机真机后台未验收。成功提示只证明浏览器接受 showNotification，横幅仍受系统通知设置影响。

[定向检查、真实页面和部署证据](../evo/evidence/2026-10-23-local-notifications/summary.json)。不包含付费CLI测试。
