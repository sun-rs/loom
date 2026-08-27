# ADR-0013：Human Application Port 与 Transport 边界

状态：Accepted / narrow port implemented（2026-08-26）

## 背景

`@rah-os/core` 必须既能作为无网络的嵌入式 SDK 直接使用，也能被 daemon 托管后供浏览器、PWA 或桌面壳跨进程访问。如果把 HTTP route 称为“Human API”而不区分 use case 与 transport，容易形成两种错误：一是误以为 RAH OS 必须采用固定 server/client 部署；二是让 HTTP adapter 直接依赖整个 `RoomKernel`，从而获得 Host credential、Activation、Placement、Outbox 与 RuntimeProcess 等完全不属于 Human client 的能力。

未来前端还会拥有名为 `RahClient` 的客户端 SDK。它是远端调用方，不应与 Core 内的 Human use case 或 daemon 的 HTTP adapter 混为一谈。

## 决策

### 1. Core 是可直接使用的 library，不要求网络

Human use case 的唯一业务入口是 Kernel-owned `HumanApplicationPort`。`RahCore.open()` 暴露冻结的 `core.human` facade，嵌入式程序可以直接调用：

```text
embedded app
  -> RahCore.human
  -> RoomKernel transaction/projection/event
```

调用不会经过 JSON、HTTP、localhost 或 daemon，也不会复制另一套 command handler。

### 2. HTTP 只是同一 port 的可替换 adapter

daemon 部署使用：

```text
Browser/PWA/Mac shell
  -> future RahClient
  -> Human HTTP adapter v1/v2
  -> HumanApplicationPort
  -> RoomKernel
```

HTTP adapter 只拥有：

- route/version/method 与 body size；
- protocol schema parse/serialize；
- bearer 提取与 Human PAT authentication 调用；
- HTTP status/error mapping；
- “本 credential 实际收到某 cursor”的 transport delivery proof。

它不得持有 `RoomKernel`、打开 SQLite、访问 Host/Worker credential、lease Activation、读取 Outbox、选择 Placement 或实现业务权限。durable cursor 仍由 Kernel 拥有；HTTP memory 中的 delivery proof 只证明某次 response，daemon 重启后可以安全丢失并重新 sync。

### 3. Human port 是显式 capability whitelist

当前 port 只包含 Human 已有的业务 use case：

- Human token authentication；
- Workspace/Room discovery，以及 managed Workspace/Room 创建；
- 可见 AgentDefinition catalog 与 definition-resolved Room onboarding；
- membership list/add/remove/role；
- Message page/post 与 Thread list/create/reply；
- Room sync/ack；
- Task list/create/assign/unblock/cancel/complete；
- InputRequest list/resolve。

它明确不包含：

- principal、Host credential 或 RuntimeProfile provisioning；
- AgentHost heartbeat、Activation/RunAttempt/RuntimeProcess lifecycle；
- RuntimeOffer、Placement、capacity/workspace reservation；
- raw event append、Inbox/Outbox internal mutation 或 SQLite；
- daemon start/stop/update、filesystem、shell 或 Provider transcript。

facade 在运行时也是冻结的窄对象，而不只是 TypeScript 的 `Pick` 假象。新增 Human use case 必须同时修改 protocol、port whitelist、direct contract fixture 与相应 transport adapter；业务实现仍只能存在于 Kernel。

### 4. Actor 与 command truth 不因部署形态改变

无论 direct 还是 HTTP，业务方法都接收 Kernel 签发的 opaque `AuthenticatedActorContext`，不接受 body 中的 `actorId`。HTTP 从 bearer 获得 context；嵌入式可信调用方通过 `core.human.authenticateHumanAccessToken()` 获得 context。权限、freshness、idempotency 与 mutation transaction 在两条路径上完全相同。

### 5. `RahClient` 是调用方 SDK，不是业务 owner

未来 `@rah-os/client-sdk` 的 `RahClient` 负责 transport-neutral command/sync contract；`HttpRahClient`、`DesktopRahClient` 与 `FakeRahClient` 是调用 adapter。它们不导入 `@rah-os/kernel`，不持有 `AuthenticatedActorContext`，不重做 ACL/idempotency/Task 状态机。Direct Core integration 使用 `core.human`，UI 使用 `RahClient`；两者共享 protocol 和 conformance scenarios，但不是同一个安全层。

### 6. 当前 `core.kernel` 是可信 composition escape hatch

daemon 和测试仍需要尚未拆分的 Host/control/bootstrap 能力，因此 v0.1 暂时保留 `core.kernel`。它不是稳定 Human SDK，也不能传给 HTTP、UI、MCP 或 renderer。后续按 owner 提取 `HostApplicationPort`、`ControlApplicationPort` 与 bootstrap tooling 后，再缩减或移除公开 escape hatch；不能为了表面纯度先复制 Kernel 逻辑。

## 可接受的部署拓扑

```text
Embedded/headless test: caller -> core.human
Local product:          RahClient -> loopback HTTP -> core.human
Desktop bridge:         RahClient -> narrow IPC -> core.human
Future split service:   RahClient -> authenticated network transport -> core.human
```

这些是同一业务内核的不同 adapter，不是四套 server implementation。是否存在 OS process 或网络连接是部署选择，不改变 owner。

## 证据与门禁

- Core fixture 直接通过 `core.human` authentication、Room discovery 与 sync，完全不启动 HTTP；
- fixture 固定 Human port 的精确 operation whitelist，并证明对象 frozen、不含 Host/Activation 能力；
- source boundary fixture 禁止 Human HTTP adapter 出现 `RoomKernel` 或 `#kernel`；
- standalone HTTP fixture 继续证明 v1 compatibility、v2 collaboration、认证、ACL、freshness、idempotency 与 delivery proof；
- daemon composition 只向 HTTP adapter 注入 `core.human`。

## 后果

这不是传统三层架构中重复一套 `service` 的做法。Kernel 是唯一业务实现，Human port 是 capability boundary，HTTP/IPC 是 adapter，RahClient 是调用方。代价是每个新增 use case 必须显式进入 whitelist 和 contract fixture；收益是 Core 可直接嵌入，同时任何 transport 都无法因“方便”获得整个系统内核权限。
