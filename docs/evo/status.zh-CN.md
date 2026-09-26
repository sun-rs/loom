# evo 分支现状（阶段 1 清理后）

日期：2026-09-24。本页是 evo 相对 `main`（`milestone-ui-raft` = `f1bc8c9`：5122795 加测试修复，全量检查通过）的唯一差异说明。
`docs/architecture`、`docs/product` 中的 owner 文档描述的是 main 基线；冲突时以目标合同为准，本页记录差异，代码只证明当前实际行为。
evo 的目标合同见 [target-contract](target-contract.zh-CN.md)（owner 2026-09-24 已签），效率门禁合同见 [cli-efficiency-gate](../design/cli-efficiency-gate.zh-CN.md)。

## 分支与环境

- `main`：冻结的 UI 里程碑，只接受紧急修复。worktree `~/Code/repos/loom-main`，当前不运行。
- `evo`：新后端开发线。前端产品代码（`apps/web/src`、`packages/ui-web`、`packages/ui-tokens/specs`）与 main 一致，本阶段不改前端；测试文件只在 main 先修正的范围内可能不同。
- `ref/role-ui-draft`（= `789ffc6`）：Codex 9/21–9/23 的完整检查点，含 Role 前端草稿、全部审计文档与证据，仅作参考。
- 本地 evo 服务：端口 4176，launchd `com.loom.evo`，数据 `~/.loom/evo`。数据目录与路径绑定（挂载回执存绝对路径），不要搬迁。
- 旧正式环境（`~/.rah`、4173）已按 owner 决定退役，不再兼容旧数据。

## evo 代码相对 main 的改动

### 一、9/21 调度修复（schema 58）

- `worker-message-projection.ts`：message check 不再返回 18 类执行审计事件。
- `worker_message_presentations`：按消息的精确展示回执，替代高水位，用于忙时通知和"已展示"标注。
- 启动上下文瘦身为身份和范围（manifest 校验但不回显）。
- MEMORY.md 通过 `--prompt-file` 进入 Claude/Codex 原生 system 层（`startupMemoryTransport`，默认对 claude/codex 开启）。

### 二、Role / Instance MVP（schema 59–60）

- `role_templates` / `role_revisions` / `role_instances`；Role 修订不可变，实例冻结创建时的配置快照。
- 每个频道实例是独立 principal，拥有独立执行 lane 和 provider session；复用 Inbox/Activation/AgentHost。
- 实例私聊（私有 box）：与频道共用 session，忙时排队，频道运行读不到。
- 实例 session 连续性：稳定 session key（不含配置版本和提示词摘要）；四家驱动对实例禁止恢复失败后静默新建；绑定失败终止并隔离。
- 旧 Agent 路径仍然保留；按已签合同将在 evo 后端移除。

### 三、效率门禁脚本

`scripts/cli-efficiency/`、`scripts/test-cli-efficiency.mjs`、`scripts/scheduling-phase-audit.mjs`。

### 四、S1-a 用量观测（schema 61）

- `run_attempt_usage`：驱动经 fd3 `rah-provider-usage/v1` 帧逐次生成上报原生 token 用量（Codex/Claude/OpenCode；Kimi ACP 不提供逐次用量），Host 以自身凭据按 (RunAttempt, response) 幂等写入，不进 trajectory；`agent.run.usage.get` 按 RunAttempt 读取。

### 五、S1-b 发送错误分类 / S1-c 提示词减重

- S1-b：`message-post` 收到 <500 且带服务端 code 的响应 = 提交前明确拒绝，输出 `Effect: not_sent`、`Draft saved: no`、可修正后重发；UNKNOWN/CANNOT_CONFIRM 只留给传输错误、超时、5xx。
- S1-c：常驻提示词（最小 Agent、无 MEMORY）47.5k → 15.8k 字符，`platform` 35.8k → 9.3k；细节移到 `rah worker help <topic>`（messages/history/threads/tasks/reviews/attachments/profile/reminders/mute/memory/errors/constraints），删除发帖后额外轮次的措辞；预算测试 16,000 / platform 10,000。

### 六、S1-d 带正文唤醒 / S1-f 隔离与生命周期（schema 62）

- S1-d（仅 Codex，`BODIED_WAKE_ADAPTER_KINDS`）：Host 在启动前用本 Run 的 Worker 凭据调用 message-present 生成窗口（与 message-check 同一审计事件过滤，业务事件照常显示），唤醒正文带真实 seq 与可确认前缀；回复 `message-post --based-on-room-seq N` 即经 ACK-on-post 完成 Activation；无需回复则 message-check；窗口截断或首条过大时回退为先 check / 固定唤醒。记忆索引仅在与原生 session 首次快照不同时附上。驱动在匹配的 turn/start 响应后发送带正文 SHA-256 的接收帧，Host 核对一致才登记 sent；Run 结束后的迟到回执被忽略。Claude/Kimi/OpenCode 与远端 Computer 仍为固定唤醒 + startup check。
- 顺带修复：macOS 受监管启动路径从未传递接收回调；v4 placement（实例所用）未接接收登记。
- S1-b 收窄：Worker API 对幂等冲突输出 `idempotency_conflict`（可能已提交，按幂等身份查找，不换 key 重发）；其余 4xx 明确拒绝 = not_sent。
- S1-f：创建频道拒绝已有实例；失效私聊的回帖/建线程/转发/提醒全部拦截，实例提醒计为活跃工作；`role_instance_sessions` 记录 Host 在会话文件写入成功后上报的绑定证据，"必须续聊"改为"本代已有绑定"，首启绑定前失败不再永久隔离；新命令 `instance.session.reset`（Human、无运行中工作、幂等）推进代数并在频道记录 `instance.session_reset`"上下文连续性被 Human 重置"；旧的记忆/执行重置对实例直接拒绝并指向该命令。
- 门禁：分别记录回复前/回复后/整轮生成数与协议额外生成数；firstInput 缺失 fail closed；未缓存比例只报告。

### 七、门禁前收口（schema 63）

- 用量完整性：驱动对不一致/修正帧/解析失败/不支持的运行时发出缺口帧，`run_attempt_usage_gaps` 持久化；读取接口返回 `completeness`（complete/partial/unavailable），无数据时合计为 null；门禁对 partial/unavailable 判证据不足，并交叉核对产品入库与原生记录。
- 不能上报绑定证据的 Host（当前远端 Computer）拒绝运行 Role 实例（`RAH_INSTANCE_HOST_UNSUPPORTED`，不重试循环）；旧 Agent 不受影响。
- 门禁预算按合同 §6 修订版执行（协议额外生成 ≤1、回复前额外 0、首请求 ≤ 原生+3k、总输入 ≤ 2×(原生+3k)、耗时 max(5 s, 15%)）。

### 八、S2-0 遗留进程与端口清扫（schema 64）

- 进程树标签 `LOOM_RUNTIME_ID`/`LOOM_RUN_ID` 由 Host 强制注入（用户与租约配置不可覆盖），已验证可传到 `setsid` 脱组的孙进程。
- `leftover-process-sweeper`：macOS 用 `ps -A` + `ps -A -E` 读环境，Linux 用 `/proc/<pid>/environ`；覆盖带标签进程、其子孙与其带领的进程组；发信号前复核 UID 与启动时间（防 PID 复用）；`lsof` 查监听端口。约 1,000 进程扫描 ~70 ms。
- 清扫点：每次终止证明后（结束、崩溃、取消、孤儿恢复）、Host 启动与每 60 s 的 janitor（只杀本 Host 已终止运行时的标签）、被阻塞实例准入前复扫。实例移除与 session 重置在清扫未解决时拒绝。
- `runtime_process_cleanups` 记录每次清扫；超过进程数/内存/端口上限时告警并拒绝新准入（`RAH_RUNTIME_CLEANUP_BLOCKED`），不取消忙碌工作；清理结果通过下一轮唤醒一句话告知（≤300 字符，只发一次）。配置项 `processHygiene`。
- 已知局限：macOS 隐藏 Apple 平台二进制（`/bin/sh`、`/bin/sleep` 等）的环境变量；清空环境且已无带标签祖先、又不在带标签进程组内的脱组进程会漏扫；Linux 路径无自动化测试。
- 门禁按新口径输出固定开销、每轮残留、工作路径差异与逐轮输入分解。

### 九、S2-a Codex 热进程（schema 65，默认关闭）

- `warmRuntimes.codex` 配置项，**默认关闭**，待真实冒烟与冷热对比通过后再决定是否默认开启。（更正注：Codex 与 OpenCode 常驻自第二十四节起默认开启，本节“默认关闭”是当时状态；Claude 常驻仍默认关闭。）
- 每实例一个 `codex app-server --listen unix://…`（实测该传输是 unix socket 上的 WebSocket，已自写客户端并用无模型的 initialize 探针验证）；驱动为进程组组长，经 stdin 收命令、fd3 回帧，帧带 runtime id、Host 代数、RunAttempt、原生 turn id 与序号。
- 按轮句柄（方案 C）：128 位随机句柄，位于权限 0300 的 `turns/` 目录（可进入不可列举），只出现在本轮唤醒正文（原生压缩后经 `turn/steer` 重述）；Worker CLI 必须带 `--turn`，缺失报 `TURN_HANDLE_REQUIRED`，已撤销报 `TURN_HANDLE_INACTIVE`；按轮身份移入句柄的 `scope.json`，不再放进程环境。旧的每轮路径不变。
- Kernel：`instance_runtimes`（部分唯一索引，每参与者最多一条存活记录；轮次成孤儿时触发器标记 suspect）；`run_attempts` 增 `instance_runtime_id/native_turn_id/execution_mode/session_resume_ms`；`runtime_processes` 增 `proof_kind/quiesce_result/close_seq/closed_at/late_frame_count`；`recordTurnQuiesced` 不伪造退出码；授权与执行检查增加"当前轮次 + Host 代数"。
- 本轮结束不清扫热进程；热进程退出、回收或 janitor 处置时整树清扫。
- 用量接口新增 `execution`（冷/热模式、session 恢复耗时、迟到帧数）；迟到帧使用量标记 partial。
- 未经真实 Codex 验证：多轮协议、`turn/steer` 时序、thread 卸载行为、`turn/completed` 与用量帧顺序、后台终端（未使用 `thread/backgroundTerminals`）。打包产品构建回退为每轮模式。
- 未做（S2-b/c）：LRU、RSS/时长回收、四信号卡死判定、其余三家驱动。

### 十、S2-0 审查修复与门禁冷热对比（schema 66）

- 清扫状态按运行时聚合（`runtime_cleanup_states`：pending/blocked/resolved），实例只有在全部运行时已解决时才可准入；观测按时间顺序生效，旧观测不会解除新状态；janitor 不再写"整实例已清空"。
- 清扫前先在 Kernel 标记 pending；记录写入失败、ps 失败、启动扫描失败一律视为未知并阻断准入，直到完整清扫成功。
- 有界清扫后对完整目标集合复扫，仍存在或无法确定的计入残留/未知并阻断；ps/lsof 带 15 s 超时，失败抛错而非返回空；lsof 失败时端口状态为未知；记住组长存活时见过的进程组；`resolveRuntimes` 分页。
- macOS 环境行须按 pid 与启动时间匹配，只读取 `LOOM_RUNTIME_ID=<id>`；冲突或两次 ps 之间命令变化的进程不发信号、计为未知。每次发信号前重读身份（`lstart` 只精确到秒、`kill` 非原子，仍有很小的 PID 复用窗口）。
- 清理通知改为按 Run 预留 → 接受 → 释放，至少一次投递并带去重标识；Codex 接收摘要覆盖包含通知的完整输入。
- 门禁：新增 `role-warm` 组（`RAH_EFFICIENCY_ORDER=native,role,role-warm`），逐轮记录执行模式、session 恢复耗时、迟到帧，输出冷热对比；无模型的 `scripts/cli-efficiency/resume-probe.mjs` 测量 thread 恢复耗时。

### 十一、S2-a 审查修复（schema 66 不变）

- 杀进程须有证明：只有真实退出事件或经身份核验的"已不存在"才算退出；超时或无法验证时运行时标记 suspect、隔离、保留 lane、不记退出、不冷启动。
- 首次绑定前移：拿到并核实原生 thread id 后、首轮输入被接受前就持久化 session 绑定（失败即停止，不发送输入）；首轮取消或崩溃后恢复同一 thread。
- 启动窗口：spawn 后立即记录 pid/pgid/出生时间；无身份的启动记录视为"不确定"而非"已不存在"；清扫失败上报而非吞掉。
- 帧完整性：序号缺口、排空水位不符、无法归属的用量都标记为不完整；fd3 溢出使该轮不完整且不再复用运行时；收尾等待在途 `turn/steer` 响应。
- quiesce 幂等返回前先核对 Host 代数、运行时、run、原生 turn。
- 剩余局限：spawn 返回到记录落库之间仍有极小窗口（靠标签清扫兜底）；压缩后重述失败只记日志；连接断开仍视为致命，无在线对账；均未经真实 Codex 验证。

### 十二、精简唤醒与 `--final` 立即结束本轮（schema 67）

- 唤醒只保留消息正文与一行回复指令，每轮固定说明从约 1,417 字符降到 116（常驻 176）；常量规则只在常驻提示词里出现一次（提示词预算 10,500）；8 位短消息引用在 Worker API 一次性展开，歧义返回 409。
- `message-post --final`：最终回复提交时在同一事务记录 `run_attempt_final_replies`，Host 随即请求原生结束本轮（冷路径经驱动 stdin 帧，常驻路径经 `turn.final`，均核对 RunAttempt 与原生 turn id，且等发帖工具结束后再中断）；被中断的轮次记为成功；中断被拒绝时照旧多一次生成，回复不受影响。标记本身不是 ACK，Activation 完成仍要求覆盖到 toSeq。
- 用量接口新增 `finalInterrupt`（是否发出、是否抢在下一次模型请求之前）；门禁报告该项。
- 未经真实验证：中断能否稳定抢在 CLI 下一次请求之前；其他三家的原生中断（Claude `control_request interrupt`、Kimi `session/cancel`、OpenCode abort）待 S2-c。

### 十三、长会话漂移修复（压缩后回复目标漂移）

- 真实漂移测试（Codex gpt-6-luna/low、常驻、20 轮、第 8/15 轮强制压缩）发现：规则、Task 规则、沉默、`--final`、`--turn` 压缩后均保持；但模型总显式写 `--target`，压缩后把频道回复全部发进旧 thread（第 9/13/14/15/16/20 轮）。
- 修复：唤醒回复行给出含精确目标的完整命令（多目标逐一列出）；Kernel 对带 `--based-on-room-seq` 的 `--target` 回帖做结构性检查，发往与本批送达消息无关的 thread 时以 `reply_target_mismatch`（409，明确拒绝，可修正重发）拒绝；上次尝试既未回复也未确认时，重试唤醒加一句提醒。显式 `threadId` 路由未加此守卫（保留 task-get 进入旧 Task thread 的既有契约）。

### 十四、S2-b 常驻进程策略（Codex 热模式仍默认关闭）

（更正注：Codex 与 OpenCode 常驻自第二十四节起默认开启，本节“默认关闭”是当时状态；Claude 常驻仍默认关闭。）

- 空闲回收默认 30 min（从 lane 释放或 TUI 分离起算）；忙碌、等待释放、被固定（TUI）时不回收；上次冷恢复 >20 s 的实例 TTL ×4；可按实例覆盖。
- 边界重启只在空闲实例被取用前进行：进程组 RSS >2 GiB、存活 >12 h、CLI 指纹（realpath+大小+mtime）变化、运行时键变化；先证明旧进程退出，新进程恢复同一 thread。
- 热进程软上限 12（LRU 淘汰空闲者），并发忙碌轮次硬上限 20（超出等待 60 s 后以 `RAH_WARM_ADMISSION_FULL` 重试，不长期占用 Activation 租约）。
- 卡死判定：传输心跳不重置业务进度时钟；工具运行单独 60 min 窗口；等待审批不计；15 min 无进展 → 中断 → 必要时有证明地杀进程，记 `RAH_RUNTIME_STALLED`，重试 1 次后隔离交 Human；已提交 `--final` 回复的轮次不重跑。忙碌时 RSS >2 GiB 告警并停止新准入，>8 GiB 视为资源故障有证明地杀进程。
- `preemptedFollowUp` 按证据判定（final 提交后无后续输出为 true，有则 false，无法读取为 unknown）；冷路径新增 `sessionResumeMs`（`thread/resume` 请求到响应，与热路径同口径）。
- 局限：RSS 只统计进程组；每 Activation 卡死计数在内存中，Host 重启归零；固定（pin）接口待 S2-e 使用；均未经真实 Codex 验证。

### 十五、第六轮审查修复（schema 68）

- 回复目标守卫改为在目标解析后对两条发帖路由统一判定（显式 threadId、频道顶层、带或不带 thread 后缀的 `--target`）；`--final`、带 based-on、或本轮送达尚未确认时的发帖都视为"回复本轮"并受检；放行依据：送达消息所在/为根的 thread、本 Agent 在窗口后新开的 thread、送达消息所在的频道顶层、与本 Agent 有关或本轮 task-get 过的旧 Task thread（`activation_task_reads`）；`--final` 发往其他 Room 也拒绝；错误提示不再建议去掉 based-on。
- 漂移门禁汇总把 ACK 未完成、重试、常驻缺句柄等硬失败纳入判定；不可观测的 targetRejections 汇总为 null。
- `finalInterrupt` 分为 requested / accepted / terminal；已观察到的后续生成不可被后续工具完成抹除；无法归属时为 unknown。
- 协议版本记在 Host 的 session 绑定上；已续聊 session 协议落后时，下一轮唤醒加一行"Protocol updated"，并提供 `worker help protocol`（Activation 完成后才标记已更新）。
- 未修：`maintainFinalReplyInterrupt` 单次读取失败即停止监视；8 位 thread 短引用歧义返回 NotFound 而非 Conflict；常驻进程启动键未包含协议版本；审查建议的若干免费交错场景未补。

### 十六、S2-c1 Claude 接入（热模式默认关闭）

- 本机 Claude Code 2.1.282 无模型核实：`--replay-user-messages` 回显带我们注入的输入 uuid（续聊时也是）；每条输入有 queued/started/completed|cancelled 生命周期；每个原生轮次恰好一个 `result` 并以 `user_message_uuid` 指明对应输入；`control_request interrupt`（`cancel_queued`）返回 cancelled/still_queued 回执；`--system-prompt-snapshot` 使 system prompt 固定到压缩为止。
- 带正文唤醒：只有带本轮 uuid 且正文一致的回显才算接收；Claude 加入带正文唤醒能力集；与 Codex 共用 `createHostBodiedWake`。
- `--final`：在首个工具边界发原生中断，被中断的最终轮次记为成功，记录 requested/accepted/terminal/preemptedFollowUp。（第七轮审查更正：Run 成功不等于业务全部成功；同一 Activation 内另有独立错误时不再判成功，旧版 CLI 无 `terminal_reason` 的 `error_during_execution` 也不再一律视为中断，见第十九节。）
- 常驻 Claude（`warmRuntimes.claude`，默认关闭）：每实例一个长驻 stream-json 进程；本轮在唤醒与本轮接纳的忙时输入都结算后才关闭（第七轮审查更正：原实现中终态生命周期可先于 `result` 结算已开始的输入，并非"全部结束"的强证明，见第十九节）；取消时清空排队输入；无生命周期能力则拒绝忙时输入；忙时输入回执只表示已写入 stdin、等待原生确认，不是原生已接收；session 绑定在首条输入被接收后写入。
- 未经付费验证：真实时序下中断能否抢在后续请求前、真实工具流顺序、压缩后行为（常驻 Claude 压缩后不重述句柄，丢失句柄的轮次会以新句柄重试）、后台 shell 清理。打包产品构建仍为每轮模式。

### 十七、S2-c2 Kimi 接入与门禁扩展到 Claude/Kimi

- 本机 Kimi 是 Node 版 kimi-code 0.39.1：`session/new` 无 system 位置、无 `--wire`、`--agent-file` 只能用于新 session 且不能与 `--session` 同用；压缩保留约 20k token 的真实用户消息（头 2k + 尾 18k）；压缩只以一段文本"Compaction completed…"出现，无结构化事件。
- 压缩后规则卡：驱动上报每次压缩（`rah-provider-compaction/v1`），Host 记在 session 绑定上，下一轮唤醒开头附 `worker help protocol` 的规则卡（多次压缩合并为一张），携带规则卡的 Activation 完成后才推进；协议落后的续聊 session 也附规则卡（Kimi 无 system 层）。
- 带正文唤醒：以唯一在途请求的第一个模型更新（思考、文本或工具调用）作为接收证明；`--final`：无工具在途时发 `session/cancel`，被取消的最终轮次记为成功。
- 不做常驻 Kimi：kimi-code 会把我们的请求排在引擎自发轮次（后台任务、定时任务）之后并直接回 `end_turn`，无法证明本轮确实执行并结束，按 owner 选项 A 保持每轮冷回收。用量仍为 unavailable。
- 门禁：效率门禁支持 `RAH_EFFICIENCY_PROVIDER=codex|claude|kimi`（各自与原生 CLI 对照；Kimi 从 `wire.jsonl` 读逐次用量；第七轮审查更正：产品用量或 wire 缺失时总结论为 `missing-evidence`，耗时与送达只作为子项展示，见第十九节）；漂移门禁支持 Claude（冷：短暂 `claude -p /compact`；热：经守卫私有 socket 发 `/compact`）。
- 待付费验证：Kimi 压缩文本匹配、第一个更新先于工具、`session/cancel` 时序、规则卡被接受；Claude 的 `/compact` 路径（依据二进制字符串与 SDK 文档）。

### 十八、重复回复修复与 S2-c3 OpenCode 接入（schema 69）

- 重复回复根因（Kimi 漂移第 9 轮）：Kernel 中移植自 Raft 的"thread 上下文→频道顶层"确认检查拦下了与唤醒命令完全一致的正确回复并存为草稿，`--send-draft` 重发时丢失 based-on 与 `--final`，送达未确认，重试后重复回答。修复：回复目标守卫判定为"本轮回复"并放行时跳过该确认（该确认仍覆盖确认后无依据的普通发帖）；草稿保存并在重发时沿用 based-on 与 `--final`（新列 `reply_based_on_room_seq`、`reply_final`），恢复命令带上 `--turn`（第七轮审查更正：当时只修了 `--target` 路由，不带 target 的原始发帖路由保存的草稿仍丢 ACK/final，见第十九节）；重试时若上一次已发出回复，唤醒点名该消息（第十九节改为中性事实，只有带 final 标记时才称最终回复）。
- OpenCode 1.18.32（源码只读核实）：每次模型请求都重建 system（agent prompt/默认 → env → instructions 文件 → 最后一条用户消息的 system）。常驻提示词改为内容寻址、0600 的 instructions 文件，经 `OPENCODE_CONFIG_CONTENT` 注入并合并已有配置；不再发送逐消息 system，因此压缩后自动插入的"Continue"步骤也带规则；`session.compacted` 只记诊断。
- 带正文唤醒：驱动自选 user messageID，第一个 parentID 指向它的 assistant 作为接收证明；`--final`：发帖工具结束后 `POST /session/:id/abort`（先读取已持久化消息，避免截断发帖工具；第七轮审查更正：读取失败时原实现仍会 abort，不能覆盖该场景，第十九节改为 fail-closed）。
- 常驻 OpenCode（`warmRuntimes.opencode`，默认关闭（更正注：Codex 与 OpenCode 常驻自第二十四节起默认开启，本节“默认关闭”是当时状态；Claude 常驻仍默认关闭。）：每实例一个长驻 serve + 持久 SSE；轮次边界取我们同步 `POST /message` 的响应（自动续写后的后续步骤 parent 是合成的 Continue 消息，不能用 parent 判定）；SSE 重连后按消息列表对账、不重发；拒绝忙时输入。
- Kimi 漂移复测（k3-256k/low 冷模式，96e1dd0，`docs/evo/evidence/2026-09-25-drift-kimi-cold-r2.json`）：20 轮送达 100%，每轮恰好一条回复、0 重试（第 9 轮不再重复），目标错投 0，无越权建任务，未出现应沉默时发言，`--final` 100%，ACK 100%；两次强制压缩后规则卡仍生效。门禁因格式率判为退化而失败：5 轮超出"≤40 字"，全部是答案本身含长标识符（第 1 轮在压缩前就已超长），属模型遵守度，不是规则遗忘。
- 待付费验证：abort 与下一次模型请求的真实时序、真实 SSE 顺序、压缩后规则进入续写步骤。

### 十九、第七轮审查修复

依据 Codex 第七轮独立审查（`~/.loom/reviews/2026-09-25-s2-c-review.md`），负责人裁定全部 P1、P2 采纳。每项先写复现测试并确认失败，再做最小实现；热模式默认值不变（仍关闭），未跑付费 CLI，未重启服务。（更正注：Codex 与 OpenCode 常驻自第二十四节起默认开启，本节“默认关闭”是当时状态；Claude 常驻仍默认关闭。）

- P1-1 草稿回复意图两入口共用：`settleHeldDraftReplyIntent`（`held-message-drafts.ts`）成为 `--target` 路由与原始发帖路由共同调用的事务内步骤：被存为草稿（新鲜度 hold、再次 hold 或 thread 确认）时保存模型自己的 based-on 与 `--final`；提交时用该意图做 ACK 并记 final 标记。不同 Activation 的草稿不借出意图。两条路由的新鲜度围栏均未改：`--target` 重发以本 Agent 在该目标的已读位置为底线；原始路由的因果标记固定为 Activation head，出现更新消息时重发仍会再次 hold，须走既有的 `--anyway`（至少两次 hold 后）才提交，意图随再次 hold 保留。测试（`worker-reply-drift-duplicate.test.ts`）：originating→target（按恢复指导重发）、target→originating、originating→originating 各恰好一次提交、ACK 到 toSeq、final 标记记录（后两者经再次 hold + `--anyway`）；跨 Activation 不借用。
- P1-2 OpenCode 中断 fail-closed：`opencode-final-interrupt.js` 持久工具状态查询失败或返回非列表时有界重查一次，仍失败则放弃本次 abort 优化、等本轮自然结束（冷热共用）。测试：`opencode-final-interrupt.test.ts`（查询失败/格式不可信不 abort、重查成功才 abort）与 `opencode-server-driver.test.ts`（SSE 滞后 + GET 失败 + 发帖工具执行中 → 不发 abort）。
- P1-3 独立错误优先：Claude 与 OpenCode 热驱动收尾时 Host 停止优先，其次任何独立错误判 `failed` 并保留 `errorMessage`，最后才是 final 结束；只豁免本驱动自己的中断造成的取消结果（按输入记录中断请求）。Host 侧 `warmTurnDriverFailure`（`codex-warm-adapter.ts`）对任何状态下带错误文本的轮次都记失败，不判 success。测试：`claude-warm-driver-close.test.ts`（唤醒 final 成功但已接纳 notice 独立失败 → failed 且保留错误）、`opencode-warm-runtime.test.ts`（非 abort `session.error` 先到、随后 final abort → 不以 success 静默）、`warm-turn-classification.test.ts`。
- P1-4 效率门禁：`compareRounds`/`compareArm` 有任一 `unmeasured` 维度（productUsage/tokens/generations）时 `status` 为 `missing-evidence`，可测子项结论另见 `measuredStatus`；顶层 `gateStatus` 在此情况下给 `missing-evidence`（退出码 1），不再可能 `needs-quality-review`。`docs/design/cli-efficiency-gate.zh-CN.md` 第 47 与 84 行的矛盾按合同 §6 统一（用量缺口不判达标；wire.jsonl 替代产品用量无合同决定）。测试：`metrics.test.mjs`。
- P2-1 Claude 结束证明：已开始（lifecycle started 或回放）的输入只由自身 `result` 结算，终态生命周期先到不关闭本轮；未启动输入被 CLI 取消/丢弃/拒绝且非本驱动请求时记错误（本驱动中断取消的排队输入不算错）；有 `msg_lifecycle_v1` 时无 `user_message_uuid` 的 result 不猜归属，记错误。测试：`claude-warm-driver-close.test.ts`（顺序颠倒、顺序颠倒后失败、无 uuid、refused、回执取消）。
- P2-2 OpenCode abort 准入屏障：热驱动记录本轮每个 abort 请求，排空前等待全部得到 HTTP 应答（各自受 5 秒请求超时约束），下一轮因此不会在 abort 在途时开始；结果未知（超时、连接丢失）时，排空前在本运行时内停掉旧 `opencode serve`、启动新 serve 并按原 session 继续（session 不存在则 fatal，不静默替换），不重发 prompt；替换失败才 fatal。测试（fake 延迟/丢弃 abort）：`opencode-warm-runtime.test.ts` 两例。（第八轮审查更正：本条当时只覆盖普通 turn 的 abort；空闲时对自主运行发出的 abort 结果未知后仍会恢复准入，停旧 serve 也未要求退出证明。两处已在第二十四节修复。）
- P2-3 重试提示中性化：Kernel 在重试窗口给出上一次尝试的消息 id，只有该消息带本 Activation 的 final 标记时才另给 `previousAttemptReplyFinal`；唤醒行默认为"Previous attempt posted msg=X; inspect it and finish any remaining work (it does not show every target was answered), or message-check if nothing remains."，带 final 标记时才说"posted its final reply"。测试：`wake-message-input.test.ts`、`worker-reply-drift-duplicate.test.ts`（进度贴、多目标部分答复、未 ACK 的 `--final` 帖）。
- P2-4 旧版中断形状：无 `terminal_reason` 的 `error_during_execution` 只有在本次中断的 control_response 成功（关联回执）已到时才算中断；否则 terminal 为 unknown、Run 按失败处理（冷热两条路径，`claude-final-interrupt.js` 的 `endedByInterrupt`）。测试：`claude-final-interrupt.test.ts`、`claude-final-reply-driver.test.ts`（有/无回执）、`claude-warm-driver-close.test.ts`（结果先于回执）。
- Claude 忙时输入：final 已 armed 后仍启动的幸存 notice 也会被再次中断，其中断结果归属 final 结束、不记错误；notice 回执文字改为"已写入、等待原生确认"。测试：`claude-warm-driver-close.test.ts`。
- 仍未验证（需付费冒烟）：真实 Claude 的 result/lifecycle 先后顺序与旧版 CLI 形状、真实 OpenCode abort 与下一次模型请求的时序及 abort 超时频率、SSE 顺序、压缩后规则；以上修复只由 fake 确定性测试证明。审查指出的 `opencode-event-identity.js` 只按 session+role 过滤（非当前轮 ancestry）未在本批修改。

### 二十、漂移门禁支持 Claude Haiku 与 OpenCode

负责人于 2026-09-25 为冒烟授权两个付费模型：Claude Code 用 Haiku 4.5（无 effort 参数），OpenCode 用
`deepseek/deepseek-v4-flash` + `low`。本批只改 gate 与测试，未跑付费 CLI，未重启服务，热模式默认值不变
（[漂移 gate 文档](../design/long-session-drift-gate.zh-CN.md)）。

- Claude Haiku：免费目录探针（`probeLocalModelCatalog`，只发 `initialize`）确认本机 Claude Code 2.1.282 发布的 binding
  为 `haiku`（Haiku 4.5，`supportsEffort: false`，无 effort 档位）。`RAH_DRIFT_EFFORT=none` 只许且必须用于该 binding，
  其他 Claude 模型仍须显式 effort；`claude-guard.mjs` 对 `effort: null` 要求恰好一个 `--model`、零个 `--effort`；
  压缩参数、transcript 事后围栏、placement 核对同步处理。产品侧无需改动：Role `reasoning: default` 时冷驱动
  （`runtime-implementation-registry.ts`）与热驱动（`codex-warm-adapter.ts` → `claude-warm-driver.mjs`）都不传 `--effort`；
  新增两条免费产品测试固定该行为（`claude-provider-session.test.ts`、`claude-warm-runtime.test.ts`，写完即通过，属
  特征测试）。
- OpenCode：`drift-config` 增加 `opencode`（`opencode-cli/v1`，cold/warm，warm 经既有 `warmRuntimes.opencode`）。新
  `drift-opencode-guard.mjs`：守卫 shim 把真实 `opencode serve` 移到另一回环端口，自己在产品指定端口做 fail-closed
  HTTP 代理，逐个校验冷驱动与热 serve 的每次 `POST /message`（许可 model + variant）、summarize 与其余请求白名单，
  并在监听前核对合并配置中无 agent 固定到其他模型；每轮再读 `opencode.db` 做事后模型/variant 围栏。（第八轮审查更正：
  fail-closed 只限产品驱动经 HTTP 发出的请求；当时未约束 `small_model`，默认标题 session 的首条消息会经 small model
  生成标题而不经代理；事后围栏只检出、不阻止。第二十四节补上 small_model/默认模型固定、agent variant/options 核对与
  非默认标题要求，内部调用范围的限制仍在。）
- OpenCode 强制压缩：原生入口 `POST /session/:id/summarize {providerID, modelID}`（1.18.32 `/doc` 核实，无 variant
  字段；源码 `SessionCompaction.process` 选项合并含 `agent.options`），gate 把许可 variant 的选项注入为
  `agent.compaction.options` 并核对生效。冷：短生命周期 serve；热：经 shim 私有 socket，压缩期间隐藏该 session 的
  SSE 事件、暂存驱动 prompt。观察证据为新完成的 compaction assistant。用量沿用产品 `step-finish` 归一化。
- 测试（免费）：`drift-config.test.mjs`（Haiku `none`、非 Haiku 缺 effort / 用 `none` 被拒、opencode 解析）、
  `claude-guard.test.mjs`（Haiku 带 `--effort` 被拒、批准值必须声明 effort）、`drift-guard.test.mjs`（Haiku 压缩参数与
  transcript 围栏）、`drift-opencode-guard.test.mjs`（错误模型/variant/路由被拒、配置核对、variant 选项解析、压缩证据、
  SSE 过滤，以及用假 OpenCode 的 shim 端到端：代理放行、隐藏压缩、违规 403 并关闭、启动时拒绝他模 agent、冷压缩）。
- 阻塞：2026-09-25 本机 OpenCode 目录已无 `deepseek/deepseek-v4-flash`（现为 `deepseek/deepseek-flash`＝V4.1 Flash、
  `deepseek/deepseek-v4-pro`、`aihubmix/deepseek-v4.1-flash`），按授权 id 运行会在付费调用前的目录核对处失败；
  gate 不替换模型，需负责人确认。Haiku transcript 是否记录 effort 字段未知，若记录会被判越权。

### 二十一、真实 Claude 中断形状回归修复

负责人授权的 Haiku 冒烟（Claude Code 2.1.282，漂移门禁 10 轮）暴露冷路径回归。本批未跑付费 CLI、未重启服务、热模式默认值不变。

- 证据（冷模式 room.db）：第 1 轮三次 RunAttempt 都提交了 `message-post --final --based-on-room-seq 4`，`run_attempt_final_replies` 有行；轨迹为 `claude:result:final-reply-interrupt` 后接 `claude:driver:error: Claude turn ended with error_during_execution`；`run_attempts.exit_code` 三次均为 1；`subscription_cursors.last_seq` 已到 4（=toSeq，ACK-on-post 生效）；Activation 因运行失败重试两次、三条重复回复后隔离。
- 真实形状（读已安装二进制内嵌源码，未调用模型）：中断轮次的 result 为 `subtype:"error_during_execution"`、`is_error:true`、带 `terminal_reason:"aborted_tools"|"aborted_streaming"`；interrupt 控制请求处理器调用 abort 后立即返回 `{still_queued}`，所以 control_response 先于 result。与第七轮 P2-4 推测不同，驱动已正确识别本次中断（轨迹里的 `final-reply-interrupt` 即证据）。真正原因是 headless 退出码：`runHeadless` 以 `go(en?.type==="result"&&en?.is_error||io?1:0)` 退出，最后一条 result 为 `is_error` 时退出码为 1；冷驱动要求 `code === 0`，于是判为失败。fake 在 stdin 关闭时总是退出 0，所以测试一直没有暴露这个问题。
- `run_attempt_final_replies` 的中断列为空：冷驱动只在运行成功时才写 `rah-final-interrupt/v1` 报告，列为空是运行失败的后果，记录链路本身没问题。
- 热模式第 1 轮首次尝试（executionMode=cold）的失败与此无关：模型只输出了正文、没有调用 `message-post`，运行成功但未 ACK，按既有规则重试后完成。第 2–10 轮热路径中断均记录 requested/accepted/terminal=true。
- 修法一（冷驱动 `claude-stream-json-driver.mjs`）：只在以下条件同时成立时接受退出码 1：本驱动的 final 中断造成了首个 result（`endedByInterrupt`）、该 result 是最后一条且 `is_error`、无信号。其余非零退出仍判失败。P2-4 的判定没有改：与本次中断无关的 `error_during_execution`（例如 `terminal_reason:model_error`，或旧版无 reason 且无回执）仍判失败。热驱动 shutdown 本来就忽略 Claude 退出码，逻辑没有改。
- 修法二（Host `agent-host.ts`，堵住重复回复）：运行失败、按原逻辑会重试时，先读 Kernel 中本 RunAttempt 的 final 标记；标记存在就走 `completeActivation`，由 Kernel 证明 ACK 已到 toSeq、运行时终止证明与 obligations 满足；Kernel 拒绝时按原失败信息重试。RunAttempt 的退出码与错误照原样保留，不改写。没有标记，或有标记但未 ACK，都按原规则重试。
- 测试：`fixtures/fake-claude-stream.mjs` 按真实规则设置退出码（最后一条 result 为 `is_error` 时退出 1），新增 `FAKE_INTERRUPT_TERMINAL_REASON`。改后既有三条中断用例与新增的“真实退出码”用例在旧实现下都失败（exit 1，报错与真实证据相同），修复后通过。`claude-final-reply-driver.test.ts` 新增“中断在途时出现 model_error 仍判失败”。`agent-host.test.ts` 新增三例：退出码 1 + final 标记 + ACK → completed，不再启动；有标记无 ACK → 重试；有 ACK 无标记 → 重试。其中第一例在旧实现下失败（重试）。`claude-warm-driver-close.test.ts` 新增真实顺序用例：先回执，再 aborted_tools is_error result，Claude 退出 1 时 shutdown 仍退出 0。这一例写完即通过，属于特征测试。
- 未解决：真实付费复测未跑。热模式首轮为何走 cold 执行未查。有标记但未 ACK 的重试仍按运行失败信息记录 `last_error`，不会触发“上次已发 final”的重试提醒（行为与之前相同；第二十四节已修）。

### 二十二、Claude Haiku 真实冒烟复测（8491489）

负责人授权 Claude Code 2.1.282 `haiku`（Haiku 4.5，无 effort），漂移门禁 10 轮、第 5 轮后强制压缩。

- 冷模式（`docs/evo/evidence/2026-09-25-drift-claude-haiku-cold.json`）：门禁通过。送达 100%（分母为应答轮 6/6，10 轮中 4 轮应沉默；“每轮一条回复”同指应答轮）、每轮一条回复、0 重试、0 隔离、目标错投 0、沉默与 Task 规则全对、`--final` 与 ACK 100%；压缩前后无退化。第 1 轮格式超长（模型遵守度）。第二十一节修复前同一场景第 1 轮三次重复回复并隔离，修复后消失。
- 热模式（`docs/evo/evidence/2026-09-25-drift-claude-haiku-warm.json`）：第 2–10 轮全部正确，续聊平均约 5–7 s；压缩后无退化。第 1 轮首次尝试（新会话首轮走冷执行）模型只输出正文未调用 `message-post`，无 ACK，按规则重试一次后正确回复，全轮仅一条回复。两次热模式复测都出现，属于 Haiku 首轮协议遵守问题，门禁记为 retried（violated）。是否需要在首轮给出更强的工具调用约束待后续对比 Sonnet 再定；不以提示词补丁处理。

### 二十三、OpenCode 真实冒烟（b1971f3）

OpenCode 1.18.32 目录已不再发布 `deepseek/deepseek-v4-flash`，负责人 2026-09-25 批准以 `deepseek/deepseek-flash`（DeepSeek V4.1 Flash）/ low 替代。漂移门禁 10 轮、第 5 轮后原生 `POST /session/:id/summarize` 强制压缩。

- 热模式（`docs/evo/evidence/2026-09-25-drift-opencode-warm.json`）：门禁通过。送达 100%（应答轮 6/6，10 轮中 4 轮应沉默）、0 重试、0 隔离、目标错投 0、沉默与 Task 规则全对、`--final` 与 ACK 100%，压缩后无退化；续聊约 2–5 s。
- 冷模式（`docs/evo/evidence/2026-09-25-drift-opencode-cold.json`）：第 5 轮（应沉默）模型正确未发言，但没有执行唤醒指示的 `message-check`，无 ACK，按规则重试一次后补齐；其余全部正确，续聊约 4–6 s。门禁记为 retried（violated）。属于模型协议遵守度；沉默轮仍需显式读取确认，不以"已展示+未发帖"推断 ACK（守 AGENTS 不变量）。
- 第 1 轮两种模式格式超长（模型遵守度）。
- 四份样本的送达分母均为应答轮 6/6（冷 Haiku、热 Haiku、冷/热 OpenCode 相同）；格式是软项（冷 Haiku、两份 OpenCode 为 5/6）。这些样本不是原生 CLI 对照，不证明效率合同。

### 二十四、第八轮审查修复与 Codex/OpenCode 常驻默认开启

依据 Codex 第八轮独立审查（`~/.loom/reviews/2026-09-25-review-8.md`），负责人裁定全部采纳，并同意修复后把 Codex 与 OpenCode 常驻改为默认开启（Claude 常驻仍默认关闭）。每项先写失败测试再最小实现；未跑付费 CLI，未重启服务。

- P1-1 OpenCode abort 统一准入屏障（`opencode-warm-driver.mjs`）：普通 turn 的取消与 final abort、空闲时对自主运行的 abort 都经同一屏障（`barrierAbort` / `passAbortBarrier`）：任一 abort 未应答时不准入；结果未知（超时、连接丢失）时保持不可准入，直到旧 `opencode serve` 以退出证明退役、新 serve 按原 session 恢复后才解除，不重发 prompt；退役或重启失败则整个 warm runtime fatal 退出，由 Host/janitor 的终止证明与清扫接管。屏障关闭期间到达的 `turn.begin` 暂存一条、不发出，屏障通过后再发（原来是直接拒绝，拒绝会消耗 Activation 重试预算）；Host 的 30 s 准入超时与取消路径（杀进程组有证明）仍兜底。测试（fake，新增 `autonomous` 场景、`FAKE_TERM_DELAY_MS`、`FAKE_FAIL_RESPAWN`）：`opencode-warm-runtime.test.ts`“idle abort 超时 → 下一轮在旧 serve 退出窗口内开始，也只进入新 serve，同 session、不重发 prompt”与“替换失败 → runtime 终止，暂存轮次从未发出”。第一例在旧实现下失败（第二轮进入旧 serve）。
- P2-3 退出证明：新 `opencode-server-process.js` 的 `stopOpenCodeServer` 依次 SIGTERM、SIGKILL（各 1 s），返回 `{code, signal}` 退出证明，无证明则抛错；`replaceServer` 在无证明时不启动新 serve（异常沿 P1-1 路径使 runtime 退出）；shutdown 无证明时以非零码退出，进程组留给 Host/janitor。测试：`opencode-server-process.test.ts`（永不退出的假句柄 → 抛错且发过 TERM/KILL；忽略 SIGTERM 的真实子进程 → SIGKILL 证明；已退出 → 不发信号）。
- P2-2 重试原因：final 已提交、未 ACK 且运行失败时，`completeActivation` 被拒后以 Kernel 拒绝（`delivery-not-acknowledged`）作为重试原因，后接 `; run failure: <原运行错误>` 供诊断，重试处置仍按原运行失败分类。下一次唤醒因此带“Previous attempt posted msg=X … final reply”。测试（`agent-host.test.ts`，真实 Kernel + Worker HTTP）：final+未ACK+exit 1 → `last_error` 同时含两者；重试的 message-present 给出旧消息 id 且标 final；重试只 check+ACK 后完成，Room 中只有一条回复。旧实现下失败（`last_error` 只有运行错误）。
- P2-1 漂移门禁 OpenCode 守卫（`drift-opencode-guard.mjs`）：真实 serve 的配置内容把 `model` 与 `small_model` 覆盖为许可模型；启动核对拒绝 `model`/`small_model` 不等于许可值、任何 agent 的 `variant` 不等于许可档位、除 compaction 覆盖外任何 agent 带 `options`；`POST /session` 必须带非空、非默认（`New/Child session - …`）标题，否则 403（默认标题会让 OpenCode 首条用户消息经 small model 生成标题，该调用不经代理）。两个产品驱动建 session 的标题由源码合同测试确认可通过。文档（漂移 gate）注明：fail-closed 只覆盖产品驱动的 HTTP 请求；内部 small model 调用在固定配置下用许可模型但不带 variant；事后 transcript 围栏只检出、不阻止，标题调用不留 assistant 记录。测试：`drift-opencode-guard.test.mjs`（默认/缺失标题、small_model/默认模型/agent variant/options 被拒、配置覆盖）。
- 默认开启：`warmRuntimeAdapterKinds`（`daemon-process-hygiene.ts`）改为 `warmRuntimes.codex.enabled` 与 `warmRuntimes.opencode.enabled` 缺省为开，显式 `false` 关闭；`warmRuntimes.claude.enabled` 仍须显式 `true`；Kimi 不做常驻。关闭方式：daemon 配置写 `"warmRuntimes": {"codex": {"enabled": false}, "opencode": {"enabled": false}}`（可只关其一），不新增环境变量。打包（SEA）产品构建仍回退为每轮模式（`codex-warm-adapter.ts` `isSea()`）。效率门禁（`rah.mjs`）与漂移门禁（`drift-runner.mjs`）的每轮组改为显式写两项 `enabled: false`，热组仍只打开被测 CLI，冷热对照口径不变。失败隔离、空闲回收、LRU/忙时上限、清扫路径的测试直接构造 pool 或 hygiene（`warm-runtime-policy.test.ts`、`instance-runtime-pool.test.ts`、`runtime-process-hygiene.test.ts`、`leftover-process-sweeper.test.ts`、`codex-warm-runtime.test.ts`、`opencode-warm-runtime.test.ts`），不依赖 daemon 默认值，默认开启后仍覆盖；daemon 配置测试改为断言新默认与逐项关闭。
- 仍未验证：真实 OpenCode 的 abort 超时频率与服务端迟到执行、真实 serve 退役时长（新 serve 冷启动会让屏障期间的下一轮多等数秒）；Codex/OpenCode 默认常驻在本地服务上的实际表现（未重启服务、未跑付费门禁）；累计调度改动后的原生效率 gate 未执行。OpenCode 其他内部 agent/插件的模型调用未逐一证明。

### 二十五、全面审查批次 1：常驻路径修复

依据 `~/.loom/reviews/2026-09-25-full-review-synthesis.md` 批次 1（详见同目录 drivers P1-1..3、lifecycle P1-1/P1-2/P2-1..3、Codex P2-1），负责人批准修复。只改 `packages/agent-host`、`packages/daemon`，Kernel 未改；Codex/OpenCode 常驻仍默认开启。每项先写失败测试并确认按预期失败，再做最小实现。全部为 fake/临时数据库测试：未跑付费 CLI，未重启服务，未提交。

- 1 Codex `thread/resume` 只取元数据：`codex-warm-driver.mjs` 启动恢复与 `reloadThread`、`codex-app-server-driver.mjs` 冷路径三处都带 `excludeTurns: true`（0.156.1 `ThreadResumeParams` 字段；驱动只读 `thread.id`，不依赖返回的 turns）。测试断言发出的参数：`codex-warm-runtime.test.ts`（线程卸载后同进程恢复、崩溃后冷启动恢复）与 `codex-provider-session.test.ts`（冷路径）。
- 2 启动超时不再卡死热进程或泄漏槽位（`instance-runtime-pool.ts`、`codex-warm-adapter.ts`）：`releaseTurn` 对该 RunAttempt 记墓碑（有界 256）；`acquire` 在准入前、拿到槽位后、冷启动完成后、LRU 之后都核对墓碑，已放弃则退还槽位、把已就绪的进程置 idle 供下一轮复用并报错；等槽位的轮次被放弃时立即退出等待。adapter 在发出 `turn.begin` 前核对（已取消、已结算、已非当前轮次、已被释放）则不发输入。忙时槽位等待上限取 `min(admissionWaitMs, Host 启动截止/2)`：daemon 把 `runtimeStartTimeoutMs` 传给池（`hostStartTimeoutMs`），`RAH_WARM_ADMISSION_FULL` 路径因此先于 Host 超时到达；策略默认值 60 s 未改。测试：池级（冷启动中被释放 → idle、槽位空；等槽位中被释放 → 不占槽位；上限低于截止）与 AgentHost 级（`codex-warm-runtime.test.ts`：冷启动慢于截止 → 重试热复用同一进程成功；准备阶段慢于截止 → 从未发出 turn/start，重试成功）。旧实现下 AgentHost 级第一例报 “lane is still held”，第二例发出了本不该发的 turn。
- 3 Kernel 标 suspect 后由 Host 有证明地结束：`#confirmRelease` 遇 Kernel 执行围栏拒绝（`execution_fenced`，即 suspect 行上的 `releaseTurn`）时走既有 `killRuntime` → `recordExit` → 清扫；终止无证明则保持 suspect 并阻断。下一轮冷启动，经既有绑定恢复同一原生 session。测试：池级（suspect 行释放 → 进程已死、recordExit 早于新 register、下一轮冷启动；忽略信号 → 保持 suspect、不记退出）与真实 Kernel 端到端（`codex-warm-runtime.test.ts`：轮次中把 `runtime_processes` 置 orphaned 触发 suspect → 旧进程被杀、行 terminated → 下一条消息新进程 `thread/resume` 同一线程）。该端到端中第一轮的终止证明被 Kernel 以 suspect 拒绝而进入隔离，后续消息由 Kernel 既有的隔离解除路径合并处理，这部分是 Kernel 现有行为。
- 4 OpenCode `ContextOverflowError` 只记诊断：冷热驱动遇该名的 `session.error` 仍写 trajectory，但不计入错误、冷路径不抛错不杀 serve；真实失败仍以 prompt 应答里 assistant 的 error 判定。事件序列依据已安装 1.18.32 源码 `SessionProcessor.halt`：自动压缩开（默认）时先发布 error、置 needsCompaction、压缩后续跑；仅 `compaction.auto === false` 时 error 写入 assistant。fake 新增 `overflow` 场景。测试：`opencode-server-driver.test.ts`（exit 0、有压缩与后续生成、写了 session 绑定）、`opencode-warm-runtime.test.ts`（completed、只发一次 prompt、quiesce success、serve 未重启）。
- 5 OpenCode 子代理权限：未改注入配置，改为冷热驱动按 `parentID` 传递式追踪子 session（新 `OpenCodeChildSessions`，与已安装 OpenCode 自带 `opencode run` 的追踪方式相同），子 session 的 `permission.asked` 按父 session 同一规则应答（运行中且未取消/未 final 中断 → always，否则 reject），`question.asked` 一律拒绝；子 session 的其他事件仍不进入本轮。未放宽既有策略。fake 新增 `childperm` 场景（`session.created{parentID}` + 子 session 的 `permission.asked`，未应答则该步失败）。测试：冷热各一例，断言应答为 `always` 且本轮完成。另见“偏离”。
- 6 adapter 寿命：stall/resource 重试计数移到共享池（`recordSupervisionFailure`，按 Activation、有界 1000）；warm 组合的 SessionProtocolUpgrade 待确认状态、系统记忆快照与冷启动 RunAttempt 映射经 `pool.shared("warm-launch:<driver>")` 由池持有（`SessionProtocolUpgrade` 新增可注入的 `SessionProtocolState`；每次冷启动的 `prepare` 仍会重置），不新增业务队列。测试：`codex-warm-runtime.test.ts` 新增“每次 claim 新建 adapter、同一 pool 复用”的组合（与正式 placement resolver 相同寿命）：重试预算两次后隔离；协议更新行第一次失败后热重试仍携带，完成后绑定前进到新版本（改回每 adapter 独立状态即失败）；registry 测试断言两次 `createWarmRuntime` 取到同一份池内状态。
- 7 生命周期 P2：daemon 在全部常驻关闭时仍构造池（无 adapter 走热路径），Host 启动 janitor 照常处理遗留存活行（组合期 Host 实例尚未激活，无法先查有无存活行，故改为总是构造）；AgentHost 每次启动前（热/冷两条路径）经 `fenceStart` 核对本参与者没有池外的存活行，有则先 janitor，仍无法证明终止则拒绝本次启动。正常 stop 在驱动退出后对进程组补 SIGKILL 并要求身份核验的整组消失（`#reapGroup`，与 kill 路径同一标准；kill 路径的组长退出也改用它），否则标 suspect。janitor 在 `recordExit` 成功后删除该 runtime 的 `warm-runtimes/instrt_*` 与 `/tmp/loom-warm-<uid>/` 下的 socket 目录；完整 janitor 还清理 Kernel 已记 terminated 的遗留目录，诊断文案相应改为“下一次 Host 启动 janitor 重试”，adapter 的句柄目录文案改为“随 runtime 目录删除”。`#killForeign` 与 `#kill` 未合并。测试：池级（组内残留子进程被杀；组信号被拒 → suspect、不记退出；janitor 删除崩溃行与已终止行的两类目录）、端到端（常驻关闭、池外行无法证明终止 → 冷启动被拒且未启动每轮 runtime）、daemon 组合（关闭后池仍在、`warmRuntimeKinds` 为空；原断言“关闭即无池”随之改写）。
- 偏离：第 5 项未按首选在注入配置加全局 allow。已核实冷 OpenCode 路径早经 `OPENCODE_PERMISSION={"*":"allow"}` 并入配置（合并在各 agent 权限最后，子代理不会因默认 ask 规则提问）；热路径的组合没有这个环境变量。改为驱动按父 session 规则应答，冷热一致，也覆盖继承配置里的 ask 规则。是否给热路径补同一环境变量（会让 explore 等子代理的工具限制与冷路径一样被全局 allow 覆盖）留待负责人决定。
- 仍未验证：真实 Codex 长线程带 `excludeTurns` 的恢复只有审查时的探针数据，未在产品路径上实测；真实 OpenCode 的溢出与子代理权限事件只按源码与 fake 验证；Mac 睡眠触发的 suspect 只做了模拟；本地服务未重启、未跑付费门禁。

### 二十六、全面审查批次 2：Kernel 正确性修复

依据 2026-09-25 全面审查汇总的批次 2（`~/.loom/reviews/2026-09-25-full-review-synthesis.md`；细节见 kernel P1-1/P2-1/P2-2、Codex P1-1/P1-2、drivers P2-1），负责人批准修复。每项先写失败测试再最小实现；未跑付费 CLI，未重启服务，前端未改。

- 回复目标守卫（`worker-reply-target-guard.ts`）：判断某 Thread“本轮已送达”的两个 `room_events` 条件（区间内事件属于该 Thread、区间内消息是该 Thread 的根）排除参与者自己的事件，与 `deliveredReplyTargets` 口径一致。原来上一轮自己在旧 Thread 的回复落进本轮区间时（顺序对话下 `message-check` 回放窗口从上一轮 `toSeq` 之后开始；忙时追加使下一 Activation 的 `from_seq` 早于上一轮回复），带 final 的漂移回复会被放行并完成 ACK。测试（`worker-reply-target-guard.test.ts`，真实 Worker HTTP）：顺序对话 + check、忙时追加 + present、忙时追加 + check 三种时序均要求 409 `reply_target_mismatch`、建议目标只给频道、无 final 标记、无发帖、present 路径无 ACK；旧实现三例均为 200。
- `--send-draft` 重新判定（`held-message-drafts.ts` `heldDraftResendJudgement`，两个发帖入口共用）：重发意图带 final 或 based-on，而草稿当初未经守卫判定（即不是本 Activation 在本 Room 带 final/based-on 保存的草稿；其他 Activation 的草稿与守卫不判定的普通帖都算）时，按草稿自己的目标重新判定，判定先于新鲜度决定。已判定过的草稿保持原裁决（行为不变）；重新判定通过的 target 路径草稿跳过 thread 确认，与首次发帖一致。测试：已确认送达后发往旧 Thread 的普通帖被 hold，再 `--send-draft --final --based-on-room-seq` → originating 与 target 两个入口均 409、无 final 标记、无新帖；旧实现分别为再 hold（200）与直接提交带 final（200）。
- 已移除实例禁止复活（`instance-worker-scope.ts` `requireRoleInstanceMembershipEntry`，`addMember` 与 `addRoomMember` 共用）：Role 实例只能在自己频道、且仍是成员时经通用成员入口重放（幂等不变）；已移除的实例以原 ID 加回被拒，重新加入同一 Role 只能 `roles.instantiate`（新 ID）。频道创建原本就拒绝实例、#all 自动成员排除实例、公开频道加入只限 Human 本人，不需改。测试（`role-instance-lifecycle.test.ts`）：成员内重放无操作；移除后 `addMember`/`addRoomMember` 同 ID 加回均拒绝、无成员行、实例不出现在列表、旧私聊发帖仍报 inactive；同 Role instantiate 得到新 ID 且列表只有新实例。
- session reset 解除 session 连续性隔离（`role-catalog.ts`，`activation-retry-fence.ts`）：reset 在同一事务内经既有重试 owner `resumeBlockedActivationRetryFences`（新增 `errorMarker` 过滤）只重新排队“最后错误带 `RAH_SESSION_CONTINUITY_REQUIRED`”的被隔离 Activation（合并排队中的后续工作、fence 记为 `restart` 解决、释放 lane），其余隔离（认证、输入过大、零证据等）保持不动。`instance.session_reset` 事件新增 `recovery.resumedActivationIds`；每个恢复的 Activation 追加 `activation.retry_resumed`（`cause: "instance.session_reset"`、新 `sessionGeneration`）。活进程与未证明清理仍先拒绝 reset。测试：真实隔离（绑定 → 运行失败 → Host `retryActivation` sticky）→ 新消息无法租用 → reset → 原 Activation 重新排队、fence resolved/restart、事件可见 → 新代执行（未要求续聊）→ 绑定后再要求续聊；认证类隔离 reset 后仍隔离且 lane 仍被挡；未清理进程时 reset 被拒、隔离与代数不变。
- 冷驱动首轮绑定（`claude-stream-json-driver.mjs`、`codex-app-server-driver.mjs`、`kimi-acp-driver.mjs`、`opencode-server-driver.mjs`，只改绑定发出点）：四家冷驱动在原生 session 证明已接收本轮输入时立即发出 `rah-provider-session/v1`（每次运行只发一次，成功收尾时的原有发出变为幂等）：Codex 在 `turn/start` 响应后；Kimi 在本 prompt 第一条模型更新；OpenCode 在第一条 parent 为本轮 messageID 的 assistant；Claude 在输入回放已到且 `system/init` 的身份一致时（身份漂移、输入前工具活动不绑定）。Host 原有路径随即写 session 文件并向 Kernel 记录绑定，之后取消、崩溃、provider 报错都不再让下一次静默新建；续聊失败沿既有 `RAH_SESSION_CONTINUITY_REQUIRED` 显式报错（sticky，可由上一项 reset 恢复）。未到接收证明（纯启动失败、无 assistant、refusal 无模型输出）仍不绑定、可新建。Kernel 侧无需改代码：绑定在运行中即可记录，`instanceSessionRequired` 只看绑定证据、不看运行结果；新增测试“运行中记录的绑定在运行失败后仍要求续聊”作为守护。测试：Codex/Kimi/OpenCode 驱动各新增“接收后被 Host 取消仍报告绑定”（旧实现均无绑定帧，Kimi/OpenCode 还要求绑定帧早于接收帧）；原先把旧行为写成断言的用例改为新不变量：Codex/OpenCode/Claude provider-session 集成测试的取消轮下一次改为续聊原 session，Claude 异常退出码的成功轮下一次续聊，OpenCode 失败 assistant 与 Claude 忙时首轮失败仍报告绑定。
- 仍未验证：真实 CLI 下的新绑定时机（尤其 Claude 真实流中 `system/init` 与输入回放的先后、Codex 首轮被中断后 `thread/resume` 的可用性）未跑付费门禁；reset 恢复只按错误标记识别 session 连续性隔离，Host 若以其他文案报告同类失败不会被恢复（需 Human 走其他恢复出口）。

### 二十七、全面审查批次 3：Claude / Kimi / 驱动细节

依据 2026-09-25 全面审查汇总的批次 3（drivers P1-4/P1-5/P1-6、P2-2..P2-7）与 Codex 复审批次 1、2 的 P2-1/P2-2，负责人批准修复。每项先写失败测试再最小实现（ContextOverflow 负例除外，见下）；未跑付费 CLI，未重启服务，前端未改，Claude 常驻默认仍关闭。

真实帧形状证据：本地假 Anthropic Messages API 驱动真实 Claude Code 2.1.282 二进制（不调用模型，探针在审查 scratchpad `claude/probe/`）：后台任务轮（`bgcold`/`bg`）、忙时输入并入（`fold`）、并入后中断（`foldint`）、续聊不存在的 session（`resume404`）。Kimi 以已安装 kimi-code 0.39.1 的 bundle 源码为准；Codex 以 `codex features list`（0.156.1）为准；OpenCode 以临时 HOME 下真实 `opencode serve --pure`（1.18.32）的无模型接口为准。

#### Claude

- 冷路径后台任务轮（P1-4）：真实顺序为唤醒的 result 与 `completed` 之后，stdin 已关闭，但后台 Bash 任务结束时 CLI 自发多跑一轮：`task_notification` → 新 `system/init` → assistant → 不带 `user_message_uuid`/`user_message_uuids` 的 result，没有 lifecycle，然后 exit 0（该 result `is_error` 时 exit 1）。冷驱动在 CLI 声明 `msg_lifecycle_v1` 时，只把点名本次唤醒或本次写入的忙时输入的 result 计入；其余只记诊断（`claude:result:unattributed`），不计数、不判失败，由它造成的 exit 1 也不判失败。旧 CLI（无该能力）仍按严格计数。为使忙时输入可归属，冷路径忙时输入现在带驱动生成的 uuid（`claude-busy-input.js` 的 `writtenUuids`）。fake 新增 `FAKE_BACKGROUND_TASK=success|error`，按真实顺序回放。
- 热路径忙时输入并入（P1-5，闭合第七轮 P2-1）：真实 CLI 在下一个工具边界把忙时输入并入当前轮：先回放，再 `started`，其 `completed`（中断时为 `cancelled`）先于该轮 result 到达；唯一的 result 带 `user_message_uuids:[W,N]`。热驱动按该数组结算全部被并入的输入（缺字段时回退 `user_message_uuid`）。`fake-claude-warm.mjs` 改为在工具边界并入排队输入，与真实行为一致；原集成测试“忙时输入单独成轮”改为“并入 Activation 的原生轮、不进入下一 Activation”。旧驱动在新 fake 下该轮永不 drain（测试超时）。
- 热路径自发轮与唤醒撞车（P2-3）：唤醒尚未开始（仍排队）时，后台任务轮的无 uuid result 不再判为唤醒失败，只记 `unattributed`；唤醒随后照常开始并完成，且两者都不被中断。只有 result 点名唤醒，或本轮从未出现 `system/init`（真实缺 session 只回一条 `num_turns:0` 的 result），才判唤醒失败。热 fake 的自发轮也改为真实形状（无 lifecycle、无 uuid 的 result）。
- 错误文本（P2-5）：冷热共用 `claude-stream-launch.js` 中的 `claudeResultError`，读取真实错误 result 唯一携带的 `errors[]`；同时抽出 `claudeResultInputUuids` 和 `settleClaudeControlResponse`，两个驱动删去各自副本。

#### Kimi

- Cron/Goal 自发轮（P1-6）：两者处理方式不同，只有 Cron 从源头关闭，Goal 没有关闭。
  - Cron：源码确认两套 agent core 在 `KIMI_DISABLE_CRON=1` 时都会停掉 cron 调度（持久化到 session 目录的 cron 在续聊后也不触发），`CronCreate` 返回错误。该环境变量已加入 `providerLaunchPolicy("kimi").environment`，Kimi 驱动启动时带上。因此没有做 resume 后检测持久 cron 的兜底。
  - Goal：没有进程级开关（只有用户 `config.toml` 的 `[tools] disabled`，Loom 不改用户配置），ACP 也不接受禁用工具列表；本批只在驱动中拒绝 `CreateGoal` 的 `session/request_permission`（ACP 权限请求的 `toolCall.title` 就是工具名）。kimi-code 只在非 `auto` 权限模式下询问 CreateGoal，所以本批这只是审批拦截，不是完整围栏；`auto` 模式与已有 goal 的缺口见下方“仍未解决”，第二十九节补了模式固定与续聊检测。
- 每轮 standing 文件行（P2-7）：只在新 session 的首个 prompt 中出现（与完整规则一起）；续聊的唤醒只剩正文，压缩后的规则由 Host 的规则卡负责。原集成测试的“续聊 prompt 含该行”断言改为“不含”。

#### Codex

- multi_agent/goals（P2-2）：启动策略追加 `-c features.multi_agent=false -c features.goals=false`，冷热 app-server 都带上，Settings 的 `managedLaunch` 同步显示。`codex features list` 确认这两个键生效，都解析为 false。

#### OpenCode

- 子 session 请求恢复（复审 P2-1）：遇到未知 session 的 permission/question 时，先沿原生 `GET /session/:id` 的 `parentID`（最多 8 层）证实它属于本父 session 树，才按本轮原规则应答；读取失败则不应答，不做全局 allow。冷路径恢复已有 session 时，先用 `GET /session/:id/children` 预加载子关系；热路径 SSE 重连后，读 `GET /permission` 和 `GET /question` 补答缺口内丢失的请求，按 request id 只答一次。以上接口已在安装版上免费核实。fake 新增“created 丢失后 permission 到达”“SSE 缺口内 permission 丢失后重连”等场景，冷热都有测试。
- 子代理用量（P2-4）：已知子 session 的 `step-finish` 按 part id 去重后计入本 Run 用量：冷路径全程计入，热路径只在本轮已接受期间计入。没有新增缺口原因，因为 Kernel 的缺口原因有 CHECK 约束，新增需要迁移。
- ContextOverflow 不可恢复负例（复审 P2-2）：新增冷热测试，场景为 auto-compaction 关闭、最终 assistant 仍带该错误。断言 Run 失败、已接受的 session 保持绑定、没有后续生成。现有实现已满足，测试首跑即通过，本项只补证据。
- 冷热共享（P2-6）：8 个逐字相同的函数和本批新增的恢复逻辑合并到 `opencode-server-client.js`。`requestJson`、`startServer` 只是近似重复，没有合并。

#### 仍未解决

- Kimi：用户把默认权限模式设为 `auto` 时，CreateGoal 不询问，驱动拦不住；本批之前已创建的 goal 仍可能在空闲时触发续跑轮；接收证明尚未按工具调用 id 里的 turnId 排除非本 prompt 的更新。以上都没有真实触发验证。（更正：前两项由第二十九节处理，剩余限制见该节。）
- Codex：`codex debug prompt-input` 在关闭两个特性后仍渲染 `<multi_agent_role>` 开发者指令块（疑由模型目录的 `multi_agent_version` 驱动）。工具列表是否真的去掉了 spawn_agent，需要一次真实请求确认；本地假 Responses API 的探针被本机代理拦截，未拿到请求体。
- Claude：真实后台任务轮在冷路径仍会多花一次付费生成（CLI 行为，驱动只是不再误判），其用量计入本 Run；热路径自发轮与唤醒撞车的真实竞态未实测。
- OpenCode：热路径空闲期的子 session 用量，以及 SSE 缺口内丢失的 step-finish，仍不补回、不标缺口；冷路径 SSE 断开仍直接让本轮失败；真实子代理触发频率未测。

### 二十八、全面审查批次 4：门禁与文档

依据 2026-09-25 全面审查汇总的批次 4（`~/.loom/reviews/2026-09-25-claude-full-review-gates-docs.md` P1-1、P1-2、P2-1..P2-8，`2026-09-25-codex-full-review.md` P2-2、P2-3），负责人批准修复。只改 `scripts/cli-efficiency/`、两个门禁入口、`package.json`、AGENTS.md 与文档；产品代码与前端未改。未跑付费 CLI，未重启服务。

- 单一批准表（P1-1）：新增 `approved-models.mjs`，列出负责人批准的全部 provider/模型/effort 组合（2026-09-09 矩阵四项与 2026-09-25 批准四项，`deepseek/deepseek-v4-flash` 目录已不发布但保留）。效率与漂移两个配置解析器、shim 生成器都查这张表，表外组合在任何进程启动前失败；Fable、GPT-5.6 Ultra、`max`/`ultra`/`xhigh` 另有兜底拒绝。测试：`approved-models.test.mjs`、两个 config 测试、`guarded-shim.test.mjs` 覆盖 `gpt-6-sol`、`ultra`、`opus/max`、`k3/max`、`fable` 等被拒（shim 文件不落盘）。
- AGENTS.md 授权表（P1-2）：改为按 CLI 分行、带批准日期的八项表，删去已不成立的“没有 4.1 版本”说明，注明 `deepseek-flash`（V4.1 Flash）替代 `v4-flash`、`haiku` 无 effort，保留“每批付费运行仍需负责人明确授权”。效率门禁默认值改为当前批准模型（Codex `gpt-6-luna/low`、Claude `haiku`/无 effort、Kimi `k3-256k/low`、OpenCode `deepseek-flash/low`），漂移门禁文档示例同步。`common.mjs`/`rah.mjs`/`native.mjs` 隐式的 `gpt-5.6-luna` 默认值删除，调用方必须传入已批准配置。
- Codex 围栏白名单（P2-1，`model-guard.mjs`）：只放行产品驱动与漂移压缩客户端实际发送的方法（`initialize`、`initialized`、`thread/start|resume`、`thread/compact/start`、`turn/start|steer|interrupt`、对服务端请求的响应）与逐键限定的参数（`config` 只许产品的 5 个 `false` 开关与许可 effort，`approvalPolicy` 只许 `never`，输入只许文本）；`review/start`、`config/value/write`、`thread/fork`、`approvalsReviewer`、`serviceTier` 等被拒。argv 由 `classifyCodexLaunch` 限定为 `--version`、`debug models [--bundled]` 与带产品 `-c <开关>=false`、单个 `--listen` 的 `app-server`；`debug app-server send-message-v2`、`app-server daemon|proxy|generate-json-schema`、`exec`、`--enable` 等被拒。测试：`model-guard.test.mjs`。
- Claude 门禁（P2-2）：stdin user 帧的文本以 `/` 开头即拒绝（`/model`、`/effort`、`/fast`、前导空白、内容块形式），只有注入门自己的 `/compact` 放行。shim 转发后检查 assistant 帧（含 `parent_tool_use_id` 子 agent 帧）与 result `modelUsage` 的全部键，越权写 `<shim>.violations.jsonl` 并杀进程，两个门禁每轮检查。原生组核对主链、子 agent 与 `modelUsage`；transcript 读取纳入 `<session>/subagents/*.jsonl`，sidechain 模型也须属许可族；transcript 窗口无模型记录即失败。测试：`claude-guard.test.mjs`、`claude-usage.test.mjs`、`drift-guard.test.mjs`、`provider-files.test.mjs`。
- 漂移事后核对（P2-3）：新增 `checkRoundModels`，每轮每家读取模型记录（Claude transcript 含子 agent，OpenCode `opencode.db`，Codex rollout `turn_context` 的模型与 effort，Kimi wire `llm.request` 的别名与思考档位）；越权仍整轮失败，读取失败、无 native session、窗口内零记录判 `modelEvidenceMissing`（证据缺口，状态 `missing-evidence`），`evaluateRound` 缺该字段也判缺失。测试：`drift-checks.test.mjs`。
- 证据来源字段（P2-4，`gate-evidence.mjs`）：两个门禁记录 `codeCommit`（HEAD）、`workingTree`（`git status --porcelain --untracked-files=all` 摘要、`git diff HEAD` 摘要、变更与未跟踪数）与另存的 `sourceRef`（题目快照）；同目录写 `result.redacted.json`（临时根换 `<tmp>`、home 换 `~`），其中 `rawResultSha256` 为原始文件摘要，结束时打印。已提交的旧证据不改写：其 `commit` 字段在效率门禁是题目快照（`5122795`），在漂移门禁是 HEAD。
- 单测纳入 check（P2-5）：`npm run check` 末尾加 `test:cli:efficiency:unit`（`scripts/cli-efficiency/*.test.mjs`，约 5 s）。
- 引导去重（P2-8）：`gate-daemon.mjs` 负责 shim、隔离工作台、每轮/常驻开关、daemon 启停与 API，`rah.mjs` 与 `drift-runner.mjs` 共用（stop 记录退出状态，效率组仍断言退出码 0）；`drift-config.mjs` 复用 `efficiency-config.mjs` 的 binding/effort 解析与 Claude 档位表。
- 默认效率门禁（Codex P2-2）：Codex 默认组加入 `role-warm`（产品默认常驻路径）；新增 OpenCode provider 与原生对照臂 `native-opencode.mjs`（`opencode run --pure --format json --auto -m --variant`，首轮 `--title`，`OPENCODE_CONFIG_CONTENT` 固定 `model`/`small_model`；用量用产品同一 step-finish 归一化，事后读 `opencode.db` 核对模型与 variant），RAH 组复用产品用量并读 db 做模型核对与工具调用类别。Claude 效率组支持 `haiku` 无 effort。测试：`efficiency-config.test.mjs`、`opencode-usage.test.mjs`。只有代码与免费测试，未付费运行。
- 文档（P2-6、P2-7、Codex P2-3）：本页“已知缺陷”改为“当前状态”表并删去过时的协议升级 P1；第九、十四、十八、十九节的“默认关闭”加更正注；漂移门禁文档局限段按 7 份证据重写；`s2-spec` §8 后记录证据关口未满足及原因（无豁免）。目标合同 §6“当前基线”列未改（需负责人批准），当前状态表下注明其为 9/23 数据。
- 偏离与局限：OpenCode 原生臂的 `--format json` 事件格式依据 1.18.32 二进制内嵌源码，未付费实测；OpenCode RAH 组没有独立于产品记录的 token 复核。Claude `modelUsage` 核对若遇到 CLI 后台其他模型族的调用会判越权（是否出现未知，出现时由负责人决定，门禁不自行放宽）。Codex/Kimi 事后核对依赖 CLI 私有文件字段，缺字段判证据缺失。本批新门禁代码未付费运行。

### 二十九、第三/四批复审修复

依据 Codex 复审 `~/.loom/reviews/2026-09-25-review-batches-3-4.md` 的 P1-1、P2-1、P2-2，负责人批准修复。每项先写失败测试并确认失败，再最小实现。未跑付费 CLI，未重启服务，前端未改。

- shim 选项白名单（P2-1，`guarded-shim.mjs`）：`options` 按 provider 只许传输键（Codex `socketRecordPath`；Claude `injectRecordPath`；OpenCode `compactionOptions`、`controlRecordPath`；Kimi 无），`model`/`effort` 或其他键一律拒绝，shim 文件不落盘；实际写入 shim 的 model/effort 再经批准表校验一次。负例：`guarded-shim.test.mjs` 覆盖 `options:{model:"gpt-6-sol",effort:"high"}` 等被拒。
- 原生 Codex 对照组（P2-2，`native.mjs`）：`codexNativeArgs` 直接展开产品 `providerLaunchPolicy("codex").args`（3 个 memory 开关与 `features.multi_agent=false`、`features.goals=false`），环境同样合入该策略的环境变量。合同测试 `native.test.mjs` 断言原生组的 `-c` 开关与产品策略逐项一致。`measure` 仍只读单个 transcript，这不影响结论，因为子代理已关闭。
- Kimi Goal（P1-1）：只读核实已安装 kimi-code 0.39.1 的 `dist/main.mjs`（默认 `kimi acp` 走 agent-core-v2 的 `AcpServer`；`KIMI_CODE_LEGACY_FLAG` 才走旧版，`registerAcpCommand` 约第 365048 行），结论如下：
  - 没有进程级禁用 Goal 的机制：环境变量只有 `KIMI_DISABLE_CRON`，没有对应的 goal 开关；`goalToolsEnabled` 只判断是否主 agent（约第 160752 行）；ACP `session/new` 不接受禁用工具参数。
  - 有会话级的权限模式机制：ACP `session/set_config_option {configId:"mode"}` 与 `session/set_mode` 把 `default` 映射到 `manual` 权限（`acpModeToToggles`，约第 361641 行），返回的 `configOptions` 里带 `mode.currentValue`（`buildModeOption`）。ACP 会话在 new/resume 时总是报告 `default`（`currentModeId = DEFAULT_MODE_ID`，约第 363118 行），与持久化的真实模式无关，所以不设置就读不出真实模式。
  - 在 `manual` 模式下，CreateGoal 走 `goal-start-review-ask` 询问（只有 `auto` 跳过，约第 280217 行），`UpdateGoal`（`status: active` 可恢复暂停的 goal）与 `SetGoalBudget` 都有 `approvalRule`，也会询问（约第 280903 行起）。`auto` 由 `AutoModeApprovePermissionPolicyService` 自动放行，`yolo` 全放行。
  - 持久状态：主 agent 的 durable 事件在 `<sessionDir>/agents/main/wire.jsonl`，sessionDir 由 `<KIMI_CODE_HOME>/session_index.jsonl` 查到（`appendSessionIndexEntry`，约第 245768 行）。goal 归约是 `goal.create` 为 active、`goal.update.status` 改状态、`goal.clear`/`forked` 清空（约第 280490 行）；`permission.set_mode` 为 durable 事件（约第 289134 行）。agent 续聊时 kimi-code 会把 active goal 自动改为 paused（`normalizeAfterReplay`，约第 279953 行）。
- 修法（`kimi-native-autonomy.js`，Kimi 驱动接入）：
  - 每个 session 建立后、prompt 之前，用 `session/set_config_option` 把模式固定为 `default`；返回的 `mode` 不是 `default` 就以 `KIMI_UNSAFE_PERMISSION_MODE: ... effective=<值>` 走既有失败路径（runtime_error，退出码 1），不发 prompt。持久化为 `auto` 的会话因此在本次运行中改回 `manual`；此举只改 Loom 自己的会话，不改用户全局配置。
  - 续聊前读 Kimi 自己的 session 索引与主 agent wire：goal 为 active 时，以 `KIMI_NATIVE_GOAL_ACTIVE: ...` 拒绝本次运行，不发 `session/resume`，也不改用新 session、不 reset。goal 为 paused/blocked 或已清空时照常运行。
  - 权限应答对 `CreateGoal`、`UpdateGoal`、`SetGoalBudget` 一律选 reject，其他工具仍按 full_access。
  - 测试（fake，无模型）：`kimi-native-autonomy.test.ts`（归约、索引定位、错误码）；`kimi-acp-driver.test.ts` 覆盖 `auto` 会话被固定为 `default` 后照常运行、模式无法改回时被拒且不发 prompt、续聊 active goal 被拒且不 resume/new、paused/已清空照常运行、UpdateGoal/SetGoalBudget 被拒。fake 服务器按 0.39.1 形状新增 mode 状态与 `configOptions` 应答；另三处测试 fake（`runtime-implementation-registry`、`kimi-provider-session`、`session-protocol-upgrade`）补了 `session/set_config_option` 应答，`kimi-provider-session.test.ts` 的方法序列加入该步。测试运行使用临时 `KIMI_CODE_HOME`。
- 限制（如实）：
  - 续聊检测依赖 Kimi 私有文件格式（0.39.1）。索引或 wire 读不到时（旧版 `KIMI_CODE_LEGACY_FLAG` 存储、格式变化、文件缺失），不做该项检测，照常运行，此时只剩模式固定与权限拒绝两道。
  - 模式确认来自 ACP 投影值：它在 `setPermission` 完成后才更新，但不是对 agent 内部状态的独立读取。
  - 本进程中若有此前授予的会话级放行规则，会使 goal 工具不再询问。0.39.1 的规则在进程内存中，冷驱动每次运行都是新进程，所以不受影响；但未做真实验证。
  - 接收证明仍未按 turnId 排除非本 prompt 的更新；只是在上述条件下，本进程内不应再出现 goal 续跑轮。
  - 以上都没有真实 CLI 触发验证。（更正：模式固定请求已由下方免费探针在真实 CLI 上验证；goal 拦截与续聊检测仍未真实触发。）
- 真实回归与修复（2026-09-25，负责人授权的 Kimi 效率门禁，kimi-code 0.39.1，`kimi-code/k3-256k / low`）：
  - 现象：平台组第 1 轮三次 RunAttempt 都在启动约 30 秒后失败并被隔离，轨迹为 `session/set_config_option timed out after 30000ms`，supervisor 退出码 1（证据目录 `rah-cli-efficiency-B1kf9F` 的 `room.db`，只读）。
  - 根因不在产品驱动，也不在真实 CLI，而在付费门禁的测试守卫 `scripts/cli-efficiency/drift-kimi-guard.mjs`：它对 `session/set_config_option` 只许 `configId:"thinking"`，模式请求被判 `PAID_GATE_MODEL_DENIED` 并杀掉 kimi，真实 CLI 根本没收到该请求；守卫进程随后不退出（stdin 仍开着），驱动只能等满 30 秒握手超时。fake 测试不经守卫，所以没发现。复现：用同一守卫包装真实 `kimi acp` 走驱动的请求序列，模式请求后 stderr 立即出现 `Unapproved config option`，客户端超时。
  - 真实形状核实：`dist/main.mjs` 的 `AcpServer.setSessionConfigOption`（约第 357522 行）读 `params.value`，`configId:"mode"` 调 `AcpSession.setMode`，返回 `{configOptions}`；它是普通请求，没有额外能力或时机要求。直接对真实 `kimi acp` 的免费探针（临时 `KIMI_CODE_HOME`，只复制 `config.toml`、凭据与 device_id，没有 `session/prompt`）：`session/new` 之后 `set_model` → `thinking=low` → `mode=default` 都在约 1 毫秒内应答，`mode.currentValue="default"`，并推送 `current_mode_update`。驱动原有请求形状正确，fake 的应答形状与真实一致。
  - 修法：守卫只额外放行 `mode=default`（安全模式，不是模型选择），`auto`/`yolo`/`plan` 仍拒绝；拒绝时销毁自身 stdin，使包装进程随 CLI 一起退出，驱动立即看到退出而不是等超时。驱动的 model/thinking/mode 控制请求改用 5 秒超时（启动截止为 30 秒）；模式请求失败时区分 `KIMI_MODE_UNSUPPORTED`（JSON-RPC -32601/-32602，CLI 不支持该选项）与 `KIMI_MODE_UNCONFIRMED`（超时或其他错误），两者都与 `KIMI_UNSAFE_PERMISSION_MODE`（CLI 确认了非 `default` 的模式）分开，但三者都拒绝运行：没有确认的 `default`，goal 围栏就不成立。
  - 测试（先确认失败）：`drift-guard.test.mjs` 新增两例（只放行 `default` 模式；拒绝后包装进程在 stdin 未关时 5 秒内以 1 退出）；`kimi-acp-driver.test.ts` 新增两例（fake 不应答模式请求时约 5 秒内以 `KIMI_MODE_UNCONFIRMED` 失败且不发 prompt；fake 以 -32602 拒绝时报 `KIMI_MODE_UNSUPPORTED`）。fake 服务器新增 `FAKE_MODE_SILENT`、`FAKE_MODE_UNSUPPORTED`。
  - 修复后的真实免费探针：经修复后的守卫包装真实 `kimi acp`，新会话与续聊（`session/resume`）两条路径的 `set_model`、`thinking=low`、`mode=default` 都在约 1 毫秒内应答，`mode.currentValue="default"`，没有 `PAID_GATE_MODEL_DENIED`。另外直接把一个续聊会话设为 `auto` 后再次续聊，ACP 仍报告 `default`（与上文“报告值不代表真实模式”一致），经守卫设 `default` 后得到确认。
  - 未做：付费效率门禁尚未复跑；goal 拦截与续聊 active goal 检测仍只有 fake 验证；CLI 不支持模式选项时没有降级路径（直接拒绝），0.39.1 支持该选项。

### 三十、OpenCode 效率门禁 shim 缺压缩选项

- 现象：OpenCode 效率门禁（`deepseek/deepseek-flash / low`）的 role 组与 role-warm 组都没有回复，Activation 被隔离。原因相同：`rah.mjs` 经 `prepareGateDaemon` 写 OpenCode shim 时没传 `compactionOptions`，守卫里的 `withCompactionOptions` 在启动 `opencode serve` 之前就抛出 `Compaction reasoning options are required`，shim 以 code=1 退出。role-warm 的 `daemon.log` 有这行 stderr；冷驱动不转发 stderr，所以 role 组 ledger 里只有 `OpenCode server exited during startup (code=1)`。直接运行证据里的 role shim，同样立刻打印该错误并以 1 退出。漂移门禁自己解析了这些选项，所以不受影响。
- 修法：新增 `readOpenCodeCompactionOptions`（`drift-opencode-guard.mjs`），执行 `opencode models <provider> --verbose --pure` 并取批准 variant 的选项。`guarded-shim.mjs` 的 `resolveGateShimOptions` 是唯一调用方，拒绝调用方自带 `compactionOptions`。`prepareGateDaemon` 为效率组和漂移组统一调用它并返回解析结果，漂移组删掉了自己的解析；两组都把解析结果记为 `arm.compactionOptions`。`writeGuardedShim` 现在拒绝写出没有压缩选项的 OpenCode shim。守卫没有放宽。
- 验证：`guarded-shim.test.mjs` 新增两例，已先确认失败：一例是缺选项时拒写，另一例用 fake CLI 目录验证选项来源、参数和调用方覆盖被拒。另外用真实 `opencode serve`（1.18.32，临时 HOME，只读 `models` 目录，没有模型调用）跑了一次免费验证：经守卫的 shim 通过了配置核对并开始监听，`GET /config` 返回 `model`/`small_model` 为批准绑定、`agent.compaction.options={"reasoningEffort":"low"}`；`PATCH /config` 被 403 拒绝；临时库中会话数和消息数都是 0。付费效率门禁尚未复跑。

### 三十一、累计付费验收（2026-09-25，d917f01，负责人授权）

证据 `docs/evo/evidence/2026-09-25-acc-*.json`（脱敏版，附原始摘要）。模型：Codex gpt-6-luna/low、Claude haiku、Kimi k3-256k/low、OpenCode deepseek-flash/low。

效率门禁（与原生同题 3 轮）：

- Codex：固定开销 2.78k（≤3k，未回退；先前“8.3k”是把逐生成累加的分解项误读为固定开销）。续轮生成与原生相同、输入在预算内，常驻续轮约 7 s vs 原生 9–10 s。首轮多 1 次回复前生成，为模型重读文件（业务工作路径差），平台无协议调用；合同 §6 两处口径冲突待负责人裁定。
- Claude haiku：常驻续轮达标；首轮固定开销 3.8k、延迟 +6 s 超预算。每轮组第 3 轮（重启后）模型把发帖命令写进代码块，重试一次后正确，门禁硬失败中止该组。
- Kimi：可测子项全部在预算内（回复时间为原生 41–76%），用量不可得故 missing-evidence。首次运行因门禁 Kimi 守卫拦截 mode=default 而隔离，已修（第二十九节）。
- OpenCode：每轮组 3 轮在预算内；常驻组首轮纯文本未发帖，重试后正确，门禁硬失败中止。首次运行因门禁未传压缩选项失败，已修（第三十节）。
- Codex 常驻重启续聊：daemon 重启后同 session 续聊，第 3 轮在延迟与输入预算内。

长会话漂移（10 轮，第 5 轮后压缩）：

- Codex 常驻、OpenCode 常驻：门禁通过（0 重试、压缩后无退化）。
- Claude 冷/热：沉默轮各一次未执行 message-check → 重试一次；其余正确，送达/目标/Task/final 全对。
- Kimi 冷：行为全部正确（0 重试），但每轮事后模型核对读不到 wire 记录（modelEvidenceMissing）且压缩未观测到，判 missing-evidence；属门禁取证问题，待修。

首轮纯文本调查（`~/.loom/reviews/2026-09-25-first-turn-plaintext.md`）：失败与成功首轮的平台输入归一化后相同；首轮失败 4/34，后续应答轮 0/136，均一次重试后恰好一条回复。属模型遵守度，原生 CLI 默认把正文当作回答是结构性诱因。

### 三十二、验收后续修复

范围：第三十一节与首轮纯文本调查（第 4.1、5 节）指出的三项；不改提示词、不改前端，没有运行付费 CLI，没有重启服务。

1. 干净退出未回帖的重试路径（Kernel）：
   - 根因：RunAttempt 干净结束（exit 0 或原生 turn 成功）却既未回帖也未 ACK 时，Host 走通用运行错误退避（`retryAfterMs` 起按次数翻倍），Activation 的 `available_at` 在未来，Host 本轮变空闲后按 `pollIntervalMs` 等待；门禁配置下约 10 s 退避 + 下次轮询，即调查中约 30 s 的空等。fake 时钟测试复现为两次尝试之间恰好 30 000 ms。
   - 修法：在既有重试 owner `retryActivation` / `applyActivationRetryPolicy` 中，Kernel 依据持久事实判定该类别（`previousAttemptCleanExitUnconfirmed`：错误恰为 Kernel 自己的“delivery not acknowledged”拒绝且未附运行失败、最新 RunAttempt 为 `exited`/exit 0 或空且无错误与信号、本 Activation 没有 `message.posted`、处置为 `recoverable`），此时 `available_at = now`，并在同一事务里写一条 `activation.requested` Outbox 唤醒提示（挂在 `activation.retry_scheduled` 事件的 seq 上）。其他类别退避不变；同错误指纹围栏照常计数，连续 3 次仍隔离，被阻断的重试不发提示。没有新队列，RunAttempt 记录不变，重试仍是新的 RunAttempt 并带既有一行提醒。
   - 测试：`packages/kernel/test/activation-unconfirmed-retry.test.ts`（立即可租并有唯一新提示；exit 1、附运行失败的拒绝、已回帖、RunAttempt failed 四类仍按原退避且无提示；连续 3 次仍触发围栏）；`agent-host.test.ts` 新增 Host 循环用例（fake 时钟只随循环自身等待前进，第二次尝试开始时间等于第一次结束时间，唯一等待是完成后的空闲轮询）。
2. 效率门禁重试轮：
   - 根因：`rah.mjs` 断言每轮恰好一个 RunAttempt（`Unexpected follow-up Run`），一次 Kernel 重试就中止整组，后续轮与热/冷对照全部丢失；用量只取第一个尝试。
   - 修法：新增 `scripts/cli-efficiency/round-retry.mjs`。`roundRunVerdict` 在多尝试轮要求恰好一条回复、无线程/他房错投、恰有一个尝试提交 `final`、所有 Activation completed、无隔离、每个尝试运行成功，否则硬失败；单尝试轮保持原检查。`mergeRoundProductUsage` 把各尝试的产品用量求和（生成拼接、totals 求和、完整度取最差、execution 取第一个尝试）。Codex 轨迹核对改为每个尝试一个 turn。`compareRounds` 对 `retried` 轮固定加失败项 `retried`（超预算），`compareArm` 输出 `retriedRounds`。门禁文档已同步。
   - 测试：`round-retry.test.mjs`（软项成立；重复回复、无回复、final 缺失/未采集、ACK 未完成、隔离、线程错投、他房错投、尝试失败均硬失败；用量求和；`retried` 轮即使求和后在预算内也判超预算并列入 `retriedRounds`）。
3. Kimi 漂移门禁取证：
   - 根因一（modelEvidenceMissing）：kimi-code 0.39 的 session id 本身带 `session_` 前缀（产品记录与 print 模式 resume hint 都是 `session_<uuid>`，也是目录名），而 `provider-files.mjs` 的 `kimiWirePath` 按 `session_${sessionId}` 拼目录，得到 `session_session_…`，永远找到 0 个 wire。wire 实际在 `~/.kimi-code/sessions/wd_workspace_…/session_<uuid>/agents/main/wire.jsonl`，产品没有使用临时 `KIMI_CODE_HOME`。同一缺陷也使第三十一节 Kimi 效率门禁两组 6 轮全部 `launch-guard-only`、用量不可得（证据 `wireError: Expected exactly one Kimi session wire, found 0`），并非 CLI 不给数据。早先 r2 的 `modelEvidence` 为 null，是因为当时还没有逐轮核对。
   - 根因二（压缩 observed=false）：压缩确实发生（wire 有 `full_compaction.begin` → `context.apply_compaction`（tokensBefore 28174 → tokensAfter 27318）→ `full_compaction.complete`，约 13 s 完成），但 0.39 的 `/compact` 在后台运行、回复里没有 “Compaction completed”，门禁只靠 `/usage` 下降判定；压缩后的 `/usage` 是重估值（`token_counting.rebased`，27318），大于压缩前的实测值 26405，于是一直等满 240 s 超时并判未观测。r2 上下文较大，重估值仍低于压缩前，所以 observed=true。
   - 修法：`kimiWirePath` 接受带或不带前缀的 id，sessions 目录 glob 找不到时查 CLI 自己的 `session_index.jsonl`（`sessionDir`），仍要求恰好一个，否则抛错（读不到 = missing，不判通过）。新增 `kimiWireCompactions`（`kimi-usage.mjs`）与 `kimiCompactionObserved`（`drift-compaction.mjs`）：以 wire 中本次请求之后已完成的原生压缩为持久证明，回复完成或 `/usage` 下降仍可作证；轮询在 wire 出现完成记录时即停止；记录保留 `wireCompactions`/`wireError`。
   - 测试：`kimi-wire-evidence.test.mjs`，夹具 `fixtures/kimi-acp-0.39-session/wire.jsonl` 为该次付费运行的真实 wire（只保留门禁读取的记录类型，去掉提示与消息正文，压缩摘要替换）。覆盖：真实带前缀 id 与裸 id 都能定位；仅索引可达的布局；缺失时抛错且 `checkRoundModels` 为 missing；第 1 轮窗口核对为 verified（3 条请求，k3-256k/low）；压缩在 `/usage` 增长时仍由 wire 观测到，没有 wire 证明或只有 begin 未 complete 时不观测。

检查：`npm run check`、`npm run format:check`、`git diff --check` 通过。未验证：三项都没有真实 CLI 复跑；修复 1 在真实 Host 上省下的时间、修复 2 的软项在付费门禁中的表现、修复 3 在真实 Kimi 门禁中的逐轮核对与压缩观测，都需下一批经负责人授权的付费运行确认。单尝试轮的多条回复（例如先发进度再发结论）仍按原口径不判硬失败。

### 三十三、门禁口径：业务路径差与压缩后趋势

负责人 2026-09-25 裁定：（A）模型因工作路径不同（重读文件、换读取方式）多出的业务生成不计入平台开销判定，但照常统计并报告；（B）另监测多轮压缩后平台开销是否累积升高；（C）目标合同 §6“当前基线”列改名为“9/23 基线”（已改，只改列名与一行说明）。只改门禁脚本与文档，不改产品代码与提示词，没有运行付费 CLI，没有重启服务。

1. 效率门禁（A）：新增 `scripts/cli-efficiency/tool-calls.mjs` 统一四家工具调用分类（原先 `common.mjs`、`claude-usage.mjs`、`drift-checks.mjs` 各有一份正则）。Worker CLI 调用（`message-post`/`message-check`/Task 命令/`worker help` 等其他 `worker <命令>`）与读 `MEMORY.md` 为协议；其他可识别调用为业务；参数缺失无法判定的为 `unknown`，RAH 侧按协议计（保守）并在 `notes` 标 `toolCategoryUnknown`；原生侧没有 Worker CLI，全部调用按业务计。`worker help message-post` 现归为 `worker-command`，不再误记为 box-post。`compareRounds` 新增 `workPath`（业务调用数、按类别/种类计数、回复前业务调用及其切分依据）、`workPathExtraGenerations`/`workPathExtraGenerationsBeforeReply`（RAH 业务调用 − 原生业务调用，带符号：RAH 少做业务不能掩盖协议生成）、`extraGenerations`（原始整轮差）、`extraProtocolGenerations`/`extraProtocolGenerationsBeforeReply`（原始差 − 业务差，预算只判这两项）；没有工具调用证据时不抵扣并标 `workPathUnavailable`。回复前业务调用按 `replyAt`（`rah.mjs` 新写入轮次指标）切分，回复后的业务调用不抵扣回复前。输入：`input = {raw, workPath, judged, budget}`，`workPath = 业务差 × 原生首请求`，按 `judged` 判 2×(原生+3k)，原始总输入与 `inputRatio` 照常报告；`inputDecomposition` 把 `extraGenerations` 拆为 `workPathGenerations` + `protocolGenerations`；`workPathVariance.rounds[]` 增加 `extraGenerations {raw, workPath, protocol}` 与调用计数。终端逐轮打印 `formatComparisonRound`（原始/业务/协议额外生成、业务调用、种类计数、原始/判定输入）。按本口径，9/25 调查中第 1 轮“RAH sed→nl 重读、原生一次 nl”那一次生成记为业务（协议差 0）。
2. 漂移门禁（B）：`evaluateRound` 记录 `checks.toolCalls` 与 `checks.protocolCalls`（协议 + 未知；未采集为 null）；表格新增 `proto` 列。新增 `summarizeCompactionOverhead`：以首次压缩前（第 1 轮至首个压缩轮）为基线，每次压缩后到下一次压缩（或末轮）为一个窗口，报告每轮平均输入、未缓存输入、生成数、协议调用数，相对基线的比值 `ratio` 与相对上一窗口的逐次变化 `step`；任一窗口平均输入或协议调用相对基线升高超过阈值（默认 +25%，`RAH_DRIFT_OVERHEAD_RISE` 可调，(0, 10]）即 `compactionOverheadRising`；未缓存输入与生成数只报告。结果写入 `summary.compactionOverhead`，`summary.degradation = {behavior, compactionOverhead}` 为 `noDegradation` 的两个独立子项，任一为 false 即 `violated`。无压缩为 `no-compaction`，缺用量为 `insufficient-data`（不判上升，也不判达标趋势）。
3. 测试：`tool-calls.test.mjs`（分类、未知、计数）；`metrics.test.mjs` 新增纯业务重读（生成与输入都不超预算但照常报告）、多一次协议调用超预算、RAH 少做业务仍超预算、类别未知保守计入、无工具证据不抵扣、回复后业务调用不抵扣回复前、终端行、输入分解拆分；原“残留与业务差异”用例补新字段。`drift-checks.test.mjs` 新增协议调用计数、单次压缩平稳、两次压缩第二窗口上升（含逐次变化）、协议调用上升、恰好等于阈值不算上升、阈值可调、未缓存与生成只报告、无压缩与缺用量、并入 `noDegradation`；`drift-config.test.mjs` 覆盖阈值默认值与非法值。
4. 局限：业务差按工具调用数计，一次生成内并行发出的多个业务调用会多抵扣（种类计数已写入证据供人工核对）；工作路径差对输入的估计只取“业务差 × 原生首请求”，重读输出在后续生成中的累积仍算在 RAH 侧；第 1→2 轮 `round1HistoryDelta` 仍无法拆出工作路径部分。压缩后趋势的窗口含不同题型组合（基线含 fyi/other 等），比值受题型构成影响；上下文随轮数自然增长，基线窗口与压缩后窗口长度不同。两项口径尚无付费样本验证。

检查：`npm run check`、`npm run format:check`、`git diff --check` 通过。

### 三十四、付费复测（2026-09-25，5273e78，负责人授权）

证据 `docs/evo/evidence/2026-09-25-recheck-*.json`。

- Kimi 效率门禁：修复后 wire 可读，tokens 与生成数已测到；输入约为预算一半，协议额外生成 0、业务路径差 0；第 1、3 轮回复延迟超预算；产品侧用量（ACP 不报）仍缺，判 missing-evidence。
- OpenCode 常驻效率门禁：本次首轮未发生纯文本（0 重试，立即重试路径未被触发、未验证）；三轮输入与生成在预算内；第 1 轮延迟 19.6 s vs 原生 10.1 s 超预算（推测为首次 serve 启动与建会话），续轮达标。
- Codex 常驻 20 轮、第 5/10/15 轮后压缩：压缩后开销趋势平稳——各压缩后窗口平均输入为基线（r1–5，52k）的 0.63/0.67/0.78 倍，协议调用 1–1.2 次/轮；行为除第 3 轮沉默轮未 message-check 重试一次外全部正确。
- 待办：Kimi 与 OpenCode 首轮延迟（冷启动）单独调查。

### 三十五、S3 私聊：隔离、共享 session 与可见性

按 S3 计划（S3-a/b/c）补测试与缺口；没有运行付费 CLI，没有重启服务，没有改前端。

1. S3-a 隔离与防 steer：新增 `packages/kernel/test/instance-private-box.test.ts`，共用 fixture 从 `role-instance-lifecycle.test.ts` 抽到 `role-instance-fixture.ts`。修复两处：
   - 私聊轮 `reminders/schedule --channel #频道` 原本成功，触发时会把私聊锚点与标题带进频道。`reminder-service.ts#resolveTargetRoom` 对 Role 实例复用 `requireInstanceReplyTarget`：提醒目标必须是本 Activation 房间，否则拒绝，且不写 reminders 行与事件（非实例 Agent 不变）。
   - 频道轮用 `dm:@owner` 或私聊房间 ID 读写私聊（history / message-read / messages-post），原本报“目标不存在”，发帖时还会尝试新开私聊（被“仅 Human 可开私聊”挡下）。`resolveWorkerReadTarget` 现先判断：已加入但只被实例执行范围隐藏的房间，按 `Room is outside this instance execution scope (private box isolation)` 拒绝，不再尝试打开私聊。
   - 锁定现状：仅本频道 Human 可开私聊（Agent、不在频道的 Human 被拒，房间、配对、控制房间事件都不变）；实例自己不能开私聊；steer 矩阵经 `readPendingRuntimeNotice` 验证：频道轮中其他实例与 Agent 的消息不注入、同频道 Human @ 注入；私聊轮中频道 Human @ 不注入、第二条私聊注入。
2. S3-b 共享 session（没有改代码）：
   - 冷路径（`codex-provider-session.test.ts`，fake Codex）：同一实例频道轮 → 私聊轮 → 频道轮，第一轮 `thread/start`，后两轮 `thread/resume` 同一线程；每轮的 `RAH_ROOM_ID/FROM_SEQ/TO_SEQ` 是各自 Activation 的值。
   - 热路径（`codex-warm-runtime.test.ts`，fake 热进程，新增 `privateBox` 选项；fake 在 turn 记录里带上本轮 scope）：一个进程、一个原生线程、同一 `instance_runtime_id`，执行模式依次为 cold/warm/warm，每轮 scope 为本 Activation 的房间与区间。热路径 harness 仍用旧式 Agent 参与者（AgentHost 走 lease 路径，没有 Role 实例上下文），只证明 Host 的 session/热进程键与房间无关；Role 实例语义由 Kernel 测试覆盖。
   - Kernel：频道轮绑定后，私聊 Activation 的认领上下文 `instanceSessionRequired=true`；reset 后私聊轮代数为 1、不要求绑定，私聊轮绑定后频道轮代数 1 且要求绑定。私聊 Activation 完成后频道 `subscription_cursors` 不变；两边交错到达时，各自后续 Activation 的 `from_seq` 大于本房间上次 `toSeq`，等于本房间第一条新请求的序号。计划原写“from_seq = 上次 toSeq + 1”，与现有语义不符：`from_seq` 是触发事件序号，中间的系统事件（租约、运行记录）只作上下文，测试按实际语义断言。
3. S3-c 退出、重新实例化与可见性：
   - 锁定现状：Human 被移出频道后，该私聊发帖、建线程、转发都被拒，没有新 Activation；`message.list` 仍能读历史；重新加入频道后同一私聊恢复可用。移除实例并重新实例化后，对新实例 `room.direct.open` 得到另一个房间，旧私聊仍失效。
   - 新增：`room.list` 与 `room.direct.open` 返回的实例私聊带 `instancePrivateBox: { instanceId, active }`，由 `activeInstancePrivateBoxPredicate` 计算（`instance-worker-scope.ts#withInstancePrivateBox`）；其他房间和普通 Human 私聊不带。protocol `RoomSchema` 增加可选字段；client-sdk 类型直接来自 protocol，没有单独声明，无需另改。其他返回 Room 的接口不带这个字段。
4. 推迟项（带触发条件）：
   - 移除实例时自动取消私聊待办：现在私聊有待办时移除被拒（`active collaboration work`），合同要求停止投递并安全终止。触发：S2 生命周期或实例移除流程改动时一并处理。
   - 实例被隔离期间私聊不可用：唯一出口是 Human session reset。触发：控制台展示隔离状态时（阶段 4）补说明，或 reset 语义变化时。
   - 多个 Human 共用同一实例 session，会把彼此的私聊内容带进上下文：目前是单 Human 范围，由负责人决定策略。触发：启用多 Human。
   - 控制房间的 `workspace.direct_opened` 事件元数据不标实例私聊。触发：控制台或审计需要从事件区分私聊时。
   - 活动状态不区分“私聊排队中”和“已唤醒”。触发：阶段 4 前端接入。
   - fork 复制私聊上下文、不继承私聊访问权：S4。
5. 当前局限：`instancePrivateBox` 只出现在 `room.list` 与 `room.direct.open`，侧栏、事件流等其他 Room 投影没有这个字段；控制台不存在，“控制台可见”未满足。

检查：`npm run check`、`npm run format:check`、`git diff --check` 通过。

6. 审查修复（依据 Codex S3 审查 `~/.loom/reviews/2026-09-26-s3-review.md` 的 P1-1、P1-2、P2-1，负责人批准）。先写失败测试并确认失败，再最小实现；没有运行付费 CLI，没有重启服务，没有改前端。上面第 1 条“私聊提醒不进频道”只修了创建入口，列表、幂等重放和升级前的存量在本条补上。
   - P1-1 提醒列表与幂等重放：原先频道轮 `reminders/list`（默认、`all`、`canceled`）会返回同实例私聊轮建的提醒，用私聊轮原来的幂等键重放 cancel/update/snooze/schedule 会返回 `deduplicated:true` 和整条私聊提醒。现在 Role 实例的 Worker 列表只返回本 Activation 房间（提醒的锚点房间）的提醒；四种修改的 receipt 重放在返回前按当前执行房间重新校验，跨房间一律报 `outside this Worker execution scope`，且不改提醒。旧式 Agent 的列表和重放不变。测试 `packages/kernel/test/instance-reminder-scope.test.ts`，schedule 重放显式带原 `basedOnRoomSeq`，确保被拒是因为执行范围，而不是幂等冲突。
   - P1-2 升级前的跨房间提醒：`#deliverOccurrence` 在投递事务里再检查一次 Role 实例提醒的锚点房间是否等于目标房间。不相等时这次 occurrence 标为 `obsolete`（终态，不重试），提醒改为 `canceled`，重复提醒因此不会再排期；只在提醒自己的日志里记一条 `canceled`（`reason: instance_cross_room_target`），不写 Room 事件，不派生 Inbox/Activation。旧式 Agent 的合法跨房间提醒照常触发（`reminder-service.test.ts` 原有测试仍通过）。测试用临时库重建父版本允许的存量（单次与 `every:15m` 两种），断言没有 `reminder.fired`、两房间序号不变、Inbox 和 Activation 数量不变，后续 reconcile 也不再排期。
   - 存量检查（只读，不改正式库）：`sqlite3 -readonly "file:$HOME/.loom/evo/state/room.db?mode=ro"` 执行以下两条。第一条列出还会被新守卫取消的存量，第二条列出升级前已经泄漏过的历史触发：
     ```sql
     SELECT r.reminder_id, r.status, r.room_id, r.target_room_id, r.repeat_rule, r.fire_at
     FROM reminders r JOIN role_instances i ON i.instance_id = r.owner_participant_id
     WHERE r.room_id <> r.target_room_id;
     SELECT e.room_id, e.room_seq, e.aggregate_id
     FROM room_events e JOIN reminders r ON r.reminder_id = e.aggregate_id
     JOIN role_instances i ON i.instance_id = r.owner_participant_id
     WHERE e.type = 'reminder.fired' AND e.room_id <> r.room_id;
     ```
     2026-09-26 在正式 evo 库只读执行了一次：两条都没有返回行，`reminders` 和 `role_instances` 当前都是 0 行，所以正式库没有存量要处理。这是当时的结果，不代表以后。
   - P2-1 Role 热路径组合验收：新增 `packages/agent-host/test/role-warm-hot-path.test.ts`（fake Codex 热进程，免费）。流程从真实的 `roles.instantiate` 开始，经过 AgentHost 的 Kernel placement 认领路径；适配器由生产注册表 `createWarmRuntime` 按每次认领新建，用生产的 ProviderSessionStore 和运行时键，Worker HTTP API 也是真实的。验证内容：
     - 频道轮进行中私聊排队：只有一个运行中的 RunAttempt，Kernel 不再发出第二个 placement，私聊也不 steer 频道轮。
     - 频道、私聊、频道三轮共用一个进程、一个原生线程和同一 `instance_runtime_id`，执行模式依次为 cold/warm/warm。
     - 每轮 scope 是自己 Activation 的房间与区间，turn 凭据互不相同，Worker CLI 调用都被接受。
     - Human reset 后，旧运行时被终止、不再复用，下一轮冷启动新进程和新会话，没有 resume。
       该测试首次运行即通过（这是验收，不是行为修复）。为确认断言有效，临时去掉生产运行时键里的会话代数：reset 断言按预期失败，改动随后已还原。
   - 验收边界更新：第 2 条所说“热路径 harness 仍用旧式 Agent”的缺口，现在由 Codex 的 Role 热路径组合测试补上。仍然不证明真实 Codex 协议，也不证明 Claude/Kimi/OpenCode 的 Role 热路径。同一 session 会记得私聊内容，这不是内容防泄漏沙箱；现在能承诺的只有工具与 API 的权限和投递范围。“忙时移除实例被拒”仍是暂时限制，不算生命周期验收通过：控制台提供移除操作之前，必须补上安全停止/取消，或者明确展示拒绝原因和清理路径。控制台仍不存在。

### 三十六、同一 CLI 多实例并发

依据 `~/.loom/reviews/2026-09-26-scenario-capability-audit.md` 的并发发现（合同 §3“不同实例并行”）与负责人随后的裁定（两级上限、运行中可配置、启动限流）。先写失败测试再最小实现；没有运行付费 CLI，没有重启服务，没有改前端。

1. 根因：本地服务的 daemon 配置每次启动由 `local-workbench-bootstrap.ts#buildConfig` 在内存中生成，每个 CLI offer 写死 `maxConcurrent: 1`，Host 上限写成 CLI 种数。同一 CLI 的所有实例共用一个 offer，Kernel 规划器按 offer 满额判 `capacity_exhausted`，所以不同 Role、不同频道的同 CLI 实例只能串行。规划器本身（`lane_busy` 保证每实例单 lane，满额只挂起不失败）、`MultiLaneAgentHost` 多 worker、常驻池（按实例的 busy 槽与 LRU）、清扫（按 runtime id 标记）都已支持并发 >1。`config.ts` 的 `z.literal(1)` 只属于旧 v3 单运行时配置，v3 在 `daemon-application.ts` 固定单 lane，保持不变；本地服务用的 v4 早已允许 1–64。
2. 两级上限与启动限流（全部由 Human 运行中修改）：
   - 全局：同时运行的实例数，Kernel Host 上限；默认 20。
   - 每家 CLI：该 CLI（RuntimeProfile）的实例数，Kernel RuntimeProfile 上限；默认 4。
   - 启动闸门：同时启动数与启动间隔，默认 5 个、500 ms（沿用 Raft 默认与既有 `RAH_DAEMON_*` 环境变量作为缺省来源）。
   - offer 本身改为公布配置上限 64（`DaemonConcurrencySchema` 最大值），不再承担调度上限；任一上限达到时新工作持久挂起（queued），不失败。
3. 默认值依据：全局 20 = 常驻池忙时硬上限 `maxBusyTurns`，规划器在同一处挂起多余工作，而不是让常驻池等待后按可恢复失败重试；全局值调大时常驻池忙时上限随之同步（`InstanceRuntimePool.setMaxBusyTurns`，唤醒等待中的轮次）；调小只由 Kernel 规划器约束，常驻池保留当前上限，重建时取持久化值（第三十八节）。每家 CLI 默认 4 没有依据：Claude Code、Codex、Kimi、OpenCode 都没有公开的同时 session 上限（未联网核实），取保守值，需要时由 Human 调大。【无依据，保守值】
4. 运行中配置：新增 Human 鉴权的 `/v3/client/runtime-settings/read|update`（第三十八节由 runtime-concurrency 改名；protocol `runtime-settings.ts`；带 `expectedRevision`，未配置的 RuntimeProfile 与越界值被拒）。唯一所有者是 daemon 的 `RuntimeSettings`，持久化到数据目录 `runtime-settings.json`（0600，原子替换；旧 `runtime-concurrency.json` 启动时迁移一次），重启后保留；没配置过的项取默认值。`daemon-runtime-settings.ts` 在启动时和每次修改后应用：Kernel `placementCapacity.update`（新的 `PlacementCapacityLimits` 所有者，从 `room-kernel.ts` 移出）、`MultiLaneAgentHost.setCapacity`（调大立即增加 lane；lane 只增不减，调小不减少 worker 数，历史 lane 继续轮询认领，最多 64 个，带来空认领与 heartbeat 开销；新工作靠 Kernel Host 上限约束，同实例单 lane 仍由 Kernel `lane_busy` 保证）、`AgentStartGate.updateSettings`、常驻池。修改只影响之后的调度，运行中的不受影响；调小启动上限时已放行的启动继续，直到低于新值才放行下一个（启动闸门的上限不变量改为只在占用槽位时检查）。client-sdk 与前端没有加入口（阶段 4）。
5. 正式库迁移：不直接改 room.db。下次启动时 offer 发布器以 64 重新发布同一 offer ID，`maxConcurrent` 属于能力摘要，生成一条新的不可变 observation；上限不变的重复发布只续租。设置文件不存在时用默认值，第一次修改才写入。
6. 测试：
   - `local-workbench-bootstrap.test.ts`：offer 为 64、Host 默认 20（修复前为 1，按预期失败）；`maxConcurrentRuns` 越界被拒。
   - `offer-concurrency-republish.test.ts`（Kernel，Role 实例）：旧 observation 为 1 时只放行一个，以更大值重新发布后跨频道并行；每家 CLI 上限和 Host 上限各自触发排队；运行中调大放行、调小不影响已运行、只约束新工作。
   - `same-cli-instance-concurrency.test.ts`（组合 daemon + Fake CLI，结论读 room.db）：三个实例共用一个 offer，两个同时运行、第三个 queued 无失败、忙碌实例追加消息不开第二条 lane；经设置 API：每家上限 1 → 只跑 1 个，调到 3 → 被 Host 上限 2 挡住，Host 调到 3 → 新增 lane 放行第三个，Host 调到 1 → 已运行的 3 个不受影响、下一轮只跑 1 个；未鉴权 401；设置文件内容核对。关闭应用逻辑或 lane 扩容时该测试失败（已验证）。
   - `runtime-settings.test.ts`：默认值、修订号冲突、未知 RuntimeProfile、越界、0600 持久化与重启后读回。
   - `agent-start-coordinator.test.ts`、`instance-runtime-pool.test.ts`：启动上限运行中调大立即放行、调小不打断；常驻池调大忙时上限放行等待中的轮次。
7. 风险与未解决：全局 20 意味着默认 20 个 lane worker，每次唤醒提示最多 20 次认领事务（此前生产为 4 个）；lane 只增不减。冷路径（Kimi、默认的 Claude）进程数只受这两级上限与逐 run 资源上限约束。多个实例在同一共享仓库目录同时写入的问题仍在（没有每实例 worktree，见审计 P1）。每家 CLI 默认值无依据。效率门禁 `gate-daemon.mjs` 也走新默认，单实例门禁行为不变。本地服务尚未重启，正式库 offer 仍为 1，下次启动才更新。

### 三十七、唤醒防循环与运行看门狗

依据 `~/.loom/reviews/2026-09-26-upstream-substrate-research.md` 第 1、2 节、`~/.loom/reviews/2026-09-26-scenario-capability-audit.md` A、I 节与负责人裁定 A/B/C。先写失败测试再最小实现；没有运行付费 CLI，没有重启服务，没有改前端。

1. 唤醒规则（裁定 A，参考 Multica `comment.go:2685`“agent 作者跳过隐式路由”）：
   - agent 作者发的消息只有显式 `@` 才唤醒其他 agent。规则按作者 `principals.kind='agent'` 判定，不查 `role_instances`、不限定 room 类型，所以 Role 实例和旧 Agent 都适用（旧 Agent 的隐式路由唤醒同样取消，不是保留旧逻辑）。`room_policy`、线程关注者、回复链、线程根都不再唤醒。Worker 路由 `workerReplyRecipients` 只保留 @ 解析结果，事件 `recipientIds` 与实际唤醒一致。
   - 同一规则在 Kernel 注意力派生处（`RoomEventWriter.deriveAttention` → `instance-wake-guard.ts`）统一强制：agent 作者的 `message.posted` 里非 `mention` 的收件人不写 Inbox、不建 Activation；`mention` 收件人还必须出现在 `RoomEventWriter` 为该消息绑定的 canonical mentions（按 participantId，不按显示名重新匹配）里，否则同样拒绝（第三十八节补上；此前守卫只信 `reason`）。
   - Human 消息规则不变（ADR-0015 已补充说明）。Task 指派、审查等非消息事件不属于本规则，也不计数。
2. 合并：实例已有排队中的 Activation 时，新触发只把 `to_seq` 并入它（既有机制，本次用测试锁定）。
3. 连续激活上限：
   - 每个频道记录“自上一条 Human 消息以来连续的实例→实例唤醒次数”（表 `instance_wake_guards`）。每次唤醒决定（放行或拦下、当时的计数与上限）按“唤醒事件 + 收件人”记在因果链表 `instance_wake_chain`。
   - 一次唤醒按收件人计一次，并入已有排队 Activation 也计。上限默认 10：第 11 次起不写 Inbox、不建 Activation，消息本身照常入频道。每次越限在频道里只写一条系统消息（`principal_system`，`systemNotice: instance_wake_chain_limit`），说明原因和继续方式：Human 在本频道发任意一条消息即重置。
   - 计数按频道统计，覆盖该频道的顶层和所有线程，Human 在任一线程发言都会重置。不同频道各自计数，私聊房间也是独立频道，Human 在一个频道发言不影响其他频道。
   - Schema 升到 70，只新增这两张表。
4. 看门狗（裁定 B，参考 Raft 1.0.32 daemon 语义，去掉“2 分钟无首事件即杀”）：
   - 规则只有一处定义（`agent-host/src/run-watchdog.ts`），冷热路径共用：
     - 无进展达到告警阈值（默认 15 分钟）：只告警，写诊断日志，并写一条 `run.watchdog_warning` 活动事件。每个 RunAttempt 至多一条，幂等；实例活动列表显示为 warning，不改 run、Activation 或 Task。
     - 同一实例已有排队工作，且无进展达到终止阈值（默认 15 分钟）：终止并重试。“排队工作”包括私聊排队：私聊排队也会触发该实例频道工作的终止（只是调度恢复，不会把私聊内容 steer 进频道）。
     - 总时长达到上限（默认 4 小时）：不论有无进展，终止并重试。
   - 进展定义：冷路径以 provider 轨迹或用量帧为准，不看 stdout 文本；热路径沿用原生轮次进展时钟（传输心跳不算），等待审批时不算停滞，但总时长上限照样生效。冷热在审批上不对称：冷路径没有审批豁免，只看进展时钟；当前无人值守权限策略下很少出现，以后支持真实等待审批时须接入统一状态，不能只凭共用决策函数声称一致。
   - 看门狗是时间策略，不是卡死证明：静默的编译、测试、外部工具或无事件的长推理都可能正常却被终止，15 分钟与 4 小时不能宣传为不会误伤长任务。
   - 冷路径由 AgentHost 监督：`watchRunProgress` 与原有存活探测并行。热轮由适配器监督：`warm-turn-supervisor.ts` 调同一规则，适配器声明 `supervisesRun` 后 AgentHost 不再重复监督。原来的 `stallMs`、`toolStallMs` 策略（15 分钟无进展即中断，工具运行时 60 分钟）已删除；配置里的旧键仍可解析，但不再使用。
5. 终止与续接：
   - 走既有终止证明路径。冷路径：`runtime.cancel`，先向进程组长发 SIGTERM，宽限后对进程组发 SIGKILL，宽限沿用现有 `terminationGraceMs`，本地服务为 5 秒。热路径：先原生 interrupt，静默等待上限内收尾则运行时保留；否则 `abortRuntime`，SIGTERM 后按 pool `killGraceMs` 发 SIGKILL，终止原因记为 `stall`。
   - RunAttempt 状态冷热不同：冷路径记 `timed_out`；热路径按原生收尾结果或实际退出记 `cancelled`/`failed`/`exited`，并带 watchdog 失败文本；两路都写终止证明，不为统一而伪造原生退出结果。Activation 按可恢复失败重试，同房间排队的后续工作并入重试（跨房间不合并）。重试续接原会话：热路径 interrupt 收尾时仍在同一进程、同一线程；被杀时新进程 `thread/resume` 同一线程。冷路径按既有 resume 续接。
   - 最终答复已提交的 run 不重跑，只做完成（仍需 ACK 到 `toSeq`）。
   - 失败文本不含变量数字（`LOOM_RUN_WATCHDOG_QUEUED_STALL` / `LOOM_RUN_WATCHDOG_MAX_DURATION`），同一错误连续 3 次即由既有 retry fence 隔离（`activation.retry_blocked`）。fence 按 Activation（`activation_id`）计，隔离的是该 Activation，不是实例的全局错误计数，不阻断该实例在其他房间的新工作。资源失败仍用原来的 `stallRetryBudget`。
6. 运行中配置（裁定 C，与第三十六节的并发设置共用一份，不另建存储）：
   - 同一文件 `runtime-settings.json`、同一修订号、同一 Human 鉴权 API `/v3/client/runtime-settings/read|update`，新增并列分组：
     - `wakeGuard.instanceChainLimit`：1–1000，默认 10；
     - `watchdog.noProgressWarnMs`、`watchdog.queuedStallTerminateMs`：1 分钟–1 天，默认各 15 分钟；
     - `watchdog.maxRunMs`：1 分钟–7 天，默认 4 小时。
   - 分组可以只改部分字段，越界值被拒；文件只保存改过的字段。
   - 边界、默认值与 Host 读取结构定义在 protocol `run-watchdog.ts`。`DaemonRuntimeSettings.attach` 在启动时和每次修改后把两组推给 Kernel `runGuards`（进程内唯一所有者 `RunGuardPolicy`）。唤醒上限在每次派生时读取；Host 每个监督周期经控制端口 `readRunWatchdog` 读取阈值和“同实例是否有排队工作”，所以运行中的 run 也在下一周期生效，无需重启。
   - 只有 v4 daemon（本地服务）有该设置；v2/v3 与单独使用 Kernel 的测试取默认值。
7. 测试（全部 fake，结论读 room.db）：
   - `kernel/test/instance-wake-guard.test.ts`：
     - 实例顶层回复不 @ 不唤醒；Human 顶层仍唤醒全部。
     - Worker 回复 @ 只唤醒被 @ 者；线程里不 @ 不唤醒关注者，Human 线程回复仍唤醒关注者。
     - 任何门面传入的非 mention 收件人都被拒。
     - 排队中合并到同一 Activation。
     - 第 10 次放行、第 11 次拦下，只写一条系统提示；Human 发言后重置，再次越限会再次提示。
     - 线程与顶层共用一个计数，线程内 Human 发言也重置；频道之间互不影响。
     - 上限修改立即生效。
   - `kernel/test/run-watchdog-service.test.ts`：默认值、部分更新与校验、Host 只能读自己参与者的上下文、排队判定、告警幂等且不改状态，活动列表显示为 warning。
   - `agent-host/test/run-watchdog.test.ts`（冷路径，假时钟）：
     - 规则单元；无排队时只告警并正常完成；有排队时在阈值处终止、有终止证明、重试并合并后续工作。
     - 总时长上限；运行中调低上限对当前 run 生效。
     - 最终答复已提交时完成而不重跑。
     - 同一失败 3 次被 fence 隔离。
   - `agent-host/test/warm-runtime-policy.test.ts`：心跳不重置进展时钟；无排队只告警；有排队才终止；持续进展不告警；静默工具只告警；等待审批不判停滞，但 4 小时上限仍终止。
   - `codex-warm-runtime.test.ts`：
     - 有排队时 interrupt 收尾，同一运行时重试完成。
     - 无排队时 4 小时前不杀；3 次时长失败后被 fence 隔离，每次都在同一进程上运行，包括按次新建适配器的情形。
     - 不响应 interrupt 的轮次被杀，有 `process_exit` 证明，重试 `thread/resume` 同一线程。
   - `claude-warm-runtime.test.ts`：有排队时的停滞终止与重试。
   - `daemon/test/runtime-settings.test.ts`：两组部分更新、共用修订号、越界拒绝、重启后读回；attach 后立即推给 Kernel，之后每次修改也推。`same-cli-instance-concurrency.test.ts` 经 API 更新两组并核对文件。`daemon-application.test.ts`：旧 `stallMs`、`toolStallMs` 仍可解析。
   - 规则变化导致旧断言修改（不是放宽）：
     - `room-kernel.test.ts` 两条 Worker @ 测试：第三个实例不再被 `room_policy` 唤醒。
     - 两条“认领实例消息为任务”测试：消息体加上显式 @。
     - `agent-task-split-chain.test.ts`：lead 的分派消息不再唤醒未被 @ 的 auditor（之后由 Human 显式 @）。
     - `worker-process-integration.test.ts` 轮流报数：Fake CLI 回复带 `@对方`，9 次实例互唤醒在默认上限内。
     - schema 版本常量 69 → 70。
8. 偏离与未解决：
   - 终止宽限没有统一成 Raft 的 10 秒：冷路径沿用 5 秒；热路径先原生 interrupt，再按 1 秒 SIGTERM 宽限。
   - 热轮时长终止的 `terminated_reason` 记为 `stall`，未新增枚举，以免改 CHECK 约束。
   - 链计数只覆盖消息；实例经 Task 指派或审查唤醒其他实例不计数，属于有持久义务的显式动作。
   - 冷路径以轨迹帧为进展，长时间无输出的工具在有排队工作时会被终止（与 Raft 一致，原热路径的“工具 60 分钟窗口”已取消）。
   - 设置 API 已按负责人决定改名为通用 runtime settings（第三十八节）。
   - client-sdk 与控制台没有入口。
   - 本地服务未重启，正式库仍是 schema 69，下次启动迁移。

### 三十八、并发/唤醒/看门狗审查修复

依据 `~/.loom/reviews/2026-09-26-review-concurrency-wake-watchdog.md`（P1-1、P2-1、P2-2、P2-3 与文档范围说明），负责人已批准修复，并追加同意把设置改名为 runtime settings。每项先写失败测试并确认失败，再做最小实现；没有运行付费 CLI，没有重启服务，没有改前端，没有延长 lease，没有新建队列。

1. P1-1 启动闸门等待受监督（`agent-host.ts#startBehindGate`，`AgentStartGate.runStart(agentId, start, signal)`）：
   - 已认领的 Activation 在启动闸门排队时按运行期同一节奏（`leaseRenewIntervalMs`）续租并发 heartbeat，合法的启动积压不再让租约过期；获准启动后仍先取一次新续租再 `runtime.start`（原不变量不变）。
   - 等待中续租发现取消（`ActivationCancellationRequestedError`）、Agent 暂停或租约丢失，或 daemon 开始 drain，立即把本 lane 的闸门项移出队列（按 item 身份，只移除这一项）并返回，不调用 `runtime.start`：取消走既有 `resolveActivationCancellation`（RunAttempt `cancelled`）；drain 把 RunAttempt 记 `cancelled` 后按既有 drain 惯例重试；其余走既有 pre-start 失败路径。
   - Kernel 仍是唯一队列与单 lane 所有者：闸门项只是本 Host 已租到的 Activation 的进程内启动槽位。
   - 测试（修复前均失败）：`start-gate-wait-supervision.test.ts`（假时钟、临时库、Fake 运行时，结论读 room.db）——排队 80 s（租约 60 s）后启动成功，唯一 RunAttempt 为 `exited`、无 retry fence、Activation `completed` 且无 `last_error`（修复前复现审查所述 `pre-start lease validation failed ... durable retry failed`）；排队中取消在槽位仍被占用时结束为 `cancelled`、未启动 CLI、闸门队列为空（修复前一直挂起）；`AgentHost.run` 退出不等排队者获准、未启动 CLI、无未结束 RunAttempt（修复前一直挂起）。`agent-start-coordinator.test.ts`：中止一个排队项只移除它并拒绝、不执行，已获准后中止无影响（修复前超时）。
2. P2-1 动态缩容不再把已准入工作变成 admission failure（`InstanceRuntimePool.setMaxBusyTurns`、`daemon-process-hygiene.ts`）：
   - 准入线性化点明确为 Kernel 规划器。运行中调小 Host 上限只作用于 Kernel placement 上限；常驻池忙时上限只跟随调大，调小时保留当前值，所以旧上限下已预留、尚未进入常驻池的工作（例如仍在启动闸门）正常启动并自然排空，不记 provider 失败、不进 retry fence；新 placement 由 Kernel 挡住。
   - 常驻池构造时直接取持久化的 Host 上限（原来靠 attach 首次调用下调默认 20），重启后调小值生效。
   - 测试：`instance-runtime-pool.test.ts`“忙 + 已认领尚未启动 + 调小”——上限 3 时两轮忙，调到 1 后第三轮获准（修复前 `RAH_WARM_ADMISSION_FULL`）；`daemon-application.test.ts` 断言工厂按传入上限构造常驻池（实现后补的接线断言）。
3. P2-2 Kernel 唤醒守卫用 canonical mentions 证明 `@`（`instance-wake-guard.ts`）：agent 作者消息的 `mention` 收件人必须出现在 `RoomEventWriter` 已绑定的 `payload.mentions[].principalId` 里，不按显示名重新匹配；否则按隐式路由拒绝（不写 Inbox、不建 Activation、不计数）。测试 `instance-wake-guard.test.ts`：`reason=mention` 但正文无 @ → 拒（修复前产生 1 个 Activation）；正文 @别人 → 只唤醒被 @ 者；真正 @本人 → 放行。
4. P2-3 Room 永久删除清理唤醒表（`room-deletion-service.ts`）：删除事务清理 `instance_wake_chain` 与 `instance_wake_guards`；`ROOM_DELETION_REFERENCED_TABLES` 加入两表，棘轮测试扩为“外键可达 rooms，或带 `room_id` 列的表（删除回执 `room_deletion_receipts` 除外）”，以后无外键的房间级表也会被棘轮抓到。测试：有真实唤醒记录（Human 发言 + agent @ 另一 agent）后删除频道，两表该房间行清零、另一房间的 guard 保留（修复前删除后仍残留）；棘轮测试修复前报缺两表。表结构不变，schema 仍为 70。
5. 文档修正（第三十六、三十七节原文已改）：唤醒规则适用于所有 agent 作者（含旧 Agent）；RunAttempt 状态冷路径 `timed_out`、热路径按原生结果 `cancelled`/`failed`/`exited` 并带 watchdog failure；retry fence 按 Activation 计，“排队后续并入重试”限同房间；看门狗是时间策略不是卡死证明，私聊排队也会触发频道工作的终止；冷热审批状态不对称；lane 只增不减（调小不减 worker）。
6. 设置改名（负责人同意）：runtime-concurrency 泛化为 runtime settings。
   - API 路由 `/v3/client/runtime-settings/read|update`，旧路由 `/v3/client/runtime-concurrency/*` 删除（前端与 client-sdk 无调用方）。
   - protocol `runtime-settings.ts`：`RuntimeSettingsSchema`、`RuntimeSettingsReadSchema`、`RuntimeSettingsUpdateSchema` 与对应类型；daemon `runtime-settings.ts`（`RuntimeSettings`、`RuntimeSettingsRuntime`）、`daemon-runtime-settings.ts`（`DaemonRuntimeSettings`、`openDaemonRuntimeSettings`）；application-service 选项 `runtimeSettings`。字段与校验不变。
   - 持久化文件 `runtime-settings.json`。启动时只存在旧 `runtime-concurrency.json` 则读取、校验后原子写入新文件（临时文件 + fsync + rename，0600），旧文件保留不改：回滚到旧构建时仍能读到上次的值；新文件存在后本构建不再读旧文件。两者都不存在时取默认值。
   - 测试：`runtime-settings.test.ts` 迁移用例（实现前读到默认 revision 0 而失败）——旧文件的值被读出、新文件 0600 且内容一致、旧文件字节不变、之后修改只写新文件、重开读新文件、两者皆无时为默认；`same-cli-instance-concurrency.test.ts` 改用新路由并断言旧路由不可用。
7. 规则变化导致的既有测试修改（不是放宽）：
   - `collaboration-closure.test.ts`“Agent-authored Task input …”：agent 作者消息体加上显式 `@codex`（此前只传 `reason:"mention"`，正是 P2-2 拒绝的形态）。
   - `multi-lane-agent-host.test.ts` 隔离段：等待条件增加“Agent B 的隔离 Task 已 submitted”。原条件会被 B 之前已完成的 Activation 提前满足，B 的新 run 实际是在停机时从启动闸门放行才跑完；P1-1 后 drain 不再放行排队者，所以等待必须看这次 run 的结果。原断言不变。
8. 未解决：
   - drain 时闸门中的项按既有 drain 惯例走 `retryActivation`，计入该 Activation 的同错误计数；同一 Activation 连续 3 次在闸门中遇到停机会被 fence 隔离（与既有 drain 超时路径相同，未新增无惩罚归还的 Kernel API）。
   - 等待中的取消在下一次续租时才发现，延迟至多 `leaseRenewIntervalMs`（本地服务 20 s）；drain 立即生效。
   - 调小 Host 上限后，常驻池忙时上限在本进程内保持原值，直到重建；此期间仅靠 Kernel 上限约束新工作（Kernel 释放 placement 与常驻池释放槽位之间的短暂重叠与以前相同）。
   - 未做正式服务验证（未重启）；真实多 CLI 并发、长任务恢复未测。

### 三十九、频道工作区：主目录与附加目录

依据 `~/.loom/reviews/2026-09-26-cli-additional-dir.md`（四家核实与改动点清单），负责人 2026-09-26 批准（“按推荐”），目标合同新增 §2a，AGENTS.md 的 Channel 定义同步修改。每项先写失败测试并确认失败，再做最小实现；没有运行付费 CLI（Kimi 探针用本地假 API，免费），没有重启服务，没有改前端。

1. 模型（schema 71）：
   - 每个新频道由平台新建一个主目录，默认 `~/.loom/channel-workspaces/<频道 id>`（daemon v4 配置 `channelWorkspaceRoot` 可改，测试注入临时目录），是该频道所有实例（含私聊）的 CLI cwd 与默认产物目录。
   - 附加目录在创建频道时可选 0–16 个：规范绝对路径、必须已存在的目录、Human 鉴权；平台只校验，不创建、不删除。
   - 创建后两者都不可修改：`room.update` 命令是 strict schema，没有工作区字段；Kernel 没有其他写入路径。
   - 不设置 `CLAUDE_CODE_ADDITIONAL_DIRECTORIES_CLAUDE_MD`，四家都不自动加载附加目录里的 AGENTS.md/CLAUDE.md。
2. 协议（`channel-workspace.ts` 等）：
   - `ChannelAttachedDirectorySchema`（规范绝对路径，拒绝 `/`、尾部 `/`、空段、`.`、`..`、控制字符）；`ChannelWorkspaceSchema = {kind:"channel_home", additionalDirectories}`，去重、最多 16 个。
   - `room.create` 增加可选 `additionalDirectories`；Room 投影增加可选 `channelWorkspace`（旧频道没有）。
   - `AgentExecutionWorkspaceSchema` 增加 `{kind:"channel_home", roomId}`；Host 绑定增加 `additionalDirectories`（只允许 channel_home 带）。
   - 文件浏览根增加 `attached-project-1..16`（id 与 kind 相同，沿用“id 与 kind 一致”的约束），根列表上限 2 → 18。
3. Kernel：
   - `rooms.channel_workspace_json`（`migrateChannelWorkspaceV71`，旧行为 NULL）。`createWorkspaceRoom` 在同一事务写投影列和 `room.created`、`workspace.room_created` 两个事件的 `channelWorkspace`。
   - 幂等：重放比较附加目录列表，不同则 `IdempotencyConflictError`；Host 文件系统校验只对新请求执行，重放返回原结果（即使目录后来被删）。
   - 校验器由 daemon 注入（`RoomKernelOptions.channelAttachedDirectoryValidator`），拒绝原因包装为 `ConflictError`，不写任何行；没有注入校验器的 Core 拒绝非空附加目录。
   - 新实例：频道有 `channel_workspace_json` 且 Offer 支持私有工作区时，`executionWorkspace = {kind:"channel_home", roomId}`；否则保持原来的 `agent_private`。
   - `listHostExecutionWorkspaceBindings` 对 channel_home 附上频道的附加目录；规划器与恢复来源校验把 channel_home 与 agent_private 同样按“每个参与者一个挂载”处理。
4. Host 主目录（`AgentExecutionWorkspaceCatalog`）：
   - 时机：与现有私有目录一致，Host 在挂载刷新遇到第一个 channel_home 绑定时惰性创建；没有 channel_home 绑定就不创建根目录。
   - 永不复用：先写所有权回执（`<state>/agent-workspaces/.channel-homes/<hash>.json`，0600，link 发布），再 `mkdir`；路径上已有目录而没有回执时拒绝并记入 `failures`。回执里的绝对路径是权威：以后改 `channelWorkspaceRoot` 也不会搬动已有主目录（CLI 按 cwd 定位会话）。
   - 同频道实例共享 cwd，但挂载按参与者区分（revision id 摘要含 participantId、roomId、附加目录），每个实例仍是独立 lane；附加目录不同就是新挂载。挂载回执 schemaVersion 2，旧的 schemaVersion 1 私有回执照旧解析。
   - 重置不删主目录：`quarantinePrivate` 对 channel_home 返回 `undefined`（与 legacy 挂载相同），实例 session reset / full reset 都不碰主目录；频道归档、删除也不删除。
5. 各 CLI 的附带方式（附加目录纳入常驻 `runtimeKey`，变化后在空闲边界重启）：
   - Claude 冷、热：每个附加目录一个 `--add-dir=<abs>`。
   - Codex 冷、热：`thread/start` 与 `thread/resume` 带 `runtimeWorkspaceRoots=[cwd, ...附加目录]`；没有附加目录时不带该字段，已有线程请求不变。新增 `codex-app-server-schema.test.ts`，用 `codex app-server generate-ts --experimental` 锁定两个参数里的字段（只生成绑定，不启动模型；本机没有 codex 时跳过）。
   - Kimi：驱动（Host 侧进程）在启动 `kimi acp` 前在 cwd 写 `.kimi-code/local.toml`（`[workspace] additional_dir = [...]`，0600，内容不变不重写，原子替换）；没有附加目录时不写。
   - OpenCode：`runtimeContextLayer` 增加 `- Attached directory: <abs>`。是否注入只在 `attachedDirectoriesForPrompt`（`runtime-profile-composition.ts`）一处判定：Claude、Codex、Kimi 已原生告知，不重复；OpenCode 与 generic 进程注入。runtime context 不进 `deterministicDigest`，不算提示词漂移。
6. Kimi 0.39.1 免费探针（2026-09-26，临时 `KIMI_CODE_HOME` 指向本地假 OpenAI 兼容服务，只记录请求体后回 400，未访问任何真实模型）：
   - cwd 下写入 `local.toml` 后 `session/new` + 一轮 prompt，第一个模型请求的 system 消息里有 `## Additional Directories`、附加目录路径和目录两层列表。
   - 新进程 `session/resume` 同一 session 再发一轮，system 消息仍包含该段。
   - 结论：确认可用，采用原生方案，未退回提示词一行。
7. git 证据（`captureDeliveryEvidenceBaseline`）：按创建顺序逐个采集附加目录，取第一个 git 结果；都不是 git 时采集 cwd，非 git 如实记为 `not_git`。只记录一个根：有多个 git 附加目录时，后面的不产生交付证据。
8. 文件浏览：本地 daemon 的 Agent 工作区根对 channel_home 实例增加 `runtime-project`（主目录）和每个附加目录（`attached-project-N`），复用 `listWorkspaceRoot`/`readWorkspaceRoot` 的 root-scoped 读取（realpath、拒绝 `..`、过滤 `.git` 与密钥文件、拒绝 `/`）。私有 cwd 与 legacy cwd 仍不作为浏览根暴露（行为不变）。
9. 已有频道与实例：
   - 已有实例的修订冻结，保持原 cwd。
   - 已有频道（schema 71 前创建，`channel_workspace_json` 为 NULL）的新实例保持 `agent_private`，不为旧频道补建主目录。理由：补建只对新实例有意义，却让同一频道出现两种 cwd，文件与证据分散；保持旧行为对会话连续性没有任何风险。
10. 测试（均先失败）：
    - protocol `channel-workspace.test.ts`：创建带/不带附加目录、非规范路径与重复被拒、update 命令拒绝工作区字段、投影、channel_home 与绑定、浏览根。
    - kernel `channel-workspace.test.ts`：新频道记录主目录与事件、校验与幂等重放、拒绝时不建频道（无校验器也拒绝）、新频道新实例为 channel_home 且绑定带附加目录、旧频道新实例保持 agent_private。
    - agent-host `channel-home-workspace.test.ts`：同频道共享主目录且挂载按实例区分、根目录惰性创建、已有目录不复用、重启后沿用、重置不删主目录、附加目录变化产生新挂载、私有 cwd 不变、未配置根时可见失败。
    - agent-host `channel-attached-directory-drivers.test.ts`（真实驱动 + 假 CLI）：Claude 冷热 `--add-dir=`、Codex 冷 start/resume 的 roots、Kimi `local.toml`、非绝对路径在启动 CLI 前被拒。`codex-warm-runtime.test.ts` 新增热 `thread/start` roots；`role-warm-hot-path.test.ts` 新增生产 registry 路径：附加目录变化后 runtimeKey 变化、重启进程并以新 roots resume 同一线程。
    - agent-host `channel-workspace-roots.test.ts`：主目录与附加目录浏览根、root-scoped、越界与未知根被拒。
    - daemon `channel-workspace-composition.test.ts`：校验器（不存在、非目录、符号链接/非规范、Loom 数据目录内外重叠、主目录根）、默认根、提示行只给非原生 CLI、组合层把附加目录传给 adapter、提示词与证据根。
    - application-service `delivery-evidence-roots.test.ts`：证据根选择规则。
    - schema 版本常量 70 → 71 的既有断言同步修改（11 处，7 个文件）。`daemon-application.ts` 行数棘轮（800）未放宽：校验器接线放在 `daemon-execution-workspace-composition.ts#channelWorkspaceCoreOptions`。
11. 偏离与未解决：
    - Kimi 的 `local.toml` 写在 cwd；若 cwd 位于 git worktree 内，Kimi 会读 worktree 根的文件而不是这里。频道主目录默认不在 git 仓库内，未处理该情况。
    - 主目录根默认在 `~/.loom/`，与 evo 数据目录（`~/.loom/evo`）分开；校验器拒绝与 Loom 数据目录（`stateDirectory`）或主目录根重叠（包含或被包含）的附加目录，所以 `~` 本身会被拒。
    - 远端 Host 的 catalog 没有主目录根，channel_home 绑定会记为失败（远端本来拒绝 Role 实例）。
    - Registry 冷路径参数接线由驱动测试与共享函数覆盖，没有单独的“registry 冷启动 + 假 CLI”测试。
    - 附加目录校验只在创建时做；之后目录被删、被替换为符号链接，平台不再检查，CLI 会看到不存在的路径。
    - 前端与控制台没有入口（前端冻结；`apps/console` 不存在），只能经 API 创建。真实 CLI 未验证模型是否实际使用附加目录；本地服务未重启，正式库仍是旧 schema，下次启动迁移到 71。

## 当前状态（2026-09-25，批次 4 后）

本表取代原“已知缺陷”表，只记现在的状态；各节历史结论保留原样，证据以所引 commit 与证据文件为准。四列相互独立：
“已实现”不代表已验证，“已 fake 验证”不代表真实 CLI 验证，“已真实 CLI 验证”只指所列样本，不等于效率验收或部署验收。
原表中“平台协议升级到不了已续聊 session”一项已删除：第十五节“Protocol updated”行与协议版本、第十七节压缩后规则卡、
第二十五节第 6 项池持有的待确认状态已覆盖，其真实 CLI 验证情况见下表“会话协议与压缩”行。

| 能力                           | 已实现                                                                                                                   | 已 fake 验证                                                         | 已真实 CLI 验证                                                                                                        | 未覆盖                                                                                                                                                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role / Instance / 频道成员     | Role 修订、实例冻结快照、移除后不复活（第二、二十六节）                                                                  | Kernel/Worker 测试                                                   | 漂移门禁四家均以 Role 实例运行（见漂移结论与第二十二、二十三节）                                                       | 控制台可见（`apps/console` 不存在）；远端 Host 明确拒绝运行 Role 实例（`RAH_INSTANCE_HOST_UNSUPPORTED`）                                                                                              |
| 每轮效率（S1）                 | 用量入库、四家带正文唤醒、提示词减重、`--final` 收尾                                                                     | 是                                                                   | 仅 Codex `gpt-5.6-luna/low`：S1-e、S1-g、精简唤醒三次效率门禁，全组仍 over-budget（第一轮工作路径差异），续聊轮达标    | Claude/Kimi/OpenCode 效率门禁从未付费运行；`gpt-6-luna` 无效率证据；Kimi 用量 CLI 不提供（`unmeasured`）；业务路径差与压缩后趋势口径已按负责人 2026-09-25 裁定实现（第三十三节），尚无付费样本        |
| Codex 常驻（默认开启）         | S2-a/S2-b 与批次 1 修复                                                                                                  | 是                                                                   | 冷热对比（`gpt-5.6-luna`，常驻组不重启）；漂移 20 轮常驻（`gpt-6-luna`）                                               | 热模式取消、首轮中断、热模式 daemon 重启续聊均无真实证据（s2-spec §8 冒烟未满足）；默认开启后本地服务未验收                                                                                           |
| OpenCode 冷 / 常驻（默认开启） | S2-c3 与批次 1、3 修复                                                                                                   | 是                                                                   | 漂移 10 轮冷、热各一次（`deepseek-flash/low`）                                                                         | 原生效率对照未跑（批次 4 只补代码）；真实 abort 超时、子代理与溢出事件；默认开启后本地服务未验收                                                                                                      |
| Claude 冷 / 常驻（默认关闭）   | S2-c1、第二十一节与批次 3 修复                                                                                           | 是                                                                   | 仅 Haiku（无 effort）漂移 10 轮冷、热各一次                                                                            | Sonnet 无任何真实证据；效率门禁未跑；后台任务轮与唤醒真实竞态                                                                                                                                         |
| Kimi 冷                        | S2-c2 与批次 3 修复                                                                                                      | 是                                                                   | 漂移 20 轮冷两次（`k3-256k/low`，第二次修复后送达与 ACK 100%）                                                         | 效率门禁未跑；用量不可得；Goal 围栏中模式固定已有真实免费探针，续聊 active goal 拒绝与 goal 工具拒绝只有 fake 验证，续聊检测依赖私有文件；门禁守卫曾拒绝模式请求致第 1 轮全部失败，已修（第二十九节） |
| 会话协议与压缩                 | 协议版本与“Protocol updated”行、压缩后规则卡、池持有待确认状态                                                           | 是                                                                   | Kimi 第二次漂移两次强制压缩后规则卡仍生效；Haiku 冷热、OpenCode 热压缩后无退化；Codex 压缩后格式率下降（见漂移结论表） | 协议升级行本身无真实触发样本                                                                                                                                                                          |
| 用量 / 上下文 / 压缩可见性     | 逐次用量入库；Codex 记上下文窗口与占用（其他 CLI 为空，不估算）；压缩次数记在 Host session 绑定                          | 是                                                                   | 效率/漂移证据中的产品用量（Kimi 除外）                                                                                 | 每实例展示（控制台不存在）                                                                                                                                                                            |
| 会话连续性                     | 不静默换 session：要求连续时停止并隔离，reset 后重新排队（第二十六节）；冷驱动接收即绑定                                 | 是                                                                   | 漂移样本中 session 不变                                                                                                | 真实首轮中断后的恢复；线程写入者占用仍按连续性失败隔离，需 Human reset                                                                                                                                |
| 新实例首轮等待                 | 挂载发布按 30 s 刷新周期                                                                                                 | —                                                                    | —                                                                                                                      | 首轮约 30 s 等待未修                                                                                                                                                                                  |
| 付费门禁自身                   | 单一批准表、Codex 白名单围栏、Claude 斜杠命令与事后核对、漂移事后核对 fail-closed、证据来源字段（第二十八节）            | 门禁免费单测（已纳入 `npm run check`）                               | 批次 4 之后的门禁代码未付费运行                                                                                        | Claude result `modelUsage` 若含 CLI 后台其他模型族会判越权，是否出现未知；shim 选项白名单与原生 Codex 开关同步见第二十九节                                                                            |
| S3 私聊                        | 仅 Human 开、共享 session、忙时排队、不 steer、双向隔离（含提醒与 `dm:@` 读写）、`instancePrivateBox` 投影（第三十五节） | Kernel 隔离/steer/游标/代数测试；Codex 冷、热 fake 共享 session 测试 | —                                                                                                                      | 真实 CLI 私聊轮未跑；控制台可见未满足；推迟项见第三十五节第 4 项                                                                                                                                      |
| 频道工作区（第三十九节）       | 新频道平台主目录与创建时附加目录（不可改）；四家原生/提示行附带；证据根与浏览根                                          | Kernel/Host/驱动假 CLI 测试；Kimi 免费假 API 探针                    | —                                                                                                                      | 真实 CLI 未验证；控制台与前端无入口；旧频道不补建主目录                                                                                                                                               |
| S4–S6                          | 未开始                                                                                                                   | —                                                                    | —                                                                                                                      | fork、side、平台记忆                                                                                                                                                                                  |

目标合同 §6 表的“9/23 基线”一列（负责人 2026-09-25 批准由“当前基线”改名，数值与预算未改）是 2026-09-23 的数据（首轮失败、用量未采集），之后的实测见本页效率各节。

## 长会话漂移测试结论（2026-09-25，20 轮，第 8/15 轮强制压缩）

证据：[Codex gpt-6-luna/low 常驻](evidence/2026-09-25-drift-codex-warm.json)、[Kimi K3-256k/low 冷启动](evidence/2026-09-25-drift-kimi-cold.json)。

| 检查项                    | Codex                                 | Kimi                     |
| ------------------------- | ------------------------------------- | ------------------------ |
| 回复送达（应回复的轮次）  | 100%                                  | 100%                     |
| 回复目标错误              | 0（修复前压缩后 6 轮发错）            | 0                        |
| 违规建 Task               | 0                                     | 0                        |
| 该沉默时沉默              | 100%                                  | 100%                     |
| 最终回复带 `--final`      | 100%                                  | 100%                     |
| Activation 隔离           | 0（1 轮首次未确认，带提醒重试后完成） | 0                        |
| 格式约束（前缀 + ≤40 字） | 前 83% / 64%，压缩后 50%              | 前 67% / 45%，压缩后 50% |

- 结论（按 Codex 第六轮审查修正）：两份漂移门禁总体**未通过**（summary.status=violated）。样本支持的只是：各 20 轮中 14 个应回复轮次都提交到正确目标、6 个静默轮次未发帖、未违规建 Task、两次强制压缩均有观测证据。它**不能**证明"所有规则压缩后都保留"：压缩后窗口只有 3 轮、非同题配对，格式下降与 Codex 第一窗口的 ACK 重试原因未完全归因。
- 回复目标：Codex 复测零错发主要来自唤醒给出精确目标；本次样本未触发 Kernel 守卫，且守卫本身存在入口缺口（显式 threadId、无 thread 后缀的 `--target`），不能称为结构性封堵，待修。
- 门禁自身缺陷：汇总未纳入 ACK 未完成等硬失败，可能输出假 pass；Kimi 的 targetRejections 不可观测却汇总为 0。待修。
- Kimi 无逐次用量数据（ACP 不提供），token 列为空。

## 精简唤醒 + `--final` 复测（2026-09-25，Codex `gpt-5.6-luna / low`，[证据](evidence/2026-09-25-final-compact-wake.json)）

| 组/轮次          |             回复耗时 | 生成（前/后） |                  输入合计 |                 未缓存 | 模式         |
| ---------------- | -------------------: | ------------: | ------------------------: | ---------------------: | ------------ |
| 原生 P1/P2/P3    | 22.2 / 16.2 / 18.4 s |     3 / 1 / 1 |  52,050 / 21,881 / 22,268 | 11,858 / 1,657 / 1,020 | —            |
| Role 冷 P1/P2/P3 | 28.0 / 13.7 / 15.4 s |     3 / 1 / 1 |  60,367 / 24,791 / 25,377 | 14,031 / 1,495 / 1,057 | 每轮进程     |
| Role 热 P1/P2/P3 |   43.1 / 9.7 / 8.6 s |     5 / 1 / 1 | 110,575 / 27,755 / 28,428 | 16,623 / 3,435 / 1,036 | 冷 / 热 / 热 |

- **续聊轮与原生持平**：每轮 1 次生成（回复后 0 次）；总输入为原生的 1.13–1.28 倍；未缓存输入与原生相当；续聊轮全部预算项达标。
- 常驻续聊 9.7 / 8.6 s，比原生 16.2 / 18.4 s 快约一半；冷路径 13.7 / 15.4 s 也快于原生。
- 固定开销：冷 +2,771、热 +2,813；每轮残留 199 / 286 token（精简前约 540–640）。
- 热组第一轮 5 次生成、43 s：模型多读了文件（工作路径差异，原生 3 次），属第一轮冷启动轮的业务差异。
- 测量说明：记录到的用量中回复后没有额外完整生成（这是用量记录层面的结论，不是服务端请求审计）；`preemptedFollowUp` 当时的判定逻辑会双向误判，已在 S2-b 改为按证据判定，仍待区分"请求已发/已被接受/已终止"。本组总状态仍为 over-budget（第一轮），续聊轮改善不代替全组验收；效率与漂移使用的模型不同（gpt-5.6-luna 与 gpt-6-luna），结论按模型分列。

## S2-a 冷热对比（2026-09-24，Codex `gpt-5.6-luna / low`，[证据](evidence/2026-09-24-s2a-warm-vs-cold.json)）

三组各三轮，第一轮工作路径可比（均为 2 次读文件）。常驻组第三轮前不重启（测连续工作），冷启动组第三轮前重启。

| 组/轮次          |             回复耗时 | 生成（前/后） |                 输入合计 | 模式         |
| ---------------- | -------------------: | ------------: | -----------------------: | ------------ |
| 原生 P1/P2/P3    | 32.4 / 16.4 / 13.2 s |     3 / 1 / 1 | 52,111 / 21,912 / 22,268 | —            |
| Role 冷 P1/P2/P3 | 29.7 / 14.6 / 14.5 s |     4 / 2 / 2 | 85,885 / 51,400 / 53,163 | 每轮进程     |
| Role 热 P1/P2/P3 | 33.6 / 13.0 / 13.5 s |     4 / 2 / 2 | 86,023 / 55,050 / 56,975 | 冷 / 热 / 热 |

- 固定开销：冷 +2,911、热 +2,972（≤ 3k，达标）；协议额外生成均为 1、回复前额外 0；续聊耗时冷热都快于原生；三组最终答案全部送达，同一 session，用量证据完整。
- 小 session 下常驻收益：续聊每轮快约 1.3 s（约 9%），token 无差别（热组输入略高来自第一轮输出差异）。
- 大 session 下的收益来自避免每轮冷恢复：本机实测一条含 32 个超 1MB 条目的 342MB 长期线程恢复需 114–116 s，冷模式每轮都要付；常驻只在空闲回收后付一次。结论：Codex 常驻有明确收益，按计划推进。
- 仍超标：续聊轮总输入超 2×(原生+3k) 约 3–13%。分解显示固定开销已贴近 3k 上限，每轮残留约 540–640 token 与第一轮历史差异必然使其越线——该条在固定开销达标时结构上不可达，需 owner 决定改用分项预算。
- 测量缺口：冷路径未记录 `sessionResumeMs`（只有热路径记录），大 session 冷恢复成本目前靠无模型探针单独测量。

## S1-e 门禁结果（2026-09-24，Codex `gpt-5.6-luna / low`，[证据](evidence/2026-09-24-s1e-codex.json)）

同一源文件快照（5122795）、新 session 起步、第三轮前重启；三组串行。按合同 §6 修订版判定：**未全部达标，但离目标很近，继续推进，不需要重评架构。**

| 组/轮次     | 回复耗时 | 生成（前/后） | 输入合计 | 首请求输入 | 超标项                                  |
| ----------- | -------: | ------------: | -------: | ---------: | --------------------------------------- |
| 原生 P1     |   19.1 s |      2（2/0） |   31,781 |     13,722 | —                                       |
| 原生 P2     |   11.3 s |      1（1/0） |   18,677 |     18,677 | —                                       |
| 原生 P3     |   11.2 s |      1（1/0） |   19,040 |     19,040 | —                                       |
| Role P1     |   26.5 s |      3（2/1） |   61,488 |     17,940 | 首请求、耗时                            |
| Role P2     |   15.1 s |      2（1/1） |   45,594 |     22,567 | 总输入（上限 43,354）、首请求（+3,890） |
| Role P3     |   15.1 s |      2（1/1） |   47,358 |     23,454 | 总输入（上限 44,080）、首请求（+4,414） |
| 旧 Agent P2 |   14.0 s |      2（1/1） |   56,351 |     27,943 | 总输入、首请求                          |
| 旧 Agent P3 |   15.0 s |      2（1/1） |   58,133 |     28,835 | 总输入、首请求                          |

- 与 9/23 基线相比（Role P2/P3）：生成 3 → 2，回复前额外生成 1 → 0；总输入 96.6k/101.4k → 45.6k/47.4k（原生的 4.8–5.0 倍 → 2.4–2.5 倍）；首请求 31.6k/33.1k → 22.6k/23.5k；耗时 19.4/21.9 s → 15.1/15.1 s（额外 +3.8 s，达标）。
- 达标：协议额外生成 ≤1、回复前额外 0、续聊耗时、用量证据完整（产品入库与原生记录一致、无缺口）、三轮同一原生 session（含重启）、最终答案全部送达。
- 未达标：首请求固定开销约 +3.9–4.4k（目标 +3k），总输入超上限约 5–7%。剩余固定开销基本就是常驻提示词本身（约 15.9k 字符 ≈ 4k token），再减约 1.5k token 即可两项同时达标。
- Role P1 首轮 26.5 s（多一次读文件生成，原生首轮也是 2 次）；首轮属冷启动，S2 常驻进程后再看。
- 旧 Agent 也受益于提示词减重与带正文唤醒，但首请求比 Role 多约 5k（旧 Agent 路径按合同将移除）。

### S1-g 后复测（[证据](evidence/2026-09-24-s1g-codex.json)）

常驻提示词 15.9k → 9.8k 字符后复跑同一门禁。

| 组/轮次       |             回复耗时 | 生成（前/后） |                 输入合计 |               首请求输入 | 门禁判定超标项     |
| ------------- | -------------------: | ------------: | -----------------------: | -----------------------: | ------------------ |
| 原生 P1/P2/P3 | 18.4 / 14.1 / 11.1 s |     2 / 1 / 1 | 31,781 / 18,645 / 19,014 | 13,716 / 18,645 / 19,014 | —                  |
| Role P1       |               25.2 s |      4（3/1） |                   85,772 |                   16,630 | 总输入、生成、耗时 |
| Role P2       |               14.4 s |      2（1/1） |                   51,018 |                   25,291 | 总输入、首请求     |
| Role P3       |               12.8 s |      2（1/1） |                   52,701 |                   26,153 | 总输入、首请求     |

分解：

- **固定开销达标**：新 session 第一次生成 Role 16,630 vs 原生 13,716，+2,914（目标 ≤ +3k；上次 +4,218）。
- **每轮协议残留小**：P2→P3 上下文增长 Role +862、原生 +369，平台每轮约多 500 token。
- **续聊轮超标主因是 P1 工作路径差异**：本次 Role P1 执行了 3 次读文件命令（原生 1 次），多读的内容留在历史里，后续每轮都要携带；门禁的"首请求"在 P2/P3 比较的是含历史的上下文，把业务差异也算进了平台开销（Codex 第一轮审查已指出该口径问题）。
- 续聊耗时 +0.2 s / +1.8 s，达标；最终答案全部送达，三轮同一 session，用量证据完整。
- 待定：门禁口径需区分"固定开销（新 session 首次生成）""每轮残留""业务工作差异"，属于合同 §6 口径调整，须 owner 批准；在此之前如实记为超标。

## 效率基线（2026-09-23，Codex `gpt-5.6-luna / low`，S1 的对照基准）

同一源文件快照、新 session 起步、第三轮前重启。

| 组/轮次 | 有效回复时间 | 模型生成次数 | 输入合计 | 首请求输入 |
| ------- | -----------: | -----------: | -------: | ---------: |
| 原生 P2 |       12.6 s |            1 |   20,051 |     20,051 |
| 原生 P3 |       14.1 s |            1 |   20,406 |     20,406 |
| Role P2 |       19.4 s |            3 |   96,636 |     31,602 |
| Role P3 |       21.9 s |            3 |  101,412 |     33,102 |

- 总输入约为原生的 4.8–5.0 倍：单次上下文约 1.6 倍 × 3 次生成（check → post → final）。
- 固定负担：RAH 常驻 developer 指令约 57,200 字符，原生约 8,500；其中 `agent-host/src/agent-memory-prompt.ts` 的 transport and safety bindings 段约 3.4 万字符。
- Role P1 最终结论未送达（404 被误报为 UNKNOWN，已由 S1-b 修复）；旧 Agent P1 违反"不建任务"要求。
- 原始收据与报告在 `ref/role-ui-draft` 的 `docs/audits/2026-09-23-cli-efficiency-gate.zh-CN.md`、`docs/audits/evidence/2026-09-23-cli-efficiency/receipt.json`。

## 历史文档

9/21–9/23 的约 26 篇 audit/design 与 evidence 目录已从 evo 树中移除，完整保留在 `ref/role-ui-draft` 分支。
