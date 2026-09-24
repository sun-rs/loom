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

## 已知缺陷（待阶段 3 修复）

| 级别 | 问题                                                                                                                                                                                 | 位置                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| P1   | 平台运行协议升级（常驻提示词变化）到不了已续聊的原生 session（Kimi 确认），启动上下文却报告新版本；须区分 Role 快照（按合同冻结）、平台协议版本、原生 session 实际生效的 system 快照 | `kimi-acp-driver.mjs:297`、`worker-startup-context.ts:31` |
| P1   | 逐次 usage 已由 S1-a 记录（Kimi 无数据）；上下文窗口占用、压缩次数的记录与展示未做                                                                                                   | agent-host                                                |
| P2   | 线程写入者占用被当成永久错误隔离；远端 Host 的绑定证据、用量、带正文唤醒未接（Role 实例在远端被明确拒绝）                                                                            | driver / remote composition                               |
| P2   | 新实例首轮约 30 秒等待挂载发布（30 s 刷新周期）                                                                                                                                      | `runtime-offer-publisher.ts`                              |

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
