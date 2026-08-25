# ADR-0002：Daemon-first、多客户端共用一个业务协议

- 状态：Accepted
- 日期：2026-08-25

## 背景

RAH OS 需要同时支持 Mac 浏览器、Mac App、iOS PWA 和未来原生客户端，并在 Mac 上运行多个 coding CLI。若把 Kernel 或 AgentHost 放入某个窗口/renderer 生命周期，关闭界面就会中断工作；若为 Electron IPC 与 Web HTTP 分别实现业务逻辑，又会产生第二套状态 owner。

## 决策

- Room Kernel service 与 AgentHost daemon 是独立于 UI 的逻辑组件。
- 所有客户端通过同一个版本化 application protocol 使用 Room command、sync 和 hint。
- Web UI 保持浏览器安全；桌面原生能力只经过窄 DesktopBridge。
- 本地单进程部署不取消 package/owner 边界。
- 产品按 Web-first → Mac App + iOS PWA → 有证据后再决定 iOS App 的顺序演进。
- 可信局域网可以简化 transport 部署，不能取消 authenticated actor、ACL 和审计。

## 后果

优点：

- 前端形态不再决定 Kernel/AgentHost 架构；
- App 关闭、刷新或崩溃不影响 durable work；
- Web/PWA/Desktop 共用 UI 和测试；
- 未来远程 Kernel、多 Host 和原生 iOS 不需要迁移业务状态。

代价：

- 需要明确的 daemon 安装、版本协商、健康检查和升级协议；
- 本地浏览器连接 daemon 仍需认证、Origin 和配对设计；
- desktop bridge 不能成为方便但失控的任意本机 API。

## 禁止事项

- 不在 renderer、浏览器 local storage 或 App state 中创建第二套 Task/Inbox truth。
- 不让 Electron IPC、WebSocket 或 push notification 成为业务 owner。
- 不因当前局域网可信而允许客户端指定 actor 或执行任意 shell。
- 不在缺乏真实需求和指标前维护独立原生 iOS 业务实现。
