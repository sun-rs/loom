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

- `run_attempt_usage`：驱动经 fd3 `rah-provider-usage/v1` 帧逐次生成上报原生 token 用量（Codex/Claude/OpenCode；Kimi ACP 不提供逐次用量，第四十节起改从会话 wire 读取），Host 以自身凭据按 (RunAttempt, response) 幂等写入，不进 trajectory；`agent.run.usage.get` 按 RunAttempt 读取。

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
   - 时机：已被第 12 项（负责人裁定 P2-2 选 A）取代：创建频道时由 Host 创建；惰性创建只留给没有 Host 预备器的 Core 与此前创建的频道。
   - 永不复用：先写所有权回执（`<state>/agent-workspaces/.channel-homes/<hash>.json`，0600，link 发布），再 `mkdir`；路径上已有目录而没有回执时拒绝并记入 `failures`。回执里的绝对路径是权威：以后改 `channelWorkspaceRoot` 也不会搬动已有主目录（CLI 按 cwd 定位会话）。审查后回执只算“创建意图”，另有“创建完成”记录，见第 12 项。
   - 同频道实例共享 cwd，但挂载按参与者区分（revision id 摘要含 participantId、roomId、附加目录），每个实例仍是独立 lane；附加目录不同就是新挂载。挂载回执 schemaVersion 2，旧的 schemaVersion 1 私有回执照旧解析。
   - 重置不删主目录：`quarantinePrivate` 对 channel_home 返回 `undefined`（与 legacy 挂载相同），实例 session reset / full reset 都不碰主目录；频道归档、删除也不删除。
5. 各 CLI 的附带方式（附加目录纳入常驻 `runtimeKey`，变化后在空闲边界重启）：
   - Claude 冷、热：每个附加目录一个 `--add-dir=<abs>`。
   - Codex 冷、热：`thread/start` 与 `thread/resume` 带 `runtimeWorkspaceRoots=[cwd, ...附加目录]`；没有附加目录时不带该字段，已有线程请求不变。新增 `codex-app-server-schema.test.ts`，用 `codex app-server generate-ts --experimental` 锁定两个参数里的字段（只生成绑定，不启动模型；本机没有 codex 时跳过）。
   - Kimi：驱动（Host 侧进程）在启动 `kimi acp` 前在 cwd 写 `.kimi-code/local.toml`（`[workspace] additional_dir = [...]`，0600，内容不变不重写）；没有附加目录时不写。审查后只新建或更新平台管理版本，见第 12 项。
   - OpenCode：`runtimeContextLayer` 增加 `- Attached directory: <abs>`。是否注入只在 `attachedDirectoriesForPrompt`（`runtime-profile-composition.ts`）一处判定：Claude、Codex、Kimi 已原生告知，不重复；OpenCode 与 generic 进程注入。runtime context 不进 `deterministicDigest`，不算提示词漂移。
6. Kimi 0.39.1 免费探针（2026-09-26，临时 `KIMI_CODE_HOME` 指向本地假 OpenAI 兼容服务，只记录请求体后回 400，未访问任何真实模型）：
   - cwd 下写入 `local.toml` 后 `session/new` + 一轮 prompt，第一个模型请求的 system 消息里有 `## Additional Directories`、附加目录路径和目录两层列表。
   - 新进程 `session/resume` 同一 session 再发一轮，system 消息仍包含该段。
   - 结论：确认可用，采用原生方案，未退回提示词一行。
7. git 证据（`captureDeliveryEvidenceBaseline`）：按创建顺序逐个采集附加目录，取第一个 git 结果；都不是 git 时采集 cwd，非 git 如实记为 `not_git`。只记录一个根：有多个 git 附加目录时，后面的不产生交付证据。
8. 文件浏览：本地 daemon 的 Agent 工作区根对 channel_home 实例增加 `runtime-project`（主目录）和每个附加目录（`attached-project-N`），复用 `listWorkspaceRoot`/`readWorkspaceRoot` 的 root-scoped 读取（拒绝 `..`、过滤 `.git` 与密钥文件、拒绝 `/`）。附加根不再先 realpath 再当作安全，见第 12 项。私有 cwd 与 legacy cwd 仍不作为浏览根暴露（行为不变）。
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
    - （已由第 12 项修复）原先附加目录只在创建时校验；审查复现根被替换为指向数据目录的符号链接后，浏览接口会跟过去读出数据目录文件。
    - 前端与控制台没有入口（前端冻结；`apps/console` 不存在），只能经 API 创建。真实 CLI 未验证模型是否实际使用附加目录；本地服务未重启，正式库仍是旧 schema，下次启动迁移到 71。
12. 审查修复（2026-09-26，依据 `~/.loom/reviews/2026-09-26-channel-workspace-review.md`；负责人批准修 P1-1、P1-2、P2-1，P2-2 裁定选 A）。每项先写失败测试并确认失败，再实现；没有运行付费 CLI，没有重启服务，没有改前端。
    - 共同的 Host 路径校验（`agent-host/src/channel-directory-check.ts`）：目录必须存在、是目录、叶子与祖先都不是符号链接（`realpath` 必须等于保存的路径）、不与 Loom 数据目录或主目录根重叠；记录过身份时 dev/ino 必须一致。错误带可诊断代码（`attached_directory_symlink`、`attached_directory_not_canonical`、`attached_directory_missing`、`attached_directory_reserved`、`attached_directory_replaced`、`channel_home_missing`、`channel_home_replaced`、`channel_home_unowned`、`channel_home_path_mismatch` 等）。daemon 创建时的校验器改为调用它，规则只有一份。
    - P1-1 附加目录：第一次绑定刷新时记录每个附加目录的 dev/ino（`.channel-homes/<房间 hash>.attached-<路径 hash>.json`；第四十一节起改为创建频道时由同一 Host 预备器记录，第一次绑定才记录只留给没有预备器的 Core 与此前创建的频道）；此后每次绑定刷新、启动解析（`resolveWorkspace`）、每次激活的环境准备与交付证据采集前（`verifyWorkspace`）、文件浏览前（`verifyAttachedDirectory`）都复核。不一致即拒绝：挂载不发布、激活失败、浏览报错；不静默规范化到新目标。浏览根不再先 `realpath`；没有 Host 校验器时浏览端也至少拒绝符号链接与非规范路径。同名普通目录替换靠 dev/ino 识别。
    - P2-1 主目录：拆成“创建意图”（原回执）与“创建完成”（`<hash>.created.json`，只在 Loom 独占 `mkdir` 成功后写，含 dev/ino）。只有意图、没有完成记录的已有目录一律拒绝（`channel_home_unowned`，不能区分“崩溃前自己建的”与“外部建的”时选择拒绝）；只有意图且目录不存在时补完创建。有完成记录时目录缺失报 `channel_home_missing`、被替换报 `channel_home_replaced`，都阻断刷新、启动解析与浏览，不补建空目录，也不让旧 session 在别的目录继续。创建与记录逻辑集中在 `channel-home-records.ts` 一处，频道创建与惰性路径共用。
    - P1-2 Kimi `.kimi-code/local.toml`：不存在时用 link 独占发布新建；已存在时只在它仍是未改动的平台版本时更新（首行带其余内容的 sha256 标记；也识别首版格式）。不认识的文件报 `KIMI_LOCAL_CONFIG_FOREIGN`、平台文件被改过报 `KIMI_LOCAL_CONFIG_MODIFIED`，原文件保持不变，Kimi 启动失败；`local.toml` 或 `.kimi-code` 是符号链接或特殊文件报 `KIMI_LOCAL_CONFIG_UNSAFE`。同频道两个 Kimi 同时初始化：发布冲突时内容相同即视为成功。不做 TOML 合并。
    - P2-2（选 A）创建时建好主目录：daemon 给 Kernel 注入 `channelPrimaryDirectoryPreparer`（Kernel 自己不碰文件系统）。Kernel 在创建事务中完成全部校验后调用它；Host 独占创建 `<根>/<房间 id>` 并写意图与完成记录，返回绝对路径。建不出来（路径被占、不可写）则 `ConflictError`（含 Host 错误码），不写任何行；事务之后失败则调用 `rollback`，只在目录仍是同一个空目录时删除目录和两条记录。幂等重放直接返回原频道与原路径，不再调用 Host。路径写入 `channel_workspace_json.primaryDirectory` 与创建事件，此后改根配置不影响该频道；Host 绑定带 `primaryDirectory`，Host 以它为准（与意图记录不一致即 `channel_home_path_mismatch`）。崩溃窗口：目录与记录已写而 Kernel 未提交时，留下一个空目录和对应记录，其房间 id 永不再用，不会被别的频道接管；未做启动清理。没有预备器的 Core（测试）与此前创建的频道仍在第一次绑定时惰性创建，并同样走意图/完成记录。
    - Room 投影：`channelWorkspace.primary = {state: pending|ready|failed, reason?}`。创建时 Host 预备成功即 `ready`；此后 daemon 每次挂载刷新把 Host 结果上报（`kernel.reportChannelWorkspaceStates`，只允许上报本 Host 有 channel_home 绑定的频道，只在变化时写）。存储在 `rooms.channel_workspace_state_json`（schema 72）。这是 Host 观测，不追加 Room 事件、不改 Room 序号；客户端下次读取房间时看到。
    - 测试（先失败）：agent-host `channel-directory-integrity.test.ts`（附加根被换成指向数据目录的符号链接、祖先被换成符号链接、删除、同名普通目录替换、与数据目录重叠；意图已写但创建未完成、只有意图时补完、主目录被替换、被删除且重启后也不补建、两个 catalog 并发首次准备、以创建时记录的路径为准与不一致被拒、创建时建目录与回滚只删未动过的空目录、路径被占与父目录不可写）；`kimi-workspace-config.test.ts`（新建与重复启动不变、用户文件保留、平台文件被改后拒绝、平台文件与首版格式可更新、符号链接/目录/`.kimi-code` 链接拒绝、两进程并发初始化）；`channel-workspace-roots.test.ts` 新增无 Host 校验器时不跟随符号链接；kernel `channel-workspace.test.ts`（创建时预备并记录路径与 ready、重放不再预备、预备失败无频道行、提交失败回滚、改根不影响已记录路径、绑定带路径、状态 pending/ready/failed 与越权上报被拒且不改序号）；daemon `channel-workspace-composition.test.ts`（真实 Kernel + daemon 预备器：创建即目录就绪、路径被占时创建失败无行、重放同一目录；每次激活前复核，复核失败不采集证据）。
    - 同步修改（非放宽）：`channel-home-workspace.test.ts` 的附加目录改为真实临时目录（刷新时现在复核附加目录）；kernel 投影断言补 `primary: {state:"pending"}`；schema 常量断言 71 → 72；七个 daemon 测试和两个 fixture 脚本的 v4 配置显式设 `channelWorkspaceRoot` 到临时 state 下（否则创建频道会在真实 `~/.loom/channel-workspaces` 建目录）。`room-kernel.ts` 行数棘轮（6925）未放宽：原子创建与回滚放在 `CollaborationService.createWorkspaceRoomAtomically`，状态上报放在 `channel-workspace-state.ts`。
    - 未解决：单次 lstat+realpath 不能消除恶意并发改名的 TOCTOU（需要目录句柄读取，未做）；（已由第四十一节修复）附加目录身份原先在第一次绑定刷新时记录，频道创建到第一次绑定之间的替换识别不了；目录被替换时浏览根列表仍显示为 `absent`（协议只有 absent/ready）；`local-workbench` 启动的浏览器门禁若创建频道，会在真实 `~/.loom/channel-workspaces` 建目录（默认根如此，未改）；主目录位于 git worktree 内时 Kimi 读错位置的问题仍未处理；崩溃后遗留的空目录没有清理；控制台未接入状态显示（`apps/console` 不存在）。

### 四十、用量记录与权限收口

依据 `~/.loom/reviews/2026-09-26-upstream-substrate-research.md` 第 3、4 节（负责人已同意其建议）。每项先写失败测试并确认失败，再做最小实现；没有运行付费 CLI，没有重启服务，没有改前端，没有自建价格表。

A. 用量记录（schema 73）

1. 逐轮 token：Codex/Claude/OpenCode 维持原 fd3 用量帧不变。Kimi 由驱动（Host 侧进程）在 `session/prompt` 前记下会话主 wire（`<KIMI_CODE_HOME>/session_index.jsonl` → `<sessionDir>/agents/main/wire.jsonl`，与目标围栏同一查找）的字节长度，prompt 结束后只读此后追加的字节（`kimi-wire-usage.js`）：
   - 每个 `step.end` 的 `usage` 与 `messageId` 记一次生成（input = inputOther + inputCacheRead + inputCacheCreation，cached = inputCacheRead，reasoning 为 null）；`full_compaction.begin/complete` 之间非 turn 范围的 `usage.record` 记为压缩生成（`compaction:<时间>`）。
   - 区域以 `turn.ended` 结束（只压缩的 prompt 以 `full_compaction.complete` 结束）；kimi-code 0.39.1 源码 `emitEvent(turn.ended)` 在 prompt 结束前，落盘可能稍晚，所以最多等 2 s。
   - 缺口：wire 找不到、读不了或等不到结束为 `parse_error`；turn 范围 `usage.record` 条数与 `step.end` 用量条数不一致为 `inconsistent_total`；主 agent 调用 `Agent`/`AgentSwarm`（子 agent 步骤在别的 wire，未归属）为 `unsupported_provider`。被最终中断取消、尚未产生用量的 step 不算生成（与 Claude 一致）。
   - 续聊会话在 prompt 前找不到 wire 时不读（否则会把历史计入），记 `parse_error`；新会话偏移为 0。原先“Kimi 每次记 `unsupported_provider`”的行为删除。
   - 可靠性依据：真实 0.39.1 wire 夹具逐轮切片（完成轮、最终中断轮、只压缩的 prompt）和驱动 + 假 ACP 的偏移/迟到/缺失测试；没有真实 CLI 运行验证。wire 是 kimi-code 私有格式。更正（第四十一节审查）：原先“版本变化时会表现为缺口而不是错数”说得过强——当时的解析遇到第一个 `turn.ended` 即封口、不核对本轮身份，区间被污染（上一轮迟到落盘、文件被替换、外部进程操作同一 session）时会把别的轮次计入而不报缺口；第四十一节加了本轮边界与文件身份核对，但格式变化仍可能表现为错数，不能保证只表现为缺口。
2. CLI 估算费用（新表 `run_attempt_cli_costs`，Host 凭据写、按 (RunAttempt, costId) 幂等，fd3 帧 `rah-provider-cost/v1`）：
   - Claude：`result.total_cost_usd` 是 CLI 按标价估算的会话累计值（2.1.282 二进制可见续聊时从 transcript 的 `costState` 恢复）。每个 result 记原始累计值 `reportedTotalUsd`，`costUsd` 为同一进程内相对上一个 result 的增量；新会话进程从 0 起，首个 result 即全额；续聊进程的首个 result 没有本进程见过的基线，`costUsd = null`（未知），不拿累计值充当本轮；累计值变小也记 null。冷驱动每轮是续聊进程，所以常见情况是只有原始累计值、本轮费用未知；热驱动第二轮起有增量。
   - OpenCode：`step-finish` 的 `cost`（其 models.dev 价格缓存估算）按步照抄；OpenCode 对无价格模型报 0，汇总里单列 `zeroRecords`，不当作“免费”。
   - Codex、Kimi 不报费用：不记录，汇总为 unknown（`runsUnreported`）。
   - 单次读取 `agent.run.usage.get` 增加 `cliCosts`。
3. 汇总 API：`usage.summary`（`POST /v3/client/usage/summary`，Human 鉴权，只读；protocol `UsageSummaryRequest/ResponseSchema`；Kernel `runAttemptUsage.summary`，查询在 `usage-summary.ts`）：
   - 范围：Role 实例的 RunAttempt，按 `started_at` 落在 `[from, to)`；可按 `channelId`、`instanceId` 过滤；`groupBy` 为 instance 或 channel（实例所属频道）；只含该 Human 是成员的频道。更正（第四十一节）：频道成员资格只是分组键，不是 ACL；原实现会让同频道另一 Human 看到他人私聊运行的用量，现另要求查询者是运行实际房间的成员。
   - 每组：`runs`（total/complete/partial/unavailable，规则与单次读取一致）、`tokens`（只对已记录生成求和；reasoning 只对报了的生成求和并给出条数，全无则 null）、`gaps`（按原因计 RunAttempt 数）、`cliEstimatedCost`（`basis: cli_reported_estimate`；`totalUsd` 只加已知值，全无为 null；`runsKnown/Partial/Unknown/Unreported` 为覆盖率（更正：`runsKnown` 原意只是“收到的费用记录都已知”，不代表整轮费用采集完整，有用量缺口的运行也会算入；第四十一节改名为 `runsComplete` 并收紧含义，另设 `runsAllRecordsKnown`）；按来源列出金额、条数、未知条数、0 条数）、`providers`、首末开始时间。金额按纳美元整数累加，避免浮点累计误差。
4. 测试：kernel `usage-summary.test.ts`（schema 73、费用幂等与冲突、结束后拒写、单次读取 `cliCosts`、按实例汇总的 token/完整性/缺口/费用覆盖、按频道与时间窗口与实例过滤、无数据不估算、非成员看不到、HTTP 路由鉴权）；agent-host `provider-usage.test.ts`（Claude 新会话增量、续聊首个未知、累计变小、无值不记；OpenCode 照抄含 0；写出帧校验与去重）、`provider-usage-drivers.test.ts`（Claude 冷驱动新会话/续聊、OpenCode 每步费用）、`process-runtime.test.ts`（费用帧交给 owner，非法帧丢弃并诊断）、`kimi-wire-usage.test.ts`（真实 wire 夹具切片、各类缺口、索引查找、偏移与迟到结束、缺失文件）、`kimi-acp-driver.test.ts`（新会话、续聊只计本轮且结束迟到、续聊 wire 找不到）。同步修改（行为变化，非放宽）：`kimi-provider-session.test.ts` 与原 Kimi 驱动测试的缺口原因 `unsupported_provider` → `parse_error`；schema 常量断言 72 → 73；core 端口清单加 `getUsageSummary`，client-sdk 操作清单与路由映射加 `usage.summary`。`room-kernel.ts` 行数棘轮未放宽（只改版本常量）。

B. 权限收口

1. 权限类参数由 daemon 独占（`provider-launch-arguments.js` 的托管集合，用户附加参数与 `mergeLaunchArguments` 都经它校验）：新增 Claude `--disallowedTools`、`--allowedTools`、`--permission-prompt-tool`、`--add-dir`（附加目录创建后不可改），Codex `--dangerously-bypass-approvals-and-sandbox`、`--ask-for-approval`、`-a`、`-s`、`--full-auto`、`--profile`，Kimi `--yolo`、`-y`、`--auto`、`--plan`；原有 `--permission-mode`、`--dangerously-skip-permissions`、`--sandbox`、`--approval-policy`、`-c`/`--config`、`--enable`/`--disable`、`--settings` 等保持。每 Agent 环境变量（唯一开放的自定义入口）新增保护键 `OPENCODE_PERMISSION`（OpenCode 1.18.32 并入配置 permission）、`KIMI_DISABLE_CRON`、`KIMI_CODE_EXPERIMENTAL_WAIT_FOR`（协议 schema 与 Host 运行时过滤两处一致）。现状核对：Claude 冷热均 `--permission-mode bypassPermissions` + 两个 skip 开关；Codex 冷热 `thread/start`/`thread/resume` 均 `approvalPolicy: "never"`，沙箱冷为按 toolAccessMode（full_access → `danger-full-access`），热固定 `danger-full-access`，审批请求由 `CodexUnattendedApprovalPolicy` 按身份批准；OpenCode 会话规则见下；Kimi 固定 ACP `default` 模式（不变）。
2. 禁用抢调度所有权的内置工具（以启动参数/配置为主）：
   - Claude：`--disallowed-tools` 增加 `RemoteTrigger`（2.1.282 管理云端定时 routine）与 `AskUserQuestion`（Multica 同做法）；原有 PlanMode、ScheduleWakeup、Cron 三件保持。
   - Codex：`-c features.sleep_tool=false`（`clock.sleep` 让模型在轮内跨睡眠等待，长等待归工具循环并占住 lane）与 `-c features.in_app_local_automation=false`（创建周期 automation）；0.156.1 `codex features list` 两者均 stable 默认开启，`-c` 后确认为 false（免费本地命令）。其余 stable 开启项未发现调度类。门禁原生组与 shim 白名单从同一策略派生，自动同步。
   - OpenCode：会话规则改为 allow `*` 后追加 deny `question`、`plan_enter`、`plan_exit`（与 OpenCode 1.18.32 自己的 `opencode run` 相同）；其权限求值为 agent 规则后接会话规则的 `findLast`，末尾 `*` deny 会把工具从模型工具表移除，所以用户配置不能重新打开。更正（第四十一节审查）：当时规则只在新建会话时下发，此前创建（allow `*`）的会话续聊仍沿用旧规则，question/plan 工具并未被禁用；第四十一节在续聊前安装并核验。二进制中未发现定时类工具（`cron` 字样只属于 Bun 运行时）。原有 question 事件拒绝保留为后备。
   - Kimi：cron 已由 `KIMI_DISABLE_CRON=1` 关闭、goal 由审批拒绝（不变）；新增 `AskUserQuestion` 审批一律选 `q0_skip`（reject_once）。原因：kimi-code 0.39.1 ACP 把每个答案映射为 allow_once 选项，原无人值守策略会静默替 Human 选第一个答案。
3. 测试：`provider-launch-arguments.test.ts`（上述参数全部被拒；Codex 策略参数含两个新开关；Claude 禁用列表完整）、`launch-environment-policy.test.ts`（三个环境键在 schema 与运行时都被拒）、`claude-provider-session.test.ts` 与 `claude-warm-runtime.test.ts`（每个 Claude 子进程带 bypass 与完整禁用列表）、`codex-provider-session.test.ts` 与 `runtime-implementation-registry.test.ts`（每次 app-server 启动带新开关，后者的精确参数表同步）、`opencode-server-driver.test.ts`、`opencode-warm-runtime.test.ts` 与 `opencode-provider-session.test.ts`（会话创建请求体的规则，后者原“只 allow `*`”断言同步）、`kimi-acp-driver.test.ts`（AskUserQuestion 被跳过）。

偏离与未解决：

- Kimi 的 PlanMode 没有进程开关，`EnterPlanMode` 在所有模式下不经审批直接进入（只读），`ExitPlanMode` 由现有策略批准退出；拒绝 `ExitPlanMode` 会把会话困在只读模式，所以未禁用。`WaitFor` 默认关闭（实验开关），只做了环境键保护。
- Kimi 子 agent 的用量不归属（记缺口）；（已由第四十一节修复）wire 读取原先只在 prompt 正常返回后进行，prompt 抛错的运行没有用量也没有缺口。
- Claude 冷驱动（默认）的本轮费用通常未知（续聊进程首个 result 无基线）。未做跨 RunAttempt 的会话差分：续聊是否真的恢复了累计值（旧 transcript 没有 `costState` 时从 0 起）从 result 本身无法区分，差分可能把全额当增量或反之。
- 费用只统计 Role 实例；旧 persona Agent 的运行不进汇总。汇总不分页，组数上限 500（`truncated` 标记）。
- 控制台与前端没有入口（`apps/console` 不存在），只能经 API 读取；本地服务未重启，正式库仍是 schema 72，下次启动迁移到 73；真实 CLI 均未验证（未授权付费运行）。

### 四十一、工作区/用量/权限审查修复

依据 `~/.loom/reviews/2026-09-26-review-workspace-usage-permissions.md`（负责人批准修复全部 P1/P2 与建议小修）。每项先写失败测试并确认失败，再做最小实现；没有运行付费 CLI（OpenCode 只用本地 `opencode serve --pure` 的非模型接口做免费探针，隔离 XDG 目录），没有重启服务，没有改前端。

1. P1-1 OpenCode 旧会话权限：
   - 接口证据（OpenCode 1.18.32，免费）：`GET /doc` 的 OpenAPI 中 `PATCH /session/{sessionID}`（`session.update`）请求体接受 `permission`（`PermissionRuleset`）；二进制内嵌源码为 `setPermission({permission: merge(existing, payload)})`，即追加而不是替换。探针：新建 allow `*` 会话 → PATCH 三条 deny → GET 读回为 allow + 三条 deny；再次 PATCH 同一内容会继续追加（5 → 9 条），所以只在未生效时补。工具表过滤为 `disabled(Object.keys(tools), merge(agent.permission, session.permission))`，每次模型请求读当前会话规则（`findLast` 通配匹配，`pattern:"*"` 的 deny 才移除工具），所以续聊时安装即对下一轮生效。另见 prompt 请求体的 `tools` 字段会整体替换会话规则，Loom 不发送该字段。
   - 实现：`opencode-server-client.js#ensureOpenCodeSessionPermission` 冷热共用：读会话规则，按 1.18.32 的求值（通配 `findLast`，`pattern:"*"` 的 deny）判断三项是否已生效；未生效才 PATCH 追加三条 deny，再 GET 读回核验。失败（读、更新、核验任一）抛出 `OpenCode session permission rules could not be installed on the resumed session: …`，不提交本轮输入、不换 session。冷驱动在 resume 成功之后、prompt 之前调用；热驱动在报告 ready 之前调用（失败即 fatal），换 serve 进程（未知 abort 后）时同样调用。免费探针：真实 serve 上对旧会话首次安装返回 true、第二次不再 PATCH、不存在的会话报读失败。
   - 测试（先失败）：`opencode-server-driver.test.ts`：旧 allow-all 会话 resume → PATCH 三条 deny 且读回在 prompt 之前、无新会话；已有规则不再 PATCH；PATCH 失败与 PATCH 不生效均退出失败、有诊断、无 prompt、无新会话。`opencode-warm-runtime.test.ts`：热路径同样在首个 prompt 前安装核验；安装失败时运行未完成、无 prompt、无新会话、RunAttempt 记录诊断。假 serve 按 1.18.32 语义实现 PATCH 追加并跨重启保存会话规则；`opencode-provider-session.test.ts` 的内联假 serve 让驱动创建的会话带当前规则（同步修改，非放宽）。
2. P2-1 费用覆盖率：`cliEstimatedCost.runsKnown` 改名 `runsComplete`，只在整轮费用采集被证明完整时计入：收到的记录全部已知、该运行没有用量缺口与迟到帧，且 OpenCode 每步费用按 step-finish part id 与用量逐一对应（有用量无费用或反之都不算完整）；Claude 累计差分无法逐步对应，只看记录与缺口条件。`runsPartial` 为有已知金额但完整性未证明（`totalUsd` 可能少计，缺多少未知，不补零）。新增 `runsAllRecordsKnown`（收到的记录都已知，不论是否完整；是 `runsComplete` 的超集，不作覆盖率）。协议注释写明含义。测试：审查负例（OpenCode 用量 + parse_error 缺口 + 一条 0.1 费用 → 不计 complete）、两步用量只有一步费用、Claude 有缺口；原按实例汇总测试的 OpenCode 用量 id 改为与费用相同的 part id（与生产一致）。
3. P2-2 Kimi wire 归属：
   - 基线：`kimiWireBaseline` 记下 prompt 前的大小与 dev/ino；读取时文件身份不同（被替换/恢复）即 `parse_error`、不归属；续聊会话索引存在但 wire 文件不存在时不再以偏移 0 读取，直接记缺口。新会话文件不存在时仍从 0 读（新会话不会有旧内容）。
   - 边界（0.39.1 源码与本机真实 wire 核对）：`TurnManager.prompt` 在启动本轮前写 `turn.prompt`（`input` 即 ACP 文本块原样，`acpBlocksToContentParts` 直接透传 text），step 事件带 `turnId`（字符串），`turn.ended` 带同一编号。解析从文本等于本次提交文本的 `turn.prompt` 开始，之前的记录（上一轮迟到的尾部、更早的 prompt）不归属；本轮编号取其后第一个 step 事件，此后 step 事件或 `turn.ended` 编号不一致、或出现另一个 `turn.prompt`，即记 `parse_error` 并停止，不归属；到本轮 `turn.ended` 为止，其后的记录不读。
   - 只压缩：手动压缩不写 turn 记录，只在 prompt 已正常返回（ACP 结果，独立证明）且区间内没有任何 turn/step 记录、压缩 begin 与 complete 都在时才认定；轮内自动压缩不会结束本轮，不再由“暂时没有后续 step”推断结束。
   - 测试（先失败）：`kimi-wire-usage.test.ts` 新增旧轮尾部迟到、轮内压缩后继续生成晚到、两轮连续区间（只取本轮）、轮内出现他轮编号、文件替换（改名换成更大的旧文件）、无 prompt 结果时压缩不算结束、无文件时无基线；夹具去掉了提示记录，测试按真实 wire 的位置补回 `prompt.accepted` 与 `turn.prompt`。`kimi-acp-driver.test.ts` 新增续聊 wire 文件不存在记缺口；假 ACP 在 prompt 开始时写 `prompt.accepted`/`turn.prompt`（与 0.39.1 相同）。
4. P2-3 Kimi prompt 抛错：请求确实写出后（`onId` 改为写出成功后才回调），错误路径做一次有界读取（最多 500 ms；停止中为 0），保存已完成 step 的用量并始终再记 `parse_error`；运行仍以原错误失败，读取失败被吞掉不覆盖原错误。测试（先失败）：已完成一步后 prompt 被拒（JSON-RPC 错误）与进程断开，均退出失败、保留该步用量、只有 `parse_error` 缺口，被拒时 stderr 为原错误。
5. P2-4 `usage.summary` ACL：除实例所属频道成员外，要求查询者是 `run_attempts.room_id`（运行实际房间，如私聊）的成员，仍按实例所属频道分组。测试（先失败）：同频道另一 Human 只看到频道运行、看不到 owner 私聊运行的用量；owner 两者都看到且归在该频道下。
6. 小修（附加目录身份）：Kernel 把频道的附加目录交给同一个 `channelPrimaryDirectoryPreparer`（签名增加 `additionalDirectories`），daemon 预备器调用 `createChannelHome({attachedDirectories, reservedDirectories})`：先按共同 Host 规则检查全部附加目录，再建主目录，并在同一次准备中写附加目录身份记录（`channel-home-records.ts` 成为附加身份记录的唯一读写处，catalog 改为调用它）；回滚一并删除这些记录。测试（先失败）：agent-host 创建后、首次绑定前替换附加目录 → 刷新拒绝（`attached_directory_replaced`）；附加目录违反规则时准备失败且不留主目录与记录；kernel 预备器收到附加目录；daemon 真实 Kernel + 预备器 + catalog 端到端拒绝。

偏离与未解决：

- OpenCode：安装只在续聊边界与换 serve 时做，运行中不重复核对；外部进程若在运行中改会话规则，不会被发现。会话规则只追加不删除，旧会话首条 allow `*` 保留（被其后 deny 覆盖）。子会话（subagent）的规则由 OpenCode 自行继承，未单独核验。
- Kimi：本轮身份依赖 `turn.prompt` 文本与提交文本逐字相等；若 kimi-code 将来改写文本（例如附件处理），会表现为缺口而不是错数。wire 中的 `usage.record` 不带 turnId，只按区间计数。错误路径即使读到本轮结束也记缺口（运行失败时的完整性不作保证）。格式变化仍可能表现为错数，不宣称只会缺口。
- 费用：`runsComplete` 只证明 Loom 收到的记录与用量相互对应，不证明 CLI 的估算正确；Claude 冷驱动的本轮费用仍多为未知。字段改名是 API 破坏性变化（仅 API 使用方，前端未使用）。
- 附加目录：创建时记录身份后，恶意并发改名的 TOCTOU 仍未解决；没有预备器的 Core 与此前创建的频道仍在首次绑定时记录。
- 真实 CLI 均未验证（未授权付费运行）；控制台不存在；本地服务未重启。

### 四十二、附加目录冒烟门禁

为付费冒烟准备（负责人要求），漂移门禁新增可选的频道附加目录检查 `RAH_DRIFT_ATTACH=1`，细节见 [漂移门禁文档](../design/long-session-drift-gate.zh-CN.md#附加目录冒烟rah_drift_attach1可选)。每项先写失败测试并确认失败，再实现；没有运行任何付费 CLI 或真实 CLI，没有重启服务，没有改前端，没有放宽已有断言。

1. 夹具与频道：gate 在临时根下建附加目录与 `facts/attached-secret.txt`（每次随机口令，目录取 realpath）；隔离 daemon 配置 `channelWorkspaceRoot = <临时根>/channel-workspaces`（`gate-daemon.mjs#gateDaemonConfig`，对所有 gate 生效：此前 gate 建频道会在真实 `~/.loom/channel-workspaces` 建主目录）；频道经真实 `room.create` 带 `additionalDirectories` 创建，要求主目录已记录且 `primary.state = ready`，题目源文件复制进主目录；Role 不再指定 `existing_mount`，实例由 Kernel 选 `channel_home`；常驻指令多一行只读许可（不含文件名与口令）。
2. 场景与判定：最后一段五类模板之后插入 `attached-read` 轮（只给相对名与“附加目录中”）；频道内目标正确的回复含口令为 ok，否则硬失败 `attachedRead`。轮数 6..60、每段 ≥5 轮与压缩轮规则不变，开启时最后一段须 ≥6 轮；`RAH_DRIFT_COMPACT_AT` 空串（不压缩）原本已允许，补了测试。
3. 证据（只报告，缺来源记 `unknown`）：`result.attach` 记频道工作区、实例 cwd（Host channel_home 回执、placement 挂载、守卫 shim 记录的实例创建后每次 CLI 启动 cwd、Codex thread cwd）、各 CLI 附带方式（Claude `--add-dir=`、Codex `runtimeWorkspaceRoots`、Kimi 平台版 `local.toml`、OpenCode 常驻提示词 `- Attached directory:` 行）；每轮 `usageRecords`（`run_attempt_usage` 行数与缺口原因，Kimi 标 `kimi-wire`）；OpenCode `arm.openCodePermission`（`POST /session` 与 `PATCH /session/:id` 的规则，按 `findLast` 报告 question/plan_enter/plan_exit 是否 deny）。shim 启动记录只存 cwd、子命令、探针标记与 `--add-dir` 值，不存其他 argv（可能含凭据）。脱敏文件同时替换临时根的规范路径。
4. 围栏修正（产品已发送、原 gate 会拒绝的请求）：Codex 围栏放行 `thread/start|resume` 的 `runtimeWorkspaceRoots`（只许非空绝对路径数组；第三十九节起有附加目录时产品发送，原白名单会拒绝并杀掉 CLI）；OpenCode 代理放行 `PATCH /session/:id`，只许恰好一个 permission 规则数组（第四十一节起续聊旧会话时产品发送，原代理只放行 POST，会 403 并关闭 CLI）。模型/effort 校验不变。
5. 测试：`drift-config.test.mjs`（ATTACH 取值、默认关闭、约束不变、最后一段 ≥6、空压缩串）、`drift-scenario.test.mjs`（插入位置、消息不含绝对路径与口令、其余轮不变、覆盖检查、常驻指令）、`drift-checks.test.mjs`（含口令通过、无口令/无回复/他处回复失败、汇总与 `violated`）、新增 `drift-attach.test.mjs`（夹具随机与权限、启动记录不含其他 argv、Kimi 文件各状态、OpenCode 提示行与规则求值、Host 回执、四家附带方式与 cwd 判定、用量来源）、`model-guard.test.mjs`（roots 放行与非法形状拒绝、thread 记录、假 Codex stdio 端到端记录）、`drift-opencode-guard.test.mjs`（PATCH 形状、请求记录、假 serve 端到端记录与提示行）、`guarded-shim.test.mjs`（启动记录）、新增 `gate-daemon.test.mjs`（主目录根在临时根下）、`gate-evidence.test.mjs`（规范路径脱敏）。

偏离与未解决：

- 附带方式证据只证明参数/文件/提示行已交给 CLI；模型是否使用只由 `attached-read` 轮判定。cwd 与附带方式证据不影响 gate 状态，需人工看。
- Codex 每轮压缩客户端恢复线程时不带 `runtimeWorkspaceRoots`；OpenCode 提示行只在 serve 启动时读取；OpenCode 规则证据是请求级（PATCH 为追加，未读回会话最终规则）。
- 尚无付费样本（未授权运行）；控制台不存在；本地服务未重启。

### 四十三、附加目录付费冒烟（2026-09-26，9762f59，负责人授权）

证据 `docs/evo/evidence/2026-09-26-smoke-attach-*.json`，6 轮不压缩，频道带一个附加目录，第 6 轮要求读取附加目录中的随机口令文件。

- 四家（Codex 常驻 gpt-6-luna/low、OpenCode 常驻 deepseek-flash/low、Claude 冷 haiku、Kimi 冷 k3-256k/low）附加目录读取全部通过（4/4），实例 cwd 为频道主目录，主目录 primary=ready。
- OpenCode：新会话权限规则 question/plan_enter/plan_exit 均被 deny（本次无旧会话，PATCH 路径未触发，旧会话续聊只有 fake 与免费 serve 探针证据）。
- Kimi：产品侧逐轮用量均来自 wire（每轮 1–2 行），不再是整体缺口。
- 门禁结论：OpenCode、Claude、Kimi pass；Codex violated，唯一原因是第 3 轮沉默轮未 message-check 重试一次（模型遵守度，已知问题）。首轮格式超长为既有软项。

### 四十四、最小控制台：批次 1（只读）

计划见负责人存档的控制台计划（2026-09-26）。批次 1 只读，不含任何写操作；每项先写失败测试并确认失败，再实现。没有运行付费 CLI，没有重启服务，没有改前端冻结范围（`git diff main --stat -- apps/web/src packages/ui-web packages/ui-tokens/specs` 为空），没有放宽断言，没有新增外部依赖（lockfile 只新增 `apps/console` 工作区与其 `node_modules/@rah-os/console` 链接）。

1. 网关（B2）：`LocalWorkbenchGateway` 新增可选 `consoleDirectory`（绝对路径）。`/_rah/console` 301 到 `/_rah/console/`；`/_rah/console/*` 只从该目录取文件，缺失的非 `assets/` 路径只回退到该目录的 `index.html`，缺失的 `assets/*` 为 404；该分支位于原 `/_rah/` 404 与 apps/web SPA 回退之前。沿用 CSP（`script-src 'self'`、无 `unsafe-eval`）、`nosniff`、`no-referrer`、`X-Frame-Options`，index 为 `no-store` 并下发 loopback 会话 Cookie；trusted-network 模式可访问、无 Cookie。未配置、目录不存在或无 index 时返回 404 与“run npm run build:console”。解码后含 `..` 段或反斜杠的路径一律 404；`/_rah/console/*` 的非 GET/HEAD 为 405（更正：无斜杠的 `/_rah/console` 对任何方法都先 301 到 `/_rah/console/`，不写业务）；API 写请求仍要求同源 Origin（未改）。缓存说明（更正计划中“避开 apps/web service worker scope”的说法）：根 scope 的 apps/web SW 仍可控制控制台页面，不污染缓存的依据是 `apps/web/public/sw.js` 对 `/_rah/` 的 network-only 分支、控制台 index 的 `no-store` 与独立 asset URL；控制台不注册自己的 SW。第四十六节起静态根另拒绝符号链接。`startLocalCoreWorkbench` 只在 loopback/Tailnet 网关透传（LAN 网关不提供控制台），`startRestartableLocalCoreWorkbench` 经 `...input` 透传，重启后仍可访问；`scripts/run-local-workbench.mjs` 读 `RAH_CONSOLE_STATIC_DIRECTORY`，否则在 `apps/console/dist` 存在时使用它。测试：`local-workbench-gateway.test.ts` 三个新测试（服务与头、未构建 404、trusted-network），`local-core-workbench.test.ts` 重启前后控制台页。
2. SDK（B1）：client-sdk 新增 `runtime.settings.read` / `runtime.settings.update`（`/v3/client/runtime-settings/read|update`，schema 为 protocol 的 `RuntimeSettings*`），操作名快照与路由映射测试已更新；`same-cli-instance-concurrency.test.ts` 的运行设置读改改经 `HttpRahClient` 端到端调用。
3. `apps/console`（`@rah-os/console`，私有）：原生 TS + DOM，vite 构建，`base: /_rah/console/`，单入口，index 无内联脚本；`main.ts` 先把 Zod 设为 jitless 再动态加载应用（同 apps/web，否则 Zod 的 `Function("")` 探测会在无 `unsafe-eval` 的 CSP 下报违规）。`api.ts` 用 `HttpRahClient` trusted-proxy 模式（网关替换占位 Bearer）并缓存每房间 `RoomSession`（批次 2 写路径用）；`model.ts` 为纯函数与经 `RahClient` 的读取；`view-*.ts` 只用 `createElement`/`textContent`；hash 路由；轮询：当前频道 3 秒、列表/用量/设置 15 秒，`document.hidden` 时暂停，新请求中止旧请求（AbortSignal），被中止的响应不渲染。
4. 只读视图：连接与身份（未连接明确显示原因）；频道列表（仅未归档 channel：主目录路径、`primary.state`（含失败原因）、附加目录；无 `channelWorkspace` 的旧频道标“实例使用私有 cwd”，有工作区但未记录主目录显示“未记录”）；频道消息只读（最近 50 条，之后按 `afterSeq` 增量，系统消息高亮）；实例状态（`role.list` 过滤本频道实例、`isCurrent`、`room.agent.activity.list` 的 state/lastError，`waking` 显示“排队或启动中”，无记录显示“无运行记录”；私聊可用/已停用/未打开；最近运行事实为 `run.watchdog_warning` 时显示“无进展已达告警阈值”，之后有 run 结束/开始即不再显示；`agent.activity.list` 最近 3 条 warning/error）；唤醒上限系统通知横幅，窗口内 Human 再发言后消失；用量（`usage.summary` 按实例，24 小时/7 天；无用量记录的运行不计 0，只有部分运行有记录时标“部分”，费用为 CLI 自报，未知显示“未知”）；运行设置只读（经新 SDK 操作）。
5. 根脚本：`build:console`、`test:console:unit`、`test:console:browser`（先 `build:console`）；`typecheck` 追加 `@rah-os/console`；`check` 追加 `test:console:unit`；`.prettierignore` 加 `apps/console/dist/`。
6. 测试：`apps/console/test/model.test.ts`（FakeRahClient：频道拼装与旧频道、身份、消息窗口与增量、唤醒上限提示、实例状态拼装与加载调用、状态文案、用量格式化与未知、用量时间窗、运行设置行）。浏览器门禁 `scripts/run-console-browser-gate.mjs`（系统 Chrome + CDP；临时 HOME 与 `RAH_DATA_HOME`、假 codex、随机端口；fixture URL 与数据均标注 FIXTURE）：经 API 预置带临时附加目录的频道（主目录须在临时 HOME 下且 `ready`）、XSS 探针消息、Role 与实例；断言身份、频道卡片三项与 API 一致、旧频道标注（本夹具中为 0 个）、实例卡片（名称、最新修订、状态文案、私聊未打开）、注入的 `<img onerror>` 以文本显示且页面无 img、运行设置与 API 一致且无输入控件、用量合计行、1440 与 390×844 无横向滚动且关键区域在视口内、无 CSP 违规与控制台错误。本地运行通过。

删除点（phase 4）：删除 `apps/console`、`scripts/run-console-browser-gate.mjs`、网关 `consoleDirectory` 分支与 `CONSOLE_PREFIX` 常量、`startLocalCoreWorkbench` 的 `consoleDirectory` 与 `run-local-workbench.mjs` 的 `RAH_CONSOLE_STATIC_DIRECTORY` 读取、根脚本 `build:console`/`test:console:*` 及 `typecheck`/`check` 中的追加项、`.prettierignore` 条目；client-sdk 的 `runtime.settings.*` 操作保留（产品设置页可用）。

偏离与未解决：

- 唤醒上限提示只看已加载的最近 50 条窗口；通知与 Human 发言都在窗口外时不显示。系统消息只按 `actorId = principal_system` 与正文“连续唤醒”识别（Message 无 systemNotice 字段）。
- 看门狗告警按实例的最近 20 条活动判断，跨房间（频道与私聊）合并。
- 浏览器门禁未覆盖旧频道标注（新夹具没有旧频道，只有单测）、系统消息高亮与唤醒横幅（单测覆盖）、轮询的旧响应丢弃（只有实现，无浏览器断言）。
- 排队原因、压缩次数、失败 run 全文等计划推迟项未做；本地服务未重启。

### 四十五、最小控制台：批次 2（介入操作）

在批次 1（第四十四节）只读控制台上加入 Human 介入写操作。每项先写失败测试并确认失败，再实现。没有运行付费 CLI，没有重启服务，没有改前端冻结范围（`git diff main --stat -- apps/web/src packages/ui-web packages/ui-tokens/specs` 为空），没有放宽断言，没有新增外部依赖，DOM 只用 `createElement`/`textContent`（无 `innerHTML`）。

1. B3（协议 + Kernel）：`RoomAgentActivitySchema` 增加可选 `queued: boolean`；Kernel `room.agent.activity.list` 对每个实例总是给出它，含义是“本 Room 存在 `state='queued'` 的 Activation”（只在所列 Room 内 `EXISTS`，不跨房间）。`state` 判定未变。测试 `packages/kernel/test/room-agent-activity-queued.test.ts`：空闲 → `idle`/`false`；只有排队 → `waking`/`true`；已 lease 运行中再来一条 → `working`/`true`（且库中恰有 1 条 queued）；私聊排队不出现在频道结果（空闲与频道运行中两种情况），私聊 Room 自己的结果为 `true`。控制台实例卡片显示“排队 N（频道 x，私聊 y）”，N 为两个 Room 的布尔之和（Activation 本身会合并，不是条数）；服务端未给出时显示“排队 未知”，不当作 0。实例卡片额外读取 `agent.list`（取实例自己的 handle，@ 提及用它，不是 Role 的 handle）和私聊 Room 的 `room.agent.activity.list`。
2. 写操作封装（`apps/console/src/actions.ts`，单测 `apps/console/test/actions.test.ts`）：所有 Room 写经 client-core `runRoomMutationAtLatest`，`basedOnRoomSeq`（创建频道为 `basedOnControlRoomSeq`）来自该 Room 的 `RoomSession` 同步；`stale_context` 自动重新同步后重试，总尝试次数 3（client-core 默认值，即首次 + 最多 2 次重试）；每次用户动作生成一个幂等键（`console-<动作>-<uuid>`），重试复用，其他错误不重试。`ActionGate` 每个操作面只允许一个进行中的动作，按钮在 pending 时禁用，键盘提交走同一个 gate，因此同样被拒绝。输入预检用 protocol schema：`ChannelAttachedDirectoriesSchema`、`RoleConfigurationSchema`、`RuntimeSettingsUpdateSchema`。频道页轮询也同步同一个 `RoomSession`，生命周期事件与急停状态取自它的事件窗口。
3. 功能：
   - 创建频道（频道页）：名称、slug、附加目录（多行、每行绝对路径）；前端预检失败不发请求；服务端 Host 拒绝原样显示（消息 + code + HTTP 状态）；成功后显示主目录与 `primary.state`，并在 `pending` 时每 2 秒刷新列表（最多 15 次）。
   - 发消息（频道页）：Enter 发送、Shift+Enter 换行、IME 组字（`isComposing` 或 keyCode 229）不发送；可选 @ 一个仍在频道的实例 → `recipients` 为 `{participantId, reason: "mention"}`，正文不含 `@handle` 时在前面补上。
   - Role 最小创建（新 “Role” 页）：displayName、handle、role、instructions、runtimeOfferId（下拉只来自 `host.runtime.list` 中 `available` 且有 offer 的项）、模型 binding 与推理强度（只能选该 offer 发布的 binding 与其 `supportedReasoning`），`modelIntent` 为 `exactBindingIds:[id]`、`fallback: disabled`。频道页“添加实例”选择 Role 后 `role.instantiate`。
   - session reset：实例卡片内联确认框说明后果（新原生 session、历史与记忆保留、运行中会被拒绝、会话连续性隔离的激活重新排队）；拒绝原因原样显示；成功显示 session 代数与事件序号，生命周期列表出现 `instance.session_reset`。
   - 移出实例：内联确认；服务端 “active collaboration work” 拒绝时显示原因与清理提示（等待完成、急停、处理任务后重试）。`role.list` 在移出后不再列出该实例，页面保留已知卡片并标“已移出频道”、隐藏操作，刷新后消失。
   - 运行设置编辑：表单基于某个修订，只提交改动字段并带 `expectedRevision`；schema 预检；说明“只影响之后的调度”；轮询发现更新修订时提示而不覆盖正在编辑的表单；409 冲突时提示并重新读取。
   - 频道急停/恢复：`room.sos.stop`（内联确认）与 `room.sos.resume`（必填指引）；状态取同步事件窗口里最新的 `room.agent_sos_*` 事件，窗口内没有记录时明确标注。
4. 浏览器门禁 `scripts/run-console-browser-gate.mjs`（扩展批次 1；系统 Chrome + CDP，临时 HOME/`RAH_DATA_HOME`、随机端口，fixture 均标注 FIXTURE；PATH 只含假 `codex` 与 `git`/`ps`/`lsof` 链接）。假 `codex` 的常驻 app-server 路径直接加载仓库既有夹具 `packages/agent-host/test/fixtures/fake-codex-warm-app-server.mjs`（正文含 `[fake:final]` 的轮次经 Worker CLI 发 “FAKE final answer …”）；本次实际走的是常驻路径。修复了批次 1 门禁的隐患：PATH 缺 `ps` 时进程清扫失败、实例运行全部隔离（批次 1 只接受任意状态文案，因此未暴露）。门禁经 UI 完成：相对路径被前端拦截且不发请求；不存在的附加目录被服务端拒绝并原样显示；带临时附加目录创建频道，主目录在临时 HOME 下并显示 `ready`；XSS 探针经输入框发送后按文本显示；创建 Role（CLI/模型下拉与 Host 目录完全一致）并实例化，面板显示“空闲”“排队 0”；@ 实例并按 Enter 发送，正文带实例 handle，面板显示“排队或启动中”与“排队 1（频道 1，私聊 0）”（API 采样 `idle → waking+queued → waking → working → idle`；UI 3 秒轮询未采到“运行中”），频道出现假 CLI 回复后回到“空闲”；Shift+Enter 换行不发送、合成的 `isComposing` Enter 不被拦截也不发送；一次 pending 期间两次 Enter + 一次点击只产生一条消息且按钮已禁用；设置页修改唤醒上限并读回一致（只改该字段、修订 +1），外部先保存后以旧修订提交显示冲突、值未被覆盖、表单重读到新修订；session reset 成功且 API 与生命周期列表都有 `instance.session_reset`；有排队工作时移出被拒并显示原因与提示，空闲后移出成功；急停/恢复可用；外部 Origin 的 POST 为 403；390×844 下关键控件在视口内、无横向滚动，并以真实指针点击发送成功；无 CSP 违规与控制台错误（被拒写请求只出现在预期的 3 个端点）。所有点击都是 CDP 真实指针事件并先验证命中目标。本地运行通过（截图目录形如 `$TMPDIR/loom-console-browser-gate/<时间戳>/`）。

删除点（phase 4）增补：`apps/console/src/actions.ts`、`view-roles.ts` 与门禁扩展随 `apps/console` 一起删除；`RoomAgentActivitySchema.queued` 与 Kernel 实现保留（产品实例面板可用）。

偏离与未解决：

- 运行设置不是 Room 写，没有 `basedOnRoomSeq`，不经 `runRoomMutationAtLatest`，用 `expectedRevision` 做并发控制；同样经 `ActionGate`，无幂等键（接口不接受）。
- “重试最多 3 次”按 client-core 默认理解为总尝试 3 次。
- 一次动作失败后用户再次点击是新动作、新幂等键；若失败发生在服务端已提交之后（例如网络中断），可能重复。
- 急停状态只看已同步的事件窗口；`room.sos.*` 没有只读接口进 SDK。恢复会给频道内所有实例发 manual 唤醒，门禁里实例已移出，未覆盖“急停时实例正在运行”的终止证明路径（只有 Kernel 测试）。
- IME 只用合成的 `isComposing` 键盘事件验证，没有驱动真实输入法。
- 移出后的实例卡片只在当前页面保留；`role.list` 不再列出已移出实例，刷新后无从显示。
- 生命周期事件与急停状态依赖 `room.sync` 的最新快照窗口，窗口外的历史不显示。
- 本地服务未重启；真实 CLI 发消息验收仍需负责人同意。

### 四十六、控制台审查修复与批次 3

依据 Codex 控制台审查（`~/.loom/reviews/2026-09-26-console-review.md`，P1-1、P2-1–P2-4 与两处小修）和控制台计划批次 3。每项先写失败测试并确认失败，再实现。没有运行付费 CLI，没有重启服务，没有改前端冻结范围（`git diff main --stat -- apps/web/src packages/ui-web packages/ui-tokens/specs` 为空），没有放宽断言，没有新增外部依赖，DOM 只用 `createElement`/`textContent`。

1. P1-1 结果未知与重试：`actions.ts` 新增 `WriteIntentSlot`（表单级、只在内存），取代批次 2 的 `runRoomAction`（已删除）。一次提交的意图保存冻结 payload（`structuredClone` 后深冻结）、幂等键和最后一次实际发送的 `basedOnRoomSeq`。`classifyWriteFailure`：只有 4xx 明确拒绝（408 除外）算“被拒绝”；网络错误、超时、5xx、2xx 但响应无法解析都算“结果未知”；请求还没发出（例如先行同步失败）算被拒绝。结果未知时 UI 显示“结果未知…”和“核实/重试原操作”“放弃（不再核实）”两个按钮，新提交被拒绝并提示先处理；重试先原样重发同一请求（同键、同 payload、同 `basedOnRoomSeq`），若服务端答 `stale_context`（说明原请求未提交，Kernel 先查重放再查新鲜度），再按新头部重同步后用同一键重试。必须重用原 `basedOnRoomSeq` 的原因：`role.create`/`role.instantiate`/`role.revise` 的请求摘要包含 `basedOnRoomSeq`，换序号会被判幂等冲突。成功或明确放弃后才能开始新意图。覆盖：发消息、实例化、session reset、移出、创建频道、Role 创建/修订、急停/恢复、打开私聊。测试 `apps/console/test/intent.test.ts`（fake 服务端复刻 Kernel 先重放后新鲜度语义，含“摘要含序号”变体）：提交后丢响应 → 未知 → 期间新提交被拒且未发送 → 其他写入推进头部后重试 → 请求与首发完全相同、服务端只有一次效果、结果 `deduplicated`；未提交的 503 → 重试重放被判 stale → 重同步后同键成功；拒绝与未发出不算未知；放弃后可开新意图；pending 时拒绝第二次提交与重试。
2. P2-1 冻结字段与草稿：所有写入的 payload 在提交时冻结，stale 重试与未知重试都发同一份。创建频道与 Role 创建/修订表单在意图 pending 或未知期间整体禁用；发消息与恢复指引输入框保持可编辑，成功回调只在当前草稿仍等于提交时的文本时才清空。测试：`intent.test.ts` 中 pending 期间修改调用方草稿，三次 stale 尝试的正文都不变；浏览器门禁见第 4 条。
3. P2-2 运行设置文案：删除“正在运行的工作不会被中断”。`settingScope`/`SETTINGS_SCOPE_NOTES`：并发上限、启动限流、唤醒上限只影响之后的调度；看门狗三个阈值保存后即时适用于正在运行的工作（`daemon-runtime-settings` 立即更新 runGuards，`run-watchdog` 每个 tick 读取），调低单次时长上限或排队无进展终止阈值会在下一次检查终止已超阈值的运行（有终止证明）并在同一 session 续接；告警阈值只影响告警。看门狗行带 `data-scope="immediate"` 与逐行提示，保存成功文案按是否改了看门狗区分。测试 `actions.test.ts`。
4. P2-3 控制台静态根：网关 `consoleStaticTarget` 以 canonical 构建根为起点逐段 `lstat`，候选文件或任何祖先是符号链接即 404 且不做 SPA 回退，普通文件还须 `realpath` 位于 canonical 根内；`index.html` 是符号链接时按未构建处理。构建树被假定在检查与读取之间不变（不针对敌对并发写入做目录句柄策略）。apps/web 的静态分支未改（原有同类性质不在本批范围）。测试 `local-workbench-gateway.test.ts` 两个新用例（文件链接、目录祖先链接、`assets/` 下链接、指向根内文件的链接均 404，普通文件与 SPA 回退照常；index 链接按未构建 404）。
5. P2-4 急停状态：窗口内没有急停事件时显示“急停状态未知（当前事件窗口无记录）”，不再说“未急停”。测试 `actions.test.ts`。
6. 小修：hash 路由抽成纯函数 `route.ts#parseRoute`，非法百分号编码返回无效路由，页面显示“无效路由”而不是抛错；§44 文档更正无斜杠 301 与 SW 说明（见第四十四节第 1 条）。
7. 批次 3 私聊：实例卡片“打开私聊”调用 `room.direct.open`（控制房间序号、意图槽）后进入 `#/direct/<roomId>`；已打开的显示“查看私聊”链接。私聊页复用抽出的 `view-messages.ts`（消息窗口 + 发消息，不带 @），显示本私聊的实例状态、排队与本私聊的运行；频道页只读频道 Room，看不到私聊消息或私聊运行。
8. 批次 3 RunAttempt 下钻：实例卡片“最近运行（本 Room）”列出该实例最近 20 条活动中本 Room 的 RunAttempt（`runAttemptsInRoom`，私聊运行不进频道列表），点击后 `agent.run.usage.get` 显示执行方式（冷/热、迟到帧）、`sessionResumeMs`、final 收尾（请求/接受/终止/抢占）、完整性与合计、上下文占用（只有 CLI 原生报告时有值，目前只有 Codex，其余“未知”）、采集缺口、进程清扫与 CLI 自报费用；所有 `null`/缺字段显示“未知”，不显示 0。测试 `model.test.ts`（Codex 样本、Claude 式全空样本、部分费用样本）。
9. 批次 3 Role 修订：Role 页每张卡片“修订…”把当前配置填入修订表单，CLI/模型/推理强度只能从 `host.runtime.list` 目录选择（目录已不发布的 binding 无法保留，提交会被前端拦下）；未编辑的配置字段（描述、头像等）原样保留，`modelIntent` 换成所选 binding 的精确意图；带 `expectedRoleRevisionId`，他处已修订时显示拒绝原因并提示重新选择。卡片显示仍用旧修订的实例数。测试 `actions.test.ts`（`roleFormFrom`、带 base 的 `buildRoleConfiguration`）。
10. 浏览器门禁扩展（`scripts/run-console-browser-gate.mjs`，临时 HOME/`RAH_DATA_HOME`、假 codex、随机端口，fixture 均标注 FIXTURE；网关服务控制台构建的临时副本）：创建频道的请求被 CDP Fetch 扣住时三个字段均禁用、期间另一控制房间写入使其 stale、脚本改写名称，最终 2 次请求同键同名同目录，频道只有一个，改过的字段不被清空；新频道急停状态显示“未知”；Role 修订（模型选项与目录一致、API 新修订与说明一致、实例卡片显示“Role 已有新修订”、实例仍冻结旧修订）；频道 RunAttempt 下钻与 API 原始响应逐项一致；打开私聊（API 确认 `instancePrivateBox`）、发私聊并收到假 CLI 回复、私聊运行下钻（该样本用量无记录，页面各项为“未知”并与 API 一致）、回到频道页后正文与 API 频道消息逐条一致、不含私聊文本、频道运行列表不含私聊运行；发消息响应被丢弃（服务端已提交）→“结果未知”→期间新草稿按 Enter 被拒→“核实/重试原操作”→服务端仍只有一条、两次请求体完全相同、新草稿保留；发消息请求被扣住期间外部写入使其 stale 且用户改写草稿 → 2 次请求同键同正文、服务端一条原文、零条改写文本、草稿保留；设置页两段范围文案与三个即时生效字段、无“不会被中断”；实例化响应被丢弃 →“结果未知”且实例化按钮禁用 → 重试后该 Role 在频道只多一个实例、两次请求体相同；非法 hash 显示无效路由且无异常；控制台根内文件链接、目录链接（含其下 SPA 路径）、`assets/` 下链接经浏览器 fetch 均 404 且无 SPA 回退。原有批次 1/2 断言保持。本地运行通过（截图目录形如 `$TMPDIR/loom-console-browser-gate/<时间戳>/`，含 run-detail、private-box、unknown-result）。
11. 复审 2 修复（`~/.loom/reviews/2026-09-26-console-review-2.md`，P1-1 残留与 P2-1；先写失败测试并确认失败）：
    - P1-1 未知后的拒绝不再清掉意图：`WriteIntentSlot` 分开保存“先前某次发送结果未核实”（`unverified` 与那次发送的 `basedOnRoomSeq`）和“本次请求的结果”（`IntentOutcome.unknown.verificationFailed`）。首次发送得到 4xx 或请求还没发出仍回空闲；一旦出现结果未知，只有三种情况能解除：同键请求成功（重放或首次提交），属于 `REPLAY_BEFORE_FRESHNESS` 的操作在原样重放时得到 `stale_context`（证明原请求未提交，随后在新头部用同一键重发），或用户显式放弃。其余情况都只算本次核实失败，保留原键、原 payload 和原序号，页面提示“本次核实未成功…原操作结果仍未知…恢复后可再核实”，且不再建议刷新（刷新会丢失原键）。其余情况包括 401（网关 Cookie 轮换）、403、404、429、幂等冲突和未确认端点的 stale；核实时再遇网络错误、超时或 5xx，则照常显示“结果未知”。`REPLAY_BEFORE_FRESHNESS` 按端点列出依据：已核对控制台用到的 10 个端点在 evo HEAD c5cbf98 的 Kernel 处理顺序，均为同一事务内先查幂等键、再查新鲜度，逐端点的行号写在 `actions.ts` 常量里；不在表内的操作一律保守保留未知，不再发新基准请求。权限检查在重放之前的端点（例如 role.* 的 `requireHumanControlRoomManager`）得到 403 时，同样只算核实失败。离开页面时：页面上有 pending 或未知意图时，`beforeunload` 会提示；站内 hash 导航用 `confirm` 询问，取消则用 `history.replaceState` 还原地址并保留意图，确认则丢弃提示登记。测试 `intent.test.ts`：提交后丢响应 → 未知 → 401/403/404/429/幂等冲突分别核实失败，状态仍未知，原键和 payload 不变，新提交被拒 → 头部推进后再核实，原键重放 `deduplicated`，服务端只有一次效果；首次 401/403/404/429 回空闲；未确认端点重放 stale 仍未知，且不发新请求；未解决意图登记。
    - P2-1 费用与上下文口径：行名改为“已记录费用小计（CLI 自报）”，只对返回的费用行求和，不估算缺失金额。`completeness` 不是 complete 或存在采集缺口时，标注“整轮完整性未知”；有增量未知的行时加 “≥” 并注明“另有 N 条增量未知，未计入”；费用行数达到 `RUN_ATTEMPT_CLI_COST_READ_LIMIT`（1000）时加 “≥” 并注明之后的未列出。生成列表截断时，上下文占用标注“所列生成中的最后一次，不代表当前窗口”；逐次生成标题改为“已截断：只列最早 N 次；token 合计覆盖全部生成，上下文占用只取所列生成中的最后一次”，不再说“合计仍覆盖全部”。测试 `model.test.ts`：partial + parse_error 缺口 + 已知 OpenCode 0.1 显示 `$0.1000（整轮完整性未知）`；只有缺口时同样标注；完整时只显示金额；截断时上下文与 1000 条费用上限的标注。长运行的完整费用或最新上下文如确有需要，应由 Kernel 返回聚合结果与覆盖标记，前端不翻全历史（按触发条件列为后续项）。
    - 浏览器门禁新增场景：发消息响应被丢弃（已提交）→ 结果未知 → 核实请求被 CDP 在到达网关前以 401 应答 → 显示“本次核实未成功（HTTP 401）…原操作结果仍未知”，不含“请刷新页面”，未知框仍在，发送按钮禁用 → 站内导航弹出确认，取消后留在原页，意图仍在 → 再核实，原键重放“原请求已执行” → 3 次请求体完全相同，服务端只有一条 → 解决后导航不再弹窗；截图 `unknown-verify-401-1440x1000.png`。运行详情断言改用新行名。

删除点（phase 4）增补：`apps/console/src/route.ts`、`intent-view.ts`、`view-messages.ts`、`view-run.ts`、`view-direct.ts`、`apps/console/test/intent.test.ts` 随 `apps/console` 删除；网关 `consoleStaticTarget` 随 `consoleDirectory` 分支删除（其测试随之删除）。

偏离与未解决：

- 意图记录只在内存：页面刷新或离开该页后丢失，已知的幂等键随之丢失；此时 UI 无法再核实，需以刷新后的实际状态为准。放弃核实后同样只能看实际状态。第 11 条起离开含 pending/未知意图的页面会先提示（浏览器对 `beforeunload` 只显示通用文案）。
- `REPLAY_BEFORE_FRESHNESS` 是对 c5cbf98 的 Kernel 处理顺序的人工核对，不是协议保证；Kernel 调换顺序时需同步更新该表（未加自动化契约测试）。
- 运行设置不在意图槽内（接口没有幂等键）：响应丢失后再保存会因修订号变化得到 409 冲突并提示重读，不会静默重复。
- RunAttempt 列表只来自实例最近 20 条活动，较早的运行不列出；Codex 以外 CLI 的上下文占用为“未知”只有单测（门禁只有假 codex）；压缩次数仍未展示。
- 私聊页只显示已出现在 `room.list` 的实例私聊；实例已移出频道时 `role.list` 不再列出它，私聊页读不到其运行记录（显示说明）。
- 静态根的符号链接检查与读取之间存在 TOCTOU 窗口，前提是本地构建树可信。
- 急停状态仍只看已同步的事件窗口，窗口外历史显示“未知”，未补只读 SOS 查询。
- 真实 CLI 与真实输入法未验证；本地服务未重启。

### 四十七、控制台真实验收（2026-09-26，8b57726，负责人授权）

经控制台同一 API（网关 trusted-proxy、RoomSession + runRoomMutationAtLatest、每意图一个幂等键）在正式 evo 服务上：创建频道 `smoke-console`（主目录 `~/.loom/channel-workspaces/<roomId>`，primary=ready，附加目录已登记）；创建 Codex Role（`local:codex-cli/v1:gpt-6-luna`/low，fallback disabled）并实例化；Human @实例请其读取附加目录中的口令文件。状态序列 waking(queued) → working → idle；回复逐字等于口令、位于频道顶层，发帖到回复约 12.4 s（冷启动）；1 个 RunAttempt、2 次生成、0 重试；用量 complete（输入 34,938 / 缓存 18,944 / 输出 218），Codex 不报费用，汇总显示未知。报告 `~/.loom/reviews/2026-09-26-console-real-acceptance.md`。

- 已修（待提交）：回到 idle 后 activity.updatedAt 曾固定取入频时刻；现取本频道该实例最近一次 Activation 结算时刻（不早于入频时刻），私聊与其他房间不计入（`room-agent-activity-queued.test.ts` 假时钟复现）。
- 测试频道留在正式库；其附加目录位于会话临时目录，会话清理后该频道的附加目录复核会失败（预期行为）。

### 四十八、S6 平台记忆：批次 A（存储与访问）

依据 `~/.loom/reviews/2026-09-26-memory-research.md` 与其末尾负责人裁定（2026-09-26，“同意推荐”）。每项先写失败测试并确认失败，再做最小实现；没有运行付费 CLI，没有重启服务，没有改前端；常驻提示词与旧每实例 `MEMORY.md + notes/` 本批不变。

1. 数据模型（Kernel，schema 74，`channel-memory-schema.ts`）：
   - `memory_entries` 是投影：作用域只有频道（`scope_room_id`）；`name` 为小写 slug（1–64），在同一频道未删除条目中唯一（部分唯一索引 + 代码查重，冲突时报错并给出现有 revision）；`type` ∈ user/feedback/project/reference；`description` 一行 ≤150 字符；`body` ≤16 KiB（UTF-8 字节）；`pinned`；`state` ∈ active/invalidated/deleted；`revision`。
   - `memory_revisions` 不可变（主键 entry_id+revision），每次变更一行完整快照与出处：作者 principal 与类型（instance/human）、Role 与 Role 修订、实例、模型 binding 与推理档（取自该 RunAttempt 的放置决定，无决定时为 null，不推算）、session 代数、RunAttempt、经由房间（频道或私聊）、`basedOnRoomSeq`（凭据的 Activation `toSeq`）、时间、幂等键、事件 ID。Human 变更的 Role/实例/模型/session/RunAttempt/经由房间/`basedOnRoomSeq` 均为 null。
   - `memory_access_policies`（频道默认读写，缺省视为都开、修订 0）与 `memory_access_overrides`（成员覆盖，null 表示继承）；`memory_entries_fts`（FTS5 trigram，只收 active 条目）。
   - 每次接受的变更在同一事务里更新投影、写一条修订、在频道追加一条 `memory.entry_changed` 事件（只含 entryId、name、type、op、revision、state、pinned、requestDigest；不含正文和描述），不派生 Inbox/Activation；开关变更追加 `memory.policy_changed`。幂等键按作者命名空间去重，同键不同请求为 `IdempotencyConflictError`。
   - 频道删除时一并擦除该频道的记忆、修订、开关与 FTS 行（`ROOM_DELETION_REFERENCED_TABLES` 已登记）。
2. 语义：
   - 更新、失效、恢复、删除、置顶都要 `expectedRevision`，不一致即拒绝（409），不合并、不后写覆盖；更新只接受 active 条目且必须有实际变化。
   - invalidate：实例与 Human 都可以，需要理由；条目退出列表（`--include-invalidated` 才显示）与检索，正文与历史保留；restore 恢复为 active。
   - delete：只有 Human（频道 owner/admin）；所有修订的正文置空，名字等元数据保留为 tombstone（第五十四节起描述也清空，只留名字、删除时间、原因与元数据），名字释放可重用；Worker 端没有 delete 命令也没有路由。删除边界（§50，第五十四节更新）：平台在线读取与检索不再能取得正文与描述；不追溯清理已进入 session/诊断/备份/SQLite 物理残留（WAL）的副本，不是物理擦除。
   - pin：只有 Human；列表与检索同分时 pinned 优先，再按最近更新。
3. 权限（Kernel 在列出与检索之前判定，`channel-memory-access.ts`）：
   - Worker：只有 Role 实例有平台记忆；作用域 = 该实例所属频道，从凭据推出，请求里没有也不接受频道、作者或出处字段（strict schema，HTTP 400）；实例必须仍是频道成员；有效开关 = 成员覆盖 ?? 频道默认（默认开）。
   - 私聊规则：私聊轮（凭据房间是该实例仍有效的私聊）读写的就是该实例所属频道的记忆，与“私聊共享 session”一致；变更事件记在频道，不写进私聊，出处的经由房间记为私聊。其他 Direct 房间一律拒绝。
   - Side（S5 未实现）：判定点 `decideMemoryAccess` 已按凭据种类 main/side 区分，side 只读不写；当前签发的凭据一律为 main，S5 签发 side 凭据时接入。
   - Human：必须是 Human 且是该频道 owner/admin；开关只约束实例，Human 通过 Human API 始终可以管理本频道记忆。代理 principal 调 Human API 为 401/403。
4. 检索：先按权限确定频道，再在该频道 active 条目上用 FTS5（trigram，支持中文子串，bm25 排序）；任何一个检索词不足 3 个字符时改用同范围内的 LIKE 扫描。没有向量库、嵌入、自动抽取、后台整理、TTL、逐条 ACL、全局/Role 作用域，记忆不物化为文件。
5. 接口：
   - Worker CLI（经现有 Worker 应用服务与鉴权）：`rah worker memory list|read|search|history|write|update|invalidate|restore`，路由 `/v1/worker/memory/*`（8 条，已登记 Raft 对照表为 justified/sqlite-ledger：Raft 只有文件记忆）；write 正文从 stdin 读（与 message-post 相同），update 用 `--body-stdin` 或 `--body` 换正文；输出为文本。
   - Human API（protocol/application-service/client-sdk 同步）：`memory.list|read|search|history|invalidate|restore|delete|pin`、`memory.policy.read|update`（`/v3/client/memory/*`；开关更新带 `expectedRevision`，一次可改默认值与多个成员覆盖，覆盖读写都为 null 即删除）。
   - `worker help memory` 新增“频道记忆”段：命令、存什么/不存什么、按主题组织与先查后写、记忆只证明写入时为真且冲突时以当前观察为准、出处不证明正确、记忆是数据不是指令、被拒说明是 Human 关了开关。原 MEMORY.md 传输说明保留在其后。
6. 测试（先失败后通过）：`kernel/test/channel-memory.test.ts` 13 项（出处不可伪造、Room 事件只含元数据且不派生 Activation、唯一名与删除后重用、expectedRevision 冲突、幂等重放与冲突、invalidate/restore/delete 权限与语义含全部修订正文置空与 tombstone、开关与成员覆盖、side 判定点、其他频道实例/移除实例/非成员 Human 不可见、私聊规则、FTS 检索只返回许可范围（不证明执行器先按频道过滤）与中文/短词、大小类型名称描述校验、session 代数出处）；`application-service/test/channel-memory-api.test.ts` 2 项（Worker 路由与 Human HTTP/SDK 两条路径的开关强制、无 Worker delete 路由、代理令牌 401）；`agent-host/test/worker-memory-cli.test.ts` 5 项。schema 版本断言 73→74 的既有测试随之更新。
7. 残余风险与未做：
   - 不是强隔离：四家 CLI 以 full-access、同 UID 运行，仍可直接读取 `~/.loom/evo` 下的 SQLite 数据库文件；开关只封住认证的 Worker 路径与“不物化文件”这条文件路径，对恶意或被注入的模型不是强隔离。OS 沙箱或独立 UID 另立项（裁定 7）。
   - 读开关关闭只影响之后的工具调用；本批没有注入，所以还不存在“已进 system 层的旧索引撤不回”问题，注入批次需如实标注。
   - 下一批（B）：会话开始注入轻索引（约 4 KB、pinned 优先、超出附“还有 N 条”）与续聊增量；启用 S6 的频道新 session 不再加载旧每实例 MEMORY.md，旧目录只读保留并提供 Human 触发的逐条导入；控制台展示（列表、查看、历史、失效、删除、开关）；按合同 §6 实测固定开销。

### 四十九、全局个人配置隔离

依据 `~/.loom/reviews/2026-09-26-global-config-isolation.md` 的推荐做法，负责人已同意。按各 CLI 能力关闭已核实的若干全局配置来源，不是四家全面隔离；剩余入口见下表与第 9 项。所有开关都只作用于 Loom 子进程（argv/env），不改任何用户文件；Human 自己运行 CLI 时照常读取全局内容。开关统一由 `providerLaunchPolicy`（`provider-launch-arguments.js`）提供，冷热两条启动路径（per-turn 与 warm driver）都在内置参数之后追加它，Role 的完整覆盖参数去不掉它。新增的参数进入 managed 集合，新增的环境变量进入 `USER_OVERRIDE_PROTECTED_KEYS` 与协议 `RuntimeLaunchEnvironmentSchema`，Role 和用户都覆盖不了。

| CLI                 | 已关闭（本机免费探针实测）                                                                                                                  | 仍会加载的全局入口                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Claude Code 2.1.282 | 用户 setting source（CLAUDE.md、rules、skills、commands、agents、settings hooks/env）、`~/.claude.json` MCP、claude.ai 连接器、自动记忆     | 组织托管策略（设计如此）；OAuth 下 claude.ai 同步技能/连接器只有源码证据              |
| Codex 0.156.1       | notify、插件、apps、hooks、技能清单、原生 web_search、Codex 自己列出的每个用户 MCP（§50 起由 `codex mcp list --json` 解析，失败即拒绝启动） | `$CODEX_HOME/AGENTS.md`（含 override）；项目 AGENTS.md（设计如此）                    |
| OpenCode 1.18.32    | `~/.claude/CLAUDE.md`、`~/.claude/skills`、`~/.agents/skills`                                                                               | `~/.config/opencode` 全部（opencode.json、AGENTS.md、skills、agent、command、plugin） |
| Kimi                | 无（只有 `KIMI_DISABLE_CRON`）                                                                                                              | `~/.kimi-code` 全部全局内容与 `~/.agents/{AGENTS.md,skills}`                          |

1. Claude Code 2.1.282：启动参数加 `--setting-sources project,local` 和 `--strict-mcp-config`（`--setting-sources` 新列入 managed；Loom 自己的 `--mcp-config` 保留）；环境变量加 `ENABLE_CLAUDEAI_MCP_SERVERS=false`（受保护）。没有使用 `CLAUDE_CONFIG_DIR` 或 `--bare`，keychain 登录不受影响。
2. OpenCode 1.18.32：环境变量加 `OPENCODE_DISABLE_CLAUDE_CODE=1` 和 `OPENCODE_DISABLE_EXTERNAL_SKILLS=1`（均受保护），两个 driver 都已接入；没有重定向 `XDG_CONFIG_HOME`。
3. Codex 0.156.1：`-c` 依次为 `notify=[]`（排第一）、原有的 memory/autonomy 开关、`features.plugins=false`、`features.apps=false`、`features.hooks=false`、`skills.include_instructions=false`、`web_search="disabled"`，然后对 Codex 列出的每个用户 MCP 逐个加 `mcp_servers.<name>.enabled=false`。本批最初用正则只读扫描 config.toml，审查证实会漏掉根级 inline table、带引号的根键并误解 Unicode 转义；§50 已改为每次启动前调用 Codex 自己的 `codex mcp list --json`。
   - web_search 实测：instance 使用 danger-full-access sandbox，此时即使配置 `web_search="cached"`，Codex 仍以 live 联网发出工具，所以唯一不受用户 `web_search` 影响的值是 `disabled`。业务影响：Codex 实例失去原生 web_search 工具（full-access 下仍可用 shell 访问网络）；Claude 的 WebSearch 不变。
   - 技能实测：`skills.include_instructions=false` 会去掉全部技能清单，包括工作区/项目技能和 Codex 自带的 `.system` 技能。按目录禁用的 `skills.config` 不接受目录路径，只能逐个 SKILL.md，因此没有采用。
   - 已记录的边界：Codex 的 `-c` 按每个 "." 拆分键，不支持带引号的段（实测会报 `invalid transport`），名字含 "." 或 "=" 的 MCP 无法按名关闭。遇到这种名字时启动失败并给出明确错误，不会带着该 MCP 运行。触发条件是用户 config.toml 里有 `[mcp_servers."a.b"]` 这种写法；本机没有。
4. Kimi：本批没有改动，是已知限制（见下文）。
5. 技能展示与实际加载保持一致（`agent-skills.ts`、`daemon-agent-skills.ts`）：Claude 的全局范围和 Codex 的全局、工作区两个范围都返回 `unavailable` 加新 issue `isolated_by_loom`，不再读取全局技能目录；Claude 工作区（`.claude/skills`、`.claude/commands`）照旧扫描。冻结的 `apps/web` 对未知 issue 显示“无法确认当前 CLI 的有效技能目录”，文案不准确，留到 phase 4 处理；`apps/console` 没有技能视图。
6. 效率门禁的原生组与产品保持一致：Codex 原生组本来就使用同一策略，Claude 原生组现在追加同样的参数和环境，OpenCode 原生组追加同样的环境。gate 的 Codex argv 围栏（`model-guard.mjs`）只接受产品自己的固定 `-c` 项（`providerLaunchSwitches`），以及 `mcp_servers.<name>.enabled=false`（§50 起名字只排除 "." 与 "="）。
7. 测试（先失败，再实现）：
   - `agent-host/test/provider-global-isolation.test.ts`（16 项）：各家的策略参数和环境；Codex MCP 按名解析、只读、缺文件、默认 `~/.codex`、带 "." 的名字失败（§50 改为 FAKE `codex mcp list` 驱动）；isolation 参数不能通过用户附加参数加入或重开；每个策略环境变量都会被过滤器和协议 schema 拒绝；7 个 driver 各用一个 FAKE 记录器替代 CLI，断言策略参数按顺序到达 CLI，并且在 Role 完整覆盖参数、继承环境里有相反值时仍然生效。
   - `agent-skills.test.ts` 按新语义改写；`provider-launch-arguments.test.ts`、`runtime-implementation-registry.test.ts`（改用临时 `CODEX_HOME`，不再读取真实配置）、`model-guard.test.mjs` 随契约更新。
   - `agent-host/test/provider-global-isolation-probe.test.ts` 是可跳过的本机探针（`LOOM_CLI_ISOLATION_PROBE=1` 时运行，默认跳过）：使用已安装的三家二进制、临时 HOME 标记文件和 127.0.0.1 上的 FAKE 模型 API，每家先不带策略跑一次（证明探针能看到标记），再带策略跑一次。OpenCode 可能访问公开 npm registry（免费）。
8. 免费验证（本机，FAKE API，未调用真实模型；三项探针均通过）：
   - Claude：不带策略时，请求里含用户 CLAUDE.md、rules、skills、commands、agents，settings hook 执行，用户 MCP 启动；带策略时这些全部没有，项目 CLAUDE.md 和项目技能仍在，退出码 0。
   - Codex：不带策略时，用户技能和 `~/.agents` 技能进入请求，notify 执行，用户 MCP 启动，hooks/list 列出用户 hook，web_search 为 live；带策略时 notify 没有执行，MCP 没有启动，hooks 为空，这两类技能都不在请求中，没有 web_search 工具；`config/read` 的有效值与策略一致；全局与项目 AGENTS.md 仍在。另用真实 `~/.codex` 的副本（notify 换成记录脚本，provider 指向 FAKE API）跑了一次：不带策略时 notify 触发 1 次，插件 MCP（codex_app、cua_repl）、`<plugins_instructions>`、babysit-pr、test-tui 和系统技能都在；带策略时 notify 0 次，插件与 marketplace 为空，node_repl 和 computer-use 都是 `enabled=false`，工具只剩内置 5 个。
   - OpenCode（`opencode run --pure`，环境语义与 `serve --pure` 相同）：不带策略时 system 里有 `~/.claude/CLAUDE.md`、`~/.claude/skills`、`~/.agents/skills`；带策略时三者都没有。
9. 已知限制：
   - Codex 的 `$CODEX_HOME/AGENTS.md`（含 override）没有进程级开关，只能换专用 CODEX_HOME，这涉及已有 thread 迁移，待负责人决定。本机该文件目前是空文件。
   - OpenCode 的 `~/.config/opencode`（opencode.json、AGENTS.md、skills、agent、command、plugin）仍然会读取，因为 provider/model 配置就放在那里。
   - Kimi：`~/.kimi-code` 全部全局内容（config.toml 的 hooks/mcp/permission、以及 AGENTS.md、skills、mcp.json、plugins）和 `~/.agents/{AGENTS.md,skills}` 仍会进入。本机这些位置目前为空或不存在。
   - Claude：组织托管策略（managed settings）始终生效，这是设计如此。OAuth 模式下 claude.ai 同步技能和连接器是否真的被排除，只有源码证据（本次探针使用 API key 和 FAKE API），还需要一次获授权的真实运行来确认。
   - 生效时机：新开关在下一次 CLI 进程启动时生效。本批没有重启服务，正在运行的常驻进程仍使用旧参数。没有更换任何 home，已有原生 session 可以照常 resume。
   - 未做：真实 CLI 验证、效率门禁、本地服务部署和重启。

### 五十、记忆 A / 隔离审查修复

依据 `~/.loom/reviews/2026-09-27-review-memory-a-isolation.md`（审查 b69faa3：2 个 P1、2 个 P2），负责人已批准修复。每项先写失败测试并确认失败再实现；没有运行付费 CLI，没有重启服务，没有改前端冻结范围，没有改用户配置文件。

1. P1-1 写权限经变更返回值绕过读开关：
   - 修法：Worker 的 write/update/invalidate/restore（含幂等重放）改为只返回收据 `WorkerMemoryMutationReceiptSchema`（entryId、name、revision、op、state、deduplicated），取自只含元数据的 Room 事件，不含 body、description、provenance，也不再返回事件本身；需要内容走 `memory read`（受读开关约束）。收据在 Kernel 生成（`channel-memory.ts` 的 `workerReceipt`），HTTP 路由按收据 schema 严格解析，CLI 文案改读收据字段。Human API 仍返回完整条目。
   - 冲突与同名错误只含名字、修订号和状态，不含正文。另堵一个等值预言：读关闭时，“更新没有任何变化”不再报冲突（否则可以逐次猜测正文是否等于某值），照常写一条修订；读开启时仍报冲突。
   - 读写开关的独立语义不变（没有改成“能写就能读”）。
2. P1-2 Codex MCP 名单改用 Codex 自己的解析：
   - 名单来源：已安装 Codex 0.156.1 提供 `codex mcp list --json`（输出 name/enabled/transport），它用 Codex 自己的配置加载器与 TOML 解析器解析全部配置层，不启动 MCP、不调用模型（本机约 10 ms；临时目录实测 marker MCP 未被启动）。审查中的三种写法（根级 inline table、`["mcp_servers".secret]`、`"se\u0063ret"`）它都解析为 `secret`；配置不可解析时退出码 1 并给出 TOML 错误；不存在的 `CODEX_HOME` 也退出 1。
   - 启动前流程（`provider-launch-arguments.js` 的 `codexUserMcpServerNames`）：用与启动相同的可执行文件、环境与 cwd，带上启动的固定开关（`providerLaunchSwitches`）调用一次列表；名字含 "." 或 "=" 立即拒绝；再带上逐个 `mcp_servers.<name>.enabled=false` 调用一次列表，必须全部显示 `enabled=false`，否则拒绝。CLI 缺失、非零退出、非 JSON、结构不符、覆盖未生效都拒绝启动（fail-closed，错误写明原因）。Loom 不读写用户配置文件（Codex 自己会在 `$CODEX_HOME/tmp` 建目录，与正常启动相同）。
   - 必须带固定开关的原因（实测）：本机真实配置下不带开关时还会列出插件提供的 `codex_app`、`cua_repl`，对它们加按名覆盖会使 Codex 报 `invalid transport` 而无法加载；带 `features.plugins=false` 后只剩 config 里的 node_repl、computer-use。
   - 实测还表明含空格、引号、非 ASCII 的名字可以按名关闭，所以名字规则从“不含 . = 空白”放宽为“不含 . =”，其余由第二次列表验证兜底。
   - 不缓存：每个 driver 进程启动时只解析一次（两次列表约 30 ms），进程内缓存没有收益，按 mtime/size 缓存还可能漏掉其他配置层的变化。
   - 调用方：两个 Codex driver 传入自己的 `--executable`；daemon 设置投影（`managedLaunch`）与 gate argv 围栏改用只含固定开关的 `providerLaunchSwitches`（按名关闭在每次启动时解析）；效率门禁的原生组与 drift 脚本按各自 cwd 解析。
   - 残余：列表以 driver 进程 cwd 解析；若将来 thread 的 cwd 与进程 cwd 不同，项目级配置层可能不一致，需要届时复核。
3. P2-1 删除边界：目标合同 §4、本文件 §48 与 Human API 删除请求的 schema 注释写明“平台在线读取与检索不再能取得正文；不追溯清理已进入 session/诊断/备份/SQLite 物理残留（WAL）”（第五十四节按负责人裁定扩为“正文与描述”，描述在当前投影与所有修订中清空）。没有实现物理擦除。`apps/console` 目前没有记忆界面，没有可改的删除文案；记忆控制台（批次 B）的删除确认必须沿用这句话。
4. P2-2 声明修正：§49 总述改为“按各 CLI 能力关闭已核实的若干全局配置来源”，并在总述旁加支持矩阵与剩余入口。目标合同 §4 把已裁定语义写入（负责人 2026-09-26 批准）：频道共享（私聊写入属于共享频道记忆，不是私有记忆）、只经显式工具写入、不物化、写入不蕴含读取、`expectedRevision` 并发、实例只可失效/恢复、仅 Human 删除及删除边界、side 只有判定点未接入、FTS 频道过滤只保证输出范围。
5. 测试（先失败后通过）：
   - `application-service/test/channel-memory-api.test.ts` 新增 1 项：read=false/write=true 下 write 重放、update 及重放、invalidate 及重放、restore 及重放、revision 冲突、同名冲突、无变化更新都不含正文/描述/出处，响应键恰为收据六项；Human API 仍能读到正文。修复前失败于“write replay leaks memory content”。既有 2 项改为经 read 验证出处。
   - `kernel/test/channel-memory.test.ts`：Worker 返回值断言为收据，正文/出处/事件改从 Human 读取与 Room 事件表验证（断言内容不变）。`worker-memory-cli.test.ts` 的 FAKE 响应改为收据，并新增 update 文案断言。
   - `agent-host/test/provider-global-isolation.test.ts`：Codex 部分改由 FAKE `codex mcp list`（模仿实测行为：插件服务器随 `features.plugins=false` 消失、按 "." 拆键、记录 cwd）驱动：名单与顺序、带固定开关列出并在启动 cwd 列出、第二次验证、无 MCP 只列一次、默认 `~/.codex` 经环境传递；fail-closed 六种情形（Codex 解析失败、非 JSON、结构不符、名字含 "."、名字含 "="、覆盖未生效）与 CLI 缺失。7 个 driver 的 FAKE 记录器同时实现 `mcp list`，断言两个 Codex driver 在启动 cwd 列出并验证后才启动。
   - 其余带 FAKE Codex app-server 的测试（agent-host 7 处含共享 fixture、daemon 2 处）的 FAKE 脚本增加对 `mcp list --json` 返回 `[]`。
   - 可选本机探针 `provider-global-isolation-probe.test.ts`（`LOOM_CLI_ISOLATION_PROBE=1`，使用已安装 Codex 0.156.1 与 127.0.0.1 FAKE 模型 API，免费）新增 2 项：真实 Codex 解析根级 inline table、带引号根键、Unicode 转义、注释内含多行字符串定界符、多行字符串内的假表头、已禁用服务器、无 MCP，解析失败与带 "." 名字拒绝；根级 inline table 声明的 marker MCP 不带策略时启动、带策略时不启动。两项对 b69faa3 的旧实现均失败（名单为 `[]`；策略缺少关闭项），对新实现通过；原 Codex 探针复跑通过。CI 没有 Codex，探针默认跳过。
6. 未做：真实模型验证、效率门禁、服务重启与部署；物理擦除；Kimi/OpenCode/Codex 全局 AGENTS 等剩余入口（见 §49 表）。

### 五十一、S6 平台记忆：批次 B（注入、旧记忆切换、控制台）

依据 `~/.loom/reviews/2026-09-26-memory-research.md` 末尾负责人裁定与第四十八节第 7 项。每项先写失败测试并确认失败再实现；没有运行付费 CLI，没有重启服务，没有改前端冻结范围；没有自动抽取、后台整理或向量库。

1. 启用 S6 的判定：Role 实例（`agent.instanceChannelId` 存在）即启用。理由：批次 A 已规定只有 Role 实例有频道记忆，这是现有最小且无歧义的边界，不引入新的频道开关。非启用路径只剩遗留 persona Agent，照旧物化并加载每实例 `MEMORY.md`（测试覆盖）。
2. 会话开始注入（`runtime-profile-composition.ts`、`standing-prompt-lease.ts`、`standing-prompt-compiler.ts`、agent-host `channel-memory-index.ts`）：
   - daemon 组装 Role 实例的常驻提示词时，经 Host 凭据调用 Kernel `readInstanceMemoryIndex`（需 Host 被授权该参与者；成员资格与有效读开关在 Kernel 判定），取 active 条目，pinned 优先再按最近更新。
   - 常驻提示词里 Raft MEMORY.md 记忆原文与 RAH 绑定段换成一行指针（`CHANNEL_MEMORY_POINTER`，指向 `worker help memory`），身份句改为“频道记忆”；索引作为最后一层 `## Channel memory index`，每条一行 `- name [type, pinned] — description`，不含正文。索引文本不进连续性摘要（`deterministicDigest` 只含占位），改记忆不会换 session。
   - 上限 `MEMORY_INDEX_MAX_BYTES`（protocol 常量，默认 3 KiB，见第 5 项为何不是 4 KiB）；超出时末行写“N more entries not shown: `memory search --query TEXT` or `memory list`.”，不静默截断。读开关关闭时只注入一行“Channel memory reading is turned off for you by the Human.”；频道无记忆时一行提示；Kernel 读取不可用或失败时一行“Not available at launch”（失败写 stderr 诊断，不阻塞启动），仍不回退到旧 MEMORY.md。
   - `message-check --startup` 对没有每实例目录的 S6 会话改为一行说明索引位置，不再输出“Memory path unavailable”。`worker help memory` 增加索引与增量说明，旧 MEMORY.md 传输段标注“仅遗留 Agent”。
3. 续轮增量（schema 75，Kernel `channel-memory-index.ts`）：
   - `message-present` 请求可带 `memoryIndexSeq`（Host 仅在本次启动的提示词就是 session 将持有的索引时设置：新 session，或每请求重建 system 层的 OpenCode；环境键 `RAH_MEMORY_INDEX_SEQ` 由 Host 租约独占）。Kernel 以 max(该值, 本 session 代数的 `memory_index_marks.through_seq`) 为下界，列出之后有 `memory.entry_changed` 的条目（最多 30 条，其余计数），作为响应 `memoryDelta`；读开关关闭、非实例或无变化时不附。
   - bodied wake 在事件与 Reply 行之后附 `## Channel memory changed`，只含变化条目：新增/更新为 `- name [type] — description`，失效加 `invalidated`，删除只写 `deleted`（不带描述），置顶变化体现在 `pinned` 标记。
   - 已发送才算：present 时把增量头记为该 RunAttempt 的待定值，Host 以 Host 凭据登记该渲染已送达（驱动接受了恰好这段输入，`markPresentedDeliverySent`）时才推进 mark；未送达或迟到帧不推进，下次唤醒重发同样的变化。（第五十二节修正：原实现同一 RunAttempt 重取 present 会覆盖待定值，`memoryIndexSeq` 直接信任 Worker 请求体，首轮只有初始索引时不记基线；现改为随 presented window 冻结快照、只按 Host 读取过的索引核实启动声明。）没有 mark 也没有启动 seq（批次 B 之前的旧 session、首轮回退到固定唤醒）时从 0 起列，宁可重复不丢。session reset 换代后从新 session 自己的索引起算。mark 是 Host 传输事实，不是模型已读回执。
   - `memory.entry_changed`/`memory.policy_changed` 不再出现在唤醒窗口与 `message-check` 中（与执行审计事件同样被窗口覆盖但不渲染），因为增量已按读开关交付；Room 事件仍在 ledger，Human 与诊断可见。副作用：读开关被关掉的实例不再从唤醒里看到记忆名字；开关变化本身也不再提示给实例。
4. 各家压缩后路径（按本机已核实的源码/文档证据，未做真实压缩实测）：
   - Codex：索引在 `developerInstructions`（线程开始时的快照），续聊与压缩都保留原快照（压缩后逐字重新注入 initial context）；之后通过唤醒送达的增量在用户轮历史里，压缩后可能只剩摘要。平台不重发全量；模型可用 `memory list`。
   - Claude Code：索引在 `--append-system-prompt-file`，续聊保留首个 system；文档称续聊时换的 system 文件在压缩后才生效，因此冷驱动压缩后 system 层可能变成最近一次启动时的当前索引（只会多给，不会少给）。增量同 Codex 可能被摘要。
   - OpenCode：索引在服务器 `instructions`，每个请求重建；冷驱动每轮新进程，system 层总是本轮启动时的当前索引，Host 每轮都带 seq，增量几乎为空；常驻驱动的 instructions 在进程启动时固定，增量按 mark 送达，压缩后同样只可能剩摘要。
   - Kimi（kimi-code 0.39.1）：没有 system 层，常驻提示词只在新 session 首个 prompt 里；续聊不重发，因此续聊不带 seq。驱动报告压缩后（或协议过期）下一轮的既有规则卡后面追加当前全量索引，并以该索引的 seq 作为增量下界（`resumedMemoryIndexLease`）。
5. 合同 §6 离线测量（`npm run measure:s6-memory`，即 `packages/daemon/test/channel-memory-overhead.test.ts`，真实 Kernel 索引与真实提示词租约、无 provider、免费）。token 为估算（ASCII 字符/4 + 每个非 ASCII 字符 1），不是实测。批次 B 之前同一实例的常驻提示词约 2,726 估算 token（工具模式），Claude/Codex 加种子 MEMORY.md system 快照约 2,880。

   | 条目 | 描述文字 | 索引字节 | 显示行 | 常驻提示词字符 | 估算 token | 相对 0 条 | 相对批次 B 前（工具/system） |
   | ---- | -------- | -------- | ------ | -------------- | ---------- | --------- | ---------------------------- |
   | 0    | —        | 84       | 0      | 6,821          | 1,711      | 0         | −1,015 / −1,169              |
   | 10   | 英文     | 1,189    | 10     | 7,906          | 1,990      | +279      | −736 / −890                  |
   | 50   | 英文     | 3,058    | 27     | 9,741          | 2,461      | +750      | −265 / −419                  |
   | 200  | 英文     | 2,980    | 26     | 9,665          | 2,441      | +730      | −285 / −439                  |
   | 10   | 中文     | 1,539    | 10     | 7,516          | 2,170      | +459      | −556 / −710                  |
   | 50   | 中文     | 3,023    | 20     | 8,240          | 2,636      | +925      | −90 / −244                   |
   | 200  | 中文     | 3,044    | 20     | 8,261          | 2,641      | +930      | −85 / −239                   |
   - 判断：去掉旧 MEMORY.md 记忆原文后，常驻提示词在任何条目数下都不高于批次 B 之前。最初按裁定用 4 KiB 实测，中文描述时常驻提示词约 2,954 估算 token，再加首轮唤醒本身相对原生用户消息的增量（事件前缀与 Reply 行）就没有余量留在 +3k 内，因此默认上限缩小为 3 KiB；测试断言每种情形“估算常驻提示词 + 假设的 200 token 首轮唤醒余量 ≤ 3,000”（离线估算样本内成立，不是原生 CLI 实测，不等于 §6 验收；测试名已在第五十二节改为 offline estimate），超过 50 条后只变化省略计数。
   - 边界：常驻提示词不是 §6 固定开销的全部（原生 CLI 自身的 system 与工具定义双方相同，不计入；首轮唤醒的额外部分只做了余量假设）。真实付费实测留待负责人授权。

6. 旧每实例 MEMORY.md 与导入：
   - S6 会话不再调用每实例记忆准备（不物化、不创建目录、不设置 `RAH_AGENT_MEMORY_*`、不走 Claude/Codex 的 MEMORY.md system 传输、不启用 cleaner/App Inbox）；旧目录原样保留，平台不读写。
   - Human API `memory.import.legacy`（`/v3/client/memory/import-legacy`，protocol/application-service/client-sdk 同步）：需频道 owner/admin，实例必须属于该频道；服务端经 Host 的记忆管理端口只读列出并读取该实例的 `MEMORY.md` 与 `notes/`，交给 Kernel 转为条目。`files` 模式每个文件一条（可用 `relativePaths` 选部分），`whole` 模式一条（MEMORY.md 后接各 note）。条目类型 `reference`，名字 `legacy-<handle>-<文件>`，描述取文件首行；超过 16 KiB 或名字已占用的文件跳过并给出原因；不自动导入。
   - 出处：修订为 Human 作者，另加 `provenance.importedFrom {instanceId, path}`（`memory_revisions` 新增两列）。幂等按导入来源：同一实例同一文件已导入过（任何状态）即报告 existing，换幂等键也不重复。
   - 已有 session 的 system 层仍含旧快照：批次 B 之前创建、尚未 reset 的 Claude/Codex session 在原生 system 层仍保留旧 Raft 记忆原文和 MEMORY.md 快照（续聊不替换），其中的 `RAH_AGENT_MEMORY_DIR` 等环境已不再提供；这类 session 的第一次增量从 0 起列出频道记忆全部变化（最多 30 条）。要完全切换需 Human 对该实例 session reset。
7. 控制台：见下文第 9 项。
8. 测试（先失败后通过）：`kernel/test/channel-memory-index.test.ts` 8 项（索引排序与只含 active、读关闭无条目、只有 Host 服务的 Role 实例有索引、增量只含变化且未送达不推进/送达后推进、删除只报 deleted 且无描述、读关闭无增量、记忆事件不进唤醒窗口、导入幂等与出处与 whole 模式、导入权限）；`application-service/test/channel-memory-api.test.ts` 新增 3 项（导入经 API/SDK 与幂等、无 Host 管理端口时 503、message-present 返回增量且 seq 校验）；`agent-host/test/channel-memory-index-render.test.ts` 9 项（渲染、字节上限与省略计数、默认 3 KiB、读关闭一行、空、增量行、唤醒追加、指针一行、bodied wake 仅在设置时带 seq、Kimi 规则卡追加全量索引且无卡时丢弃 seq）；`agent-host/test/worker-startup-context.test.ts` 新增 1 项；`daemon/test/channel-memory-injection.test.ts` 6 项（指针一行与索引在最后且不进摘要、新 session 注入与 seq 且不物化 MEMORY.md、续聊不带 seq、遗留 Agent 照旧、无 Kernel 端口或读取失败时不回退也不阻塞；最后一项是实现后补的健壮性测试，未经历先失败）；`daemon/test/channel-memory-overhead.test.ts` 1 项（§6 测量）。schema 版本断言 74→75 的既有测试随之更新；`client-sdk` 操作清单加 `memory.import.legacy`。
9. 控制台（`apps/console`，`memory.ts` 纯逻辑 + `view-memory.ts` 面板，挂在频道页）：
   - 列表显示名称/类型/描述/置顶/状态/修订/最近更新与作者出处（列表接口不含出处，按“条目+修订”缓存逐条 `memory.read`；实例作者显示模型、session 代数、RunAttempt，缺失字段显示“未知”；导入条目显示来源实例与文件），可含已失效/已删除，检索走 `memory.search`，点开看正文与修订历史，10 秒轮询且列表的旧响应不覆盖新响应（本节当时只保护列表；详情的迟到响应保护见第五十二节）。
   - Human 操作置顶/取消、失效（必填原因）、恢复、删除全部经 `WriteIntentSlot`（新增 `submitRevisioned`：沿用冻结请求体、单幂等键、结果未知只能核实原操作或放弃、离页提示；首次 4xx 含 409 视为明确拒绝），都带当前修订作为 `expectedRevision`；409 显示冲突并重新读取，不自动重发。删除用 alertdialog，逐字显示删除边界（平台在线读取与检索不再能取得正文；不追溯清理已进入 session、诊断、备份或 SQLite 物理残留（WAL）的副本）并要求原因。
   - 开关：频道默认读/写与每实例覆盖（继承/开/关），按开关修订提交，只发改动项，改回继承发 null；显示每个成员的有效权限。
   - 每个实例有“整体导入 / 逐文件导入”按钮（逐文件可填相对路径，没有文件选择器：现有 `agent.memory.get` 只服务遗留 persona），逐文件显示结果。DOM 不使用 innerHTML。
   - 测试：`apps/console/test/memory.test.ts` 7 项（先以模块不存在失败）。浏览器门禁（fake CLI，`npm run test:console:browser`）新增场景 7b：在旧目录写 FIXTURE 的 MEMORY.md 与 notes 模拟遗留数据，界面逐文件导入并经 API 核对出处与再次导入为 existing；列表/检索/详情与 API 一致；置顶、失效（无原因被拦）、恢复、背后改修订后的 409、删除确认框文案与正文清空、写开关覆盖与恢复继承，每步都以 API 核对后端状态。门禁的假 codex 新增对 `codex mcp list --json` 返回 `[]`（HEAD 6202e22 引入启动前探测后原门禁第 5 步会失败）；允许失败请求表加入故意触发 409 的 `/v3/client/memory/pin`。
   - 门禁结果：最终两次通过；本批期间另有一次在既有 5d-2 步骤（“committed once” 为 0）失败、重跑通过，与记忆面板无关，原因未核实（疑为既有时序不稳定）。未覆盖：整体导入按钮、Worker 写入条目的作者显示（只有单元测试）；结果未知后核实时再遇 409 保守保持“未知”。
   - 源码尺寸棘轮未放宽：`room-kernel.ts` 已在 6,925 行上限，本批把既有 placements/runtime_processes 加列迁移原样移到 `kernel/src/placement-column-migration.ts`，记忆逻辑放在 `kernel/src/channel-memory-index.ts`；`daemon-application.ts` 用 `kernelRuntimePorts` 保持在 800 行内。
10. 残余与未做：真实 CLI 验证、效率门禁、服务重启与部署；同 UID 可直读数据库与旧目录（非强隔离，同第四十八节）；读开关关闭只对之后的新 session 和工具调用生效，已进入 system 层的索引撤不回；Codex/Claude 压缩后增量可能只剩摘要，平台不在压缩后重发全量（只有 Kimi 规则卡路径会）；频道记忆开关变化不再以事件形式提示实例。

### 五十二、记忆 B 审查修复

依据 `~/.loom/reviews/2026-09-27-review-memory-b.md`（审查 862d955：1 个 P1、4 个 P2）与负责人批准的修复范围。每项先写失败测试并确认失败再实现；没有运行付费 CLI，没有重启服务，没有改前端冻结范围，没有新增记忆队列。schema 75→76。

1. P1-1 增量快照与送达绑定（Kernel `channel-memory-index.ts`、`activation-presented-window.ts`、`room-kernel.ts`）：
   - 一次 RunAttempt 的记忆部分（启动索引声明、增量或索引刷新、session 代数）在首次 `message-present` 时写入该 presented window 的 `memory_json` 并冻结；同一 RunAttempt 再次 present 原样返回同一快照，不重算、不覆盖。`memory_index_marks` 的 `pending_run_attempt_id`/`pending_through_seq` 删除。
   - 只有 Host 登记把该渲染从未发送变为已发送的那一次（`markPresentedWindowSent` 返回 `newlySent`）才把冻结快照应用到 session 状态；重复回执、未登记、RunAttempt 结束后的迟到回执都不应用；快照所属 session 代数已变（reset）时也不应用。presentation 的标识就是该 RunAttempt 的冻结记录（每个 RunAttempt 只有一个版本，Host 接受的输入由既有的整段 SHA 核对对应到它）；没有另加 Host 回传的 digest 参数。
   - `memoryIndexSeq` 只是声明：Kernel 仅在它等于 Host 以 Host 凭据为本 session 代数读取过的索引（`readInstanceMemoryIndex` 现在记录 `served_seq`/`served_read_enabled`）时采用，任意值被忽略；该启动索引只在第一次被接受的唤醒送达时成为基线并被消费。持久基线因此只来自 Host 读取并经 Host 送达登记的快照。
2. P2-1 session 送达状态（同上）：每个实例 session 代数记录 `index_state`（`index` 真实索引已送达 / `notice` 只送达了读关闭提示 / 空）、`index_seq`、`delta_seq`（最近送达的增量头）与 `through_seq`（条目基线）。
   - 首轮只有初始索引、没有增量时，在接受证明后也记录基线：进程回收后同一 session 续聊不再重发旧条目。
   - 读关闭时启动的索引声明记为 `notice`，不把关闭期间的 head 当作已送达索引，并清空条目基线（该提示词取代了 session 原有索引，例如每请求重建 system 层的 OpenCode）。读开关打开后下一次唤醒附一次当前索引（`memoryIndex`，Host 以同样 3 KiB 预算渲染为 `## Channel memory index (reading is now on)`），送达后记为 `index`，之后不再重复。没有任何送达记录（批次 B 之前的 session、启动时 Kernel 读取失败）仍从 0 起列增量，宁可重复不丢。
3. P2-2 读关闭不见条目名（Kernel `worker-message-projection.ts` 的 `hideUnreadableMemoryEvents`）：负责人原则为读关闭的实例看不到条目名，选“整体过滤”。`memory.entry_changed` 只对该频道仍为成员且有效读开关为开的 Role 实例可见，其余 Worker 一律滤掉；应用于 `presentWorkerSync`（`/v1/worker/sync` 与 `message-check`）与 `rooms/read`（`worker-target-context.ts`）；唤醒窗口原本就不渲染 memory.*。游标、ACK 与 `toSeq` 仍按扫描范围推进，不重编号；Human 原始账本不变。`memory.policy_changed` 不含条目名，未过滤。
4. P2-3 控制台详情迟到响应（`apps/console/src/memory-detail.ts` 新增，`view-memory.ts` 改用）：每次选择开新代数并中止上一请求；响应只在代数未变、面板未停止、条目等于当前选择时落地；history 必须与当前条目同 `entryId`；切换期间正文清空、详情操作不可用（写操作另查 `actionable` 与所选条目一致）；面板 `stop` 同时废弃未完成的详情请求。第五十一节“旧响应不覆盖新响应”原只对列表成立，现详情也成立（仅单元测试，未跑浏览器门禁）。
5. P2-4 导入读取范围（`application-service/src/legacy-memory-import.ts` 新增；Kernel `memory.humanAuthorizeImportLegacy`，Human 端口 `authorizeLegacyChannelMemoryImport`）：先校验频道管理者与实例属于该频道，再列 Host 安全枚举，与请求路径求交集后只读取选中文件；逐文件模式按元数据把超过 16 KiB（单条正文上限）的文件直接记 skipped 并给原因、不读取；whole 模式先按枚举元数据求总字节，超过 16 KiB 直接返回整体过大原因、一个文件也不读；请求里枚举没有的路径返回 skipped “not a file of this instance's legacy memory”。无 Host 管理端口时 503 先于授权判断（与之前相同的端口缺失语义）。
6. 30 条增量上限：仍是有损通知摘要（不是分页队列，送达后被省略的变化不再重发）。截断末行改为“N more changed entries omitted, so your memory index may be out of date: check with `memory list --include-invalidated` or `memory search --query TEXT` (an entry no longer listed was deleted).”；Worker 已有受读开关约束的 `memory list --include-invalidated` 可列失效项，已删除条目对 Worker 不可列（只能从“不再出现”推知）。`worker help memory` 同步说明 30 条上限、3 KB 与读开关打开后的一次索引刷新。
7. 小修：agent-host `channel-memory-index.ts` 注释 4 KiB→3 KiB；`worker help memory` 中“about 4 KB”→“about 3 KB”；§6 测量测试名改为 offline estimate，明确不是原生 CLI 实测。
8. 测试（先失败后通过）：`kernel/test/channel-memory-index.test.ts` 新增 7 项——同一 RunAttempt 重取 present 返回同一快照且只登记第一次、重复回执、置顶变化留到下一轮（先因重取返回新快照失败）；未送达与终止后迟到回执不推进（先因缺列失败）；未经 Host 读取的 `memoryIndexSeq` 不被信任（先因增量被压掉失败）；新建→首轮→进程回收→同 session 续聊不重发（先失败）；读关闭启动→打开且条目无变化时刷新一次（先失败）；超过 30 条非 active 变化列 30 计 2、送达后不重发且 Worker 能列出全部失效项（先失败）；schema 75→76 升级（实现后补）。`application-service/test/channel-memory-api.test.ts` 新增 2 项：HTTP sync/message-check/rooms/read 读关闭不含条目名且游标覆盖该事件（先失败，另以临时去掉 rooms/read 过滤确认该路径被测到）；导入“已选小文件 + 未选超大/不可读文件 + 未知路径 + 超大单选 + whole 超预算 + 错误频道不触碰 Host 目录”（先失败）；原“message-present 返回增量且 seq 校验”一项按新合同改为断言冻结快照不被请求体替换。`agent-host/test/channel-memory-index-render.test.ts` 截断行断言更新、新增索引刷新渲染与 3 KiB 上限 1 项（先失败）。`apps/console/test/memory-detail.test.ts` 3 项：A/B 反序、旧 history 迟到与 history 条目不符、停止后废弃（先以模块不存在失败）。既有测试随之更新：schema 版本断言 75→76、presented window 旧表兼容测试与签名识别加 `memory_json`、core 端口清单加 `authorizeLegacyChannelMemoryImport`。
9. 未解决：真实 CLI 与效率门禁仍未跑；服务未重启、未部署；已删除条目 Worker 无列举入口；控制台详情修复未跑浏览器门禁；读开关关闭仍撤不回已进入 session 的索引（同第五十一节）。

### 五十三、累计效率门禁复测（2026-09-27，8ea005a，负责人授权）

证据 `docs/evo/evidence/2026-09-27-eff-*.json`，与原生同题 3 轮，判定用协议额外生成（业务路径差只报告）。首次 Codex 运行因门禁围栏未放行产品的只读 `codex mcp list --json` 预检而三组隔离（仅原生组调用模型），已修（8ea005a）后重跑。

- Codex（gpt-6-luna/low）：role（冷）3 轮全部达标，输入远低于预算；role-warm 续轮达标（8–9 s vs 原生约 9.7 s），首轮协议额外生成 0，业务路径差 +3（模型多读文件），仅延迟超预算；legacy 超预算（待移除路径）。
- Claude（haiku）：role-warm 3 轮全部达标；role 续轮达标，首轮延迟 46 s vs 25 s 超预算，协议 0、输入达标。
- Kimi（k3-256k/low）：3 轮协议额外生成 0、输入约为预算一半，延迟全部超预算；上次复测平台快于原生，差异主要来自 Kimi 服务端单次调用波动（见首轮延迟调查），需交替顺序与多样本判定；产品侧用量（ACP 不报）仍缺，判 missing-evidence。
- OpenCode（deepseek-flash/low）：role 与 role-warm 6 轮全部在预算内，门禁结论 needs-quality-review（待人工质量抽检）。
- 结论：四家协议额外生成均为 0（legacy 除外），输入均在预算内；剩余超标项全部是首轮或 Kimi 的延迟。平台记忆索引首次真实跑，未见额外生成。

### 五十四、记忆删除清描述与原生记忆关闭回归

负责人 2026-09-27 裁定两项。

1. 频道记忆 Human 删除清描述：
   - Kernel（`channel-memory.ts`）：删除时当前投影 `description` 置为空串，所有修订的 `description` 同样置空（与正文置空在同一事务）；tombstone 只保留名字、删除时间、原因与出处元数据；FTS 行照旧移除；Room 事件本来就不含描述。列为 NOT NULL 的 STRICT 表不改，未升 schema（仍为 76）。
   - 已冻结在 presented window 上的记忆快照（`memory_json`，同频道实例的窗口）同步去掉该条描述：增量项描述置 `null`、索引刷新项置空串；序号不变，所以 Host 送达登记的仍是同一版本。已送到 provider session 的文本不在删除边界内（同 §4）。
   - 裁定前删除留下的描述：每次打开 Kernel 时幂等清掉 `state='deleted'` 条目的投影与修订描述（`clearDeletedMemoryDescriptions`）。
   - 目标合同 §4、本文件 §48/§50 删除边界、Human API 删除请求 schema 注释同步为“正文与描述”。控制台删除确认文案改为“删除后平台在线读取与检索不再能取得正文与描述（当前与所有修订都清空）……名称、删除时间与原因作为墓碑保留”，已删除条目详情的描述显示“（描述已随删除清空）”。控制台浏览器门禁脚本（`scripts/run-console-browser-gate.mjs`）的删除文案与描述清空断言同步更新，但本批未运行浏览器门禁。
   - 测试（先失败后通过）：`kernel/test/channel-memory.test.ts` 新增 1 项（删除后投影/全部修订/FTS 无旧描述，Human 读取、历史、含已删除的列表、检索、删除幂等重放都只返回空描述，Worker list/search 不含、read/history 为 not_found，Room 事件不含；修复前失败于删除响应仍带旧描述）；`kernel/test/channel-memory-index.test.ts` 新增 2 项（冻结快照再次 present 时该条描述为 null 且表内无残留；重新打开 Kernel 清掉旧 tombstone 描述而不动有效条目；修复前分别失败）；`application-service/test/channel-memory-api.test.ts` 在 Human API/SDK 用例中加断言（删除响应、历史、HTTP read/history/list 均无旧描述；撤掉 Kernel 修复时该用例失败）；`apps/console/test/memory.test.ts` 删除确认文案断言更新（先失败）。
2. 原生 CLI 记忆关闭回归保护（`agent-host/test/provider-global-isolation.test.ts`）：
   - 既有七路径启动测试只拿记录下的参数/环境与策略对象比较，策略里删掉某个记忆开关时仍会通过（已用临时变异验证：删掉 Claude 环境变量与 `memories.use_memories` 后该组七项仍全过）。新增 7 项逐路径断言字面值：Claude 冷（`claude-stream-json-driver`）/热（`claude-warm-driver`）子进程环境 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`，驱动环境预置为 `0` 仍输；Codex 冷（`codex-app-server-driver`）/热（`codex-warm-driver`）argv 中 `features.memories`、`memories.generate_memories`、`memories.use_memories` 各自最后一个 `-c` 为 `false`，驱动 `-c` 透传三项为 `true` 仍输；OpenCode 冷/热与 Kimi 不带任何记忆相关参数。另新增 1 项：Role `launchEnvironment` 的 schema 与过滤器拒绝 `CLAUDE_CODE_DISABLE_AUTO_MEMORY`，用户附加参数或完全覆盖参数中以 `-c`/`--config` 重开任一记忆键都被拒。上述变异下新增的 Claude/Codex 四项全部失败。
   - 这是对现有行为的回归保护，没有产品代码改动，所以没有“修复前失败”阶段；以变异验证代替。
   - Kimi/OpenCode：依据 main 分支 `docs/audits/2026-09-11-provider-auto-memory-disable.zh-CN.md`（该批只为 Claude/Codex 查证了官方记忆开关，Kimi/OpenCode 没有查证到开关，未添加禁用参数），负责人视为无原生持久记忆。该审计是“未查证到开关”，不是对不存在持久记忆的源码证明。
   - 未覆盖：Codex 热路径 `thread/start|resume` 的 `config` 三项只在冷路径（`codex-provider-session.test.ts`）有断言，热路径需要假 app-server socket，本批未补。
3. 检查：`npm run check`、`npm run format:check`、`git diff --check`、`npm run build:console` 通过。未跑付费 CLI，服务未重启、未部署，未 commit/push。

### 五十五、实例创建即预热常驻运行时

负责人 2026-09-27 裁定：实例创建时就拉起 CLI 进程，而不是等第一条消息；目标合同 §6a 同步修改（负责人批准）。每项先写失败测试再实现；没有运行付费 CLI，没有重启服务，没有改前端冻结范围，未 commit/push。

1. 触发（Kernel 不起进程）：
   - `role.instantiate` 成功的同一事务里，事件写入器按 `instance.created` 追加一条 Outbox 提示（topic `instance.runtime`，`{action:"prewarm", participantId, channelId}`，无正文）；Role 实例被移出其频道（`membership.removed`，含删除 Agent 时的移出）追加 `{action:"retire"}`。幂等重放不产生第二条。所有者：`kernel/src/instance-prewarm.ts`。
   - daemon 的 `InstanceRuntimeHintDispatcher`（`createOutboxDispatcherRunners` 里与唤醒提示一起组合，只在多 lane Host 下）消费该 topic：预热前先让 Host 重新观察执行工作区并重新发布 offer（新实例的 channel home 挂载），再调用 Host；Host 池尚未启动（daemon 启动窗口）时该提示延后重投，其余一律尽力而为、处理后确认，失败只写诊断——丢失的提示只意味着首轮冷启动。
2. 预热计划（Kernel 只读，`kernel.instancePrewarm`，所有者 `InstancePrewarmService`）：`plan(host, {participantId})` 用调度器自己的规划输入，把该实例作为唯一候选跑同一个 `planNextPlacement`，得到首轮会拿到的 placement（offer、observation、RuntimeProfile revision、workspace mount、resolvedModel、toolAccessMode）、agent 上下文（含 session 代数与 `instanceSessionRequired`）与对应的 ContextManifest；不写任何行，不开事务（尽力而为的计划；首轮仍由调度器在事务内正式放置）（测试核对 placements/activations/run_attempts/room_events/instance_runtimes 计数不变）。实例已移出、频道归档 → `instance_inactive`；规划器挂起（忙碌 `lane_busy`、Host 或每 CLI 运行上限满 `capacity_exhausted` 等）→ `placement_hold:<原因>`；放到别的 Host → 跳过。`recentlyActive(host, {since})`：本 Host 授权、仍在频道内、`since` 之后有 RunAttempt 的 Role 实例。
3. Host（`agent-host/src/instance-prewarm.ts` 的 `InstancePrewarmer`，由 `MultiLaneAgentHost` 持有）：
   - 用计划的 placement 走 Host 同一个 placement 解析器拿到首轮同款 adapter（同一 cwd/channel home、附加目录、runtimeKey、runtime 级租约与 session 恢复参数），调用 adapter 新增的可选 `prewarm`；只有常驻 adapter 实现它：Codex、OpenCode、开启常驻的 Claude。Kimi 与默认 Claude 是每轮 adapter → `per_turn_runtime`，不预热。
   - `InstanceRuntimePool.prewarm` 在该参与者锁内执行与首轮完全相同的冷启动（登记 Kernel 行、spawn、身份记录、驱动就绪握手、`markReady`），之后置为 idle；不开轮次、不占忙时槽、不签 Worker 凭据、不建 RunAttempt。已有存活进程 → `already_live`；存活热进程达到软上限 `maxWarm` → `warm_cap`，达到 Host 运行上限 → `host_cap`，同一驱动达到每 CLI 上限 → `cli_cap`：均跳过并写诊断，从不为预热 LRU 淘汰或挤占已有进程。预热逐个串行执行，并经共享启动闸门（独立闸门键 `prewarm:<实例>`，与该实例真实启动不冲突）。
   - 首轮：runtimeKey 与预热一致 → 复用预热进程，`execution_mode = warm`，同一 `instance_runtime_id`；session 绑定仍在首轮按既有规则持久化（Codex/OpenCode 在首轮输入前，Claude 在首个输入被接受后）。
   - 之后全部沿用既有规则：空闲 TTL（从预热完成起算）、LRU、边界重启、看门狗、janitor、重置后按 key 不同在下一轮重启。实例移除：`pool.retire` 空闲时立即有证明地停止（`terminated_reason = removed`），忙碌时在本轮 lane 释放后停止，从不在轮中回收。
   - daemon 启动：Host 池 janitor 之后后台为“最近活跃”实例预热（定义：最近 N 小时内有 RunAttempt 的、仍在频道内的 Role 实例，N 默认 24，可配置，0 表示不预热），恢复已绑定的 session；Host 停止时先等在途预热完成登记再停池。
4. 运行时设置：`runtime-settings` 新增 `prewarm` 组 `{enabled（默认 true）, recentActiveHours（默认 24，0–720）}`，局部更新、共用修订号、持久化到 `runtime-settings.json`，运行中修改立即应用到 Host（关闭只停止新的预热，已启动的按空闲规则回收）。控制台设置页显示两项并可修改（`1/0` 开关与小时数）。
5. 效率门禁：新增 opt-in 组 `role-prewarm`（Codex、Claude、OpenCode；Kimi 不支持），必须与 `role-warm` 同时出现（`RAH_EFFICIENCY_ORDER=native,role-warm,role-prewarm`），否则启动前失败——预热首轮不能替代冷首轮。gate daemon 默认在其运行时设置里关闭预热（`gateRuntimeSettings`），所以 `role`/`role-warm`/漂移门禁仍测冷首轮与重启冷恢复；`role-prewarm` 打开预热，创建实例后等待空闲运行时行（无轮次、无 RunAttempt）并记录就绪耗时，断言第 1 轮 `warm` 且为预热的那个运行时（`notPrewarmed`/`prewarmedRuntimeChanged`），不做重启轮；两组各自对原生判定，另输出标注清楚的首轮对照 `result.firstRound`（冷首轮 vs 预热首轮）。未运行付费门禁。
6. 测试（结论读 room.db 与 FAKE 服务记录）：
   - `kernel/test/instance-prewarm.test.ts`（5 项）：实例化写一次提示、重放不重复；计划只读且与真实首轮 placement/agent 上下文逐项相同；忙碌、Host 上限满、他 Host 不给计划；移除写 retire 提示并失去资格、Human 成员离开不写；最近活跃窗口。实现前按预期失败（缺导出）。
   - `agent-host/test/instance-prewarm.test.ts`（7 项，FAKE Codex app-server）：预热后进程就绪、无 `turn/start`、无 RunAttempt，重复提示不起第二个进程，首条消息 `warm` 复用同一进程与 thread；`maxWarm`/Host/每 CLI 上限各自跳过且不驱逐已有进程；忙碌与 Kernel 运行上限挡住预热；运行中关闭不预热；移除回收（`removed`）；“daemon 重启”后按最近活跃预热并 `thread/resume` 原 thread、窗口外不预热；每轮 adapter 不预热。变异验证：让预热 key 与首轮不同时首轮变 `cold`，该测试失败。
   - `daemon/test/instance-prewarm-composition.test.ts`（组合 daemon + FAKE Codex，Human API）：创建实例后出现 idle 运行时且无轮次；首条消息 `warm` 复用；daemon 重启后预热并恢复同一 session；移除后 `removed`；经设置 API 关闭后新实例不预热。`daemon/test/instance-runtime-hints.test.ts`：提示按序投递、Host 未启动时延后重投、只处理一次。`runtime-settings.test.ts` 新增 prewarm 组；控制台 `actions/model` 测试更新；门禁 `warm/gate-daemon/efficiency-config` 单测新增。
7. 偏离与限制：
   - Codex、OpenCode 驱动的就绪握手本来就包含 `thread/start|resume`（或 serve 的 session 创建/恢复），不调用模型；预热沿用该握手而不是只到进程启动。首轮前 session 不绑定：从未有过轮次的实例若预热后在首轮前被回收，CLI 自己的会话存储里会留下一个未绑定、无内容的原生 thread，之后首轮新建并绑定新的 thread，这不是静默替换（没有被绑定过的 session）。
   - 每 CLI 上限按驱动种类计数（本地每家 CLI 一个 RuntimeProfile）；预热计入 Host 上限只看存活热进程数，冷路径进程不计（第六十二节起改为计入冷路径进程，见该节第 5 项）。
   - 为守住 `room-kernel.ts` 行数上限（6925），调度器读取 AgentDefinition/执行策略修订改为 `placement-candidate-projection.ts` 导出的模块函数（行为不变），Kernel 只增加一个服务字段。
   - `session_resume_ms` 只在 cold 轮记在 RunAttempt 上；预热首轮为 warm，恢复耗时留在运行时行。
   - v2/v3 单 lane daemon 没有提示消费者，`instance.runtime` Outbox 行会保留未发布。
8. 检查：`npm run check`、`npm run format:check`、`git diff --check` 见本批汇报。服务未重启。

### 五十六、原生记忆关闭证明门禁

新增付费 opt-in 门禁 `scripts/test-native-memory-off.mjs`（`npm run test:cli:native-memory -- --paid`，可选 `--provider=claude|codex|all`、`--no-codex-followup`、`--codex-wait-seconds=N`），纯逻辑在 `scripts/cli-efficiency/native-memory.mjs`。第五十四节只证明启动参数/环境带有开关；本门禁用真实 CLI 证明开关确实阻止原生记忆写入。**待负责人授权并运行，本批未运行任何付费调用。**

- 模型：Claude `haiku`（无 effort）、Codex `gpt-6-luna / low`，启动前经 `approved-models.mjs` 校验，所有模型进程经现有守卫 shim（Claude `claude-guard`、Codex `model-guard` app-server 白名单）。
- 对照组 = 产品启动方式只去掉记忆开关（Claude 去掉 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 并删除继承值；Codex 去掉 `features.memories`/`memories.generate_memories`/`memories.use_memories` 三个 `-c` 与 thread config 同名键），其余全局隔离开关保留；实验组 = 产品启动方式。同一提示“Please remember for future sessions: I prefer tabs for indentation. Save this to your memory.”。
- 认证：临时 HOME 下 `claude auth status` 为未登录（钥匙串登录不可用，已免费验证），所以 Claude 两组在真实 HOME 下各用一个新的临时 cwd，项目记忆桶 `~/.claude/projects/<cwd 桶>/memory` 为该组独有；运行前后快照所有桶的 `memory/`，本次临时根目录下的桶计入该组，其他桶变化只列为“未归属”（例如 Human 自己的会话）。Codex 每组独立临时 `CODEX_HOME`，`auth.json` 为指向真实文件的符号链接，结束时检查链接是否被替换并给出补救说明；不改任何用户文件。
- Codex 0.156.1 的 `memories` 特性默认关闭（`codex features list` 在空 `CODEX_HOME` 下为 false），因此两组的临时 `config.toml` 都像用户那样打开记忆（`min_rollout_idle_hours = 0`，提取与整合模型固定为 `gpt-6-luna`），实验组证明产品开关能覆盖用户配置。Codex 记忆在后续会话启动时由空闲线程异步生成，所以默认每组再开一个新线程发一轮 “Reply with exactly: OK” 并保持进程存活等待（默认 180 s；对照组出现记忆文件即提前结束，实验组等满窗口）。Codex 接受未知配置键而不报错，上述键名来自二进制字符串，是否生效只能由对照组结果证明。
- 检查位置：Claude 该桶 `memory/`；Codex `$CODEX_HOME/memories/` 与 `memories_1.sqlite`（`stage1_outputs`、`jobs` 行数）。另记录 cwd 下文件（模型可能写 CLAUDE.md/AGENTS.md，仅作信息，不算原生记忆）、rollout 中出现的模型与 effort（非批准模型记为违规；后台记忆调用的 effort 不受门禁控制，如实列出）。
- 判定：对照组未完成为 inconclusive；对照组没有写入记忆内容（Codex 只有 job 行也算）为 insensitive（“测试不灵敏、无法证明”），此时跳过实验组，不得记为通过；实验组有任何记忆活动（Codex 含仅启动流水线）为 fail；否则 pass。总判定：有守卫违规为 guard-violation，否则取 fail > inconclusive > insensitive > pass。仅 pass 时退出码为 0。
- 调用上限：Claude 每组 1 轮；Codex 每组 1 轮 + 默认 1 轮续聊，合计至多 6 个主模型回合，另加 Codex 对照组后台记忆提取/整合调用（数量不受门禁控制，从 rollout 报告）。
- 证据：临时目录下 `result.json` 与脱敏的 `result.redacted.json`（前后快照、差异、参数、模型、答案与记忆摘录各至多 160–200 字符）。
- 已知限制：Claude 用 `-p` 单轮而非产品的 stream-json 常驻输入方式，开关相同；Claude 对照组生成的 `~/.claude/projects/<临时桶>` 目录不自动删除，路径记录在证据中。
- 检查：`scripts/cli-efficiency/native-memory.test.mjs` 15 项免费单测（参数构造与守卫放行、快照与差异、sqlite 计数、判定、参数解析），`npm run test:cli:efficiency:unit` 全部通过；`npm run format:check`、`git diff --check` 通过；`npm run check` 在编写时因并行进行中的 daemon 预热改动（`daemon-application.ts` 未定义 `InstanceRuntimeHintDispatcher`、行数超 800 ratchet）失败，与本门禁文件无关，需在该批完成后复跑。单测在实现之后编写（门禁脚本本身不是产品行为改动）。未跑付费 CLI，服务未重启，未 commit/push。

### 五十六补、原生记忆关闭证明：运行结果（2026-09-27，负责人授权）

`npm run test:cli:native-memory -- --paid` 总判定 pass（证据 `docs/evo/evidence/2026-09-27-native-memory-off.json`）。Claude haiku：对照组（仅去掉 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`，其余隔离开关相同）在其唯一项目桶写入原生记忆；实验组（产品启动方式）未写入。Codex gpt-6-luna/low：对照组（用户配置开启记忆，仅去掉三项记忆开关）生成原生记忆；实验组未生成。结论：产品开关在两家上确实阻止原生记忆，且能覆盖用户自行开启的 Codex 记忆配置；Kimi/OpenCode 按负责人判定视为无原生持久记忆。

### 五十七、Loom Worker 工具门面：OpenCode 接线

> 已撤回（负责人 2026-09-27，见第五十九节）：工具回帖、MCP 入口、回合 `current` 指针、工具版提示词与协议版本、租约标记与 A/B 开关均已移除，OpenCode 恢复 CLI 回帖；只保留第 6 项中的用户 MCP 按名关闭与门禁守卫放行，且改为每次 OpenCode 启动都执行。本节以下内容保留为历史记录。

依据：调研 `~/.loom/reviews/2026-09-27-worker-tool-facade.md` 与文末负责人裁定（2026-09-27，“同意推荐”）。本批只接 OpenCode，Claude/Codex/Kimi 不变。

1. 偏离 Raft 的理由与批准：Raft 1.0.32 回帖走 CLI（`raft message send` 经 shell）；其 `--mcp-config`/`OPENCODE_CONFIG_CONTENT.mcp` 只用于已退役的托管第三方 MCP。Loom 新增的是自有、固定的 Worker 结构化门面，只有 `message_post`、`message_check` 两个工具，底层是同一个 Worker CLI 与 application service，不读写 `managed-mcp.json`，不加 Human/Worker API、设置页或代理，不属于已退役的托管 MCP。理由是首轮起草与 heredoc/转义成本（效率门禁首轮证据）；负责人批准偏离。工具调用不阻塞，不做 `receive_message(block)`，通知与等待仍归 Activation。
2. 门面（`agent-host/src/worker-tool-facade.ts`）：参数映射为 `runWorkerCliCommand` 的 argv（`--target`、`--based-on-room-seq`、`--final`；`message_check` 可带 `--replay`），body 作为注入的 stdin（与 heredoc 同一路径：同样 trim、同样的服务端派生幂等键）；结果是 CLI 的 stdout/stderr 原文，退出码非零即 `isError`。门面不含路由、队列、游标或业务判断；ACK-on-post、`final` 标记、回复目标守卫、held draft 都在原 CLI/Kernel。工具 schema 不含 turn、token 或凭据字段（两个工具定义合计不到 1.1 KB）。
3. 回合句柄：模型不传句柄。常驻 runtime 在签发回合句柄时，若启动租约带工具标记，把当前句柄写到 0300 回合根目录下的 `current`（0600，按名创建），回合释放时先清掉它再撤销凭据；门面每次调用读取它并作为 `--turn` 交给 CLI，没有活动回合时不发请求、返回 `TURN_HANDLE_INACTIVE` 与 `Effect: not_sent`。冷进程没有回合根，直接用环境里的每 Activation 凭据。诚实边界：同 UID 进程若刻意读取这个固定文件名可以得到当前句柄；威胁模型不变（防的是遗留工具与模型混淆的无意跨回合使用，它们仍只持有自己回合的句柄）。
4. stdio MCP 入口（`worker-mcp-server.ts`，无 SDK 依赖）：换行分隔 JSON-RPC，只实现 `initialize`、`ping`、`tools/list`、`tools/call`，只暴露这两个工具。由 Provider 以 `"$RAH_WORKER_CLI" __worker-mcp` 拉起（Worker CLI 入口内分派，开发态与 SEA 包装脚本同一路径），是 `opencode serve` 的子进程，位于驱动进程组内，继承 `LOOM_RUNTIME_ID`/`LOOM_RUN_ID` 清扫标签；配置里只有命令路径，不落盘任何凭据；每次调用重新读凭据路径，无状态。
5. 单一决策点：daemon 的常驻提示词租约（`standing-prompt-lease.ts`）按 `workerToolModeForRuntime`（`worker-tool-names.ts`，本批仅 OpenCode）决定本次启动是否带工具，并同时产出三样东西：提示词工具版、工具版协议版本、租约环境 `RAH_WORKER_TOOLS=opencode`（加入受管载体键，只能来自 Host 租约）。下游只跟租约走：驱动据此注入，Host 据此渲染工具形式的 `Reply:`，Worker CLI 的 `help protocol` 据此输出对应版本的规则卡。daemon 自身环境 `RAH_OPENCODE_WORKER_TOOLS=off` 可关掉（仅供 A/B 的 cli-post 组，`RAH_` 前缀不会传给子进程）。
6. OpenCode 驱动（冷 `opencode-server-driver.mjs`、热 `opencode-warm-driver.mjs` 共用 `opencode-worker-tools.js`）：
   - 启动 serve 前用 OpenCode 自己的只读解析 `opencode debug config --pure`（与 `serve --pure` 同一不加载外部插件的口径，同一环境与 cwd）取出全部 MCP 名单；在 `OPENCODE_CONFIG_CONTENT` 里按名写 `{enabled:false}` 并加入 `mcp.loom`。用户文件不改，用户的 MCP 服务不会被拉起。
   - serve 就绪后读 `GET /mcp`：`loom` 必须 `connected`、其他全部 `disabled`，否则启动失败、不发任何输入（提示词与唤醒已经写了工具，不能静默退回）。租约要求工具但没有绝对路径的 `RAH_WORKER_CLI` 时，在启动 serve 前拒绝。
   - 免费探针（无模型调用）：真实 opencode 1.18.32 `serve` 在临时 HOME 下拉起真实 Loom 入口，`GET /mcp` 返回 `{"usermarker":{"status":"disabled"},"loom":{"status":"connected"}}`（约 0.2 s）；`debug config --pure` 在临时 HOME 下约 1 s，列出用户级、项目级与 `OPENCODE_CONFIG_CONTENT` 合并后的名单。
   - 门禁守卫 `drift-opencode-guard.mjs` 放行这一条 `debug config --pure`（不调用模型），其他 argv 仍拒绝。
7. 唤醒与常驻提示词：工具版 `Reply:` 为 `loom_message_post target="#room" based_on_room_seq=N final=true · no reply needed: loom_message_check`（多目标、截断窗口、上次尝试提示同样改为工具名）；回复行不再带 `--turn`，句柄仍以 `Turn handle: --turn …` 一行给其他 Worker CLI 命令用。常驻提示词工具版删去 heredoc 用法，发帖与收信指向工具，其余命令、`--startup` 引导与 `worker help` 细节仍是 CLI。CLI 版协议版本不变（仍为 `8f51ca099de3`，测试钉住），其他三家的提示词、唤醒与已续聊 session 均不受影响；工具版有自己的版本，所以已有 OpenCode session 按既有机制收到一行“Protocol updated”，而 OpenCode 每次请求重读 instructions 文件，新规则本身随下一次启动生效。
8. `opencode-final-interrupt.js`：`loom_message_post` 且 `final: true` 的工具调用与 `message-post … --final` 命令一样识别为发帖调用（只影响中断时机与 follow-up 统计，结束判定仍由 Host 读 Kernel 标记）。
9. 门禁：`tool-calls.mjs` 按工具名把 `loom_message_post`/`mcp__loom__message_post`/`message_post`（及对应 check）归为协议调用（box-post/box-check），`turnHandle` 记为 true（门面自带句柄），`final` 取自结构化参数。新增付费 A/B（只写未跑）：`scripts/test-worker-tool-ab.mjs`（必须 `--paid`）与纯逻辑 `scripts/cli-efficiency/worker-tool-ab.mjs`：native / cli-post / tool-post 三组，每组 6 个新 session × 3 轮，每个样本块内产品两组顺序交替（ABAB）；模型钉死 `deepseek/deepseek-flash` low 并经 `approved-models.mjs` 与守卫 shim 校验；指标为首轮 reasoning 字符与 token（从 opencode.db 的 reasoning/step-finish part 取）、首轮 replySeconds、回复前生成数、首请求与总 token、格式错误（Worker 发帖/收信工具报错或输出 `Effect: not_sent`/`INVALID_ARG`/`MISSING_CONTENT`）、送达率、各轮相对配对原生样本的协议额外生成，另校验每组确实走了所称的回帖路径。预设判定：tool-post 相对 cli-post 首轮 reasoning token 中位数降 ≥30% 且首轮延迟中位数降 ≥3 s，tool-post 无送达失败且每轮协议额外生成 ≤0；输出中位数、IQR 与逐样本数据，6 样本只作方向性结论，不做显著性宣称。运行命令：`node scripts/test-worker-tool-ab.mjs --paid`（需负责人对该批次单独授权）。
10. 测试（先失败后通过）：`agent-host/test/worker-tool-facade.test.ts`（工具路径与 heredoc CLI 路径发往 Worker HTTP 的 URL、凭据与 JSON 请求体逐字节相同，含 target/basedOn/final；常驻回合用当前句柄、无活动回合不发请求；服务端拒绝时结果即 CLI 原文；参数错误不触达服务端；schema 无句柄/凭据字段）、`worker-mcp-server.test.ts`（握手、列表、调用、错误码；真实拉起入口经 Worker 路由发帖并在 stdin 关闭后退出 0）、`worker-turn-handle.test.ts`（当前句柄发布与先清后撤、旧回合不清新回合、非私有文件不信任）、`worker-tool-protocol.test.ts`（CLI 版本钉住、工具版提示词与唤醒 golden、`help protocol` 随租约）、`opencode-worker-tools.test.ts`、`opencode-final-interrupt.test.ts`（工具发帖识别）、`opencode-server-driver.test.ts`（注入、用户 MCP 关闭、`GET /mcp` 在首个 prompt 前、未能关闭的服务与缺 CLI 时启动失败、无标记时不变）、`opencode-warm-runtime.test.ts`（常驻两轮经 `loom_message_post` 回帖：一个 MCP 进程、每轮自己的凭据、ACK 完成 Activation、`final` 触发 abort）、`daemon/test/opencode-bodied-wake-chain.test.ts`（真实 Kernel/Worker/CLI/冷驱动 + 假 opencode：工具回帖完成 Activation 并登记送达，另一 Room 的 `final` 回帖被回复目标守卫拒绝且未发送，无需回复时经 `loom_message_check` 完成）、`daemon/test/standing-prompt-lease.test.ts`、`scripts/cli-efficiency/{tool-calls,drift-opencode-guard,worker-tool-ab}.test.mjs`。
11. 已知限制与未做：
    - 真实模型是否选用工具、首轮起草是否下降都未验证，只能靠付费 A/B；工具名 `loom_message_post` 来自调研时的假模型 API 探针，本批的真实 serve 探针只验证了 `GET /mcp` 状态。
    - 冷驱动每个回合多一次 `debug config`（约 1 s）；常驻只在 serve 启动与替换时付一次。
    - Kimi 用户 MCP 与项目 `.mcp.json` 按负责人裁定记为已知限制；Claude（`--mcp-config` + `ENABLE_TOOL_SEARCH=false`）、Codex（`thread/start.dynamicTools`）、Kimi（ACP `mcpServers`）留后续批次。
    - `runtime-profile-composition.ts` 调用 `workerToolModeForRuntime` 的一行只由单元测试覆盖决策函数与租约，未单独做组合层测试。
    - `worker help message-post` 等按需帮助仍是 CLI heredoc 说明；held draft/目标确认的恢复路径仍是 CLI `--send-draft`（服务端同一份草稿）。
    - 未跑付费 CLI、未重启或部署服务。

### 五十八、OpenCode 工具回帖 A/B 结果（2026-09-27，c2fe703，负责人授权）

`node scripts/test-worker-tool-ab.mjs --paid`，deepseek/deepseek-flash low，三组各 6 个新 session × 3 轮，产品两组交替；送达三组均 18/18。证据 `docs/evo/evidence/2026-09-27-worker-tool-ab-opencode.json`。

- 首轮 reasoning token 中位数：native 1303、cli-post 1277、tool-post 1744；首轮回复中位数：native 10.8 s、cli-post 11.4 s、tool-post 14.2 s。
- 判定未达通过线（reasoning 反而 +36.6%，首轮延迟 +2.8 s；tool-post 协议生成数未采集，判 missing-evidence）。本样本中 cli-post 与原生几乎持平，“先起草再复制”假设未得到支持。
- 结论：工具回帖在 OpenCode 上方向为负，不向 Claude/Codex/Kimi 推广；OpenCode 工具模式的去留待负责人裁定。6 个样本只说明方向。

### 五十九、撤回 OpenCode 工具回帖（保留用户 MCP 按名关闭）

依据：负责人 2026-09-27 裁定——第五十八节 A/B 方向为负，撤回工具回帖，OpenCode 恢复 CLI 回帖，保留隔离修复。按文件精确移除（未整体 `git revert c2fe703`）。

1. 移除：`worker-tool-facade.ts`、`worker-mcp-server.ts`（Worker CLI 的 `__worker-mcp` 入口）、`worker-tool-names.ts`（`RAH_WORKER_TOOLS` / `RAH_OPENCODE_WORKER_TOOLS`、`workerToolModeForRuntime`）、回合根 `current` 指针（`readCurrentWorkerTurn` 及发布/清除，Codex 常驻适配器不再传 `current`）、常驻提示词与唤醒 `Reply:`/上次尝试行的工具版、`standingProtocolVersion(tools)` 工具版协议版本（`STANDING_PROTOCOL_VERSION` 恢复为常量）、`worker help protocol` 随租约变体、受管载体键 `RAH_WORKER_TOOLS`、daemon 租约与组合层的工具决策、`opencode-final-interrupt.js` 对 `loom_message_post` 的识别、OpenCode 驱动注入 `mcp.loom` 与 `RAH_WORKER_CLI` 必需检查；门禁 `tool-calls.mjs` / `claude-usage.mjs` 的工具名分类（撤回后无调用方）；以上对应测试（`worker-tool-facade`、`worker-mcp-server`、`worker-tool-protocol`、`opencode-worker-tools` 测试，及 `worker-turn-handle`、`opencode-final-interrupt`、`opencode-warm-runtime`、`opencode-bodied-wake-chain`、`standing-prompt-lease`、`tool-calls` 测试中的工具用例）。
2. A/B 脚本：`scripts/test-worker-tool-ab.mjs`、`scripts/cli-efficiency/worker-tool-ab.mjs` 及其测试已删除——tool-post 组依赖已移除的工具模式，留下只能是不可运行的死代码。历史证据保留：`docs/evo/evidence/2026-09-27-worker-tool-ab-opencode.json` 与第五十七、五十八节；脚本原文见提交 c2fe703。
3. 保留（改为无条件）：OpenCode 用户 MCP 按名关闭，新模块 `agent-host/src/opencode-user-mcp.js`，冷/热驱动每次启动都执行——`opencode debug config --pure` 取名单 → `OPENCODE_CONFIG_CONTENT` 中逐名 `{enabled:false}`（无名单时配置原样不变）→ serve 就绪后 `GET /mcp` 复核全部为 `disabled`，否则在任何输入前启动失败（不重试）。与 Codex 的逐名关闭、Claude 的 `--strict-mcp-config` 对齐。门禁守卫 `drift-opencode-guard.mjs` 对这一条 `debug config --pure` 的放行及其测试保留。代价：冷驱动每个回合多一次 `debug config`（第五十七节免费探针约 1 s），常驻只在 serve 启动与替换时付一次。
4. 协议版本：只剩 CLI 一个变体，OpenCode 回到 `8f51ca099de3`（与 Claude/Codex/Kimi 相同，常驻协议卡 SHA-256 亦钉住，四家字节与 §57 之前一致）。在工具版（`0af8aa7b0fd8`）上创建的 OpenCode session 按第十五节既有机制在续聊时收到一行 `Protocol updated (v8f51ca099de3)`，被接受后绑定前移；OpenCode 每次请求重读 instructions 文件，CLI 规则本身随下一次启动生效。实例 session 键不含提示词摘要，不会因撤回而换 session。
5. 测试（先失败后通过）：`agent-host/test/opencode-user-mcp.test.ts`（按名关闭与合并、无名单不变、名单来自 `debug config --pure`、`GET /mcp` 复核）；`opencode-server-driver.test.ts`（无任何租约标记时也关闭用户 MCP 且 `GET /mcp` 在首个 prompt 前、无 `loom` 条目、回帖仍走 Worker CLI；无法关闭的服务使启动失败；无用户 MCP 时配置不变）；`opencode-warm-runtime.test.ts`（常驻同样关闭并在首个 prompt 前复核；无法关闭时不发输入）；`provider-global-isolation.test.ts`（两个 OpenCode 驱动的 serve 配置逐名关闭用户 MCP）；`daemon/test/standing-prompt-lease.test.ts`（版本钉住 `8f51ca099de3` 与协议卡哈希、租约无 `RAH_WORKER_TOOLS`、提示词为 heredoc CLI 形式；工具版 session 收到回到 CLI 版本的更新行）。假 opencode（fixture、`provider-usage-drivers`、`opencode-provider-session`）补 `debug config` 与 `GET /mcp` 应答。
6. 未做：未跑付费 CLI，未重启或部署服务；真实 opencode 上无条件关闭只有第五十七节的免费探针证据。

### 六十、续轮额外 message-read 回归修复（调查结论：非 Loom 改动，本节未改代码）

触发：2026-09-27 付费门禁（Codex `gpt-6-luna/low`，d384715，临时目录 `rah-cli-efficiency-arYA0j`）中 `role-warm` 与 `role-prewarm` 每一轮（含第 1 轮）都先执行 `worker message-read --target "#efficiency" --turn …` 再 `message-post`，协议额外生成 +1；此前[证据](evidence/2026-09-27-eff-codex.json)（8ea005a，临时目录 `rah-cli-efficiency-6rncn1`）续轮为 0。

调查（免费，只读本机 rollout 与日志，未调用模型）：

1. 前提更正：8ea005a 已在记忆批次 B（862d955、9aab5cd）之后，两次运行都带 `## Channel memory index` 段（`No entries yet.`）。8ea005a..d384715 之间常驻提示词、常驻协议、记忆注入与唤醒文本源码无改动（`STANDING_PROTOCOL_VERSION` 仍钉住 `8f51ca099de3`，协议卡 SHA-256 由第五十九节测试钉住）；`codex-warm-adapter.ts` 的改动是把启动逻辑抽成 `#launch` 供预热复用，启动参数与环境逐项相同。
2. 模型输入逐项对比（旧 `rollout-…T05-41-47-01a0dfaa…`，新 `rollout-…T09-39-33-01a0e084…` 与 `…T09-40-18-01a0e085…`）：base instructions（MD5 相同，18037 字符）、三条 developer 消息、AGENTS.md 用户块、`environment_context`、第 1 轮唤醒正文与 `Reply:` 行，在去掉 handle、participant/host/room ID 与临时目录名后逐字节相同；Codex 0.156.1、`loom-codex-warm`、model/effort/personality/collaboration_mode/approval 相同；首个请求输入 10695 vs 10688 token（差 7，对应 ID 分词），工具定义无增减。
3. 行为差异发生在输入相同的第 1 轮：新运行第一条工具调用即 `message-read`，此后续轮照抄同一顺序；旧运行 9 个同类 session（09-25 至 09-27 的 role/role-warm/legacy 组）第 1 轮均无 `message-read`。新 role-warm 的命令写法也首次出现单引号 JS 字符串（此前 18 个效率 session 均为 `{cmd:"…"}`）。两次运行之间 Codex 的模型目录在 01:39 UTC 重新拉取（本机 `logs_2.sqlite`：`cache version mismatch` 后 `GET /backend-api/codex/models` 200，新 etag）。

结论：Loom 侧没有引起该行为的提示词、唤醒或启动差异，不存在可恢复的被删说明或可调整的段落；差异来自模型侧（服务端模型/服务漂移，或低 effort 下第 1 轮的采样差异经会话内自我模仿扩散到续轮），两者只能靠付费复测区分。按“证据先于改动”与“不靠提示词打补丁”，本节不改代码、不改协议版本；若复测确认是模型侧稳定行为，再单独评估（例如把 `message-read` 的用法从常驻“Message Notifications”段移到内容无关通知自身，这会改变四家的协议版本，需四家付费复验）。

建议复测（需负责人授权）：先在 d384715 上跑 `RAH_EFFICIENCY_PROVIDER=codex RAH_EFFICIENCY_MODEL=gpt-6-luna RAH_EFFICIENCY_EFFORT=low RAH_EFFICIENCY_ORDER=native,role-warm,role-prewarm node scripts/test-cli-efficiency.mjs --paid`（9 轮）；若仍出现，同一时段在 8ea005a 的 worktree 以 `native,role-warm` 对照一次（6 轮），8ea005a 也出现即确认模型侧。

未做：未跑付费 CLI、未重启或部署服务；无代码与测试改动。

### 六十一、预热付费验证（2026-09-27，负责人授权，两次各 9 轮）

证据 `docs/evo/evidence/2026-09-27-prewarm-codex-run{1,2}.json`（Codex gpt-6-luna/low，native/role-warm/role-prewarm）。

- 第 1 次：预热首轮 17.2 s vs 冷首轮 20.6 s（−3.4 s），预热后进程就绪约 0.6 s；但两组每轮都先执行一次 `message-read`（协议 +1），调查确认模型输入逐字节相同、属模型侧差异（第六十节）。
- 第 2 次（复测）：role-warm 三轮协议额外生成均为 0，第 1 次的额外 `message-read` 未再出现，印证模型侧漂移/采样差异；预热首轮 23.5 s vs 冷首轮 17.2 s（预热组首轮模型多读一次文件，业务路径 +1，另有回复后的一次 worker 命令）。
- 结论：预热可稳定省去进程启动（就绪约 0.5–0.6 s），但单样本首轮延迟被模型行为差异主导，不能据此宣称固定的秒级收益；要量化需多样本交替。不改代码。

### 六十二、全面审查 2 批次 1：预热交汇修复

来源：`~/.loom/reviews/2026-09-27-full-review-2-synthesis.md` 批次 1（Codex P1-1/P1-2/P2-1，lifecycle P1-1/P2-1/P2-2/P2-3，drivers P2-1/P2-2/P2-3，kernel P2-2）。预热当前已由负责人临时关闭（runtime-settings revision 1）；本批修复后是否重新开启，待负责人决定。本批未跑付费 CLI、未重启服务。

1. 提示分发（`daemon/src/instance-runtime-hint-dispatcher.ts`）：租到提示后先问 Host 是否可接收（`MultiLaneAgentHost.acceptsPrewarm()`，即预热器已打开）；未就绪则 `retryOutbox` 延后，就绪则立即确认，再尽力执行刷新挂载与预热/retire。确认或重试的租约错误只写诊断，不让 `run()` reject（此前慢预热/retire 超过 5 s 租约会让 daemon 全部组件停止，提示也不发布，重启后重演）；确认失败时不执行，留给下次租约。daemon 启动时最近活跃预热排长队也不再影响提示确认。
2. 启动准入（`InstancePrewarmer` 新选项 `admit`，`MultiLaneAgentHost` 接到 `RuntimeProcessHygiene.admit`，与 AgentHost 真实执行同一检查）：在启动闸门放行后、调用 adapter 预热（登记/spawn）之前检查；未落库清扫结果、进程扫描不可用、Kernel pending/blocked 清扫，或检查本身抛错 → 跳过（原因 `RAH_RUNTIME_CLEANUP_BLOCKED: …`，写诊断），不创建行、不 spawn；清扫恢复后可再预热。
3. 启动所有权（`InstanceRuntimePool`）：新增池内在途启动登记 `#starting`（`#coldStart` 在第一个 await 前同步登记实例运行时 id，finally 清除）；`fenceStart` 改在该参与者的池锁内执行，等在途的预热完成（就绪并持有，或失败并记录）再判断，janitor/fence 的“外来”判定排除本池持有与本池在途的行（只排除显式登记的 id，不对当前代数的所有 starting 行免检）。`#coldStart` 内部调用的 janitor 不取参与者锁，避免重入死锁。首条消息落在预热“已登记未 spawn”与“已 spawn 未就绪”两个时点，都不再误杀、不重复 `thread/start`，首轮 `warm` 接管预热的运行时；预热失败后真实启动正常走冷启动。
4. 闸门后复核：放行后重新检查预热器打开/开关，重新取 Kernel 只读计划（实例已移出、频道归档 → `instance_inactive`）；`retire` 把实例记入已退役集合（实例 id 不复用），排队中的预热不再 spawn（`instance_retired`）；`close()` 用 AbortSignal 把闸门中排队的预热移出，不再在停机中 spawn。Kernel `instanceRuntimes.register` 对 Role 实例校验仍是所属频道成员且频道未归档，否则 Conflict（不撤销 Host 参与者授权，retire 与终止证明仍用它写记录）；池把它当作预热启动失败。
5. 资源计数（合同 §6a “预热计入全局与每 CLI 上限”）：预热准入改为统一口径——本 Host 其他参与者的热进程（idle、busy、在途启动，含真实执行的冷启动）加上 Kernel 已预留但没有热进程持有的 placement（每轮 CLI 的冷进程，如 Kimi、默认 Claude），分别与 Host 上限、本驱动每 CLI 上限比较；`maxWarm` 软上限照旧只数热进程。Kernel 预热计划的 `limits` 新增 `hostReserved`/`runtimeProfileReserved`。检查与在途登记之间没有 await（原子预留），失败在 finally 释放，就绪后转为存活热进程。真实执行优先：真实启动从不因预热计数被拒（Kernel placement 上限准入它们）；尚未 spawn 的预热在 spawn 前按当前占用复查，被真实启动占满时让出（记 `start_failed`/`RAH_NOT_STARTED` 行后跳过，原因 `host_cap`/`cli_cap`）。计划在闸门放行后重取，排队期间调低的上限立即生效。上限因此包含冷 CLI 物理进程，第五十五节第 7 项“冷路径进程不计”已不成立。
6. 运行时设置文件（`daemon/src/runtime-settings.ts`）：读取容忍并原样保留未知键（顶层分组与已知分组内的未知字段），只校验、读取已知字段；更新回写时保留。此前 `.strict()` 使回滚构建遇到新键无法启动。已在旧构建（ab3cfcd 之前）上写过的文件不受本修复影响——修复只对今后的新增键生效。
7. 热 Codex 驱动：
   - `providerLaunchPolicy` 移入 try，用户 MCP 预检失败先经 fd3 发 `fatal`（原因原文）再退出 1，池与首轮失败信息带“Codex user MCP servers could not be resolved …”，不再只有 “exited before ready”。冷 `codex-app-server-driver.mjs` 未改（其 stderr 由 BoundedOutput 保留）。
   - reload（`thread/resume` 已卸载的 thread）前重新 `codex mcp list` 列名单；出现启动时没有的名字（或列举 fail-closed 失败）→ 本轮以 `config_restart: …` 被拒（`turn.failed rejected`，未开始任何轮次），随后驱动 `fatal` 退出；Activation 按可恢复失败重试，下一次冷启动按全部现有名字关闭并 `thread/resume` 同一 thread。选此法而非 thread 级 `config` 合并关闭项的依据：进程级 `-c` 关闭已由二次列举免费核实，thread 级 `config` 对 `mcp_servers.*` 的效果未核实；代价是一次失败的尝试，运行时行终止原因记为 `crash`（非 `config_restart`）。`providerLaunchPolicy` 返回值新增 `codexMcpServerNames`。
   - `validateProviderLaunchArgs` 对集合内的单字母托管短选项拒绝粘连写法（`-cKEY=VAL`、`-sdanger-full-access` 等，取前两个字符判定），附加参数与完整覆盖两条路径都拒绝。已保存的 Role 若含此写法，启动时会被拒。
8. 测试（先失败再实现；FAKE Codex app-server，无模型调用）：
   - `daemon/test/instance-runtime-hints.test.ts`：新增“租约 50 ms、预热/retire 各 150 ms：`run()` 不 reject，每条提示确认一次、各处理一次，确认失去租约只写诊断且不执行”（实现前 `run()` 以 `LeaseConflictError` reject）；原用例改为经 `acceptsPrewarm` 判断就绪，未就绪时不再先刷新挂载。
   - `agent-host/test/instance-prewarm.test.ts` 新增 8 项：首条消息在“已登记”“已 spawn 未就绪”两个屏障下首轮 `warm` 接管、单进程单 thread、无 crash/start_failed 行；预热失败时首轮冷启动完成；pending 清扫、扫描不可用、清扫结果写入失败三态下预热跳过且无行无进程、恢复后可预热；闸门排队中 retire、仅移除、close 三种情况不 spawn；未 spawn 的预热让出给占用最后一个 Host 名额的真实启动；无热进程持有的 placement（每轮 CLI）计入预热上限（去掉 reserved 计数时该测试失败，已验证）；闸门排队期间调低上限后按新上限跳过、启动失败释放名额。实现前 8 项均失败（close 一项挂起至超时）。
   - `kernel/test/instance-prewarm.test.ts`：移除后、频道归档后 `register` 被拒，恢复归档后可登记；计划 `limits` 断言新增两字段。
   - `daemon/test/runtime-settings.test.ts`：含未知分组与分组内未知字段的文件能打开、更新并原样保留。
   - `agent-host/test/codex-warm-runtime.test.ts`：预检失败时池诊断含 fd3 `fatal` 原因且未起 app-server；卸载后新增 MCP → 旧进程不 reload、不跑第二轮，重启后的进程带 `mcp_servers.added.enabled=false` 并恢复同一 thread。FAKE `codex mcp list` 可读 `mcp.json`/`mcp-fail`（默认仍为空）。
   - `agent-host/test/provider-launch-arguments.test.ts`：粘连写法在附加与覆盖路径均被拒。
9. 未解决/限制：config_restart 的运行时行记为 `crash`，且消耗一次重试；Kernel 预留快照取自闸门放行时的计划，与池内实时计数之间仍有小窗口（偏保守或偏少至多一次在途放置）；预热让出时留下一条 `start_failed` 运行时行；预热重新开启与否待负责人决定，重新开启前建议经 Codex 复审本批。

### 六十三、全面审查 2 批次 2：记忆与 Kernel

依据：`~/.loom/reviews/2026-09-27-full-review-2-synthesis.md` 批次 2 与负责人裁定（Codex P1-3；Kernel 审查 P2-1、P2-3、P2-4）。均先写失败测试再改；临时库与 fake Host，未跑付费 CLI，未部署。

1. **撤权后冻结记忆不再重放（Codex P1-3）**：`withPresentedMemory` 每次返回冻结快照前重新检查成员资格、执行范围（频道或仍有效的私聊）与读开关；不可读时不返回 delta/刷新索引，并在冻结记录上标记 `withheld`。`applySentMemoryPresentation` 对带该标记的快照只登记 launch 声明，不推进 `through_seq`/`index_seq`/`delta_seq`，所以撤权期间未输出的变化在重新开启读取后仍会送达；撤权又恢复后再次呈现同一冻结快照（版本不变），该次回执照常登记。竞态限制：若 Host 已发送首次呈现的文本、之后才撤权并重取，回执不登记，后续会重复一次（宁重复不丢失）。测试：`channel-memory-index.test.ts` 频道与私聊各一条 present→关闭→重取→sent→重新开启，外加"送达前恢复读取"一条。
2. **唤醒上限通知不冻结无关回复（Kernel P2-1）**：选择"新鲜度判定排除系统通知"，不把通知挪进 Thread——链也可能在顶层超限，挪位置只能覆盖 Thread 情形。`freshness-hold-context.ts` 新增 `NOT_SYSTEM_NOTICE_SQL`（`actor_id = principal_system` 且事件带 `systemNotice`），用于冻结上下文的两条查询与 `#latestTargetMessageSeq`（`hasNewerTargetMessages` 同源）。通知仍留在频道和读取结果里。测试：`instance-wake-guard.test.ts` 在 Thread 内经 Worker 凭据触发超限，无关实例 delta 的顶层回复直接发出（修复前为 held，`newerMessages` 只有这条通知）。
3. **删除时清空早先原因（Kernel P2-3，负责人裁定）**：删除事务把该条目非 delete 修订的 `reason` 置空，只保留删除本身的原因；打开 Kernel 时 `clearDeletedMemoryDescriptions` 对已删除条目幂等清理旧的原因（未删除条目不动）。测试：`channel-memory.test.ts` 删除用例断言早先 6 版原因为空；`channel-memory-index.test.ts` 重开 Kernel 用例断言历史遗留原因被清理、未删除条目保留。
4. **线程计数测试不再空转（Kernel P2-4）**：`threadMention` 改为被唤醒实例租约 Activation 后经 Worker 执行凭据在 Thread 内发帖（原因 `mention`），并直接断言 `instance_wake_chain` 的行数与 streak：Thread 内 1–5、顶层 6–10、Thread 内第 11 次 `[11, 0]`，Thread 内 Human 回复后顶层下一次为 `[1, 1]`。产品代码未改（审查已确认产品行为正确）。

## 当前状态（2026-09-26，控制台批次 3 后）

本表取代原“已知缺陷”表，只记现在的状态；各节历史结论保留原样，证据以所引 commit 与证据文件为准。四列相互独立：
“已实现”不代表已验证，“已 fake 验证”不代表真实 CLI 验证，“已真实 CLI 验证”只指所列样本，不等于效率验收或部署验收。
原表中“平台协议升级到不了已续聊 session”一项已删除：第十五节“Protocol updated”行与协议版本、第十七节压缩后规则卡、
第二十五节第 6 项池持有的待确认状态已覆盖，其真实 CLI 验证情况见下表“会话协议与压缩”行。

| 能力                                      | 已实现                                                                                                                                                                                                                      | 已 fake 验证                                                         | 已真实 CLI 验证                                                                                                        | 未覆盖                                                                                                                                                                                                                                         |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role / Instance / 频道成员                | Role 修订、实例冻结快照、移除后不复活（第二、二十六节）                                                                                                                                                                     | Kernel/Worker 测试                                                   | 漂移门禁四家均以 Role 实例运行（见漂移结论与第二十二、二十三节）                                                       | 控制台可创建与修订 Role、实例化、移除、session reset（第四十五、四十六节，仅 fake 门禁验证）；远端 Host 明确拒绝运行 Role 实例（`RAH_INSTANCE_HOST_UNSUPPORTED`）                                                                              |
| 每轮效率（S1）                            | 用量入库、四家带正文唤醒、提示词减重、`--final` 收尾                                                                                                                                                                        | 是                                                                   | 仅 Codex `gpt-5.6-luna/low`：S1-e、S1-g、精简唤醒三次效率门禁，全组仍 over-budget（第一轮工作路径差异），续聊轮达标    | Claude/Kimi/OpenCode 效率门禁从未付费运行；`gpt-6-luna` 无效率证据；Kimi 用量 CLI 不提供（`unmeasured`）；业务路径差与压缩后趋势口径已按负责人 2026-09-25 裁定实现（第三十三节），尚无付费样本                                                 |
| Codex 常驻（默认开启）                    | S2-a/S2-b 与批次 1 修复                                                                                                                                                                                                     | 是                                                                   | 冷热对比（`gpt-5.6-luna`，常驻组不重启）；漂移 20 轮常驻（`gpt-6-luna`）                                               | 热模式取消、首轮中断、热模式 daemon 重启续聊均无真实证据（s2-spec §8 冒烟未满足）；默认开启后本地服务未验收                                                                                                                                    |
| OpenCode 冷 / 常驻（默认开启）            | S2-c3 与批次 1、3 修复                                                                                                                                                                                                      | 是                                                                   | 漂移 10 轮冷、热各一次（`deepseek-flash/low`）                                                                         | 原生效率对照未跑（批次 4 只补代码）；真实 abort 超时、子代理与溢出事件；默认开启后本地服务未验收                                                                                                                                               |
| Claude 冷 / 常驻（默认关闭）              | S2-c1、第二十一节与批次 3 修复                                                                                                                                                                                              | 是                                                                   | 仅 Haiku（无 effort）漂移 10 轮冷、热各一次                                                                            | Sonnet 无任何真实证据；效率门禁未跑；后台任务轮与唤醒真实竞态                                                                                                                                                                                  |
| Kimi 冷                                   | S2-c2 与批次 3 修复                                                                                                                                                                                                         | 是                                                                   | 漂移 20 轮冷两次（`k3-256k/low`，第二次修复后送达与 ACK 100%）                                                         | 效率门禁未跑；用量改从会话 wire 读取（第四十节），无真实 CLI 验证；Goal 围栏中模式固定已有真实免费探针，续聊 active goal 拒绝与 goal 工具拒绝只有 fake 验证，续聊检测依赖私有文件；门禁守卫曾拒绝模式请求致第 1 轮全部失败，已修（第二十九节） |
| 会话协议与压缩                            | 协议版本与“Protocol updated”行、压缩后规则卡、池持有待确认状态                                                                                                                                                              | 是                                                                   | Kimi 第二次漂移两次强制压缩后规则卡仍生效；Haiku 冷热、OpenCode 热压缩后无退化；Codex 压缩后格式率下降（见漂移结论表） | 协议升级行本身无真实触发样本                                                                                                                                                                                                                   |
| OpenCode 用户 MCP 隔离（第五十九节）      | 冷/热每次启动 `debug config --pure` 取名单、逐名关闭并以 `GET /mcp` 复核；Worker 工具门面已撤回（第五十七节保留为历史）                                                                                                     | 是（假 opencode）                                                    | 仅第五十七节免费探针：真实 `opencode serve` 下用户 MCP 为 `disabled`；无真实模型调用                                   | 撤回后的无条件路径无真实 CLI 运行；冷驱动每回合多约 1 s                                                                                                                                                                                        |
| 用量 / 上下文 / 压缩可见性                | 逐次用量入库；Codex 记上下文窗口与占用（其他 CLI 为空，不估算）；压缩次数记在 Host session 绑定                                                                                                                             | 是                                                                   | 效率/漂移证据中的产品用量（Kimi 除外）                                                                                 | 控制台展示每实例状态与用量汇总（第四十四节），RunAttempt 下钻显示冷/热、`sessionResumeMs`、上下文占用（仅 Codex 有值，其余“未知”）与用量（第四十六节，仅 fake 门禁）；压缩次数未展示                                                           |
| 用量汇总与 CLI 估算费用（第四十节）       | Kimi wire 逐次用量；Claude/OpenCode 自报费用入库（schema 73）；`usage.summary` 按实例/频道/时间窗口汇总并标覆盖率                                                                                                           | Kernel/驱动/假 CLI 测试；真实 Kimi wire 夹具                         | —                                                                                                                      | 真实 CLI 未验证；Claude 冷驱动本轮费用多为未知；Kimi 子 agent 用量不归属；控制台只读展示（第四十四节）                                                                                                                                         |
| 权限收口（第四十节）                      | 权限参数与三个环境键由 daemon 独占；Claude/Codex/OpenCode 以参数或会话规则禁用抢调度工具（OpenCode 旧会话续聊前安装并核验，第四十一节）；Kimi AskUserQuestion 跳过                                                          | 启动参数/请求体/假 ACP 测试                                          | —                                                                                                                      | Kimi PlanMode 无开关未禁用；真实 CLI 未验证                                                                                                                                                                                                    |
| 会话连续性                                | 不静默换 session：要求连续时停止并隔离，reset 后重新排队（第二十六节）；冷驱动接收即绑定                                                                                                                                    | 是                                                                   | 漂移样本中 session 不变                                                                                                | 真实首轮中断后的恢复；线程写入者占用仍按连续性失败隔离，需 Human reset                                                                                                                                                                         |
| 新实例首轮等待                            | 挂载发布按 30 s 刷新周期                                                                                                                                                                                                    | —                                                                    | —                                                                                                                      | 首轮约 30 s 等待未修                                                                                                                                                                                                                           |
| 付费门禁自身                              | 单一批准表、Codex 白名单围栏、Claude 斜杠命令与事后核对、漂移事后核对 fail-closed、证据来源字段（第二十八节）                                                                                                               | 门禁免费单测（已纳入 `npm run check`）                               | 批次 4 之后的门禁代码未付费运行                                                                                        | Claude result `modelUsage` 若含 CLI 后台其他模型族会判越权，是否出现未知；shim 选项白名单与原生 Codex 开关同步见第二十九节                                                                                                                     |
| S3 私聊                                   | 仅 Human 开、共享 session、忙时排队、不 steer、双向隔离（含提醒与 `dm:@` 读写）、`instancePrivateBox` 投影（第三十五节）                                                                                                    | Kernel 隔离/steer/游标/代数测试；Codex 冷、热 fake 共享 session 测试 | —                                                                                                                      | 真实 CLI 私聊轮未跑；控制台可打开、查看私聊并在私聊发消息，频道页看不到私聊内容（第四十六节，仅 fake 门禁）；推迟项见第三十五节第 4 项                                                                                                         |
| 频道工作区（第三十九节）                  | 新频道平台主目录与创建时附加目录（不可改）；四家原生/提示行附带；证据根与浏览根                                                                                                                                             | Kernel/Host/驱动假 CLI 测试；Kimi 免费假 API 探针                    | —                                                                                                                      | 真实 CLI 未验证；控制台可创建带附加目录的频道（第四十五节，fake 门禁），前端无入口；旧频道不补建主目录                                                                                                                                         |
| S4–S5                                     | 未开始                                                                                                                                                                                                                      | —                                                                    | —                                                                                                                      | fork、side                                                                                                                                                                                                                                     |
| S6 平台记忆（第四十八、五十一、五十二节） | 批次 A：Kernel 频道记忆存储、修订/失效/Human 删除、读写开关与成员覆盖、FTS 检索、Worker CLI 与 Human API；批次 B：Role 实例新 session 注入轻索引（3 KiB）、续轮增量、不再加载旧 MEMORY.md、Human 导入旧记忆、控制台记忆面板 | Kernel/应用服务/CLI/驱动组装/渲染测试；控制台 fake 门禁；§6 离线估算 | —                                                                                                                      | 真实 CLI 注入与压缩后行为、效率门禁实测；同 UID 可直读数据库（非强隔离）；批次 B 前的旧 session 仍含旧快照                                                                                                                                     |

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
