# 本地系统通知（2026-10-23）

Owner 已授权本地优先通知。页面运行期间无需浏览器厂商推送服务；关闭或挂起后的后台唤醒仍使用可选 Web Push。该区别是传输机制，不改变通知资格或业务事实。

## 所有者与流程

- Kernel `HumanNotifications.local` 在认证 Human 与工作区成员权限内，以 Room 事件作为唯一来源，复用 `RoomWebPushProjection` 的提及、私信、关注与静音规则。
- SDK `notification.local` 对应 POST `/v3/client/notifications/local`，只读；不修改未读、Inbox、Activation 或通知已读状态。
- 前端每5秒读取，单次最多100事件，后续页间隔100ms，请求10秒超时。Web Locks 限制每个浏览器／工作区一个读取者；不支持时由共享 Service Worker 去重展示。
- 首次从当前事件头开始；重连从本机保存的标量传输位置继续，仅展示最近15分钟通知。传输位置不是业务消费凭据，不存聊天正文。
- Service Worker 同时接收本地 message 与原 Web Push，沿用当前页面抑制和点击导航；Cache 仅保留最近500个通知ID回执，不保留正文。显示与回执不能跨系统原子提交，因此崩溃边界不承诺 exactly-once。

## UI 与来源

复用锁定官方 `LoomNotificationStatus` 生成组件的结构及样式，生成器增加文案参数，官方源文件不改。统一为一张系统通知卡片；高级折叠项复用官方静音表单的 Checkbox／文本层级，原生 details 为 Loom 薄组合，默认收起。记录见 `frontends/raft/loom/ui-contract.json`。本地显示复用现有官方来源的 Service Worker 注册／激活逻辑，不调用 PushManager.subscribe 或外部请求。

## 使用与边界

设置 → 通知 → 启用通知 → 发送测试通知。启用只开启本地；测试只走本地。停用同时停用当前浏览器后台订阅，后台停用未确认时不将总开关报为已关闭。高级 → 页面关闭后仍接收通知，可选开启外部推送；新设备默认关闭，已有订阅不擅自删除。其他浏览器订阅不受此开关影响。授权和开关按当前浏览器来源／工作区保存。

LAN 的系统通知仍需可信 HTTPS，这是浏览器安全上下文限制，和是否经外网无关；localhost 可用 HTTP。页面关闭、系统休眠或浏览器冻结标签页时本地轮询不保证运行。手机真机后台未验收。成功提示只证明浏览器接受 showNotification，横幅仍受系统通知设置影响。

[定向检查、真实页面和部署证据](../evo/evidence/2026-10-23-local-notifications/summary.json)。不包含付费CLI测试。

## 已有浏览器升级（2026-10-23 修复）

Firefox 现场确认旧活动脚本不含本地 message 处理器，页面等待回信超时。HTTP/HTTPS 网关原本只为 `sw.js` 设置重新验证，遗漏了 `loom-push-sw.js`，后者错误返回一年 immutable。两网关现均返回 no-cache；注册使用固定协议地址 `loom-push-sw.js?protocol=local-v1` 绕开已经存在的旧缓存，保持根作用域和原订阅。注册后显式 update 并等待激活，更新失败不发送。单独修改缓存头和调用 update 在该现场未恢复，因此版本地址是必要迁移步骤。点击导航只接受同源旧地址或当前协议地址。工作进程回信区分读取／显示／保存阶段；来源拒绝立即报错，测试仍不自动重发。

## 关闭页面的官方链路复核（2026-10-23）

Owner 要求优先复用 Raft 的闭页通知。核对锁定来源
`frontends/raft/packages/web/public/sw.js`（Raft source db5e399）后，现有
`loom/push-worker.js` 已保留其 push → waitUntil → showNotification，以及
notificationclick → 匹配窗口／openWindow 的处理结构。服务端由
`WebPushOutboxDispatcher` 独立消费持久 Outbox；不依赖页面轮询存活。
这里属于带 Loom 目标协议、权限和去重适配的结构移植，不是逐字复制整个官方服务端。
不引入 Raft 中央账户，也不删除已有超时与失败结果未知保护。

入口保持“通知 → 高级 → 页面关闭后仍接收通知”。主卡片的测试只测本地显示，
不能证明外部 Web Push 送达。启用后台后，本地与外部可能同时送达，由 Worker
通知 ID 去重；并非检测页面关闭后才发送外部推送。

本轮19项定向测试通过：Worker无页面接收、重新实例化后持久回执去重、
点击重新打开精确目标、显示失败不记成功，以及订阅和发送超时／Outbox租约回收。
测试使用模拟浏览器与传输，不代表真实浏览器后台送达。当前工具无法取得
Firefox窗口（cgWindowNotFound），闭页后的真实横幅及点击返回仍待验证；
不将历史 provider accepted 或页面内测试计作通过。本轮无产品代码改动，
无需部署或重启服务。

实际闭页验收：保持浏览器运行，关闭该来源全部 Loom 页面，再从后台发送一条
唯一测试通知；记录 provider 接受、系统横幅、点击后定位三项独立结果。
完全退出浏览器、系统休眠及手机后台限制另行记录，不承诺与关闭标签页等价。
