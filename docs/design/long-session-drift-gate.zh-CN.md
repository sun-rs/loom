# 长会话漂移 Gate（付费、按需）

目的：验证一个 Role 实例在同一 session 中经过多轮对话与强制压缩后，是否仍遵守常驻规则、仍通过 box
正确回复（owner 担心长对话会忘记原则、命令甚至如何发帖）。它与
[原生 CLI 效率 Gate](cli-efficiency-gate.zh-CN.md) 共用隔离 daemon、模型围栏与用量采集，不加入
`npm run check`（其免费单测在 check 内），每次付费运行都需要用户当次授权。模型许可只有一份机器核对来源
`scripts/cli-efficiency/approved-models.mjs`（与 AGENTS.md 授权表同步）：表外 provider/模型/effort 组合在配置解析时、
任何进程启动前失败；Fable、GPT-5.6 Ultra 与任何 `max`/`ultra` 档永不放行。

## 运行

```sh
# 当前批准模型（2026-09-25，示例与已提交证据一致）
RAH_DRIFT_PROVIDER=codex RAH_DRIFT_MODEL=gpt-6-luna RAH_DRIFT_EFFORT=low \
RAH_DRIFT_MODE=warm npm run test:cli:drift -- --paid

RAH_DRIFT_PROVIDER=kimi RAH_DRIFT_MODEL=kimi-code/k3-256k RAH_DRIFT_EFFORT=low \
npm run test:cli:drift -- --paid

RAH_DRIFT_PROVIDER=claude RAH_DRIFT_MODEL=haiku RAH_DRIFT_EFFORT=none \
RAH_DRIFT_MODE=cold RAH_DRIFT_ROUNDS=10 RAH_DRIFT_COMPACT_AT=5 npm run test:cli:drift -- --paid   # 或 warm

RAH_DRIFT_PROVIDER=opencode RAH_DRIFT_MODEL=deepseek/deepseek-flash RAH_DRIFT_EFFORT=low \
RAH_DRIFT_MODE=warm RAH_DRIFT_ROUNDS=10 RAH_DRIFT_COMPACT_AT=5 npm run test:cli:drift -- --paid
```

批准组合见 AGENTS.md 授权表（2026-09-09 矩阵：Claude `sonnet/low`、Codex `gpt-5.6-luna/low`、OpenCode
`deepseek/deepseek-v4-flash/low`、Kimi `kimi-code/k3/high`；2026-09-25 追加：Codex `gpt-6-luna/low`、Kimi
`kimi-code/k3-256k/low`、Claude `haiku`/无 effort、OpenCode `deepseek/deepseek-flash/low`）。OpenCode 目录已不再发布
`deepseek/deepseek-v4-flash`，该行仍在表内但会在目录核对处（付费调用前）失败。

| 变量                      | 说明                                                                            |
| ------------------------- | ------------------------------------------------------------------------------- |
| `RAH_DRIFT_PROVIDER`      | `codex`、`claude`、`kimi` 或 `opencode`                                         |
| `RAH_DRIFT_MODEL`         | 目录 binding id：裸模型 id 或 `local:<kind>:<modelId>`；须在批准表与 CLI 目录中 |
| `RAH_DRIFT_EFFORT`        | 明确推理档位（不接受 `default`）；`none` 只许且必须用于 Claude `haiku`          |
| `RAH_DRIFT_MODE`          | `cold`（每轮进程，默认）或 `warm`（Codex/Claude/OpenCode 热进程）               |
| `RAH_DRIFT_ROUNDS`        | 默认 20（6..60）                                                                |
| `RAH_DRIFT_COMPACT_AT`    | 默认 `8,15`：第 N 轮结束后、第 N+1 轮前强制压缩；空串表示不压缩                 |
| `RAH_DRIFT_OVERHEAD_RISE` | 压缩后开销上升阈值，默认 `0.25`（+25%），取值 (0, 10]                           |

缺参数、未知 provider、表外组合、Kimi 用 warm、压缩轮越界或乱序、Haiku 带 effort 或非 Haiku 用 `none`、OpenCode
模型不是 `provider/model` 均在启动前失败（binding 与 effort 解析与效率 Gate 共用 `efficiency-config.mjs`）。`none` 时目录探针还须确认该 binding 不发布任何 effort 档位。免费单测：
`npm run test:cli:drift:unit`（场景生成器、判定器、Kimi/Codex/Claude/OpenCode 围栏、压缩证据解析、OpenCode
守卫代理端到端假 CLI 测试）。

## 模型围栏（fail closed）

- 先用 `probeLocalModelCatalog` 核对 binding 与 effort；Role 用 `exactBindingIds` 且 `fallback: disabled`；结束时核对所有 placement。
- Codex：沿用 `model-guard.mjs` 的 stdio 与 Unix socket 代理围栏，按本次 model/effort 参数化
  （`createCodexRequestGuard`）。围栏是白名单：只放行产品驱动与压缩客户端实际发送的 `initialize`/`initialized`、
  `thread/start|resume`、`thread/compact/start`、`turn/start|steer|interrupt` 及对服务端请求的响应，参数逐键限定
  （`config` 只许产品的 memory/multi_agent/goals 开关为 false 与许可 effort；`approvalPolicy` 只许 `never`；
  `approvalsReviewer`、`serviceTier`、非文本输入等一律拒绝）；thread/start|resume 必须带许可值，turn 级覆盖不得偏离。
  启动参数只许 `--version`、`debug models [--bundled]` 与带产品 `-c <开关>=false`、单个 `--listen` 的 `app-server`
  （`debug app-server send-message-v2`、`app-server daemon|proxy`、`exec` 等一律拒绝）。
- Kimi：`drift-kimi-guard.mjs` 有状态校验 ACP：`session/set_model` 只许许可模型、只许 `thinking`
  配置且值为许可档位；某 session 未先设定二者时 `session/prompt` 被拒；`KIMI_MODEL_THINKING_EFFORT`
  若存在必须等于许可档位。违规即杀掉 CLI。
- Claude：`claude-guard.mjs` 校验启动参数（恰好一个许可 `--model` 与 `--effort`，禁止 fallback/fork/continue/settings）
  与 stream-json stdin（只许 user、`interrupt`、control_response；user 正文以 `/` 开头的斜杠命令如 `/model`、`/effort`、
  `/fast` 一律拒绝，只有 gate 自己注入的 `/compact` 放行）；目录探针只许 `initialize`。转发后，shim 检查每个 assistant 帧
  （含子 agent 的 `parent_tool_use_id` 帧）与每个 result 帧 `modelUsage` 的全部模型键，任一不属许可别名族即记违规
  （`<shim>.violations.jsonl`，每轮检查，存在即整轮失败）并关闭 CLI。每轮 transcript（含 `<session>/subagents/*.jsonl`
  子 agent 记录）中的模型须属许可别名族、记录的 `effort` 须等于许可档位，否则整轮失败。
- Claude Haiku（`RAH_DRIFT_EFFORT=none`）：批准值为 `effort: null`，启动须恰好一个 `--model haiku` 且零个
  `--effort`（含 `--effort=`）；Role 以 `reasoning: default` 创建，产品按 binding 不传 effort（冷
  `runtime-implementation-registry.ts`、热 `codex-warm-adapter.ts` + `claude-warm-driver.mjs` 均已如此，新增
  两条免费产品测试覆盖）；transcript 中出现任何 effort 记录即判越权；placement 须无 reasoning。
- OpenCode：`drift-opencode-guard.mjs`。两个产品驱动都启动 `serve --pure --hostname 127.0.0.1 --port N`；守卫 shim
  把真实 serve 放到另一回环端口，自己监听 N 做 fail-closed 代理：`POST /session/:id/message|prompt_async` 必须
  恰好带许可 `model`（providerID/modelID）与 `variant`，禁止 agent 覆盖和 subtask/agent 部件；`POST
/session/:id/summarize` 只许许可模型；建 session、abort、permission/question 回复不得带模型字段；建 session
  必须带非空、非默认（`New/Child session - …`）标题，避免 OpenCode 首条用户消息时经 small model 自动生成标题；其余一切
  非 GET 请求（command、shell、init、fork、config、tui 等）拒绝。违规回 403 并关闭 CLI。真实 serve 的配置内容把
  `model` 与 `small_model` 覆盖为许可模型；代理开始监听前读合并后的 `GET /config`：`model`/`small_model` 不等于许可值、
  任何 agent 固定到其他模型或 variant、除 compaction 覆盖外任何 agent 带 reasoning `options`，即拒绝启动。每轮结束后读
  OpenCode 自己的 `opencode.db`（本 session 及其子 session 本轮窗口内的 assistant 消息）做事后围栏：模型与 `variant`
  必须等于许可值。CLI 只允许 `--version`、`models [--verbose] [--pure]`（目录探针）与上述 serve。
- fail-closed 的范围（第八轮审查 P2-1）：只覆盖产品驱动经 HTTP 发出的请求。OpenCode 自己发起的内部模型调用（标题、
  摘要、子 agent、插件）只能靠上面的固定配置约束，small model 调用因此使用许可模型但不带 variant；其他内部路径未逐一
  证明。事后 transcript 围栏只能在付费调用发生后检出越权，不能阻止；标题调用不产生 assistant 消息，事后围栏看不到。
- 压缩客户端发出的每条请求也先过同一校验器（Claude 压缩进程参数过 `classifyClaudeLaunch`）。
- 事后模型核对（每轮、每家）：Claude 读 transcript（含子 agent 文件），OpenCode 读 `opencode.db`，Codex 读 rollout
  窗口内 `turn_context`（模型与 effort 逐条等于许可值），Kimi 读 session wire 窗口内 `llm.request`（`modelAlias` 与
  `thinkingEffort`）。越权即整轮失败；数据源读取失败、无 native session 或窗口内没有任何模型记录一律判
  `modelEvidenceMissing`（证据缺失，gate 状态 `missing-evidence`），不再静默通过。

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
| OpenCode 每轮   | 本轮 Run 退出后，短生命周期 `opencode serve`（cwd 取 `opencode.db` 记录的 session 目录）接收原生 `POST /session/:id/summarize {providerID, modelID}`，完成后关闭                                                            | 该请求之后新建的 `summary: true`、`mode: compaction` assistant 已完成且无错误（记录模型、variant、tokens）；其模型不是许可值即判越权                     |
| OpenCode warm   | 守卫 shim 开私有 Unix socket（记到 gate 目录）；gate 请求后，shim 在无在途 prompt 时向热 serve 发同一 summarize；期间该 session 的 SSE 事件不转给产品驱动（否则驱动会中止"无人发起"的运行），驱动新 prompt 暂存到结束后     | 同上                                                                                                                                                     |

OpenCode 压缩入口依据：本机 1.18.32 serve 的 `/doc` 显示 `session.summarize` 请求体只有
`providerID`、`modelID`、`auto`（`additionalProperties: false`，无 variant）；源码（1.18.21 checkout，与 1.18.32 二进制
字符串一致）`SessionCompaction.process` 用 compaction agent 的模型（未配置则用该消息模型），请求选项按
`base → model.options → agent.options → variant` 合并，而手动压缩消息无 variant。因此 gate 把许可档位对应的
variant 选项（取自 CLI 自己的 `opencode models <provider> --verbose`，如 `{reasoningEffort: "low"}`）注入为
`agent.compaction.options`（冷：gate 的短生命周期 serve；热：守卫 shim 启动真实 serve 时），并在 `GET /config`
中核对已生效；自动压缩本就继承上一条用户消息的 variant，结果不变。
Kimi 可以强制压缩；`kimi acp --help` 无相关参数，依据为已安装包内 ACP 内建命令表。产品从不强制压缩，
这些钩子只存在于 gate。热模式下压缩回合的通知对驱动是未归属帧（空闲时只记诊断）。每轮还记录自然压缩：
Codex 取 rollout 窗口内 `compacted` 记录与 `run_trajectory_entries` 的 `compaction_finished`；Claude 取 transcript
窗口内 `compact_boundary` 记录（同时提取工具调用类别与 `reply_target_mismatch` 拒绝数）；OpenCode 取 `opencode.db`
窗口内 compaction assistant 数（不提取工具调用类别，`--turn` 与拒绝数为未知）；Kimi 无此归一化，记为 0/未知。
强制压缩未被观察到判 `missing-evidence`。OpenCode 用量走产品已有的 `step-finish` 归一化（`agent.run.usage.get`），
缺失时按既有规则判 `missing-evidence`。

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
- 协议调用数 `checks.protocolCalls`：Worker CLI 调用与读 `MEMORY.md`（分类见 `tool-calls.mjs`，与效率门禁共用），参数缺失无法判定的调用
  保守计入；`checks.toolCalls` 另记按类别与种类计数；未采集工具调用（Kimi、OpenCode）为 null，不记为 0。

## 压缩后开销趋势（负责人 2026-09-25 裁定 B）

担心多次压缩后平台开销（重注入的规则、协议调用）逐次累积。`summarizeCompactionOverhead` 以首次压缩前窗口（第 1 轮至首个压缩轮）为基线，
每次压缩后到下一次压缩（或末轮）为一个窗口，对每个窗口报告每轮平均输入、未缓存输入、生成数、协议调用数，相对基线的比值 `ratio` 与相对
上一窗口的逐次变化 `step`。任一压缩后窗口的平均输入或平均协议调用相对基线升高超过阈值（默认 +25%，`RAH_DRIFT_OVERHEAD_RISE` 可调；
恰好等于阈值不算）、或协议调用从基线 0 变为正数，即标 `compactionOverheadRising`；未缓存输入与生成数只报告。结果在
`summary.compactionOverhead`（`status`: `stable`/`rising`/`insufficient-data`/`no-compaction`），并作为 `noDegradation` 的独立子项：
`summary.degradation = {behavior, compactionOverhead}`，任一为 false 即 `noDegradation` 为 false、gate `violated`。缺用量的窗口为
`insufficient-data`：不判上升，也不证明平稳。终端逐窗口打印均值、比值与逐次变化。
局限：基线窗口含全部题型，压缩后窗口题型构成不同（压缩后三轮固定为 `qa`、`other`、`thread-recall`），窗口长度也不同；上下文随轮数自然增长，
比值只反映窗口均值，需结合逐轮表人工判读。尚无付费样本。

## 通过标准（违规退出码 2，证据缺失/运行失败退出码 1）

需回复处送达 100%；错目标 0；违规 Task 0；沉默违规 0；`--final` ≥95% 的最终帖；无 quarantined；
每次压缩后三轮不退化：格式、`--final`、`--turn` 比率不低于压缩前全部轮次，且窗口内无任何绝对违规；压缩后开销不上升（见上节，
`noDegradation` 的独立子项）。
全部通过也只是指标通过，仍须人工看回复质量。结果写入打印的隔离目录 `result.json`（无令牌、句柄；
回复正文截断 400 字）并打印逐轮表格与压缩前后摘要。证据记录被测代码 `codeCommit`（HEAD）与 `workingTree`
（`git status --porcelain` 含未跟踪文件的摘要与 `git diff HEAD` 摘要），题目源文件快照另记 `sourceRef`；同目录另写
`result.redacted.json`（临时根目录换成 `<tmp>`、home 换成 `~`），其 `rawResultSha256` 为原始 `result.json` 的 sha256，
提交证据时用脱敏文件并可据此对照原始输出。2026-09-25 之前提交的证据只有旧字段 `commit`（漂移为 HEAD）与
`workingTreeDiffSha256`（不含未跟踪文件）。

## 局限

- 已有 7 份付费证据（`docs/evo/evidence/2026-09-25-drift-*.json`，结论见 status 漂移结论表与第十三、十八、二十二、
  二十三节）：Codex warm（`gpt-6-luna/low`，20 轮）、Kimi cold 两次（`k3-256k/low`，20 轮）、Claude Haiku cold/warm
  与 OpenCode cold/warm（10 轮，第 5 轮后压缩）。这些证据由批次 4 之前的代码产生：当时没有 Codex/Kimi 事后模型核对，
  也没有“无模型记录判证据缺失”，但提交证据中无读取错误、工具调用与 OpenCode assistant 记录非空，说明当次核对确实执行。
  Claude Sonnet、Codex 每轮模式与 OpenCode/Claude 20 轮尚无漂移证据。
- `thread/compact/start` 在热连接上无需先 resume、通知是否广播给非订阅连接未单独实测，因此仍以 rollout 记录数兜底。
- Kimi 的 `--final` 仅由 Kernel 记录标记，Host 不中断回合；Kimi 无工具调用轨迹，不检查 `--turn`。
- 引导代码（隔离 daemon、shim、每轮/热开关、API）与效率 Gate 共用 `gate-daemon.mjs`。
- Claude：warm 注入以“上一 user 帧后已见 result”判空闲，自主后台回合可能使注入被拒（重试 30 次后记错误）。
  热 Claude 不检查 `--turn`（判定仍只对热 Codex）。Haiku 冷/热冒烟的 effort 围栏均未触发（status 第二十二节，Claude Code 2.1.282），即该版本 transcript 窗口内没有 effort 记录，围栏无需放宽。
  result `modelUsage` 核对若遇到 Claude Code 自己的后台小模型调用（其他模型族）会判违规；目前的 Haiku 证据未出现，
  Sonnet 运行是否出现未知，出现时需负责人决定是否批准该后台模型，gate 不自行放宽。
- Codex 事后核对依赖 rollout `turn_context` 的 `model`/`effort` 字段；Kimi 依赖 wire `llm.request` 记录。二者均为
  CLI 私有格式，版本变化导致缺字段时判证据缺失，而不是通过。
- OpenCode 热压缩的 SSE 隐藏按 session id 过滤；OpenCode 手动压缩不带 variant，gate 靠注入 compaction agent 选项
  保持许可档位，压缩 assistant 的 `variant` 字段因此仍为空（证据如实记录）。
