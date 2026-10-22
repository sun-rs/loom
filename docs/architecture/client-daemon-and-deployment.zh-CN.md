# Client、Daemon 与部署边界

## 历史呈现表兼容迁移

Kernel 对 `activation_presented_windows` 的旧 `message_seqs_json` / `presented_at`
结构执行显式事务迁移：保留数据并重命名为 `presented_seqs_json` / `rendered_at`，
新增送达与待确认字段保持 NULL，不能把历史呈现解释成 ACK。
只读结构检查仅把完整匹配的旧结构识别为待迁移；未知约束漂移仍拒绝启动。
正式重启先在备份副本预检，再由 Kernel 迁移正式库，禁止删表绕过检查。
回归证据：`packages/kernel/test/presented-schema-compatibility.test.ts`。

引导元数据中的 Agent 列表是历史记录，不是当前授权来源。重启时仅排除
canonical catalog 中已 tombstoned 的引导 Agent；其余引导 Agent 仍须通过
Host 凭证范围校验。不得恢复已删除 Agent 的权限或篡改原始引导记录。

## Composer 计算机文件引用

Human API `POST /v3/client/computers/files/list` 通过 AgentHost 的有界目录读取器
提供文件/文件夹绝对路径元数据，不提供文件正文、不创建 Artifact。
daemon 的 `fileReferenceRoots` 配置授权绝对根目录。按 2026-09-17 用户决定，
引用目录默认范围为 `/`，起点为运行 daemon 的用户目录，可逐级向上导航；
显式配置较窄范围时仍保留该边界。仅 Computer 路径元数据读取器允许 `/`，
Agent 工作区的列表和正文读取仍拒绝它。子路径不接受绝对路径、`..` 或
符号链接逃逸，并沿用敏感目录过滤。
必须经过 Human 身份认证；Agent 与未认证请求不能列目录。
当前只支持本 daemon 的 Computer；其他 hostId 明确拒绝。浏览器设备图片与文件
继续通过已有附件上传契约进入 daemon，与路径引用分开。旧 main 的 loopback 自动识别
只是可覆盖的交互偏好，不是文件权限或跨机器访问证明。当前 evo 按2026-10-15 Owner批准统一文件窗口：回环地址默认同机交互（上传按钮置灰），
其他地址默认异机（上传可用）；fileDevice=local／remote 可显式覆盖并在当前标签页保存。
这只是 UI 偏好，不证明物理同机、不影响后台权限，参见
[Composer 合同](../design/composer-controls.md)。计算机文件选择明确标注 Loom 主机。多机引用
与传输建议见[附件接线审计](../audits/2026-10-15-attachments.zh-CN.md)，尚非已接通的远端文件树。详见
[Composer 合同及验证](../design/composer-controls.md)。

状态：本机 daemon core 已有独立 composition/CLI entrypoint、严格配置、Host generation fencing、deadline、Outbox wake、Worker delivery/Task/InputRequest command，以及 collaboration P2/P3 versioned loopback Human API；Workspace Agent 创建、版本化配置、暂停/恢复/删除已经打通 Kernel→Human API→Web→冻结运行上下文→真实子进程，运行中暂停由 AgentHost 受控 cancel 并保存 terminal proof，并通过 daemon restart 与 desktop/mobile browser gate。Agent execution `restart/session` 已复用同一 terminal proof、全局per-Agent fence、Provider continuity store与canonical manage闭环；`full` workspace删除仍禁用。ADR-0017 提供持久化 production Web build、server-side Human session 与重启恢复入口；durable root 已稳定为 `~/.rah`，旧 Application Support 数据以无覆盖、可恢复 staging 迁移，operator uninstall 只卸载服务且不提供数据删除。ADR-0019 又新增 daemon 继续 loopback 的正式 HTTPS LAN edge、一次性设备 pairing、可撤销持久 session、Raft 形态设备管理、PWA shell 和真实 Chrome 重启门禁。Remote Computer v1 已有独立 protocol、窄 Kernel application port、loopback HTTP transport、独立进程双 Host/generation handoff fixture、持久 resident runner supervisor、owner-private control socket、签名 terminal result、parent-SIGKILL reconnect E2、owner-private 多 attachment catalog、短 session/heartbeat/RuntimeOffer reconcile、远程 Placement/RunAttempt/terminal-proof 控制闭环、activation-scoped Worker credential、持久 ComputerOperation、两阶段 Server-delivery receipt、固定 Ed25519 release source、离线 Ed25519 release publisher、K two-slot/WAL、detached replacement、successor-owned ready、service-start recovery、handoff `SIGKILL` rollback、launchd-owned constant supervisor/FD lease、typed provisioning、shell-free launchctl lifecycle API、Runtime Provider Keychain loader、strict operator install/stage/activate CLI，以及 darwin-arm64 自包含 SEA 构建和 staging gate。系统/iOS CA trust 安装与 CA 轮换/告警、跨机器 HTTPS Computer/Worker endpoint、operation hint、真实 login/reboot/power-loss gate、`full` execution reset、skill/memory、Artifact/Review、Developer ID/notarization、生产私钥托管/HTTPS publication 与 attachment/supervisor Keychain credential 管理尚未实现。

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

当前 Human HTTP adapter（兼容类名 `ClientApplicationService`）已实现上述 contract 的 collaboration P2/P3 段：v1/v2 compatibility、v3 health/capabilities、Workspace/Room discovery/managed create、Agent catalog/onboarding/provision/get/manage、Agent execution `restart/session`、Room `sync/ack`、成员角色、Message/Thread、Task/Review/InputRequest command/query、Human Inbox、Search/Activity、Room Files、Agent workspace/memory、消息回应/收藏与个人侧栏偏好。P3 gate 已覆盖 daemon restart 后同 consumer 从 durable cursor 恢复。它只依赖 `HumanApplicationPort`；嵌入式程序可跳过 HTTP 直接调用 `RahCore.human`。独立 typed `RahClient` package 已覆盖现有 v3 route，Web Room slice 使用 `client-core` 做 bounded catch-up、causal mutation barrier 与 ack-after-apply。Workspace/Room 完整 archive、Agent `full` execution reset、独立 Artifact publication、Run Inspector 与 `subscribeHints` 仍缺失，因此不能把这一 slice 称为完整 UI SDK。

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

可替换 service 自身也已收口到 `runNodeKCarrierComputerServiceProcess`：同一 owner 同时管理 attachment workload、singleton ownership proof、PID/generation-fenced upgrade hold/release、startup recovery、SIGINT/SIGTERM 与 supervisor FD lease shutdown。ownership attestation 和 startup recovery 现在都必须先穿过 workload readiness barrier，不能把尚未读取 parked 状态的 socket owner 当成健康 successor。`ComputerServiceAttachmentWorkload` 复用既有 `ComputerAttachmentManager`，启动时读取 K 的 durable parked snapshot，catalog 漂移即 fail closed，hold 会排空 manager，release 才重建；`RemoteComputerManagedAttachmentService` 与 `createRemoteComputerServiceAttachmentWorkload` 再把每个 attachment 组合成独立 bounded `RemoteComputerAgentHostService`，同时让全部短 session 共用同一 service incarnation。`RemoteRuntimeProfileSet` 已共享本机 daemon 的 active revision、probe/model binding、Offer、旧 revision recovery resolver 与 secret owner；每次远程 Activation 将 Provider secret lease 和 Computer session 签发的短期 Worker credential 合并，长期 attachment/session token 不进入 child；远程 orphan recovery control 尚未进入协议，因此当前仍 fail closed。production service entry 已从 FD3 owner-private strict schema v1 打开 registry、探测 active profile、绑定 workspace/file-or-Keychain secret reference、组装 attachment workload并执行 K startup recovery，FD4 只接受 pipe/socket parent lease；Keychain loader 固定 `/usr/bin/security find-generic-password -w`、空环境、无 shell、有界时间/输出且忽略 diagnostics，不能跨 store fallback。配置不接受 inline command/env，且 SEA 模式拒绝与 artifact 冻结版本不一致的 buildVersion。统一内部 CLI 已精确分派 supervisor/service/upgrade/embedded process-supervisor。provisioning owner 生成完整配置闭包；darwin-arm64 SEA gate 固定并校验官方 Node v26.8.1 carrier，将 production dependency 和 process-supervisor 组成同一 ad-hoc codesigned artifact，并证明同一 artifact 可通过离线 Ed25519 publisher/consumer round trip、安装为 launchd supervisor 与 K stable service。owner-private strict request 的 operator CLI 默认只 stage，显式 `--activate` 才 bootstrap 并证明 service readiness，loaded 服务还要求 `--replace-loaded`；重复调用复用已 staged 的 exact capability closure。operator uninstall 已实现为“仅卸载服务、保留 `~/.rah`”，且故意不暴露共享根 purge。当前剩余的是 Developer ID/notarization、生产私钥托管和 HTTPS publication、真实 launchctl login/reboot gate，以及 attachment/supervisor Keychain credential 的创建、轮换和撤销，而不是第二套 service、attachment 或 Runtime 执行实现。

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

ComputerOperation 由 Kernel schema v10 的单独持久 owner 管理，同一 Host 同时只允许一个 active operation；创建目前只允许可信 composition/bootstrap 调用，尚未在缺少 Server 级 Admin 模型时伪造 Human 按钮。Computer wire 只下发 `restart|upgrade`、稳定 operation ID、请求时间和可选 target build，并只接收枚举 phase/failure code。领取时冻结当前 heartbeat build；中途 incumbent 崩溃后，只有同 credential、同 source build 的新 generation 可重新绑定并继续尚未进入 `restarting` 的阶段；进入 `restarting` 后必须再出现一个不同 generation 才能回 `ready`。`ComputerOperationReceiptStore` 以 owner-private `0600/0700`、strict schema、atomic rename 和 directory fsync 保存 Server 阶段的两阶段 delivery checkpoint；它不是 stable/experiment transaction owner。upgrade 路径由固定 tag/hash、Apache-2.0 的 `@rah-os/k-carrier` 独占 WAL、slots、rollback 和 terminal outcome；RAH 只单调投影 Server phases。production HostAdapter 在 hold 前冻结 exact attachment set，启动恢复只依赖 durable request、K WAL 与当前 singleton。launchd constant supervisor 而非可替换 slot 拥有 service child；K stop/start 通过 authenticated supervisor port 执行，FD lease 防止 supervisor crash 留下 orphan。这里仍不是安装完成的自动升级器，因为尚无 Developer ID/notarization、生产私钥托管/HTTPS publication、真实 launchctl/reboot/power-loss gate 与 attachment/supervisor Keychain credential 管理；自包含 SEA、离线 Ed25519 发布、Runtime Provider Keychain loader、typed provisioning、operator install/stage/activate 和 retain-state uninstall 已有可重复 gate。

`@rah-os/daemon` 在 wrapper 之外补上了可执行 composition root：它统一拥有 Kernel/Worker/Runtime/AgentHost/Outbox publisher 的启动回滚和逆序关闭；compatibility v2/v3 保留单 participant lane，config v4 的静态 participant 列表必须是 Host credential 当前 scope 的子集，并可运行多 participant、多 immutable runtime profile。Workspace manager 后续创建的动态 Agent 由 Kernel 扩展同一 credential scope，无需 daemon 重启；重启时数据库 scope 仍是权威，静态 config 不会删除它。每次进程认证生成新的 instance generation，正常 offline 或超过 `hostStaleAfterMs` 后才能接管，旧 Host 与 Worker authority 随即被 fence。启动、恢复、取消和总 drain 都有显式 deadline。

本机 Outbox dispatcher 只消费 `activation.requested`，发布 content-free wake 以中断 Host poll wait；固定 reconciliation interval 仍是 100% hint loss 的恢复路径。独立进程 fixture 已验证关闭 UI 无关的 SIGTERM、Worker delivery 和 restart。

上面的三段状态是正常 signal shutdown。管理面撤销 Host credential 时，Kernel 会直接 fence credential 并把 Host 标记为 `offline`；该路径可以跳过 drain，进行中的 RunAttempt 若无法再写 terminal proof，将按既有 lease expiry → orphan/quarantine → recovery 规则对账，不能把 revoke 伪装成正常完成。

Unix socket 只是同一台机器上的启动协调，不是业务 fencing token，也不是跨机器分布式锁。Kernel 中的 daemon generation、Activation/RuntimeProcess lease 才保护业务 lane。当前已有 `plutil` 验证的 LaunchAgent 生成器、staging installer 与 operator install CLI；它要求 constant supervisor，不允许 plist 直接指向 K stable slot，并在 plist 发布前验证 supervisor/service artifact 的 size+SHA-256、写入 owner-private 配置并 bootstrap stable。CLI 默认不调用 bootstrap；只有显式 activation 才使用 shell-free launchctl controller，并在返回成功前要求 service-level readiness。构建器固定 upstream Node carrier 的来源/size/hash，拒绝无 SEA fuse 的 Homebrew Node，将 unified CLI、runtime process supervisor 与冻结 buildVersion 组成同一 ESM SEA，禁用运行时 `NODE_OPTIONS` 扩展并完成 ad-hoc codesign；gate 证明相同字节通过离线 Ed25519 发布/消费闭环并进入 supervisor 与 stable slot。Runtime Provider Keychain token 已有有界读取 owner；operator uninstall 只移除 launchd 注册并保留 durable root，不提供共享根 purge。仍缺 Developer ID/notarization、生产私钥托管/HTTPS publication、真实 launchctl/reboot gate、attachment/supervisor Keychain 创建/轮换、daemon control API 和 UI 兼容矩阵，因此不能称为可安装完成的 Mac 后台产品。

staging 之后的 activation command contract、统一 internal CLI、production Computer service composition、typed provisioning、自包含 SEA gate、离线 Ed25519 发布器、Runtime Provider Keychain loader、operator install/stage/activate CLI 与 retain-state uninstall 已实现，但尚无 Developer ID/notarization、生产私钥托管/HTTPS publication，也未在用户登录域执行真实 bootstrap。真实 login/reboot/power-loss gate、attachment/supervisor Keychain 创建/轮换、daemon control API 和 UI 兼容矩阵仍然缺失，因此仍不能称为安装完成。

attachment/supervisor Keychain 管理不能通过把 secret 作为 `/usr/bin/security ... -w <password>` argv 的方式自动化。macOS 自带工具明确把该形式标为 insecure；本机隔离 keychain 探针又证明 prompt 模式与显式非默认 keychain 参数不能组成可靠的非交互 contract。因此该能力与 Developer ID identity 一起收口：发行物需要一个同签名、只从 stdin 接收有界 secret、基于 Security.framework 的 helper，并由同一签名身份负责读取、创建、轮换和撤销。当前 file secret 与 Provider Keychain loader 保持显式来源、绝不互相 fallback。

`npm run start:local-workbench` 是当前正式的本机 Web 入口：它不使用 Vite dev server，不删除状态，并以 loopback static gateway 持有 Human PAT。浏览器只得到 owner-private、随机且跨普通进程重启稳定的 HttpOnly Strict session capability；显式清除本机产品状态才会轮换。gateway 同时执行 Host-header、cookie 与 mutation Origin 校验，再把 PAT 注入到 allowlisted Client API。同源旧 session 会收到结构化 `session_expired` 并在同一响应中续发 cookie，客户端不会把 `text/plain`/HTML 错误泄漏成 `JSON.parse`，也不会把一次 transport failure 复制到每条 Message。关闭浏览器不会停止后台进程，终止工作台进程则优雅 drain；launchd 尚未接管前，用户仍需保持该进程运行。

正式 Web release 还拥有独立的构建代际 fence：Vite 为完整 emitted content 生成确定性
`webBuildId`，product snapshot 只接受 `.rah-web-build.json` 与 `index.html` meta 唯一且一致的
构建；loopback/LAN gateway 在静态和 Client API 响应上发送同一
`x-rah-web-build-id`。旧标签页在 bootstrap、API decode 之前、focus/visibility 和 15 秒有界
HEAD probe 上发现不同代际，按 Raft 的刷新/继续合同由 Human 决定。刷新只更新同源 Service
Worker、删除 RAH 自有 cache 并保留 typed query；代际错误不得进入 Room/Message projection。
详见[Web 构建代际合同](../product/2026-09-03-web-build-recovery-contract.zh-CN.md)。

开发工作台的人工发布现在统一使用 `restart:local-workbench` 的 fail-closed guard：
冻结构建校验、exact PID/checkout/listener/database 验证、空闲检查、SQLite online backup
和文件摘要核验全部成功后才能 SIGTERM。失败不进入 stop，不 force-kill，也不覆盖用户状态。
这不是新业务状态机或安装版 K upgrade 的替代品，也尚非原子 maintenance lock。
命令、回滚边界和验收规则见[发布保护合同](../design/ui-evidence-and-release.md)。

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
- 同一 gateway 更换 Web release 后，旧标签页必须在业务 parser 前提示刷新，且不得把错误复制进 Message；
- 浏览器不能冒充另一个 participant，也不能提交任意 shell；
- 本机、局域网和远端拓扑不改变 Room/Task owner。

## 已退役的托管 MCP 配置

2026-09-08 用户移除 RAH 托管 MCP 模块，当前本机启动不再读取
`managed-mcp.json` 或启动托管 executor/proxy。历史文件及 SQLite 记录保留在
既有备份范围内，不恢复功能，也不删除用户 CLI 自身工具配置。
范围和验证要求见[产品决定](../product/managed-mcp-retirement.zh-CN.md)。

LAN gateway 停止时还必须释放尚未完成 TLS 握手的底层连接；仅调用 closeAllConnections 不足以保证
停止返回。连接集合按 server 实例归属，不能让浏览器预连接阻塞 daemon 的 offline/单实例恢复。
见[2026-09-07 全面验收](../audits/2026-09-07-full-acceptance.zh-CN.md)。

## 页面触发本机服务重启

`WorkbenchServiceRestart` 调用部署网关的 `GET /_rah/service` 和
`POST /_rah/service/restart`。协议包校验 generation；loopback 与 LAN 网关
分别验证既有 session，POST 必须精确同源，共用一个 handler。该操作属于
daemon 部署生命周期，不创建 Room 事件、Task 或第二套 Computer 调度队列。

共享重启 handler 在读请求体前认证，并在完整读取与校验后、进入同步 restart
接受点前重验同一会话。期间撤销返回 401 且不调用重启；已接受的操作不因
响应连接关闭或后续撤销而反向取消。这是本地会话合同，不代表已核实 Raft
闭源服务端的在途请求撤销时序。

`startRestartableLocalCoreWorkbench` 是存活于页面外的启动器 owner。它检查
持久执行状态为空闲，保留原监听地址、状态目录与冻结静态资产，调用既有 stop
完成 Core/AgentHost/gateway 关闭后再完整构造新实例。外层 Node PID 保持不变；
不是进程升级，也不是只刷新浏览器或只重置 Agent。已安装 Core 与项目启动器
共用此入口。后继启动失败必须完成既有 startup rollback，再对全部持久忙碌、
孤儿、quarantine 与独占操作围栏检查；等待一秒后再次检查，最多再启动一次。
持续失败通过 launcher 的 `failed` 完成信号通知 loopback、LAN 和安装入口，
由各入口的既有 finally 清理并非零退出，不残留没有服务却无限等待的启动器。
永久配置或端口故障仍需本机排障后启动；不会在已关闭服务之外另建网页救援服务器。

请求绑定当前服务 generation；重启中合并相同 generation，恢复后旧请求拒绝，
因而响应丢失不造成第二次重启。HTTP 连接关闭不会取消已接受的操作。页面仅在
新 generation 且 online 时确认恢复，保留当前 React 页面；正常 client
reconciliation 仍负责业务重新同步。启动器收到退出信号时等待已有重启操作，
再关闭最终实例，避免迟到启动。浏览器不传 PID、路径、shell 命令或 Host 凭据。
首次状态读取失败必须显示可重试的读取错误，不能把传输失败当作没有重启能力。
旧 generation 被拒绝后只重读状态，若已换代则明确是其他请求完成了重启，
不得改用新 generation 再提交或声称旧页面自身请求成功。

验证入口：`node scripts/run-service-restart-browser-gate.mjs`；
初始验收见 [服务重启收口](../audits/2026-09-07-service-restart.zh-CN.md)，
后继有界恢复、终止与双页面回执以
[2026-09-08 恢复专项](../audits/2026-09-08-computer-recovery-closure.zh-CN.md) 为准。

Computer inventory 的可选 `createdAt` 来自 Kernel `agent_hosts.created_at`，
Host 重新连接或工作台重启均保留首次注册时间；Computer transport 的 Host 快照也接受
该可选字段。它不代表 OS 安装日期，缺失时 UI 显示未记录；不根据 current actor 推断创建者。

Runtime inventory 的可选 `cliId` 由 daemon 从 manifest CLI probe 或已知 CLI discovery
取得，前端共享展示函数负责产品名映射。真实版本化路径或脚本入口不是 CLI 身份；旧记录
只保留精确 executable basename 回退，未知 runtime 保留其 displayName。诊断名称不改写。

## Local Core 后台失败传播

启动后的 daemon 非预期退出或拒绝必须关闭其 loopback／LAN gateway，并通过 `RunningLocalCoreWorkbench.failed` 传到当前 launcher。正常 stop 不产生失败；重启时旧 generation 的迟到失败不污染后继。外层不得在 backend 已退出后长期保留一个报告 online 的页面服务。证据见[恢复修复验收](../audits/2026-09-08-core-recovery-repair.zh-CN.md)。

### 仓库工作台启动入口的 LAN 选择（2026-09-12）

`scripts/run-local-workbench.mjs` 现在与正式 service 入口一样接受 `RAH_LAN_ORIGIN`：未指定时保持 loopback；指定 HTTPS origin 时复用现有 LAN gateway、证书与配对机制。`RAH_LAN_BIND_HOST` 默认 `0.0.0.0`，证书覆盖仍用 `RAH_LAN_CERT_PATH` / `RAH_LAN_KEY_PATH`。此模式切换同一入口端口至 HTTPS，不额外启动第二份 Core，也不取消认证。LAN 客户端须信任受管 CA 并配对；Tailscale 不替代应用鉴权。

`workbench-launch-mode.test.mjs` 覆盖未启用与显式启用配置；现有 LAN gateway/local Core 三项测试通过。2026-09-12 本机目标为 HTTPS LAN，但重启仍被未完成 Activation 拦截，因此当次变更不能视为已上线。

随后工作已排空，完成备份与受控重启。正式服务已监听所有接口4173端口，使用HTTPS LAN入口；Chrome新会话通过配对并加载正式Computer页面，构建f5108c4f。TLS通过受管CA校验。跨物理设备访问及设备安装CA仍需各客户端完成。

### 用户指定的单 Human Tailnet HTTP 入口（2026-09-12，取代上节本机部署选择）

用户明确要求 Tailnet 内 HTTP 直连，不使用 HTTPS 或配对码。仓库 launcher 的
`RAH_TAILNET_HOST` 显式选择 `tailnet` 模式，优先于旧 `RAH_LAN_ORIGIN`。
绑定该台 Computer 已有的精确 100.64.0.0/10 IPv4 地址，端口仍由 `RAH_WEB_PORT` 指定。
禁止通配、普通 LAN 地址、域名及越界地址；无此配置仍默认 loopback。
该模式以 Tailnet 网络访问控制为信任边界，不提供应用层设备配对。

此入口复用 LocalWorkbenchGateway 的同源代理和 Host/Origin 校验；按用户后续决定，
Tailnet 模式停用浏览器 session token/cookie 门槛，不发放 cookie，不要求用户输入 token。
Human PAT 保留在服务端，Kernel/Agent 权限及执行栅栏不变，不另建业务处理器。
HTTP 不具备浏览器 secure-context 功能；普通 Web 响应式访问可用，Service Worker、
安装能力与系统通知是否可用由浏览器决定，不能把 HTTP 直连称为完整安装式 PWA 验收。
既有 HTTPS gateway 仍作为兼容能力保留，不再用于此次正式入口。

验证：新增 Tailnet launch-mode、绑定范围拒绝测试；既有 gateway 鉴权、重启会话测试通过。
正式入口需在备份、空闲检查及受控重启后单独验收，不以单元测试证明部署。

本批已完成该 HTTP 模式的正式备份重启；新 Chromium 与 WebKit 无配对加载真实页面，
实际绑定精确 Tailnet 地址，资源构建及移动端验收记录见
[移动端与 Tailnet 部署](../audits/2026-09-12-mobile-navigation-and-task-layout.zh-CN.md)。

2026-09-12 后续用户要求明确停用浏览器 token 门槛；原 session 和 HTTPS 代码保留，
Tailnet 通过 `browserAccess: trusted-network` 绕过浏览器会话检查。重连也不返回 token 表单。
[实现和验收](../audits/2026-09-12-trusted-network-access.zh-CN.md)取代先前“自动 HttpOnly 会话”的当前入口描述。

### 网络入口的所有权：Tailnet 与普通 LAN 分别显式配置（2026-09-16）

网络入口由两个互不派生的决定组成，`scripts/workbench-launch-mode.mjs` 是唯一解释者：

- `RAH_TAILNET_HOST` 只授权该精确 100.64.0.0/10 地址与 `127.0.0.1`，保留用户选择的
  Tailnet HTTP 与停用浏览器 token 门槛策略。
- `RAH_TRUSTED_LAN_HOSTS` 是普通 LAN 受信入口的唯一来源：逗号分隔、逐个显式列出的
  RFC1918 IPv4 地址。重复、回环、非私有、越界、格式错误或与 Tailnet 地址相同的条目
  一律报错拒绝，不做静默去重或跳过。
- 该变量必须与 `RAH_TAILNET_HOST` 同时出现。没有 Tailnet 入口时单独设置它会失败，并
  指向既有的 `RAH_LAN_ORIGIN` 认证 HTTPS/配对网关；不新增第二个 Core，也不新增第二条
  无认证 LAN 路径。

launcher 不再枚举本机网卡推导监听集合。新增或消失的网卡都不改变已授权入口，只有改写显式
配置才能改变。`local-core-workbench.ts` 与 `LocalWorkbenchGateway` 的信任模式合同不变：
trusted-network 仍以网络访问控制为边界，Host/Origin 校验只防跨站，不认证同网其他用户；
普通 LAN 若要做应用层认证，走既有 LAN gateway 的配对/HTTPS 路径。

`scripts/workbench-launch-receipt.mjs` 的收据对已授权入口具有权威性。tailnet 收据回放
`RAH_TAILNET_HOST` 与 `RAH_TRUSTED_LAN_HOSTS`，空 shell 重启按收据复现同一监听集合，既不
降回 loopback 也不扩大范围；收据里记录了 launcher 无法由配置复现的地址时失败并给出明确诊断，
不静默丢弃。写收据时同样校验，避免留下一份重启不可复现的证据。

## 通知租约失效的恢复边界（2026-09-12）

Web Push dispatcher 失去 Outbox 租约后停止通过旧租约写入，并继续由 Kernel 领取工作；
`LeaseConflictError` 不得使整个 daemon 因可恢复的通知租约过期退出。其他存储错误仍上报。
见 [故障审计](../audits/2026-09-12-web-push-lease-crash.zh-CN.md)。

Tailnet HTTP 模式同时在相同端口监听 `127.0.0.1`，由同一个
`LocalWorkbenchGateway` 生命周期管理两个入口；每个入口分别校验自身 Host/Origin，
复用相同 daemon、身份及冻结静态资源。任一入口启动失败须回收另一个入口，停止时关闭两者。
不使用 wildcard 绑定，也不创建第二份持久状态。

Tailnet HTTP 启动器发现本机 RFC1918 IPv4 后，显式加入同端口的局域网监听；保留 loopback
与 Tailnet 入口。过滤公共地址、IPv6、内部接口及 Surge 198.18/15 虚拟地址，不绑定 0.0.0.0。
局域网地址改变需要重新启动以重新发现；任一入口失败回收本次所有监听，避免半启动。

2026-09-13 日志生命周期：显式启动/替换入口在旧进程退出后、打开新日志句柄之前应用统一的 UTC 跨日 / 64MiB / 14 天轮转策略；不对活动写入者执行 rename。Owner 为 agent-host 的 service-log-rotation，Core 启动层复用。详见[日志轮转](../audits/2026-09-13-service-log-rotation.zh-CN.md)。

### evo 家庭局域网／Tailscale 部署采用（2026-10-16）

Owner 随后明确选择免配对的受信网络模式，替代同日早先的 HTTPS／设备配对部署。
沿用现有 `RAH_TAILNET_HOST` 加 `RAH_TRUSTED_LAN_HOSTS` 显式地址配置；同一
LocalWorkbenchGateway 仅监听所选 Tailscale、家庭局域网和 loopback 地址，不绑定 wildcard，
不自动信任新网卡。浏览器无需登录、安装 CA 或配对；能访问这些入口的设备均被视为该 Human。
这不是“网络绝对安全”的保证，也没有删除 Core 的身份、成员权限、执行隔离或 Host/Origin 检查。
已有证书保留但不再用于当前入口。地址变化需显式更新配置并重启。

Web 入口在加载官方模块之前补齐 HTTP 浏览器的 UUID 能力，使用 `crypto.getRandomValues`，
保留安全上下文的原生实现。HTTP 不会因此获得 HTTPS 专属的浏览器权限。
当前部署与验证边界见 [evo状态](../evo/status.zh-CN.md)。

### 并行内网 HTTPS 入口（2026-10-22）

Owner 要求自建内网 HTTPS 并保留现有 HTTP／Tailnet。仓库 launcher 在 `tailnet` 模式下接受可选 `RAH_ADDITIONAL_HTTPS_ORIGIN`，例如 `https://192.168.1.86:4178`。只能使用已在 `RAH_TRUSTED_LAN_HOSTS` 显式列出的私网 IPv4，端口不得与 HTTP 或其 PDF listener 相同；不扫描接口、不启用公网通配绑定。未配置时行为不变。

`local-core-workbench` 仍只创建一个 DaemonApplication。额外入口复用 LanWorkbenchGateway、LanWorkbenchAccessStore、既有 TLS provisioner 和同一个 Human/API owner；HTTP 的既有网络信任策略保持，HTTPS 独立采用设备配对 cookie 和精确 Origin 校验。Core 退出或任一启动失败时关闭两条入口；重启回执保留额外 origin，清除 shell 中未经回执授权的残余配置。

此部署不申请外部证书：复用 data home 中的私有 CA 和按主机签发的证书。客户端只接收 CA 公共证书，私钥不离开 Core；需在各设备信任 CA 后完成首次配对。通知权限、真实推送送达、iOS 主屏幕安装是另行验收项，TLS握手或服务回执不证明送达。旧 HTTPS gateway 尚无 HTTP gateway 专属的工作区 HTML／PDF预览及独立 PDF viewer 路由；这些功能继续使用保留的原入口，不将新增 HTTPS 入口声称为全站功能等价。
