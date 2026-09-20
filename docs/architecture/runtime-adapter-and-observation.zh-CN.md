# Runtime Adapter 与观察平面

状态：最小 AgentHost、Fake/Generic Runtime、Host generation fencing、deadline、Outbox wake、持久 `prepared -> active` RunAttempt/RuntimeProcess 和 scoped Worker API 已实现；Codex `gpt-5.6-sol/low`、Kimi `kimi-code/k3` 与 OpenCode `deepseek/deepseek-v4-flash/max` 已通过 opt-in 本机完整 Task gate，fake process 已通过 InputRequest 无 listening 恢复 gate。主动逃离 process group 的 descendant、完整 Artifact/Review workflow 和 Windows tree recovery 尚未实现或验证。

## Agent 默认执行目录

支持私有工作区的本地 daemon 以 `supportsAgentPrivateWorkspace` 发布可信能力；新建 Agent 定义显式保存 `executionWorkspace: agent_private`。旧定义缺字段保持既有 mount，显式 `existing_mount` 只接受 Host 已授权的非私有 mount。缺能力的旧 Host 与独立 Computer 不发布该能力，也不能调度私有 Agent。

Kernel 保存定义意图、按 participant 匹配 mount 并冻结 Placement；AgentHost Catalog 唯一解析 Host 路径，按稳定 participant ID 准备独立 cwd。启动、Worker 文件根、prompt cwd、文件浏览与 RuntimeProcess 恢复描述符消费同一冻结 mount；恢复不按当前配置重新猜目录。Host 心跳绑定是认证后完整快照，最多 512 项，超限拒绝而不截断。未准备成功的私有目录不得回退到全局 cwd。

私有 cwd 与既有 Agent 文件记忆分离，不改变记忆 owner。full reset 复用执行围栏与现有完成收据：私有执行目录先隔离，完成决定落盘后只允许 finalize，未完成重启保持阻断；旧共享项目目录不删除。隔离目录保留用于恢复，自动 GC 尚未接入。私有 cwd 是默认路径隔离，不是同一系统用户下的 OS 文件沙箱。实现、上游定位与验证边界见[本地私有 cwd 交付](../audits/2026-09-11-agent-private-cwd-implementation.zh-CN.md)。

## Runtime 级 Guide 设置

用户更新的本地扩展：已接通的 Codex/Claude Guide 默认开启，其他接法等待；已有显式偏好保留。daemon 以 `runtime-guide.json` 保存按 CLI 的 Guide 开关与 revision。它只拥有投递偏好；待处理消息仍由 Kernel Inbox/Activation 唯一持久化。Human 认证 API 与共享 Client SDK 读取和修改独立 Guide 开关，Host 在通知读取前及实际投递前检查偏好，技术能力、会话/工具边界仍由 adapter 检查。关闭不会撤回已提交输入，开启也不确认 read/ACK/Task；传输拒绝仍留在原 follow-up。等待仅延后主动输入，不隐藏已经发布的 Room 消息，Agent 主动读取仍受既有权限与 freshness 规则约束。

当前可选接法为 Codex app-server 与 Claude stream-json；Kimi ACP、OpenCode 尚未接通的 Guide 不可开启，未知 Runtime 默认等待。开关影响下一次尚未开始的投递，可独立开关；revision 冲突要求重新读取。此开关是用户授权扩展，不能冒称 Raft 已有同样设置。[源码对照](../audits/2026-09-11-runtime-wait-guide-source-matrix.zh-CN.md)。

## OpenCode 长请求

OpenCode native-server 的同步 prompt 请求使用仅连接本机 loopback 的 HTTP
transport，避免 Node fetch 自带的响应头五分钟超时先于 Host 监督中止运行。
普通控制请求仍保留短超时；长请求的生命期由 Host 存活检查、原生 abort 与进程终止
共同管理。HTTP/Provider 错误、响应校验、会话恢复与 terminal proof 规则不变。
这是 RAH 现有 serve 适配器的修复，Raft Computer 1.0.32 使用的是 `opencode run`
子进程，不能称为传输代码的直接移植。证据见
[交付与长请求修复](../audits/2026-09-17-reply-delivery-and-opencode-timeout-repair.zh-CN.md)。

2026-09-18 起，`runTimeoutMs` 对支持 `isAlive` 的 adapter 是存活复查间隔，
不再是每次运行的累计时长上限。参照 Raft Computer 1.0.32 的
`markRuntimeProgressStaleIfNeeded`，目标进程仍存活时保留执行；监督进程通过
认证控制通道查询实际 target leader，不能把 supervisor 自身活着当作 target 活着。
未知/失败的探测进入原有 cancel/reap 流程，只有完整进程组终止证明允许重试。
不支持探测的 adapter 保留原有有界回退。启动、取消和 drain 的截止时间不变；
这不意味着仅凭进程存活就证明模型有进展。见
[超时与隔离撤销修复](../audits/2026-09-18-runtime-timeout-and-quarantine.zh-CN.md)。

## 当前原生忙时投递扩展

Codex 已提供可选 notifyBusy：Kernel 只读 pending Inbox 投影经 Host 和既有认证 supervisor，送入当前 turn 的原生 steer。传输回执不推进 canonical read/ACK/Task；未确认输入保留 durable follow-up。Claude 的旧 gated 工具边界已于 2026-09-18 按 Raft Computer 1.0.32 改为 direct：已就绪的恢复会话由原生 stream-json 队列接纳输入，不等待 thinking、工具或 compaction 边界。来源与验证见[调度对齐第一批](../audits/2026-09-18-runtime-scheduling-alignment.zh-CN.md)。Kimi 与跨 Activation 常驻、已消费 follow-up 的闭合仍未据此完成。

## 1. 承诺边界

RAH OS 不承诺“接入任何 CLI 都零适配”。它承诺：

> 一个新 CLI 无需 Provider transcript parser，就能通过显式 RAH 命令参与 Room 业务流；只有增强体验需要可选适配。

CLI 必须至少能通过受限的 `rah worker`、MCP、ACP 或 A2A 中的一种方式调用 RAH application service。若 CLI 完全无法执行结构化外部动作，它不能成为可信 worker，只能作为人工复制内容的聊天工具。

## 2. 五个分离对象

| 对象                   | 含义                                                                 | Owner              |
| ---------------------- | -------------------------------------------------------------------- | ------------------ |
| AgentDefinition        | 长效身份；不可变 revision 固化职责、技能和 memory/execution policy   | Kernel             |
| RuntimeProfileRevision | Host 本地不可变 launch/adapter/capability/model binding 配置         | AgentHost registry |
| ModelSelector          | policy 中的可移植意图；由具体 runtime binding 映射 provider 参数     | Kernel policy      |
| ProviderSessionRef     | CLI 返回的 opaque resume handle；只存在于 Computer/Host 私有存储     | Provider adapter   |
| RunAttempt             | 引用 durable Placement，冻结 profile/model/host/workspace provenance | Kernel             |

Agent 不永久绑定一个 CLI 或模型。ExecutionPolicy 先按 hard capability/security/workspace/model constraint 过滤带 TTL 的 RuntimeOffer，再按显式 preference 评分；RunAttempt 必须引用 durable PlacementDecision，后续修改配置不能篡改历史 provenance。`reasoning=high` 等 portable intent 只有在具体 binding 明确映射时才有效，不能猜测 Provider 参数。严格 schemas、pure planner、durable Placement、atomic launch claim、MultiLane Core path、daemon config v4 的多 profile 路由与真实 Codex/Kimi/OpenCode 同 Room reply gate 已实现；Kimi ACP、Codex app-server、OpenCode serve 与 Claude stream-json native adapter 均已进入 registry，并通过不计费 fake native protocol 证明 Host 私有 resume-or-fresh 与 Provider cancellation，Codex 另通过正式 daemon-restart gate。ProviderSessionRef 不进入 Kernel placement 或业务状态。configs v2/v3 仍是无 Placement 的兼容路径；busy live input 经审计保留为 L1 延迟优化，在 Kernel notice/grant 扩展前不得只向 driver 写正文；真实付费 Provider interrupt/watchdog、完整 Workspace mount/Capacity 管理面和 mixed-adapter crash recovery尚未实现。详细边界见 [Runtime Registry 与多 Lane 调度架构](./runtime-registry-and-multi-lane-scheduling.zh-CN.md)、[Provider CLI 执行传输与权限审计](../audits/2026-08-28-provider-execution-transport-audit.zh-CN.md) 与 [Runtime live input / steer 所有权审计](../audits/2026-08-29-runtime-live-input-ownership-audit.zh-CN.md)。

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
- Provider-native 结构化运行轨迹使用与 stdout/stderr 分离的 fd3 NDJSON side channel；direct target 的 fd3 由 adapter 读取，supervised target 的 fd3 由 supervisor 转发到 parent fd4。每行限制 16 KiB、累计缓冲 64 KiB。`rah-provider-session/v1` 私有 frame 在 canonical parser 前被截获并写入 Host-local store，永不送入 Kernel trajectory；其余 frame 必须通过 `RuntimeTrajectoryAppendInputSchema`，并按 producer sequence 串行写入 Kernel。无效/过大 frame 只进入有界 diagnostics。Codex/Kimi/OpenCode/Claude 归一化共用单一 owner，SEA 构建会把该 owner 与各 Provider 的 identity-bound permission policy 一起静态打包；
- POSIX 下为每次 Run 建立独立 process group；取消先只向受监管 leader 发 `SIGTERM`，让结构化 adapter 有机会发送 ACP `session/cancel`、Codex `turn/interrupt` 等 Provider-native 取消；宽限期后对整个 group 发 `SIGKILL`，并验证留在该 group、忽略 `SIGTERM` 的 descendant 不会遗留；
- `reap` 等待 stdio `close` 后返回 OS exit code/signal，且保留期间同一 handle 可重复读取结果；已完成 run 的 opaque diagnostics 默认只保留最近 100 个，也可显式释放，避免 daemon 内存无界增长。
- 动态 environment lease 把 per-Activation Worker token 写入唯一 owner-private `0600` session file，并在同一 `0700` 目录生成不含 token 的可执行 `rah` wrapper。该目录在本次进程的最终 `PATH` 中置顶，同时以非敏感绝对路径 `RAH_WORKER_CLI` 显式发布 wrapper；standing prompt 必须调用 `"$RAH_WORKER_CLI" worker ...`，避免 Provider 的 login shell 重建 PATH。旧 `RAH_WORKER_TOKEN[_FILE]`、内部 tool-bin hint、继承环境和 RuntimeProfile 静态环境均在 direct/supervised 共用路径剔除；bearer 从不进入环境。Worker CLI 只映射固定的 Room/Task application commands，校验 origin/session file、参数、超时和响应上限，不接受任意 endpoint。进程 exit 或 spawn failure 时先撤销并清理精确目录，即使撤销失败仍尝试删除；真实子进程已通过该 wrapper 完成 Room `sync/ack`，Host 只依赖 Kernel cursor proof。SEA 通过精确的 `__worker-cli` 内部分派复用同一实现；Windows 目前 fail closed，尚无对应 wrapper。
- 子进程环境由单一 owner `packages/agent-host/src/launch-environment-policy.ts` 决定，direct 与 supervised 两条启动路径调用同一函数，因此产生同一份过滤结果；supervised 路径只额外加入自己的 `RAH_PROCESS_SUPERVISOR_CONFIG/TOKEN`，并在启动 Provider 前删除。策略分三层：继承自 daemon 的环境按前缀剔除整个 `RAH_` 命名空间（服务凭据、内部传输与部署位置，如 `RAH_DATA_HOME`、`RAH_STATE_DIRECTORY`、`RAH_LAN_KEY_PATH`、`RAH_WEB_PORT`、`RAH_RESIDENT_RUNNER_TOKEN`、`RAH_WORKER_*`）；受控 capability 只经 Activation environment lease 重新注入；Activation identity fence 最后写入，任何继承值、RuntimeProfile 静态环境或 lease 都不能覆盖。`RAH_` 之外的环境一律保留，包括 `HOME`、`PATH`、Provider 登录/配置目录（`CODEX_HOME`、`CLAUDE_CONFIG_DIR` 等）、代理与证书变量（`HTTP(S)_PROXY`、`NO_PROXY`、`SSL_CERT_FILE`、`NODE_EXTRA_CA_CERTS`）、locale 与 `TERM`；这不是白名单。用户 per-Agent 启动环境另有 `filterUserLaunchEnvironment` 与 typed `RuntimeLaunchEnvironmentSchema` 两道同形拒绝规则，`RAH_*`、`HOME`/`PATH`/`NODE_OPTIONS`/`LD_*`/`DYLD_*` 与平台身份围栏（`CLAUDE_CODE_DISABLE_AUTO_MEMORY` 等）不可设置，合法的 `CODEX_HOME` 之类显式配置照常透传。该机制是环境卫生，不是同系统用户下的 OS 沙箱：Provider CLI 仍以同一 macOS 用户身份运行，仍可读取该用户可读的文件。
- `cancel` 只有在返回 terminal `RunExit` 时才证明终止；若 cancel/reap 无法证明进程死亡，Activation 进入 durable quarantine，同一 participant 的后续 queued work 不得越过。
- `start(input, lifecycle)` 必须先调用 `lifecycle.registerPrepared(handle)`；Kernel 在目标副作用前持久化 opaque `RuntimeRecoveryDescriptor` 与 `RuntimeProcess(prepared)`。adapter 返回的 handle 必须与已准备 handle 完全一致，Kernel 才把 RuntimeProcess 和 RunAttempt 推进为 `active/running`。正常 reap/cancel 必须先写 terminal proof，存在非 terminal RuntimeProcess 时 Kernel 拒绝完成 Activation。
- orphan recovery 使用独立、可续租、按 attempt fencing 的 lease；只有声明匹配 descriptor driver 的 adapter 可以领取。恢复失败 durable backoff，恢复成功写 terminal proof、合并 follow-up 并解除 quarantine，daemon 主循环随后才能重新 lease Activation。旧 recovery attempt 不能在新 lease 下提交结果。
- Provider-native `runtime_error` 轨迹先归一为结构化 `RuntimeFailure`，再随 terminal `RunExit` 进入 AgentHost；stdout/stderr 仍不参与业务判断。认证/登录错误是 `action_required`，input-too-large、model configuration 和 zero-evidence terminal 是 `sticky_terminal`，两类均绕过普通错误指纹计数并立即进入 durable quarantine，等待显式修复/重启。其他错误为 `recoverable`，以配置 `retryAfterMs` 为基数按 attempt 指数退避、5 分钟封顶，并采用 Raft 同形的 0–10% 正向 crypto jitter；`retryAfterMs=0` 的测试/显式策略仍保持立即重试。无结构化轨迹的普通非零退出保持保守 `RuntimeError/recoverable`，不会从 stdout 猜类别。

POSIX GenericProcessAdapter 现使用 `rah-process-supervisor-v1`：每 Run 的外部 supervisor 先在 owner-private directory 建立 mode `0600` 的 Unix socket，但不启动目标；descriptor durable prepare 后才接受 authenticated `launch`。control request 和 HMAC terminal result 同时绑定 supervisor UUID、RunAttempt ID、runtime Run ID 与 256-bit token。descriptor 不用 PID/PGID 作恢复身份；伪造 identity/token 不触发 signal。graceful cancel 只 signal leader，避免同时杀死 Provider child 而与 native cancel 竞速；deadline 到期的 `SIGKILL`、leader 自然退出后的清理和 recovery 则始终覆盖整个 process group。只有进程组不存在才原子写 terminal result。半开 socket 有限时且不阻塞 terminal cleanup；stdout/stderr forwarding 是允许丢失的观察平面。supervisor config/token 会在 spawn CLI 前从环境中删除。

跨进程 E1 fixture 已让真实 AgentHost 在 target launch 后、`run.started` 前被 `SIGKILL`：数据库保留 `starting + prepared`，lease expiry 后进入 orphan/quarantine，新 Host 领取 recovery lease、认证清理原 process group、验证签名 result 并重新排队 Activation。独立 Fake Host/Kernel fixture 验证 recovery lease 跨原到期点续租与 attempt fencing；其他 fixture 覆盖 leader 先退而同组 descendant 忽略 TERM、错误 identity/token、半开 socket 和启动/恢复期不安全目录。它证明受控 POSIX 故障窗口，不证明 supervisor 自身被 SIGKILL/断电、PID namespace 极端复用、主动 `setsid`/double-fork 逃离 group 的 descendant 或真实 Provider CLI。强 tree containment 需要 Linux cgroup v2 或经验证的平台原生 primitive；当前只声明原 group 清空。

Windows 仍使用 `generic-process-direct-v1` 且不声明 recovery driver。确定性 fake process 已证明 canonical Task query、claim heartbeat、跨 RunAttempt 恢复，以及 `waiting_input` 期间零 RunAttempt、human resolve 后新 Activation 恢复；fake MultiLane 又证明 open Task 单 winner 和 loser completion。2026-08-28 的真实 Provider 门禁进一步证明 Codex Sol/low、Kimi K3 与 OpenCode DeepSeek V4 Flash/max 可经绝对 `RAH_WORKER_CLI` 完成最小 durable Task；Kimi 的 gate 没有 effort selector，不能据此提升其 observed effort metadata。尚未证明的边界包括：真实 Provider InputRequest、Artifact/Review、supervisor 自身被 `SIGKILL`/断电后的 terminal proof、result directory 的安全回收、可安装 package lifecycle，以及 Windows Job Object/tree kill。详细决策见 [ADR-0003](../adr/0003-identity-safe-process-supervisor.md)、[ADR-0005](../adr/0005-daemon-composition-worker-delegation-and-wake.md)、[ADR-0006](../adr/0006-task-business-protocol-and-causal-worker-commands.md)、[ADR-0007](../adr/0007-durable-input-request-and-no-listen-waiting.md) 与 [ADR-0011](../adr/0011-task-coordination-v1.md)。

### L1 ProtocolAdapter：可选结构化能力

2026-09-18 启动路径增量：四个 Provider 共用有界 `providerActivationInput`，
首次 Worker 调用使用 `message-check --startup`。AgentHost 的
`worker-startup-context.ts` 只输出白名单冻结上下文及当前 Agent 的完整原始
`MEMORY.md`，随后复用原有消息交付/输出/ACK；没有另一套消息读取游标或记忆筛选。
读取身份或输出失败不能 ACK。该聚合减少工具决策次数，不证明模型理解或业务完成。

Kimi ACP 在已确认恢复同一 standing-prompt digest 的 session 时不再重复追加
全量规则；fresh/fallback 仍发送完整规则。每 Run 的私有完整规则文件支持
压缩后的提示式恢复并在退出时清理，但这不是 Raft 原生 `roleAdditional`，
未完成真实 compaction 与 persistent/steer 验收。Codex 保留已核对 turn 身份的
有界原生错误消息，使既有模型配置错误策略能停止无效重试。详见
[P0 修复及残留](../audits/2026-09-18-latency-p0-repair.zh-CN.md)。

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

### OpenCode observation 身份过滤（2026-08-31）

`opencode-event-identity.js` 是 Host-private owner：依据上游 SDK 的 `message.updated.info.role` / message ID 分类内容，而不是将所有 text part 当作 Agent 输出；同时核对根 properties、info、part 内的 sessionID，拒绝冲突/异会话事件。乱序未知角色片段最多等待256条/64KiB，角色表最多4096条；溢出或永远不能确认角色的片段可丢弃，不猜角色。这是有界的诊断过滤，不是 canonical 消息过滤，当前也不能据此承诺无损 telemetry。

同一 busy 状态重复到达只显示一次“正在处理消息”，不把它说成多次“模型请求已开始”。404 resume fallback 的安全依据仍独立记录原生当前 session 的工具活动，不能因为过滤掉未确认角色的工具事件而错误准许重试。首次执行和 resume 的消息正文仅经显式 Worker action 写入 Room；exit0、轨迹文本均不替代 delivery acknowledgement。

分类依据来自 [OpenCode 官方 SDK Event 类型](https://raw.githubusercontent.com/anomalyco/opencode/dev/packages/sdk/js/src/v2/gen/types.gen.ts)。该过滤实现是适配本系统 Host 的 glue，不宣称是 Raft server 源码的直接移植。真实两轮文件读回/Room回帖证据见 [核心交互收口复审](../audits/2026-08-31-core-interaction-closure-review.zh-CN.md)。

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

## 9. 轨迹预览失效提示

AgentPresence 的可选 `trajectoryVersion` 由现有 RuntimeTrajectory owner 读取该 Agent
最新记录的 `server_sequence`，空轨迹为 0。该值仅用于判断有界预览是否需要重读；
清理最新记录可使值回退，客户端只比较相等性，不把它当分页 cursor 或单调业务序号。
它不含轨迹正文，不替代读取 ACL、activityAt、Room ACK、Inbox 或 Task 状态。
Web 复用现有 presence reconciliation，不新增计时器或轨迹缓存；旧 daemon 缺少此字段时
保留 activityAt 刷新。来源与验证见[审计](../audits/2026-09-07-agent-preview-trajectory-refresh.zh-CN.md)。

## 2026-09-11 投递说明与会话就绪

Runtime adapter 的 `busyInputMode` 与可用 transport、用户 Guide 开关共同决定
有效模式；Host 投递 admission 与 daemon standing prompt 消费同一判定。
每个 Run 编译时重读开关，通知说明不承诺运行中开关永远不变。mode 属行为
默认，参与 provider continuity digest；Room/Host/cwd 仍不参与该摘要。

Claude 匹配的恢复会话才允许 direct 忙时输入；新会话在当前有限进程模型下
通过后续 Activation 处理积攒内容。session ID 出现不等于新会话已经就绪；
result 后不再开放输入，已经写入 CLI 的输入可在退出前产生后续 result。
恢复失败转新建时重新建立 admission 并恢复共用输入流读取。
以上是 Raft readiness 的有限 Run 适配，非 persistent 会话完整移植。
从 gated 升级为 direct 时，daemon 用同一 Agent 的当前身份与规则精确重编译旧模式
摘要；Claude adapter 仅在新 key 不存在时读取这个兼容 key。participant、Provider、
profile revision 和 workspace mount 仍须一致，不能扫描或复用别的 Agent/角色的会话。
新 key 仍只在原生成功结束且身份匹配后落盘。兼容摘要是 Host 内部 lease metadata，
不进入子进程环境或公共协议。来源、差异及验证见
[调度对齐第一批](../audits/2026-09-18-runtime-scheduling-alignment.zh-CN.md)。

## 受管 Provider 自动记忆

用户要求内置 Claude/Codex driver 在每次启动时关闭 Provider 自动记忆读取/生成，保留登录、HOME、会话恢复与 RAH Agent MEMORY.md/notes。这是明确的本地策略，不是 Raft 已有开关。旧会话上下文不会被清除；自定义 Runtime 与普通文件读取不属于自动记忆开关保证。来源与验证见[进程级自动记忆关闭](../audits/2026-09-11-provider-auto-memory-disable.zh-CN.md)。

管理页只展示系统固定启动命令与环境变量，不再提供全局启动参数/环境变量的追加、覆盖或保存；独立的 Guide 忙时投递开关保留。历史全局启动覆盖、附加参数及环境变量保留磁盘兼容，但不进入读取视图或下一次启动；不自动迁移到 Agent。详见[只读 Provider 设置](../audits/2026-09-13-provider-settings-readonly.zh-CN.md)。

## 显式模型目录刷新

Human 可通过 host.runtime.list 的可选 refreshOfferId 请求 daemon 对已配置 Runtime 重新探测模型目录。同一 offer 的并发刷新合并；普通轮询保持轻量。刷新必须保持 active revision 与 executable identity，发布新的不可变 offer observation，禁止改写既有 Placement/RunAttempt 引用。失败保留原目录，二进制更换要求重启。证据见[成员详情与目录修复](../audits/2026-09-13-member-runtime-detail-parity.zh-CN.md)。

## Host 启动配置作用域

RuntimeGuideSettings 是 Host 本地启动配置的唯一所有者。可编辑作用域仅为 AgentDefinition + runtime；执行时使用 Activation 的 Agent 身份读取。全局启动配置更新返回 conflict；仅 enabled 字段的独立 Guide 更新仍允许，系统受控通信、模型及环境参数保持保护。启动配置与 canonical 模型策略独立保存，下一次启动生效，不改写活动 Run。旧的全局继承策略已由[只读 Provider 设置](../audits/2026-09-13-provider-settings-readonly.zh-CN.md)取代。

2026-09-13 用户范围收敛：Agent 额外启动配置仅支持环境变量；历史自定义 argv 不再应用或开放写入，系统生成参数与独立 Guide 设置保留。详见[环境变量收口](../audits/2026-09-13-agent-environment-only.zh-CN.md)。

## 显式自定义模型

ModelIntent.customModel 由 Protocol 定义原生 runtime/modelId，不能与 exactBindingIds 或 capabilityClass 混用，fallback 必须关闭。Kernel 只允许匹配 customModelRuntime 的 Offer；AgentHost 再检查原生 Claude/Codex adapter 并原样传参。未探测的自定义模型不获得虚构的 binding 或 effort/tier 能力，Placement/RunAttempt 以 custom_model 保留来源。目录候选与运行可用性分离，详见[候选与自定义 ID 审计](../audits/2026-09-20-claude-catalog-custom-models.zh-CN.md)。
