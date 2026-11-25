# 协议 v0 字段来源映射

本文中的路径都相对于固定只读研究目录
`/Users/sun/.loom-next/runs/loom-next/arch-research-2026-11-23/AR-1/agy/scratch/repos/`，Codex 源码相对于
`AR-2b/codex/scratch/codex-src/`。标记含义如下。

- 【已验证】固定 commit 源码、固定 fixture 或本机只读探针已经直接看到该能力。
- 【源码推断】源码给出相邻机制，协议字段是对它的保守归一化，仍需 adapter conformance test。
- 【未知】参考材料没有足够证据。正文不把它当共同能力。附录 A 给出验证方法。

## 1. 参考版本

| 来源 | 固定版本或探针 |
|---|---|
| OAR | `oar` commit `c5c763b38b54345db89ec469025d6188acbfb09d` |
| Codex | `codex` commit `a1604a8c0554c09c1be45e5a121bb1889b4d9a50` |
| OpenCode | `opencode` commit `1906056539cc6545cb51468113be30092243a79a` |
| Orca | 研究目录中的固定 checkout。`src/main/agent-hooks/README.md` 标注了实测 CLI 版本 |
| T3 Code | 研究目录中的固定 checkout。Orchestration V2 源码和 fixtures |
| Herdr | 研究目录中的固定 checkout。远程 terminal 文档和 `headless.rs` |
| 只读探针 | `codex app-server generate-json-schema --out <loom_new scratch>`、`codex --help`、`claude --help`、`agy --help`、`opencode --help` |

## 2. 命令来源

| 协议命令 | Claude | Codex | agy | OpenCode | ACP 类 | OAR 对应概念 |
|---|---|---|---|---|---|---|
| `deliver` | Claude hook 的 `UserPromptSubmit` 和 transcript prompt。`orca/src/main/claude/hooks/claude-managed-hook-events.ts:19-25` 【已验证】 | `turn/start`。`codex-rs/app-server-protocol/src/protocol/common.rs:1141-1146` 【已验证】 | ACP `session/prompt`，`oar/packages/oar/src/shared/acp/prompt.ts:19-49` 【已验证】 | ACP prompt，OpenCode v1/v2 走 profile。`oar/packages/oar/src/runtimes/opencode/index.ts:12-15,53-68` 【已验证】 | ACP `initialize` 后的 prompt。`oar/packages/oar/src/shared/acp/initialize.ts:17-35`、`prompt.ts:26-48` 【已验证】 | `Session.prompt`、`inputId`、`DeliverResult`。`oar/packages/oar/src/contracts/session.ts:191-194`、`oar/packages/oar/src/contracts/deliver.ts:35-45` 【已验证】 |
| `steer` | stdin mid-turn 是已记录能力。`oar/docs/spec/runtime-matrix.md:144-154` 【已验证】 | `turn/steer`。`codex-rs/app-server-protocol/src/protocol/common.rs:1154-1158` 【已验证】 | ACP profile 的 steer request。`oar/packages/oar/src/shared/acp/steer-request.ts:11-70` 【已验证】 | `_session/steering` 只在 initialize 宣布后可用。`oar/packages/oar/src/runtimes/opencode/steering.ts:5-22` 【已验证】 | `steerRequestAdvertised` 和 `no_active_turn`。`oar/packages/oar/src/shared/acp/steer-request.ts:11-24` 【已验证】 | 可选 `Session.steer`，缺失成员表示不支持。`oar/packages/oar/src/contracts/session.ts:191-194`、`runtime-matrix.md:135-168` 【已验证】 |
| `abort` | hook 或 TUI 中断属于 provider 行为，稳定的跨适配器事实由 OAR control 记录承载。`oar/packages/oar/src/contracts/session.ts:197-198` 【源码推断】 | `turn/interrupt`。`codex-rs/app-server-protocol/src/protocol/common.rs:1160-1163` 【已验证】 | ACP cancel/close 由 process 层处理。`oar/packages/oar/src/shared/acp/session.ts:257-270` 【已验证】 | 同 ACP process 层。`oar/packages/oar/src/shared/acp/session.ts:257-270` 【已验证】 | ACP process exit 和 cancel 观察。`oar/packages/oar/src/shared/acp/session.ts:158-172` 【已验证】 | `abort()` 的 accepted 只是中断已交给 runtime，结果由 `turn_ended` 或 `exited` 证明。`oar/packages/oar/src/contracts/session.ts:197-198`、`records.ts:286-298` 【已验证】 |
| `status` | OSC 7501 报告 `idle/working/done/blocked/error`。`orca/src/shared/program-status/protocol.ts:1-15` 【已验证】 | app-server 的 `turn/started`、`turn/completed` 和 item 通知。`codex-rs/app-server-protocol/src/protocol/common.rs:2115-2145` 【已验证】 | OAR Antigravity capability declaration。`oar/packages/oar/src/runtimes/antigravity/index.ts:11-17` 【已验证】 | OAR OpenCode capability declaration。`oar/packages/oar/src/runtimes/opencode/index.ts:12-15` 【已验证】 | ACP updates 作为结构化事实。`oar/packages/oar/src/shared/acp/projection.ts:14-18,227-260` 【已验证】 | `Session.status()` 是 retained record 的 fold。`oar/packages/oar/src/contracts/status.ts:3-7,26-54` 【已验证】 |
| `evidence` | Claude transcript tail 和 hook event。`orca/src/main/claude/transcripts/claude-transcript-catch-up.ts:33-47,120-164`、`claude-managed-hook-events.ts:13-99` 【已验证】 | command output delta、item completed、file changes、turn completed。`codex-rs/app-server-protocol/src/protocol/common.rs:2115-2145`、`oar/docs/spec/runtime-matrix.md:470-486` 【已验证】 | ACP rawOutput/content，字段缺失时保留 absent。`oar/packages/oar/src/shared/acp/projection.ts:128-181` 【已验证】 | 同 ACP，且 OpenCode v2 的 turn boundary 有已知缺口。`oar/docs/spec/runtime-matrix.md:456-463` 【已验证】 | unknown update 仍记录 native frame。`oar/packages/oar/src/shared/acp/projection.ts:14-18` 【已验证】 | OAR `tool_call_started/ended`、`exitCode`、`fileChanges`、`usage` 和 `compaction`。`oar/packages/oar/src/contracts/records.ts:147-188`、`tool-output.ts:1-21` 【已验证】 |
| `human_lease.acquire/release` | Herdr 可写 attach 独占输入和 resize。`herdr/docs/preview/website/src/content/docs/persistence-remote.mdx:131-164` 【已验证】 | TUI attach 不是 app-server approval API。`AR-2b/codex/RESULT.md` §2-3 【已验证】 | 同 Cell terminal lease。`herdr/docs/preview/website/src/content/docs/persistence-remote.mdx:135-164` 【源码推断】 | 同上 | ACP 本身没有统一 human lease。`oar/docs/spec/runtime-matrix.md:170-178` 【未知】 | lease 由 host/application layer 所有，不属于 OAR Session ownership。`oar/packages/oar/src/contracts/session.ts:94-109` 【已验证】 |

## 3. 状态转换来源

| 转换 | Claude | Codex | agy | OpenCode | ACP 类 | OAR / 其他依据 |
|---|---|---|---|---|---|---|
| `idle → working` | hook `UserPromptSubmit`、`SubagentStart`、`PreToolUse` 等，且 hook 优先 OSC。`claude-managed-hook-events.ts:19-55`、`orca/src/main/agent-hooks/README.md:3-27` 【已验证】 | `turn/started`。`codex-rs/app-server-protocol/src/protocol/common.rs:2115-2119` 【已验证】 | ACP active turn 只在 profile 能证明时采用。`oar/docs/spec/runtime-matrix.md:431-466` 【已验证】 | v2 ACP 缺少 verified start/end 时保持 activity。`runtime-matrix.md:456-463` 【已验证】 | `session/update` 投影只把识别的 update 变成事件。`oar/packages/oar/src/shared/acp/projection.ts:227-254` 【已验证】 | `turn_active` 或 native content 才进入 running，control acceptance 不够。`oar/packages/oar/src/observe/agent-status.ts:169-193`、`oar/docs/spec/runtime-matrix.md:448-466` 【已验证】 |
| `working → idle` | Claude `Stop`、`PostCompact` 和 transcript turn boundary。`claude-managed-hook-events.ts:24-30,61-66`、`claude-transcript-catch-up.ts:120-164` 【已验证】 | `TurnCompleted`，且最终正文从最后的 AgentMessage 提取。`codex-rs/exec/src/event_processor_with_jsonl_output.rs:517-541` 【已验证】 | ACP prompt answer 是 turn end，缺失时不得合成。`oar/packages/oar/src/shared/acp/session.ts:44-49` 【已验证】 | OpenCode v2 已知无完整 mapped boundary。`runtime-matrix.md:456-463` 【已验证】 | ACP prompt answer 或 observed exit。`oar/packages/oar/src/shared/acp/session.ts:44-49,158-172` 【已验证】 | `turn_ended` 的 native outcome 才结束 turn。`oar/packages/oar/src/contracts/records.ts:174-185`、`observe/agent-status.ts:234-242` 【已验证】 |
| `working → needs_human` | OSC blocked `kind=auth`，或 hook/JSONL 明确错误。`orca/src/shared/program-status/protocol.ts:11-19,66-79`、`orca/src/main/claude/hooks/claude-managed-hook-events.ts:54-59` 【已验证】 | server request 可表示权限、工具输入和 MCP elicitation，但 v0 只记录事实，不做 approval。`codex-rs/app-server-protocol/src/protocol/common.rs:1935-1973` 【已验证】 | ACP initialize/authenticate 可以暴露 auth 失败。`oar/packages/oar/src/shared/acp/initialize.ts:34-51` 【已验证】 | ACP initialize/authenticate 同上。`initialize.ts:17-51` 【已验证】 | ACP `RequestError`、auth request 和 process failure。`oar/packages/oar/src/shared/acp/steer-request.ts:65-70`、`session.ts:76-84` 【已验证】 | OAR `FailureClass.auth`、runtime-to-app request 和 `control_rejected`。`oar/packages/oar/src/contracts/failure.ts:5-40`、`records.ts:216-223` 【已验证】 |
| `working → error` | `StopFailure`、`PostToolUseFailure` 和 transcript error。`claude-managed-hook-events.ts:27-30,53-55` 【已验证】 | `turn/failed`、`error`。`codex-rs/exec/src/exec_events.rs:21-37,49-57,90-94` 【已验证】 | ACP `failed` tool update 或 process error。`oar/packages/oar/src/shared/acp/projection.ts:128-161`、`session.ts:76-84` 【已验证】 | 同 ACP | ACP status `failed` 和 `AcpError`。`projection.ts:128-161`、`session.ts:76-84` 【已验证】 | `FailureClass` 和 `turn_ended.failed`。`oar/packages/oar/src/contracts/failure.ts:26-40`、`turn-outcome.ts:3-15` 【已验证】 |
| `* → exited` | SessionEnd hook 可知 provider session end，但 process exit 仍需 Cell 观察。`claude-managed-hook-events.ts:69-74` 【已验证】 | transport EOF 和 connection closed 有明确信号。`codex-rs/app-server-transport/src/transport/stdio.rs:99-181`、`websocket.rs:267-281` 【已验证】 | ACP runtime exited 由 process observer 写入。`oar/packages/oar/src/shared/acp/session.ts:158-172` 【已验证】 | 同 ACP | ACP `process_exited` 只在 observed exit 时生成。`session.ts:158-172` 【已验证】 | OAR `processExited()` 追加 `exited` response，`unreachable()` 从 stream 读。`oar/packages/oar/src/shared/session-kernel.ts:84-99,185-195,240-243` 【已验证】 |
| `needs_human → working/idle` | Claude 下一次 hook/transcript native start，不能靠 UI 文本。`claude-managed-hook-events.ts:19-25`、`HC_MODEL.md:51-69` 【已验证】 | 新的 `turn/started` 或 resumed thread。`codex-rs/app-server-protocol/src/protocol/v2/thread.rs:361-400`、`common.rs:2115-2119` 【已验证】 | initialize/authenticate 成功后新的 prompt answer。`initialize.ts:17-51`、`prompt.ts:26-48` 【已验证】 | 同 ACP | ACP capabilities 只在 handshake 证明后使用。`initialize.ts:17-35` 【已验证】 | OAR status fold 只在后续记录到达时变化。`observe/agent-status.ts:46-54` 【已验证】 |
| `error → idle/working` | transcript 或 hook recovery fact，未验证所有版本。`claude-transcript-catch-up.ts:90-164` 【源码推断】 | `thread/resume` 和新的 turn。`AR-2b/codex/RESULT.md` §2、`thread.rs:361-400` 【已验证】 | ACP open/resume contract。`oar/packages/oar/src/shared/acp/session.ts:51-89` 【已验证】 | 同 ACP | open/resume 后仍以 native event 为准。`session.ts:73-86` 【已验证】 | T3 restart continuation 只在 persisted live turn、native id 和 provider session 都满足时继续。`t3code/apps/server/src/orchestration-v2/RestartContinuation.ts:165-235` 【已验证】 |
| 断线时不改变 session 状态 | PTY / hook channel 断开只能改变观察可用性。`orca/src/main/agent-hooks/README.md:11-27` 【已验证】 | 每个 websocket 有独立 connection id，断开只清理该连接订阅。`thread_state.rs:602-608,822-842` 【已验证】 | ACP process exit 与 transport disconnect 分开。`acp/session.ts:158-172` 【已验证】 | 同 ACP | 同 ACP | OAR cursor reconnect replay。`oar/packages/oar/src/shared/session-kernel.ts:244-265` 【已验证】 |

## 4. Event envelope 和证据字段来源

| 协议字段或事件 | Claude | Codex | agy | OpenCode | ACP 类 | OAR 对应概念 |
|---|---|---|---|---|---|---|
| `protocol` / handshake version | Claude hook version gate。`claude-managed-hook-events.ts:116-134` 【已验证】 | app-server schema export 和 `protocol` types。`codex-rs/cli/src/main.rs:645-663`、`app-server-protocol/src/protocol/common.rs:1935-1973` 【已验证】 | ACP `protocolVersion` 和 `clientInfo`。`oar/packages/oar/src/shared/acp/initialize.ts:17-30` 【已验证】 | 同 ACP | ACP protocol negotiation。`initialize.ts:17-35` 【已验证】 | OAR runtime declarations 和 schema contract。`oar/packages/oar/src/contracts/runtime.ts:22-46` 【已验证】 |
| `commandId` / request identity | hook request event identity由 adapter 保留。`claude-managed-hook-events.ts:13-99` 【源码推断】 | JSON-RPC request id 和 app-server request/response。`common.rs:1927-1933,1935-1973` 【已验证】 | ACP request id 由 SDK/process 保留。`steer-request.ts:50-70` 【已验证】 | 同 ACP | JSON-RPC request identity。`initialize.ts:17-35` 【已验证】 | OAR request `id`、response `requestId`。`records.ts:52-65,236-298` 【已验证】 |
| `cellId` / `sessionId` | Claude transcript/provider session id。`claude-transcript-catch-up.ts:36-46,80-88` 【已验证】 | `thread_id` 可用于 resume。`exec_events.rs:39-43`、`thread.rs:366-400` 【已验证】 | ACP opened session id。`acp/session.ts:109-113,247-254` 【已验证】 | 同 ACP | ACP `sessionId` routing。`acp/session.ts:44-49` 【已验证】 | `RecordEnvelope.sessionId`。`records.ts:28-43` 【已验证】 |
| `seq` | hook/transcript 本身有 cursor，但跨 adapter seq 由 Cell 生成。`claude-transcript-catch-up.ts:58-88` 【源码推断】 | app-server notification order，Cell 统一编号。`thread_state.rs:586-605` 【源码推断】 | ACP updates 按 frame 顺序记录。`projection.ts:14-18` 【已验证】 | 同 ACP | frame 顺序是 native evidence。`projection.ts:14-18` 【已验证】 | SessionKernel dense monotonic seq。`shared/session-kernel.ts:144-181` 【已验证】 |
| `cursor` / `afterSeq` | transcript tail 以 leaf UUID catch-up。`claude-transcript-catch-up.ts:33-47,103-164` 【已验证】 | thread resume 和独立 connection subscription。`thread.rs:361-400`、`thread_state.rs:602-608` 【已验证】 | ACP adapter cursor 由 Cell 保存。`acp/session.ts:109-126` 【源码推断】 | 同 ACP | ACP frames 按 native session 路由。`acp/session.ts:44-49` 【已验证】 | `Cursor { sessionId, afterSeq }` 和 replay afterSeq。`oar/packages/oar/src/contracts/graph.ts:20-24`、`shared/session-kernel.ts:244-265` 【已验证】 |
| `receivedAt` | hook server 接收时间。`orca/src/main/agent-hooks/README.md:3-9` 【源码推断】 | notification observation time。`thread_lifecycle.rs:570-605` 【源码推断】 | ACP `startedAt`/observer path。`acp/initialize.ts:8-14` 【已验证】 | 同 ACP | ACP process deadline uses observation. `acp/process.ts` is used by `initialize.ts:18-33` 【已验证】 | `RecordEnvelope.receivedAt` is Date.now at adapter ingress. `records.ts:28-43` 【已验证】 |
| `source` priority | hooks win over OSC, OSC fills gaps. `orca/src/main/agent-hooks/README.md:3-27` 【已验证】 | app-server structured notifications. `common.rs:2115-2145` 【已验证】 | ACP structured update. `acp/projection.ts:14-18` 【已验证】 | 同 ACP | ACP unknown updates remain native. `projection.ts:14-18` 【已验证】 | `Frame.native` is source of truth and `events` is projection. `records.ts:70-88` 【已验证】 |
| `turn_started` / `turnId` / `inputId` | `UserPromptSubmit` and transcript row identity. `claude-managed-hook-events.ts:19-25`、`claude-transcript-catch-up.ts:120-164` 【已验证】 | `turn/started` and turn id. `common.rs:2115-2119`、`v2/turn.rs:600-640` 【已验证】 | ACP active turn only where mapped. `runtime-matrix.md:431-466` 【已验证】 | v2 gap is explicit. `runtime-matrix.md:456-463` 【已验证】 | ACP prompt answer/update. `acp/session.ts:44-49` 【已验证】 | `turn_active`, `turn_started`, `inputId` semantics. `records.ts:137-148,210-217` 【已验证】 |
| `text_delta` / `finalReply` | transcript assistant rows and Stop. `claude-transcript-catch-up.ts:120-164` 【已验证】 | `item/agentMessage/delta` and final AgentMessage extraction. `common.rs:2115-2132`、`event_processor_with_jsonl_output.rs:389-405,517-541` 【已验证】 | ACP `agent_message_chunk`. `acp/projection.ts:238-243` 【已验证】 | ACP same | ACP projection maps message chunks. `acp/projection.ts:227-254` 【已验证】 | `text_delta` and `turn_ended` with outcome. `records.ts:147-176` 【已验证】 |
| `reasoning` / `redacted` | Claude transcript may carry thinking, but exact content can be absent. `HC_MODEL.md:153-155` 【已验证】 | reasoning item and raw event. `common.rs:2122-2132` 【已验证】 | ACP thought chunk maps redacted/text/empty. `acp/projection.ts:215-224,245-246` 【已验证】 | same | ACP projection. `projection.ts:215-224` 【已验证】 | `ReasoningContent` supports text, redacted and empty. `records.ts:90-93,149-150` 【已验证】 |
| `tool_call_started` / `callId` / `tool` / `input` | Claude `PreToolUse` and hook tool event. `claude-managed-hook-events.ts:46-55`、`orca/src/main/agent-hooks/README.md:93-110` 【已验证】 | item started and command execution item. `common.rs:2122-2145` 【已验证】 | ACP `tool_call` projection. `acp/projection.ts:99-126` 【已验证】 | same | ACP tool lifecycle. `projection.ts:99-126` 【已验证】 | `tool_call_started` fields. `records.ts:151-161` 【已验证】 |
| `tool_call_ended` / `result` / `exitCode` | Claude tool result has content and error but no verified command exit code. `runtime-matrix.md:473-476` 【已验证】 | command execution status, exit code and aggregated output. `runtime-matrix.md:473-486`、`common.rs:2135-2145` 【已验证】 | vendor rawOutput exit code only when present. `acp/projection.ts:138-181` 【已验证】 | same | ACP itself defines no exit code. `acp/projection.ts:166-181` 【已验证】 | `tool_call_ended.result` and `exitCode` are optional and native-only. `records.ts:162-173` 【已验证】 |
| `outputTail` / `outputDelta` | Claude transcript/tool output source is available, bounded tail is adapter policy. `HC_MODEL.md:149-155,170` 【源码推断】 | `item/commandExecution/outputDelta` and aggregated output. `common.rs:2135-2145`、`runtime-matrix.md:473-486` 【已验证】 | ACP rawOutput/content, truncated projection. `acp/projection.ts:56-78,140-147` 【已验证】 | same | ACP projection explicitly truncates readable output. `projection.ts:56-78` 【已验证】 | `ToolCallProgress.output/outputDelta` and tool content. `tool-output.ts:14-21`、`records.ts:164-170` 【已验证】 |
| `fileChanges` | Claude file changes are not verified in the chosen stream. `runtime-matrix.md:473-476` 【未知】 | completed `fileChange` item carries `changes[].path`, kind and move path. `runtime-matrix.md:484-486` 【已验证】 | absent in capability declaration. `antigravity/index.ts:14` 【已验证】 | absent in runtime matrix. `runtime-matrix.md:192` 【已验证】 | ACP generic has no standard fileChanges. `runtime-matrix.md:180-196` 【已验证】 | `FileChange` path/kind/moveTo. `oar/packages/oar/src/contracts/tool-output.ts:1-6`、`records.ts:171-172` 【已验证】 |
| `task_started/updated/ended` | Claude background task hooks and transcript. `claude-managed-hook-events.ts:32-40`、`tasks.ts:13-60` 【已验证】 | Codex subAgentActivity and item lifecycle. `runtime-matrix.md:312-329` 【已验证】 | Antigravity declares empty task event types. `antigravity/index.ts:14` 【已验证】 | OpenCode task lifecycle version-specific. `runtime-matrix.md:321-329` 【已验证】 | ACP update may be vendor-specific. `acp/projection.ts:227-254` 【源码推断】 | OAR `TaskEventBody` exact states and fields. `contracts/tasks.ts:8-60` 【已验证】 |
| `compaction_started/ended` / count | Claude `PostCompact` and `PreCompact` hook events. `claude-managed-hook-events.ts:61-66` 【已验证】 | `thread/compact/start` and context compaction item. `common.rs:781-785`、`v2/item.rs:517-520` 【已验证】 | manual compaction explicitly unsupported. `antigravity/index.ts:14-17` 【已验证】 | version-specific, not common. `runtime-matrix.md:303-310` 【已验证】 | only when profile exposes it. `acp/session.ts:128-152` 【已验证】 | `compaction_started/ended` native events. `records.ts:177-185` 【已验证】 |
| `usage` / token fields | Claude transcript usage may be available, exact version coverage differs. `HC_MODEL.md:153-155,170-171` 【已验证】 | `turn/completed.usage` and token usage notification. `exec_events.rs:49-73`、`common.rs:2115-2116` 【已验证】 | ACP `usage_update` used/context fields. `acp/projection.ts:184-212,227-237` 【已验证】 | same | ACP usage projection. `projection.ts:184-212` 【已验证】 | `UsageReport` and `TokenTotals`. `records.ts:95-123,188` 【已验证】 |
| `sandbox_refused` | PermissionRequest and PostToolUseFailure are observable, but no common structured sandbox refusal. `claude-managed-hook-events.ts:46-59` 【已验证】 | server approval request methods are explicit. `common.rs:1935-1973` 【已验证】 | no verified common field. `runtime-matrix.md:180-196` 【未知】 | no verified common field. `runtime-matrix.md:180-196` 【未知】 | ACP has no common approval schema. `acp/initialize.ts:22-30` 【未知】 | `app_request`、`control_rejected` and typed refusal preserve native request without claiming approval. `records.ts:216-223,252-298` 【已验证】 |
| `error` / `failureClass` | `StopFailure` and hook error events. `claude-managed-hook-events.ts:27-30,53-55` 【已验证】 | `turn.failed` and `error` with message. `exec_events.rs:21-37,54-57,90-94` 【已验证】 | ACP `AcpError` and process diagnostics. `acp/session.ts:76-84` 【已验证】 | same | ACP request error mapping. `steer-request.ts:65-70` 【已验证】 | `FailureClass` maps auth, quota, provider, runtime_exited and unknown. `contracts/failure.ts:5-40` 【已验证】 |
| `process_exited` / `code` / `reason` | Claude SessionEnd is hook lifecycle, process exit is Cell observation. `claude-managed-hook-events.ts:69-74` 【源码推断】 | stdio EOF and websocket close are transport facts. `app-server-transport/src/transport/stdio.rs:99-181`、`websocket.rs:267-281` 【已验证】 | ACP process exit observer. `acp/session.ts:158-172` 【已验证】 | same | ACP `process_exited` is only observed exit. `acp/session.ts:158-172` 【已验证】 | `exited` response has code and reason. `records.ts:222-223,297-298`、`shared/session-kernel.ts:240-242` 【已验证】 |
| `lease_*` | Herdr one writable controller, takeover and release. `persistence-remote.mdx:135-164` 【已验证】 | TUI remote attach has multiple clients but input owner is terminal controller. `AR-2b/codex/RESULT.md` §2 【已验证】 | same terminal lease policy | same | no ACP-native lease. 【未知】 | OAR ownership is application layer, not in-process lease. `contracts/session.ts:94-109` 【已验证】 |
| `native_frame` / unknown update | Claude raw transcript row retained by import plan. `claude-transcript-catch-up.ts:120-164` 【已验证】 | app-server raw/private events and raw response. `common.rs:2128-2131` 【已验证】 | unknown ACP update retained even with no projected event. `acp/projection.ts:14-18` 【已验证】 | same | ACP unknown update rule. `projection.ts:14-18` 【已验证】 | Frame stores `type`, `native`, `events` and optional `elided`. `records.ts:70-88` 【已验证】 |
| `stream_gap` / replay | transcript catch-up warns when leaf is absent. `claude-transcript-catch-up.ts:103-119` 【已验证】 | thread resume and connection subscription. `thread.rs:361-400`、`thread_state.rs:602-608` 【已验证】 | adapter log retention policy not verified. 【未知】 | same | ACP process reconnect not a durable replay contract. 【未知】 | cursor replay is explicit and retained records are replayed after `afterSeq`. `shared/session-kernel.ts:244-265`、`contracts/graph.ts:20-24` 【已验证】 |

## 5. 投递语义和恢复来源

| 协议选择 | 来源 | 结论 |
|---|---|---|
| at-least-once，不宣称 exactly-once | 旧 loom-next 经验明确指出 `send` 成功、`started=true`、working 或 turn 增加都不能证明输入记入，且外部进程与 SQLite 无分布式事务。`loom-next/docs/HC_MODEL.md:5,107-133` 【已验证】 | Cell 用 commandId、deliveryId、持久 receipt 降低重复，但不做 exactly-once 承诺 |
| receipt 和 insert-if-absent | T3 `CommandReceiptV2` 有 `commandId`、`acceptedAt`、`resultSequence`、`status`，store 提供 `insertIfAbsent`。`t3code/apps/server/src/orchestration-v2/CommandReceiptStore.ts:40-81` 【已验证】 | 相同 commandId 返回原 receipt |
| accepted input 的重投 | OAR Harbor 记录 accepted input，input dropped 或 session gone 时 requeue，daemon restart 时先投递未消费项。`oar/apps/harbor/README.md:81-87`、`apps/harbor/deliveries.ts:148-168` 【已验证】 | `redeliverable` 只由明确未消费事实触发 |
| restart continuation | T3 要求 native id、provider thread、active turn 和 session 状态都匹配才继续。`RestartContinuation.ts:165-235` 【已验证】 | 不把重启当作新任务，不凭空合成 turn end |
| cursor replay | OAR kernel 在 cursor 后重放 retained records，并检查 sessionId。`shared/session-kernel.ts:244-265` 【已验证】 | hub 重连按 cursor 补齐 |
| native stream resume | OAR conversation 对 runtime resume 使用新 streamId，并在每个 stream 内独立 cursor。`observe/conversation.ts:63-90` 【已验证】 | `streamId` 进入协议事件身份 |
| final reply 搬运 | T3 `delegate_task` 的子任务普通输出由 server 读取 `task.result`，≤16KB 内联，超出时通知父线程再调 `task_status`。`t3code/apps/server/src/mcp/toolkits/orchestrator/tools.ts:89-116`、`Orchestrator.ts:961-985` 【已验证】 | v0 默认只搬运 Cell 提取的最终回复和证据摘要 |
| 禁止 agent 自发通讯替代最终回复 | Harbor 要求 agent 只能运行 `harbor send`，Raft 要求所有输出通过 `raft` CLI。`oar/apps/harbor/README.md:64-78`、`raft-source/packages/daemon/src/drivers/systemPrompt.ts:141-149` 【已验证】 | loom_new 选择 daemon 中继最终回复，不要求 agent 调通讯工具 |
| human lease | Herdr 文档和实现只允许一个 writable controller，`--takeover` 替换旧 owner，observer 不抢输入。`herdr/docs/preview/website/src/content/docs/persistence-remote.mdx:135-164`、`herdr/src/server/headless.rs:1737-1805` 【已验证】 | lease 是输入所有权，不是审批，不改变 process 状态 |

## 附录 A：未纳入 / 未知能力

以下能力没有写入 v0 的共同正文，或只作为可选字段存在。

| 能力 | 为什么不纳入共同能力 | 验证方法 |
|---|---|---|
| Claude TUI 的原生命令 exit code | 研究矩阵说明 Claude `tool_use_result` 没有 command exit status。`runtime-matrix.md:473-476` 【已验证】 | 在 Loom 自有隔离 Claude session 中比较 Bash 失败的 transcript、hook 和 PTY 记录 |
| Claude 的统一 fileChanges | 参考流没有跨版本的结构化 file change 字段。`runtime-matrix.md:473-476` 【未知】 | 运行添加、修改、删除、移动四类命令，核对 hook、transcript 和 native tool result |
| OpenCode v2 的完整 turn start/end | ACP 在已测版本没有稳定映射。`runtime-matrix.md:456-463` 【已验证】 | 用 OpenCode v2 `serve` 或 ACP 连接运行空 prompt、工具调用、后台子任务和中断，保存 wire.jsonl |
| agy 的 structured compaction completion | Antigravity 明确把 manual compaction 声明为 unsupported。`antigravity/index.ts:14-17` 【已验证】 | 版本化运行 `/compact`，只读记录 ACP update 和 transcript，不调用付费模型以外的额外能力 |
| ACP 通用 sandbox refusal | ACP initialize 和 session/update 没有统一审批/沙箱 schema。`initialize.ts:22-30`、`projection.ts:227-254` 【未知】 | 对每个 ACP runtime 用只读命令和受控拒绝 fixture 检查 request/error update |
| provider queue 在所有 adapter 上 durable | OAR runtime matrix 明确不同 runtime 的 durable queue 不同。`runtime-matrix.md:144-162` 【已验证】 | 每个 adapter kill/restart 后检查 queued input 是否仍存在，声明 per-version capability |
| provider resume 后的 native id 关联 | OAR 只规定新 streamId 和 input/native ids 的关联方式。`conversation.ts:63-90` 【已验证】 | 用 Codex thread/resume、Claude transcript catch-up、ACP session resume 各做断线 fixture |
| 断线是否意味着远程 CLI 进程仍在 | transport close 与 process exit 是两个来源。`codex-rs/app-server-transport/src/transport/websocket.rs:267-281`、`oar/shared/acp/session.ts:158-172` 【已验证】 | 在 Cell 和 provider 分离的测试环境中分别杀连接、杀 provider、重启 cell |
| `durationMs` 的 provider 真实耗时 | OAR 只有 observation timestamps 和 tool activity derived duration，不保证 provider clock。`oar/packages/oar/src/observe/tool-activity.ts:59-64` 【已验证】 | 只读记录 Cell ingress 时间和 provider native timing，分开保存两者 |
| 完整 thinking 内容 | 研究报告指出 thinking 可能加密、缺失或截断。`loom-next/docs/HC_MODEL.md:153-155` 【已验证】 | 仅使用 Loom 自有 session，记录 redacted/absent，不读取真实用户 transcript |
| Codex app-server 同时服务 hub 订阅和 `--remote` TUI | AR-2b 把行为列为未知项 U1 | 约 10 个极短付费回合，验证双客户端 turn/steer/断线顺序 |
| agy 多账号和 Linux 文件 token | REPORT-R2 的 U2、U3 未完成 | 安装隔离容器和测试账号后做无业务任务探针 |
| Claude TUI 和 `-p` 的额度差异 | REPORT-R2 的 U4 未完成 | 少量付费 A/B，条款由项目负责人判断 |
| Herdr 移动端是否能看到 `--via` 容器终端 | REPORT-R2 的 U5 未完成 | 无模型容器终端连接测试 |
| Claude/agy TUI 审批是否能完整结构化抽取 | REPORT-R2 的 U6 未完成 | 用无模型或极少回合的专用 hook/transcript fixture |

## 附录 B：参考项目分歧和取舍

### OAR 与 T3 的 event 和 receipt

OAR 把 control request、control response 和 runtime facts 放进同一条有序 record stream，因此 abort 与 tool result 可以用同一个 seq 对齐。`oar/docs/spec/record-stream.md:7-20` 明确说明分成两个 channel 会失去先后关系。T3 把命令 receipt、持久 event store、projection 和 restart continuation 分开实现。loom_new 采用 OAR 的同一事件流和 cursor，采用 T3 的持久 receipt、`resultSequence` 和重启恢复思路。

### T3、Harbor 和 Raft 的回复传递

T3 的 `delegate_task` 是半中继。子线程普通结束后 server 读取 `task.result` 并唤醒父线程。Harbor 与 Raft 则要求 agent 自己执行通信 CLI，Harbor 未收到 `harbor send` 会记录 `no_reply`。loom_new 选择 T3 的最终结果提取模式，但把中继放在 Cell/hub，并将证据摘要附在最终回复之后。agent 不需要通讯工具。

### Orca 的 hooks 和 OSC

Orca 规定 hooks 优先，OSC 7501 只填补缺失字段，OSC 作为 facet 不能反过来决定状态。`orca/src/main/agent-hooks/README.md:3-27`。loom_new 采用相同优先级，并把 screen text 放在最低层。OSC 的五状态是 `idle/working/done/blocked/error`，而协议需要 `needs_human` 和 `exited`。因此 v0 把 `blocked + kind=auth` 归一化为 `needs_human`，把明确 process exit 单独归一化为 `exited`，不把 OSC `done` 直接当成最终业务成功。

### OAR 的 optional member 和 typed refusal

OAR 对 `steer`、`withdraw`、`stopTask` 采用成员缺失表达不支持，对输入级别问题用 `unsupported`、`no_active_turn`、`runtime_refused` 等 typed code。`oar/docs/spec/runtime-matrix.md:135-178`、`oar/packages/oar/src/contracts/records.ts:262-284`。loom_new 保留同一思想。协议能力字段可选，command refusal 同时给稳定 code 和短 reason。

### Codex approval request 和 loom_new 的无审批立场

Codex app-server 公开了 command、file change、permissions、tool input 和 MCP elicitation request。`codex-rs/app-server-protocol/src/protocol/common.rs:1935-1973`。T3 有结构化 RuntimeRequest 审批，而 loom_new 的架构立场是无审批。v0 因此把可观察的拒绝、等待和 request 保留为 `sandbox_refused`、`native_frame` 或 `error` 证据，不暴露 approve command，也不让 worker 弹选择器。

### exactly-once 与 at-least-once

旧 loom-next 经验明确提醒，send success、started、working 和 turn 增加都不能证明输入已经入账。`loom-next/docs/HC_MODEL.md:5,107-133`。T3 的 `insertIfAbsent` 和 Harbor 的 accepted input requeue 给出了可复用的持久去重和重投边界。loom_new 选择 at-least-once，并把 native start、input dropped 和 turn end 分开记录。没有接收侧事务时不宣称 exactly-once。
