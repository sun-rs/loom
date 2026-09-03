# RAH Core SDK 边界

2026-09-03 RuntimeOffer 长期运行增量边界：`agent-host` 的 Registry schema 4 以内容寻址
payload、immutable report envelope 和 per-revision validation head 分开目录事实与重复验证；daemon
的 30 秒 publisher 只做 executable metadata availability heartbeat，不启动 Provider CLI；Kernel
schema 43 对能力等价的 heartbeat 只推进当前 lease，能力变化才追加不可变 observation。Placement
继续冻结 observation/digest，真实 spawn 前继续复核 executable SHA-256。客户端只显示
`probeObservedAt / probeValidatedAt`，不能自行刷新或推断 Provider 目录。详见
[产品合同](../product/2026-09-03-runtime-offer-catalog-retention-contract.zh-CN.md)与
[验证审计](../audits/2026-09-03-runtime-offer-catalog-retention-verification.zh-CN.md)。

2026-09-03 Room 永久删除增量边界：`HumanApplicationPort.deleteWorkspaceRoom` 是唯一 Human 能力入口；actor 仍只来自认证上下文。schema 42 的 `RoomDeletionService` 在单一 SQLite 事务中持有普通 Channel 权限、freshness、active-work gate、显式 52 表引用图和幂等删除回执；独立 `RoomFileGcService` 以单条 claim、lease-token、指数退避、tombstone 重删和父回执汇总续收提交后的 exact 本地 blob，并用全局/单删除/失败三组索引约束极端 backlog 的同步查询成本；`RoomFiles` 仍是唯一路径/字节 owner；daemon 只提供一个可取消的 60 秒 cadence。HTTP/SDK/Web 只校验、委派和投影确认状态，不能持有第二套删除图或把 archive 当永久删除。详见[永久删除合同](../product/2026-09-03-room-permanent-deletion-contract.zh-CN.md)和[长期运行 Reconciler 合同](../product/2026-09-03-room-file-gc-reconciler-contract.zh-CN.md)。

2026-09-01 typed navigation 增量边界：`NavigationTarget` 是 protocol-owned intent；`HumanNavigation` 在点击时重新检查 canonical existence 与当前 Human ACL，`HumanNotifications` 只持有 Human×Workspace 有界 dismissal preference。daemon shell 可从自己拥有的 current Computer condition 构造通知，但 Web/URL/notification body 不成为业务 owner。`HumanApplicationPort` 新增 resolve/dismissal 三个窄方法；HTTP/SDK 只校验与委派。详见[产品合同](../product/2026-09-01-notifications-typed-navigation-contract.zh-CN.md)。

2026-09-01 增量边界：Human facade 新增 `listMessageSocial/reactMessage/saveMessage/listSavedMessages/getSidebarPreferences/patchSidebarPreferences`。Kernel schema 23 的 `MessageSocial` 是消息回应/私人收藏唯一 owner，`HumanSidebar` 是 Human×Workspace 侧栏排序及个人 Room 显示偏好唯一 owner。后者包含静音普通 Activity 与默认折叠长消息；精确 mention 不被静音。共享回应追加 `message.reaction_changed`，不调用 `deriveAttention`；私人收藏和侧栏/Room 个人偏好不写共享 Room event。HTTP v3 与 RahClient 仅鉴权/校验/委派，Web 不把 localStorage 当业务真相。详见[合同](../product/2026-09-01-message-social-sidebar-contract.zh-CN.md)。

状态：**v0.1 local candidate / Task Coordination v1 / collaboration P2–P3 / daemon v4 fake E2**（2026-08-26）。`@rah-os/core` 已成为 daemon 可直接嵌入的源码级组合边界；它不依赖 HTTP、WebSocket、MCP、UI 或任何 Provider transcript parser。P3 local gate 已证明 Human managed create、Agent catalog/onboarding、Message/Thread context、两个 Activation-scoped Agent Room reply、开放 Task 单 winner、双 placement lane、Human completion与 daemon/client reconnect recovery；业务判定不读取 Provider transcript。该 package 仍为 `private`、导出 TypeScript source，并非已版本化发布的公共 SDK，也不代表 Agent provisioning/editor、Workspace archive、canonical WorkspaceDefinition/mount、Artifact/Review 或真实多 CLI certification 已完成。

## 1. Core 是什么

Core 是一个可单独 import、无界面的业务运行库，而不是 daemon 进程本身：

```text
@rah-os/protocol
  -> @rah-os/kernel            canonical state + transaction + scheduler
       -> HumanApplicationPort frozen Human capability facade
  -> @rah-os/agent-host        RuntimeAdapter + lane execution/recovery
  -> @rah-os/core              source-level headless composition boundary
       <- daemon / tests / future embedded host

application-service / HTTP / SSE / MCP / CLI / Web / Mac / iOS
  -> replaceable shells around Core contracts
```

`RahCore.open()` 持有 SQLite Kernel 生命周期；`core.human` 暴露可直接使用、无需 server 的冻结 Human use-case port；`core.createMultiLaneAgentHost()` 创建绑定到同一 Kernel 的有界多 lane runner。daemon 已经通过 `RahCore` 打开和关闭业务核心。`core.kernel` 暂时只是 Host/control/bootstrap 尚未完成 capability 拆分前的可信、experimental composition escape hatch，不是 UI 或 Human transport contract，也不承诺稳定 ABI。

## 2. Core 拥有什么

| Core owner      | 权威事实                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Identity/ACL    | Principal、Room membership、authenticated actor/Host/Worker scope                                      |
| Collaboration   | Workspace/Room discovery/managed create、Role、Message、Thread、RoomEvent、Inbox、cursor、Outbox       |
| Business flow   | Task、InputRequest 及其显式 command/event 状态机                                                       |
| Scheduling      | Activation、Agent/Policy revision、RuntimeOffer observation、Placement、capacity/workspace reservation |
| Execution proof | RunAttempt、RuntimeProcess、lease、terminal proof、retry/quarantine/recovery                           |

业务完成只来自 Core command 成功提交的 canonical state。CLI exit code、JSONL、终端文本、思考过程、工具调用日志和 UI optimistic state 都不能完成 Task 或推进 Room cursor。

## 3. Core 不拥有什么

以下全部是可替换外壳或插件：

- `node:http` server、REST/SSE/WebSocket/MCP transport；
- daemon/launchd、Unix socket instance lock、安装与升级；
- PWA、Mac App、iOS App、raft-ui 或其他页面状态；
- Codex/Claude Code/Kimi/OpenCode 的启动参数、账号认证和 rich output adapter；
- JSONL/transcript 解析、console log、token/cost/思考展示；
- Keychain/file secret provider 与 Provider credential 内容。

Runtime 插槽只需实现 `RuntimeAdapter` 的 probe/start/reap/cancel/recover。业务 Agent 与 model/runtime/profile 分离；Placement 冻结本次运行选择，adapter 负责执行而不解释业务结果。

## 4. 并发与一致性不变量

1. Room ledger 是共享因果日志，但 Task command 对自己的 Task aggregate 和发给当前 Agent 的新事件做 optimistic concurrency；另一个 Agent 的 Placement、Task 或消息不会错误 fence 本 Task。
2. `scheduleNextPlacement` 在 Kernel transaction 内做 lane、Host generation、Offer、capacity 与 workspace 校验。
3. `claimNextPlacement` 原子消费 reserved Placement、续 Activation lease 并创建唯一 RunAttempt；多个 Host worker 不能重复 launch。
4. `MultiLaneAgentHost.capacity` 只限制本地执行槽；Kernel 的可信 `PlacementCapacityPolicy`、Offer 上限和 durable reservation 仍是权威并发门禁。
5. 同一 participant 永远最多一个 active lane；后续事件形成 queued follow-up Activation。不同 participant 可并发。
6. 某 lane hung、retry 或 quarantine 不允许阻塞其他 participant；未证明旧进程终止时只 fence 本 lane，不能释放资源后双开。
7. Agent 只能把 Task 推到 `submitted`；`completed` 必须由 Task creator 显式验收。Activation completion 也不能代替 Task completion。
8. open Task 只广播给 Room Agent members；每个 Agent 有独立 Inbox/Activation，但 SQLite transaction 只允许一个 winner 写入 `assigneeId/claimedBy`。同一 Task 仍是 single writer，多 Agent 协作用 dependency/后续 Artifact，而不是共享一个 CLI session。
9. dependency 只指向同 Room 的既存 Task；未全部 `completed` 时不产生 Activation。最后一个 dependency 完成后，由同一 `task.completed` event 的 `readyTaskIds` 派生一次 durable attention。

`PlacementCapacityPolicy` 是可信的 Core 启动配置，默认各层并发为 `1`，显式配置后才放宽；有效上限仍取 admin Host/profile/pool policy 与 Offer 的最小值。它解决本机嵌入式 Core 的 R3 门禁，但尚不等于未来可在线修改、经 control Room 审计的 `CapacityPoolRevision`。

## 5. Shell 接入规则

任何新外壳只允许：

1. 把已认证请求翻译成 Core command/query；
2. 把 canonical snapshot/event 投影成自己的 view model；
3. 把 content-free hint 当成“立即 pull”的提示；
4. 把 runtime diagnostics 存到 observation/log 面。

Human HTTP/IPC adapter 只能依赖 `HumanApplicationPort`，不得依赖或保存 `RoomKernel`。嵌入式调用者直接使用 `core.human`；远端 UI 未来通过 `RahClient -> transport adapter -> core.human`。两者调用同一业务 owner，不构成两套 server implementation。完整边界见 [ADR-0013](../adr/0013-human-application-port-and-transport-boundary.md)。

外壳不得持有第二套 Task/session/council 状态机，不得由 provider session ID 决定 Room identity，不得通过解析 CLI 输出推断 `claim/start/submit/complete`。因此新增第 21 个 CLI 的最低成本是一个启动/recovery adapter 与 capability probe，而不是新增一套聊天室消息解析器。

## 6. v0.1 收口门禁

- [x] 独立 `@rah-os/core` package，依赖方向不指向 daemon/application-service/UI；
- [x] daemon 使用 `RahCore` 管理 Kernel 生命周期；
- [x] Placement launch claim 跨连接原子且恰好产生一个 RunAttempt；
- [x] 两个 Agent 在同一 Room 并发执行，A hung 时 B 可提交并验收；
- [x] A 的 follow-up 在旧 lane 退出前不得并发启动；
- [x] 跨 Agent Room 事件不造成 Task stale-context 假阳性，发给本 Agent 的新事实仍会 fence；
- [x] 默认 capacity fail-closed，显式可信 policy 才允许两个 lane；
- [x] 可执行 daemon config v4 支持多 participant + placement-managed runtime；
- [x] MultiLane restart/recovery 与单 lane quarantine 隔离的组合 E2；
- [x] open Task 跨 Kernel connection 原子竞争，loser 可完成 Activation；
- [x] release/assign/block/unblock/cancel 与 immutable dependency ready 派生；
- [x] Worker/Client versioned application-service command surface；
- [x] Workspace/Room discovery、成员增删/角色、Message/Thread 的 causal/idempotent Core 与 Client API；
- [x] Workspace + 唯一 control Room 原子创建，以及 control-seq fenced channel 创建；
- [x] control-Room-visible Agent catalog 与 definition-resolved Room onboarding；
- [x] Human→双 Agent context/开放 Task→单 winner→Human complete→daemon/client reconnect 纵向门禁；
- [x] frozen `HumanApplicationPort` 可直接嵌入，HTTP adapter 不再获得整个 `RoomKernel`；
- [x] Agent/Policy mutation 只允许 managed control Room owner/admin，且 policy revision 不能跨 control Room 引用。

上述门禁允许冻结为“local single-host trusted-config 的多 Agent headless Core candidate”。durable CapacityPool/PlacementHold 不再阻塞 v0.1；Task discussion anchor 已在 schema v9 接通，已有 Message 转 Task、Artifact/Review、Human Workspace 到 runtime mount/cwd 的 canonical 映射和真实 mixed CLI v4 certification 进入 v0.2。完整判断见 [v0.1 收口与竞争性独立审计](../audits/2026-08-26-v01-closure-competitive-audit.zh-CN.md)。
