> 历史路线：本页保留早期 RAH OS 阶段计划与当时状态，不是当前 Loom main 的发布待办。当前入口见[文档索引](README.md)、[目标合同](evo/target-contract.zh-CN.md)和[当前状态](evo/status.zh-CN.md)。下方版本、旧 UI 和未完成描述均须按后继证据解释，不能据此恢复退役代码。

# RAH OS 实施路线与门禁

当前发布范围以[单 Human 主线与多人备选项目](./product/single-human-mainline-and-multi-human-backlog.zh-CN.md)为准。
多 Human 加入、协作及差异化浏览/加入限制延期，不作为首版 Raft 对齐的阻塞项；
保留本地认证、Agent 参与/执行权限和私有记忆隔离。下方历史计划不改变此范围。

状态：**v0.1 local candidate / production provisional**。独立 `@rah-os/core`、Task Coordination v1、schema v16 anchored Task/TaskSubmission/Review 与 collaboration P2/P3 Workspace/Room/Agent catalog/Role/Message/Thread Core + Human API、atomic Placement launch claim 与 MultiLaneAgentHost 已通过 local gate；可执行 daemon config v4 已通过 Human 驱动的双 participant、双 immutable profile、两个 Activation-scoped Agent Room reply、开放 Task 单 winner、验收与重连恢复 E2。Agent/Policy control object 现只允许 managed control Room owner/admin，并禁止跨 control Room policy 引用。Host→Worker 无 Agent PAT delegation、instance generation、deadline、content-free wake、跨进程 CLI/SIGTERM/restart已达到 E2 local；Codex `gpt-5.6-sol/low`、Kimi `kimi-code/k3` 与 OpenCode `deepseek/deepseek-v4-flash/max` 又通过 absolute Worker CLI 的完整 Task gate。Task 连续编号、source Message、唯一 Thread、progress/submission reply anchor 与 frozen Review evidence 已接通；已有 Message 转 Task、Human Workspace 到 runtime mount/cwd 的 canonical 映射、真实 mixed CLI v4/reply certification和可安装 packaging。Artifact/frozen diff、剩余 Client/control/hint API、Windows recovery 和 supervisor artifact lifecycle 尚未通过。

## Phase 0：仓库与协议基线

- 建立 protocol/kernel/agent-host owner。
- 固化 Room、Inbox、Activation、Outbox、RunAttempt 不变量。
- CI 默认只运行确定性测试。

退出条件：所有公开 schema 可验证，文档没有双 owner，默认 gate 不依赖真实 Provider。

## Phase 1：Durable Room Kernel

- SQLite WAL schema。
- Room sequence 与 idempotency。
- Message→Inbox→Activation→Outbox 原子派生。
- client-owned continuation token 或 `deliver -> ackCursor` 两阶段游标确认。
- Activation coalescing、lease、expiry 和 completion。
- authenticated actor context；业务命令不接受可伪造 actor 参数。
- mutation 的 `basedOnRoomSeq` 与 stale-context hold。
- Outbox dispatcher 的 claim、publish、ack、retry 和 reconciliation。

退出条件：

- 重复 mutation 不产生重复派生数据。
- 同一 queued lane 的快速事件合并。
- 两个 Host 竞争只有一个 lease winner。
- lease owner 在 RunAttempt 创建前崩溃后可恢复；已有 active RunAttempt 时必须先 orphan + quarantine，不能双开。
- Activation completion 不伪造 Inbox acknowledgement 或 Task completion。
- sync 响应丢失不会造成事件永久跳过。
- 旧上下文不能静默覆盖较新的 Room 事实；后续业务对象沿用同一门禁。

## Phase 2：本机 AgentHost

当前增量：`@rah-os/core` 已提供 headless lifecycle/command/query/MultiLane 源码级组合边界；Kernel schema v9 与 P2/P3 API 已拥有 Workspace/Room discovery/managed create、control Room authority、Agent catalog/onboarding/provision/get/manage、MembershipRole、Message/Thread、Task 与 durable cursor，Human HTTP adapter 使用同一 `HumanApplicationPort`。`agent.provision` 在单一 transaction 创建长期 Agent principal、不可变 Definition/Policy 和 Host grant；`agent.manage` 原子配置新 revision 或执行安全的暂停/恢复/删除，暂停立即阻断新 Placement，AgentHost cancel active lane并保存 terminal proof，Placement 冻结 revision，AgentHost 把上下文注入实际 child process。`@rah-os/daemon` 组合 compatibility config v2、single-profile v3 与 multi-participant/multi-profile v4；P3 local gate 已串联 Human create/onboard、双 lane context delivery与 canonical Room reply、开放 Task 单 winner、Human completion与 daemon/client reconnect。Worker grant 不需要 Agent PAT；Activation reply 不能选择 actor/Room/recipient，旧 daemon generation、过期 lease/run 或 revoked credential 都会 fence。Remote Computer 已有 launchd constant-supervisor contract、K slots、strict service composition、统一 internal CLI、typed provisioning、shell-free launchctl lifecycle API、离线 Ed25519 release publisher/consumer、Runtime Provider Keychain loader、strict owner-private operator install/stage/activate CLI，以及固定官方 Node carrier 的 darwin-arm64 自包含 SEA/staging gate；Workspace archive、显式 execution restart/session reset、skill/memory artifact、canonical WorkspaceDefinition 管理面、mixed adapter/real CLI v4 recovery/reply certification、Windows recovery、supervisor result GC、attachment/supervisor Keychain 管理、Developer ID/notarization、生产私钥托管/HTTPS publication、operator uninstall/purge、真实 login/reboot/power-loss gate 和正式远程 control endpoint尚未提供。durable CapacityPool/PlacementHold 是未来多 Host 管理面，不再作为 local v0.1 的收口阻塞项。

- Fake adapter 完整覆盖 start/resume/cancel/reap。
- content-free wake WebSocket + reconnect pull backstop。
- process group、timeout、orphan cleanup。
- Linux cgroup v2 / macOS platform primitive 的强 descendant containment；在 escape fixture 通过前不把 process-group proof 宣称为任意 process-tree proof。
- 每 Agent 串行 lane。
- L0 通用进程适配器、L1 ACP/稳定协议适配器、L2 可选原生诊断适配器。
- `AgentDefinition`、版本化 `RuntimeProfile`、`ModelSelector` 与 Provider session 解耦。
- ADR-0009 的 R0–R3 fake Core path 与 config v4 placement-managed daemon slice 已完成：除 strict planner、immutable Offer/Placement provenance 与 crash reconciliation 外，Kernel 现有 atomic launch claim、默认 fail-closed 的可信启动期 capacity policy及 `MultiLaneAgentHost`。组合 E2 证明不同 Agent 并发、同 Agent 串行、restart recovery、quarantine 隔离，以及两个 executable participant 按 policy 进入不同 profile。R1/R4 仍属 provisional，因为 Host 自报 pool label、未持久化 hold、canonical WorkspaceDefinition/mount/model execution和 durable control-Room CapacityPool 尚未收口；这些边界完成前不得宣称生产多 CLI router 已完成。
- 端到端投递证明链，不以 spawn/exit/通知成功替代 read/ack。

真实 CLI gate 顺序：Codex→OpenCode→Kimi→Claude Sonnet。真实 gate 只在明确请求时运行。

退出条件：100% wake 丢失时仍能在声明的 reconciliation SLA 内启动工作；Host 在 lease、spawn、sync 前后崩溃都不会静默丢失 Activation 或产生两个 active lane；未知/损坏 Provider 输出只影响观察平面。

## Phase 3：Task、InputRequest、Artifact、Review

- 已完成 slice：Task Coordination v1 的 assigned/open `todo`、Room Agent 广播与 atomic single-winner claim、`claimed -> in_progress -> waiting_input/blocked/submitted -> completed|cancelled`、Worker release 与 Human assign/unassign/unblock/cancel、older same-Room dependency、dependency-ready wake、独立 claim lease、sidecar heartbeat、activation-scoped query、过期显式 reclaim、跨 RunAttempt canonical resume/稳定幂等重放、causal Worker command、process exit 与 Task completion 分离、未提交 Task 的 Activation completion proof/durable retry。Human assignee 是 claim 前的 reservation，Worker claim 才是执行锁。
- 已完成 slice：InputRequest `pending -> resolved`、Task `waiting_input -> todo`、claim release、designated human Inbox、无模型等待、resolve 后 Inbox/Activation/Outbox 唤醒、跨 Activation Task scope 与 completion proof。
- 已完成 slice：schema v9 为每个 Task 固化 Room 内连续 `taskNumber`、`sourceMessageId` 与唯一 `threadId`；Task 创建原子投影顶层 Message + Thread + Task，Agent progress/submit 原子投影 Thread reply，Human Review 与 process exit 保持分离，旧数据库迁移补齐 anchor。
- 已完成 slice：严格 `task.convert` 将已有顶层 Message 原地转换为 Task，复用已有 Thread、保持 Room 内连续编号并拒绝 Thread reply；Web 只在右键/长按上下文菜单暴露入口，本地真实 Chrome 门禁覆盖转换、Agent 执行、Thread history 与 Human completion。
- 已完成 slice：Tasks 页面“新建任务”通过 Raft dialog 复用 `task.create`，支持 title、可选 description/assignee；本地真实 Chrome 证明看板卡片、Chat 顶层 Message、唯一 Thread、Agent submit 与 Human completion共用同一 canonical Task。
- 已完成 slice：Human 显式 Task 支持一个负责人、协作者与审阅者；Agent 对未标记 Message 只有在长期、多步骤、持久修改、持续进度/恢复或验收语义成立时才可调用 causal `task-claim-message`。`source_message_id` 保证并发转换只有一个 winner；工具调用、文件/网页读取和日期查询本身不构成 Task。协作者在创建后、审阅者在提交后进入同一 canonical Task Thread，同一 Activation 批次可同时履行两个角色。2026-08-29 的三家真实 CLI 门禁与正式 Web 浏览器均证明日期问答为三条 Message/零 Task，持久请求收敛为一个 submitted Task/owner/结果；桌面和 `390x844` 共用投影。协议见 [ADR-0020](./adr/0020-task-intent-single-owner-and-secondary-roles.md)。
- 已完成 slice：schema v16 将每次 owner submit 固化为带 canonical digest 的不可变 TaskSubmission；selected reviewer 使用 activation-fenced `task-review` 写独立 `approved|changes_requested` Review。要求修改会重开 assigned Task，下一次提交产生新 digest，旧 Review 失效；全部当前 reviewer 通过后 creator Human 才能完成。Client v3/Web 显示 submission number、通过数和短 digest，旧 schema v15 提交可从 ledger backfill。真实 Chrome 与应用内浏览器均完成 Kimi owner → Alice review → Human complete，协议见 [ADR-0021](./adr/0021-frozen-task-submission-and-canonical-review.md)。
- 已完成 slice：按 [ADR-0022](./adr/0022-reversible-closed-and-runtime-cancellation-fence.md)实现可逆 Closed。Human cancel 在同一 transaction 固化 activation attempt cancellation request；旧 Worker 立即 fence，AgentHost 取消真实 Runtime、保存 terminal proof、结束 RunAttempt、合并 queued follow-up 后才允许 creator `task.reopen -> todo`。Client v1/v2/v3、SDK、Web 弹窗、1440x1000 Chrome、390x844 共享路径及应用内浏览器均已验证。
- 已完成 slice：Human Inbox 将当前 Human 在全部可见 Room 的 pending InputRequest 投影到 Raft NotificationCenter；desktop rail 与 390x844 bottom navigation 共用同一 owner。真实浏览器完成 Worker request → `waiting_input` → Human resolve → 新 Activation → submitted，且不把 Computer-local Agent App Inbox 混入 Human Inbox。
- 下一步：Human 强制改派必须组合 Closed 的 cancel/fence/resolve/assign，不新增绕过 terminal proof 的写路径；随后进入通用 Notifications/Search/deep link 与 Artifact/frozen diff，同一 Task 继续保持 single writer。
- 已完成 slice：Client API v1/v2 compatibility 与 v3 managed create、Workspace/Room discovery、成员增删/角色、Message/Thread read/write、Room `sync/ack` delivery proof、Task/InputRequest list、Task create/assign/unblock/cancel/reopen/complete、designated-responder resolve 与 daemon lifecycle/E2。
- InputRequest cancel/expire、structured answer、通知升级，以及 Workspace/Room archive、Inbox/Artifact 等剩余 Human Client command surface。
- 显式 artifact registry。
- frozen diff / Artifact review evidence；TaskSubmission/Review v1 已完成。
- worktree lease 和 verifier。

## Phase 3.5：Memory 与 ContextManifest

- 已完成基线：schema v11 为每个新 RunAttempt 原子冻结带 canonical digest 的 ContextManifest v1，覆盖 Activation Room range、AgentDefinition 的 instruction/skill/memory content refs、RuntimeProfile 与 Workspace mount；本机/远程 Computer launch 均把它注入真实子进程。历史旧 Run 保持可读但可无 manifest。
- 已完成基线：吸收 Raft Computer 1.0.18 的 Workspace Pack 可验证边界，形成 RAH-owned browser-safe protocol 与 rollback-capable installer；受限路径、file/total budget、hash、marker、symlink/owner/mode 和幂等替换已有门禁。
- 已完成增量：授权 Raft `MEMORY.md + notes/` workspace、64 KiB cleaner、typed transient Computer-local App Inbox 和下一次真实 Activation 注入已接入本机/远程 Runtime composition；同 Agent 跨 Room/Profile/daemon 连续、不同 Agent 隔离。每个 RunAttempt 现有 Computer-owned exact file materialization receipt。本机 Human API/UI 可有界查看 index/notes，并以 Kernel global fence + Memory/Provider continuity 双 quarantine + 幂等 receipt 安全 reset；桌面和 PWA 已完成真实浏览器门禁。
- 未完成：autonomous maintenance lane、跨 Computer single-writer handoff/remote Human Memory control、canonical Artifact/Skill 内容 registry、Server pack assignment、Memory record/promotion/retract 与检索质量门禁；不能把“Computer 已 materialize”描述成“模型已阅读”，也不能把本机 Memory 产品描述成多 Computer 已收口。
- Room history、Agent private scratch、shared knowledge 与 Provider session memory 分层。
- Memory candidate、promotion、supersede、retract、scope、provenance 和 version。
- 每个 RunAttempt 固化 `ContextManifest`，记录实际注入的 Room 范围、Task、Artifact 与 Memory 版本。
- 共享记忆写入需权限、冲突与敏感信息门禁；检索命中不等于事实成立。

## Phase 4：最小 Room UI

只在前述 owner 稳定后提供 Room、Thread、Task、Inbox、Run Inspector 和 Review 页面。UI 只消费 canonical snapshot/delta，不解析 Provider 输出。

当前增量：Phase 4B 已导入带 SHA-256 provenance 的 Raft UI reference snapshot，并以八文件 allowlist 生成 product-owned `ui-tokens`；新增 Tasks 官方 computed-style 变量也经 snapshot digest 校验，产品不直接依赖 raw snapshot。`RahClient` 覆盖全部现有 Human API v3 route；`client-core` 已修复稳定 consumer 冷启动时 durable cursor 领先导致的 gap，并提供 Room/Message 有界 catch-up。MessageSession 现统一采用 Raft 的 latest/backward 50 条窗口；真实 Chrome gate 证明 130 条 canonical 历史首屏只载 50 条、向上分页追加 50 条且稳定 Message viewport 锚点误差不超过 2px。独立真实 `ChatPane` 大历史门禁又证明 10,000 条变高 Message 加载、再 prepend 50 条后 Mounted Message DOM 不超过 80 行且锚点仍在 2px 内；该预算已完成，不以 Raft Chat 自身已虚拟化作不实来源声明。Web 已接通跨 Workspace product Room discovery/create、Room sync/ack、Message list/post、Thread list/create/reply 与 Task list/create/assign/unassign/complete；Task 现在拥有 Room 内连续编号、顶层 Message anchor 和唯一 Thread，Agent progress/submission 作为该 Thread 的 canonical reply。creator 可在未领取 `todo` 卡片用 Raft 规格负责人菜单做预分配/清除，真实 Chrome 已覆盖 Escape、分配、取消、刷新恢复及 390x844；Worker claim/release 仍是独立执行锁。页面展示 Agent winner/progress/submission，具备无重叠 reconciliation、visibility wake、失败退避、重新连接和 capability-aware degradation。全局 Agent 长期身份目录、Computer/Runtime inventory 和 Room membership 已有独立交互 owner；Workspace manager 可从 Raft 形态 dialog 创建、版本化配置、暂停/恢复/删除带真实 Runtime binding、角色与指令的持久 Agent，加入/移出 Agent 只从当前 Room 成员窗口发起。Agents → 动态现由 typed `agent.activity.list` 把 Room event 与 version-fenced Managed MCP call metadata 合并为跨 Room、有界分页、当前 Human ACL 过滤的 canonical activity history，并提供最多 200 条/64 KiB 的白名单诊断复制；Room Chat 的瞬时状态仍单独由 Activation/RunAttempt 推导，两者都不把 Provider transcript/stdout/ANSI 当真相。Runtime Profile v3 又把机器可读 model catalog、probe evidence、Agent model/reasoning policy、Placement 与 child argv 串成同一可执行链；缺少目录证据的 Runtime 只显示默认。Computer inventory 以 resolved executable identity 合并 Quick Start 的绝对路径与 PATH alias，不再把同一 Codex/Kimi/OpenCode 重复显示，同时保留真实不同安装。普通聊天现按 Raft channel 语义从 membership 派生全部 enabled Agent delivery，`@mention` 只提升 attention。无需浏览器 Token 的可重复真实 daemon gate已完成创建/编辑/暂停/删除持久 Agent → 新建 channel → 加入双 Agent → Human Message → 双 Agent reply → 移出 Agent，并保留 open Task → 单 winner submit → Human Review/complete → owner reservation/unassign/reassign → reload recovery gate。ADR-0017 增加 production bundle、持久化 state 和 loopback gateway；ADR-0019 新增正式 HTTPS LAN edge、设备 pairing/撤销、Raft 形态设备管理与 PWA shell，并由 fake CLI + 真实 Chrome 证明配对、Core restart session 恢复、设备列表/配对码/撤销确认、service worker ready 与 390x844。系统/iOS CA trust 安装与 CA 轮换/告警、真实 iOS Home Screen、Files/Provider-native tool diagnostic、execution restart/session reset、skill/memory，以及 Human 强制停止 work 后的成员移出语义仍是明确缺口，不使用 reference fixture 伪造成功。

macOS Local Core 已形成不依赖源码 checkout、Node、npm 或 `node_modules` 的单一 ad-hoc-signed SEA + Web/PWA manifest 制品；同一二进制内置 install/uninstall operator，可生成无 secret plist、完成 manifest/runner/Web/Workspace preflight、原子 stage、显式 activate/replace、60 秒 gateway health proof，以及“默认保留数据/显式 purge”的卸载门禁。`install --quick-start` 以一个明确授权创建 owner-private `~/RAH OS Workspace`、固定 loopback Web 并激活 per-user LaunchAgent；高级 LAN、自定义 workspace 与 staged install 仍走显式参数。真实当前用户 login domain 已完成一次制品 activation → 四 CLI/版本发现 → `/_rah/health` → uninstall；失败 readiness 也已证明自动 bootout，不留下 `KeepAlive` 循环。仍缺 Developer ID/notarization、图形化安装与 workspace chooser、登录后自动启动与 reboot/power-loss gate，因此尚不能称为可对外分发的正式 Mac 安装包。

- 首先交付纯浏览器、响应式 Web UI 和 `RahClient` contract；
- 同一 bundle 验证 Mac 浏览器与 iOS Home Screen PWA；
- 再增加 thin Mac desktop shell，负责 daemon 安装/连接及窄原生能力；
- 原生 iOS App 必须由单独 ADR 和 PWA 无法满足的实测需求触发。
- 代码 owner、RaftUI 单向输入、PWA cache、可移植 Client Core、性能预算与跨端复用边界遵循 [ADR-0010](./adr/0010-web-pwa-shared-ui-and-native-shell.md) 和[前端平台架构](./architecture/frontend-platform.zh-CN.md)；Phase 4 前只允许 evidence、fixture、contract 与测试 harness，不以 mock route 提前定义 Kernel 行为。

## Phase 5：迁移与 Connector

- 旧 RAH 只作为可选 Runtime/UI connector。
- 迁移必须通过导出/导入协议和独立 ADR。
- 不导入旧 transcript 作为 Room truth。
- 后续评估 Remote AgentHost、A2A、Raft/Matrix connector；ACP 已进入 Phase 2 的标准 runtime boundary。

## 跨阶段声明门禁

“优于既有多 Agent 工作站”“避免多 CLI 解析地狱”“可靠唤醒”“跨 session 长期记忆”等对外声明，必须通过[竞争性基准](./experiments/competitive-benchmark.zh-CN.md)中对应场景，并保留可复现证据。架构文档中的目标能力不等于已实现能力。
