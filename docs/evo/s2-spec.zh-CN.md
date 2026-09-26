# S2 施工规格（修订稿 r2，待 owner 签字）：每实例一个热进程（合同 §6a）

日期 2026-09-24。依据：target-contract §6a、AGENTS.md 不变量、独立审查 `~/.loom/reviews/2026-09-24-s2-spec-review.md`（本稿逐条吸收其 P1/P2 与建议）。本页只是设计，未改代码。行号以 `evo@92db2fb` 为准。

## 1. 记录归属与两种证明

实例进程状态：`cold → starting → idle ⇄ busy → draining → terminated`，terminated 带原因 `idle_ttl | lru | recycle_rss | recycle_age | cli_changed | config_restart | crash | stall | resource_failure | removed | host_shutdown`。

| 记录                                   | 归属与语义                                                                                                                                                                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **新表 `instance_runtimes`**（Kernel） | 一行 = 一个热进程的完整寿命：participant、host 及 host 代数（`agent_hosts.instance_id`）、driver、pid/pgid 与**出生时间**、runtimeId、CLI 指纹、状态、`current_run_attempt_id`、资源快照、退出码/信号。部分唯一索引：每 participant 至多一行非 terminated。**它独占**：Host 换代、崩溃、物理退出、资源统计与 janitor 职责 |
| RunAttempt                             | 一轮一条，新增 `instance_runtime_id`、`native_turn_ref`；结束后不改写                                                                                                                                                                                                                                                     |
| `runtime_processes`                    | 仍与 RunAttempt 一对一，语义改为"本轮执行记录"。新增 `proof_kind`、`quiesce_result`、`close_seq`、`closed_at`。state 仍写 `terminated`，但**所有读退出码或物理死亡的读者必须按 proof_kind 分支**（下表）                                                                                                                  |

**证明定义**：

- `process_exit`：物理进程结束，带真实 exit_code/signal。
- `turn_quiesced`：该轮已不能再执行任何授权操作；带原生/适配器轮次身份、`quiesce_result ∈ {success, error, cancelled}`、封闭帧序号与时间；**进程仍活，exit_code/signal 为 NULL，不填 0**。quiesced 本身不 ACK、不完成 Task、不证明答复成功；完成 Activation 仍要求 delivery ACK ≥ toSeq 及既有 obligation/first-run 条件。

**依赖退出/物理死亡的读者与分支**：

| 读者                                                                                    | 现依赖                                          | S2 分支                                                                                                                                                                      |
| --------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#recoverExpiredTerminalProofActivation` room-kernel.ts:6654–6678                       | `exit_code===0 ? exited : failed`               | quiesced 按 `quiesce_result` 映射 exited/failed/cancelled，退出列保持 NULL                                                                                                   |
| `finishRunAttempt` 4137–4170、`retryActivation` 4905、`completeActivation` 5034         | 本轮记录 terminated                             | 两种证明都满足；finish 的 state 由 Host 按 quiesce_result 给出，不再由退出码推断                                                                                             |
| `#releasePlacementResources` 5710–5720                                                  | 无非 terminated 记录才释放                      | 只释放轮次级 placement；进程槽与 RSS 统计改由 `instance_runtimes` 在 runtime terminated 时释放                                                                               |
| `#quarantineExpiredActiveRuns` 6515–6650、`#reconcileUnownedRuntimeProcesses` 6305–6395 | 租约过期 + 非 terminated → quarantine、orphaned | busy 轮沿用；同时把 runtime 行置 `suspect`，该 participant 禁止新执行，直至 Host 杀掉经身份核验的进程组并记 process_exit。idle 热进程不在这些扫描中，由 runtime janitor 负责 |
| `#reconcileProvenActivationQuarantines` 6396–6428                                       | 全部本轮记录 terminated 即解除                  | 解除 quarantine 不等于允许新执行；新执行另需 runtime 行非 suspect                                                                                                            |
| `leaseNextRuntimeRecovery` 4252–4300                                                    | 按本轮记录的 recovery 描述恢复孤儿              | 热进程孤儿的恢复对象改为 runtime 行：核验身份→杀组→本轮记 process_exit、runtime terminated(crash)                                                                            |
| AgentHost agent-host.ts:664（reap）、889–927（退出→proof→finish；非 0 重试）、1118–1138 | 等 RunExit                                      | 热路径等 `TurnOutcome = quiesced{result} \| runtimeExit`；重试决策按 result，不按退出码；proof 失败仍走 `#recordTerminationOrQuarantine` 的隔离语义                          |
| generic-process-adapter.ts:962–975（close→释放环境、finish 采集）、1064–1065、1127–1130 | child close                                     | 拆为轮次级（quiesce 时释放轮次环境、关闭本轮采集，允许 release 轮次句柄）与 runtime 级（close 时）                                                                           |

**Worker 授权入口更正**：签发走 `authorizeWorkerExecution` 4523–4545 → `#assertWorkerGrantScope` 5939–5991（Activation leased 且租约有效、RunAttempt 为 starting/running，**不查进程**）+ host 代数；每次请求走 `#requireAuthenticatedWorkerExecution` 5903–5936 → `#assertWorkerExecutionScope` 5993–6011（starting+prepared 或 running+active 且 runtime_run_id 吻合）。所以 quiesce 提交后，本轮每个 Worker 请求都在执行检查处被拒（即使撤销失败）。签发处新增一条：runtime 行 busy 且 `current_run_attempt_id` 为本轮。

## 2. 常驻通道上的轮次协议

**帧信封**：每个业务相关帧（接收回执、usage、session 证据、工具/审批、结束）带 `runtimeId + hostGeneration + runAttemptId + 原生 sessionId + 原生 turn/RPC/input id + 驱动帧序号`。无法归属唯一一轮的帧记为 unknown 诊断，绝不归到"当前轮"。

**轮次状态**：`started`（Host 下发 turn.begin，lane 已持有）→ `accepted`（原生确认，拿到原生 id）→ `closing`（观察到与本轮 id 匹配的原生结束，或 interrupt 已发）→ `quiesced`。

**收尾顺序**（一步失败按下面的恢复表处理，不跳步）：

1. 进入 closing 时原子关闭 admission：此后 Human 新消息进入 Inbox 形成后续 Activation，不再写原生通道。
2. 边界 steer：closing 前已获原生接受（Codex steer 响应成功、Claude 回放出该输入）的属于本轮并由证明覆盖；未获接受或被原生拒绝（Codex `expectedTurnId` 不符）的留在 Inbox，不悬空。
3. 工具/审批：按驱动检查无在途项（§4）。
4. 证据排空：驱动发 `turn.drained{id,lastFrameSeq}`，Host 把 ≤lastFrameSeq 的帧入账本轮后关闭采集；此后到达的本轮帧只进诊断，并把本轮 usage 标为不完整，不计入下一轮。
5. 撤销本轮凭据，删除本轮目录（§3）。
6. 事务提交 `recordTurnQuiesced`：runtime busy 且当前轮吻合、host 代数吻合、结束帧 id 吻合、进程组经 pid+出生时间核验仍在。`kill(-pgid,0)` 只说明组存在，不证明工具完成，第 3–4 步才是。
7. `finishRunAttempt` → `completeActivation`，或按既有规则重试/停放。
8. Activation 离开 leased 后，runtime 置 idle、清空当前轮，lane 才释放。

**崩溃落点恢复**：

| 落点                            | 恢复                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 撤销失败                        | 记诊断并后台重试撤销；继续 quiesce，执行检查已封住本轮。重试耗尽则杀组、记 process_exit                                    |
| 删除失败                        | token 已撤销、执行已封；记诊断，janitor 按 runtimeId 清目录，不阻塞                                                        |
| quiesce 已持久化、finish 前崩溃 | 租约过期走 6654 的 quiesced 分支补记 RunAttempt；ACK 已覆盖 toSeq 的完成、不重跑；旧代数 runtime 行交 janitor 杀组，不接管 |
| finish 后、complete 前崩溃      | 沿用租约过期路径：ACK 覆盖 toSeq 的完成，否则按预算重试。S2-0 须用测试确认现有路径确实如此                                 |
| busy 中 Host 换代               | 本轮记录 orphaned（现有），runtime 行 suspect；新 Host 先杀经核验的组，再允许该 participant 新执行                         |
| quiesce 后进程死亡              | 只在 runtime 行追加 terminated(crash) 与退出信息，已封闭的 RunAttempt 与证明不改写                                         |

## 3. 轮次授权：方案 C（主选）

不变量：**旧工具不因新一轮开始而自动获得新能力。**

- **每轮唯一路径**：沿用 `worker-credential-file.ts:22` 起的每 Activation 唯一目录，改放在 `<cred>/turns/<handle>/`，`handle` 为 128 位随机 base64url。父目录 `turns/` 设为 **0300**（可进入、不可列出），token 文件 0600。子进程环境只保留稳定项：API origin、`RAH_WORKER_TURN_ROOT`、`RAH_PARTICIPANT_ID/HOST_ID`；`RAH_ACTIVATION_ID/RUN_ATTEMPT_ID/FROM_SEQ/TO_SEQ` 等每轮围栏（`launch-environment-policy.ts:31–61`）从子进程环境移除。
- **显式传递**：handle 写入本轮输入文本，Worker CLI 要求 `--turn <handle>`，缺省即报 `TURN_HANDLE_REQUIRED`。有带正文唤醒的驱动（目前仅 Codex，`bodied-wake.ts:27`）写在唤醒正文里；Claude/Kimi/OpenCode 在各自 S2-c 前仍用固定唤醒，但它们每轮的输入文本同样由 Host 组装，handle 附在其中，不依赖带正文唤醒。
- **幂等键**：`worker-cli.ts:703` 读的 `RAH_RUN_ATTEMPT_ID` 改为读同目录的 `scope.json`；`worker-startup-context.ts:17` 同步修改。
- **效果**：第 N 轮后台进程只知道 N 的 handle，N 结束时已撤销删除；N+1 的 handle 只出现在 N+1 的模型输入里，不可列目录，也猜不到。模型把旧 handle 写进脚本，也只拿到已失效的 N。
- **模型沿用历史中的旧 handle**：文件不存在 → `TURN_HANDLE_INACTIVE`，提示"使用最新唤醒中的 handle"。只在出错时给提示，不写进常驻提示词。
- **成本**：唤醒约 +15 token，每次 Worker 调用约 +12 token；handle 会进入原生 transcript，但轮后失效，暴露窗口限于本轮。
- **轮中压缩丢失 handle**：不提供 `whoami --current`。调用方无法证明自己属于当前轮，除非出示 handle 本身，这是循环论证，任何能查到当前 handle 的接口都会把新权限交给旧进程。改为 Host 观察到本轮原生压缩事件（Codex compaction item、Claude `compact_boundary`）后，经原生轮内输入重述 handle（Codex `turn/steer`+expectedTurnId；Claude 带 uuid 的 stream 输入）。Kimi/OpenCode 未验证轮内注入：丢失时模型无法发帖，Activation 未 ACK，按预算以新 handle 重试。
- **诚实边界**：C 防的是遗留工具、helper 与模型混淆造成的**无意**跨轮授权；同 UID 恶意代码可以 chmod 或读 Host 凭据，不在此保证内，与现有威胁模型一致。
- **方案 A** 只保留为文件传输细节：O_EXCL/O_NOFOLLOW、0600、owner/大小/类型校验（`worker-cli.ts:1801–1840`）、日志脱敏。它不是授权来源。
- **方案 B**（peer-pid 代理）作为可选纵深防御。SDK `sys/un.h:89,93` 有 `LOCAL_PEERPID/LOCAL_PEERTOKEN`，但存在 ppid 重挂、PID 复用、helper 例外绕过、合法调用误拒、fd 传递等问题，须先做无模型原型，不作为强授权。
- **按轮注入环境（2026-09-24 本机核实）**：Codex 0.156.1 `generate-json-schema` 的 `TurnStartParams` **没有 env 字段**，`environments` 指 exec-server 环境（id/cwd），`config/value/write` 写的是 config.toml（持久且全局），均不可用 → **Codex 不支持**。Kimi 驱动自己执行 ACP `terminal/create`（`kimi-acp-driver.mjs:415,528–550`），可按轮注入 env，但 Kimi 的 shell 是否全走 ACP terminal **未验证**。Claude、OpenCode **未验证**。C 不依赖按轮 env。
- **规则**：某驱动若不能证明"handle 经本轮输入送达 + 压缩后重述或安全失败 + 本轮工具在边界关闭或已知"，该驱动在每轮边界**冷回收**并按 session resume。

## 4. 各驱动边界

统一结构：Host → 驱动进程（进程组组长，argv 带 `--loom-runtime-id`）→ CLI → 工具。Host 经 stdin 下发 `turn.begin/steer/interrupt/drain`，驱动经 fd3 回报 `ready / turn.accepted / turn.closing / turn.drained / turn.quiesced / progress / rss`，均带 §2 信封。

| CLI              | 路线                                                              | 必须证明的边界                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex 0.156.1    | 每实例 `app-server --listen unix://`，同 thread 每轮 `turn/start` | 当前驱动用 stdin JSON 帧（`codex-app-server-driver.mjs:350–390,444–447`），unix 传输要新写分帧并验证；每轮重置单轮变量、拒绝旧回执。`turn/start` 带 `clientUserMessageId`（schema 已核实）用于关联。断连不代表未执行：重连后用 `thread/turns/list` 对账，**禁止盲重发**。thread 卸载（schema 有 `thread/closed`、`thread/loaded/list`）：进程活而 thread 不在内存时先 `thread/resume` 同 id；长连接不防卸载，属待验证。`thread/backgroundTerminals/list/clean` 存在于 schema，行为未验证，是边界关闭工具的候选 |
| Claude 2.1.281   | 常驻 stream-json，不关 stdin                                      | 当前在首个 result 关闭 stdin（`claude-stream-json-driver.mjs:230–259`），不关后必须用别的方式提供输入封闭。每个输入带 uuid，配合 `--replay-user-messages`（help 已核实，回放是否带 uuid 未验证）关联输入与 result；result 计数相等只是必要条件。关闭 admission 与接受忙时输入要原子。取消后若原生队列仍有未消费输入，**回收 runtime**，这些消息经 Inbox 重投，不流入下一 Activation                                                                                                                            |
| Kimi 0.39.1      | 常驻 `kimi acp`，每轮 `session/prompt`                            | 不假设通用 turn id：用 session + JSON-RPC request id + Loom runAttemptId。stopReason 区分 success/cancelled/error。本轮创建的 ACP terminal 在 quiesce 前退出或被杀（现为轮后退出时清理，`kimi-acp-driver.mjs:213–234,550–608`）                                                                                                                                                                                                                                                                                |
| OpenCode 1.18.32 | 每实例 `serve` + 持久 SSE，每轮 `prompt_async`                    | 按输入 message ID 关联完成；`session.idle` 只有 session 级身份，旧 idle 或重连重播不能结束新 prompt，完成信号要经本轮范围核验（现 `opencode-server-driver.mjs:325–365` 的完成判定与投影不是同一检查）。HTTP 接受只证明已接受。SSE 断线后用 `/session/:id/message` 对账，**禁止盲重发**                                                                                                                                                                                                                         |

## 5. 跨驱动

- **模型/effort**：每轮接受时冻结到 RunAttempt。原生支持就按轮下发（Codex `turn/start` 的 model/effort 是粘性的，每轮显式传）；不支持就在 idle 时重启并 resume 同 session。Role 新 revision 不自动替换实例冻结快照。
- **环境租约拆分**：runtime 级（记忆物化快照、provider 配置、cwd、稳定脱敏项、CLI 指纹）在启动时建立；轮次级（handle 目录、本轮脱敏项、唤醒正文、幂等范围）每轮建立。
- **用量**：从 S2-a 起按轮归属并带完整性标记（依 §2 第 4 步）；缺数据显示"未知"。
- **压缩计数**：按原生 session 以原生事件 id 去重；热进程重启或 `thread/resume` 回放不清零，也不重复计数。

## 6. 策略（默认值均可配置，是初始值，不是性能保证）

- **空闲回收**：TTL 30 min，busy/draining/TUI 期间不计时。
- **边界重启**：只在 idle 时，条件为 RSS > 2 GiB、存活 > 12 h、CLI 指纹变化、配置需要重启。
- **上限**：软上限 12 个热进程（idle 按 LRU 淘汰）；硬上限 20 个 busy（admission 上限，超出排队），等待容量时不无限期占着 Activation 租约。启动闸门 `AgentStartGate` 只管 cold→starting。
- **卡死**：四类信号分开计：传输活性（心跳/keepalive，只用于重连诊断）、原生轮次进展（仅业务 item/delta）、工具运行（单独超时）、等待审批（不计入卡死，展示给 Human）。keepalive、状态重播、RSS 心跳都不算进展。无进展默认 15 min，属操作策略，不是模型故障证据。重试预算默认 1 次。旧轮封闭（quiesced 或 process_exit）前不得重试。已 ACK/发帖的，不重新执行已完成义务。
- **忙时 RSS**：超限只告警并停止向该 runtime admission，边界再重启，不做例行回收。OOM 等紧急情况走显式 `resource_failure`：杀组、process_exit、RunAttempt failed(resource)、计入重试预算。
- **清理**：只按进程组清理；脱离进程组的后代不承诺清理。CLI 根进程退出但组内仍有进程时，仍完成组清理。
- **daemon 重启**：不接管，全部冷启动。新执行前必须先确认旧 runtime 已终止。未知的带标签进程要核对 UID、Host 范围、DB 中的 runtimeId、PID 出生时间；不确定就隔离并报告，禁止该 participant 新执行。argv 标签不是身份凭证。
- **崩溃**：idle 崩溃记 terminated(crash)，下条消息到来时冷启动并 resume。resume 失败走合同 §3，永不静默换新 session。实例移除或 session 重置：先 drain，再终止，之后才推进代数。
- **协议升级**：记录实例已生效的协议版本。兼容变化在下一轮用带版本的更新传达并留接收证据；不兼容变化阻止新工作，给 Human 重置/恢复选择。另行小设计，不在 S2 内做。

## 6a. 遗留进程与资源（owner 2026-09-24 硬性要求，常驻与冷回收同样适用）

owner 决定：证明不了轮次隔离的驱动每轮冷回收（选项 A）。同时不能接受"进程关了，子孙还在内存里、占着端口，没人处理"——一次性模式同样有此问题（Raft 只对进程组 SIGTERM，`nohup`/`setsid`/双重 fork 脱组的子进程会被系统收养）。

1. **标签**：驱动启动的每棵进程树继承 `LOOM_RUNTIME_ID`、`LOOM_RUN_ID`；清扫时核对 UID、标签与进程出生时间，防 PID 复用误杀；不确定则隔离报告，不凭名字杀。
2. **原生清理优先**：Codex `thread/backgroundTerminals/list|clean`（schema 已见，行为待验证）；Kimi 终端由驱动持有、按轮清理；Claude 后台 shell、OpenCode 任务逐家验证。
3. **进程组与会话**：kill 进程组、会话及可找到的全部带标签子孙。
4. **清扫**：每轮结束、回收、实例移除/重置、daemon 启动时，扫描"带标签但所属运行时已不存活"的进程，SIGTERM → SIGKILL；用 `lsof` 查这些进程占用的监听端口并一并清理；结果写入 Kernel（每轮遗留数、清理数、残留数）。
5. **可见**：清理确实杀掉进程或释放端口时，下一轮唤醒中告知模型（如"上一轮后台启动的 dev server（端口 3000）已被清理"）；控制台显示。
6. **上限与告警**：每实例进程数、RSS 合计、监听端口数设阈值（可配置）；超限则停止接新工作并告警，不允许无上限增长。
7. **默认规则**：进程关闭（冷回收、空闲回收、崩溃、重置、实例移除）时，其全部子孙一律清理，不保留任何东西。常驻期间上一轮后台任务可继续运行，但不获得新轮授权（方案 C），并计入上限。有意保留的长期服务须以显式声明的"服务"形式存在，不在 S2 范围。
8. **已实现（S2-0）与局限**：见 status 第八节；macOS 隐藏 Apple 平台二进制的环境变量，清空环境且无带标签祖先的脱组进程可能漏扫，靠进程组/祖先链与上限告警兜底。
9. **验收**：fake CLI 生成脱组的 `setsid`/`nohup` 子进程与监听端口，验证冷回收、空闲回收、崩溃、daemon 重启后均被清理且有记录；PID 复用场景不误杀；清理失败时停止新执行并告警。现行 evo（每轮一次性）同样补上此清扫，作为 S2-0 的一部分。

## 7. TUI 挂载（S2-e，延后、独立验收）

- Kernel 租约只约束 Loom 调度，约束不了直连 socket/HTTP 的 TUI。租约过期 ≠ 原生写者失效。恢复投递前必须二选一：证明已撤销客户端写入口；或确认原生轮次已结束，并断开/回收该 runtime 后再 resume。须覆盖挂载建立中、附着失败与新 Activation 同时到达的竞争。
- S2 中 TUI 轮次**不能发帖**。它们仍是工作，不是诊断：会改 session 和文件、产生费用，须记录挂载审计、成本、session 与文件变更归属。以后若要发帖，须设计显式的工作范围，不签无限期的 Human 万能 token。
- 命令：Codex `codex --remote unix://<sock> resume <threadId>`，OpenCode `opencode attach … --session <id>`。herdr 仅作可选桌面层。

## 8. 纵向切片

| 子项     | 内容                                                                                                                                                                                          | 门禁                              |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **S2-0** | 短设计收口：证明类型与读者分支（§1）、方案 C 与目录权限、采集排空、Host 换代/崩溃表（§2）；每条落为失败测试                                                                                   | 无                                |
| **S2-a** | 只做 Codex：3 轮、取消、同 session 重启、最小孤儿/Host 换代围栏、逐轮用量与完整性、控制台显示状态                                                                                             | fake 驱动（不能证明原生多轮协议） |
| 证据关口 | Codex 小型真实冒烟（1 session 3 轮 + 取消 + 重启 resume），扩展 S2-c 前必须通过                                                                                                               | **需另行授权**，本次不运行        |
| **S2-b** | LRU、边界重启、卡死四信号与重试预算、janitor、resource_failure                                                                                                                                | 无                                |
| **S2-c** | 逐家接入 OpenCode、Claude、Kimi，各自验证 ID、取消、工具残留、断连；证明不了 §3 规则的走冷回收                                                                                                | 无                                |
| **S2-d** | 上下文占用与压缩的展示；S2 正式效率门禁（四运行时，按合同 §6）：比较冷首轮/热续聊/TTL 后 resume，锁定模型/effort/材料/历史，报告业务与协议生成次数、完整 tokens、首回复与整轮延迟、语义连续性 | 付费门禁                          |
| **S2-e** | TUI（§7）                                                                                                                                                                                     | 可选人工验收                      |

**必须覆盖的交错场景**（fake 时钟、临时 DB）：

1. 第 N 轮的后台工具在 N+1 切换频道/私聊后调用 Worker：拿不到新授权（不能只测 idle 时文件不存在）。
2. 撤销失败、删除失败、quiesce 后 finish 前崩溃、finish 后 complete 前崩溃：各自可恢复，不重复执行已完成义务。
3. 结束帧、usage、接收回执乱序/重复/迟到：N 的帧在 N+1 时到达不污染新轮。
4. Human steer 恰与结束帧同时到达：要么归 N 且由证明覆盖，要么排队，不悬空。
5. quiesced 但 ACK/obligation 未满足：不完成 Activation；下一工作不越过旧 lane 的停放/恢复。
6. idle 崩溃、Host 换代、PID 复用、组长退出但工具仍活、旧 runtime 清理不确定：禁止新执行。
7. Codex thread 卸载、OpenCode 重连后的旧 idle、Claude 多输入多 result、Kimi prompt 返回时 terminal 仍活。
8. 旧 handle 重用 → `TURN_HANDLE_INACTIVE`；轮中压缩后重述 handle，或安全失败并重试。

**证据关口实际状态（2026-09-25，批次 4 核对，如实记录，无负责人豁免）：**

| 关口                                                                        | 状态     | 原因 / 现有证据                                                                                                                                                                                                                                           |
| --------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex 小型真实冒烟（1 session 3 轮 + 取消 + 重启 resume），扩展 S2-c 前通过 | 未满足   | 未获单独授权运行。已有真实证据只覆盖多轮与压缩（S2-a 冷热对比常驻组不重启；漂移 20 轮常驻），热模式取消、首轮中断、热模式 daemon 重启续聊均无样本。S2-c 在关口未满足时已完成，Codex/OpenCode 常驻已默认开启（status 第二十四节）；没有豁免记录            |
| 每个 S2-c 切片后漂移门禁与效率门禁各复测一次（§11）                         | 部分     | 漂移：Claude Haiku、Kimi、OpenCode 各有样本（status 第十三、十八、二十二、二十三节）。效率：Claude、Kimi 从未付费运行；OpenCode 原生对照臂批次 4 才补代码，未运行                                                                                         |
| 控制台显示状态（S2-a，合同 §8“控制台可见”）                                 | 部分满足 | 临时控制台 `apps/console`（status 第四十四–四十六节，phase 4 删除）显示实例状态、排队、看门狗告警、用量汇总与 RunAttempt 下钻（冷/热、`sessionResumeMs`、final 收尾、上下文占用仅 Codex 有值）；只有 fake 浏览器门禁验证，无真实 CLI 样本；压缩次数未展示 |
| S2-d 上下文占用与压缩的展示、四运行时正式效率门禁                           | 未满足   | 数据已入库（Codex 有上下文窗口，其他为空；压缩次数在 session 绑定）；上下文占用已在临时控制台 RunAttempt 下钻展示（status 第四十六节），压缩次数未展示；正式效率门禁未运行                                                                                |

## 9. 待 owner 决定

1. 默认值：TTL 30 min、软 12/硬 20、RSS 2 GiB、12 h、无进展 15 min、重试预算 1。作为可配置初始值是否接受？
2. Claude/Kimi/OpenCode 若证明不了 §3 规则（尤其是压缩后重述与工具关闭），是否接受该驱动逐轮冷回收（失去 §6a 常驻收益，但保持同 session）？
3. Kimi/OpenCode 轮中压缩丢 handle 时"本轮无法发帖→重试"的额外成本是否可接受？
4. Codex 真实冒烟关口的授权时机。

## 10. S2-a 实施记录

- Codex `--listen unix://` 实为 unix socket 上的 WebSocket（本机 0.156.1 探针确认）。
- `turn/start` 被拒绝时以 `nativeTurnId: null` 的 quiesce 记录收尾。
- 轮次成孤儿时由 Kernel 触发器把忙碌运行时标记为 suspect。
- 热模式原默认关闭；2026-09-25 第八轮审查修复后负责人同意 Codex 与 OpenCode 常驻默认开启（`warmRuntimes.codex.enabled` / `warmRuntimes.opencode.enabled` 缺省为开，显式 `false` 关闭），Claude 常驻仍需显式 `warmRuntimes.claude.enabled: true`，Kimi 不做常驻。

## 11. S2-c 逐家接入计划（2026-09-25）

每家一个纵向切片，顺序 Claude → Kimi → OpenCode；每个切片完成后用漂移门禁与效率门禁各复测一次（便宜模型）。每家都要落实五件事：

| 项                                | Claude                                                                                                | Kimi                                                                                                                              | OpenCode                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 带正文唤醒的可靠接收信号          | `--replay-user-messages` 回显 + 本轮正文摘要核对（须验证续聊历史回放不会误认）                        | `session/prompt` 请求 id 的终态响应（迟到证明）；若有更早的回显事件再评估                                                         | 自选 user messageID 落库/回显或 assistant.parentID 指向该输入                       |
| 精简唤醒 + `--final` 立即结束本轮 | stream-json `control_request` interrupt                                                               | ACP `session/cancel`                                                                                                              | `POST /session/:id/abort`                                                           |
| 规则放置（压缩不丢）              | 保持 `--append-system-prompt-file`；协议变更需压缩或新 session 才生效（已有"Protocol updated"行兜底） | ACP 无法设置 system：压缩后在下一轮唤醒前加规则卡（每次压缩后都加，按压缩事件去重）；后续评估改 `--wire/--print` + `--agent-file` | 规则移入实例专属 agent prompt/instructions；处理自动插入的无 system "Continue" 步骤 |
| 常驻或冷回收                      | 常驻 stream-json（方案 C 句柄在唤醒正文中，与传输无关）；证明不了隔离则冷回收                         | 常驻 ACP；同上                                                                                                                    | 常驻 serve；同上                                                                    |
| 用量                              | 已有（S1-a）                                                                                          | 无逐次用量（ACP 不提供），记为未知                                                                                                | 已有（S1-a）                                                                        |
