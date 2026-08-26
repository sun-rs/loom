# RAH OS 实施路线与门禁

状态：**provisional**。独立 `@rah-os/core`、Task Coordination v1、atomic Placement launch claim 与 MultiLaneAgentHost 已通过 fake 多 Agent并发/开放任务竞争/串行/restart/quarantine business gate；可执行 daemon config v4 又通过双 participant、双 immutable profile、Placement-selected external Worker E2。Host→Worker 无 Agent PAT delegation、instance generation、deadline、content-free wake、跨进程 CLI/SIGTERM/restart，以及 Codex/Kimi/OpenCode/Claude Code Sonnet compatibility delivery gate 已达到 E2 local。canonical Workspace/Capacity control object、真实 mixed CLI v4 certification、可安装 packaging、剩余 Client/control/hint API、Windows recovery和 supervisor artifact lifecycle 尚未通过。

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

当前增量：`@rah-os/core` 已提供 headless lifecycle/command/query/MultiLane 组合边界；`@rah-os/daemon` 通过它组合 compatibility config v2、single-profile v3 与 multi-participant/multi-profile v4。v4 精确校验 Host credential scope，启动时 probe/freeze 每个 active profile revision，发布 redacted workspace-aware Offers，由 Kernel Placement 选择 `runtimeOfferId`，再由 bounded MultiLane runner 启动 scoped Worker。Worker grant 不需要 Agent PAT；旧 daemon generation、过期 lease/run 或 revoked credential 都会 fence。canonical Workspace/Capacity、mixed adapter/real CLI v4 recovery certification、Windows recovery、supervisor result GC、Keychain、launchd、签名/安装和 control endpoint 尚未提供。

- Fake adapter 完整覆盖 start/resume/cancel/reap。
- content-free wake WebSocket + reconnect pull backstop。
- process group、timeout、orphan cleanup。
- Linux cgroup v2 / macOS platform primitive 的强 descendant containment；在 escape fixture 通过前不把 process-group proof 宣称为任意 process-tree proof。
- 每 Agent 串行 lane。
- L0 通用进程适配器、L1 ACP/稳定协议适配器、L2 可选原生诊断适配器。
- `AgentDefinition`、版本化 `RuntimeProfile`、`ModelSelector` 与 Provider session 解耦。
- ADR-0009 的 R0–R3 fake Core path 与 config v4 placement-managed daemon slice 已完成：除 strict planner、immutable Offer/Placement provenance 与 crash reconciliation 外，Kernel 现有 atomic launch claim、默认 fail-closed 的可信启动期 capacity policy及 `MultiLaneAgentHost`。组合 E2 证明不同 Agent 并发、同 Agent 串行、restart recovery、quarantine 隔离，以及两个 executable participant 按 policy 进入不同 profile。R1/R4 仍属 provisional，因为 Host 自报 pool label、未持久化 hold、canonical Workspace/model execution和 durable control-Room CapacityPool 尚未收口；这些边界完成前不得宣称生产多 CLI router 已完成。
- 端到端投递证明链，不以 spawn/exit/通知成功替代 read/ack。

真实 CLI gate 顺序：Codex→OpenCode→Kimi→Claude Sonnet。真实 gate 只在明确请求时运行。

退出条件：100% wake 丢失时仍能在声明的 reconciliation SLA 内启动工作；Host 在 lease、spawn、sync 前后崩溃都不会静默丢失 Activation 或产生两个 active lane；未知/损坏 Provider 输出只影响观察平面。

## Phase 3：Task、InputRequest、Artifact、Review

- 已完成 slice：Task Coordination v1 的 assigned/open `todo`、Room Agent 广播与 atomic single-winner claim、`claimed -> in_progress -> waiting_input/blocked/submitted -> completed|cancelled`、release/assign/unblock/cancel、older same-Room dependency、dependency-ready wake、独立 claim lease、sidecar heartbeat、activation-scoped query、过期显式 reclaim、跨 RunAttempt canonical resume/稳定幂等重放、causal Worker command、process exit 与 Task completion 分离、未提交 Task 的 Activation completion proof/durable retry。
- 已完成 slice：InputRequest `pending -> resolved`、Task `waiting_input -> todo`、claim release、designated human Inbox、无模型等待、resolve 后 Inbox/Activation/Outbox 唤醒、跨 Activation Task scope 与 completion proof。
- 下一步：Task 父子关系/Artifact/Review 与更完整 crash recovery matrix；同一 Task 继续保持 single writer。
- 已完成 slice：Client API v1 health/capabilities、Room `sync/ack` delivery proof、Task/InputRequest list、Task create/assign/unblock/cancel/complete、designated-responder resolve 与 daemon lifecycle/E2。
- InputRequest cancel/expire、structured answer、通知升级，以及 message/Inbox/Artifact/Review 等剩余 Human Client command surface。
- 显式 artifact registry。
- frozen review evidence。
- worktree lease 和 verifier。

## Phase 3.5：Memory 与 ContextManifest

- Room history、Agent private scratch、shared knowledge 与 Provider session memory 分层。
- Memory candidate、promotion、supersede、retract、scope、provenance 和 version。
- 每个 RunAttempt 固化 `ContextManifest`，记录实际注入的 Room 范围、Task、Artifact 与 Memory 版本。
- 共享记忆写入需权限、冲突与敏感信息门禁；检索命中不等于事实成立。

## Phase 4：最小 Room UI

只在前述 owner 稳定后提供 Room、Thread、Task、Inbox、Run Inspector 和 Review 页面。UI 只消费 canonical snapshot/delta，不解析 Provider 输出。

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
