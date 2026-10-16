# 官方通知中心与受信网络入口

Owner 明确选择家庭局域网／Tailscale 免配对入口。沿用现有网关模式，未删除内部认证、成员隔离或执行围栏；这意味着入口可达设备拥有 Human 权限。具体绑定与证据见[本批记录](../evo/evidence/2026-10-16-notifications-trusted/summary.json)。

## 来源与接线

官方来源 https://github.com/botiverse/raft-source ，revision `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2，保留上游声明及 owner 复用授权。
完整组合链为 `LeftRail` footer／`Sidebar` 手机聊天 navbar → `NotificationTrigger` → `NotificationCenter` → `raft-ui` 通知、Popover、Tooltip primitives。
原文件未改；构建适配仅将 cloud collector 替换为空输入，以 Loom provider 的 notifications prop 接入。保留官方铃铛尺寸、未读状态、桌面 hover／click、手机点击、浮层、Escape及焦点返回。

本地 glue `SystemNotificationsProvider` 调用现有 `notification.list`／`notification.dismiss`；Kernel 是通知及关闭状态的唯一所有者。前端定时读回仅为投影，无第二份通知数据库。当前协议只提供计算机离线通知，不接订阅、账单或云账户提示，也不虚构已读接口。关闭丢失响应时放弃自动重发并读回显示；错误卡可重新读取，不重放写入。

## HTTP 兼容和检查

非 loopback HTTP 缺少 `crypto.randomUUID`，且官方 vendor 模块在初始化阶段使用它。Web 入口先安装基于 `crypto.getRandomValues` 的 RFC4122 UUID 实现，再动态载入应用；保留已有原生实现。样式仍静态导入，避免动态 CSS preload 把上游外部字体的 CSP 拒绝升级为整个应用启动失败。没有放宽 CSP。另修正既有线程活动 hook 接收 readonly 消息投影的类型签名，未改变运行行为。

源码检查103项、网络入口定向测试21项、前端类型检查与产品构建通过。临时 Core 的桌面1440×1000／手机390×844、DPR1，在实际非安全HTTP上下文验证官方通知开启、关闭丢响应只写一次、读回、Escape和焦点返回；通知数据为明确标记的fixture，没有调用付费模型。

正式服务检查活跃任务后备份2库／319文件，优雅重启，18张业务表关键投影不变。三个地址均在无浏览器配对cookie下读取API和真实页面，跨来源POST仍403；LAN额外验证手机尺寸。未替代物理跨设备测试，也未实际断开计算机制造离线通知。官方外部字体被既有CSP拦截仍为已知限制，本轮未声称所有字体加载完成。
