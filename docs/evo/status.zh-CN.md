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

- `warmRuntimes.codex` 配置项，**默认关闭**，待真实冒烟与冷热对比通过后再决定是否默认开启。
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
- 常驻 OpenCode（`warmRuntimes.opencode`，默认关闭）：每实例一个长驻 serve + 持久 SSE；轮次边界取我们同步 `POST /message` 的响应（自动续写后的后续步骤 parent 是合成的 Continue 消息，不能用 parent 判定）；SSE 重连后按消息列表对账、不重发；拒绝忙时输入。
- Kimi 漂移复测（k3-256k/low 冷模式，96e1dd0，`docs/evo/evidence/2026-09-25-drift-kimi-cold-r2.json`）：20 轮送达 100%，每轮恰好一条回复、0 重试（第 9 轮不再重复），目标错投 0，无越权建任务，未出现应沉默时发言，`--final` 100%，ACK 100%；两次强制压缩后规则卡仍生效。门禁因格式率判为退化而失败：5 轮超出"≤40 字"，全部是答案本身含长标识符（第 1 轮在压缩前就已超长），属模型遵守度，不是规则遗忘。
- 待付费验证：abort 与下一次模型请求的真实时序、真实 SSE 顺序、压缩后规则进入续写步骤。

### 十九、第七轮审查修复

依据 Codex 第七轮独立审查（`~/.loom/reviews/2026-09-25-s2-c-review.md`），负责人裁定全部 P1、P2 采纳。每项先写复现测试并确认失败，再做最小实现；热模式默认值不变（仍关闭），未跑付费 CLI，未重启服务。

- P1-1 草稿回复意图两入口共用：`settleHeldDraftReplyIntent`（`held-message-drafts.ts`）成为 `--target` 路由与原始发帖路由共同调用的事务内步骤：被存为草稿（新鲜度 hold、再次 hold 或 thread 确认）时保存模型自己的 based-on 与 `--final`；提交时用该意图做 ACK 并记 final 标记。不同 Activation 的草稿不借出意图。两条路由的新鲜度围栏均未改：`--target` 重发以本 Agent 在该目标的已读位置为底线；原始路由的因果标记固定为 Activation head，出现更新消息时重发仍会再次 hold，须走既有的 `--anyway`（至少两次 hold 后）才提交，意图随再次 hold 保留。测试（`worker-reply-drift-duplicate.test.ts`）：originating→target（按恢复指导重发）、target→originating、originating→originating 各恰好一次提交、ACK 到 toSeq、final 标记记录（后两者经再次 hold + `--anyway`）；跨 Activation 不借用。
- P1-2 OpenCode 中断 fail-closed：`opencode-final-interrupt.js` 持久工具状态查询失败或返回非列表时有界重查一次，仍失败则放弃本次 abort 优化、等本轮自然结束（冷热共用）。测试：`opencode-final-interrupt.test.ts`（查询失败/格式不可信不 abort、重查成功才 abort）与 `opencode-server-driver.test.ts`（SSE 滞后 + GET 失败 + 发帖工具执行中 → 不发 abort）。
- P1-3 独立错误优先：Claude 与 OpenCode 热驱动收尾时 Host 停止优先，其次任何独立错误判 `failed` 并保留 `errorMessage`，最后才是 final 结束；只豁免本驱动自己的中断造成的取消结果（按输入记录中断请求）。Host 侧 `warmTurnDriverFailure`（`codex-warm-adapter.ts`）对任何状态下带错误文本的轮次都记失败，不判 success。测试：`claude-warm-driver-close.test.ts`（唤醒 final 成功但已接纳 notice 独立失败 → failed 且保留错误）、`opencode-warm-runtime.test.ts`（非 abort `session.error` 先到、随后 final abort → 不以 success 静默）、`warm-turn-classification.test.ts`。
- P1-4 效率门禁：`compareRounds`/`compareArm` 有任一 `unmeasured` 维度（productUsage/tokens/generations）时 `status` 为 `missing-evidence`，可测子项结论另见 `measuredStatus`；顶层 `gateStatus` 在此情况下给 `missing-evidence`（退出码 1），不再可能 `needs-quality-review`。`docs/design/cli-efficiency-gate.zh-CN.md` 第 47 与 84 行的矛盾按合同 §6 统一（用量缺口不判达标；wire.jsonl 替代产品用量无合同决定）。测试：`metrics.test.mjs`。
- P2-1 Claude 结束证明：已开始（lifecycle started 或回放）的输入只由自身 `result` 结算，终态生命周期先到不关闭本轮；未启动输入被 CLI 取消/丢弃/拒绝且非本驱动请求时记错误（本驱动中断取消的排队输入不算错）；有 `msg_lifecycle_v1` 时无 `user_message_uuid` 的 result 不猜归属，记错误。测试：`claude-warm-driver-close.test.ts`（顺序颠倒、顺序颠倒后失败、无 uuid、refused、回执取消）。
- P2-2 OpenCode abort 准入屏障：热驱动记录本轮每个 abort 请求，排空前等待全部得到 HTTP 应答（各自受 5 秒请求超时约束），下一轮因此不会在 abort 在途时开始；结果未知（超时、连接丢失）时，排空前在本运行时内停掉旧 `opencode serve`、启动新 serve 并按原 session 继续（session 不存在则 fatal，不静默替换），不重发 prompt；替换失败才 fatal。测试（fake 延迟/丢弃 abort）：`opencode-warm-runtime.test.ts` 两例。
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
  并在监听前核对合并配置中无 agent 固定到其他模型；每轮再读 `opencode.db` 做事后模型/variant 围栏。
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
- 未解决：真实付费复测未跑。热模式首轮为何走 cold 执行未查。有标记但未 ACK 的重试仍按运行失败信息记录 `last_error`，不会触发“上次已发 final”的重试提醒（行为与之前相同）。

## 已知缺陷（待阶段 3 修复）

| 级别 | 问题                                                                                                                                                                                 | 位置                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| P1   | 平台运行协议升级（常驻提示词变化）到不了已续聊的原生 session（Kimi 确认），启动上下文却报告新版本；须区分 Role 快照（按合同冻结）、平台协议版本、原生 session 实际生效的 system 快照 | `kimi-acp-driver.mjs:297`、`worker-startup-context.ts:31` |
| P1   | 逐次 usage 已由 S1-a 记录（Kimi 无数据）；上下文窗口占用、压缩次数的记录与展示未做                                                                                                   | agent-host                                                |
| P2   | 线程写入者占用被当成永久错误隔离；远端 Host 的绑定证据、用量、带正文唤醒未接（Role 实例在远端被明确拒绝）                                                                            | driver / remote composition                               |
| P2   | 新实例首轮约 30 秒等待挂载发布（30 s 刷新周期）                                                                                                                                      | `runtime-offer-publisher.ts`                              |

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
