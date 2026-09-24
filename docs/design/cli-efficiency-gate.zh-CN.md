# 原生 CLI 对照：阶段效率 Gate

这是用户要求的必备阶段门禁，适用于旧 Agent 与频道 Role 实例两种模式。
在调度、上下文投递、提示词、记忆传输或 session 管理累计完成一批修改后执行，
以及相关版本交付前执行。小型 UI、文案或无关修正不逐次付费重测。
不加入默认 `npm run check`；每次付费运行仍遵守当前用户授权及精确模型许可。

## 首个可执行范围

```sh
npm run test:cli:efficiency -- --paid
```

首版是 Codex `gpt-5.6-luna / low`：原生 CLI、新建旧 Agent、频道 Role 实例三组。
旧 Agent 组使用初始化但从未运行过的 Agent，配置精确模型后才发问，避免把创建后的自动入职流程混入三轮题目。
各组新 session 开始并复用三轮，RAH 第三轮前平滑重启隔离 daemon；
原生 CLI 每轮退出进程、下一轮恢复同 session（比只重开浏览器更严格）。
原生使用 `codex exec --json`，RAH 使用产品现行 app-server 适配器；
这项入口差异属于实际平台开销，但结果不能独自证明差异均来自调度。

固定 Git 提交的两份真实网络重启源/测试文件，三组内容哈希和 AGENTS.md 一致，
Role 显式选现有 mount；旧 Agent 将相同文件准备到实际私有 cwd，避免目录不一致。三轮依次是限定审查、质疑并修正、
重启后结论与测试标准；不改文件、记忆，不建 Task。模型回答须人工审查证据与连续性。
三组串行避免本 gate 竞争账号，默认顺序 native/legacy/role；用
`RAH_EFFICIENCY_ORDER=role,native,legacy` 在未来独立样本轮换顺序，
不丢弃失败样本、不为了好看重复跑。`RAH_EFFICIENCY_REF` 可指定固定源版本。
用户其他应用仍可能使用同一账号，缓存冷热无法完全控制，单次时间不作统计显著性结论。

## 指标和裁决

每轮记录：发送到有效回复时间、RAH 进入 Run 前等待、实际 session ID、原生模型和 effort、
模型生成次数（`generationsBeforeReply`/`generationsAfterReply`/`generationsTotal`；`generations` 兼容保留为总数。RAH 以有效 Room 回复落库时刻切分：发出该 message-post 的那次生成计入回复前，之后的生成计入回复后；原生组最终答案那次生成即回复，全部计入回复前；比较结果另报 `extraProtocolGenerations` = RAH 总数 − 原生总数）、首次请求/最大请求输入、累计输入、缓存/未缓存输入、输出和推理子集、
Worker check/post 与其他工具调用的类别。原生原始轨迹只作诊断，RAH 成功以持久 Room 最终答案为准。共享题目要求“审查结论：”前缀且正文至少 80 字符；只收到进度确认不算成功，仍需人工核对实质质量。
按唯一 `response_id` 汇总原生 usage，禁止把累计会话 usage 相加；推理已含在输出中。
RAH 门禁执行文件使用仅供测试的 stdio 模型围栏：所有 thread/start、resume、fork 在转发前必须显式指定许可模型和 effort；其他初始化 Agent 也不能绕过。原生组通过明确 CLI 参数指定许可模型，并事后核对原生轨迹。
缺用量、换 session、模型不符、失败或额外 Run 均不算通过；不能靠少读代码降低成本。

预算采用 owner 2026-09-24 修订后的 [evo 目标合同](../evo/target-contract.zh-CN.md) 第 6 节（数值集中在 `metrics.mjs` 的 `budgets`）：

- 协议额外生成（整轮）：RAH 整轮生成数 − 原生整轮生成数 ≤ 1；不设绝对总数上限，原生完成同一工作所需的工具轮次不算协议开销。
- 回复前额外生成：RAH 回复前生成数 − 原生整轮生成数 ≤ 0；回复切分未知即 `generationsBeforeReplyMissing`。
- 固定开销（`fixedOverhead`，按组判一次）：新 session 第 1 轮第 1 次生成的输入，RAH − 原生 ≤ 3,000 token；任一侧缺数据即 `fixedOverheadMissing`。续聊轮的首请求只报告、不设预算，但仍须两侧都有（缺即 `firstInputMissing`），供分解使用。
- 每轮残留（`perRoundResidue`，只报告）：相邻两个续聊轮之间的上下文增长（后一轮首请求 − 前一轮首请求）之差，RAH − 原生。
- 业务差异（`workPathVariance`，只报告）：逐轮业务工具调用数（除 box-post 外）与生成数之差；第 1→2 轮上下文增长之差单列为 `round1HistoryDelta`，它同时含第 1 轮工作路径与第 1 轮协议历史，仅凭用量无法再拆，不计入固定开销，也不据此放宽固定开销上限。
- 单轮总输入不超过 2 × (原生同轮总输入 + 3,000)。每轮附 `inputDecomposition`，把总输入差精确分解为 G_rah × 固定开销 + G_rah × `round1HistoryDelta` + G_rah × 累计残留 + (G_rah − G_原生) × 原生首请求 + 轮内增长之差（G 为整轮生成数）；超预算时 runner 打印该分解。未缓存输入比值只作诊断报告，不计入预算失败（合同第 6 节未签此项）。
- 额外回复耗时不超过 max(5 秒, 原生同轮耗时 × 15%)：短任务按秒计，长任务按百分比计。
- 用量证据：RAH 组须有产品入库用量（`agent.run.usage.get`）且 `completeness` 为 `complete`；`partial`/`unavailable` 或缺失即 `usageEvidenceMissing`。两者都有时，将产品入库的生成数、输入、缓存、输出与原生轨迹推导的 RAH 用量交叉核对，不一致即 `usageEvidenceMismatch`。证据类失败判 `missing-evidence`，不能判预算内。

超预算返回退出码 2，运行失败返回 1。所有指标在预算内也只是 `needs-quality-review`，
还必须人工确认源文件范围、证据准确性、前后连续和输出质量；不自动冒称 parity。
不得因当前失败临时放宽。对每一项超额解释固定平台成本、重复输入、额外工具轮次及提供商等待。

## S2-a 热进程对照（Role 实例，Codex）

`role-warm` 组与 `role`（每轮冷启动）组使用同一 Role 配置，只在隔离 gate daemon 的配置中打开
`warmRuntimes.codex.enabled`（产品默认仍关闭）。默认组序不变；`RAH_EFFICIENCY_WARM=1` 时在末尾追加
`role-warm`，也可显式指定 `RAH_EFFICIENCY_ORDER=native,role,role-warm`（必须含 `native`、不得重复）。

```sh
RAH_EFFICIENCY_ORDER=native,role,role-warm npm run test:cli:efficiency -- --paid
```

- 每轮从产品用量接口记录 `execution`（`mode`、`sessionResumeMs`、`lateFrameCount`、`instanceRuntimeId`）；
  每轮模式的 `role` 组为 `null`。热进程轮次以 `turn_quiesced` 证明结束、无退出码，按 `exited` 判成功。
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

依据 S2-a 独立审查（2026-09-24）的建议。冒烟只证明所列观察，不等于性能验收或正式启用；热模式仍默认关闭。

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
Codex 每轮与热进程两条路径已接；Claude/Kimi/OpenCode 未接，行为不变。

- 用量接口 `finalInterrupt`：`null` 表示本轮没有 `--final` 回复；否则 `{committedRoomSeq, sent, preemptedFollowUp}`。
  `sent` 为驱动确认已发出中断（被拒绝或未上报为 false，此时本轮按原行为多一次生成）；`preemptedFollowUp`
  为 true 表示最终回复的工具结束后到轮次结束未观察到任何模型输出/工具调用/用量帧，false 表示后续生成已开始
  （中断仍会截断它，但可能已计费），`unknown` 表示无法观察。
- `compareRounds` 每轮输出 `finalInterrupt`（未采集为 `null`）；`compareArm` 汇总
  `committed/sent/preempted/notPreempted/unknown/noFinalPost/evidenceMissing`。只报告，不进入失败判定；
  生成数预算仍按 usage 计。
- 局限：`preemptedFollowUp` 依赖 Codex 在工具结束后才发出上一次生成的用量帧这一假设，未经真实 Codex 验证；
  中断落地与后续请求发出的先后在真实 CLI 上须用付费门禁实测。

## 证据与后续范围

证据写入打印的隔离目录 `result.json`，包含失败轮次，不包含账户凭证或完整工具输出。
原生 session 文件保留于 CLI 自己的目录，只提取用量和必要诊断摘要；正式频道与正式库不动。
不同付费 Provider 必须各自和其原生 CLI 比，不能以 Codex 通过代替 Claude/Kimi/OpenCode。
其他 Provider、长期压缩、忙时消息与多频道串行压力是后续场景，不在首版伪称覆盖。
当前私聊排队业务验收继续使用独立纵向证据，不把有意排队时间混入本 gate 的纯续聊对照。

门禁脚本与用量汇总由 `scripts/cli-efficiency/` 所有；不新增产品队列或上下文状态。
确定性汇总/预算测试可免费随批执行：`npm run test:cli:efficiency:unit`。

首次执行结果与基线数字见 [evo 现状](../evo/status.zh-CN.md)的"效率基线"一节。
