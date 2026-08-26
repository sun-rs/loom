# RAH Core SDK 边界

状态：**v0.1 implemented / Task Coordination v1 / schema v7 collaboration boundary / daemon v4 fake E2**（2026-08-26）。`@rah-os/core` 已成为 daemon 可直接嵌入的稳定组合边界；它不依赖 HTTP、WebSocket、MCP、UI 或任何 Provider transcript parser。fake 多 Agent 门禁已证明不同 Agent 并发、单 Agent 串行、开放 Task 单 winner、Task 显式验收与 Room 权威判定；schema v7 已建立 Workspace/Room/Role/Thread 存储边界；可执行 config v4 进一步证明同一 Host 的两个 participant 由 Kernel Placement 路由到两个 immutable Runtime Profile。它仍不是 Workspace 管理 API、canonical WorkspaceDefinition/mount/Capacity 管理面或真实多 CLI certification。

## 1. Core 是什么

Core 是一个可单独 import、无界面的业务运行库，而不是 daemon 进程本身：

```text
@rah-os/protocol
  -> @rah-os/kernel            canonical state + transaction + scheduler
  -> @rah-os/agent-host        RuntimeAdapter + lane execution/recovery
  -> @rah-os/core              stable headless composition SDK
       <- daemon / tests / future embedded host

application-service / HTTP / SSE / MCP / CLI / Web / Mac / iOS
  -> replaceable shells around Core contracts
```

`RahCore.open()` 持有 SQLite Kernel 生命周期；`core.kernel` 暴露 canonical command/query surface；`core.createMultiLaneAgentHost()` 创建绑定到同一 Kernel 的有界多 lane runner。daemon 已经通过 `RahCore` 打开和关闭业务核心。

## 2. Core 拥有什么

| Core owner      | 权威事实                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------ |
| Identity/ACL    | Principal、Room membership、authenticated actor/Host/Worker scope                                      |
| Collaboration   | RoomEvent、Inbox、cursor、content-free Outbox                                                          |
| Business flow   | Task、InputRequest 及其显式 command/event 状态机                                                       |
| Scheduling      | Activation、Agent/Policy revision、RuntimeOffer observation、Placement、capacity/workspace reservation |
| Execution proof | RunAttempt、RuntimeProcess、lease、terminal proof、retry/quarantine/recovery                           |

业务完成只来自 Core command 成功提交的 canonical state。CLI exit code、JSONL、终端文本、思考过程、工具调用日志和 UI optimistic state 都不能完成 Task 或推进 Room cursor。

## 3. Core 不拥有什么

以下全部是可替换外壳或插件：

- `node:http` server、REST/SSE/WebSocket/MCP transport；
- daemon/launchd、Unix socket instance lock、安装与升级；
- PWA、Mac App、iOS App、raft-ui 或其他页面状态；
- Codex/Claude Code/Kimi/OpenCode 的启动参数、账号认证和 rich output adapter；
- JSONL/transcript 解析、console log、token/cost/思考展示；
- Keychain/file secret provider 与 Provider credential 内容。

Runtime 插槽只需实现 `RuntimeAdapter` 的 probe/start/reap/cancel/recover。业务 Agent 与 model/runtime/profile 分离；Placement 冻结本次运行选择，adapter 负责执行而不解释业务结果。

## 4. 并发与一致性不变量

1. Room ledger 是共享因果日志，但 Task command 对自己的 Task aggregate 和发给当前 Agent 的新事件做 optimistic concurrency；另一个 Agent 的 Placement、Task 或消息不会错误 fence 本 Task。
2. `scheduleNextPlacement` 在 Kernel transaction 内做 lane、Host generation、Offer、capacity 与 workspace 校验。
3. `claimNextPlacement` 原子消费 reserved Placement、续 Activation lease 并创建唯一 RunAttempt；多个 Host worker 不能重复 launch。
4. `MultiLaneAgentHost.capacity` 只限制本地执行槽；Kernel 的可信 `PlacementCapacityPolicy`、Offer 上限和 durable reservation 仍是权威并发门禁。
5. 同一 participant 永远最多一个 active lane；后续事件形成 queued follow-up Activation。不同 participant 可并发。
6. 某 lane hung、retry 或 quarantine 不允许阻塞其他 participant；未证明旧进程终止时只 fence 本 lane，不能释放资源后双开。
7. Agent 只能把 Task 推到 `submitted`；`completed` 必须由 Task creator 显式验收。Activation completion 也不能代替 Task completion。
8. open Task 只广播给 Room Agent members；每个 Agent 有独立 Inbox/Activation，但 SQLite transaction 只允许一个 winner 写入 `assigneeId/claimedBy`。同一 Task 仍是 single writer，多 Agent 协作用 dependency/后续 Artifact，而不是共享一个 CLI session。
9. dependency 只指向同 Room 的既存 Task；未全部 `completed` 时不产生 Activation。最后一个 dependency 完成后，由同一 `task.completed` event 的 `readyTaskIds` 派生一次 durable attention。

`PlacementCapacityPolicy` 是可信的 Core 启动配置，默认各层并发为 `1`，显式配置后才放宽；有效上限仍取 admin Host/profile/pool policy 与 Offer 的最小值。它解决本机嵌入式 Core 的 R3 门禁，但尚不等于未来可在线修改、经 control Room 审计的 `CapacityPoolRevision`。

## 5. Shell 接入规则

任何新外壳只允许：

1. 把已认证请求翻译成 Core command/query；
2. 把 canonical snapshot/event 投影成自己的 view model；
3. 把 content-free hint 当成“立即 pull”的提示；
4. 把 runtime diagnostics 存到 observation/log 面。

外壳不得持有第二套 Task/session/council 状态机，不得由 provider session ID 决定 Room identity，不得通过解析 CLI 输出推断 `claim/start/submit/complete`。因此新增第 21 个 CLI 的最低成本是一个启动/recovery adapter 与 capability probe，而不是新增一套聊天室消息解析器。

## 6. v0.1 收口门禁

- [x] 独立 `@rah-os/core` package，依赖方向不指向 daemon/application-service/UI；
- [x] daemon 使用 `RahCore` 管理 Kernel 生命周期；
- [x] Placement launch claim 跨连接原子且恰好产生一个 RunAttempt；
- [x] 两个 Agent 在同一 Room 并发执行，A hung 时 B 可提交并验收；
- [x] A 的 follow-up 在旧 lane 退出前不得并发启动；
- [x] 跨 Agent Room 事件不造成 Task stale-context 假阳性，发给本 Agent 的新事实仍会 fence；
- [x] 默认 capacity fail-closed，显式可信 policy 才允许两个 lane；
- [x] 可执行 daemon config v4 支持多 participant + placement-managed runtime；
- [x] MultiLane restart/recovery 与单 lane quarantine 隔离的组合 E2；
- [x] open Task 跨 Kernel connection 原子竞争，loser 可完成 Activation；
- [x] release/assign/block/unblock/cancel 与 immutable dependency ready 派生；
- [x] Worker/Client versioned application-service command surface；
- [ ] durable control-Room CapacityPool/WorkspaceDefinition 管理面。

上述未完成门禁补齐之前，可以称“Core SDK 与可执行 daemon 的多 Agent fake business flow 已成立”，不能称“完整多 CLI 生产 daemon 已收口”。
