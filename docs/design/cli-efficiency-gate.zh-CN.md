# 原生 CLI 对照：阶段效率 Gate

这是用户要求的必备阶段门禁，适用于旧 Agent 与频道 Role 实例两种模式。
在调度、上下文投递、提示词、记忆传输或 session 管理累计完成一批修改后执行，
以及相关版本交付前执行。小型 UI、文案或无关修正不逐次付费重测。
付费运行不加入默认 `npm run check`（门禁的免费单测 `test:cli:efficiency:unit` 在 check 内）；每次付费运行仍需当次用户授权。
模型许可的唯一机器核对来源是 `scripts/cli-efficiency/approved-models.mjs`（与 AGENTS.md 授权表同步）：表外
provider/模型/effort 组合在配置解析时、任何进程启动前失败，shim 也只为表内组合生成；Fable、GPT-5.6 Ultra 与任何
`max`/`ultra` 档永不放行。

## 固定成本基线与官方记忆关闭（2026-10-04）

先运行 `RAH_EFFICIENCY_ORDER=native,role-warm npm run test:cli:efficiency -- --plan` 免费检查实验身份；它只读取本地代码、配置与 CLI 版本，不启动模型回合。`--paid` 仍须本批用户授权。

默认题目快照固定为 P97 的 `4b8e7e5897e024fbe17dc08fbcf5beb556e5ee6b`，不随被测 HEAD 变化。`scripts/cli-efficiency/baseline.mjs` 固定题目、业务指令和源文件内容哈希；修改题目或指令须显式更新 workload 版本。`RAH_EFFICIENCY_REF` 可用于探索不同源码；内容变化产生不同 baselineId，同字节的不同提交保持同一身份。

baselineId 还包含模型绑定、effort、CLI 版本、原生调用参数形态、记忆及启动策略、组顺序与重启条件；被测代码版本和本次 sampleId 另记，不能改变分母。指标实现和预算摘要另记 evaluationProfile。每次比值必须绑定本批完整原生三轮的 pairedNativeEvidence，不能使用历史样本分母。每组运行后再次核对 CLI 版本、源文件与业务指令；身份变化时保留原始消耗，但不输出可比结论。相同 baselineId 不证明服务端模型版本、缓存冷热或回答质量相同；人工语义验收仍必需。

原生对照关闭官方自动记忆，首次启动和每次 resume 都在模型回合启动前检查实际参数或环境，并在 round.nativeMemoryPolicy 中记录白名单证据：Codex 强制 `features.memories=false`、`memories.generate_memories=false`、`memories.use_memories=false`；Claude 强制 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`。这些关闭设置此前已来自共享启动策略，本批新增强制核验与逐轮证据，不能据此断言旧样本曾开启记忆。正常同 session 对话上下文仍保留；这不是文件系统隔离，也不会抹除已进入上下文的内容。

Codex、Claude 使用已核验的显式关闭机制。Kimi 0.39.1 与 OpenCode 1.18.32 经[精确版本装配链审计](../audits/2026-10-04-native-memory-version-audit.zh-CN.md)，原生自动记忆记为 `not-applicable`，不伪称 `enforced`；其他版本在任一付费臂之前拒绝，每次原生 spawn 再核对实际 executable 版本。OpenCode 必须保持产品同款 `--pure` 与指令来源隔离环境。用户插件、规则文件、连续 session 历史不是本审计宣称关闭的官方自动记忆，既有文件隔离局限保留。

Claude 原生组复用产品的 connection-only 解析器，只读取连接和模型 alias 白名单，不执行 `apiKeyHelper`、不启用用户 hooks 或行为配置，也不修改账号。显式连接环境优先，凭据不与另一来源的 endpoint 混配；baseline 只记解析策略标识，不记 key／URL。规划及每次原生启动前检查所选 alias 属于许可模型族，不匹配就在付费前拒绝，不能静默换模型或删除 alias 绕过配置。

OpenCode 原生 `run` 优先读取 `PWD`。原生模型进程及配置预检均须令 `cwd` 与子进程 `PWD` 指向同一临时题目工作区，不能继承仓库根目录的 `PWD`；进程正常退出不证明加载了相同指令。P103 曾加载仓库目录，其成本比率保留为观测，不能用于公平预算验收。修复后的免费 loopback 探针只验证实际 prompt 加载临时 AGENTS，新的效率结论仍需公平同题、独立授权的新批次。

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
Role 显式选现有 mount。三轮依次是限定审查、质疑并修正、
重启后结论与测试标准；不改文件、记忆，不建 Task。模型回答须人工审查证据与连续性。
各组串行避免本 gate 竞争账号，Codex 默认顺序 native/role/role-warm；用
`RAH_EFFICIENCY_ORDER=role,native` 在未来独立样本轮换顺序，
不丢弃失败样本、不为了好看重复跑。`RAH_EFFICIENCY_REF` 可指定固定源版本（题目快照）。
用户其他应用仍可能使用同一账号，缓存冷热无法完全控制，单次时间不作统计显著性结论。

## 多 Provider（`RAH_EFFICIENCY_PROVIDER`，合同 §6“各运行时对照自身原生 CLI”）

```sh
npm run test:cli:efficiency -- --paid                                    # codex：native,role,role-warm
RAH_EFFICIENCY_PROVIDER=claude npm run test:cli:efficiency -- --paid     # native,role,role-warm
RAH_EFFICIENCY_PROVIDER=kimi npm run test:cli:efficiency -- --paid       # native,role
RAH_EFFICIENCY_PROVIDER=opencode npm run test:cli:efficiency -- --paid   # native,role,role-warm
```

`RAH_EFFICIENCY_MODEL`（裸 id 或 `local:<kind>:<id>`，不得属于其他 CLI）/ `RAH_EFFICIENCY_EFFORT` 覆盖默认值；
默认为 2026-09-25 批准的当前模型：Codex `gpt-6-luna/low`、Claude `haiku`（目录不发布 effort，`RAH_EFFICIENCY_EFFORT`
缺省即 `none`，启动与 Role 均不带 effort）、Kimi `kimi-code/k3-256k/low`、OpenCode `deepseek/deepseek-flash/low`；
2026-09-09 矩阵（Claude `sonnet/low`、Codex `gpt-5.6-luna/low`、Kimi `kimi-code/k3/high`）用覆盖变量选择。
其他组合启动前失败。`RAH_EFFICIENCY_ORDER` 只接受该 provider 支持的组：Kimi 无 `role-warm`（`RAH_EFFICIENCY_WARM=1`
启动前即失败）。旧 persona Agent 的 `legacy` 组已删除（合同 §2，owner 2026-09-27），历史证据保留在 `docs/evo/evidence`。配置解析见 `efficiency-config.mjs`（binding/effort 解析与漂移门禁共用），单测覆盖。
指令文件用各 CLI 原生读取的文件：Codex/Kimi/OpenCode 写 `AGENTS.md`，Claude 写 `CLAUDE.md`（两组都原生读取，RAH 组另有
Role 指令，与 Codex 口径相同）。

| Provider | 原生组                                                                                                                                                                                                                         | RAH 组                                                                         | 用量来源与可判定项                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | `claude -p <题> --output-format stream-json --verbose --include-partial-messages --dangerously-skip-permissions --model --effort`，第 2 轮起 `--resume <id>`（不 fork），每轮新进程                                            | `role`（每轮）与 `role-warm`（隔离 daemon 打开 `warmRuntimes.claude.enabled`） | 两侧都用产品同一 `ClaudeStreamUsageTracker`（stream_event 按 message id，一次生成一条，输入 = 未缓存 + 缓存写 + 缓存读）：原生取自身 stdout，RAH 取产品入库生成记录（`observedAt` 是用量观察时间，回复前/后按下述时序证据裁决）。session transcript 按 message id 去重独立复核生成数/输入/缓存（RAH 不一致即 `usageEvidenceMismatch`；原生只报告）。全部 §6 预算照常判定                                                                                                                                                                    |
| Kimi     | `kimi -p <题> --output-format stream-json -m <model>`，第 2 轮起 `--session <id>`（id 取自 `session.resume_hint`），`KIMI_MODEL_THINKING_EFFORT=<effort>`，每轮新进程                                                          | `role`（每轮 ACP）                                                             | print 模式与 ACP 协议本身都不给用量；两侧同取 session wire `agents/main/wire.jsonl`：`step.end` 按 `messageId` 一次生成一条（输入 = inputOther + 缓存读 + 缓存写），`llm.request` 的 `modelAlias`/`thinkingEffort` 事后核对。产品自 evo §40 起由 Kimi 驱动读取同一 wire 逐次入库用量，门禁把 Kimi 产品用量设为必需（`productUsage: required`，全面审查 2 B-P1-2）：不完整或缺失即 `usageEvidenceMissing`，完整时与 wire 推导的 RAH 用量交叉核对；wire 缺失时 tokens/生成数按证据缺失处理（如 `fixedOverheadMissing`），不编造数字，也不豁免 |
| OpenCode | `opencode run --pure --format json --auto -m <model> --variant <effort>`，第 1 轮 `--title`（避免内部标题生成调用），第 2 轮起 `--session <id>`，`OPENCODE_CONFIG_CONTENT` 把 `model`/`small_model` 固定为许可模型，每轮新进程 | `role`（每轮 serve）与 `role-warm`（产品默认常驻）                             | 两侧用产品同一 `openCodeStepFinishUsage`（每个 step-finish part 一条，输入 = input + 缓存读 + 缓存写，输出含推理）：原生取自身 JSON 事件，RAH 取产品入库生成记录。事后读 `opencode.db`（本 session 树本轮窗口内的 assistant）核对模型与 variant，零条即失败；RAH 组工具调用类别取自 db 的 tool part。RAH 组暂无独立的 token 交叉复核（db step-finish 未与产品记录比对），全部 §6 预算照常判定                                                                                                                                               |

模型围栏（fail closed）：

- Codex RAH 组 shim（`model-guard.mjs`）：JSON-RPC 方法与参数白名单（只放行产品实际发送的请求，详见
  [漂移门禁](long-session-drift-gate.zh-CN.md)“模型围栏”），argv 只许 `--version`、`debug models [--bundled]` 与产品形式的
  `app-server`；内部 `loom_worker` MCP 只接受 `codexWorkerMcpConfig` 生成的完整配置组，固定 Node executable、仓库入口、环境变量名与 `omit_tools_from=["deferred"]`，缺项、重复项、其他服务器启用、URL 和直接携带 secret 的配置均拒绝。只新增带非空 `threadId` 且 `serverName="loom_worker"` 的 `mcpServerStatus/list` 只读请求；不放行 MCP reload、工具调用或通用配置写入。原生组 `codex exec` 参数固定许可值；事后 rollout `turn_context` 逐条核对模型与 effort。
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

局限：四家效率门禁均已付费运行，运行、提交与结论见 [付费运行台账](../evo/paid-runs.zh-CN.md)（全面审查 2 之后修正的门禁代码尚未付费运行）。Kimi print 模式下 `llm.request.thinkingEffort` 是否反映环境变量覆盖未实测（若只反映 config 默认，
不一致会使门禁失败而非放行）；Kimi 子 agent 的 wire 不计入。Claude 子 agent（sidechain）生成：产品按
`parent_tool_use_id` 计入、transcript 复核的用量不计入（模型仍核对），若出现会表现为复核不一致；result `modelUsage`
若含 Claude Code 自己的后台小模型（其他模型族）会判越权；已有 Haiku 付费运行未出现越权记录，Sonnet 未运行。Claude warm 组套用
`warmExecutionFailures`（含每个 box-post 带 `--turn`），2026-09-25/27 两次 Haiku 付费运行的 role-warm 组均未触发该失败。OpenCode 原生组使用
`opencode run` 内置服务，RAH 组使用 `serve` + HTTP 驱动，入口差异属于平台开销；`--format json` 事件格式依据
1.18.32 二进制内嵌源码，已在 OpenCode 效率门禁付费运行中使用（台账）；缺失的维度按既有规则记 `missing-evidence`。

## 内部 Worker MCP 的成本归类（2026-10-04）

效率与漂移门禁共用 `tool-calls.mjs`。直接调用内部 `mcp__loom_worker__loom_reply`，或 Codex 外层代码单元中出现该保留工具符号，均归为 `worker-mcp-reply` 协议开销。含业务操作的混合单元也整体保守归协议，不能把回复成本作为业务工作抵扣；引用或字符串中的同名符号可能保守高估，不拆算 token，也不声称统计了全部内层调用。总输入、缓存、生成次数仍取原有实际用量，不因归类改变。

该分类是成本诊断，不证明工具执行成功、身份绑定、发帖、ACK 或 final；MCP 不伪造 CLI 的 `--turn` 证据。 CLI 轮次证据独立保留：直接 CLI 命令不会因为正文出现 MCP 符号而略过检查；外层代码单元存在 CLI 样式文本而无法确定命令归属时，warm／drift 门禁明确按证据不足失败，既不借 MCP 正文中的 `--turn`，也不把歧义当作未发生 CLI 调用。成功业务动作仍以 Worker／Kernel 记录和原 Run 围栏为准。分类修复使用已保存的免费 CLI 样本验证，没有新增付费样本，P97 失败结论保持。

## 指标和裁决

每轮记录：发送到有效回复时间、RAH 进入 Run 前等待、实际 session ID、原生模型和 effort、
模型生成次数（`generationsBeforeReply`/`generationsAfterReply`/`generationsTotal`；`generations` 兼容保留为总数。RAH 以有效 Room 回复落库时刻切分：发出该 message-post 的那次生成计入回复前，之后的生成计入回复后；原生组最终答案那次生成即回复，全部计入回复前；比较结果另报 `extraProtocolGenerations` = RAH 总数 − 原生总数）、首次请求/最大请求输入、累计输入、缓存/未缓存输入、输出和推理子集、
Worker check/post 与其他工具调用的类别。原生原始轨迹只作诊断，RAH 成功以持久 Room 最终答案为准。共享题目要求“审查结论：”前缀且正文至少 80 字符；只收到进度确认不算成功，仍需人工核对实质质量。
按唯一 `response_id` 汇总原生 usage，禁止把累计会话 usage 相加；推理已含在输出中。
RAH 门禁执行文件使用仅供测试的 stdio 模型围栏：thread/start、resume 在转发前必须显式指定许可模型和 effort，白名单外的方法、参数与子命令一律拒绝；其他初始化 Agent 也不能绕过。原生组通过明确 CLI 参数指定许可模型，并事后核对原生轨迹。
缺用量、换 session、模型不符、失败或额外 Run 均不算通过；不能靠少读代码降低成本。

生成开始与 usage 观察时间不能混同。Codex `token_usage_record.timestamp`、其他 provider 的 `observedAt` 可能晚于发帖工具提交；早于回复的完成记录能证明该生成在回复前，晚到记录不能证明它属于回复后。Kimi 仅在同 agent、同 `turnStep` 的唯一 `llm.request` 与 begin/end UUID、顺序均匹配时采用原生请求时刻；缺失或重试歧义不靠相邻记录猜配。OpenCode 通过产品 responseId 对应的 step-finish part，关联同 session/message 的唯一 step-start：message.created 与 step-start 构成开始下／上界，回复落在两界之间仍未知。Claude 当前缺少同等开始关联时使用完成记录的保守界限，不将晚 usage 直接划为回复后。

Kimi 另核对原生请求覆盖：同 agent／turnStep 的唯一 `llm.request` 必须关联带 messageId 和 usage 的 `step.end`。`requestCoverage` 分别记录请求数、已匹配数、未报告请求与未匹配用量；请求次数不冒充生成用量记录。已知中断请求无 usage 时，保留已有 token 数值但追加既有 `usageEvidenceMissing`；原生覆盖不完整不能作为分母，产品已记录完整的 usage 也不能掩盖此缺口。未知用量不记零，亦不估算账单。

精确切分不足时，`generationsBeforeReply`／`generationsAfterReply` 保持 `null`，`replyTimingEvidence` 记录已知前、已知后及未定数。`beforeReplyBudgetEvidence` 用这些上下界判断原预算：最坏上界仍达标才证明通过，最好下界也超限则失败，横跨预算则 `generationsBeforeReplyMissing`。未定时间的业务调用不能提供回复前上界的正抵扣；已证明的业务时间差与可能的原生业务负抵扣仍保留。上下界裁决不补造精确数字、不改变 token 总量或预算，也不把 Host 的 `preemptedFollowUp` 当作未发模型请求的证明。

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
- 回复前额外生成：`extraProtocolGenerationsBeforeReply` = (RAH 回复前生成数 − 原生整轮生成数) − 回复前业务路径差 ≤ 0；回复切分未知且上下界仍不能裁决时为
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
- 用量证据：RAH 组须有产品入库用量（`agent.run.usage.get`）且 `completeness` 为 `complete`；`partial`/`unavailable` 或缺失即 `usageEvidenceMissing`。两者都有时，将产品入库的生成数、输入、缓存、输出与原生轨迹推导的 RAH 用量交叉核对，不一致即 `usageEvidenceMismatch`。证据类失败判 `missing-evidence`，不能判预算内。四家的产品用量现在都是必需项（Kimi 由驱动读取 session wire 入库，evo §40；全面审查 2 B-P1-2 撤销了门禁对 Kimi 的“不记录”豁免），没有 provider 再以 `unmeasured: productUsage` 豁免；`unmeasured` 机制（`unmeasuredDimensions`，`compareRounds`/`compareArm`/`gateStatus`）只保留给今后确实无法采集的维度，出现即总结论 `missing-evidence`，可测子项（耗时、送达）的结论另见 `measuredStatus`。

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

## 预热首轮与冷首轮（owner 2026-09-27）

产品默认在实例创建时预热常驻运行时（合同 §6a）。gate daemon 在自己的运行时设置里默认关闭预热，
所以 `role`、`role-warm` 与漂移门禁仍测冷首轮与重启冷恢复。opt-in 组 `role-prewarm`（Codex、Claude、OpenCode）
打开预热：创建实例后等到空闲运行时行（无轮次、无 RunAttempt）并记录就绪耗时，断言第 1 轮 `warm` 且复用预热的
那个运行时，不做重启轮。它必须与 `role-warm` 同时运行，否则启动前失败——预热首轮不能替代冷首轮达标。

```sh
RAH_EFFICIENCY_ORDER=native,role-warm,role-prewarm npm run test:cli:efficiency -- --paid
```

两组各自对原生判定；`result.firstRound` 另外并列报告冷首轮与预热首轮（回复耗时、排队、输入、预热就绪耗时）。

## 已送达正文的 check 展示

2026-09-30：Kernel 在 Worker sync 的可选 `deliveredInWakeSeqs` 中标注当前 Activation/consumer/Run 精确且已确认发送的消息序号。普通 `message-check` 仅将这些正文显示为引用，保留目标、消息 ID、序号；未送达/仅通知的正文、其他业务事件仍完整显示。`message-check --replay` 和显式 sync 保留全文。原始事件和分页范围不变，CLI 仍在输出成功后确认原范围；Host 送达事实不能单独 ACK、完成 Activation 或 Task。不是新队列、游标或持久状态，无 schema 迁移。

这一批减少重复正文体积，不保证模型不调用 check，也不是生成次数或 token 预算达标的证据。付费门禁需另行授权后复测。

## 普通唤醒的最小读写协议

2026-10-01 P78 交接说明收口：原生输入已有完整接力要求，但模型读取的 `help messages` 精简卡遗漏了唤醒语义，随后发帖只称呼 B、未带 @。只在普通帮助卡补齐既有常驻协议的裸 `@<handle>` 语义，不修改常驻协议版本，不让旧 session 为此触发升级读帮助；保留原提示词和帮助卡长度预算。Kernel 不从自然语言称呼推断收件人，不强制每条回复有收件人，不添加自动救场、额外确认轮或场景专用状态机。此改动修正文档缺口，不保证模型遵从；应以新批有界真实接力验证，失败如实保留。

2026-09-30 P77 首次协作补读修复：首次消费没有 cursor，不等于实例刚入频道。Kernel 对仍在所属频道的 Role 实例以同事务创建/入频道的 `instance.created` 序号 + 1 作为首次补读下界；已有 cursor 仍优先，旧 Agent 与私聊路径不变。下界仍冻结到当前 Run 的展示窗口，不改 Activation 的业务区间、定向消息集合，也不创建 Inbox、ACK 或新队列。先前已冻结的窗口不重写。沿用原共享条数/字节预算、当前消息优先及省略范围提示，确认后不逐轮重复开场。

P77 的两条早停不能作为修复后完整六条讨论的成本上限。验收先确认开场实际进入 B 的唤醒、六条协作能收束、无多余运行，再对等比较生成数与用量；必要的开场补读成本单列，不靠少交付制造低成本。确定性覆盖见 `packages/kernel/test/instance-first-wake-catch-up.test.ts`；真实效果以新批次证据为准。

2026-09-30：完整 wake 用 `Reply context` 提供精确目标、确认序号和轮次句柄，不再附发帖／检查命令菜单。常驻说明保留正文已送达、独立目标分别回复、无回复确认、Task 认领边界和完成语义；Task 操作链移至按需帮助，错误恢复以工具输出为准。截断／首条过大和无定向消息的 check 路径保持原状，不能为了减少一次生成跳过尚未送达的正文。

验证分开报告：确定性测试证明目标、送达范围与 ACK 不变量；真实对照才判断提示变化是否减少冗余 check、重复读文件或空调用。两组必须完成同一业务交付（原生组确实写入要求的 Markdown、Loom 组确实发布实质答复），漏交付时不计算“达标”结论，不用补跑成功样本覆盖失败。分别列首请求输入、业务/协议工具轮次、回复后生成、累计/未缓存输入，以及旧 session 首次升级帮助成本。普通 post 的自然收尾计入全程；会话不因协议升级而重建。

## 最终回复收尾（`--final`，仅报告不设预算）

P67/P68 暴露提前 final 会把开场白/占位消息放大为工作中断。本批最小修法：普通 `message-post` 只发布，不默认携带 `final: true`；唤醒保留精确目标和因果序号，但不预填 `--final`（多目标也不替模型决定最后一条）。显式 `--final` 是完成全部当前工作后主动选择的终止声明，仍走现有 Kernel 标记与 Host 中断；`--progress` 兼容，重发 `--send-draft` 保留已存意图。HTTP、ACK、Task、执行围栏均不变，不按正文关键词猜完成度。普通发帖后的自然收尾成本须计入，不用提前中断制造省 token 的假象。旧 session 通过协议升级卡获知新规则，不重建会话。仍存在模型主动误用显式 final 的边界，需真实验收，不宣称由本批根除。

模型发出完成回复后，Kernel 在同一事务记录该 RunAttempt 的最终回复标记（schema 67，
不是 ACK），Host 读到后由驱动在安全工具边界请求原生中断，尝试阻止后续生成；中断已发出或已接受均不保证下一模型请求尚未开始。
Codex 每轮与热进程两条路径已接；Claude 由 S2-c1 接入（原生 `interrupt` 控制请求）；Kimi 由 S2-c2 接入（无工具在途时 ACP `session/cancel`，`kimi-final-interrupt.js`）；OpenCode 由 S2-c3 接入（发帖工具结束后 `POST /session/:id/abort`，`opencode-final-interrupt.js`）。2026-09-27 Kimi 效率证据每轮 `finalInterrupt.sent/accepted = true`。

- 用量接口 `finalInterrupt`：`null` 表示本轮没有完成回复标记；否则 `{committedRoomSeq, sent, preemptedFollowUp}`。
  `sent` 为驱动确认已发出中断（被拒绝或未上报为 false；实际追加生成次数仍须独立证据）；`preemptedFollowUp`
  按证据判定（S2-b 修正，此前真实运行即使回复后生成数为 0 也总报 false）：最终回复的工具结束后观察到模型输出、
  新的工具调用，或用量帧使线程累计用量超过已观察到的全部生成 → false；原样重复的用量帧不是生成，
  工具结束后到达的第一个前进用量帧若对应尚未结算的上一次生成（发帖那次调用）也不算后续生成；
  窗口内用量帧无法解析 → `unknown`；中断未发出 → `unknown`；其余 → true。
- `compareRounds` 每轮输出 `finalInterrupt`（未采集为 `null`）；`compareArm` 汇总
  `committed/sent/preempted/notPreempted/unknown/noFinalPost/evidenceMissing`。只报告，不进入失败判定；
  生成数预算仍按 usage 计。
- 局限：`preemptedFollowUp` 的用量归属按"每次生成恰好一条前进用量帧"推断，未经真实 Codex 帧序验证；
  它反映已观察到的输出／用量，不能证明 provider 从未接收后续请求。OpenCode 免费原生探针已出现回执完整、中断已发而仍有下一请求；详见[当前公开能力边界](../evo/worker-mcp-opencode-boundary.zh-CN.md)。实际生成归属须用上述独立时序证据，不能用中断状态替代。

## 证据与后续范围

### 多轮审查题的语义有效性（P73/P74 复核）

累计输入接近原生不等于业务质量通过。P73/P74 的追问“基于补充约束撤回不成立的假设”有引导性：session 绑定只在 `provider-sessions`、`turns` 只存临时凭据，均不能推出运行时目录名称永远符合排除正则。原生与 Loom 都有不充分撤回，不能据此归因于 Loom 会话丢失。

免费临时目录反例使用与题目 SHA 相同的 `state-backup.ts`：小写 UUID 的 `turns` 被排除，大写 UUID 且目录可读时，合成凭据被复制；两种情况均满足追问给定约束。当前生产创建者使用 `instrt_${randomUUID()}`，因此反例仅证明推理条件不足，不证明生产正在泄漏，也不要求为此扩大备份排除范围。临时数据已删除，未访问正式凭据。

后续同题对照须在运行前冻结中性追问：“逐条说明上一轮结论应保留、修订或撤回，并说明新增事实是否足以改变它；区分文件保留和同一原生 session 的实际恢复。”单独核对是否凭空新增上一轮结论、是否保留未被排除的条件、是否提出真实恢复验收。文件存在不能代替同 session 续聊证明。旧批次保留原题与原结论，不以修改后的标准追认达标。

P73 的 `cat "$RAH_WORKER_CLI" >/dev/null` 无有效输出、非协议要求，计为冗余协议工具调用；不应算业务读取。单次轨迹不能证明该调用由哪句提示引起，不为它追加禁止空读的产品提示词。后续继续分开报告首请求增量、必要读写、冗余工具调用及 `--final` 省掉的收尾生成，避免用累计比例掩盖不同执行路径。

证据写入打印的隔离目录 `result.json`，包含失败轮次，不包含账户凭证或完整工具输出。批次 4 起证据分别记录被测代码
`codeCommit`（HEAD）与 `workingTree`（`git status --porcelain` 含未跟踪文件的摘要、`git diff HEAD` 摘要、变更与未跟踪数），
题目快照另记 `sourceRef`（`RAH_EFFICIENCY_REF`，默认固定 P97 源码提交）；同目录写 `result.redacted.json`（临时根换 `<tmp>`、home 换 `~`），
其 `rawResultSha256` 为原始 `result.json` 的 sha256，提交证据用脱敏文件。此前提交的四份效率证据的 `commit` 字段是题目
快照（均为 main 里程碑 `5122795`），不是被测代码版本；它们测的是各自阶段的 evo 代码，单看文件无法确定具体版本。
原生 session 文件保留于 CLI 自己的目录，只提取用量和必要诊断摘要；正式频道与正式库不动。
不同付费 Provider 必须各自和其原生 CLI 比，不能以 Codex 通过代替 Claude/Kimi/OpenCode。
Claude/Kimi/OpenCode 各有原生对照臂（见上文“多 Provider”），均已付费运行（见台账）；长期压缩、忙时消息与多频道串行压力是后续场景，不伪称覆盖。
当前私聊排队业务验收继续使用独立纵向证据，不把有意排队时间混入本 gate 的纯续聊对照。

门禁脚本与用量汇总由 `scripts/cli-efficiency/` 所有；不新增产品队列或上下文状态。
确定性汇总/预算测试可免费随批执行：`npm run test:cli:efficiency:unit`。

首次执行结果与基线数字见 [状态历史日志](../evo/log/status-history-2026-09.zh-CN.md)的"效率基线"一节；全部付费运行见 [付费运行台账](../evo/paid-runs.zh-CN.md)。
