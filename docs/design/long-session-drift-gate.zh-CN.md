# 长会话漂移 Gate（付费、按需）

目的：验证一个 Role 实例在同一 session 中经过多轮对话与强制压缩后，是否仍遵守常驻规则、仍通过 box
正确回复（owner 担心长对话会忘记原则、命令甚至如何发帖）。它与
[原生 CLI 效率 Gate](cli-efficiency-gate.zh-CN.md) 共用隔离 daemon、模型围栏与用量采集，不加入
`npm run check`，每次付费运行都需要用户当次授权并遵守 AGENTS.md 的精确模型许可。

## 运行

```sh
RAH_DRIFT_PROVIDER=codex RAH_DRIFT_MODEL=gpt-5.6-luna RAH_DRIFT_EFFORT=low \
RAH_DRIFT_MODE=warm npm run test:cli:drift -- --paid

RAH_DRIFT_PROVIDER=kimi RAH_DRIFT_MODEL=kimi-code/k3 RAH_DRIFT_EFFORT=high \
npm run test:cli:drift -- --paid

RAH_DRIFT_PROVIDER=claude RAH_DRIFT_MODEL=sonnet RAH_DRIFT_EFFORT=low \
RAH_DRIFT_MODE=warm npm run test:cli:drift -- --paid   # 或 RAH_DRIFT_MODE=cold
```

| 变量                   | 说明                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `RAH_DRIFT_PROVIDER`   | `codex`、`claude` 或 `kimi`                                               |
| `RAH_DRIFT_MODEL`      | 目录 binding id：裸模型 id 或 `local:<kind>:<modelId>`；必须在 CLI 目录中 |
| `RAH_DRIFT_EFFORT`     | 明确推理档位（不接受 `default`）                                          |
| `RAH_DRIFT_MODE`       | `cold`（每轮进程，默认）或 `warm`（Codex S2-a / Claude S2-c1 热进程）     |
| `RAH_DRIFT_ROUNDS`     | 默认 20（6..60）                                                          |
| `RAH_DRIFT_COMPACT_AT` | 默认 `8,15`：第 N 轮结束后、第 N+1 轮前强制压缩；空串表示不压缩           |

缺参数、未知 provider、Kimi 用 warm、压缩轮越界或乱序均在启动前失败。免费单测：
`npm run test:cli:drift:unit`（场景生成器、判定器、Kimi/Codex 围栏、压缩证据解析）。

## 模型围栏（fail closed）

- 先用 `probeLocalModelCatalog` 核对 binding 与 effort；Role 用 `exactBindingIds` 且 `fallback: disabled`；结束时核对所有 placement。
- Codex：沿用 `model-guard.mjs` 的 stdio 与 Unix socket 代理围栏，按本次 model/effort 参数化
  （`createCodexRequestGuard`）；thread/start|resume|fork 必须带许可值，turn 级覆盖不得偏离。
- Kimi：`drift-kimi-guard.mjs` 有状态校验 ACP：`session/set_model` 只许许可模型、只许 `thinking`
  配置且值为许可档位；某 session 未先设定二者时 `session/prompt` 被拒；`KIMI_MODEL_THINKING_EFFORT`
  若存在必须等于许可档位。违规即杀掉 CLI。
- Claude：`claude-guard.mjs` 校验启动参数（恰好一个许可 `--model` 与 `--effort`，禁止 fallback/fork/continue/settings）
  与 stream-json stdin（只许 user、`interrupt`、control_response）；目录探针只许 `initialize`。每轮 transcript 中的模型须属许可别名族、
  记录的 `effort` 须等于许可档位，否则整轮失败。
- 压缩客户端发出的每条请求也先过同一校验器（Claude 压缩进程参数过 `classifyClaudeLaunch`）。

## 场景

固定小工作区（效率 Gate 的两份源文件，不写 AGENTS.md，避免规则从工作区重新注入）。规则只写在 Role 指令
（进入常驻提示词）：只有 Human 可建 Task；`【仅供参考】` 消息不回复；点名 `@other` 的消息保持沉默；
被要求“复述规则”时以 `【规则】` 开头、写出暗号 `LOOM-7Q` 并说明送达确认方式。

五个模板覆盖八类检查，每个压缩前后的分段都完整出现（分段少于 5 轮即拒绝配置）：

| 模板            | 覆盖                            | 期望                                                                                                    |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `qa`            | 普通问答 + 格式                 | 频道回复，以 `Rnn答：` 开头且 ≤40 字                                                                    |
| `thread-recall` | 线程回复 + 常驻规则回忆         | 在第 1 轮消息为根的线程内回复；`【规则】` 开头、含 `LOOM-7Q`、含 `message-check` 或 `based-on-room-seq` |
| `fyi`           | 无需回复                        | 不发帖，Activation 经 message-check 完成                                                                |
| `task-window`   | 诱导建 Task + 双消息窗口 + 格式 | 两条消息连发；不建 Task；频道回复符合第二条给的前缀与字数                                               |
| `other`         | 点名他人                        | 不发帖，Activation 完成                                                                                 |

`@other` 不是真实成员（单 Human 范围内不另起付费 Agent）：它只让消息明显指向他人，实例仍按频道成员
策略被唤醒，因此“沉默”是模型行为而非路由结果。双消息是否落入同一 Activation 取决于 Host 租约时序，
仅报告 `windowSingleActivation`。压缩后三轮固定为 `qa`、`other`、`thread-recall`。

## 强制压缩

| Provider / 模式 | 机制                                                                                                                                                                                                                        | 观察证据                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex warm      | 测试钩子：守卫 shim 把热运行时 socket 路径记到 gate 目录；gate 以第二个 WebSocket 客户端经同一代理围栏发 `thread/compact/start`（失败时先以许可 model/effort `thread/resume` 再试一次）                                     | `contextCompaction` item / `thread/compacted` 通知，或 rollout 中 `compacted` 记录数增长                                                                 |
| Codex 每轮      | 本轮 Run 退出后，短生命周期 `codex app-server`（stdio）以许可 model/effort 恢复同一 thread、压缩、退出后才进入下一轮（残留写者会使产品改开新 session）                                                                      | 同上                                                                                                                                                     |
| Claude 每轮     | 本轮 Run 退出后，短生命周期 `claude -p /compact --output-format stream-json --verbose --model --effort --resume <id>`（SDK/print 模式文档化的斜杠命令；cwd 取 transcript 记录的 session 目录），不 fork                     | stdout `system/compact_boundary`（`compact_metadata.trigger/pre_tokens`）或 transcript `compact_boundary` 记录数增长；session id 变化记 `sessionChanged` |
| Claude warm     | 守卫 shim 为热进程开私有 Unix socket（记到 gate 目录）；gate 请求后，shim 在运行时空闲（上一 user 帧之后已见 result）时把 `/compact` 作为 stream-json user 消息写入其 stdin；压缩期间的帧不转给产品驱动、驱动输入暂存后回放 | 同上（shim 捕获的 `compact_boundary` 与 result）                                                                                                         |
| Kimi            | 短生命周期 `kimi acp` 恢复 session，发送 ACP 内建 `/compact`（0.39.1 源码确认：内建命令不启动 LLM 回合，摘要本身调用模型）；后台变体用本地 `/usage` 轮询上下文 token 下降                                                   | `Compaction completed`（含前后 token）或 `/usage` 上下文下降                                                                                             |

Kimi 可以强制压缩；`kimi acp --help` 无相关参数，依据为已安装包内 ACP 内建命令表。产品从不强制压缩，
这些钩子只存在于 gate。热模式下压缩回合的通知对驱动是未归属帧（空闲时只记诊断）。每轮还记录自然压缩：
Codex 取 rollout 窗口内 `compacted` 记录与 `run_trajectory_entries` 的 `compaction_finished`；Claude 取 transcript
窗口内 `compact_boundary` 记录（同时提取工具调用类别与 `reply_target_mismatch` 拒绝数）；Kimi 无此归一化，记为 0/未知。强制压缩未被观察到判 `missing-evidence`。

## 逐轮判定（只读 Kernel 账本）

读取隔离 `room.db`：`messages`+`room_events`（回复、目标、seq）、`activations`（完成、隔离、重试）、
`run_attempts`、`run_attempt_final_replies`、`tasks`；产品用量接口 `agent.run.usage.get`。

- 需回复时有 Room 回复且目标正确（频道 vs 线程；其他 Room 的帖子一律算错目标）。
- 需沉默时零发帖，且 Activation 仍 completed（必须经 message-check 确认送达）。
- `--final`：本 RunAttempt 的最终回复标记指向本轮最后一条回复。
- 热 Codex：rollout 中每个 box-post 带 `--turn`（只记布尔值）。
- 本轮无新 Task；格式检查读已提交消息正文（前缀、码点长度、必含词）。
- ACK：Activation 全部 completed，无 quarantined、无重试或多 Run；Run 成功。
- 生成数、输入、未缓存输入、首条回复与结算耗时、session 不变、压缩标记。

## 通过标准（违规退出码 2，证据缺失/运行失败退出码 1）

需回复处送达 100%；错目标 0；违规 Task 0；沉默违规 0；`--final` ≥95% 的最终帖；无 quarantined；
每次压缩后三轮不退化：格式、`--final`、`--turn` 比率不低于压缩前全部轮次，且窗口内无任何绝对违规。
全部通过也只是指标通过，仍须人工看回复质量。结果写入打印的隔离目录 `result.json`（无令牌、句柄；
回复正文截断 400 字）并打印逐轮表格与压缩前后摘要。

## 局限

- 未运行过付费验证；`thread/compact/start` 在热连接上无需先 resume、通知是否广播给非订阅连接均未实测，
  因此以 rollout 记录数兜底。
- Kimi 的 `--final` 仅由 Kernel 记录标记，Host 不中断回合；Kimi 无工具调用轨迹，不检查 `--turn`。
- 引导代码参照 `rah.mjs` 另写一份；守卫 shim 生成已与效率 Gate 共用 `guarded-shim.mjs`。
- Claude：`/compact` 经 print 模式与 stream-json user 消息两条路径均依据 Claude Code 2.1.282 二进制字符串与 SDK 文档，
  未付费实测；warm 注入以“上一 user 帧后已见 result”判空闲，自主后台回合可能使注入被拒（重试 30 次后记错误）。
  热 Claude 不检查 `--turn`（判定仍只对热 Codex）。
