# 原生 CLI 对照：阶段效率 Gate

这是用户要求的必备阶段门禁，适用于旧 Agent 与频道 Role 实例两种模式。
在调度、上下文投递、提示词、记忆传输或 session 管理累计完成一批修改后执行，
以及相关版本交付前执行。小型 UI、文案或无关修正不逐次付费重测。
付费运行不加入默认 `npm run check`（门禁的免费单测 `test:cli:efficiency:unit` 在 check 内）；每次付费运行仍需当次用户授权。
模型许可的唯一机器核对来源是 `scripts/cli-efficiency/approved-models.mjs`（与 AGENTS.md 授权表同步）：表外
provider/模型/effort 组合在配置解析时、任何进程启动前失败，shim 也只为表内组合生成；Fable、GPT-5.6 Ultra 与任何
`max`/`ultra` 档永不放行。

## 首个可执行范围

```sh
npm run test:cli:efficiency -- --paid
```

首版（2026-09-23 基线）是 Codex `gpt-5.6-luna / low`：原生 CLI、新建旧 Agent、频道 Role 实例三组；
2026-09-25 批次 4 起默认模型为 `gpt-6-luna / low`，默认组追加 `role-warm`（产品默认的 Codex 常驻路径）。
旧 Agent 组使用初始化但从未运行过的 Agent，配置精确模型后才发问，避免把创建后的自动入职流程混入三轮题目。
各组新 session 开始并复用三轮，RAH 第三轮前平滑重启隔离 daemon；
原生 CLI 每轮退出进程、下一轮恢复同 session（比只重开浏览器更严格）。
原生使用 `codex exec --json`，RAH 使用产品现行 app-server 适配器；
这项入口差异属于实际平台开销，但结果不能独自证明差异均来自调度。

固定 Git 提交的两份真实网络重启源/测试文件，三组内容哈希和 AGENTS.md 一致，
Role 显式选现有 mount；旧 Agent 将相同文件准备到实际私有 cwd，避免目录不一致。三轮依次是限定审查、质疑并修正、
重启后结论与测试标准；不改文件、记忆，不建 Task。模型回答须人工审查证据与连续性。
各组串行避免本 gate 竞争账号，Codex 默认顺序 native/legacy/role/role-warm；用
`RAH_EFFICIENCY_ORDER=role,native,legacy` 在未来独立样本轮换顺序，
不丢弃失败样本、不为了好看重复跑。`RAH_EFFICIENCY_REF` 可指定固定源版本（题目快照）。
用户其他应用仍可能使用同一账号，缓存冷热无法完全控制，单次时间不作统计显著性结论。

## 多 Provider（`RAH_EFFICIENCY_PROVIDER`，合同 §6“各运行时对照自身原生 CLI”）

```sh
npm run test:cli:efficiency -- --paid                                    # codex：native,legacy,role,role-warm
RAH_EFFICIENCY_PROVIDER=claude npm run test:cli:efficiency -- --paid     # native,role,role-warm
RAH_EFFICIENCY_PROVIDER=kimi npm run test:cli:efficiency -- --paid       # native,role
RAH_EFFICIENCY_PROVIDER=opencode npm run test:cli:efficiency -- --paid   # native,role,role-warm
```

`RAH_EFFICIENCY_MODEL`（裸 id 或 `local:<kind>:<id>`，不得属于其他 CLI）/ `RAH_EFFICIENCY_EFFORT` 覆盖默认值；
默认为 2026-09-25 批准的当前模型：Codex `gpt-6-luna/low`、Claude `haiku`（目录不发布 effort，`RAH_EFFICIENCY_EFFORT`
缺省即 `none`，启动与 Role 均不带 effort）、Kimi `kimi-code/k3-256k/low`、OpenCode `deepseek/deepseek-flash/low`；
2026-09-09 矩阵（Claude `sonnet/low`、Codex `gpt-5.6-luna/low`、Kimi `kimi-code/k3/high`）用覆盖变量选择。
其他组合启动前失败。`RAH_EFFICIENCY_ORDER` 只接受该 provider 支持的组：Kimi 无 `role-warm`（`RAH_EFFICIENCY_WARM=1`
启动前即失败），OpenCode 无 `legacy`。配置解析见 `efficiency-config.mjs`（binding/effort 解析与漂移门禁共用），单测覆盖。
指令文件用各 CLI 原生读取的文件：Codex/Kimi/OpenCode 写 `AGENTS.md`，Claude 写 `CLAUDE.md`（两组都原生读取，RAH 组另有
Role 指令，与 Codex 口径相同）。

| Provider | 原生组                                                                                                                                                                                                                         | RAH 组                                                                         | 用量来源与可判定项                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Claude   | `claude -p <题> --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions --model --effort`，第 2 轮起 `--resume <id>`（不 fork），每轮新进程                                            | `role`（每轮）与 `role-warm`（隔离 daemon 打开 `warmRuntimes.claude.enabled`） | 两侧都用产品同一 `ClaudeStreamUsageTracker`（stream_event 按 message id，一次生成一条，输入 = 未缓存 + 缓存写 + 缓存读）：原生取自身 stdout，RAH 取产品入库生成记录（`observedAt` 切分回复前/后）。session transcript 按 message id 去重独立复核生成数/输入/缓存（RAH 不一致即 `usageEvidenceMismatch`；原生只报告）。全部 §6 预算照常判定                                                                                                                                                 |
| Kimi     | `kimi -p <题> --output-format stream-json -m <model>`，第 2 轮起 `--session <id>`（id 取自 `session.resume_hint`），`KIMI_MODEL_THINKING_EFFORT=<effort>`，每轮新进程                                                          | `role`（每轮 ACP）                                                             | print 模式与产品 ACP 驱动都不给用量；两侧同取 session wire `agents/main/wire.jsonl`：`step.end` 按 `messageId` 一次生成一条（输入 = inputOther + 缓存读 + 缓存写），`llm.request` 的 `modelAlias`/`thinkingEffort` 事后核对。产品用量恒为 `unavailable`，记为 `unmeasured: productUsage`；wire 缺失时 tokens/生成数也记为 `unmeasured`，不编造数字。只要有 `unmeasured` 维度，总结论即 `missing-evidence`（合同 §6：用量缺口不判达标），回复耗时与送达只作为 `measuredStatus` 子项单独展示 |
| OpenCode | `opencode run --pure --format json --auto -m <model> --variant <effort>`，第 1 轮 `--title`（避免内部标题生成调用），第 2 轮起 `--session <id>`，`OPENCODE_CONFIG_CONTENT` 把 `model`/`small_model` 固定为许可模型，每轮新进程 | `role`（每轮 serve）与 `role-warm`（产品默认常驻）                             | 两侧用产品同一 `openCodeStepFinishUsage`（每个 step-finish part 一条，输入 = input + 缓存读 + 缓存写，输出含推理）：原生取自身 JSON 事件，RAH 取产品入库生成记录。事后读 `opencode.db`（本 session 树本轮窗口内的 assistant）核对模型与 variant，零条即失败；RAH 组工具调用类别取自 db 的 tool part。RAH 组暂无独立的 token 交叉复核（db step-finish 未与产品记录比对），全部 §6 预算照常判定                                                                                              |

模型围栏（fail closed）：

- Codex RAH 组 shim（`model-guard.mjs`）：JSON-RPC 方法与参数白名单（只放行产品实际发送的请求，详见
  [漂移门禁](long-session-drift-gate.zh-CN.md)“模型围栏”），argv 只许 `--version`、`debug models [--bundled]` 与产品形式的
  `app-server`；原生组 `codex exec` 参数固定许可值；事后 rollout `turn_context` 逐条核对模型与 effort。
- Claude RAH 组 shim（`claude-guard.mjs`）：可跑模型回合的启动必须恰好一个 `--model` 与一个 `--effort` 且等于许可值
  （`haiku` 须零个 `--effort`）；禁止 `--fallback-model`、`--fork-session`、`--continue`、`--settings`、`--agents`；stdin 只许
  user、`interrupt` 控制请求与 control_response（`set_model`/`set_max_thinking_tokens`/`apply_flag_settings` 等一律拒绝并杀进程），
  user 正文以 `/` 开头的斜杠命令（`/model`、`/effort`、`/fast` 等）拒绝。转发后检查 assistant 帧（含子 agent）与 result
  `modelUsage` 的全部模型键，越权记入 `<shim>.violations.jsonl` 并杀进程，每轮检查、存在即该组失败。
  产品模型目录探针（`--tools "" --no-session-persistence`、无模型参数）只许 `initialize`，不许 user 帧。
  原生组参数经同一 `classifyClaudeLaunch` 校验；事后 stream 中主链、子 agent 与 result `modelUsage` 的每个模型，
  以及 transcript（含 `<session>/subagents/*.jsonl`）中每个模型须属于许可别名族（`sonnet` 只匹配 `claude-sonnet-*`），
  transcript 记录的 `effort` 必须等于许可档位，窗口内无模型记录即失败。
- OpenCode RAH 组沿用 `drift-opencode-guard.mjs` HTTP 代理围栏；原生组启动前 `checkOpenCodeNativeLaunch`（仅 `run`、恰好一个
  许可 `-m` 与 `--variant`、配置固定 `model`/`small_model`，禁止 `--fork/--continue/--agent/--command/--attach` 等）。
- Kimi RAH 组沿用 `drift-kimi-guard.mjs` ACP 有状态围栏；原生组启动前 `checkKimiPrintLaunch`（仅 print 模式、恰好一个许可 `-m`、
  思考环境变量等于许可档位、禁止 `--continue/--agent/--plan` 等），事后 wire 中每个 `llm.request` 的别名与思考档位须等于许可值；
  wire 缺失时 `modelEvidence: launch-guard-only`。

局限：Claude/Kimi/OpenCode 效率门禁均未付费运行（Codex 见 status 效率节）。Kimi print 模式下 `llm.request.thinkingEffort` 是否反映环境变量覆盖未实测（若只反映 config 默认，
不一致会使门禁失败而非放行）；Kimi 子 agent 的 wire 不计入。Claude 子 agent（sidechain）生成：产品按
`parent_tool_use_id` 计入、transcript 复核的用量不计入（模型仍核对），若出现会表现为复核不一致；result `modelUsage`
若含 Claude Code 自己的后台小模型（其他模型族）会判越权，是否出现未经付费实测。Claude warm 组仍套用
`warmExecutionFailures`（含每个 box-post 带 `--turn`），真实 Claude 是否按轮带句柄待首跑确认。OpenCode 原生组使用
`opencode run` 内置服务，RAH 组使用 `serve` + HTTP 驱动，入口差异属于平台开销；`--format json` 事件格式依据
1.18.32 二进制内嵌源码，未付费实测；缺失的维度按既有规则记 `missing-evidence`。

## 指标和裁决

每轮记录：发送到有效回复时间、RAH 进入 Run 前等待、实际 session ID、原生模型和 effort、
模型生成次数（`generationsBeforeReply`/`generationsAfterReply`/`generationsTotal`；`generations` 兼容保留为总数。RAH 以有效 Room 回复落库时刻切分：发出该 message-post 的那次生成计入回复前，之后的生成计入回复后；原生组最终答案那次生成即回复，全部计入回复前；比较结果另报 `extraProtocolGenerations` = RAH 总数 − 原生总数）、首次请求/最大请求输入、累计输入、缓存/未缓存输入、输出和推理子集、
Worker check/post 与其他工具调用的类别。原生原始轨迹只作诊断，RAH 成功以持久 Room 最终答案为准。共享题目要求“审查结论：”前缀且正文至少 80 字符；只收到进度确认不算成功，仍需人工核对实质质量。
按唯一 `response_id` 汇总原生 usage，禁止把累计会话 usage 相加；推理已含在输出中。
RAH 门禁执行文件使用仅供测试的 stdio 模型围栏：thread/start、resume 在转发前必须显式指定许可模型和 effort，白名单外的方法、参数与子命令一律拒绝；其他初始化 Agent 也不能绕过。原生组通过明确 CLI 参数指定许可模型，并事后核对原生轨迹。
缺用量、换 session、模型不符、失败或额外 Run 均不算通过；不能靠少读代码降低成本。

预算采用 owner 2026-09-24 修订后的 [evo 目标合同](../evo/target-contract.zh-CN.md) 第 6 节（数值集中在 `metrics.mjs` 的 `budgets`）：

- 业务路径差（负责人 2026-09-25 裁定 A，`tool-calls.mjs`）：工具调用分三类。协议 = Worker CLI 调用（`message-post`、`message-check`、
  Task 命令、`worker help` 等其他 `worker <命令>`）与读 `MEMORY.md`；业务 = 其他可识别调用（读文件、搜索等）；`unknown` = 参数缺失无法判定，
  RAH 侧保守计为协议并在 `notes` 标 `toolCategoryUnknown`。原生侧没有 Worker CLI，全部调用按业务计。
  `workPathExtraGenerations` = RAH 业务调用数 − 原生业务调用数（带符号：RAH 少做业务时为负，不能借此掩盖协议生成）；
  回复前版本 `workPathExtraGenerationsBeforeReply` 只计 `replyAt` 之前的 RAH 业务调用（`workPath.businessToolCallsBeforeReply.basis`
  为 `reply-time`；缺时间戳时退回整轮 `whole-round`）。任一侧没有工具调用证据时不抵扣，标 `workPathUnavailable`。
  原始差 `extraGenerations`/`extraGenerationsBeforeReply`、业务差、`workPath.toolCalls`（按类别与种类计数）全部写入证据，终端逐轮打印一行
  （`formatComparisonRound`）。
- 协议额外生成（整轮）：`extraProtocolGenerations` = (RAH 整轮生成数 − 原生整轮生成数) − 业务路径差 ≤ 1；不设绝对总数上限。
- 回复前额外生成：`extraProtocolGenerationsBeforeReply` = (RAH 回复前生成数 − 原生整轮生成数) − 回复前业务路径差 ≤ 0；回复切分未知即
  `generationsBeforeReplyMissing`。例：原生一次 `nl` 读完即答（2 次），RAH `sed` 读后又 `nl` 重读再发帖（3 次）：原始差 +1、业务差 +1、
  协议差 0，不超预算但照常报告；RAH 读一次、多一次 `message-check` 再发帖：业务差 0、协议差 +1，超预算。
- 固定开销（`fixedOverhead`，按组判一次）：新 session 第 1 轮第 1 次生成的输入，RAH − 原生 ≤ 3,000 token；任一侧缺数据即 `fixedOverheadMissing`。续聊轮的首请求只报告、不设预算，但仍须两侧都有（缺即 `firstInputMissing`），供分解使用。
- 每轮残留（`perRoundResidue`，只报告）：相邻两个续聊轮之间的上下文增长（后一轮首请求 − 前一轮首请求）之差，RAH − 原生。
- 业务差异（`workPathVariance`，只报告）：逐轮业务工具调用数（除 box-post 外）与生成数之差；第 1→2 轮上下文增长之差单列为 `round1HistoryDelta`，它同时含第 1 轮工作路径与第 1 轮协议历史，仅凭用量无法再拆，不计入固定开销，也不据此放宽固定开销上限。
- 单轮总输入：判定值 `input.judged` = RAH 总输入 − `input.workPath` 不超过 2 × (原生同轮总输入 + 3,000)，`input.workPath` = 业务路径差 ×
  原生首请求（合同 §6 第 64 行：工作路径不同属业务差异，不计入平台开销；无工具证据时为 null、不抵扣）。原始总输入 `input.raw` 与
  `inputRatio` 照常报告，`inputRatioJudged` 另报。每轮附 `inputDecomposition`，把总输入差精确分解为 G_rah × 固定开销 + G_rah × `round1HistoryDelta` + G_rah × 累计残留 + (G_rah − G_原生) × 原生首请求 + 轮内增长之差（G 为整轮生成数），其中第四项再拆为 `workPathGenerations`（业务差 × 原生首请求）与 `protocolGenerations`；超预算时 runner 打印该分解。
  局限：业务差按工具调用数计，一次生成内并行的多个业务调用会多抵扣（种类计数写入证据供人工核对）；重读输出在后续生成中的累积仍算在 RAH 侧；
  `round1HistoryDelta` 中的工作路径部分仍无法拆出。未缓存输入比值只作诊断报告，不计入预算失败（合同第 6 节未签此项）。
- 额外回复耗时不超过 max(5 秒, 原生同轮耗时 × 15%)：短任务按秒计，长任务按百分比计。
- 用量证据：RAH 组须有产品入库用量（`agent.run.usage.get`）且 `completeness` 为 `complete`；`partial`/`unavailable` 或缺失即 `usageEvidenceMissing`。两者都有时，将产品入库的生成数、输入、缓存、输出与原生轨迹推导的 RAH 用量交叉核对，不一致即 `usageEvidenceMismatch`。证据类失败判 `missing-evidence`，不能判预算内。Kimi 这类 CLI 不提供的维度记为 `unmeasured` 而不记为失败项，但总结论同样是 `missing-evidence`（`compareRounds`/`compareArm`/`gateStatus`），可测子项（耗时、送达）的结论另见 `measuredStatus`；以 wire.jsonl 替代产品用量尚无合同决定，不据此判达标。

- Kernel 重试轮（`retried`，`round-retry.mjs`）：同一问题出现多于一个 RunAttempt 时，只有全部尝试结束后恰好一条回复、目标正确、为 `final` 回复、ACK 完成且无隔离，才记为软项 `retried`：用量与生成数按该轮全部尝试求和（Codex 轨迹按每个尝试一个 turn 核对），该轮固定记失败项 `retried`（超预算，不因汇总后恰好在预算内而判达标），组结果单列 `retriedRounds`，后续轮照常运行。重复回复、无回复、final 缺失、ACK 未完成、隔离、错投或任一尝试运行失败仍是硬失败。与漂移门禁 `retried → violated` 口径一致。

超预算返回退出码 2，运行失败或 `missing-evidence` 返回 1。所有指标在预算内也只是 `needs-quality-review`，
还必须人工确认源文件范围、证据准确性、前后连续和输出质量；不自动冒称 parity。
不得因当前失败临时放宽。对每一项超额解释固定平台成本、重复输入、额外工具轮次及提供商等待。

## S2-a 热进程对照（Role 实例，Codex）

`role-warm` 组与 `role`（每轮冷启动）组使用同一 Role 配置，只在隔离 gate daemon 的配置中打开
`warmRuntimes.codex.enabled`（2026-09-25 起产品默认开启 Codex 与 OpenCode 常驻，gate 的每轮组显式写 `codex/opencode.enabled: false`，热组只打开被测 CLI）。批次 4 起 Codex 默认组序已含 `role-warm`（此前需 `RAH_EFFICIENCY_WARM=1` 追加，该变量仍兼容）；
也可显式指定 `RAH_EFFICIENCY_ORDER=native,role,role-warm`（必须含 `native`、不得重复）。

```sh
RAH_EFFICIENCY_ORDER=native,role,role-warm npm run test:cli:efficiency -- --paid
```

- 每轮从产品用量接口记录 `execution`（`mode`、`sessionResumeMs`、`lateFrameCount`、`instanceRuntimeId`）；
  每轮模式的 `role` 组为 `null`。热进程轮次以 `turn_quiesced` 证明结束、无退出码，按 `exited` 判成功。
- S2-b：用量接口另有顶层 `sessionResumeMs`（冷热两条路径都记：`thread/resume` 请求发出到响应的耗时，
  与热驱动 ready 时的口径一致；未恢复 session 或未测到为 `null`）。门禁每轮记入 `round.sessionResumeMs`，
  `warmVsCold` 的冷组恢复耗时取自它，因此每轮模式的大 session 冷恢复成本不再只能靠探针单测。
- `role-warm` 断言：第 1 轮 `cold`，第 2–3 轮 `warm` 且同一 `instanceRuntimeId`、该参与者只有 1 条
  `instance_runtimes` 记录、原生 thread 不变；Room 有效回复落库，且轨迹中每个 box-post 都带 `--turn`
  （只记布尔值，不记句柄）。违反即 `arm.warmFailures` 非空、该组失败。
- 默认 `role-warm` 第 3 轮前**不重启** daemon（重启必然回收热进程）；`RAH_EFFICIENCY_WARM_RESTART=1`
  保留重启，此时第 3 轮须为带 `sessionResumeMs` 的冷恢复，运行时记录为 2 条。
- 模型围栏：热驱动走 `--listen unix://`（Unix socket 上的 WebSocket），gate shim 占用驱动的 socket 路径、
  真实 CLI 改用同目录 `u.sock`，逐条校验客户端文本消息后原样转发；压缩扩展帧、二进制帧或违规请求直接断开。
- 合同 §6 预算不变，`role` 与 `role-warm` 各自对原生组判定。`result.warmVsCold` 另报逐轮回复耗时、
  排队、总输入、生成数、恢复耗时（热 − 冷），以及 `coldResumeCostAvoided`：只对实际为 `warm` 的续聊轮
  求和冷 − 热。它是整轮差（恢复、进程启动与工作路径波动合计），不是单独的恢复测量；
  热组中实测的冷恢复单列为 `measuredColdResumeMs`。

恢复耗时与 session 形态的关系用免费探针记录（不起 turn、不调模型；勿对正在被其他进程驱动的 thread 运行）：

```sh
node scripts/cli-efficiency/resume-probe.mjs --thread <thread-id> --repeat 3 [--json]
```

它每次新起 `codex app-server`（stdio JSON-RPC），计时 `initialize` 与 `thread/resume`，报告 rollout 文件字节数、
行数，并比较探测前后文件是否被修改。

### S2-a 真实 Codex 冒烟须观察的项（需另行授权，未运行）

依据 S2-a 独立审查（2026-09-24）的建议。冒烟只证明所列观察，不等于性能验收或正式启用；当时热模式默认关闭（2026-09-25 起 Codex/OpenCode 默认开启，见 status 第二十四节，效率验收仍未通过）。

1. **按轮句柄**：第一轮真实 Worker 命令是否带 `--turn`；模型是否沿用常驻提示词的旧命令而出现
   `TURN_HANDLE_REQUIRED`。核对 scope 对应的频道/私聊、post 的因果 seq 与正文接受 SHA，不能只看有回复。
2. **原生时序**：`turn/start` 请求字段、响应与早到通知的真实顺序；item/usage 是否带可归属的 turn id；
   `turn/completed` 之后是否常规还有 usage 帧（若是，"每轮必完整"的门禁会失败，须按证据收尾，不静默忽略；
   这类帧现记为该轮证据不完整）。握手与首帧同包的情况已排队交付，仍需实测。
3. **首轮中断**：新实例首轮取消，以及首轮执行中崩溃后，均恢复同一原生 thread（绑定已在首轮输入前持久化）；
   不得先成功一轮再测，以免掩盖首次绑定问题。
4. **三轮同进程**：同 PID/thread 完成三轮，逐轮新句柄；旧后台脚本只能用旧句柄；频道→私聊→频道不自动换权。
   记录显式 Worker 失败以及是否造成额外模型轮次。
5. **终止证明**：取消超时必须"证明已死才恢复"，发送信号不算证据；进程 close、DB 记录、quiesce、finish、
   complete 各故障点分别验证。杀不掉时运行时应保持 suspect 并阻止新执行。
6. **会话连续**：同 id thread 卸载后恢复、冷重启续聊、模型/effort 变更确实进入实际 turn；
   不把新 session 带来的收益记为热进程改善。
7. **压缩重述**：观察真实 compaction 事件格式与句柄重述（`turn/steer`）成功率，不为测试强行灌大上下文。

断线目前按致命错误回收，不做在线 `thread/turns/list` 对账；这是比规格更保守的本期范围。

## 最终回复收尾（`--final`，仅报告不设预算）

模型用 `message-post --final` 发出完成回复后，Kernel 在同一事务记录该 RunAttempt 的最终回复标记（schema 67，
不是 ACK），Host 读到后由驱动在下一个工具边界发原生 `turn/interrupt`，省掉工具结果回灌后只说"已发送"的整轮生成。
Codex 每轮与热进程两条路径已接；Claude 由 S2-c1 接入（原生 `interrupt` 控制请求）；Kimi/OpenCode 未接，行为不变。

- 用量接口 `finalInterrupt`：`null` 表示本轮没有 `--final` 回复；否则 `{committedRoomSeq, sent, preemptedFollowUp}`。
  `sent` 为驱动确认已发出中断（被拒绝或未上报为 false，此时本轮按原行为多一次生成）；`preemptedFollowUp`
  按证据判定（S2-b 修正，此前真实运行即使回复后生成数为 0 也总报 false）：最终回复的工具结束后观察到模型输出、
  新的工具调用，或用量帧使线程累计用量超过已观察到的全部生成 → false；原样重复的用量帧不是生成，
  工具结束后到达的第一个前进用量帧若对应尚未结算的上一次生成（发帖那次调用）也不算后续生成；
  窗口内用量帧无法解析 → `unknown`；中断未发出 → `unknown`；其余 → true。
- `compareRounds` 每轮输出 `finalInterrupt`（未采集为 `null`）；`compareArm` 汇总
  `committed/sent/preempted/notPreempted/unknown/noFinalPost/evidenceMissing`。只报告，不进入失败判定；
  生成数预算仍按 usage 计。
- 局限：`preemptedFollowUp` 的用量归属按"每次生成恰好一条前进用量帧"推断，未经真实 Codex 帧序验证；
  中断落地与后续请求发出的先后在真实 CLI 上须用付费门禁实测。

## 证据与后续范围

证据写入打印的隔离目录 `result.json`，包含失败轮次，不包含账户凭证或完整工具输出。批次 4 起证据分别记录被测代码
`codeCommit`（HEAD）与 `workingTree`（`git status --porcelain` 含未跟踪文件的摘要、`git diff HEAD` 摘要、变更与未跟踪数），
题目快照另记 `sourceRef`（`RAH_EFFICIENCY_REF`，默认 HEAD）；同目录写 `result.redacted.json`（临时根换 `<tmp>`、home 换 `~`），
其 `rawResultSha256` 为原始 `result.json` 的 sha256，提交证据用脱敏文件。此前提交的四份效率证据的 `commit` 字段是题目
快照（均为 main 里程碑 `5122795`），不是被测代码版本；它们测的是各自阶段的 evo 代码，单看文件无法确定具体版本。
原生 session 文件保留于 CLI 自己的目录，只提取用量和必要诊断摘要；正式频道与正式库不动。
不同付费 Provider 必须各自和其原生 CLI 比，不能以 Codex 通过代替 Claude/Kimi/OpenCode。
Claude/Kimi/OpenCode 已有各自原生对照臂代码（见上文“多 Provider”，均未付费运行）；长期压缩、忙时消息与多频道串行压力是后续场景，不伪称覆盖。
当前私聊排队业务验收继续使用独立纵向证据，不把有意排队时间混入本 gate 的纯续聊对照。

门禁脚本与用量汇总由 `scripts/cli-efficiency/` 所有；不新增产品队列或上下文状态。
确定性汇总/预算测试可免费随批执行：`npm run test:cli:efficiency:unit`。

首次执行结果与基线数字见 [evo 现状](../evo/status.zh-CN.md)的"效率基线"一节。
