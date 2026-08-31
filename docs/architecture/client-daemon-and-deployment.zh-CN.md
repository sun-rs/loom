# Client、Daemon 与部署边界

状态：本机 daemon core 已有独立 composition/CLI entrypoint、严格配置、Host generation fencing、deadline、Outbox wake、Worker delivery/Task/InputRequest command，以及 collaboration P2/P3 versioned loopback Human API；Workspace Agent 创建、版本化配置、暂停/恢复/删除已经打通 Kernel→Human API→Web→冻结运行上下文→真实子进程，运行中暂停由 AgentHost 受控 cancel 并保存 terminal proof，并通过 daemon restart 与 desktop/mobile browser gate。ADR-0017 提供持久化 production Web build、server-side Human session 与重启恢复入口；ADR-0019 又新增 daemon 继续 loopback 的正式 HTTPS LAN edge、一次性设备 pairing、可撤销持久 session、Raft 形态设备管理、PWA shell 和真实 Chrome 重启门禁。Remote Computer v1 已有独立 protocol、窄 Kernel application port、loopback HTTP transport、独立进程双 Host/generation handoff fixture、持久 resident runner supervisor、owner-private control socket、签名 terminal result、parent-SIGKILL reconnect E2、owner-private 多 attachment catalog、短 session/heartbeat/RuntimeOffer reconcile、远程 Placement/RunAttempt/terminal-proof 控制闭环、activation-scoped Worker credential、持久 ComputerOperation、两阶段 Server-delivery receipt、固定 Ed25519 release source、离线 Ed25519 release publisher、K two-slot/WAL、detached replacement、successor-owned ready、service-start recovery、handoff `SIGKILL` rollback、launchd-owned constant supervisor/FD lease、typed provisioning、shell-free launchctl lifecycle API、Runtime Provider Keychain loader、strict operator install/stage/activate CLI，以及 darwin-arm64 自包含 SEA 构建和 staging gate。系统/iOS CA trust 安装与 CA 轮换/告警、跨机器 HTTPS Computer/Worker endpoint、operation hint、真实 login/reboot/power-loss gate、显式执行 session reset、skill/memory、Artifact/Review、Developer ID/notarization、生产私钥托管/HTTPS publication、operator uninstall/purge 与 attachment/supervisor Keychain credential 管理尚未实现。

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

当前 Human HTTP adapter（兼容类名 `ClientApplicationService`）已实现上述 contract 的 collaboration P2/P3 段：v1/v2 compatibility、v3 health/capabilities、Workspace/Room discovery/managed create、Agent catalog/onboarding/provision/get/manage、Room `sync/ack`、成员角色、Message/Thread、Task/InputRequest command/query。P3 gate 已覆盖 daemon restart 后同 consumer 从 durable cursor 恢复。它只依赖 `HumanApplicationPort`；嵌入式程序可跳过 HTTP 直接调用 `RahCore.human`。独立 typed `RahClient` package 已覆盖现有 v3 route，Web Room slice 使用 `client-core` 做 bounded catch-up、causal mutation barrier 与 ack-after-apply。Workspace/Room archive、Agent session reset、skill/memory、Inbox query/resolve、Artifact/Review、Run Inspector 与 `subscribeHints` 仍缺失，因此不能把这一 slice 称为完整 UI SDK。

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

Remote Computer 使用第三类、独立于 Human/Worker 的控制协议。`@rah-os/computer-protocol` 定义 actor-free session open、heartbeat、RuntimeOffer publication、Placement claim、执行 mutation 和 content-free hint；`ComputerApplicationService` 只依赖 `ComputerApplicationPort`，不直接暴露 `RoomKernel`。长期 Host credential 仅用于打开连接，服务端随后签发有 TTL 的短期 session token。`connectionId` 标识稳定 attachment，`computerInstanceId` 标识本次本机进程；同一进程在短 session 过期后续签同一 authenticated Host generation，真正的新进程仍需经过 server-owned stale/offline takeover 并生成新 generation。竞争 generation、撤销 credential 和旧 session 都 fail closed。

当前有七层隔离证据：前六层分别覆盖 application port、双 Host HTTP、真实 Worker child、ComputerOperation、签名 replacement 和 K detached transaction。第七层把 service-start decision 收口为 idle/source recovery/target ready/recovery-required：源进程换代允许在相同 source build 与 exact attachment 下恢复，目标必须是不同 Computer instance；coordinator 在 handoff 内被 `SIGKILL` 时，新 source generation 从 durable request 与 K WAL 证明无法安全完成 handoff，于是回滚 stable、释放 hold、提交 terminal failure 并清理 receipt。launchd 不直接运行可替换 K slot，而只跟踪 constant supervisor；supervisor 通过 authenticated enum-only socket 执行 stop/start，通过 FD3 传私密配置、FD4 fence orphan child。Computer launchctl 路径目前仍主要由注入 adapter 验收；Local Core 的独立 SEA 已在当前 macOS 用户 login domain 实际完成 bootstrap、health 与 bootout。该证据仍不等于登录后自动启动、断电/reboot、跨机器 HTTPS Worker 或正式远程部署已经完成。

升级进程配置 schema v2 已强制要求 supervisor control，不再允许生产组合退回 direct-slot launcher；正常升级与 coordinator crash rollback 黑盒均通过 supervisor。supervisor control 现有 authenticated status/stop/start，handoff deadline 同样覆盖卡住的 replacement launch，迟到 child 会被停止。新增 launchctl controller 只接受规范化 plan，固定调用 `/bin/launchctl`、不经 shell、不继承环境，只把 exit `0` 当 loaded、`113` 当 missing，其他状态 fail closed；显式 replace 才 bootout，并有界等待 registration。测试全部使用注入 launchctl，没有加载本机服务；可选 readiness 还要求 supervisor PID 与 singleton HMAC attestation 一致。

可替换 service 自身也已收口到 `runNodeKCarrierComputerServiceProcess`：同一 owner 同时管理 attachment workload、singleton ownership proof、PID/generation-fenced upgrade hold/release、startup recovery、SIGINT/SIGTERM 与 supervisor FD lease shutdown。ownership attestation 和 startup recovery 现在都必须先穿过 workload readiness barrier，不能把尚未读取 parked 状态的 socket owner 当成健康 successor。`ComputerServiceAttachmentWorkload` 复用既有 `ComputerAttachmentManager`，启动时读取 K 的 durable parked snapshot，catalog 漂移即 fail closed，hold 会排空 manager，release 才重建；`RemoteComputerManagedAttachmentService` 与 `createRemoteComputerServiceAttachmentWorkload` 再把每个 attachment 组合成独立 bounded `RemoteComputerAgentHostService`，同时让全部短 session 共用同一 service incarnation。`RemoteRuntimeProfileSet` 已共享本机 daemon 的 active revision、probe/model binding、Offer、旧 revision recovery resolver 与 secret owner；每次远程 Activation 将 Provider secret lease 和 Computer session 签发的短期 Worker credential 合并，长期 attachment/session token 不进入 child；远程 orphan recovery control 尚未进入协议，因此当前仍 fail closed。production service entry 已从 FD3 owner-private strict schema v1 打开 registry、探测 active profile、绑定 workspace/file-or-Keychain secret reference、组装 attachment workload并执行 K startup recovery，FD4 只接受 pipe/socket parent lease；Keychain loader 固定 `/usr/bin/security find-generic-password -w`、空环境、无 shell、有界时间/输出且忽略 diagnostics，不能跨 store fallback。配置不接受 inline command/env，且 SEA 模式拒绝与 artifact 冻结版本不一致的 buildVersion。统一内部 CLI 已精确分派 supervisor/service/upgrade/embedded process-supervisor。provisioning owner 生成完整配置闭包；darwin-arm64 SEA gate 固定并校验官方 Node v26.8.1 carrier，将 production dependency 和 process-supervisor 组成同一 ad-hoc codesigned artifact，并证明同一 artifact 可通过离线 Ed25519 publisher/consumer round trip、安装为 launchd supervisor 与 K stable service。owner-private strict request 的 operator CLI 默认只 stage，显式 `--activate` 才 bootstrap 并证明 service readiness，loaded 服务还要求 `--replace-loaded`；重复调用复用已 staged 的 exact capability closure。当前剩余的是 Developer ID/notarization、生产私钥托管和 HTTPS publication、operator uninstall/purge、真实 launchctl login/reboot gate，以及 attachment/supervisor Keychain credential 的创建、轮换和撤销，而不是第二套 service、attachment 或 Runtime 执行实现。

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

Raft Computer 1.0.18 的 resident service 行为已收敛进同一 owner：`@rah-os/agent-host` 的 `resident-runner-policy` 是纯 reducer，只有 matching connection evidence 才把新进程标记为 running；意外退出按 2 秒 backoff 重试，60 秒内第三次 crash 打开 degraded circuit，configuration/attachment-revoked terminal 直接停车，operator reset 才恢复。它额外按 process generation 忽略迟到 ready/exit，且退出分类只接受结构化 terminal fact、code 和 signal，不解析日志。schema v2 owner-private state store 原子持久化 generation、wrapper PID、control capability、crash/degraded；supervisor 先启动不含 target 的 prepared wrapper，待 UUID/token/PID 持久化后才允许幂等 launch。`NodeResidentRunnerControlPlane` 使用 owner-private Unix socket、constant-time token、strict IPC 和签名 terminal result；startup active state 必须以 capability 证明，旧 PID-only state fail closed。独立 fixture 已证明原 AgentHost 被 `SIGKILL` 后 replacement 能 adopt/stop 原 runner。

attachment 层同样由 `@rah-os/agent-host` 独占本机生命周期，不直接依赖 `ComputerApplicationService` 或 `RoomKernel`：`ComputerAttachmentStore` 以 schema v1、owner-private `0600/0700`、同目录临时文件、file/directory fsync 与 atomic rename 保存最多 128 个、总计 256 KiB 的长期凭证和稳定 `connectionId`；symlink、宽松权限、重复 identity、损坏/未来 schema 以及非 loopback 明文 origin 均 fail closed。`ComputerAttachmentManager` 将 catalog 投影为相互隔离的 `ComputerResidentService`，每 5 秒主动 reconcile；每个服务只在长期 credential 打开短期 session、online heartbeat 和全部 RuntimeOffer 发布完成后进入 connected。短 session 的 `401` 以同一 `computerInstanceId` 续签，长期 credential 在 session-open 阶段被撤销则单 attachment terminal 停车，不影响其他 attachment；已 online 后发现本地配置 terminal 时先 best-effort offline，再保留 degraded 诊断。`AgentHostControlPort` 使本地 Kernel 和远程 Computer 共用同一 AgentHost 状态机；远程 adapter 只开放 lifecycle mutation，不开放 Human/Worker 业务命令、任意 shell、legacy lease 或未实现的 orphan recovery。`RemoteComputerAgentHostService` 是一个已执行验证的单 attachment composition owner：先让 resident 建立 generation 并发布 Offer，再启动 bounded AgentHost workers；关闭时先 drain runtime、保留 control session 写入 terminal proof，最后 offline。`NodeHttpComputerControlClient` 对远程 origin 强制 HTTPS、流式限制响应为 256 KiB，并把 auth/conflict/unavailable/protocol 故障分型，不解析错误正文或把 token 写入错误。`ComputerResidentService` 通过同一短期 session 签发/撤销 activation-scoped Worker bearer；runtime 从不取得长期 Host attachment 或 Computer session token，Worker 每次请求仍由 canonical execution fence 重新授权。`ComputerDoctor` 只输出 credential-free catalog/reconcile 状态；`ResidentRunnerArtifactCollector` 只在调用方显式确认 retired、UUID/owner/terminal-evidence/保留期合法、非 active 且 control socket 不可连接同时成立时清理旧 wrapper artifact，未确认 retirement、活 socket 与未知内容必定保留。`ComputerReleaseSource` 以固定 Ed25519 trust root、strict semver、完整 platform target、signed size/SHA-256 和有界 HTTPS body 生成经过认证的 descriptor；metadata、artifact 总下载和 stream stall 使用独立 deadline，artifact 下载按 manifest 大小限流、边读边 hash，使用 owner-private 临时文件、file fsync、原子 no-overwrite link 与 directory fsync，重复 effect 只接受字节完全相同的现有文件。`publishComputerRelease` 以 owner-private Ed25519 私钥为唯一 signer，单一锁内先发布不可变 artifact 与规范签名 manifest，最后原子更新单调 latest pointer；重复内容幂等，冲突、symlink、宽松私钥、并发发布与版本回退均 fail closed。remote runtime 已能在同机 gate 中通过 Computer control 使用 canonical Worker API，但 Worker server 当前仍是 loopback composition，不能把该证据冒充跨机器 HTTPS 部署。collector retirement 与 ComputerOperation acknowledgement 仍是彼此独立的 owner；K two-slot/WAL、production HostAdapter、startup recovery、launchd-owned supervisor process、authenticated supervisor control、FD parent lease、typed provisioning、staging installer、SEA artifact gate、离线签名发布 gate 与 Runtime Provider Keychain loader 已存在。仍缺真实 launchctl/reboot gate、显式 re-attach/reset、attachment/supervisor Keychain 管理、Developer ID/notarization、生产私钥托管/HTTPS publication 与跨机器安全 transport。

ComputerOperation 由 Kernel schema v10 的单独持久 owner 管理，同一 Host 同时只允许一个 active operation；创建目前只允许可信 composition/bootstrap 调用，尚未在缺少 Server 级 Admin 模型时伪造 Human 按钮。Computer wire 只下发 `restart|upgrade`、稳定 operation ID、请求时间和可选 target build，并只接收枚举 phase/failure code。领取时冻结当前 heartbeat build；中途 incumbent 崩溃后，只有同 credential、同 source build 的新 generation 可重新绑定并继续尚未进入 `restarting` 的阶段；进入 `restarting` 后必须再出现一个不同 generation 才能回 `ready`。`ComputerOperationReceiptStore` 以 owner-private `0600/0700`、strict schema、atomic rename 和 directory fsync 保存 Server 阶段的两阶段 delivery checkpoint；它不是 stable/experiment transaction owner。upgrade 路径由固定 tag/hash、Apache-2.0 的 `@rah-os/k-carrier` 独占 WAL、slots、rollback 和 terminal outcome；RAH 只单调投影 Server phases。production HostAdapter 在 hold 前冻结 exact attachment set，启动恢复只依赖 durable request、K WAL 与当前 singleton。launchd constant supervisor 而非可替换 slot 拥有 service child；K stop/start 通过 authenticated supervisor port 执行，FD lease 防止 supervisor crash 留下 orphan。这里仍不是安装完成的自动升级器，因为尚无 Developer ID/notarization、生产私钥托管/HTTPS publication、operator uninstall/purge、真实 launchctl/reboot/power-loss gate 与 attachment/supervisor Keychain credential 管理；自包含 SEA、离线 Ed25519 发布、Runtime Provider Keychain loader、typed provisioning 和 operator install/stage/activate 已有可重复 gate。

`@rah-os/daemon` 在 wrapper 之外补上了可执行 composition root：它统一拥有 Kernel/Worker/Runtime/AgentHost/Outbox publisher 的启动回滚和逆序关闭；compatibility v2/v3 保留单 participant lane，config v4 的静态 participant 列表必须是 Host credential 当前 scope 的子集，并可运行多 participant、多 immutable runtime profile。Workspace manager 后续创建的动态 Agent 由 Kernel 扩展同一 credential scope，无需 daemon 重启；重启时数据库 scope 仍是权威，静态 config 不会删除它。每次进程认证生成新的 instance generation，正常 offline 或超过 `hostStaleAfterMs` 后才能接管，旧 Host 与 Worker authority 随即被 fence。启动、恢复、取消和总 drain 都有显式 deadline。

本机 Outbox dispatcher 只消费 `activation.requested`，发布 content-free wake 以中断 Host poll wait；固定 reconciliation interval 仍是 100% hint loss 的恢复路径。独立进程 fixture 已验证关闭 UI 无关的 SIGTERM、Worker delivery 和 restart。

上面的三段状态是正常 signal shutdown。管理面撤销 Host credential 时，Kernel 会直接 fence credential 并把 Host 标记为 `offline`；该路径可以跳过 drain，进行中的 RunAttempt 若无法再写 terminal proof，将按既有 lease expiry → orphan/quarantine → recovery 规则对账，不能把 revoke 伪装成正常完成。

Unix socket 只是同一台机器上的启动协调，不是业务 fencing token，也不是跨机器分布式锁。Kernel 中的 daemon generation、Activation/RuntimeProcess lease 才保护业务 lane。当前已有 `plutil` 验证的 LaunchAgent 生成器、staging installer 与 operator install CLI；它要求 constant supervisor，不允许 plist 直接指向 K stable slot，并在 plist 发布前验证 supervisor/service artifact 的 size+SHA-256、写入 owner-private 配置并 bootstrap stable。CLI 默认不调用 bootstrap；只有显式 activation 才使用 shell-free launchctl controller，并在返回成功前要求 service-level readiness。构建器固定 upstream Node carrier 的来源/size/hash，拒绝无 SEA fuse 的 Homebrew Node，将 unified CLI、runtime process supervisor 与冻结 buildVersion 组成同一 ESM SEA，禁用运行时 `NODE_OPTIONS` 扩展并完成 ad-hoc codesign；gate 证明相同字节通过离线 Ed25519 发布/消费闭环并进入 supervisor 与 stable slot。Runtime Provider Keychain token 已有有界读取 owner；仍缺 Developer ID/notarization、生产私钥托管/HTTPS publication、真实 launchctl/reboot gate、attachment/supervisor Keychain 创建/轮换、operator uninstall/purge、daemon control API 和 UI 兼容矩阵，因此不能称为可安装完成的 Mac 后台产品。

staging 之后的 activation command contract、统一 internal CLI、production Computer service composition、typed provisioning、自包含 SEA gate、离线 Ed25519 发布器、Runtime Provider Keychain loader 与 operator install/stage/activate CLI 已实现，但尚无 Developer ID/notarization、生产私钥托管/HTTPS publication，也未在用户登录域执行真实 bootstrap。operator uninstall/retain-state/purge-state、真实 login/reboot/power-loss gate、attachment/supervisor Keychain 创建/轮换、daemon control API 和 UI 兼容矩阵仍然缺失，因此仍不能称为安装完成。

attachment/supervisor Keychain 管理不能通过把 secret 作为 `/usr/bin/security ... -w <password>` argv 的方式自动化。macOS 自带工具明确把该形式标为 insecure；本机隔离 keychain 探针又证明 prompt 模式与显式非默认 keychain 参数不能组成可靠的非交互 contract。因此该能力与 Developer ID identity 一起收口：发行物需要一个同签名、只从 stdin 接收有界 secret、基于 Security.framework 的 helper，并由同一签名身份负责读取、创建、轮换和撤销。当前 file secret 与 Provider Keychain loader 保持显式来源、绝不互相 fallback。

`npm run start:local-workbench` 是当前正式的本机 Web 入口：它不使用 Vite dev server，不删除状态，并以 loopback static gateway 持有 Human PAT。浏览器只得到随机 HttpOnly Strict session；gateway 同时执行 Host-header、cookie 与 mutation Origin 校验，再把 PAT 注入到 allowlisted Client API。关闭浏览器不会停止后台进程，终止工作台进程则优雅 drain；launchd 尚未接管前，用户仍需保持该进程运行。

## 7. 可信局域网部署

开发 fixture 可以在明确告警下使用临时私网 HTTP；正式产品不能把“局域网可信”当作身份。正式 LAN 路径必须使用 ADR-0019 的 HTTPS edge 与设备配对。以下边界不能取消：

- actor 来自认证 session/host credential，不接受客户端任意 `actorId`；
- 浏览器入口使用明确的 allowed origins，禁止 wildcard CORS；
- command 权限由 Room membership/role 检查；
- 当前 AgentHost credential 固定绑定 host，并由 Kernel 持久维护 Agent participant scope；Workspace manager 可以通过原子 provision 扩展 scope，但 AgentDefinition/capability 细粒度最小授权仍是下一层扩展；
- Kernel API 不提供接受任意 shell 字符串的通用 `/run`；
- 本机模式默认 bind loopback；局域网监听必须显式启用并显示实际地址；
- Room event、command actor、Host lease 和外部副作用保留审计记录。

公网、跨组织或不可信 Wi-Fi 还需要用户管理的 VPN/tunnel 或后置的内容不可知 relay，以及 credential rotation、审计与更强隔离。中央服务器不是单机/LAN 成立的前提，也不得因为提供 relay 而取得 Room 或 Provider truth。

当前 daemon config 仍只接受 `127.0.0.1`，也不发送 CORS header。ADR-0017 的同源 gateway 只服务 loopback；ADR-0019 的独立 LAN edge 使用显式 HTTPS origin、certificate hostname/key 校验、一次性配对、摘要化可撤销 session、Host/Origin/Fetch-Metadata 和配对限流后，才 server-side 注入 Human PAT。Web Settings 的设备管理只消费 `/_rah/*` edge API，本机 gateway 对该前缀显式 404；它不改变 Room/Task owner。Core 已能创建和复用 owner-private 本地 CA、按 origin 签发/续签精确 SAN 叶证书，也允许成对覆盖外部证书。临时 Vite `:lan` fixture 仍不得作为正式入口。系统/iOS trust 安装、CA 轮换/告警和通用 API 速率预算仍是发行缺口。

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
