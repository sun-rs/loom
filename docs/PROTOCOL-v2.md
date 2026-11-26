# loom 协议 v2

loom 直接采用 OAR 的运行时契约。每个 loomd 管理一个工作目录内的会话索引、持久收件箱、波次搬运、巡检和项目通知。

下文的 `src/` 路径相对于任务指定的 OAR 源码快照中的 `packages/oar/`，`OAR/` 指向该快照根目录。引用的源码快照标为 `0.129.1`。本设计沿用接入目录锁定的 `@botiverse/oar@0.130.1`，核心入口和类型已与本地安装包的声明比对。`OAR/packages/oar/package.json:1-4,8-19,90`、`runtimes/oar/package.json:10-12`、`runtimes/oar/package-lock.json:447-450`。 [PROTO-2 任务卡](../tasks/PROTO-2/TASK.md)

## 1. 直接采用的 OAR 契约

| 接口 | OAR 类型或成员 | 源码 |
| --- | --- | --- |
| 运行时注册与打开 | `Runtime`、`RuntimeRegistry`、`createRuntimeRegistry`、`StartSession`、`InstallationProbe`、`AvailableInstallation`、`SessionOptions` | `src/contracts/runtime.ts:119-175`、`src/registry.ts:3-36`、`src/contracts/session.ts:111-120`、`src/contracts/installation.ts:3-34,87-98`、`src/contracts/session-options.ts:44-61,89-126,166-176` |
| 自建运行时 | `defineRuntime`、`AdapterSession`、`createSessionKernel`、`sealSession` | `src/contracts/runtime.ts:231-251`、`src/contracts/session.ts:180-215`、`src/kernel.ts:14-20` |
| 会话、能力与状态 | `Session`、`SessionCapabilityDeclaration`、`installedSessionCapabilities`、`SessionCapabilities`、`QueryResult`、`AgentStatus`、`SessionUsage` | `src/contracts/session.ts:56-61,123-145,217-294`、`src/contracts/runtime.ts:33-77,266-276`、`src/contracts/status.ts:10-16,26-54` |
| 记录与回放 | `RawEvent`、`Frame`、`RequestRecord`、`ResponseRecord`、`RecordEnvelope`、`Event`、`Cursor`、`SessionGraph`、`Session.rawEvents`、`Session.records`、`Session.events` | `src/contracts/records.ts:26-89,225-235`、`src/contracts/graph.ts:4-24`、`src/contracts/session.ts:198-200,231-238`、`OAR/docs/spec/session-graph-and-cursor.md:116-152` |
| 输入与中断 | `InputOptions`、`PromptOptions`、`ControlResult`、`ControlOutcome`、`RejectionCode`、`Session.prompt`、`queue`、`withdraw?`、`steer?`、`abort`、`dispose`、`DeliverOptions`、`DeliverResult` | `src/contracts/session.ts:62-79,190-230,267-282`、`src/contracts/control.ts:4-21`、`src/contracts/records.ts:262-298`、`src/contracts/deliver.ts:5-45` |
| 轮次与结果 | `RuntimeEventBody`（`turn_active`、`turn_ended` 等）、`ControlEventBody`（`turn_started` 等）、`TurnOutcome`、`FailedTurn`、`FailureClass`（`quota`、`rate_limited` 等）、`PromptRun` | `src/contracts/records.ts:130-148,175-176,210-223`、`src/contracts/turn-outcome.ts:3-15`、`src/contracts/failure.ts:26-40,51-85`、`src/observe/turns.ts:164-172` |
| 历史与恢复 | `SessionOptions.resume`、`Session.nativeSessionFile?`、`SessionNotFoundError`、`SessionUnavailableError`、`SessionView`、`ViewTurn`、`ConversationInput`、`initialSessionView`、`reduceSessionView`、`awaitIdle`、`awaitTurnEnd` | `src/contracts/session-options.ts:166-176`、`src/contracts/session.ts:189-201`、`src/contracts/session-not-found-error.ts:10-17`、`src/contracts/session-unavailable-error.ts:10-30`、`src/observe/session-view.ts:137-147,171-204`、`src/observe/conversation.ts:23-45`、`src/observe/index.ts:31-50` |

## 2. loom 的薄扩展

### 会话索引

| 字段 | loom 用途 |
| --- | --- |
| `addr` | loom 生成的稳定地址。重挂复用，导入 v1 时保留旧地址。 |
| `project`、`role`、`task`、`wave`、`parent` | 项目寻址和角色分工。`parent` 保存发起会话地址，外部发起时为 `null`。换班后的常驻会话以其前任为 parent，历史仍可追到原派工和原生轮。 |
| `runtimeId`、`sessionId`、`cwd` | 定位运行时和原生对话，分别取 `Runtime.id`、`Session.id` 和绝对工作目录。恢复沿用保存的目录与原生 ID。 |
| `cli`、`backend`、`pane` | 选择输入与历史适配器。TUI 另外核对窗格创建时间、PID 和工作目录。 |
| `transcriptPath`、`baseCommit`、`account` | 保留记录路径、证据对比基线和兼容字段。当前 `account` 保留空值。 |
| `startedAt`、`endedAt` | 打开和确认关闭的时间，单位为 Unix 毫秒。会话仍打开时 `endedAt` 为 `null`。 |

请求的 `model`、`effort` 随启动参数保存。查询到的有效值取 `Session.model()` 和 `Session.effort()`。Claude 的窗格绑定由 `claude-tui` runtime 按原生会话身份管理。`src/contracts/session.ts:238-242`

Super 在项目根写入 `.project/policy.json` 后方可 spawn。参见 [角色策略示例](../examples/policy.json)。`roles.<role>.preferred` 选择有序首选项，未设置时使用全局 `preferred`。全局与角色 `deny` 均优先。模式缺省为常驻角色 TUI、Worker headless。每个提供方使用一个已授权账号。启动方选择的运行参数和 Leader、Auditor 在候选 SHA 的干净独立 worktree 跑验收所需权限由 Super 授权。loomd 启动时将项目根内的 `.project/` 写入本地 Git `info/exclude`。策略、索引和证据留在该目录。

托管调用默认从 `LOOM_PROJECT` 取项目，`spawn --parent` 和 `send --from` 分别默认继承 `LOOM_ADDR`。外部调用使用绝对 `--project DIR`，外部派工显式指定 Leader 地址。Worker 的首轮提示附带任务卡约定。

### 收件箱

所有管理内输入先写入同一份 `.project/inbox/state.json`，包含请求正文、目标绑定、来源、`deliveryId` 和请求模式。波次、自动回送、巡检及普通请求共用这一账本。调用方可用 `loom send --id UUID` 在 RPC 断开后按原 ID 重交完全相同的请求。不同正文、目标、来源、模式或续作批次复用原 ID 返回 `id-conflict`。

| `deliveryStatus` | 可观察语义 |
| --- | --- |
| `accepted` | loom 已提交持久输入意图，尚待原生接管。原有 `status` 字段继续表达 `queued`、`delivered`、`steered` 或 `interrupted`。 |
| `delivered` | 目标原生记录中出现带 `[loom:<id>]` 的输入轮。若原生轮已结束但无法确认最终正文，保留该状态并在适用时返回 `replyStatus: unconfirmed`。 |
| `answered` | 已将可归属的原生最终正文与完成记录一并持久化。`--wait` 最长等待五分钟并在此状态返回正文。 |
| `refused` | 明确未获接管，或请求的轮次、绑定已不可用。正文、ID 和原因仍在账本。 |
| `uncertain` | 输入或取消可能已写入，等待原生证据。 |
| `stalled` | 投递超出 SLA。原请求保持可对账，后续原生回执可以结束等待。 |
| `target-ended` | 目标会话已结束，原生对账后仍缺少完成证明。保留已有输入证据，结束投递并从待处理列表移除。 |

| 模式 | 编排动作 |
| --- | --- |
| `queue`（默认） | 按目标的持久 FIFO 等待。可写时用 headless `Session.prompt(text, { inputId })` 或 hc 交给原窗格。发现忙轮时记录屏障，正常情况下按同轮结束证据通过屏障。 |
| `steer` | 对具备原生能力的 headless 锁定请求时的根轮。TUI、能力缺失、目标轮变更或明确尚未写入时，沿原 ID 降级为 `queue`。旧版本已发出的 TUI steer 仍按原生标记对账。 |
| `interrupt` | managed Codex headless 使用含原生 turn ID 的 RPC。managed agy／OpenCode headless 依赖独占 OAR ACP 轮槽和 OAR 的取消前检查。目标轮已更替则拒绝，出现匹配的取消轮末且目标可接收后才开续作轮。hc 的按键接口无法原子核对轮身份，managed TUI 和未核实相同保护的 headless 运行时返回 `unsupported`。 |

TUI 发键前须同时看到两项证据。完整可见屏幕由适配器明确分类为 `idle`，且同一原生会话的启动 hook、匹配轮末 hook 或结构化 transcript 投影也证明空闲。hc 的忙或阻塞状态可否决发键，hc 的 `idle` 不单独建立可写性。未知、不完整、草稿、压缩或信号冲突期间，保留队列，在 `loom state` 显示 `writeEvidence`，在排队回执保存 `waitingForWritable`，只保存分类和轮次元数据。Codex 通过当次命令的 `SessionStart` hook 建立启动证据，Claude 由 Claude TUI runtime 捕获，OpenCode 可用已绑定的空会话导出。缺少启动证据的 TUI 会话会等待已有原生轮留下可核实的结束记录。OpenCode 首次提交遗留的草稿也等待原生证据。

新建的托管 Claude TUI 通过 `.project/loomd/hook.mjs` 运行原生 hook。shim 保留事件文件、原生会话 ID 和启动目录三个参数，读取同目录已生效的 `release.json`，并调用该版本的采集脚本。项目首次启动尚无发布指针时使用启动版本。热切换后现有 shim 会在下一次事件读取新指针。旧窗格仍执行原来固定的 hook 路径，loomd 可在接管后直接用原生 transcript 恢复缺失的 Stop。

Claude hook 以原生会话 ID 归属事件，记录实际 cwd，并排除子代理。一个绑定轮次缺 Stop 时，loomd 仅在根 transcript 中同时看到助手最终回复、轮末 `turn_duration` 或未要求继续的末尾 `stop_hook_summary`、全部工具结果且没有运行中的后台任务，才以 transcript 结算。正常屏幕和人工输入守卫仍适用。最近一次轮末由 transcript 补齐时，`loom status` 标记 `hook-gap`，`loom state --json` 返回证据时间和来源。

loomd 在常规定时轮询中扫描所有未确认投递，包括没有屏幕或 hook 变化的目标。账本保留创建时间、阻塞原因和首次超时点，接管新版本后从同一份账本继续。超时从创建开始计算，`delivery.stallMs` 默认 120000 毫秒，观测到忙轮或压缩时使用三倍期限。排队回执提供 `ageMs` 和 `reason`，例如 `waiting-writable`、`draft-held`、`uncertain` 或 `no-native-turn`。`LOOM_UNCERTAIN_MS` 兼容为未配置策略时的期限覆盖。

holder 记录每段外部输入的分类和偏移，覆盖终端协议回报与编辑键，输入内容不落盘。无法分类的历史记录按编辑输入保护。Loom 依次核对完整写入、可安全清除并一次重发的 Loom 草稿子集，以及重排后仅空白有差异、光标在末尾的完整读回。每次发键重新检查原生轮次和当前画面。首次 Enter 之后至少等待 1.5 秒，连续核对原生轮、可见的完整自有草稿和输入序号。审批、选项、覆盖层或编辑输入都会禁止再按 Enter。允许的一次再次按键记为 `re-enter`。若已看到提交动作而原生轮仍未出现，loomd 在超时后复查原生记录与可写性，在有完整守卫证据时最多用同一 ID 重试一次。

TUI 继续内联粘贴。原有超大回复文件阈值适用。


### 按波搬运

SQLite 中的受管 worker 索引由持久的 spawn 意图补齐。`workers.md` 由 loom 生成。标识是 `(parent, project, wave)`，同波跨根轮补派或封存后再派返回 `wave-sealed`。观察到派工根轮完成、中断或父会话退出时封存。外部派工或确认父会话空闲时，首轮扫描可直接封存。父轮末证据始终缺失时，从最早登记的时间起按封存期限兜底。兜底通知仍等待目标可写。已经收到的旧输入若只缺轮末证据，可以在独立核实空闲后送出兜底通知。新轮的原生接管证据随后允许旧屏障释放。早于封存的 worker 结果先记账，随后按完整成员集合结算。

| 配置，单位毫秒 | 默认值和行为 |
| --- | --- |
| `LOOM_WAVE_SEAL_MS` | 默认使用整波等候上限。从第一个成员登记算起，是无原生封存证据的兜底期限。 |
| `LOOM_WAVE_WINDOW_MS` | 默认 900000。从波次封存或首个续作提交起最多等待此窗口。首个原生封存观察或兜底封存点会落盘。 |
| `LOOM_WAVE_PARTIAL_MS` | 默认 120000，受整批上限约束。多成员波次或续作取得第一个结果后，截止时间收紧至 `min(原截止时间, max(首个结果时间, 封存或首个提交时间) + 部分窗口)`。 |
| `LOOM_BLOCKED_COALESCE_MS` | 默认 60000。从首个确认的 BLOCKED 结果算起，适用于 spawn 波次与一组同会话续作。全员结算或整波截止先到时可直接结算。 |

普通波次一次结算。到期带已到结果和未落定成员，逐项显示 `STUCK` 及最近观测到的活动时间，晚到的确认结果先归档再补投。首个 `BLOCKED` 启动短合并窗口。若全员在窗口内落定，Leader 只收到一次汇总。若窗后仍有未落定成员，Leader 收到一次包含已到 BLOCKED 与同批其他结果的提前通知，波次保持开放。最终结算省略提前发送过的成员正文。所有 Worker 波次结算（含 `FAILED` 和 `MISMATCH`）由 Leader 接收。`UNCONFIRMED` 表示 ACP 轮末有输入归属但缺最终消息边界，附带标明未经确认的文本；该文本仍可从历史查看。新波重派同项目、同 task 后，旧正文继续归档，账本与视图标记 `superseded`，已排队且还没开始发送的旧补投也按该状态结束。

普通 `send` 可按来源返回同根轮结果。同一个来源已经通过 spawn 首轮波次取得该轮结果时不重复单发。Leader 对同项目 Worker 的在途 queue 续作自动形成一组。显式批次用同一个 `--batch UUID --batch-size N`，参见 `loom send --help-advanced`。两种模式均按提交顺序汇总，并应用 BLOCKED 短窗、整批和部分结果截止时间。短窗先投已到结果，结算省略此前已投成员。超时逐项注明 STUCK、最近活动和未提交数量，晚到时按输入 ID 补投一次。重新派发同一任务后，旧 Worker 的迟到结果保留在账本中。 `ls` 和 `state` 显示 `pendingContinuations` 与 `pendingDeliveries`。

### 项目事件和换班

项目事件保存在 `.project/loomd/notifications.json`。使用 `loom notifications --project DIR` 或 `--peek` 预览待处理事件，Super 用 `--take` 标记领取。 `--history` 包含所有事件。预览和历史可以离线读取，领取及写入由 loomd 串行处理。多逻辑项目可通过 `node daemon/notifications.mjs --project DIR --name NAME --take` 过滤领取。

`loom status` 首屏列出全部停滞投递。发送者的下一次正常唤醒会附带仍停滞的消息 ID、目标、原因和年龄。Worker 的结果已经产生但未送达 Leader 时，卡片显示 `result-undelivered`。

停滞按投递 ID 写入一次 `delivery-stalled`。目标为 Leader 时，loomd 将同批异常送给 Auditor。这是静默 Auditor 的基础设施例外。目标为 Auditor 或 Super 时，经项目通知账本和桌面提示通知 Super／用户。Auditor 不可达时也可走桌面提示。每个项目的 Auditor 投递及桌面提示各有五分钟节流，等待中的告警始终可在 `loom notifications` 查看。

Auditor 用 `--needs-decision TEXT --kind decision` 登记普通裁决请求，用 `--audit-escalation REASON` 登记审计升级。`--complete TEXT --phase ID` 按项目和阶段 ID 登记完成。省略 `--phase` 时沿用项目级完成记录。Leader 异常退出、BLOCKED 合并、波次或续作超时和投递不明也会自动登记。Worker 的卡死事件保留在日志中，由在途批次统一唤醒。单个结算批次的多个项目事件合为一个提示。其他同一扫描到达的事件按项目合并。管理内 Super 的唤醒通过稳定 ID 入箱去重。macOS 桌面提示涵盖裁决、项目完成、审计升级、Leader 异常退出和消耗金字塔倒置，每个项目每五分钟至多一条，正文可从通知账本查看。先在账本预留提示，再调用系统；关闭提示可设置 `LOOM_DESKTOP_NOTIFY=0`，测试自动关闭。

Leader 先派独立 Reviewer，收到结论后用 `loom gate pack <gate-id>` 打包结论和证据，再向 Auditor 投递一条指针。命令在缺少结论时发出告警。Auditor 可让临时 Reviewer 深入核查，带结论的回执计入门禁唤醒预算。每次介入只发一条汇总结论，只有可复现的阻断缺陷才能中断。每个交付最多两轮审计。第二轮仍有阻断时用 `--needs-decision TEXT --audit-escalation blocking-disagreement` 请 Super 裁决重设计。重大风险和越权可分别用 `major-risk` 与 `overreach` 升级。

`loom spawn ROLE --handover-from OLD_ADDR` 将前任简报放进首轮提示。新原生会话及首轮输入绑定后，loomd 持久化同项目同角色的继任，再停止旧会话。 `loom handover ROLE --to ADDR` 可将已绑定的同角色更新会话登记为继任，简报进入其现有队列。波次归属仍可按原地址查询，在途波次、续作结果和未尝试的排队请求切到继任地址。旧请求保留投递 ID。已尝试发送或中断的请求留在原生会话对账。前任意外退出时，同项目同角色的更新活动会话可接收其在途队列。

### 命令映射

命令沿用 v1 的 JSON `ok`／`error` 外壳、退出码与历史查询默认值。`addr` 优先精确匹配，其后在调用者项目内按角色或任务查唯一会话，外部调用使用全索引。`docs/PROTOCOL.md:21-31,47-52`

| 命令 | loom 到 OAR 的映射 |
| --- | --- |
| `loom spawn` | Worker 先按父地址与项目检查活跃席位。将 `--cli` 解析为 `Runtime.id`。headless Codex 走 app-server，agy 与 OpenCode 走 ACP，Claude 走 OAR 的 Claude runtime。TUI 绑定本地 hc 窗格，Claude TUI 使用 `claude-tui`。先保存 spawn 意图与首轮 ID，再登记、打开和绑定原生会话，首轮经收件箱投递。 |
| `loom send` | 先登记收件箱，再按上表调用 `prompt`、`steer` 或 `abort` 后 `prompt`。用 `--expect-reply` 请求一次回送。回执给出 `deliveryId`、`deliveryStatus`、`requestedMode` 及当前有效模式。后续变化从 `state` 查询。 |
| `loom hist` | 归并适配器的原生 transcript 投影、OAR 根轮日志及可归属的账本记录。L1 摘要、L2 轮次详情按有证据的根轮查询。`ViewTurn` 可在同一轮内产生多个展示段，按轮归并后再应用 `--turns`。 |
| `loom state` | 读取 `Session.status()`，结合记录中的 `exited`／`released` 和 loom 的投递账本。受管会话 daemon 停止时报告离线或已退出。活跃 headless 返回 OAR 根状态及巡检状态。`src/observe/index.ts:8-15` |
| `loom cost` | 从会话索引和原生历史汇总 [角色用量、Leader 唤醒与 Worker 验收后调用](PILOT-COST.md)。 |
| `loom ls` | 按项目过滤本地索引，包含活动和历史会话、待处理续作和投递。 |
| `loom stop` | 调用 `Session.dispose()`。确认托管会话已经退出或释放才登记 `endedAt`，历史可继续查询。Claude 的自有窗格由 runtime 确认关闭。已关闭时返回原时间。 |

运行面依据 `OAR/docs/runtimes/codex.md:42-47`、`OAR/docs/runtimes/antigravity.md:16-23`、`OAR/docs/runtimes/opencode.md:853-867` 和 `adapters/claude/launch.mjs:4-16`。

## 3. 必须在 loom 边界处理的差异

| 差异 | 理由与处理 |
| --- | --- |
| Claude 的执行面 | 顶层 TUI 沿用原生入口，由 hc 持有 PTY 并核对根 `SessionStart`。headless 经 OAR，启动环境设 `CLAUDE_CODE_ENTRYPOINT=loom`。TUI 忙时由原生界面排入轮次，送达仍依赖原生记录中的唯一投递标记。参见 `daemon/tui.mjs`、`daemon/oar.mjs#openOar`、`inbox/tui.mjs#nativeDelivery`。 |
| 持久接管与投递证据 | OAR 队列的耐久性随 runtime 变化。loom 需要重启后保有待发消息，所以尚未交给 OAR 的输入只持有在 loom inbox。OAR 的 `accepted`、可归属的原生接管和本地命令回执分别记账。存在明确未写入或原生 `input_dropped` 才重试。退出时仅凭未见回显的输入继续对账。`src/contracts/session.ts:137-145`、`src/contracts/records.ts:137-146,286-298`、`OAR/docs/spec/conversation.md:254-266,294-319` |
| 指定轮中断 | `loom send --mode interrupt` 针对指定轮安排中断和续作。OAR 的 `deliver({ when: "interrupt" })` 可以优先 steer，也可能合并 held input。loom 显式调用 `abort`。运行时无法在提交时保护轮次身份时，返回 `unsupported`。`awaitTurnEnd` 也会因退出、释放或丢弃返回，续投前须检查原生根轮结束和可写性证据。`src/contracts/deliver.ts:5-32`、`src/observe/turns.ts:6-19,88-103` |
| 跨进程历史 | `resume` 保留原生对话身份，每次打开的 OAR `seq` 从头开始。loom 按每次打开分配并保存 `streamId`，用 `(streamId, seq)` 持久化记录和恢复消费。loom 保存投递、轮末和生命周期相关的 OAR 投影。尾部半行在重新打开时截去，跨流恢复需要原生记录，已有 v1 历史可只读查询。`src/contracts/graph.ts:20-24`、`src/observe/conversation.ts:63-90`、`OAR/docs/spec/session-graph-and-cursor.md:122-137,165-178` |
| 最终正文与轮末 | v1 `turn-end` 内嵌 `finalReply`，OAR 的 `turn_ended` 提供 outcome。搬运时按原生证据在该根轮内取正文，例如 Codex 的 `final_answer` 条目或 Claude 根 `Stop` 的正文。ACP 缺少可核实的最终消息边界时保留文本供历史查询，波次注明正文未确认。原生 `interrupted` 以 OAR 的 `aborted` 分支呈现，额度与限流用 `failed` 的分类。`docs/PROTOCOL.md:76-83`、`src/contracts/records.ts:147-148,175-176`、`src/contracts/turn-outcome.ts:3-15`、`src/contracts/failure.ts:51-85`、`OAR/docs/runtimes/codex.md:65-71,90-102`、`adapters/claude/hooks.mjs:33-38` |
| 本地可写性 | OAR `AgentStatus` 归约根 agent 工作状态。目录信任、选择器和未知可写性由 TUI runtime 在输入边界诊断，loom 据此保留待投意图。屏幕空闲只参与可写性检查。`src/contracts/status.ts:26-54`、`adapters/claude/screen.mjs:465-477`、`docs/PROTOCOL.md:70-72` |

### `schema/` 处置建议

- 从 `@botiverse/oar` 直接 `import type`，对现有调用者需要的公共名字做显式 `export type`。会话、状态、记录、用量和轮结果引用 `Runtime`、`Session`、`AgentStatus`、`RawEvent`、`SessionUsage`、`TurnOutcome` 等 OAR 类型。历史投影类型可从 `@botiverse/oar/observe` 引用。`src/index.ts:17-25`、`src/observe/index.ts:37-50`
- `schema/` 只定义 loom 自有的 `Role`、`SessionIndex`、`SendMode`、投递与波次记录、命令参数和回执。收口 v1 `Adapter`／`AdapterCapabilities`、`EventRecord`、`SessionState`、`Usage`、`Transcript*` 等重复定义。`runtimeId` 与适配器选择字段 `cli` 都保留。核心索引保留 `transcriptPath`、`account` 和 `baseCommit`，当前 `account` 约束为空。旧历史的兼容读取留在迁移边界。`schema/protocol.ts:3-33,35-102,105-215`

## 4. 保证与非保证

以下保证适用于同一工作目录中的受管会话，同一个 loomd 独占写锁，使用保留且可写的本地项目存储。原生提供方必须继续可观测，其确认以真实日志和运行时事件为准。

| 保证 | 前提和边界 | 确定性验收 |
| --- | --- | --- |
| G1 单写者 | 同一物理目录的 RPC 与后台 poll 共用串行链。死 PID 锁可竞争接管。外部直接改账本、PID 恰好被系统复用、多个目录操作同一原生会话超出保证。没有独立 relay 进程；`daemon status` 可见 `relay: integrated/degraded`。整进程退出后由启动命令或外部进程管理器恢复。 | 并发抢旧锁；交替启动崩溃进程。 |
| G2 接管与幂等 | `accepted` 在账本提交后才返回。同 ID 同请求返回原回执，改请求拒绝。`delivered` 需要强归属证据，`answered` 需要可确认正文。PTY 写入回执、模型相同文本和屏幕字符均不能单独构成送达证据。 | accepted、attempt、native-ack、receipt、completion 前后 SIGKILL；同 ID 重交；Claude 裸文本反例。 |
| G3 共享账本的 FIFO | 普通输入按目标队列顺序出列，目标持续忙时保留，无覆盖。显式控制模式和失去父轮末时的兜底唤醒可以优先。TUI 与 headless 共享逻辑去重和回执，只有到达传输边界时选择 hc 或 OAR。 | 两个发送方并发、忙轮持有、1,000 条逐条比对。 |
| G4 工作结果回送 | 原生结果可绑定根轮时，受管首轮按波、普通回复按根轮与来源地址去重。可达且最终可写的收件人会收到持久结果。已退出的接收方不能被唤醒；正文不明时保留已知状态和可查询证据。 | 单轮早完、崩溃恢复回送、ACP 无边界、TUI/OAR 混合波。 |
| G5 封存与唤醒 | 有确定的封存和结算截止点，Leader 忙时通知留在账本。同一正常结算只生成一条给 Leader 的批次，一次 BLOCKED 提前汇总和晚到补投各持稳定身份。无限忙或已退出的目标只能保留通知；超时本身不杀 worker。 | 根轮末丢失、跨轮补派、部分窗口、永不结束、迟到与重派。 |
| G6 路由和留存 | 首行 BLOCKED 短窗合并，结算交给 Leader。Auditor 唤醒按 [R20 白名单](ORG.md#消息路由r202026-11-25) 校验。证据卡校验、轮次归属和交接留存基于可读原生证据；采集缺口留在证据或历史中。 | BLOCKED、FAILED、MISMATCH 对照，卡片与交接发布点前后 SIGKILL。 |
| G7 指定轮中断 | 要求受管运行时能守住发出时的原生轮槽或 turn ID。仅对应轮取消已证明且同会话可写时续投。退出、release、取消回执和已打入终端的字符都不足以证明续投安全。 | 原轮替换、abort 意图及 ACK 前后 SIGKILL、目标进程退出。 |
| G8 崩溃恢复 | 原子 JSON 快照、SQLite 事务及 JSONL 完整前缀可重放。已经落盘的 relay 批次用派生 ID 重送给 inbox 可去重。存在“原生可能接管、证据尚未持久化”的跨进程缺口，保留意图并升级，禁止盲重投。已提交文件被人为篡改或稳定介质损坏须恢复可信副本。 | SQLite 热回滚与坏头、OAR/watch JSONL 半行、波次入 inbox 前后 SIGKILL、原生丢帧对账。 |
| G9 监控与外部通知 | headless 的静默忙轮和明确 429/配额事件可产生单边沿记录。已有 OAR/PTY 身份能重挂时原位恢复。已接管但未结束的单发续作可向原发起方发卡死通知。通知可一次领取，领取事务落盘后回复方断线可能导致调用方未收到该次批量结果；通知档案保留。 | headless 卡死与限流、外部领取重放、真实 hc 服务重启。 |
| G10 续作批次 | 同项目 Leader 与 Worker 自动分组，也可指定 UUID 和人数。BLOCKED 最多引发一次提前汇总，随后仅结算剩余成员。截止后发送 STUCK 和可归属的迟到补投。 | 反序完成；显式和自动分组的唤醒计数；单发超时和迟到。 |
| G11 项目通知与继任 | 领取只标记，项目通知可追溯。Super 托管投递按批次去重。换班先持久化首轮与继任绑定，再退休前任。 | 有无托管 Super；同批阻塞合并；前任在途波次、续作和投递重启恢复。 |
| G11 TUI 写入守卫 | 可见屏幕及同会话原生信号均要证明空闲。hc 没有原子按帧写入接口，第二次观测与实际发键之间仍存在人工输入竞态。 | 真实草稿回放 4 帧；无结构证据、错误轮末、不完整帧以及恢复后一次发送。 |

### 转移与持久化对账

| 状态或操作 | 持久化顺序与恢复点 |
| --- | --- |
| 单写者和 RPC | `relay/lock.mjs#claimProject` 原子安装含持有者 token 的目录。 `daemon/main.mjs#main` 持锁后建立项目 socket，串行执行 RPC 与 tick。 |
| spawn、绑定、退出 | `daemon/sessions.mjs#newJob` 保存 `loomd/sessions/<addr>.json` 含 `firstId` 和派工根轮，`activate` 调用 `index/index.mjs#register`，再记录原生或 PTY 身份并入 inbox。关停意图先于 native dispose/kill。`finish` 以确认退出更新 SQLite 后补写交接留存。 |
| 空闲、忙碌及队列等待 | `daemon/oar.mjs#oarSnapshot` 和 `inbox/tui.mjs#tui` 提供观测。`inbox/tui.mjs#nativeInputState` 核对同 Root 的启动、工具与轮末事件和屏幕状态。`inbox/engine.mjs#recordWait` 持久化阻塞证据，`ready` 持久化忙轮屏障，`targetTurnEnded` 将过期 steer 改为 queue，拒绝过期 interrupt。 |
| 输入尝试与原生接管 | `inbox/engine.mjs#send` 先保存 `sending`，再调用原生控制，随后记尝试和控制回执。可明确证明未接管的临时拒绝回原等待相位。原生 drop 转 refused。 `reconcile` 保存原生接管，再原子保存最终正文及从属自动回复。 |
| 中断等待与续投 | `inbox/engine.mjs#stop` 依次落盘 `stopping`、调用 abort、保存 ACK；`confirmStop` 凭目标轮确切取消转 `stopped`，再按普通发送步骤续投。Codex 还能从绑定的原生 transcript 核对同一 turn ID 的结束。 |
| 原生记录 | `daemon/oar.mjs#trackOar` 先登记新流，再以 streamId、seq 和同序号内序次追加被观察的根事件。会话宿主独占追加，并在新流打开前用 `daemon/io.mjs#prepareJournal` 修复未完成尾行。 `daemon/recovery.mjs#recoverNativeDelivery` 在流切换或可能丢帧时核对已绑定原生记录。 |
| 结果与证据 | `evidence/index.mjs#forTurn` 先发布按轮唯一的 JSON 和文本卡。 `relay/project.mjs#step` 同一快照保存结果及消费标记，再生成归档、更新生成视图和发布标记。`.project/replies/.turns/` 存完整结果。 |
| 结算、入箱与去重 | `relay/project.mjs#step` 同时提交封存/关闭、BLOCKED 窗口和已纳入成员及 outbox。续作的提前汇总保存参与的输入 ID，最终汇总据此去重。 `daemon/supervisor.mjs#batchDeliveryId` 按批次与收件地址生成稳定 inbox ID。收件箱接管后才更新 outbox 并清除已完成条目。 |
| 巡检、告警与领取 | `watch/index.mjs#record` 追加卡死、恢复及限流观察，`daemon/supervisor.mjs#publishNotifications` 以原 incident ID 或投递 ID 重放到 `loomd/notifications.json`，`daemon/notifications.mjs#projectNotifications` 提交领取时间再答复。 |
| 交接档案 | `handover/retention.mjs#recordLifecycle` 核实 transcript 稳定后，可按内容哈希留副本，并发布稳定事件 ID 的 manifest。会话结束与交接状态可跨 loomd 重启补写。 |

可复跑的故障注入、判定结果和实测引用见 [PROTO-HARDEN-0](../tasks/PROTO-HARDEN-0/RESULT.md)。

## 5. 在线升级与回滚

```sh
loom upgrade --project /abs/project --to /abs/releases/loom-next --check --json
loom upgrade --project /abs/project --to /abs/releases/loom-next --json
loom upgrade --project /abs/project --status --json
loom upgrade --project /abs/project --rollback --json
```

准备独立的绝对发布路径，包含 Loom 源码、锁文件和按根 `package.json` 安装的依赖。存活宿主和包装器固定到启动时的发布。保留旧发布和依赖，直到对应会话全部结束且回滚窗口关闭。升级校验两版的源码摘要、Node 及平台、已安装依赖、SQLite `user_version` 和会话控制协议，预检返回阻塞会话。首次从直接持有 OAR 的旧 loomd 部署时，先让旧版的活跃无头会话结束，再启动支持会话宿主的 loomd。

loomd 先保存交接记录，再由独立的升级进程启动新 loomd。旧 loomd 结算已受理的控制 RPC 并交出项目写锁，原生轮次继续执行。新 loomd 取锁，逐个核对宿主和包装器的 PID、incarnation、原生会话及事件流，然后原子提交 `.project/loomd/release.json`。在控制 socket 切换期间，客户端可用同一投递 ID 重试。就绪失败时尝试用上一版接管同一份项目存储。`--status` 报告当前发布、升级阶段和各会话绑定。显式回滚使用相同的交接路径。

无头宿主持有 OAR Session、provider 子进程及事件日志，脱离 loomd 进程组。启动意图和独占 owner 记录位于 `.project/loomd/hosts/`。控制 socket 位于仅当前用户可访问的短路径目录。`hello` 协商协议和方法。宿主校验会话 incarnation，以及在项目写锁下分配的 loomd 世代与控制者 ID。现有两代客户端和宿主使用共同方法并存，较早的无 `hello` 包装器使用 v0 适配。控制端拒绝未知方法、版本或 incarnation。显式 `loom stop` 关闭单个会话。

宿主在原生提交前追加请求 ID、内容摘要、动作和目标轮，收到结果后追加处置状态。接管者先领取新世代，再以同一流的完整日志前缀和宿主回执对账。只有同一 incarnation 的宿主能证明旧请求从未到达或已明确拒绝时，才可重试。已受理输入、inbox 完成和 relay outbox 使用原有 ID 去重。宿主自身退出时，恢复流程尝试以原生 ID 打开新流。可能已接管且缺少原生证明的输入保持 `uncertain`。

SQLite 迁移先扩展，再切换，最后收缩。新增列应可空或提供旧 writer 可用的默认值，独立数据可存旁表。旧 writer 用显式列清单读写并保留未知列原值。迁移事务使用项目单写者锁，兼容窗口内两版均须验证 `PRAGMA user_version`。用旧读者可略过的字段或记录类型扩展 JSONL。回滚纳入升级期间写入的事件、收据、索引和队列。旧发布退役后再删除或重写既有结构。详见 [HOTSWAP-1 验收](../tasks/HOTSWAP-1/RESULT.md)。

STATUS: done
