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

## 已知缺陷（待阶段 3 修复）

| 级别 | 问题                                                                                                                                                                                 | 位置                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| P1   | 平台运行协议升级（常驻提示词变化）到不了已续聊的原生 session（Kimi 确认），启动上下文却报告新版本；须区分 Role 快照（按合同冻结）、平台协议版本、原生 session 实际生效的 system 快照 | `kimi-acp-driver.mjs:297`、`worker-startup-context.ts:31` |
| P1   | 逐次 usage 已由 S1-a 记录（Kimi 无数据）；上下文窗口占用、压缩次数的记录与展示未做                                                                                                   | agent-host                                                |
| P2   | 线程写入者占用被当成永久错误隔离；远端 Host 的绑定证据、用量、带正文唤醒未接（Role 实例在远端被明确拒绝）                                                                            | driver / remote composition                               |
| P2   | 新实例首轮约 30 秒等待挂载发布（30 s 刷新周期）                                                                                                                                      | `runtime-offer-publisher.ts`                              |

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
- 测量问题：`preemptedFollowUp` 均报 false，但回复后生成数为 0、输入与单次生成一致，说明中断实际生效，该字段的判定需修正。

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
