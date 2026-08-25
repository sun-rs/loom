# RAH OS 独立架构审计

> 后续状态（2026-08-25）：本文保留审计发生时的证据快照。第 3 项“真实进程只有 delivery、没有 Task 闭环”已由 [ADR-0006](../adr/0006-task-business-protocol-and-causal-worker-commands.md) 对应实现与 fake/Codex Luna E2 gate 关闭；文中其余未完成项不能因此视为关闭。

> 历史基线快照：本文保留审计当时的实现判断，后续 POSIX supervisor 增量及已关闭问题见[进程监督器独立复审](./2026-08-25-process-supervisor-follow-up-audit.zh-CN.md)。当两者描述冲突时，以后者和当前 ADR/测试为准。

- 审计日期：2026-08-25
- 结论：**Conditional Go**
- 审计对象：README、工程合同、核心架构、投递/激活架构、路线图、Phase 1 证据及当前 Kernel 实现

## 1. 执行结论

旧 RAH 的根因判断成立：Session 与 Council 分别拥有上下文，Council 又依赖模型参与的 MCP listening；接入更多 CLI 后，Session UI 需要持续理解各家 JSONL、tool、thinking 和错误格式。这样会同时产生双重业务真相、等待 token 消耗和 Provider 适配债务。

RAH OS 选择的 Room-first 路线具有可操作性，但当前不能诚实地宣称“已经明显优于 Raft、Multica 或所有热门项目”。更准确的结论是：

> RAH OS 已经用测试固定了一个有差异化潜力的最小 Kernel；完整优势仍是假说，必须由 AgentHost、Task/Review、Memory 和故障注入基准转化为证据。

没有一个被审计项目同时把以下八点全部作为公开、可测试的不变量：

1. Room 是跨人类、Agent、Task 和 Run 的唯一协作真相；
2. 每个 participant 有持久 Inbox 和独立 cursor；
3. Attention 与是否立即启动模型的 Activation 分离；
4. Activation 可合并、租赁、恢复，wake 只做无正文提示；
5. Agent identity、RuntimeProfile、ModelProfile、ProviderSession 和 RunAttempt 分离；
6. Task/Artifact/Review 不由进程退出或 transcript 推断；
7. Provider transcript 永远不进入业务正确性边界；
8. 长期记忆带 scope、provenance、revision、supersedes 和实际注入清单。

前四点已有部分代码；后四点主要仍是设计。它们是“优势目标”，不是现状宣传。

## 2. 证据等级

以后所有架构主张必须标注等级：

| 等级 | 含义                      | 可使用措辞       |
| ---- | ------------------------- | ---------------- |
| E0   | 设计提案，无实现          | 计划、目标、假说 |
| E1   | 确定性单元/集成测试通过   | Kernel 已证明    |
| E2   | 真实 CLI 和故障注入可复现 | 系统已证明       |
| E3   | 与同类项目按同一指标对照  | 已证明相对优势   |

GitHub stars、功能列表、一次人工演示和成功 exit code 都不是 E2/E3 证据。

## 3. 当前实现与文档一致性

### 已证明（E1）

当前确定性测试 suite 证明：

- Room 内事件序号单调；
- Message 在一个 SQLite 事务中派生 Event、Inbox、Activation 和 Outbox；
- 幂等键包含规范化收件人和激活原因；
- queued Activation 合并，leased 期间生成后续 Activation；
- 两个 Host 竞争只有一个有效 lease owner；未创建 RunAttempt 的过期 lease 可恢复，存在 active RunAttempt 时 fail-closed orphan/quarantine；
- 旧 lease owner 不能完成 Activation；
- Inbox acknowledgement 与 Activation completion 分离；
- wake payload 不包含消息正文；
- Outbox 有单调提交顺序。

### 只有本机证据（E2 候选）

旧 Phase 1 harness 曾让 Codex、Kimi、OpenCode 和 Claude Code 通过同一显式任务协议，验证器不读取它们的 stdout/JSONL。该 harness 和原始结果尚未进入本仓库，因此目前只能标记为“本机可追溯、仓库内不可独立复现”，不能当作发布门禁。

### Stop-ship 缺口

审计后已完成以下 E1 增量：

- `sync()` 不再自动推进服务端 cursor，客户端必须显式 `acknowledgeCursor`；响应丢失会安全重放；
- principal access token 只以 hash 保存，业务 command 的 actor 来自已认证 context，command 内注入的 `actorId` 不生效；
- Agent `postMessage` 缺少或落后于当前 Room 的 `basedOnRoomSeq` 时以 `stale_context` 原子拒绝；
- Outbox 已有 claim lease、expiry takeover、published ack 和 delayed retry；最小 AgentHost 可 lease Activation 并调用 Fake Runtime。
- Activation 已有 lease renew、失败延迟重排和 queued follow-up 合并；AgentHost 已有无 wake reconciliation loop 与 durable Host heartbeat。
- 每次 Runtime 执行已有独立 RunAttempt，持久记录 starting/running/exited/failed、runtime handle、exit 与错误；它不等于 Activation 或 Task 结果。
- 运行中 supervisor 已并发监控 reap、timeout 和 lease maintenance：长 Run 周期 heartbeat/renew，挂死 Fake Runtime 会 cancel、记录 `timed_out` 并 durable requeue。
- L0 GenericProcessAdapter 已通过受控 executable 验证 shell-free spawn、不可冒充的 Activation metadata、限长 opaque stdout/stderr、exit/reap，以及 POSIX process-group `SIGTERM`→`SIGKILL` 同组 descendant cleanup；测试不解析输出生成业务事件。该项不证明主动 `setsid` 逃离原 group 的 descendant 已被 containment。
- loopback Worker Application Service 已用 per-Activation hashed token 固定 actor/Room/consumer；只允许确认同一 credential 已收到的 cursor，并在 expiry、process exit 或 spawn failure 后拒绝复用。
- AgentHost→GenericProcessAdapter→外部 fixture→Worker API→Kernel 的 `sync/ack` 路径已完成 Activation；stdout 内容未进入完成判定。
- Worker `sync` 被 credential 的 Activation `toSeq` 截断；运行中到达的后续消息只能由新的 Activation credential 读取。501 条消息跨 500-event 页上限的测试证明 continuation 和最终 ack 不依赖单页假设。
- Worker request/response/error 与 credential scope 已收归 `@rah-os/protocol` 严格 schema，application service 不再手写第二套公共字段定义。
- Runtime cancel 必须返回 terminal exit；cancel/reap 无法证明终止时 Activation durable quarantine，后续 queued work 不能越过该 participant lane。
- lease 到期且仍有 `starting/running` RunAttempt 时，Kernel 产生 `run.orphaned` 与 `activation.quarantined` 事件，而不是直接把 Activation 交给另一 Host 双开；兼容 recovery driver 可在 terminal proof 后解除隔离，Generic 裸 PID/PGID 仍不自动处理。
- RunAttempt 创建只产生 `run.created`；runtime spawn 成功并持久化 handle 后才产生 `run.started`，spawn failure 不再伪造已启动事件。
- GenericProcessAdapter 等待 stdio close 后完成 reap，并限制已完成 run diagnostics 的保留数量，避免 daemon 内存无界增长。
- Worker credential 新增 `hostId + runAttemptId` fencing；每次请求验证当前 lease/RunAttempt/RuntimeProcess，旧执行即使 token 未过期也不能继续调用。
- RuntimeProcess、opaque recovery descriptor、竞争 recovery lease、失败 backoff、terminal proof 与 proof-gated quarantine resolution 已持久化；Fake adapter 证明 orphan 对账完成后才能重新启动 participant lane。
- Activation completion 新增 runtime terminal-proof 门禁；Room cursor 已 ack 但进程仍 active 时不能完成。
- Generic direct process 明确不声明跨 daemon recovery：PID/PGID 没有抗复用 identity，当前不能安全自动 kill，避免把 registry 存在夸大为真实进程 cleanup 已完成。

AgentHost 还增加了一条 delivery proof：exit 0 不足以完成 Activation；指定 runtime consumer 必须先 sync 并显式确认到 Activation `toSeq`。这些关闭了单一回归和最小 happy path，但 B1/B3/B4 的压力、进程和故障矩阵仍未完成。

其余缺口：

1. **Host 认证与长期 credential 生命周期未完成。** per-Activation worker token 已有 scope、expiry 和 process-lifetime revoke，但 AgentHost 仍按传入 `hostId/participantIds` 工作；Host credential 的 issuance、rotation、revocation、capability scope 和远端 transport 尚未实现。
2. **没有实际 Outbox publisher loop。** 可恢复存储状态已实现，但 WebSocket/SSE publisher、backoff policy、dispatcher crash loop 和 100% wake loss 还未证明。
3. **真实进程只有 delivery 闭环，没有 Task 闭环。** GenericProcessAdapter 与 external fixture 的 scoped `sync/ack` 已有 E1；Task `claim/start/progress/submit` 尚无新 Kernel aggregate/API。Host crash 后 durable orphan registry 与 Fake recovery 已证明，但 Generic/Provider 旧 OS process 的 identity-safe discovery/reap、Windows tree kill、固定 wall-clock SLA 和真实 Provider CLI 尚未证明。
4. **没有 Task、InputRequest、Artifact、Review。** 最小 RunAttempt 已实现，但 `Task != Run` 与 `submit != complete` 仍未在新 Kernel 实现。
5. **Causal freshness 仍是粗粒度。** Agent `postMessage` 已按整个 Room head 严格检查；未来 Task/Review 需要 aggregate relevance、hold delta 和 override audit。
6. **没有长期记忆和 ContextManifest。** 当前不能证明换 CLI、换 Host 或删除 Provider Session 后仍能获得正确且无越权的长期上下文。
7. **幂等响应不完整。** 重试能避免重复派生，但当前返回值不保证与第一次 mutation 的完整响应相同。

因此 Phase 1 状态应视为“最小 Kernel 绿色、完整退出门禁未满足”。

## 4. 外部项目独立比较

### 4.1 直接产品

| 项目                                                        | 已证实强项                                                                                | 适配/Session 边界                                                             | RAH 必须学习或超越                                                                                              |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [Raft](https://docs.raft.build/features/agents/runtime/)    | Agent 是长期成员；runtime 可切换；channel/task UX；external bridge 使用 content-free wake | 公开 external adapter 唤醒后由 Agent 自行拉正文；managed runtime 内部不可审计 | 吸收 wake proof taxonomy、freshness hold、workspace continuity；以 durable Activation 和 scale-to-zero CLI 超越 |
| [Multica](https://multica.ai/docs/how-multica-works)        | Issue 与单次 Task(run) 分离；daemon claim；WS + polling；触发合并；大量 CLI 和成熟产品流  | 使用统一内部事件模型，但底部仍有多 protocol-family adapter 和 Provider 特例   | 学习业务流、daemon、模型配置和重试；拒绝让 rich transcript 成为业务依赖                                         |
| [Commonly](https://github.com/Team-Commonly/commonly)       | Pod、Agent identity、event queue、runtime API、Task board、Kernel memory                  | 已有 `pending → delivered → acked`；跨 runtime memory 是一等内核概念          | 是最接近的开源威胁；RAH 必须用更清晰的账本、投递语义和带 provenance 的记忆证明差异                              |
| [Patchwork](https://github.com/vincelwt/patchwork)          | Relay 是 source of truth；Room/Task/Inbox/worktree；Agent identity 与 ACP runtime 分离    | ACP-first；tool/diff 在 run log，业务消息在 chat                              | 架构最接近；必须纳入持续黑盒对照，不能因 stars 少而忽略                                                         |
| [Kandev](https://github.com/kdlbs/kandev)                   | ACP 多 CLI Kanban、pipeline、review gate、worktree                                        | ACP Agent Profile/bridge 降低平台内 JSONL 适配                                | 证明 ACP-first 是现实路线；RAH 仍需补 Room 因果账本与可靠 Activation                                            |
| [Agent Room](https://github.com/agent-room-alkl/agent-room) | 共享 Room、cursor、webhook wake、证据任务和 turn discipline                               | 仍用长轮询；用自由文本 marker 提取部分工作产物                                | 吸收 webhook wake 和多人 turn discipline；业务对象必须用 typed command 而非 marker/parser                       |
| [Helmor](https://github.com/dohooo/helmor)                  | 多 CLI、本地 worktree、diff/review/PR 的完整工作站体验                                    | 更接近每 Task workspace/session 管理                                          | 学习 worktree 和 review UX；不把其 Session UI 变成 Room truth                                                   |

截至审计日，OpenClaw、OpenHands、Multica、LangGraph、Letta 等项目拥有显著 GitHub 关注度；stars 只用于发现候选，不能证明架构正确。Patchwork stars 很少却是更直接的架构对手。

### 4.2 协议与执行底座

| 项目                                                                              | 正确使用方式                                                                           | 不能让它拥有的状态                                      |
| --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| [ACP](https://github.com/agentclientprotocol/agent-client-protocol)               | 首选 Runtime 交互协议：session、prompt、cancel、permission、tool/plan/usage updates    | Room、Task、Inbox、Activation、Review                   |
| [AHP](https://microsoft.github.io/agent-host-protocol/guide/ahp-and-acp.html)     | 借鉴 host-authoritative snapshot、serverSeq、pure reducer、multi-client reconciliation | 跨 Agent 的业务 Room；AHP 本身仍以 Agent Session 为中心 |
| [A2A](https://github.com/a2aproject/A2A/blob/main/docs/specification.md)          | 远程 opaque Agent connector；映射 Task、Artifact、input-required 与 push               | RAH 内部 Task owner 和 Room ledger                      |
| [Matrix](https://spec.matrix.org/v1.19/client-server-api/#get_matrixclientv3sync) | 借鉴 client-held sync token、snapshot/delta、push 与 timeline 分离                     | Agent 执行调度和 Task 状态机                            |
| [LangGraph](https://langchain-ai.github.io/langgraph/concepts/langgraph_server/)  | 可选的长流程/checkpoint 执行引擎                                                       | RAH Room、Agent identity 和业务对象                     |
| [Letta](https://github.com/letta-ai/letta)                                        | 借鉴跨 conversation memory block 与共享记忆                                            | 未经 provenance/ACL 审查的 RAH 业务真相                 |
| [OpenHands](https://github.com/OpenHands/OpenHands)                               | 借鉴 sandbox、EventLog 和 action/observation 模型                                      | 多人 Room 与跨 CLI 业务协议                             |

ACP 与 AHP 的分工尤其重要：ACP 解决一个 client/host 如何驱动一个 coding agent；AHP 解决多个 client 如何同步一个 Agent Session。RAH OS 位于它们之上，解决多个 Agent 与人如何在一个 Room 中共同承担业务工作。

## 5. Multica 的关键事实

Multica 并没有消灭解析成本，而是把成本隔离并工程化。审计固定到源码提交 `39ddc82c9dc25494286db4fbc07382d209527f86`：

- [`agent.go`](https://github.com/multica-ai/multica/blob/39ddc82c9dc25494286db4fbc07382d209527f86/server/pkg/agent/agent.go) 定义统一消息/执行接口，同时用硬编码 protocol family 和 constructor 选择支持工具；
- `server/pkg/agent` 约有 28,624 行生产 Go 和 44,284 行测试；
- 静态统计约有 149 处 `json.Unmarshal` 和 28 个 stream scanner；
- Codex app-server、Claude stream-json、OpenCode/Pi event stream、ACP family 等仍需要不同处理；
- 官方 Task failure reason 包含 `empty_or_unparseable_output`。

这恰好给 RAH OS 一条可检验的产品边界：

> 新 CLI 无需 transcript parser 就能参与 RAH 业务协议；session resume、live input、thinking/tool UI、usage 和错误分类是可选能力，失败时只降级观察体验。

Multica 最值得照搬的是：

- Agent 是持久身份，不是常驻进程；
- Issue 是业务工作，Task 是一次 Agent run；
- queued 工作由 daemon claim，断线后 polling 兜底；
- waiting/running 时的新触发被合并为当前或后续一次 run；
- Run completed 不等于 Issue done。

Multica 的长期能力目前有持久 identity、instructions、skills、Issue/Chat history 和 session resume；未发现已发布的、跨无关 Issue/Chat 且带 provenance/冲突治理的 Agent episodic memory。不能把“历史存在”称为“长期认知记忆”。

## 6. Raft 的关键事实

Raft external-agent 的公开链路是：

```text
server wake hint
  -> bridge reconciliation
  -> local authenticated /wake
  -> runtime/plugin 注入固定通知
  -> Agent 用 raft CLI 拉正文并回应
```

[Wake contract](https://github.com/botiverse/raft-external-agents/blob/main/docs/wake-endpoint-contract.md) 明确区分 `server_delivered`、`harness_accepted`、`wake_injected`、`model_seen`；注入成功不推进 read/model-seen。公开 Claude plugin 的 telemetry 也与业务事实分离。

Raft 还实现了 freshness hold：Agent 发送回复、claim 或更新 Task 时携带已看过的 sequence；如果新消息在读取后到达，服务端可以 hold mutation 并让 Agent 先获取新上下文。这是 RAH OS 当前必须补齐的 P0 能力。

Raft 的“长期记忆”主要是 Agent 本机 workspace 文件；它跨 restart/session reset 和 runtime 切换，但绑定 computer，full reset 可清空，也没有公开的结构化 provenance/版本/冲突契约。

## 7. Commonly 与长期记忆的反证

Commonly 已将 memory 定义为 runtime-agnostic Kernel primitive，而不是 OpenClaw 文件的镜像。其 [ADR-003](https://github.com/Team-Commonly/commonly/blob/main/docs/adr/ADR-003-memory-as-kernel-primitive.md) 定义 private/pod/public scope、runtime promotion 和跨 driver 测试。因此“RAH 是唯一将记忆与 runtime 解耦的系统”不成立。

但 Commonly 当前 envelope 仍以 Markdown content 为主，并明确把 memory history/versioning 列为 non-goal。其 ADR 还诚实记录了早期记忆约 70% 是去重记账、知识积累为 0%，说明“存在 memory API”并不等于记忆质量可靠。

RAH 可建立的差异是：

- shared knowledge 必须带 source event/artifact provenance；
- candidate 经验证后才能 active；
- correction 使用 supersedes/retracted，不静默覆盖；
- 每个 Run 固定保存实际注入的 ContextManifest；
- Task/Decision/Artifact 仍是业务对象，不降级成模糊 memory。

## 8. 可成立的相对优势

以下优势在相应 benchmark 通过后可以成立：

1. **相对旧 RAH：** 唯一 Room owner 消除 Session/Council 双真相；LLM 不负责长期 listening；JSONL 不参与业务恢复。
2. **相对 Raft：** durable Activation 即使在 100% wake 丢失时也可被 Host reconciliation 找回；Attention 与执行预算分离；短生命周期 CLI 可以 scale-to-zero。
3. **相对 Multica：** L0 新 CLI 不解析输出即可完成业务工作；Provider 版本变化最多破坏 telemetry，不会破坏 Task/Room。
4. **相对 Session 工作站：** 一个 Task 可跨 Agent、runtime、session 和 retry；协作背景不被锁进任一原生 session。
5. **相对通用 multi-agent framework：** Room/Task/Artifact/Review 是开箱即用的业务协议，而非需要应用自行拼装的 graph state。
6. **相对现有 memory 实现：** provenance + revision + ContextManifest 使记忆可审计、可撤回、可验证无越权。

上述句子的动词目前应是“目标是”，不是“已经”。

## 9. 审计决定

- 保留 Room-first、Inbox/Activation、Task/Run 分离和 transcript 非权威原则。
- 接受 Multica 的 daemon/claim/coalescing/Issue-vs-run 经验。
- 接受 Raft 的 freshness hold、delivery proof 和 telemetry 双平面。
- ACP 作为优先 Runtime 协议；AHP 作为 UI 状态同步参考；A2A 作为远程 connector。
- 增加 Memory/Context Fabric，但不得自动把 transcript 提升为长期知识。
- 将 Phase 1 保持为 provisional；cursor、principal auth、粗粒度 causal mutation、Outbox、Activation retry/quarantine、最小 AgentHost/RunAttempt/RuntimeProcess、GenericProcessAdapter 活动进程 lifecycle、leased Fake orphan recovery 与 external fixture `sync/ack` 已有 E1，仍须完成 Host auth、publisher loop、Task worker command、identity-safe Generic orphan cleanup 和完整 B1/B3/B4 后再宣告完成。
- 在竞争基准达到 E3 前，禁止使用“已明显优于 Raft/Multica/热门项目”的宣传措辞。
