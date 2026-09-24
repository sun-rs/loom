# S2 施工规格（草案，待 Codex 审查与 owner 签字）：每实例一个热进程（合同 §6a）

日期 2026-09-24。依据：target-contract §6a、AGENTS.md 不变量、`loom-cli-process-lifecycle` / `loom-sync-tui-attach` 调研、`789ffc6` 的 09-17 生命周期审计（per-turn 的根因是 Run 与进程寿命耦合：`agent-host.ts` 等 `reap`、`room-kernel.ts:4905/5034` 要求终止证明、凭据与身份放在进程环境里）。本页只是设计，未改代码。

## 1. 生命周期与记录归属

每个实例的进程状态：`cold → starting → idle ⇄ busy → draining → terminated`（回收/淘汰/崩溃都进入 terminated，并记下原因 `idle_ttl | lru | recycle_rss | recycle_age | cli_changed | crash | stall | removed | host_shutdown`）。

| 记录                                   | 归属                                       | 语义                                                                                                                                                                                                                             |
| -------------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新表 `instance_runtimes`**（Kernel） | 一行对应一个热进程的完整寿命               | participant、host 及其代数、driver、pid/pgid、argv 标签、CLI 指纹、状态、`current_run_attempt_id`、`last_activity_at`、TUI 租约、退出码与信号。部分唯一索引保证每个 participant 最多一行非 terminated 记录（单 lane 的物理保证） |
| RunAttempt                             | 不变，一轮一条                             | 新增 `instance_runtime_id` 和 `native_turn_id` 两列。一轮真实执行对应一条 RunAttempt，结束后不改写                                                                                                                               |
| `runtime_processes`                    | 仍与 RunAttempt 一对一，改称"本轮执行记录" | 新增 `proof_kind ∈ {process_exit, turn_quiesced}`。state 仍用 `terminated`，所以现有 6 处围栏（4165/4905/5034/5713/6312、完成/重试）一行都不用改                                                                                 |
| Activation                             | 不变                                       | 完成仍要求 ACK 覆盖到 toSeq，且本轮执行记录已终止                                                                                                                                                                                |

**本轮结束的证明（新 API `recordTurnQuiesced`）**。Kernel 在一个事务里核对以下四条：

1. `instance_runtimes` 处于 busy，且 `current_run_attempt_id` 就是本轮。
2. Host 代数匹配。
3. 驱动上报的原生结束事件带回的 turn id 等于本轮 `native_turn_id`，且没有在途工具或审批。
4. Host 刚检查过进程组还活着（`kill(-pgid,0)`，并且 argv 标签吻合）。

四条都成立就写入 `runtime_processes.terminated(proof_kind=turn_quiesced)`，同时把实例置为 idle。如果进程已经死了，就走原来的 `process_exit` 证明，实例进入 terminated。之后照旧依次 `finishRunAttempt` → `completeActivation`。

Kernel 的 `#assertWorkerGrantScope` 已要求 RunAttempt 为 running、RuntimeProcess 为 active。所以 quiesce 一提交，本轮的 Worker 授权在 Kernel 层就自然失效了。

**取消**：先发原生 interrupt。10 s 内收到"已中断"的结束事件，按 quiesced 处理，进程保留。超时就对进程组发 SIGTERM，3 s 后 SIGKILL，记 `process_exit`，实例 terminated。

## 2. 每轮凭据：不再放在环境变量里

现状：`worker-credential-file.ts` 每轮新建一个 `activation-<uuid>/token`，路径通过 `RAH_WORKER_SESSION_FILE` 传入环境。`RAH_ACTIVATION_ID/RUN_ATTEMPT_ID/FROM_SEQ/TO_SEQ` 也作为环境变量围栏（`launch-environment-policy.ts:70`）。常驻进程的环境在启动时就冻结了，这两种做法都失效。

**方案 A（推荐，S2-a 用）：固定路径，内容按轮次轮换。**

- 进程启动时固定路径 `<cred>/instance-<runtimeId>/turn.json`（目录 0700）。环境里只保留这个路径、API origin，以及稳定身份 `RAH_PARTICIPANT_ID/HOST_ID`。每轮的身份围栏从子进程环境中删除。
- 轮次开始：Host 签发本轮凭据，把 `{token, runAttemptId, activationId, toSeq}` 以 `O_EXCL` 写入临时文件，再 `rename` 原子替换（Worker CLI 每次调用都会用 `O_NOFOLLOW` 重新读取，已核实 `worker-cli.ts:1800`），然后才发送 turn/start。
- 轮次结束：先撤销凭据、删除文件，再调 `recordTurnQuiesced`。idle 期间进程不持有任何有效凭据。
- Worker CLI 中 `RAH_RUN_ATTEMPT_ID` 的用途（制品幂等键，`worker-cli.ts:703`）和 `worker-startup-context.ts` 的读取改为读 turn.json。

**攻击与竞态分析**

- 轮次结束后才到的旧工具调用：文件已删，报 MISSING_TOKEN。若旧调用已读到 token，也会遇到撤销和 Kernel scope 两道拒绝。撤销与授权都在事务里，是线性化的。
- 并发两轮：lane 和唯一索引排除了这种可能。
- **残留风险**：第 N 轮的后台子进程（如 Claude `run_in_background`、Codex 的常驻 exec 会话）在第 N+1 轮再调 Worker CLI，会读到新 token，以同一实例身份在新 Activation 范围内行事。身份不跨实例，`basedOnRoomSeq` 的陈旧保护依然有效，但提交会被归到错误的轮次。
- **方案 B（更严，待 owner 决定）：本地凭据代理 socket。** Worker CLI 连 unix socket，代理用 `LOCAL_PEERPID` 取调用方 pid，沿 ppid 链上溯到 CLI 根进程。链上除 CLI 根进程和登记过的常驻 helper 外，任何祖先的启动时间早于本轮开始，就拒绝。macOS 可行性待验证。

**Raft 对照**：Raft 按每次启动签发凭据，常驻期间一直有效，idle 也能用。我们必须更严：合同要求凭据按轮签发与撤销，且 Activation 的 toSeq/ACK 语义要求授权绑定到具体轮次。

## 3. 各驱动方案

统一结构：Host → 驱动进程（热进程的监督者，进程组组长，argv 带 `--loom-runtime-id=<id>`）→ CLI 子进程 → 工具子进程。驱动从"一轮后退出"改为循环，Host 通过 stdin 下发 `turn.begin / turn.steer / turn.interrupt / drain`，驱动经 fd3 回报 `ready{sessionId} / turn.started{id} / turn.quiesced{id,status} / progress / rss`。原有的 usage、session 证据、接收帧不变。驱动在 stdin EOF 或父进程消失时自行退出。

| CLI              | 进程与传输                                                                                                                                                                                  | 轮次边界                                                                                          | 忙时 Human                       | 已验证 / 待验证                                                                                                                                          |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex 0.156.1    | 每实例一个 `codex app-server --listen unix://<0700目录>/sock`，不用共享 daemon，这样每实例的 env/cwd/凭据路径各自隔离。启动时 `thread/resume` 一次，之后每个 Activation 发一次 `turn/start` | `turn/completed`，turn id 与本轮一致                                                              | `turn/steer`（`expectedTurnId`） | 已验证：`--listen unix://`、TUI `--remote unix://PATH`（help 文本）、steer、turn 身份核对。待验证：unix 传输的实际表现；长连接期间 30 min 线程卸载不触发 |
| OpenCode 1.18.32 | 每实例一个 `opencode serve`（沿用已有 basic auth），持久 SSE `/event`；每轮 `prompt_async`                                                                                                  | 本 session 的 `session.idle`，且没有 running 的工具部件；SSE 断线后用 `/session/:id/message` 对账 | 等待（无已验证的 steer）         | 已验证：serve、SSE、idle、abort。待验证：长连 SSE 的稳定性、prompt_async 在忙时的行为                                                                    |
| Claude 2.1.281   | 常驻 `claude -p --input-format stream-json --output-format stream-json --resume <id>`，收到 result 后不关 stdin                                                                             | `result` 帧，且已写入的输入数等于 result 数                                                       | direct：写入原生队列             | 已验证：stream-json、result 帧、中断的 result。待验证：多轮 stdin 的长驻表现、忙时写入与 result 的计数、运行中切换模型。没有 TUI                         |
| Kimi 0.39.1      | 常驻 `kimi acp`，启动时 `session/resume` 一次，每轮发 `session/prompt`                                                                                                                      | `session/prompt` 响应中的 stopReason                                                              | 等待                             | 已验证：ACP 的 resume、prompt、cancel。待验证：长驻内存；system 层是否在 resume 后生效（已知 P1）                                                        |

## 4. 策略与默认值

- **空闲回收**：TTL 30 min，从最后一轮结束或 TUI 分离时起算。busy、draining、TUI 挂载期间不计时。
- **边界重启**：只在 idle 且下一轮开始前检查。条件是进程组 RSS 合计 > 2 GiB、存活 > 12 h、CLI 指纹变化（realpath+size+mtime）或 Role 快照需要重启的变更。先 drain，再冷启动并 resume。
- **全局上限**：软上限 12 个热进程，超出时按 LRU 淘汰 idle 的；busy 不淘汰。硬上限 20 个同时 busy，超出则排队。
- **启动闸门**：沿用 `AgentStartGate`（5 并发 / 500 ms），只作用于 cold→starting；idle→busy 不经过闸门。
- **卡死判定**：连续 15 min 无进展（无 provider 帧、trajectory 或工具输出）判为卡死，依次 interrupt → 杀进程组，RunAttempt 记为 failed(stalled)，Activation 重试。`runTimeoutMs` 从总时长改为按无进展计。
- **清理**：只按进程组清理。启动时的 janitor 扫描本 host 旧代数中非 terminated 的记录，argv 标签吻合才杀，然后记录证明；再扫描 `ps` 中带标签但未知的孤儿。
- **崩溃恢复**：idle 时崩溃，记 terminated(crash)，不报警，下条消息到来时冷启动并按 session id resume。busy 时崩溃，本轮 failed，Activation 按既有策略重试。resume 失败时走合同 §3 的故障恢复，永不静默换新 session。
- **实例移除或 session 重置**：先 drain，再终止进程，之后才推进 session 代数。

## 5. 可选 TUI 挂载（Codex / OpenCode）

- **Kernel 单写者租约**：`instance_runtimes.tui_lease_{owner,until}`，只能由 Human 发起，靠心跳续期。租约持有期间，频道投递暂停（Activation 保持 queued、不启动），同时暂停空闲回收和边界重启；私聊仍排队。
- **不跨写**：挂载只允许在 idle 时开始。如果 TUI 正在进行一轮，Loom 不向实例投递。
- **启动命令**：Codex 为 `codex --remote unix://<sock> resume <threadId>`，OpenCode 为 `opencode attach <url> --session <id> -p <pw>`。
- **TUI 轮次的定位**：TUI 中发起的轮次没有 Worker 凭据，属于诊断，不记为 RunAttempt，也不能向频道发帖（待 owner 确认）。
- **herdr 作为可选桌面层**：Loom 通过 `pane.run` 打开 TUI，用 `pane.report_agent` 推送权威状态。herdr 不是依赖。

## 6. 纵向切片

| 子项     | 内容                                                                                                                                          | 关键验收（fake CLI、fake 时钟、临时 DB）                                                                                                                                                                                                                                                                                           | 付费门禁                                                     |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **S2-a** | Codex 热进程、`instance_runtimes`、turn.json 凭据、`recordTurnQuiesced`、最简 30 min TTL、进程组清理、控制台显示进程状态                      | 连续 3 个 Activation 只启动 1 次，thread 相同；每轮一条 RunAttempt，proof=turn_quiesced；ACK 不到 toSeq 不完成；idle 期间凭据文件不存在、旧 token 被拒；轮次结束后旧工具调用被拒；取消→interrupt→进程存活；interrupt 超时→杀组+process_exit；busy 时崩溃→下次 resume 同一 thread；Human steer 与私聊不 steer；daemon 退出→驱动自退 | 可选：Codex 小冒烟（1 session 3 轮，看续聊延迟），需单独授权 |
| **S2-b** | LRU 上限、边界重启、无进展卡死、janitor、闸门复用                                                                                             | 各阈值触发只发生在边界；busy 与 TUI 期间不回收；PID 复用时标签不符则不杀；上限满时排队                                                                                                                                                                                                                                             | 无                                                           |
| **S2-c** | OpenCode、Claude、Kimi 热驱动                                                                                                                 | 同 S2-a 的矩阵，外加各家边界事件与 SSE 断线对账                                                                                                                                                                                                                                                                                    | 无                                                           |
| **S2-d** | 上下文窗口占用与压缩次数的采集和展示（Codex token-usage/compaction item、Claude compact_boundary、OpenCode tokens/compaction，Kimi 显示未知） | 缺数据时显示"未知"，不做推算                                                                                                                                                                                                                                                                                                       | **S2 正式效率门禁**：四个运行时，按合同 §6，含首轮延迟       |
| **S2-e** | TUI 挂载与租约、herdr（可选）                                                                                                                 | 租约期间不投递、不回收；租约过期可恢复                                                                                                                                                                                                                                                                                             | 可选人工验收                                                 |

## 7. 风险与待 owner 决定

1. 凭据方案：先 A 后 B，还是 S2-a 直接做 B？A 的残留风险是后台子进程跨轮次。
2. 默认值：软 12 / 硬 20、RSS 2 GiB、12 h 是否合适（取决于机器内存）。
3. TUI 轮次是否允许发帖。若允许，需要新增"Human 挂载凭据"类型。
4. OpenCode 冷启动约 480 ms，常驻带来的收益主要是 TUI 与 SSE 连续性。Raft 保持按轮启动。是否仍常驻？
5. 已知泄漏（Claude idle RSS、Codex MCP helper）靠边界重启兜底。两次轮次之间若长时间 busy 无法回收，只能依赖卡死判定。
6. 平台协议升级不会进入已续聊 session（P1），常驻进程也修不了。是否在协议版本变化时要求 Human 显式重置？
7. daemon 重启后不重新接管热进程，全部冷启动。unix socket 以后可以支持重新接管，本期延后。
