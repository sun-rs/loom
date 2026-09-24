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
- 首请求输入不超过原生同轮首请求加 3,000 token；任一侧缺首请求证据即 `firstInputMissing`。
- 单轮总输入不超过 2 × (原生同轮总输入 + 3,000)；未缓存输入比值只作诊断报告，不计入预算失败（合同第 6 节未签此项）。
- 额外回复耗时不超过 max(5 秒, 原生同轮耗时 × 15%)：短任务按秒计，长任务按百分比计。
- 用量证据：RAH 组须有产品入库用量（`agent.run.usage.get`）且 `completeness` 为 `complete`；`partial`/`unavailable` 或缺失即 `usageEvidenceMissing`。两者都有时，将产品入库的生成数、输入、缓存、输出与原生轨迹推导的 RAH 用量交叉核对，不一致即 `usageEvidenceMismatch`。证据类失败判 `missing-evidence`，不能判预算内。

超预算返回退出码 2，运行失败返回 1。所有指标在预算内也只是 `needs-quality-review`，
还必须人工确认源文件范围、证据准确性、前后连续和输出质量；不自动冒称 parity。
不得因当前失败临时放宽。对每一项超额解释固定平台成本、重复输入、额外工具轮次及提供商等待。

## 证据与后续范围

证据写入打印的隔离目录 `result.json`，包含失败轮次，不包含账户凭证或完整工具输出。
原生 session 文件保留于 CLI 自己的目录，只提取用量和必要诊断摘要；正式频道与正式库不动。
不同付费 Provider 必须各自和其原生 CLI 比，不能以 Codex 通过代替 Claude/Kimi/OpenCode。
其他 Provider、长期压缩、忙时消息与多频道串行压力是后续场景，不在首版伪称覆盖。
当前私聊排队业务验收继续使用独立纵向证据，不把有意排队时间混入本 gate 的纯续聊对照。

门禁脚本与用量汇总由 `scripts/cli-efficiency/` 所有；不新增产品队列或上下文状态。
确定性汇总/预算测试可免费随批执行：`npm run test:cli:efficiency:unit`。

首次执行结果与基线数字见 [evo 现状](../evo/status.zh-CN.md)的"效率基线"一节。
