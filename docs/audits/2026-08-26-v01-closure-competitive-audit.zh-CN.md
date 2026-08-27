# v0.1 收口与竞争性独立审计

日期：2026-08-26
审计对象：`rah_os` HEAD `894bf70` 之上的未提交收口工作树
证据等级：本地源码/测试为 E2；外部项目仅依据官方文档与公开仓库；未执行竞品黑盒 E3

## 1. 结论

当前代码可以冻结为：

> **RAH OS v0.1 local single-host headless collaboration/execution kernel candidate**。

它已经证明 Human、Room、两个 Fake Agent、开放 Task 单赢家、显式提交/验收、daemon 重启和 client cursor 恢复可以通过一套 canonical business state 闭环；Provider stdout、JSONL、思考和工具日志不参与业务判定。

它还不能被称为：

- 可安装的生产 daemon；
- 稳定发布到 npm 的公共 Core SDK；
- 已经覆盖 Raft/Multica 产品面的工作站；
- 已完成真实 mixed CLI v4、Artifact/Review、长期记忆或 Web/PWA 的完整 Agent OS。

这不是“核心只完成了 60%”的同一种判断。若边界限定为 **local、single-host、trusted-config、headless core**，本轮应停止继续扩大 v0.1；若按 Raft/Multica 的完整产品口径，仍有明显欠缺。

## 2. 审计方法与限制

本轮使用三个彼此独立的只读审计流：

1. 本地 v0.1 代码、ADR、测试与 authority boundary；
2. Raft/Multica 官方文档和 Raft 公开 External Agents 插件；
3. Commonly、OpenTeams、OpenHands、LangGraph、AgentScope、Letta 与 Microsoft Agent Framework 等公开项目。

Raft 主实现并未公开，因此其事务、fencing、恢复与内部适配成本均标为 `unknown`，不能把“没有公开证据”写成“对方没有实现”。Multica 公开仓库展示了大规模 provider adapter 与测试投入，但行数只说明其选择了 rich stream normalization，不说明质量优劣。

## 3. 语义先对齐

| 项目    | 业务工作对象                               | 一次 Agent 执行                                           | 对话/讨论锚点                                            |
| ------- | ------------------------------------------ | --------------------------------------------------------- | -------------------------------------------------------- |
| RAH OS  | `Task`，Human `complete` 才完成            | `Activation -> Placement -> RunAttempt -> RuntimeProcess` | Room/Thread 已有，但 Task 尚未绑定 source Message/Thread |
| Raft    | Task 本身是带编号、状态和 owner 的 Message | Agent runtime/session                                     | Task 所在 Thread；`in review -> done`                    |
| Multica | Issue 是业务工作                           | Task 是一次 Agent run；run 完成不自动关闭 Issue           | Issue comments/project context                           |

因此，“进程退出不等于业务完成”不是 RAH 独有概念。RAH 当前更强的公开证据是：该分离已经落到 transaction、lease、terminal proof、quarantine 和故障测试中，并明确禁止 provider parser 修改业务状态。

## 4. 对照矩阵

| 能力            | RAH OS v0.1 candidate                                                 | Raft                                                  | Multica                                                       | Commonly / OpenTeams / OpenHands 等                                |
| --------------- | --------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------ |
| 共享业务真相    | SQLite Room ledger、Task/InputRequest、显式 command                   | 产品文档显示 channel/task/thread                      | Postgres 最终真相、Issue/Task 分离                            | 各有 event/session/workflow 模型                                   |
| 唤醒与恢复      | content-free hint + pull + durable poll backstop                      | External Agents 插件为 wake 后 pull                   | WebSocket 提示 + reconnect query + daemon poll                | Commonly 也使用 poll/context/ack；该模式不是 RAH 独有              |
| 多 Agent 竞争   | open Task 广播，跨连接事务单赢家                                      | 单 owner Task                                         | Issue 分派、Task run                                          | 实现各异                                                           |
| 运行时解耦      | AgentDefinition / ExecutionPolicy / RuntimeProfile / Placement        | agent identity/workspace/memory 与 runtime/model 分离 | agent config 与 runtime/provider 分离                         | OpenHands Conversation/Runtime、AgentScope service 等也有分层      |
| Provider 输出   | 仅 observation；业务面零 transcript parser                            | 内部未知                                              | rich provider adapter 统一 thinking/tool/status/usage/session | 多数项目会消费自身 event/runtime stream                            |
| 故障语义        | ack cursor、lease、generation fence、terminal proof、retry/quarantine | 内部未知                                              | DB 最终真相与 reconnect/poll                                  | LangGraph/checkpoint、OpenHands event log 等各有 durable execution |
| 聊天产品面      | Workspace/Room/Message/Thread 基础 Core/API                           | 成熟 channel/DM/thread/activity/files UI              | 成熟 project/issue/agent/runtime UI                           | OpenTeams/Commonly/OpenHands 已有可用 UI                           |
| Artifact/Review | 未实现                                                                | files、task review flow                               | 项目/Issue 产物能力                                           | OpenTeams/OpenHands 较成熟                                         |
| Memory          | 仅设计文档                                                            | persistent agent workspace/memory                     | Agent/project context                                         | Letta/AgentScope 等明显领先                                        |
| 真实 CLI 广度   | 旧单 lane delivery gate；v4 mixed gate 未完成                         | 9 runtimes（官方文档）                                | 20+ provider/runtime adapter                                  | Commonly local wrapper、OpenTeams 多 provider                      |

## 5. RAH 的实际优势

以下优势有本地实现和测试支撑：

1. **Room/Task 是 CLI session 之上的业务 owner。** 删除或更换 provider session 不改变 Room、Task、Inbox、Activation 与 RunAttempt 的身份。
2. **投递、注意力和执行被拆开。** Inbox 记录事实到达，Activation 表示需要工作，Placement 冻结执行选择，RuntimeProcess 只提供执行证明。
3. **开放任务的单赢家是数据库事实。** 多 Agent 被唤醒不等于多 Agent 都能成为 Task owner。
4. **Provider parser 失败不会完成业务对象。** Fake E2 可以完全不解释 stdout/JSONL，Worker 必须调用显式 command。
5. **恢复语义公开且可测试。** client receipt ack、Host generation、lease、terminal proof、orphan/quarantine 和 follow-up lane 都是 canonical state。
6. **Human transport 不是第二个业务实现。** `HumanApplicationPort` 可直接嵌入；HTTP 只负责认证、解码、调用 port 和编码响应。

这些是“更可靠的底层边界”，不是“功能比成熟产品更多”。

## 6. 不应夸大的部分

- hint + pull + poll 是 Raft External Agents、Multica、Commonly 等项目也采用的收敛方案，RAH 的价值在 durable semantics，而不是发明了该网络模式。
- Multica 支持 20+ CLI 的能力来自大量隔离、适配和测试投入。RAH 通过放弃 rich telemetry normalization 减少业务适配面，也同时放弃了等价的统一思考/工具/usage 展示，不能宣称“同样能力但代码更少”。
- `@rah-os/core` 目前 `private: true`、导出 TypeScript source、依赖内部 workspace package；它是源码级 composition boundary，不是稳定公共 SDK。
- `core.human` 是应冻结的 capability boundary；`core.kernel` 暴露完整 Kernel，只能作为 trusted composition/bootstrap 的 experimental escape hatch。
- P3c 证明 Fake Agent 纵向链，而不是 Codex/Kimi/OpenCode/Claude 在 config v4 下的混合生产可靠性。

## 7. 审计发现并已修复的问题

独立代码审计发现三个会让 P3 证据失真的 authority 问题，本轮以先红后绿测试修复：

1. AgentDefinition/ExecutionPolicy mutation 原先只要求 Human Room member，现要求 **managed control Room 的 owner/admin**；普通 channel、普通 member 和 Agent principal 均 fail closed。
2. AgentDefinition 原先可以引用另一个 control Room 的 ExecutionPolicy revision，现强制同一 control Room scope。
3. daemon v4 P3c 原先用普通 Room 模拟 catalog，现改为 Human 创建 Workspace 后获得的真实唯一 control Room。

仍有一个明确的生产边界未修：Human 创建的 Workspace 尚未与 daemon 静态 `WorkspaceDefinition`、mount、cwd 形成 canonical 映射。Fake `in_place` E2 不受影响，但真实 CLI 写工作区前必须补齐。

## 8. 代码量、覆盖和复杂度判断

本轮工作树约有：

- production source：21,086 行；
- tests：16,765 行；
- docs：3,577 行（加入本文前）；
- 最大 owner：`room-kernel.ts` 6,919 行，仍低于 6,925 ratchet；`protocol/index.ts` 1,778 行，低于 1,800 ratchet。

独立覆盖测量为 line 约 90.96%、branch 约 79.38%、function 约 95.29%；daemon 和 MultiLane 的 branch coverage 仍低于总体。覆盖率不能替代故障矩阵，但当前“测试代码约为生产代码 80%”与 200 级别确定性测试表明，这不是只有 ADR 的架构原型。

复杂度判断：

| 必须保留                                   | 暂停扩张                                  | 明显欠缺                               |
| ------------------------------------------ | ----------------------------------------- | -------------------------------------- |
| Room seq/idempotency/cursor                | 多 Host/CapacityPool/PlacementHold 管理面 | Task 与 Message/Thread 的讨论锚点      |
| Inbox/Activation/Outbox                    | 更多 config/API compatibility 版本        | Human Inbox/Activity surface           |
| Task/InputRequest command state            | rich transcript/tool normalization        | Artifact/Review                        |
| RunAttempt/RuntimeProcess/proof/quarantine | 完整工作流引擎                            | Workspace mount/cwd canonical mapping  |
| HumanApplicationPort                       | Memory 在核心链闭环前实现                 | mixed real CLI v4、RahClient/Web、部署 |

结论是：**可靠性骨架没有过度；产品功能明显欠缺；Placement 管理面的部分设计已超出 local v0.1 必需范围。** v0.1 不应再以 CapacityPool 或 durable PlacementHold 为阻塞项。

## 9. Competitive Benchmark 当前证据

| 场景                   | 状态                 | 说明                                               |
| ---------------------- | -------------------- | -------------------------------------------------- |
| B1 reconnect           | pass/local           | Room cursor 与 P3 client reconnect 有确定性证据    |
| B2 coalescing          | pass/local           | queued/follow-up lane 已覆盖                       |
| B3 wake loss/dup       | pass/local           | content-free wake + polling backstop；无竞品 E3    |
| B4 crash matrix        | partial/strong       | 多个关键 crash point 已覆盖，尚非穷举矩阵          |
| B5 delayed Human reply | pass/local           | durable InputRequest、无模型等待                   |
| B6 causal freshness    | pass/local           | stale context 与缺失事实门禁                       |
| B7 new CLI zero parser | partial              | fixture 与旧 real CLI delivery gate；mixed v4 未跑 |
| B8 parser chaos        | architecture-pass    | 业务面不含 parser；尚缺专门 chaos corpus           |
| B9 cross-CLI handoff   | fail/not implemented | 缺 Artifact/Review 与 mixed v4                     |
| B10 Task race/recovery | pass/local           | single winner、lease、submit/complete 分离         |
| B11 memory             | not implemented      | 只有目标架构                                       |
| B12 side-effect replay | partial              | idempotency/outbox 较强，未做 10,000 次随机 replay |

没有一个场景完成了与可运行竞品的同条件黑盒对照，因此当前相对优势最高仍是 E2 架构证据，不是 E3 胜负结论。

## 10. v0.1 冻结边界与最短后续路线

v0.1 现在应冻结：

- canonical Room/Task/Inbox/Activation/Outbox owner；
- Human `complete` 与 Run terminal 的严格分离；
- per-Agent serial、cross-Agent bounded concurrency；
- provider output diagnostic-only；
- `HumanApplicationPort` transport boundary；
- local single-host trusted-config 声明范围。

v0.2 的优先顺序应是：

1. Task 增加 source Message/Thread 讨论锚点，并公开 Human Inbox/Activity；
2. Artifact/Review 最小纵向链；
3. WorkspaceDefinition/mount/cwd 与 Human Workspace 的 canonical 映射；
4. Codex + Kimi/OpenCode 的 mixed config v4 real gate，Claude 仅做低成本兼容 gate；
5. 再开始 `RahClient -> client-core -> Web/PWA`；
6. ACP L1、Memory/ContextManifest、多 Host/CapacityPool 留在上述链路之后。

若下一轮继续增加 scheduler/control object，而没有 Task discussion、Artifact/Review 或 mixed real CLI gate，项目会再次走向“底层越来越完整、核心业务链迟迟不可用”的旧路径。

## 11. 外部资料

- Raft：[Agent runtimes](https://docs.raft.build/features/agents/runtime/)、[Tasks](https://docs.raft.build/features/collaboration/tasks/)、[Channels](https://docs.raft.build/features/messaging/channels/)、[Threads](https://docs.raft.build/features/messaging/threads/)、[Files](https://docs.raft.build/features/collaboration/files/)、[Workspace](https://docs.raft.build/features/agents/workspace/)、[External Agents](https://docs.raft.build/features/agents/external/)、[公开插件](https://github.com/botiverse/raft-external-agents)
- Multica：[Architecture](https://multica.ai/docs/developers/architecture)、[Daemon runtimes](https://multica.ai/docs/daemon-runtimes)、[Tasks](https://multica.ai/docs/tasks)、[Issues](https://multica.ai/docs/issues)、[Agents](https://multica.ai/docs/agents)、[Providers](https://multica.ai/docs/providers)
- 其他公开项目：[Commonly](https://github.com/Team-Commonly/commonly)、[OpenTeams](https://github.com/openteams-lab/openteams)、[OpenHands](https://github.com/OpenHands/OpenHands)、[LangGraph](https://github.com/langchain-ai/langgraph)、[AgentScope](https://docs.agentscope.io/latest/en/deploy/agent-team)、[Letta Code](https://github.com/letta-ai/letta-code)、[Microsoft Agent Framework](https://github.com/microsoft/agent-framework)
