# Client、Daemon 与部署边界

状态：本机 daemon core 已有独立 composition/CLI entrypoint、严格配置、Host generation fencing、deadline、Outbox wake、Worker delivery/Task/InputRequest command，以及 collaboration P2/P3 versioned loopback Human API；Workspace Agent 创建、版本化配置、启用/停用/删除已经打通 Kernel→Human API→Web→冻结运行上下文→真实子进程，并通过 daemon restart 与 desktop/mobile browser gate。ADR-0017 另提供持久化 production Web build、server-side Human session 与重启恢复入口。运行中 drain、skill/memory、Artifact/Review workflow、正式 LAN pairing/hint、launchd/install/signing、Keychain 与 supervisor artifact GC 尚未实现。

## 1. 产品形态不改变核心 owner

RAH OS 的客户端可以是 Mac 浏览器、安装式 PWA、Mac App、iOS PWA 或未来 iOS App。它们都是 Room client，不拥有业务状态。只要要在一台 Mac 上运行 Codex、Claude Code、Kimi、OpenCode、Git 或 worktree，就需要独立于界面生命周期的后台 AgentHost。

```text
Mac App / Browser / iOS PWA / future iOS App
                       |
                Room Client API
                       |
                 Room Kernel service
                       |
               durable Activation
                       |
             Mac AgentHost daemon
                       |
       Codex / Claude / Kimi / OpenCode
```

关闭窗口、浏览器休眠、PWA 被系统回收或客户端升级，都不能终止已经存在的 Task、Activation 或 RunAttempt。

## 2. 两个逻辑 daemon

| 组件                | 唯一职责                                                             | 不得拥有                                     |
| ------------------- | -------------------------------------------------------------------- | -------------------------------------------- |
| Room Kernel service | Room ledger、ACL、Task、Inbox、Activation、Artifact、Review、Outbox  | CLI 进程、PTY、Provider transcript           |
| AgentHost daemon    | capacity、Activation lease、RuntimeProfile、进程/worktree/credential | Room/Task 的第二套状态机、凭输出推断业务状态 |

本地开发和单机版本可以把两者部署在一个 OS process 或一个安装包中，但 package、application service 和持久状态 owner 仍须分离。未来 Kernel 可迁移到局域网/云端，而 AgentHost 留在执行机器。

## 3. 客户端代码约束

共享 UI 必须是纯浏览器代码：

- 不直接导入 `fs`、`path`、`child_process`、Electron 或 Swift API；
- 不直接读写 Kernel SQLite；
- 不拼接任意 shell command；
- 不把 `localhost`、端口、Room server 地址写死在组件中；
- 不根据 `window.electron` 或 user-agent 猜测业务 capability；
- 页面刷新后从 snapshot/delta 恢复，不依赖内存 store 重建真相。

前端只依赖可注入的 client contract：

```ts
interface RahClient {
  capabilities(): Promise<ClientCapabilities>;
  syncRoom(input: SyncRoomInput): Promise<RoomDelta>;
  acknowledgeCursor(input: AcknowledgeCursorInput): Promise<void>;
  execute(input: RoomCommand): Promise<CommandResult>;
  subscribeHints(input: HintSubscription): AsyncIterable<RoomHint>;
}
```

建议实现 `HttpRahClient`、`DesktopRahClient` 和 `FakeRahClient`。Electron IPC、WKWebView message handler 或测试 fake 都只是 transport adapter；它们不能复制 command handler 或 projection。

当前 Human HTTP adapter（兼容类名 `ClientApplicationService`）已实现上述 contract 的 collaboration P2/P3 段：v1/v2 compatibility、v3 health/capabilities、Workspace/Room discovery/managed create、Agent catalog/onboarding/provision/get/manage、Room `sync/ack`、成员角色、Message/Thread、Task/InputRequest command/query。P3 gate 已覆盖 daemon restart 后同 consumer 从 durable cursor 恢复。它只依赖 `HumanApplicationPort`；嵌入式程序可跳过 HTTP 直接调用 `RahCore.human`。独立 typed `RahClient` package 已覆盖现有 v3 route，Web Room slice 使用 `client-core` 做 bounded catch-up、causal mutation barrier 与 ack-after-apply。Workspace/Room archive、Agent active-work drain、skill/memory、Inbox query/resolve、Artifact/Review、Run Inspector 与 `subscribeHints` 仍缺失，因此不能把这一 slice 称为完整 UI SDK。

## 4. 通信协议

统一使用三类通道：

1. command：HTTP/RPC 请求，要求 authenticated actor、idempotency key 和按需 `basedOnRoomSeq`；
2. sync：snapshot + ordered delta + client-owned continuation token/显式 ack；
3. hint：WebSocket/SSE/Web Push/native notification，只通知“可能有新状态”。

连接恢复流程固定为：

```text
connect/reconnect
  -> read server capabilities and API version
  -> sync from last acknowledged continuation
  -> reduce canonical snapshot/delta
  -> acknowledge durable receipt
  -> subscribe hints
```

WebSocket 在线不证明没有漏事件；hint 丢失时由 sync/reconciliation 恢复。Mac App 不得拥有一套只走 Electron IPC 的业务协议，Web/PWA 也不得拥有另一套 HTTP 业务协议。

在 `subscribeHints` 尚未实现时，Phase 4A Web 使用请求不重叠的 bounded reconciliation 作为可靠性 backstop：未追平时快速继续，追平后前台 5 秒、后台 15 秒，失败指数退避到 30 秒，页面重新可见时立即同步。该策略不承载业务 truth；未来 hint 到达后仍必须回到相同 sync path，polling 继续负责 hint 丢失恢复。

当前 HTTP API 的 collaboration surface 使用 `/v2/client`；原 `/v1/client` Task/InputRequest/sync/ack 与窄 health contract 保持兼容。数据 route 每次认证 principal PAT。sync/ack 还校验当前 credential/Room/consumer 实际收到的 cursor；service restart 不会推进 durable ack，客户端只需重新 sync。Worker `/v1/worker` 使用另一端口和短命 Activation bearer，不能被 Human client 复用。

## 5. Capability 与版本协商

客户端连接后先读取平台能力，而不是猜测运行环境：

```json
{
  "apiVersion": 1,
  "buildVersion": "0.1.0",
  "kernelSchemaVersion": 6,
  "protocolVersion": 1,
  "state": "online",
  "capabilities": {
    "cursorAcknowledge": true,
    "hints": false,
    "inputRequestRead": true,
    "inputRequestResolve": true,
    "roomSync": true,
    "taskRead": true,
    "taskWrite": true
  }
}
```

- API schema 有显式版本和兼容窗口；
- desktop shell、daemon 与 Web UI 可以独立升级；
- 不支持的能力明确降级，不显示一个含混的 `supported`；
- Host capability 来自注册和 probe，不来自 CLI 名称。

## 6. Daemon 生命周期

AgentHost 必须独立于窗口：

- App 关闭后继续处理已领取工作；
- Host 启动、重连及固定 interval 主动 reconciliation；
- crash 后依靠 lease expiry 恢复，不依靠 renderer 内存；
- 升级先停止领取新 Activation，再 drain/cancel/reap；
- UI 只展示 Host 心跳和状态，不能假装管理一个实际不存在的进程；
- Mac App 可负责安装、配对和唤起 daemon，但 App exit 不等于 daemon exit。

当前 `AgentHostDaemon` 已实现的窄边界：

- 在 owner-private 目录中以确定性 Unix socket 协调同一 Host 的本机单实例；live owner 拒绝第二次启动，残留 artifact 可清理后重新取得；
- `SIGINT`/`SIGTERM` 只转为内部 abort/drain，不把 signal 当作业务完成；
- drain 后不领取新的 Activation；已运行 Activation 继续续租到 terminal proof，并在完成后退出，不因窗口或 signal 粗暴取消；
- Host 状态按 `online -> draining -> offline` 发布；运行中续租不会把 `draining` 覆盖回 `online`；
- 无论 runner 正常返回或失败，最终都会释放本机 instance lock。

`@rah-os/daemon` 在 wrapper 之外补上了可执行 composition root：它统一拥有 Kernel/Worker/Runtime/AgentHost/Outbox publisher 的启动回滚和逆序关闭；compatibility v2/v3 保留单 participant lane，config v4 的静态 participant 列表必须是 Host credential 当前 scope 的子集，并可运行多 participant、多 immutable runtime profile。Workspace manager 后续创建的动态 Agent 由 Kernel 扩展同一 credential scope，无需 daemon 重启；重启时数据库 scope 仍是权威，静态 config 不会删除它。每次进程认证生成新的 instance generation，正常 offline 或超过 `hostStaleAfterMs` 后才能接管，旧 Host 与 Worker authority 随即被 fence。启动、恢复、取消和总 drain 都有显式 deadline。

本机 Outbox dispatcher 只消费 `activation.requested`，发布 content-free wake 以中断 Host poll wait；固定 reconciliation interval 仍是 100% hint loss 的恢复路径。独立进程 fixture 已验证关闭 UI 无关的 SIGTERM、Worker delivery 和 restart。

上面的三段状态是正常 signal shutdown。管理面撤销 Host credential 时，Kernel 会直接 fence credential 并把 Host 标记为 `offline`；该路径可以跳过 drain，进行中的 RunAttempt 若无法再写 terminal proof，将按既有 lease expiry → orphan/quarantine → recovery 规则对账，不能把 revoke 伪装成正常完成。

Unix socket 只是同一台机器上的启动协调，不是业务 fencing token，也不是跨机器分布式锁。Kernel 中的 daemon generation、Activation/RuntimeProcess lease 才保护业务 lane。当前 daemon compatibility config v2、single-profile config v3、placement-managed multi-profile config v4、Kernel schema fence、Client API v1/v2 health/capability handshake 与升级 drain deadline 已存在；但尚无 launchd plist、签名安装包、Keychain token loader、daemon control API 或 UI 兼容矩阵，因此仍不能称为可安装的 Mac 后台产品。

`npm run start:local-workbench` 是当前正式的本机 Web 入口：它不使用 Vite dev server，不删除状态，并以 loopback static gateway 持有 Human PAT。浏览器只得到随机 HttpOnly Strict session；gateway 同时执行 Host-header、cookie 与 mutation Origin 校验，再把 PAT 注入到 allowlisted Client API。关闭浏览器不会停止后台进程，终止工作台进程则优雅 drain；launchd 尚未接管前，用户仍需保持该进程运行。

## 7. 可信局域网部署

当前部署假设可以是可信局域网，这允许开发阶段使用私网 HTTP 和简化证书管理，但“网络可信”不等于“调用者身份可信”。以下边界仍不可取消：

- actor 来自认证 session/host credential，不接受客户端任意 `actorId`；
- 浏览器入口使用明确的 allowed origins，禁止 wildcard CORS；
- command 权限由 Room membership/role 检查；
- 当前 AgentHost credential 固定绑定 host，并由 Kernel 持久维护 Agent participant scope；Workspace manager 可以通过原子 provision 扩展 scope，但 AgentDefinition/capability 细粒度最小授权仍是下一层扩展；
- Kernel API 不提供接受任意 shell 字符串的通用 `/run`；
- 本机模式默认 bind loopback；局域网监听必须显式启用并显示实际地址；
- Room event、command actor、Host lease 和外部副作用保留审计记录。

公网、跨组织或不可信 Wi-Fi 部署另行增加 TLS、设备配对、credential rotation/revocation 和更强隔离；不得以未来增强为由跳过当前身份边界。

当前 daemon config 只接受 `127.0.0.1`，也没有发送 CORS header。ADR-0017 的同源 gateway 已完成 loopback 浏览器 token/Host/CSRF 边界，但刻意不开放 LAN。局域网版仍必须加入设备 pairing、TLS、明确 allowed origins 和 credential rotation/revocation；临时 Vite `:lan` fixture 不得作为正式入口。

## 8. Mac App 适配约束

正式方向是共享 Web UI + thin desktop shell + 独立 daemon：

- desktop shell 只提供安装/升级、窗口、菜单栏、Keychain、文件选择、通知和 daemon control；
- privileged capability 通过窄的 `DesktopBridge` 暴露，renderer 默认无 Node 权限；
- worktree 和 CLI 执行发生在 AgentHost，不在 renderer；
- 初期优先签名、公证的直接分发，是否进入 Mac App Store 以后由 sandbox/CLI 兼容实验决定；
- UI 组件同时在普通浏览器测试，防止无意依赖桌面环境。

当前 TypeScript/Node 路线可先评估 Electron；选择 Electron、Tauri 或原生壳不改变上述协议。框架决策应在 AgentHost API 稳定后以启动耗时、内存、签名、公证、自动升级、PTY 和 child-process conformance 作比较。

## 9. iOS 边界与阶段路线

iOS PWA 和未来原生 iOS App 都是远程 Room client，不承担 coding CLI runtime。

1. 先完成响应式 Web UI；
2. 在 Mac 浏览器与 iOS Home Screen PWA 验证 Room/Task/Inbox/Review；
3. 增加 Mac App，包装同一 Web UI 并管理本机 daemon；
4. 只有在 PWA 无法满足原生后台、Share Extension、MDM、深度文件/相机/语音或离线数据库需求时，再立 iOS App ADR。

Web Push/native push 都只是 hint；用户点击或客户端恢复后必须执行 Room sync。

## 10. 验收门禁

- 关闭全部 UI 后，Host 仍能完成/恢复 Activation；
- 同一 UI bundle 可在普通浏览器和 desktop shell 运行；
- Web、desktop、PWA 对同一 command 产生相同 domain event；
- 断开 WebSocket、休眠和丢 hint 后，客户端从已确认 continuation 无丢失恢复；
- daemon 与 UI 版本不一致时明确协商或拒绝，不静默误解 schema；
- 浏览器不能冒充另一个 participant，也不能提交任意 shell；
- 本机、局域网和远端拓扑不改变 Room/Task owner。
