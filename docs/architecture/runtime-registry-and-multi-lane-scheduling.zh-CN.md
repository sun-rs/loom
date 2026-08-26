# Runtime Registry 与多 Lane 调度架构

状态：**Accepted in stages / R0–R3 implemented / narrow R2a–R2b implemented / R5 config v4 fake slice implemented / R1–R4 provisional**（2026-08-26）。严格 protocol schemas、pure placement planner、Kernel schema v7（保留 Placement projections并新增 Workspace/Room/Role/Thread 存储边界）、control Room 配置修订、trusted immutable Offer evidence、durable Placement/RunAttempt provenance、atomic placement launch claim、可信启动期 capacity policy、MultiLaneAgentHost、Host-local immutable Runtime Profile/Probe Registry、spawn-time secret binding，以及 daemon config v4 的双 participant/双 profile Placement-selected external Worker E2 已通过本机门禁。durable PlacementHold、control-Room CapacityPool、canonical WorkspaceDefinition/mount、model execution binding、mixed-adapter recovery 与 real CLI v4 certification尚未完成。

## 1. 要解决的问题

当前 composition 把以下五件事固定在同一个 JSON `runtime` 节点中：

- 哪个 Agent 获得 Activation；
- 哪台 Host 执行；
- 使用哪个 CLI/adapter；
- 使用哪个模型、reasoning effort 与 service tier；
- 使用哪个 cwd、credential 与恢复驱动。

把 `runtime` 直接改成数组不能解决问题，只会产生新的隐式规则：谁挑数组项、修改配置是否影响正在运行的任务、模型参数如何跨 CLI 映射、一个 CLI 阻塞是否拖住所有 Agent、旧进程由哪个 adapter 恢复、Host 自报 capability 是否可信。

目标架构必须保持：

```text
Agent identity / Room membership / Task
                 !=
Host / CLI / model / Provider session / process
```

## 2. 设计结论

```text
Activation(participant)
  -> AgentDefinition current revision
  -> ExecutionPolicyRevision
  -> fresh authorized RuntimeOffers
  -> hard constraint filter
  -> deterministic preference score
  -> durable PlacementDecision
  -> RunAttempt freezes actual selection
  -> one independent LaneRunner
```

核心不是“运行时列表”，而是三层分离：

1. **身份与意图层**：Agent 是谁、允许做什么、希望哪类 runtime/model；
2. **供给与安装层**：某 Host 现在实际安装并验证了哪些 runtime revision；
3. **分配与证据层**：本次 Run 为什么选中哪个 offer，实际使用了什么。

## 3. 对象与唯一 owner

| 对象                      | 生命周期/职责                                                                  | 唯一 owner                       |
| ------------------------- | ------------------------------------------------------------------------------ | -------------------------------- |
| `AgentDefinition`         | Agent 稳定身份；1:1 关联 Agent participant；enabled/disabled/tombstoned        | Room Kernel（control Room 记账） |
| `AgentDefinitionRevision` | 不可变职责、instruction refs、skill refs、memory policy、execution policy 指针 | Room Kernel                      |
| `ExecutionPolicyRevision` | 不可变 hard requirements、preferences、model intent、fallback/session policy   | Room Kernel                      |
| `RuntimeProfile`          | Host 本地稳定 profile identity 与 active revision 指针                         | AgentHost Runtime Registry       |
| `RuntimeProfileRevision`  | 不可变 launch/adapter/model/capability 配置；内容有 digest                     | AgentHost Runtime Registry       |
| `RuntimeOffer`            | Host 对 Kernel 发布的、带 TTL 的 redacted 可执行供给                           | Kernel control-plane projection  |
| `CapacityPoolRevision`    | Host/profile/provider-account 共享并发上限与授权成员；不含 credential          | Kernel（control Room 记账）      |
| `WorkspaceDefinition`     | canonical repository/project identity                                          | Room Kernel（control Room 记账） |
| `WorkspaceMountRevision`  | 某 Host 上不可变的本地路径/worktree capability；路径不离开 Host                | AgentHost Runtime Registry       |
| `WorkspaceLease`          | in-place/worktree 并发隔离                                                     | Room Kernel                      |
| `PlacementDecision`       | 某 Activation 被哪个 offer/model/workspace 接收，含 policy/scheduler evidence  | Room Kernel                      |
| `ProviderSessionRef`      | CLI 返回的 opaque session handle 与兼容范围                                    | Provider adapter metadata        |
| `RunAttempt`              | 一次实际执行及 frozen provenance                                               | Room Kernel                      |

不能把 `RuntimeOffer` 当 AgentDefinition，也不能把 profile active pointer 当历史证据。Host registry 不拥有 Activation queue；Kernel 不保存 secret value、Provider transcript 或 runtime process 内存。

### 3.1 配置事实仍然遵守 Room-first

AgentDefinition、ExecutionPolicy、CapacityPool 和 WorkspaceDefinition 可以跨多个工作 Room 复用，但其创建、修订、启停不能变成一条脱离 Room 的“全局后台真相”。每个这类 Kernel control object 固定一个 `controlRoomId`；管理命令由该 Room 的已认证 Human/Admin 发出，携带该 control Room 的 `basedOnRoomSeq` 与 idempotency key，并在同一事务中更新 projection、追加 control Room event 和写 Outbox。其他工作 Room 只在新的 PlacementDecision 中引用已经存在的不可变 revision，不复制配置事件。

这不是第二套 control ledger：control Room 仍使用同一 Room event、ACL、cursor 与审计机制。RuntimeOffer heartbeat、probe 结果和 capacity availability 属于可过期 operational projection，不需要持续污染 Room timeline；但 profile 激活/deprecate 的 human intent、每次 PlacementDecision 和 RunAttempt 生命周期仍必须落在其所属的 canonical owner/audit trail 中。

## 4. AgentDefinition

`AgentDefinition` 只保存稳定 identity 与 lifecycle：

```ts
type AgentDefinition = {
  agentDefinitionId: string;
  participantId: string;
  controlRoomId: string;
  state: "enabled" | "disabled" | "tombstoned";
  currentRevisionId: string;
  createdAt: string;
  updatedAt: string;
};
```

会改变 Agent 行为但不应改写历史的字段进入不可变 revision：

```ts
type AgentDefinitionRevision = {
  agentDefinitionRevisionId: string;
  agentDefinitionId: string;
  revision: number;
  role: string;
  instructionRefs: string[];
  skillRefs: string[];
  memoryPolicyRef: string;
  executionPolicyRevisionId: string;
  contentDigest: string;
  createdBy: string;
  createdAt: string;
};
```

更新 Agent 产生新 revision 并原子切换 current pointer，只影响尚未 placement 的 Activation。已 leased/running RunAttempt 保留旧 revision。Agent 不能自行启停、修改 policy 或切换 runtime；这些是 authenticated human/admin command，并携带 control Room 的 `basedOnRoomSeq` 与 idempotency key。

Agent identity、Room ACL、Inbox cursor、Task ownership 与 memory scope 不随 runtime/model/session 切换。disabled Agent 的 Activation 保持 durable queued/held，不伪造失败或删除。

`instructionRefs`、`skillRefs`、`memoryPolicyRef` 不能指向会原地变化的“latest”文件或 URL；它们必须引用不可变 artifact/version/digest。Placement 冻结 Agent/policy revision，ContextManifest 再冻结本次实际解析的 instruction、skill 与 memory versions；任一必需内容缺失或 digest 不符时 hold/fail closed，不能带着部分旧 prompt 启动。

## 5. RuntimeProfileRevision 与本地 Registry

### 5.1 稳定 profile 与不可变 revision

`RuntimeProfile` 是某台 Host 上一个稳定、可选择的安装槽，例如 `codex-main`、`claude-sonnet-plan` 或 `opencode-aihubmix`。编辑 command、adapter config、model mapping 或 capability 会创建新 revision；不会原地覆盖。

```ts
type RuntimeProfileRevision = {
  runtimeProfileRevisionId: string;
  runtimeProfileId: string;
  revision: number;
  contentDigest: string;
  protocolFamily: string;
  executable: string;
  fixedArgs: string[];
  staticEnv: Record<string, string>;
  credentialSlots: CredentialSlotRef[];
  workspacePolicy: WorkspacePolicy;
  adapterConfig: unknown; // 由 protocol-family package 的严格 schema 验证
  declaredCapabilities: RuntimeCapabilities;
  modelBindings: RuntimeModelBinding[];
  recoveryDrivers: string[];
  createdAt: string;
};
```

约束：

- 始终是 executable + argv，`shell: false`；禁止 pipe、redirect、`&&`、命令替换和任意 shell string；
- daemon-owned Worker identity/env 字段不能由 profile 覆盖；
- built-in credential slot 与 Worker bearer 的 value 不进入 manifest、digest、Kernel 或 Room event，并进入 diagnostics 的流式 redaction set；owner-controlled manifest 若故意把 secret 伪装成普通 `staticEnv`，不在这一保证内；
- `cwd` 不再等同 profile 的固定项目目录；由 `WorkspaceDefinition + WorkspaceMountRevision + PlacementDecision` 解析。必须支持固定目录的 wrapper 时，将其建模为 exclusive workspace resource；
- revision 被 RunAttempt、RuntimeProcess 或未终止 recovery descriptor 引用时不可物理删除，只能 deprecate/tombstone；
- 新 revision 只有在本机验证并由 human/admin 激活后才成为 future offer。文件改变不能静默改变 active Run 的 argv。

Registry 使用 owner-private 独立持久库，例如 `runtime-registry.db`；它不是 Room Kernel 的第二套业务数据库。Kernel 只接收 redacted descriptor 与 digest，不接收本地路径、secret ref 细节或 env value。

窄 R2a 已实现 `RuntimeProfileManifestV1`。R2b 增加 `RuntimeProfileManifestV2` 与 registry schema v2 migration：v2 在同一严格 executable/argv 基线上增加非敏感 `staticEnv` 与只命名 target、不含 value 的 credential slot。daemon-owned authority env、常见 credential-bearing argv/static-env 名称、未知字段、非 owner-private database/manifest、Host identity mismatch 和更新版本 schema 均 fail closed。`staticEnv` 的名称过滤只能阻止显式常见 credential 误配；恶意把 secret 标成普通变量仍属于 owner-controlled manifest 信任边界，不能宣称有通用 secret 分类器。manifest path 与 secret reference/value 不进入 revision、probe 或 audit。

### 5.2 Protocol family，而不是每 CLI 一套 parser

建议的 family：

- `rah-worker-process/v1`：L0 基线，只要求进程能调用 RAH Worker API；
- `acp/v1`：能力通过 initialize handshake 协商；
- `vendor-app-server/<version>`：只有稳定官方协议存在时使用；
- `a2a/<version>`：未来 remote opaque runtime；
- `external-worker/v1`：外部进程自己管理生命周期，但仍接受 scoped work authority。

Custom profile 只能选择其真正兼容且通过 conformance 的 family。新增一个 CLI 若满足既有 family，通常只增加 manifest/probe fixture，不改 Kernel、不增加 transcript parser。

### 5.3 Capability evidence

能力拆成三个层次：

| Evidence    | 含义                                                | 可否作为 hard requirement              |
| ----------- | --------------------------------------------------- | -------------------------------------- |
| `declared`  | manifest 作者声称支持                               | 否；只能用于发现/UI candidate          |
| `probed`    | 当前 executable/version/handshake 实际观察          | 可用于在线性、model/session 等运行约束 |
| `certified` | 指定 family/version 通过仓库 conformance/fault gate | recovery、isolation 等安全约束必须使用 |

Host 自报 label 不构成安全授权。隔离等级、允许访问的 Room/Agent、credential scope 等标签必须由 server/admin owner 控制，不能像普通 capability 一样由被调度 Host 修改。

## 6. RuntimeOffer：实际供给，不是 Agent

RuntimeOffer 是带租约的 redacted control-plane projection：

```ts
type RuntimeOffer = {
  runtimeOfferId: string;
  hostId: string;
  hostInstanceId: string;
  runtimeProfileId: string;
  runtimeProfileRevisionId: string;
  revisionDigest: string;
  protocolFamily: string;
  capabilityEvidence: CapabilityEvidence;
  modelBindingDescriptors: ModelBindingDescriptor[];
  workspaceMountDescriptors: Array<{
    workspaceDefinitionId: string;
    workspaceMountRevisionId: string;
    workspaceMountDigest: string;
    modes: Array<"in_place" | "worktree" | "ephemeral">;
  }>;
  capacityPoolIds: string[];
  maxConcurrent: number;
  state: "available" | "degraded" | "draining" | "unavailable";
  observedVersion?: string;
  observedAt: string;
  leaseUntil: string;
};
```

一个 Multica 风格的“runtime = computer + tool”在这里对应 RuntimeOffer。offer 绑定当前 Host instance generation；Host 重启后必须发布新 offer，旧 generation 的 heartbeat 不能续租。offer heartbeat/expiry 是 operational state，不追加 Room chat timeline；每次实际 placement 则必须 durable 记录 profile revision、Host 与选择依据。

Host 发布 `maxConcurrent`，Kernel 根据 non-terminal Placement/RunAttempt 自己计算占用，不能接受 Host 自报 `activeSlots=0` 作为分配证明。多个 profile 若共享同一个 Provider plan/account，用同一 `CapacityPool`，避免表面上每个 profile 都有空位、实际共同打爆 quota。

有效容量必须取 `min(Host 当前 offer 上限, admin-owned Host/profile/capacity-pool 上限)`；任何一层缺失时使用显式的保守默认值，而不是无限容量。Kernel 只以自己事务内的 reserved/non-terminal placement 计数，Host 的本地计数只用于诊断和发现漂移。

`CapacityPoolRevision` 的成员关系和上限由 authenticated admin command 管理；Host 只能引用 Kernel 已授权给该 host/profile revision 的 pool，不能通过发布一个新 pool ID 绕过共享 Provider account 限额。初版每个 Placement 对 Host、profile 和它列出的每个 pool 各消耗一个整数 slot，不引入 CPU/memory 或任意资源表达式。两个 profile 若引用同一 credential/plan，部署者必须把它们放入同一个 opaque account pool；pool 只暴露随机 ID 和 cap，不暴露账号、token 或 secret slot。

Workspace 同样不允许“双 owner”。Kernel 的 `WorkspaceDefinition` 保存 canonical identity；Host registry 的 `WorkspaceMountRevision` 保存 owner-private path、允许模式与 digest；RuntimeOffer 只投影上面的 redacted descriptor。Placement 同时冻结 definition 与 mount revision，Host 再在本地解析 cwd。mount 缺失或 digest 不一致时 fail closed，不能退回 daemon 当前目录。

发现 PATH 上安装了某 CLI只产生 discovery observation。它不会自动变成 public offer，也不会自动获得任何 Agent authority；必须导入 profile revision、probe、激活并满足 Host credential/Agent policy。

## 7. ModelSelector 与 provider-specific mapping

不能再假设所有 CLI 都理解同一个 `effort` 或 `variants` JSON。portable intent 与 provider binding 分开：

```ts
type ModelIntent = {
  exactBindingIds?: string[];
  capabilityClass?: "fast" | "balanced" | "deep_coding";
  reasoning?: "default" | "low" | "medium" | "high" | "max";
  serviceTier?: "default" | "fast" | "priority";
  fallback: "disabled" | "same_profile" | "compatible_offer";
};

type RuntimeModelBinding = {
  modelBindingId: string;
  provider: string;
  modelId: string;
  supportedReasoning: string[];
  supportedServiceTiers: string[];
  adapterMapping: unknown; // protocol family 的 typed schema
  evidence: "declared" | "probed" | "certified";
};

type ResolvedModel =
  | { source: "runtime_default"; selection: "no_model_selector_sent" }
  | {
      source: "explicit_binding";
      modelBindingId: string;
      provider: string;
      modelId: string;
      reasoning?: string;
      serviceTier?: string;
    };
```

规则：

- `reasoning=high` 只是 intent；只有 binding 明确声明并验证 mapping 时才匹配；
- `default` 表示让该 runtime 使用自身默认值，不等于 `high`；
- 只有 intent 没有 exact binding/capability class，且 reasoning/service tier 都是 `default` 时，planner 才能选择 `runtime_default`；它只证明该 profile 没有发送 model selector，不能保证 Provider 在不同时刻采用同一实际模型，也不得伪造 provider/model ID；要求可复现模型的 policy 必须使用 explicit binding；
- 不存在 mapping 时 fail/hold 或按显式 fallback 选别的 binding，禁止静默拼一个未知字段；
- Agent profile 切换导致旧 exact model 无效时，不能沿用字符串；需要重新 placement 或清空为 runtime default；
- `ResolvedModel` 冻结进 Placement/RunAttempt；显式 binding 记录实际 provider/model/mapping，runtime default 则诚实记录“未发送 selector”；Provider 后续自报的实际模型只能附加为 observation，不能反写 placement；
- 初版不根据未经校准的“质量/价格排行榜”自动跨 Provider；默认 policy 应 pin 明确 offer/binding，adaptive routing 必须是 opt-in policy。

ACP 的 session config options 可成为 L1 binding 的发现来源，但仍需 profile revision 固化兼容范围；ACP update 不拥有 RAH 的 Agent/Task/Room。

## 8. ExecutionPolicyRevision

Policy 明确区分 hard constraint 与 soft preference：

```ts
type ExecutionPolicyRevision = {
  executionPolicyId: string;
  executionPolicyRevisionId: string;
  required: {
    authorizedHostIds?: string[];
    allowedOfferIds?: string[];
    allowedProtocolFamilies: string[];
    capabilities: string[];
    minimumIsolation: string;
    workspaceMode: "in_place" | "worktree" | "ephemeral";
  };
  preferred: Array<{
    criterion: string;
    weight: number;
  }>;
  modelIntent: ModelIntent;
  sessionPolicy: "fresh" | "prefer_resume" | "require_resume";
  retryPolicyRef: string;
  createdAt: string;
};
```

Task-specific override 将来必须是独立 authenticated human command，受到工作 Room ACL、工作 Room 的 `basedOnRoomSeq`、idempotency 和 Agent policy 上限约束。全局 Agent/policy 更新则以 control Room 为 causal scope。Worker 不能在 request body 中选择 Host/profile/model，也不能把一次 Provider 自荐升级成下一次 placement policy。

`require_resume` 只有在 ProviderSessionRef 与 profile revision、Host/workspace、model binding 和 capability 都兼容时才可 placement；`prefer_resume` 不满足时创建 fresh session；Provider session 丢失不重建 Room truth。

## 9. Placement 算法

### 9.0 Kernel 决策，Host pull 已分配工作

Host 不能先 lease 一条裸 Activation、再在本地挑 runtime；也不能因为某台 Host 更早轮询就获得选择权。推荐控制流是：

```text
Activation/Offer/Capacity changed
  -> durable schedule-needed Outbox + fixed reconciliation backstop
  -> Kernel planner reads one consistent snapshot of queued Activations and fresh Offers
  -> Kernel atomically reserves Placement for the selected Host instance
  -> content-free placement-ready hint
  -> selected Host pulls only Placements addressed to its authenticated generation
  -> independent LaneRunner starts exact profile revision
```

任何 wake recipient 都只能触发一次 schedule tick，不能指定 Activation、Host、profile 或 model。即使 hint 丢失，Kernel/Host reconciliation 仍会发现 reserved placement；即使多个 tick 并发，同一事务内的 Activation/lane/capacity fencing 也只能产生一个有效 reservation。这样吸收 Raft/LiveKit 的显式唤醒与 dispatch 思路，但选择权和 durable evidence 留在 Kernel。

### 9.1 先选择工作，再选择执行位置

Activation candidate 排序固定为：

1. explicit priority（初版可全部相同）；
2. `availableAt`；
3. Activation `createdAt`；
4. `activationId` 稳定 tie-break。

这防止一个拥有更高 profile score 的新任务长期饿死旧的、可调度任务。scheduler 按该顺序扫描一个有界 candidate window：遇到当前不可调度的 Activation 时写入带 `nextEvaluationAt` 和 dependency keys 的 PlacementHold，在 backoff 期间将其移出 eligible set，然后继续扫描，不能让一个 offline/profile-missing 的最老任务造成全局队头阻塞；相关 offer/capacity/workspace 变化会立即使 hold 失效，固定 reconciliation 是丢 hint backstop。找到第一个 feasible Activation 后才对它的 offers 评分。每轮 reserve 后从头重新求值。每个 Agent participant 仍最多一个 active lane；需要并行子工作时创建不同 AgentDefinition/Task，而不是让同一个 identity 同时产生互相冲突的上下文。

### 9.2 Hard filter

对一个 Activation，依次排除：

1. Agent disabled、Host credential 未获 participant authority；
2. offer stale/draining/unavailable、Host instance generation 已失效，或 revision digest 无法在 Host 本地解析；
3. protocol、Worker contract、required capability、certification/isolation 不满足；
4. model intent 需要显式 binding 但无兼容 binding；
5. workspace 不在 Host、workspace mode 不兼容或 exclusive lease 冲突；
6. Host/offer/capacity pool 已满；
7. recovery/circuit policy 禁止新 run；
8. `require_resume` 的 session locality 不满足。

Hard filter 不通过不能靠权重“勉强运行”。

### 9.3 Soft score

只对 feasible offer 评分，建议初版只启用可解释项：

1. policy 明确 pinned/preferred offer/profile；
2. compatible ProviderSessionRef 与 workspace locality；
3. preferred protocol/model binding；
   4.近期 structural start failure penalty；
4. capacity load ratio；
5. `runtimeOfferId` 稳定 tie-break。

权重和分值使用有界整数，不使用浮点比较。PlacementDecision 保存 redacted candidate evidence：每个候选的 offer/profile revision、hard rejection reason 或各 criterion 分值、总分，以及最终 tie-break；`candidateSetDigest + schedulerVersion` 允许复核同一 snapshot。禁止让 LLM 自己挑执行 Host，也禁止使用 stdout 文本、隐藏 Provider telemetry 或未版本化 benchmark 影响 placement。

### 9.4 原子 reserve

Kernel scheduler 在一个 transaction 内重新验证 candidate、目标 Host generation、capacity 和 lane fencing，然后：

```text
Activation queued
  -> Activation leased(host generation)
  -> PlacementDecision reserved(profile/model/policy revisions frozen)
  -> capacity/workspace lease reserved
```

被选中的 Host 随后 pull 该 `placementId` 并创建 RunAttempt。若 Host 在 RunAttempt 前崩溃，Activation lease expiry 原子释放 placement/capacity/workspace reservation；若进程副作用已准备，则沿现有 RuntimeProcess orphan/quarantine/terminal-proof 路径恢复。

Host 收到 placement 后必须从本地 registry 解析同一 `runtimeProfileRevisionId + digest`。不匹配时不得退回“当前 profile”，而是以结构化 `profile_revision_unavailable` 释放/retry placement。

## 10. PlacementDecision 与 RunAttempt provenance

```ts
type PlacementDecision = {
  placementId: string;
  activationId: string;
  roomId: string;
  participantId: string;
  agentDefinitionRevisionId: string;
  executionPolicyRevisionId: string;
  hostId: string;
  hostInstanceId: string;
  runtimeOfferId: string;
  runtimeProfileRevisionId: string;
  runtimeProfileDigest: string;
  protocolFamily: string;
  resolvedModel: ResolvedModel;
  workspaceDefinitionId: string;
  workspaceMountRevisionId: string;
  workspaceMountDigest: string;
  workspaceMode: "in_place" | "worktree" | "ephemeral";
  capacityPoolIds: string[];
  schedulerVersion: string;
  candidateSetDigest: string;
  candidateEvidence: Array<{
    runtimeOfferId: string;
    runtimeProfileRevisionId: string;
    hardRejectionReasons: string[];
    resolvedModel?: ResolvedModel;
    workspaceMountRevisionId?: string;
    score?: Array<{ criterion: string; points: number }>;
    totalScore?: number;
  }>;
  state: "reserved" | "consumed" | "released";
  leaseUntil: string;
  createdAt: string;
};
```

RunAttempt 复制/引用 frozen placement fields，并在 runtime 返回后最多一次附加 opaque ProviderSessionRef。ProviderSessionRef 不能改写 profile/model provenance。profile 被停用、模型下架或 Agent policy 更新，不改变旧 RunAttempt。

## 11. Unschedulable 不等于失败

没有可用 runtime、capacity 已满或 workspace 正忙时，Activation 保持 queued。Kernel 维护一个可重算的 `PlacementHold`：

```text
no_authorized_host
no_compatible_offer
profile_offline
model_unavailable
capacity_exhausted
workspace_busy
session_locality_unavailable
circuit_open
```

Hold 是同一 Activation 的调度 projection，不是第二个 queue，不改变 Task business state，也不持续追加重复 Room event。它保存当前 reason、redacted dependency keys、`evaluatedAt`、`nextEvaluationAt` 和 bounded backoff；offer heartbeat、capacity release、profile/policy activation、workspace lease release 等相关变化使匹配 hold 立即失效，固定 reconciliation 处理丢 hint。是否在一定时间后升级给 Human 必须由显式 policy 决定，不能硬编码“排队两小时即失败”。

## 12. MultiLaneAgentHost

当前 `AgentHost.reconcileOnce()` 会等待一个 runtime 完整结束，因此即使 credential 已包含多个 participant，也会串行阻塞。目标结构：

```text
MultiLaneAgentHost
  ├── Assigned-placement pull / capacity filler
  ├── RecoveryRouter(driverId -> exact adapter revision)
  ├── LaneRunner(agent-A) -> runtime offer Codex
  ├── LaneRunner(agent-B) -> runtime offer Claude
  └── LaneRunner(agent-C) -> runtime offer OpenCode
```

约束：

- Host loop 只 pull Kernel 已分配给当前 generation 的 placement 并填充空闲 capacity，不 `await` 某个长 run 后才看下一条；
- `runningLanes` 以 participantId fencing，一个 participant 永远只有一个 active LaneRunner；
- 每个 lane 有独立 lease maintenance、timeout、cancel、Worker grant 和 failure result；
- adapter 由 frozen profile revision 创建/缓存，不能使用 daemon 当前默认 runtime；
- orphan recovery 按 RuntimeRecoveryDescriptor.driver 路由到能够处理旧 revision 的 adapter，即使 Agent 当前已切换 runtime；
- 一个 profile probe/start 失败只影响该 placement/offer，不阻塞其他 feasible lane；
- capacity release 会触发本地 content-free wake；固定 reconciliation 仍是丢 hint backstop；
- shutdown 先停止新 placement，再并发 drain 所有 lane；总 deadline 到期后逐 lane cancel，只有 terminal proof 才释放占用。某一 lane cleanup 失败不能跳过其他 lane。

初版 Host credential 可继续使用当前显式 participant whitelist，但允许多个 Agent；新增/移除 participant 需要 credential rotation。动态 `HostAgentGrant` 是后续安全 ADR，不能靠 Host 自报 offer 自动扩大 participant scope。

## 13. Runtime 更新与故障语义

- profile edit/create revision：只影响 future placement；
- activate revision：新的 offer 使用新 digest；已 reserved/running 继续旧 revision；
- deprecate revision：停止新 placement，但保留 recovery；
- ordinary disable/deprecate 只影响 future placement；需要停止已 reserved/running work 时必须使用独立的 emergency revoke/cancel command，记录原因并继续遵守 terminal-proof fencing，不能把删除配置当成 kill；
- Host/offer heartbeat expiry：停止新 placement；已有 run 走 lease/orphan recovery，不能立即双开；
- pre-launch profile/probe failure：释放 reservation、记录结构化 placement reason，不创建虚假成功 RunAttempt；
- post-prepare failure：必须进入现有 RuntimeProcess terminal proof/quarantine；
- typed ACP/provider error 可以进入 observation/failure taxonomy；未知 stdout 仍是 diagnostics，不能自动切模型或完成 Task；
- 跨 offer fallback 只发生在旧 runtime 已有 terminal proof、Task canonical state 允许重试且 policy 明确允许时；每次 fallback 创建新 Placement/RunAttempt。

## 14. Daemon config v3 兼容路径与 v4 已实现切片

当前已实现的 config v3 是窄 single-profile bootstrap，只选择一个 stable profile，不内联 command/env：

```json
{
  "schemaVersion": 3,
  "runtime": {
    "kind": "runtime-profile-registry",
    "registryDatabasePath": "/owner/private/runtime-registry.db",
    "runtimeProfileId": "codex-main",
    "cwd": "/owner/private/workspace",
    "credentialBindings": {},
    "offer": {
      "runtimeOfferId": "offer-codex-main",
      "maxConcurrent": 1,
      "leaseMs": 120000,
      "refreshIntervalMs": 30000
    }
  }
}
```

config v4 已使用独立 shape 实现 multi-profile/multi-participant composition：Host credential scope 必须与排序后的 `participantIds` 精确相等；`runtimeProfileId` 与 `runtimeOfferId` 在 config 内唯一；多个 profile 可复用一个去重后的 Host-bound Registry；每个 active revision 启动时重新 probe，并发布同一 startup-owned workspace mount descriptor。Kernel 依据 Agent policy 生成 Placement，daemon 仅按 `runtimeOfferId` 解析 frozen runtime，不能按 config 顺序或轮询先后自行挑选。

v4 的 `host.maxConcurrent` 与每个 Offer `maxConcurrent` 同时进入 trusted startup capacity policy，实际有效容量仍取 Kernel Host/profile/Offer 门禁的最小值。两个 profile 的旧 revision recovery 会按 descriptor 中的 revision/digest/driver version 在已配置 Registry 中解析；未找到或多 Registry 冲突时 fail closed。

当前限制：v4 workspace identity 仍是 trusted startup config，不是 schema v7 的 canonical Workspace 管理面；只支持固定 `in_place` cwd，不支持动态 worktree；model binding 仍未执行；R5 只用两个 immutable fake Generic profiles证明路由和业务链，没有宣称 Codex/Kimi/OpenCode/Claude 的真实 v4 certification。manifest import 仍必须 canonicalize → validate → digest → create immutable revision；v2 单 runtime 配置未来应由显式 migration command 导入，不做无法审计的隐式猜测。

## 15. 外部项目经验：采用与拒绝

| 项目/机制                                                                                                                                                                                                         | 采用                                                                                                                                          | 明确不采用                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [Multica daemon/runtime](https://multica.ai/docs/daemon-runtimes)                                                                                                                                                 | runtime 是 computer + tool 的实际供给；daemon discovery；custom profile 复用 protocol family；profile 修改只影响后续 run；Host/Agent capacity | 不让 Provider output parser 成为业务完成证据；不把 server-stored env value 当本地 secret |
| [Multica Agent/model](https://multica.ai/docs/agents-create)、[tool capability matrix](https://multica.ai/docs/providers)                                                                                         | Agent 长期身份与 runtime/model 分离；model/effort 必须按 tool capability；session resume 失败可按 policy fresh start                          | 不复用跨 runtime 无效的 model 字符串；不把 session resume 当 Room 恢复                   |
| [Multica tasks](https://multica.ai/docs/tasks)                                                                                                                                                                    | business Issue 与单次 execution 分离；runtime claim、offline queue、retry history、workspace lock                                             | RAH 不把 process run 的 `completed` 等同 Task complete，也不默认超时删除 durable work    |
| [Raft runtime](https://docs.raft.build/features/agents/runtime/)、[lifecycle](https://docs.raft.build/features/agents/lifecycle/)                                                                                 | 切 runtime 后保留 Agent identity/workspace/memory；mixed runtime；Human 控制 runtime；idle 可释放 process                                     | 不把 Agent 永久绑死一台 computer；不把“灰色 offline”同时表达 idle/断线/未知              |
| [Raft external agents](https://docs.raft.build/features/agents/external/)                                                                                                                                         | 外部 runtime 仍映射成同一 Agent identity 与业务命令；content-free wake + pull                                                                 | 外部进程不能因此获得通用 Agent PAT 或绕过 Activation scope                               |
| [ACP v1](https://github.com/agentclientprotocol/agent-client-protocol/blob/main/docs/protocol/v1/overview.mdx)、[session config](https://agentclientprotocol.com/announcements/session-config-options-stabilized) | initialize/capability negotiation、optional session load、typed model/mode/reasoning selector、cancel/permission                              | ACP 是单 client↔agent runtime protocol，不拥有 Room、Task、placement 或多 Agent identity |
| [AHP 与 ACP 分层](https://microsoft.github.io/agent-host-protocol/guide/ahp-and-acp.html)                                                                                                                         | 上层 authoritative multi-client state 与下层 1:1 agent protocol 分离                                                                          | AHP session state 不替代 RAH Room ledger；AHP 明确不做 model routing                     |
| [Nomad scheduling](https://developer.hashicorp.com/nomad/docs/concepts/scheduling/how-scheduling-works)、[Kubernetes affinity](https://kubernetes.io/docs/concepts/scheduling-eviction/assign-pod-node/)          | feasibility filter → preference score → allocation plan；hard constraint 与 soft affinity 分离；capacity/resource lease                       | 不引入通用集群 scheduler、Pod abstraction 或复杂自定义表达式语言                         |
| [LiveKit explicit dispatch](https://docs.livekit.io/agents/server/agent-dispatch/)、[load threshold](https://docs.livekit.io/agents/server/options/)                                                              | explicit dispatch identity、worker load/capacity、drain                                                                                       | dispatch/job success 不能代替 RAH delivery 与 Task proof                                 |

相比 Raft/Multica，RAH OS 的额外约束是：**每次选择都冻结 revision 与解释证据；业务成功永远来自 Room command，而不是 runtime adapter 的 rich output。**

## 16. 分阶段实现与 TDD 门禁

### R0：Protocol + pure planner

状态：**已实现**。实现位于 `@rah-os/protocol` 的严格 Zod schemas 与 `@rah-os/kernel` 的 `planNextPlacement`；当前只计算可直接物化为 PlacementDecision 的纯 selection/hold draft，不写数据库、不 lease Activation、不启动 runtime。

- 为 AgentDefinition revision、ExecutionPolicy、RuntimeOffer、PlacementDecision、ModelBinding 建严格 schema；
- pure `filter + score` planner 使用 deterministic input；
- 未知 capability/model mapping fail closed。

门禁：同一输入无论 object/map insertion order 都产生相同选择与 reason；hard requirement 永不被高 soft score 越过。

附加门禁：runtime default 不产生虚假的 model binding；一个 held 的老 Activation 不阻塞稍后的 feasible Activation；有效容量永远不超过 Host offer 与 admin cap 的最小值；Host/array insertion order 不改变相同 snapshot 的选择；planner selection 可直接通过严格 PlacementDecision schema。

### R1：Kernel schema 与单 runtime compatibility

状态：**provisional / R1.1 本机证据子集 + R3 fake launch 已实现**。Kernel scheduler/atomic launch 已接入 `MultiLaneAgentHost` fake Core path，但尚未接入当前单 lane daemon；旧 `leaseNextActivation` 路径继续作为 compatibility path。Host 自写 certified capability/isolation/model binding 已被可信 catalog 门禁拒绝；每个新 Placement 冻结不可变 Offer observation 与所有 candidate snapshot digest。启动期 capacity policy 仍不是 durable control-Room CapacityPool，`probed`、hold 与 canonical workspace/model execution 也尚未达到生产多 lane 证据。

- Kernel schema v5 增加 AgentDefinition/Policy/Offer observation/Placement（当前全库 schema v7 继续保留，并加入 collaboration boundary）；Agent/policy mutation 通过 control Room 事件记账；
- RunAttempt 冻结 provenance；
- 现有单 profile fixture 通过 compatibility adapter 保持行为。

门禁：revision v2 激活后，已运行 Run 仍引用 v1；Host 在 placement 后、RunAttempt 前崩溃可安全释放并重新 placement；两个并发 schedule tick 只能 reserve 一次，Host 轮询顺序不能决定归属。

实现证据：Kernel 测试覆盖 v3→v5 nullable provenance 与真实 buggy-v4 FK repair、v4 mutable Offer fail-closed/republish、control Room idempotency、跨 Kernel connection single reservation、content-free `placement.ready`、pre-Run/pre-prepare/post-finish/terminal-proof-before-finish/terminal-proof-before-resolve crash recovery、active RuntimeProcess terminal-proof quarantine、旧库 terminal RunAttempt 与 nonterminal RuntimeProcess 冲突时的 retry/lease fail-closed、旧 Kernel 已错误 queued/released/删除 reservation 后的 startup reconciliation 与隐式资源 fencing、Host/direct/recovery generation fencing、Offer 单调更新/future skew/max TTL、content-addressed certification、certified model rejection、future-only catalog removal、immutable observation/candidate digest、retry resource release、Run 终态容量释放、revision provenance，以及无 Placement 的旧单 runtime RunAttempt。startup、schedule 和 legacy lease 都会按 RuntimeProcess 对账：nonterminal process 从其历史 Placement 反向重建 participant、Host、Offer、Profile、Pool 与 in-place Workspace 占用；terminal record 可自动结算未完成的 Run bookkeeping，并幂等解除全部 process 已 terminal 的 quarantine。所有 Placement 资源释放再核验关联 RuntimeProcess 已有 terminal proof。R1 使用 Host/profile/pool cap=`1` 的保守 compatibility 默认；admin capacity 和动态 certification lifecycle 仍属后续门禁。R4 建立 canonical workspace mapping 前，仅当 fresh offers 暴露唯一一致的 WorkspaceDefinition 时才调度，多 workspace 输入 fail closed，绝不按路径或字符串猜测。详细边界见[独立审计与整改](../audits/2026-08-26-runtime-placement-independent-audit.zh-CN.md)。

### R2a：Host-local immutable registry

状态：**已实现窄范围**。

- registry database 与 manifest file 必须是当前用户所有、owner-private regular file，registry metadata 永久绑定一个 Host ID；
- strict `RuntimeProfileManifestV1`、`rah/runtime-profile-manifest/v1` domain-separated canonical digest；
- import object/file 幂等，同一 normalized content 复用 revision，语义变化创建新 revision且不隐式 activate；
- lifecycle projection 显式 activate/deprecate，旧 active revision 变 inactive 而非删除；
- SQLite trigger 阻止 revision content update/delete 和 audit update/delete；所有读取重算 manifest digest；
- file path、env、credential value、secret slot、probe result 不进入 revision/audit。

当前 `import/activate/deprecate` 是 `agent-host` 包内的本机 API，其管理权限仅由当前 OS 用户与 owner-private 文件边界提供；它还不是 Kernel control Room 中经过 Human/Admin 认证、带 actor provenance 的管理命令。后者必须在 daemon integration 阶段单独建模，不能把当前本地调用误称为已完成的远程管理面。

门禁证据：set-like 字段乱序 digest 相同、argv 顺序变化 digest 不同且有固定 golden；双 registry connection import 只产生一条 revision/audit；重启保留 lifecycle；错误 digest、deprecated reactivation、public/symlink storage、Host mismatch 与 newer schema 均拒绝。

### R2b：Adapter、probe 与 secret late binding

状态：**已实现窄范围**。

- 内建 `generic-process/v1` adapter 与 `rah-process-supervisor-v1` recovery driver 通过严格、版本化 map 解析；未知 kind/driver fail closed。registry-backed config v3 创建的 durable recovery descriptor 冻结 profile revision/digest 与 recovery implementation version，compatibility AgentHost 按 descriptor 加载旧 inactive/deprecated revision，而不是按当前 active profile 恢复；config v2 的 legacy descriptor 仍允许无 provenance，不能在存在 nonterminal v2 RuntimeProcess 时直接切换到 v3；
- 只有 `RuntimeImplementationRegistry` 实际执行后签发的进程内 observation 才能写入 immutable ProbeReport；普通结构相同对象不能伪造。report 绑定 profile revision/digest、adapter implementation version、executable requested/resolved identity、内容 digest/size和 recovery implementation version；
- v2 activation 只接受该 revision 最新且成功的 probe；较新的失败 probe 会 fence 激活，历史成功不能覆盖当前失败。runtime 创建时重算 manifest digest；AgentHost start 前和 supervisor 真正 launch target 前分别核验 executable realpath/content/size/execute bit。该双重检查关闭可确定的 credential-load 间隙，但同一 OS 用户恶意写入下仍存在最终 check→`exec` 的极窄竞态；更强保证需要 fd/inode/code-signature 等平台 primitive；
- credential slot binding 在构造时验证 exact own-property slot set，value 只在每次 spawn 前经 `SecretProvider` 解析，且 secret/file 有 64 KiB 上限。FileSecretProvider 最多读取 65,537 bytes 后拒绝，不依赖可竞态的 stat size 作为内存边界。Provider secret 与 Worker bearer 加入 Generic diagnostics 的流式多模式 redactor；redactor分段扫描、只保留 `maxSecretLength-1` 的未决后缀（提交边界遇到 surrogate pair 时额外后退一个 code unit），把所有完整匹配与相交、链式重叠匹配合并为脱敏区间，EOF 时再把仍可能成为 secret 的 partial suffix 合并进去，最后才执行 UTF-8 byte truncation。匹配事件以窗口长度固定的 typed arrays 计数，不为每个 occurrence 分配对象；EOF suffix-prefix 对每个 pattern 使用 prefix-function/KMP 线性判定，不执行逐长度切片比较。临时空间不随 overlap occurrence 数量相乘，near-match CPU 也不再平方退化；未进入 redaction set 的任意输出不受此保证；
- daemon config v3 只选择 registry database + stable profile ID + local cwd/credential refs。启动时重新 probe active revision，随后从同一 frozen revision 建 adapter；每次 AgentHost probe/start 和 Offer refresh 都重新读取 active pointer/state/digest。revision 被切换或废弃后，旧 daemon 发布 `unavailable`；常规时序在 createRunAttempt 前由 probe 拒绝。若 pointer 恰在 probe 与 createRunAttempt 间改变，start fence 仍保证不读取 credential、不 prepare/launch process，但会留下一个显式 failed RunAttempt；重新选择新 revision 需要重启 daemon；
- Offer publisher 绑定 authenticated Host generation，每个 refresh interval 重新执行并持久化 probe；executable path/content/size 与 daemon 启动时 identity 任一不一致即发布 `unavailable`，不会无限续租旧成功 probe。drain 前也先发布 `unavailable`。public Offer 只携带 profile/revision digest 与 `probeReportId + probeDigest`，不携带 executable path、slot、secret ref/value 或 static env；manifest 的声明能力仍标成 `declared`，不会因 executable probe 自动升级成 `probed`。

门禁证据：以真实 v1 DDL/trigger/fixture 建库后的 v1→v2 数据迁移与 FK 完整性、不可伪造/不可更新/不可删除 probe、caller-mutated revision 拒绝、start 前 replacement 拒绝且不读取 credential/prepare run、credential-load 间隙 replacement 被 supervisor 拒绝且未执行并可由 direct reap/旧 descriptor recovery 验证 `RAH_START_FAILED` terminal proof、unknown recovery、latest-failure activation fence、secret 延迟/有界读取、缺失/多余/prototype slot、单次、重复长 secret、正向/反向/链式/32-pattern dense overlap secret 跨 chunk、Unicode code point 拆包/普通 Unicode safe boundary、EOF partial overlap 与 64-pattern/64-KiB near-match 线性资源门禁的流式截断前脱敏、旧 revision recovery routing，以及 daemon v3 在无 Activation 时不读 Provider secret、收到 Activation 后才读取、确定性 active-revision 切换 fixture 中旧 lane 未创建 RunAttempt且 Offer 变 `unavailable`、Kernel Offer JSON 不含本地路径/secret、删除 executable 后 live Offer 变 `unavailable`、shutdown head 为 `unavailable`。

边界：config v3 继续复用 single-participant compatibility `AgentHost`；config v4 才消费 placement-managed atomic launch claim。v4 Offer 虽携带 immutable startup workspace descriptor，但仍没有 canonical WorkspaceDefinition/mount mapping、model binding 或 admin CapacityPool。因此当前证据只代表本机 fake 多 Agent调度闭环，不代表生产多 CLI router。

### R3：MultiLaneAgentHost + fake runtimes

状态：**Core fake gate implemented**。Kernel 原子 launch claim 会在同一事务消费 Placement、续 Activation lease 并创建唯一 RunAttempt；`@rah-os/core` 的 MultiLane runner 使用有界 worker 填充 capacity。组合 E2 已覆盖 A hung 时 B 提交/验收、同一 Agent follow-up 串行、Host 崩溃后先恢复旧 RuntimeProcess 再重试，以及 A quarantine 不阻塞 B。启动期 `PlacementCapacityPolicy` 是可信 admin 输入并默认 fail-closed 为 `1`；它尚不替代未来可审计的 durable CapacityPool control object。

- bounded capacity filler、per-participant LaneRunner、独立 renewal/cancel/recovery；
- Host/offer/capacity-pool 限额；并发 drain。

门禁：A 的 hung runtime 不阻塞 B；同一 Agent 永不并发；容量 2 时最多两个 target；一个 lane quarantine 不影响其他 Agent，但继续 fence 自己。

### R4：Workspace/session/model routing

- durable workspace lease；in-place exclusive 与 worktree parallel；
- ProviderSessionRef compatibility；typed model mapping/fallback。

门禁：不兼容 session 不被 resume；`reasoning=high` 无 mapping 时 hold 而不是拼未知参数；同一目录不会被两个 in-place Run 同时修改。

### R5：Daemon config v4 与 mixed fake CLI E2

状态：**partial implemented**。config v4、精确多 participant scope、多个 unique profile/offer、workspace-aware Offer、startup capacity、Placement-selected resolver 与两个外部 Fake Worker 的 Room Task E2 已通过。mixed adapter/profile offline/restart matrix 仍待补齐。

- v2 explicit migration；多 participant Host scope；多个 profile/offer；
- Codex/Kimi/OpenCode/Claude fake wrapper 同 Room 并行工作；pass/fail 只读 Kernel。

门禁：profile 切换保留 Agent identity/cursor/memory scope；一个 profile offline 时其他 Agent 继续；restart 后旧 revision recovery 与新 revision placement 都正确。

### R6：opt-in real CLI certification

- 先 Codex，再 Kimi/OpenCode，Claude 只用 Sonnet；
- 分别标记 Worker-compatible / Session-capable / Interactive / Observable / Certified；
- 不运行付费 gate，除非用户明确授权。

## 17. 明确非目标

- 当前阶段不实现“自动挑全网最强/最便宜模型”；
- 不允许同一 Agent identity 多 active lane；
- 不建立 Provider transcript/JSONL normalization bus；
- 不让 runtime plugin 注册任意 Kernel method；
- 不同时建设远端多机调度、插件市场、Kubernetes deployment 或云计费；
- 不把 Host-local registry 提升为 Room business owner；
- 不绕过 R0–R2 的协议、持久化与 registry 门禁直接修改 daemon config 或并发执行代码。
