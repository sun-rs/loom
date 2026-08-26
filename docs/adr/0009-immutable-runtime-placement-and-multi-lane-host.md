# ADR-0009：不可变 Runtime Placement 与 Multi-Lane AgentHost

状态：**Accepted in stages / R0–R3 implemented / narrow R2a–R2b implemented / R5 daemon v4 fake slice implemented / R1–R4 provisional**（2026-08-26）。严格 schemas、pure planner、Kernel schema v6 Placement projections、startup-owned certification/capacity、immutable Offer observation、durable Placement/RunAttempt provenance、atomic multi-lane launch claim、MultiLaneAgentHost、Host-local immutable Runtime Profile/Probe Registry、spawn-time secret binding、旧 revision recovery routing，以及 daemon config v4 的多 participant/多 profile Placement 路由已实现。durable hold、control-Room CapacityPool、canonical Workspace/model binding、mixed adapter recovery 与 real CLI v4 certification 尚未实现。

## 背景

当前 daemon composition 把一个 Host credential、一个 Agent participant、一个 GenericProcessAdapter 与一个 runtime config 固定绑定。`AgentHost.reconcileOnce()` 又会等待这一 runtime 完整结束才领取下一条 Activation。直接把 config 改成 runtime 数组无法回答：Agent identity 是否随 CLI 改变、谁拥有 profile、模型/effort 如何验证、Host capability 是否可信、配置更新如何保留 provenance、如何执行容量/工作区约束，以及旧 runtime 由谁恢复。

多 Agent core 必须在不引入 Provider transcript parser、不产生第二套 Activation queue、也不削弱 Host/Worker authority 的前提下解除这一绑定。

## 决策

1. Agent identity 与 runtime 完全分离。Kernel 拥有稳定 `AgentDefinition` 及不可变 `AgentDefinitionRevision/ExecutionPolicyRevision`；Host-local Runtime Registry 拥有稳定 profile 与不可变 `RuntimeProfileRevision`。切换 profile/model 不改变 participant、Room membership、Task、cursor 或 memory scope。每个跨 Room Kernel control object（Agent、policy、capacity pool、workspace definition）固定一个 control Room；配置 mutation 使用该 Room 的 ACL、`basedOnRoomSeq`、event ledger 与 Outbox，不创建第二套全局 control ledger。

2. Host 只向 Kernel 发布带 TTL、redacted、digest-bound 的 `RuntimeOffer`。offer 表示一台 Host 当前可提供某个 profile revision，不携带 secret、本地路径或业务 authority。discovery/declared capability 不自动成为 authorized offer；安全/恢复 hard constraint 需要 probed/certified evidence。

3. Kernel placement 采用两阶段确定性算法：先按 Agent policy、Host authority、capability、model mapping、workspace、capacity 和 recovery/isolation 做 hard filter，再对 feasible offers 按显式 preference、session/workspace locality、结构化失败 penalty 与 load 做有界整数 soft scoring。Hard constraint 永远不能被高分越过；tie-break 稳定，Placement 保存 redacted candidate set digest、拒绝原因与评分 evidence，而不只记录赢家。

4. 每次分配创建 durable `PlacementDecision`，冻结 Agent/policy revision、Host generation、offer、profile revision/digest、protocol family、`ResolvedModel`、workspace、capacity pools 和 scheduler version。显式 model binding 冻结 provider/model/reasoning/tier；runtime default 只记录“未发送 model selector”，不伪造未知 model ID，也不承诺 Provider 默认值不变。RunAttempt 引用该 placement；未来 config/profile/policy 修改不能篡改历史。

5. `ModelIntent` 与 `RuntimeModelBinding` 分离。portable `high` 只有在具体 adapter binding 明确支持并验证映射时才成立；缺少 mapping 时 hold/fail 或按显式 fallback，禁止静默发送猜测字段。runtime default 与 high 不是同义词。

6. Kernel 在同一 transaction 中 lease Activation、reserve Placement/capacity/workspace，并重验 Host generation 和 participant lane。Host 必须解析完全相同的 profile revision + digest，不能退回当前默认 profile。有效容量取 Host 当前 offer 与 admin-owned Host/profile/pool cap 的最小值，并只按 Kernel reservation 计数；pool membership 也由 admin 授权，Host 不能自造 pool ID 绕过共享账号限额。Workspace canonical identity 由 Kernel 拥有，本地 path/mount revision 只由 Host registry 拥有，Placement 冻结两者的 redacted linkage。无可用 runtime/capacity/workspace 时 Activation 保持同一 durable queue，并产生可重算 PlacementHold，而不是第二套任务队列或虚假 Task failure。

7. Placement 由 Kernel 对所有 fresh offers 的一致 snapshot 作出；Host 不能先 lease 裸 Activation 再本地挑 runtime，也不能由轮询先后决定归属。Kernel 原子 reserve 后通过可丢失的 content-free hint 唤醒目标 Host，Host 只 pull 分配给其 authenticated generation 的 placement，固定 reconciliation 负责丢 hint 恢复。新 `MultiLaneAgentHost` 以 bounded capacity filler 驱动独立 LaneRunner。一个 participant 最多一条 active lane，但不同 Agent 可并发；每条 lane 独立续租、Worker grant、timeout、cancel 与 terminal proof。candidate scan 遇到 held/unschedulable Activation 后继续寻找 feasible work，避免队头阻塞；一个 hung/offline profile 不阻塞其他 Agent。shutdown 停止新 placement 后并发 drain，单 lane cleanup 失败不跳过其他 lane。

8. Orphan recovery 按已持久化 RuntimeRecoveryDescriptor.driver 路由到兼容旧 revision 的 adapter，不按 Agent 当前 profile。revision 被非 terminal RuntimeProcess 引用时不得删除。

9. 初版继续使用 Host credential 的显式 participant whitelist，但允许多个 participant；新增/移除 scope 通过 credential rotation。Host offer 不能扩大 credential scope。动态 HostAgentGrant 留给独立安全 ADR。

10. 实施严格按 R0 protocol/pure planner → R1 Kernel/provenance → R2 local registry → R3 fake multi-lane → R4 workspace/session/model → R5 mixed daemon E2 → R6 opt-in real CLI certification 推进。本文本身不授权付费 CLI gate。

## 采用的外部经验

- Multica：采用 daemon discovery、computer+tool runtime offer、custom protocol family、capacity 和 Agent/runtime/model 分离；拒绝让 rich output parser 进入 business proof。
- Raft：采用 runtime 切换后保留 identity/workspace/memory、mixed runtime 和 Human-owned runtime setting；增加不可变 revision 与 per-Run placement evidence。
- ACP/AHP：采用 capability negotiation、typed session config 及上层多客户端/下层 1:1 runtime 分层；不把 ACP/AHP session 变成 RAH Room 或 scheduler owner。
- Nomad/Kubernetes：采用 feasibility filter、hard constraint、soft affinity、capacity allocation 与 deterministic plan；不引入通用集群 scheduler 表达式语言。
- LiveKit Agents：采用 explicit dispatch、load threshold 与 drain；不把 job dispatch/result 当 delivery 或 Task proof。

详细对象、算法、来源和 TDD matrix 见[Runtime Registry 与多 Lane 调度架构](../architecture/runtime-registry-and-multi-lane-scheduling.zh-CN.md)。

## 后果

正面：

- 多 Agent/多 CLI 不需要核心解析几十种 JSONL；
- Agent、runtime、model、session 与 Run provenance 可独立演进；
- config 更新、Host restart 和 runtime fallback 不改写历史；
- scheduler 结果可解释、可复现、可 fail closed；
- 一条 lane 的阻塞不会串行拖住整个 daemon。

代价：

- Kernel schema、Host registry、daemon config 与 RunAttempt provenance 都需迁移；
- 需要新的 placement/capacity/workspace lease 故障矩阵；
- profile lifecycle 与 recovery retention 比简单 runtime 数组更复杂；
- remote Host、动态 authorization、adaptive model routing 和 production secret isolation 仍需后续 ADR。

## 声明边界

- 当前 R0–R3 fake Core path 与 R5 config v4 fake slice 已完成；R1/R1.1 provisional 已有 control Room 配置修订、server-bounded/monotonic offer head、Kernel-trusted content-addressed certification、append-only Offer observation、durable PlacementDecision、原子 reservation/launch claim、定向 Host pull、多个 crash window 的 lease recovery、Host/recovery generation fencing、RunAttempt provenance、可信启动期 capacity 与 MultiLaneAgentHost；窄 R2a/R2b 已有 Host-bound owner-private registry、strict v1/v2 manifest/digest、immutable revision/probe、版本化 adapter/recovery resolution、spawn-time secret slot、旧 revision recovery provenance/routing、显式 lifecycle/local audit及 redacted Offer publisher；config v4 已精确校验多个 participant、probe 多个 active profile、发布 workspace-aware Offer，并按 Placement `runtimeOfferId` 执行两个外部 Worker。仍没有 authenticated registry admin command、PlacementHold、durable CapacityPool、canonical Workspace/model execution或 real CLI v4 certification；
- R1 compatibility scheduler 对 Host/profile/pool 使用显式保守并发上限 `1`；在 canonical Room→WorkspaceDefinition mapping 尚未由 R4 实现前，只接受所有 fresh offer 唯一一致的 workspace identity，多 workspace 输入 fail closed；
- capability/isolation 的 `certified` 必须引用 Kernel startup catalog 中 subject/digest 匹配的 certification；Host 自报 certified model binding 被拒绝。`probed` 与 pool label 仍只是 Host observation，不能冒充 admin/certification authority；
- PlacementHold、Agent disable/tombstone、完整 model fallback 与原子 LaneRunner claim 仍是 design-only；
- [2026-08-26 独立审计与整改](../audits/2026-08-26-runtime-placement-independent-audit.zh-CN.md)是进入 R2 的当前门禁；
- external projects 的文档是设计输入，不是 RAH 实现证据；
- RAH 仍保持 one Agent participant = one active lane；并行来自多个 AgentDefinition；
- Provider session/telemetry/output 仍是 runtime/observation 数据，不能完成 Task、推进 Room cursor 或恢复 Room truth。
