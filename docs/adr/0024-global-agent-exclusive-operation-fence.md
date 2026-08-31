# ADR-0024：全局 Agent 独占管理操作 Fence

状态：Accepted（Kernel + 本机 AgentHost control + Memory reset 产品接线已实现）\
日期：2026-08-30

## 背景

RAH OS 已保证一个稳定 Agent participant 最多只有一条 canonical execution lane；不同 Room 的 Activation 会合并或排队，而不会让同一 Agent 并发执行。但 Memory maintenance、workspace reset、安全强制改派和 execution restart 都是 lane 外的管理操作。若这些操作只使用 Computer 进程内 mutex，另一台 Computer 或 Kernel scheduler 仍可能启动同一 Agent，造成两类错误：

- reset 正在移动 `MEMORY.md`/Provider continuity 时，新 Runtime 已开始读取或写入；
- 旧 Task owner 的 Runtime 尚未有 terminal proof，新 owner 已被分配并开始执行。

普通 TTL lease 也不安全。若 owner 在不可逆或跨文件系统步骤中失联，TTL 到期后自动放行会把“不知道操作是否完成”错误解释为“操作没有发生”。

## 决策

### 1. Kernel 是全局 fence owner

新增 `AgentExclusiveOperationLease`，以稳定 `participantId` 为唯一并发域。它属于 Kernel control plane，不属于 Room、Task、Provider session 或某台 Computer 的本地队列。

支持的首版 kind：

- `memory_maintenance`
- `memory_reset`
- `execution_restart`
- `task_reassignment`

每个 lease 固定：`leaseId`、外部 durable `operationId`、participant、kind、Host ID、Host instance generation、acquired/renewed/lease-until/released 时间。一个 participant 最多一条 active lease；同一个 `operationId` 只能描述同一目标、kind 和 Host generation。

### 2. acquire 必须证明 canonical lane 静止

Host 只能为自身 credential 明确授权的 Agent acquire。Kernel 在同一 transaction 中拒绝以下任一状态：

- leased/quarantined Activation；
- reserved/consumed Placement；
- starting/running/orphaned RunAttempt；
- 没有 terminal proof 的 RuntimeProcess；
- 另一条 active exclusive operation lease。

queued Activation 可以保留；active fence 会阻止它被 compatibility lease 或 Placement scheduler 领取。这样管理操作结束后无需丢弃新的 Room 事件。

### 3. expiry 只表示 owner 失联，不自动解除 fence

`leaseUntil` 用于健康与恢复判断，不是安全释放条件：

- 同一 Host generation、同一 `leaseId` 可以 renew 或 release，即使心跳曾短暂过期；
- scheduler、legacy lease 和 Placement claim 对所有 active row 一律 fail closed，不因 `leaseUntil` 过去而忽略；
- 不同 Host generation 不能用普通 acquire/renew/release 接管；后续 recovery 必须检查具体操作的本机 receipt/quarantine/runtime terminal evidence，再产生显式 recovery audit。

因此 crash 可能暂时阻塞一个 Agent，但不会静默产生双执行或半 reset 后继续运行。

### 4. acquire 不是业务授权

Host fence 只证明“现在可以独占操作”，不证明 Human 已授权 reset/reassign：

- Human/API 仍需创建各自的 durable operation 并做 ACL、确认和 causal 检查；
- Host 只能执行 operation payload 中固定的 typed action，不能借 fence 修改 Room/Task；
- `task_reassignment` 的业务 saga 仍是 cancellation request → Runtime terminal proof → reopen/unassign → assign；fence 不能跳过其中任何一步。

### 5. 与 Memory 和 restart 的组合

- `AgentMemoryCoordinator.resetWorkspace` 使用 `memory_reset` fence，并继续执行 Memory + Provider continuity 双 quarantine、receipt、失败回滚。
- autonomous cleaner 使用 `memory_maintenance` fence；maintenance Runtime 不获得 Worker Room credential。
- execution restart 先走现有 Activation cancellation/terminal-proof 协议；取得 `execution_restart` fence 后才能提交 retry/restart 的最终控制步骤。

## Phase 1 实现边界

本轮只完成：

1. protocol schema/type；
2. Kernel durable table、acquire/renew/release 与查询；
3. legacy Activation lease、Placement planner 与 Placement claim 三重调度 fence；
4. AgentHost control port 暴露同一能力；
5. 单元/多 Kernel connection/过期 fail-closed/Host generation fencing 测试。

Phase 1 当时不开放 Human reset/reassign/restart UI，也不把 lease expiry 当恢复。随后 Memory reset 已通过 Human application service、正式本机 daemon 与 Agent UI 接通；远程 Computer HTTP transport、operation recovery、execution restart/reassign 和 autonomous maintenance runner 仍是后续接线层。

## Phase 1 实现证据

- Kernel schema v18 已持久化 per-Agent active fence；acquire/renew/release 固定 Host generation，并限制租期最大五分钟。
- compatibility Activation lease、Placement planner、Placement pull/claim 和 RunAttempt 创建均 fail closed；queued Activation 保留，释放后继续调度。
- 本机 `AgentHostControlPort` 已暴露 fence；`AgentMemoryCoordinator` 在从 stable participant + Human idempotency key 生成 deterministic reset operation identity 后取得同一个 Kernel fence。
- reset receipt 成功，或失败后 Memory/Provider continuity/cleaner config 全部回滚，才释放 fence；任何回滚失败都保留 active fence，等待显式恢复。相同 operation receipt 会 deduplicate，避免重放请求清除下次 Activation 已重新 seed 的 workspace。
- Human reset route 会先通过 Workspace Agent management ACL 解析稳定 participant，要求固定确认字面量，公开响应不泄露 quarantine path。桌面/PWA UI 已验证二次确认与取消；实际破坏路径由隔离 integration tests 证明。
- 协议、Kernel、多 Kernel connection、过期、Host replacement generation、Placement、正式 daemon composition 与 memory reset 集成测试已通过。远程 Computer control/recovery 仍未实现，因此本机按钮可用不等于跨 Computer reset 已完成。

## 验收门禁

1. queued Activation 存在时可以 acquire，acquire 后任何 Host 均不能 lease/placement/claim；release 后同一 Activation 可继续。
2. leased/quarantined Activation、active Placement、nonterminal RunAttempt/RuntimeProcess 任一存在时 acquire 必须失败。
3. 两个 Kernel connection 并发 acquire 同一 participant 只有一个成功。
4. lease 心跳过期后仍阻止调度；错误 Host、错误 generation、错误 lease/operation identity 不能 renew/release。
5. Agent A 的 fence 不阻止 Agent B；Room 不参与 fence identity。
6. 数据库重启后 active fence 仍存在，不因进程退出或时间流逝消失。

## 与 Raft 的关系

Raft Computer 的 active notice、idle restart snapshot、workspace reset 和 Agent restart 交互作为成熟行为基线复用；本 ADR 增加 RAH OS 本机核心/多 Computer 场景所需的 durable global fence。不会复制 Raft `rm(..., recursive, force)` 而缺少 terminal proof 的危险实现。
