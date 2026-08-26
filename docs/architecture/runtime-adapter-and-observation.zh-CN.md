# Runtime Adapter 与观察平面

状态：最小 AgentHost、Fake/Generic Runtime、Host generation fencing、deadline、Outbox wake、持久 `prepared -> active` RunAttempt/RuntimeProcess 和 scoped Worker API 已实现；Codex、Kimi、OpenCode 与 Claude Code Sonnet 已通过 opt-in 本机 E2 delivery gate，Codex Luna 又通过最小 Task gate，fake process 已通过 InputRequest 无 listening 恢复 gate。主动逃离 process group 的 descendant、完整 Artifact/Review workflow 和 Windows tree recovery 尚未实现或验证。

## 1. 承诺边界

RAH OS 不承诺“接入任何 CLI 都零适配”。它承诺：

> 一个新 CLI 无需 Provider transcript parser，就能通过显式 RAH 命令参与 Room 业务流；只有增强体验需要可选适配。

CLI 必须至少能通过 shell、MCP、ACP 或 A2A 中的一种方式调用 RAH application service。若 CLI 完全无法执行结构化外部动作，它不能成为可信 worker，只能作为人工复制内容的聊天工具。

## 2. 五个分离对象

| 对象                   | 含义                                                                 | Owner              |
| ---------------------- | -------------------------------------------------------------------- | ------------------ |
| AgentDefinition        | 长效身份；不可变 revision 固化职责、技能和 memory/execution policy   | Kernel             |
| RuntimeProfileRevision | Host 本地不可变 launch/adapter/capability/model binding 配置         | AgentHost registry |
| ModelSelector          | policy 中的可移植意图；由具体 runtime binding 映射 provider 参数     | Kernel policy      |
| ProviderSessionRef     | CLI 返回的 opaque resume handle                                      | Provider adapter   |
| RunAttempt             | 引用 durable Placement，冻结 profile/model/host/workspace provenance | Kernel             |

Agent 不永久绑定一个 CLI 或模型。ExecutionPolicy 先按 hard capability/security/workspace/model constraint 过滤带 TTL 的 RuntimeOffer，再按显式 preference 评分；RunAttempt 必须引用 durable PlacementDecision，后续修改配置不能篡改历史 provenance。`reasoning=high` 等 portable intent 只有在具体 binding 明确映射时才有效，不能猜测 Provider 参数。严格 schemas、pure planner、durable Placement、atomic launch claim、MultiLane Core path 与 daemon config v4 的双 participant/双 profile Placement 路由已实现；configs v2/v3 仍是无 Placement 的兼容路径，canonical WorkspaceDefinition/mount/Capacity、model execution binding 和真实 mixed CLI v4 certification 尚未实现。详细边界见 [Runtime Registry 与多 Lane 调度架构](./runtime-registry-and-multi-lane-scheduling.zh-CN.md) 与 [ADR-0009](../adr/0009-immutable-runtime-placement-and-multi-lane-host.md)。

## 3. 三层 Adapter

### L0 GenericProcessAdapter：强制基线

```text
probe -> start -> cancel -> reap
```

只负责：

- 可执行文件、argv、cwd、env 和 prompt delivery；
- process group、timeout、signal、exit 和 orphan cleanup；
- scoped RAH credential/CLI/MCP 注入；
- stdout/stderr 作为 opaque diagnostic blob 保存。

它不解释 final answer、JSONL、thinking、tool call 或错误文本，不从它们生成 Room event。

当前 E1 fixture 已证明的 L0 子集是：

- 从绝对路径、相对 cwd 或 `PATH` probe 可执行文件，并以 argv、`shell: false` 启动；
- 只通过不可被 profile env 覆盖的环境变量传递 Activation identity/range，不传消息正文；
- stdout/stderr 分别限长保存为 opaque diagnostics，不生成任何业务 result；
- POSIX 下为每次 Run 建立独立 process group；取消先发 `SIGTERM`，宽限期后发 `SIGKILL`，并验证留在该 group、忽略 `SIGTERM` 的 descendant 不会遗留；
- `reap` 等待 stdio `close` 后返回 OS exit code/signal，且保留期间同一 handle 可重复读取结果；已完成 run 的 opaque diagnostics 默认只保留最近 100 个，也可显式释放，避免 daemon 内存无界增长。
- 动态 environment lease 注入 per-Activation worker token，进程 exit 或 spawn failure 时撤销；真实子进程已通过 loopback application service 完成 Room `sync/ack`，Host 只依赖 Kernel cursor proof。
- `cancel` 只有在返回 terminal `RunExit` 时才证明终止；若 cancel/reap 无法证明进程死亡，Activation 进入 durable quarantine，同一 participant 的后续 queued work 不得越过。
- `start(input, lifecycle)` 必须先调用 `lifecycle.registerPrepared(handle)`；Kernel 在目标副作用前持久化 opaque `RuntimeRecoveryDescriptor` 与 `RuntimeProcess(prepared)`。adapter 返回的 handle 必须与已准备 handle 完全一致，Kernel 才把 RuntimeProcess 和 RunAttempt 推进为 `active/running`。正常 reap/cancel 必须先写 terminal proof，存在非 terminal RuntimeProcess 时 Kernel 拒绝完成 Activation。
- orphan recovery 使用独立、可续租、按 attempt fencing 的 lease；只有声明匹配 descriptor driver 的 adapter 可以领取。恢复失败 durable backoff，恢复成功写 terminal proof、合并 follow-up 并解除 quarantine，daemon 主循环随后才能重新 lease Activation。旧 recovery attempt 不能在新 lease 下提交结果。

POSIX GenericProcessAdapter 现使用 `rah-process-supervisor-v1`：每 Run 的外部 supervisor 先在 owner-private directory 建立 mode `0600` 的 Unix socket，但不启动目标；descriptor durable prepare 后才接受 authenticated `launch`。control request 和 HMAC terminal result 同时绑定 supervisor UUID、RunAttempt ID、runtime Run ID 与 256-bit token。descriptor 不用 PID/PGID 作恢复身份；伪造 identity/token 不触发 signal。leader 退出后 supervisor 仍探测并清理整个 process group，只有进程组不存在才原子写 terminal result。半开 socket 有限时且不阻塞 terminal cleanup；stdout/stderr forwarding 是允许丢失的观察平面。supervisor config/token 会在 spawn CLI 前从环境中删除。

跨进程 E1 fixture 已让真实 AgentHost 在 target launch 后、`run.started` 前被 `SIGKILL`：数据库保留 `starting + prepared`，lease expiry 后进入 orphan/quarantine，新 Host 领取 recovery lease、认证清理原 process group、验证签名 result 并重新排队 Activation。独立 Fake Host/Kernel fixture 验证 recovery lease 跨原到期点续租与 attempt fencing；其他 fixture 覆盖 leader 先退而同组 descendant 忽略 TERM、错误 identity/token、半开 socket 和启动/恢复期不安全目录。它证明受控 POSIX 故障窗口，不证明 supervisor 自身被 SIGKILL/断电、PID namespace 极端复用、主动 `setsid`/double-fork 逃离 group 的 descendant 或真实 Provider CLI。强 tree containment 需要 Linux cgroup v2 或经验证的平台原生 primitive；当前只声明原 group 清空。

Windows 仍使用 `generic-process-direct-v1` 且不声明 recovery driver。确定性 fake process 已证明 canonical Task query、claim heartbeat、跨 RunAttempt 恢复，以及 `waiting_input` 期间零 RunAttempt、human resolve 后新 Activation 恢复；fake MultiLane 又证明 open Task 单 winner 和 loser completion。尚未证明的边界包括：InputRequest cancel/expire/structured answer、Artifact/Review、supervisor 自身被 `SIGKILL`/断电后的 terminal proof、result directory 的安全回收、可安装 package lifecycle，以及 Windows Job Object/tree kill。真实 Provider 中 Codex Luna 已证明 L0 进程可完成最小 Task submit；Kimi/OpenCode/Claude 当前 TypeScript gate 仍只证明 delivery，所有真实 Provider 都尚未复跑 InputRequest gate，不能外推 Artifact 或 Review workflow。详细决策见 [ADR-0003](../adr/0003-identity-safe-process-supervisor.md)、[ADR-0005](../adr/0005-daemon-composition-worker-delegation-and-wake.md)、[ADR-0006](../adr/0006-task-business-protocol-and-causal-worker-commands.md)、[ADR-0007](../adr/0007-durable-input-request-and-no-listen-waiting.md) 与 [ADR-0011](../adr/0011-task-coordination-v1.md)。

### L1 ProtocolAdapter：可选结构化能力

优先采用 [ACP](https://github.com/agentclientprotocol/agent-client-protocol)、稳定 vendor app-server/SDK 或 A2A，而不是解析终端展示格式。能力包括：

- session new/resume/close；
- prompt、cancel、permission 和 elicitation；
- live input；
- typed message/tool/plan/usage update；
- structured error 和 terminal state。

能力通过 handshake 声明，不能靠 CLI 名称猜测。ACP 版本变化由隔离 package 和 conformance fixture 吸收。

### L2 NativeTelemetryAdapter：可丢失增强

Provider hook 或原生事件只能产生 `RunObservation`：

```ts
type RunObservation = {
  runAttemptId: string;
  observedAt: string;
  source: "acp" | "hook" | "vendor" | "process";
  kind: "status" | "tool" | "usage" | "log" | "terminal";
  completeness: "complete" | "partial" | "unknown";
  payloadRef: string;
};
```

Observation 是 lossy、可截断、self-reported、可过期的观察数据。它可驱动 Run Inspector，不得：

- 改变 Task/Inbox/Activation/Review；
- 推进 Room cursor；
- 证明 Agent 已读或完成；
- 在丢失时阻止业务恢复。

## 4. 两条数据平面

```text
Authoritative plane
Room command -> transaction -> projection + RoomEvent + Outbox

Observation plane
ACP/hook/stdout -> RunObservation/blob -> optional UI
```

UI 可以把两者并排显示，但必须视觉区分：业务 timeline 是 authoritative；thinking/tool/terminal 是 diagnostic。Observation 缺失时显示 `telemetry incomplete`，不得回退到猜测业务状态。

这吸收了 Raft external plugin 将 telemetry 作为非权威数据的经验，也避免 Multica 为统一 rich transcript 承担的 Provider 解析成本进入 Kernel。

## 5. Activation 执行流程

下列是 Runtime Registry 完成后的目标流程；当前实现仍在 lease 后使用 daemon 唯一的 RuntimeAdapter：

```text
schedule-needed Outbox / fixed Kernel reconciliation
  -> Kernel filter/score fresh RuntimeOffers
  -> atomically lease Activation + reserve durable PlacementDecision for one Host generation
  -> selected Host pulls its assigned Placement
  -> create RunAttempt + freeze Agent/Policy/Profile/Model/Workspace + ContextManifest
  -> start adapter supervisor in prepared/no-target state
  -> durably register RuntimeProcess(prepared)
  -> authenticated launch target
  -> verify returned handle; atomically mark RuntimeProcess(active) + RunAttempt(running)
  -> Agent 执行 room_sync
  -> Agent 显式 task/message/artifact/review command
  -> reap process
  -> finish RunAttempt
  -> complete/fail Activation
```

进程 exit 0 只说明 process 正常结束。若 Agent 没有显式提交所需业务 action，RunAttempt 可成功结束，但 Task 保持原状态，并由 policy 决定是否 retry/block/escalate。

## 6. Wake 与 proof taxonomy

系统必须分别记录：

```text
activation_outbox_persisted
schedule_tick
activation_leased + placement_reserved + placement_outbox_persisted (same transaction)
placement_hint_dispatched
host_received
placement_pulled
run_started
context_delivered
agent_synced
inbox_acknowledged
responded / task_submitted / reviewed
```

前一状态不能推导后一状态。activation wake 只包含 Activation identity、participant、reason 和 head cursor；placement wake 只包含 placement identity 与目标 Host generation。两者都不含消息正文、私密 sender 内容、prompt、路径或 secret。

Host 不能依赖 wake 生存：当前单-runtime 实现会在启动、重连和固定 reconciliation interval 主动 lease queued/expired Activation；Runtime Registry 目标实现则由固定 Kernel scheduling reconciliation 恢复 placement、Host 固定 pull reconciliation 恢复已分配工作。无论哪一阶段，目标 SLA 都由部署配置声明并由测试测量，而不是写“最终会恢复”。

## 7. ACP、AHP、A2A 的位置

- ACP：AgentHost ↔ 单个 coding agent，首选 L1 adapter。
- AHP：Room UI/多客户端状态同步的设计参考；它的 Session/Chat state 不能成为 RAH business owner。
- A2A：远程 opaque agent connector，接入前映射到本地 AgentDefinition、Activation、RunAttempt、Artifact。
- RAH CLI/MCP/HTTP：Agent ↔ Room application service 的显式业务命令。

因此 ACP update 或 Provider stream 可以告诉 UI“正在运行 tool”，但只有 `rah task submit` 能告诉 Room“工作已经提交审查”。

## 8. 支持一个 CLI 的定义

必须分别标注：

| 等级              | 定义                                              |
| ----------------- | ------------------------------------------------- |
| Worker-compatible | L0 可启动，能调用 RAH 命令，业务 conformance 通过 |
| Session-capable   | 可安全 resume/close Provider Session              |
| Interactive       | 支持 live input、permission/elicitation/cancel    |
| Observable        | 有 typed tool/status/usage telemetry              |
| Certified         | 指定版本通过真实 CLI 与故障门禁                   |

禁止用一个“Supported”勾号掩盖能力差异。
