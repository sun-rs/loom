# CACHE-TTL-0 · 高级角色的提示缓存与唤醒成本

**建议 loomd 默认关闭 keep-alive。** 按公开 API 价折算，定时 ping 在 Relay 高级角色上增加 **$0.012**，在可确认的 loom-next Auditor 样本上增加 **$0.602**。按原始 token 计则分别多 **52.9 万（+4.90%）** 和 **911.7 万（+2.16%）**。更有把握的改动是按依赖投递、合并成功通知。Relay 的合并回放节省 **$0.586（高级角色 −7.57%）** 和 **64.0 万原始 token（−5.93%）**。两轮 Relay 实测用量中，worker 占 API 折算开销 **77.06%**、原始 token **64.46%**，低于约 90% 的设计目标。

## 样本与命中率

用 COST-REQ-0 的 543 条会话索引与 22,308 条请求，533 个会话有用量。在同一 provider、同一原生会话内按记录序配对，得到 21,775 个相邻间隔。首个请求无前序，时间倒退、跨模型和零输入的相邻对均为零。保留原有五处 cwd 与提取截止点。Relay 角色来自实验清单。loom-next 将 Driver 对应到 Leader，依启动输入中的角色指派或直接、独立审计委托核实到 92 个 Codex Auditor、1 个 Claude Auditor，共 3,460 次请求。允许样本中没有能独立核实的 loom-next Driver 时间线，所以该项目的角色回放覆盖 Auditor。余下角色保留原有的待核实标签和 worker 候选标签。只读取指定提取文件及其列出的原生会话启动记录来核对角色。 [请求来源](../COST-REQ-0/requests.csv) · [会话索引](../COST-REQ-0/sessions.csv) · [提取覆盖](../COST-REQ-0/coverage.json) · [角色及记录行号](analysis.json) · [loom-next 角色定义](/Users/sun/Code/repos/loom-next/docs/DESIGN.md)

表中每格为 **逐请求 cached / context 的平均值 · 请求数**。间隔用同一提取口径的相邻时间戳相减。Claude 优先用 API 请求锚点，Codex 和 agy 用原生用量或 planner 记录时刻，因此后两者的间隔可能含生成时间、工具和排队时间。下界计入右侧区间，120 分钟整计入 60–120。CSV 给出每组的会话数、中位数、按 token 加权的命中比例、任意命中和至少一半命中的次数、1h 写入，以及单独的外部唤醒样本。基表的全量含 Relay 窗口外两次请求，实验和政策主表采用归档窗口。 [完整 provider × model × role 分桶表](cache-hit.csv) · [原生时间字段定义](../COST-REQ-0/extract.py)

| Provider / 模型 / 角色 | <1m | 1–3 | 3–5 | 5–10 | 10–20 | 20–40 | 40–60 | 60–120 | >120 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Codex · 全量 | 96%·19074 | 97%·1019 | 97%·141 | 97%·223 | 93%·99 | 96%·35 | 74%·7 | 53%·10 | 9%·4 |
| Codex · GPT-6.2 Sol · 全量 | 96%·14016 | 97%·902 | 98%·101 | 96%·147 | 90%·64 | 99%·16 | 7%·1 | 37%·6 | 6%·3 |
| Codex · GPT-6.2 Astra · 全量 | 94%·3925 | 98%·91 | 96%·40 | 97%·75 | 97%·35 | 93%·19 | 99%·5 | 77%·4 | 16%·1 |
| Codex · GPT-6.1 Terra · 全量 | 98%·761 | 91%·13 | — | 100%·1 | — | — | — | — | — |
| Codex · GPT-6 Luna · 全量 | 96%·372 | 97%·13 | — | — | — | — | 16%·1 | — | — |
| Codex · Sol · Relay worker | 90%·165 | 87%·28 | — | — | — | — | — | — | — |
| Codex · Sol · loom-next Auditor | 96%·369 | 97%·24 | 99%·4 | 99%·11 | 100%·4 | 99%·8 | — | 66%·3 | 4%·1 |
| Codex · Astra · loom-next Auditor | 93%·2619 | 97%·62 | 95%·34 | 97%·62 | 97%·30 | 97%·14 | 99%·3 | 70%·3 | 16%·1 |
| agy · 全量 | 90%·717 | 82%·80 | 49%·19 | 24%·14 | 52%·7 | 94%·1 | — | — | 0%·3 |
| agy · Neon High · 全量 | 92%·394 | 88%·37 | 26%·7 | 30%·4 | — | — | — | — | — |
| agy · Neon XHigh · 全量 | 88%·323 | 76%·43 | 62%·12 | 21%·10 | 52%·7 | 94%·1 | — | — | 0%·3 |
| agy · Neon XHigh · Relay Leader | 90%·96 | 78%·10 | 57%·10 | 0%·1 | 70%·4 | — | — | — | — |
| agy · Relay worker · 两档 Neon | 87%·66 | 77%·16 | 75%·1 | 29%·9 | 28%·3 | — | — | — | — |
| Claude · 全量 | 96%·274 | 98%·26 | 95%·10 | 89%·5 | 97%·5 | 97%·1 | — | — | 48%·1 |
| Claude · Sonnet 5.5 · 全量 | 96%·109 | 98%·22 | 95%·10 | 99%·3 | 99%·3 | 97%·1 | — | — | 48%·1 |
| Claude · Sonnet 5.5 · Relay Auditor | 96%·50 | 99%·8 | 99%·9 | 99%·3 | 99%·3 | 97%·1 | — | — | — |
| Claude · Opus 5.5 · loom-next Auditor | 97%·61 | 98%·1 | — | — | — | — | — | — | — |
| Claude · Haiku 5.5 · 全量 | 85%·7 | 88%·1 | — | 73%·2 | 95%·2 | — | — | — | — |

- **Codex** 在 20–40 分钟仍平均命中 96%（35 个请求），40–60 降到 74%（7 个），60–120 降到 53%（10 个）。分组转折在 **40–120 分钟**，长间隔样本很少。Astra 在 40–60 分钟的 5 个点仍均值 99%，Sol 同档只有 1 个点（7%）。公开 Responses API 对 GPT-5.6 及以后通常采用 30m 最低保留，支持 12h。30m 命中会延长 30m 覆盖，12h 计时从写入起算，读命中延续的只是普通 30m 覆盖。历史 CLI 路由的具体设置不可由时间戳推断。 [OpenAI 缓存生命周期](https://developers.openai.com/api/docs/guides/prompt-caching#cache-lifetime)
- **agy** 最明显的下降在 **3–5 分钟**，5–10 分钟更低。只看 Leader 的外部唤醒，3–5 分钟平均命中 41%（7 次）。首轮 H1/Orca 的 9 次 worker 完成唤醒有 7 次零读，最短零读 2m05s。次轮同两臂的 8 次均为 91%–97%，包括 H1 的 15m01s。另有 H0 约 10m、15m 的异步回包命中 94% 和 95%。这些观测支持按路由校准软拐点，前缀变化、异步执行、缓存放置和两轮环境差异均可能影响结果。Neon 的 API 只支持隐式缓存，未承诺固定 TTL。 [分桶表](cache-hit.csv) · [逐请求回放](replay.csv) · [Google 隐式缓存](https://aistudio.google.com/docs/caching) · [Neon 定价与支持范围](https://aistudio.google.com/docs/pricing#gemini-4-neon)
- **Claude** 的 1,058,350 个缓存写 token 全部标记为 1h，Relay 主窗口占 147,910 个。Relay Sonnet 在约 25m39s 后仍命中 97.4%。唯一的隔夜回访离上一请求 533m，仍读到 48.4%，同时写入 27,420 个 1h token。该观察可由后端共享或较短匹配前缀解释，记录无法定位其来源。**5 分钟未见断崖，兼容 1h 写入模式**。40–120 分钟没有观测点，因而无法在本样本定位 60 分钟拐点。Opus 5.5 的最长可配对间隔不足 3 分钟。 [Claude 缓存生命周期](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) · [逐请求回放](replay.csv)

## 成本模型与盈亏平衡

以普通输入单价为 1。GPT-6.2 Sol/Astra、GPT-6.1 Terra、Neon、Claude Sonnet/Opus 5.5 的缓存读权重为 0.05，GPT-6 Luna 与 Claude Haiku 5.5 为 0.10。普通冷输入为 1。OpenAI 已记录写入按 1.25（30m）估算，12h 拟议写入按 2.5。Claude 区分 1.25（5m）和 2（1h）。Neon 的隐式缓存按冷输入价，无独立写费。主样本各模型的输出权重为 5。已观测请求按其用量字段逐项定价，Codex/agy 的写入使用提取到的记录，公开价以 2026-11-25 标准档为基准。Relay 的普通输入/百万 token 为 Sol $2、Neon $3、Sonnet 5.5 $2。loom-next 的 Astra 以 $8 折算。这里的美元是同一价目表下的可比估值，CLI 套餐的实际用量扣减和账单金额没有在记录中出现。原始 token 情景等权计入每次的完整输入与输出，缓存写入只计一次。 [OpenAI API 价目表](https://developers.openai.com/api/docs/pricing) · [Anthropic API 价目表](https://platform.claude.com/docs/en/about-claude/pricing) · [Gemini API 价目表](https://aistudio.google.com/docs/pricing)

设共享前缀为 `P`，冷重建权重为 `w`，命中权重为 `r`，请求间隔为 `G`，保留时长为 `T`，ping 间隔为 `I < T`。若下一次真实请求到达时缓存已冷，完整恢复前缀的可避免成本约为 `P × (w − r)`。取参考前缀 **50k token**，每个 ping 新增 **32 input + 16 output**，每条保留 **48 token**。Gemini 4 小增量请求按公开规则计 **2,050 个上一请求尾部 token** 的重新处理，恢复上限也扣除该尾段。

- `n = max(0, ⌈G/I⌉ − 1)`，真请求与 ping 同刻时优先真请求。首个 ping 的加权成本为 `C₁ = (P − L) × r + L + 32 + 16 × 5`，其中 Neon 取 `L = 2,050`，其余取 `L = 0`。
ceil-1))，真请求与 ping 同刻时优先真请求。首个 ping 的加权成本 (C_1=(P-L)r+L+32+16\times5)，其中 (L=2{,}050) 只用于 Neon。
- 单段新增成本为 `n × C₁ + 48 × r × n × (n − 1) / 2 + 48 × w × n`。末项覆盖真实唤醒首次携带的 ping 历史。回放另外给后续真实请求计入累计历史。若整段成功且冷却可归因于 TTL 的联合概率为 `q`，则比较新增成本与 `q × (P − L) × (w − r)`。
- 下表按 `q = 1` 及每次 ping 命中估算。经济上优先选择 TTL 内留足调度余量的最大 `I`。给定最多有利的 `N` 次 ping，连接到 `T` 后仍有净收益需要 `I` 约不小于 `T / (N + 1)`，指定间隔的理想最远回访为 `min((N + 1) × I, N × I + T)`。某一端点是否收费取决于同刻优先规则。一次 ping 的 `q` 门槛含新增历史。原始 token 权重下 `w = r = 1`，省下的 token 为零，首个 ping 加上下一真实请求多约 **50,096 token**，所有 provider 都无盈亏平衡间隔和等待长度。 [数值计算](analysis.json) · [Gemini 4 小增量规则](https://aistudio.google.com/docs/caching)

| Provider / 重建场景 | 假定 TTL / ping 间隔 | 最短经济间隔约 | API 盈利等待窗口，理想 | 最多有利 ping | 一次 ping 的联合概率门槛 |
|---|---:|---:|---:|---:|---:|
| Codex · Sol · 普通冷输入 | 30 / 25m | 1.67m | 30–450m | 17 | 5.6% |
| Codex · Sol/Astra · 30m 写 | 30 / 25m | 1.30m | 30–575m | 22 | 4.5% |
| agy · Neon · 5m 假设 | 5 / 4m | 0.50m | 5–40m | 9 | 10.1% |
| agy · Neon · 3m 敏感性 | 3 / 2m | 0.30m | 3–20m | 9 | 10.1% |
| Claude · Sonnet/Opus 5.5 · 5m 写 | 5 / 4m | 0.22m | 5–92m | 22 | 4.5% |
| Claude · Sonnet/Opus 5.5 · 1h 写 | 60 / 55m | 1.67m | 60–1,980m | 35 | 2.8% |

小时级的理想上限依赖连续命中和最终一定有真实回复，远超部分提供商可验证的持续时间。若 ping 自己写冷前缀，可能单次花掉原本要避免的重建成本。Claude 的 1h 写入相对 5m 多 0.75×。同一前缀一次确实避免的 5m 重写约省 1.20×，足以覆盖这一份前缀的溢价。OpenAI 12h 比 30m 多 1.25×，一次避免的 30m 重写约省 1.20×，同一前缀需要大约两次这类命中才回本。新前缀、缩短历史或提前结束 session 会改变收益。 [Anthropic 缓存时长实验](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence#pick-the-cache-duration) · [OpenAI 12h 写入规则](https://developers.openai.com/api/docs/guides/prompt-caching#cache-lifetime)

## 时间线回放

两轮 exp-relay 共 12 个高级角色原生会话、207 次窗口内请求。另有 93 个 loom-next Auditor 会话、3,460 次原生请求。回放保留模型真实工作与用量，以成本差额表示增减。金额中 **正数为增加开销**，百分比分母为对应高级角色基线。 [逐请求时间线及变化](replay.csv) · [按实验轮次、臂、角色、provider/model 汇总](analysis.json)

| 策略 | Relay Leader | Relay Auditor | Relay 合计 | loom-next Auditor |
|---|---:|---:|---:|---:|
| A · 实际用量 | $6.587 · 7.073M token | $1.160 · 3.713M | $7.747 · 10.786M | $312.882 · 422.833M |
| B · TTL 前周期 ping，50% 恢复 | +$0.012 · +0.529M · 11 ping | $0 · 0 · 0 ping | +$0.012 · +0.529M | +$0.602 · +9.117M · 48 ping |
| B · ping 完全无效至完全有效 | +$0.151 至 −$0.126 | $0 | +$0.151 至 −$0.126 | +$2.009 至 −$0.805 |
| C1 · 缩短实际 W1 等待，费用情景 | −$0.006 至 +$0.148 · 0 | $0 · 0 | −$0.006 至 +$0.148 · 0 | 无可核实的波次调度重放 |
| C2 · 合并成功通知 | −$0.559 · −0.492M · −9 请求 | −$0.027 · −0.148M · −3 请求 | −$0.586 · −0.640M · −12 请求 | 样本内无可核实的可合并批次 |
| D · 新会话转 Claude Sonnet 5.5 1h，50% 恢复 | −$0.271 · 0 | $0 · 0 | −$0.271 · 0 | −$176.634 · 0 |

**B．等待中 ping。** 仅在相邻请求跨外部唤醒轮、前请求没有日志记录的待回包工具、当前请求没有工具回包时回放。实际发出之前必须掌握等价的在线状态。按 Codex 25m、Neon 4m、Claude 1h 写入会话 55m 排程。用短间隔的中位前缀复用比例估算可恢复量，最多恢复至两个请求的较小上下文。上下文缩减逾 20% 的间隔不给恢复收益。只给超过假设 TTL 且 ping 链能接到真实唤醒的间隔记收益。把可能恢复的用量按原 fresh/write 比例重分配，50% 是情景参数。ping 本身按命中报价，且观察结束后不再排程，因此模型尚有乐观偏差。Relay 中只有首轮 H1 Leader 的节省足以覆盖本臂预热支出。全 Relay 改为 2m ping / 3m TTL 时，50% 情景省 $0.095，代价是 30 次 ping 和 1.561M raw token。每段最多一次的 25/4/55m 策略仍增加 Relay $0.006 / 0.321M 与 loom-next $1.001 / 4.068M。隔夜回访单列，按机械 55m 定时器会在 533 分钟发 9 次 ping，生产调度应在原运行结束时销毁这类定时器。 [回放脚本](analyze.py) · [回放结果](analysis.json)

**C．缩短与合并。** C1 使用第二轮 H1 实际 W1。原 15 分钟窗口在 17:13:21 投递。5 分钟上限加就绪条件，保留 T1–T3 成员时，最早能在 17:07:03 投递，提前 **6m18s**。T4 与 T5 的真实后续投递时间固定。W1 前间隔从 15m01s 降至 8m43s，W1b 前间隔从 1m55s 增至 8m13s。按 5 分钟断点，W1b 增加约 $0.148 冷成本。按 10 分钟断点，W1 的潜在回收约 $0.006。两者是阈值敏感性，实际 W1 已命中 91%。仅缩短时长可把冷间隔挪到下一轮，也可能提前多发一批。C2 给 H1/Orca Leader 保留 T1–T4 就绪、T5 结果以及启动消息，合并此前的成功通知。首轮 H1 Auditor 把中途成功抄送合并到最终独立验证。按每份被合并通知 128 token 的摘要计入后续历史，每份只去掉首次模型输入往返，保留相应输出和后续验证的用量。该估计要求同一批能合并发起所需工具，且中途通知没有业务上必须即时作出的决策。C1 与 C2 分别对照 A。 [首轮批次归档](/Users/sun/Code/exp-relay/runs/20261124151218-59651/REPORT.md) · [次轮截止与任务就绪时刻](/Users/sun/Code/exp-relay/runs/20261124165640-99591/REPORT.md) · [loomd 波次设置](../../docs/PROTOCOL-v2.md)

**D．长 TTL provider。** 从会话创建起模拟把非 Claude 高级角色放到 Sonnet 5.5 1h，既有 Claude 用量沿用。新目标的首请求从冷启动，后续 60m 内保留可移植的已观测命中，从源 TTL 起按 0% / 50% / 100% 情景恢复可能丢掉的前缀，超 60m 按冷处理。所有未命中输入按 1h 写价，以同一上下文大小、请求数和输出量估值，省略模型行为、tokenizer、路由变更和能力差异。Relay 在三个情景下分别省 **$0.061 / $0.271 / $0.480**。loom-next 省 **$176.515 / $176.634 / $176.754**，主要来自 Astra 换成较低单价的 Sonnet，TTL 恢复只贡献中心情景的 **$0.120**。Sol 换 Sonnet 则增 **$7.505**。作为同模型对照，给 loom-next 的 Codex startup context 固定 80% 前缀买一次 12h、按 50% 追回长间隔命中，净增 **$13.269**。Relay 的两位 senior 若都选 Claude 会失去跨家族复核，应把独立性和验证质量作为选型条件。 [模型分项及敏感性](analysis.json)

## Relay 开销实际分布

按归档核对 42 个会话的请求数、完整输入、缓存读写、输出。每格百分比顺序为 **worker / Leader / Auditor**。按 COST-REQ-0 的统一权重，两轮合计份额为 76.10% / 18.32% / 5.57%。计入次轮 Orca Auditor 的两次隔夜请求后，worker 的 API 折算份额降至 76.78%，raw 份额降至 64.23%。 [第 1 轮用量](/Users/sun/Code/exp-relay/runs/20261124151218-59651/tokens.json) · [第 2 轮用量](/Users/sun/Code/exp-relay/runs/20261124165640-99591/tokens.json) · [分角色合计](analysis.json)

| 轮次 / 臂 | API 折算总额 | API 折算份额 | 原始 token 总量 | 原始 token 份额 |
|---|---:|---:|---:|---:|
| 1 · H0 | $6.221 | 83.02 / 14.07 / 2.90% | 5.092M | 65.72 / 22.80 / 11.48% |
| 1 · H1 | $6.548 | 70.80 / 25.47 / 3.73% | 5.374M | 56.87 / 27.59 / 15.54% |
| 1 · Orca | $4.988 | 65.77 / 29.69 / 4.54% | 5.042M | 55.99 / 25.61 / 18.40% |
| 2 · H0 | $5.467 | 80.37 / 16.56 / 3.07% | 4.507M | 67.45 / 22.51 / 10.04% |
| 2 · H1 | $6.014 | 85.07 / 12.82 / 2.10% | 5.427M | 79.35 / 16.64 / 4.01% |
| 2 · Orca | $4.536 | 75.73 / 19.55 / 4.72% | 4.904M | 60.93 / 24.88 / 14.19% |
| **两轮合计** | **$33.774** | **77.06 / 19.50 / 3.43%** | **30.346M** | **64.46 / 23.31 / 12.24%** |

## 已有做法与实测

| 项目 | 机制、TTL 和 ping 内容 | 实测与限制 |
|---|---|---|
| **Aider** | `--cache-prompts` 缓存系统提示、仓库图和文件。启用 `--cache-keepalive-pings N` 后，源码默认每 295s 通过 LiteLLM 重发可缓存消息快照，`max_tokens: 1`、关闭流式，最多 N 次，用户新请求重置计数。 | 项目文档给选项及命中日志，未报告开关对照总成本。距 5m 只有约 5s 余量，网络、排队或缓存失效可能让 ping 变冷。历史 issue 有上游预热请求失败实例。 [Aider 文档](https://aider.chat/docs/usage/caching.html) · [源码](https://raw.githubusercontent.com/Aider-AI/aider/main/aider/coders/base_coder.py) · [错误案例](https://github.com/Aider-AI/aider/issues/1205) |
| **Anthropic API** | `cache_control` 的 5m / 1h 写入分别 1.25× / 2×，命中可刷新。在上一请求开始后约 4m 复用原前缀和 API 头，以 `max_tokens: 0`、关闭流式请求，无用户消息或输出。强制工具、结构化输出、部分 thinking 与 compaction 参数有兼容限制。 | 官方四模型测试，每模型 3 次，10k 前缀在第 4m touch 后第 8m 全命中，12 个无 touch 对照全重写。Sonnet 5.5 分诊实验对比 1h，5% 的轮次有 6–32m 停顿时 ping 平均便宜 16%，10% 有停顿时便宜 8%。每轮都停 6m 或更长时，1h 更省。一次续命失败可能使下一次重写整段。 [Anthropic 实验与用法](https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence) · [缓存文档](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) |
| **OpenAI API** | 新模型 Responses 的 30m / 12h 分别 1.25× / 2.5× 写，可为稳定前缀设显式 breakpoint。`prewarm: true` 传同一前缀，无生成，冷 prewarm 仍收费。旧模型的 `in_memory` 常见 5–10m，部分支持 `24h`，适用档受模型与账户留存设置影响。 | OpenAI Cookbook 的 10,000 请求对照中，带扩展缓存与路由 key 的 Flex 相对 Batch 的输入成本低 23%。比较同时改变路由与执行档，无法单独归因给 TTL 或 ping。12h 不能靠读续满 12h，前缀或路由变化仍会影响命中。 [生命周期与 prewarm](https://developers.openai.com/api/docs/guides/prompt-caching) · [Cookbook 实验](https://developers.openai.com/cookbook/examples/prompt_caching_201) |
| **Google Gemini / Vertex** | 隐式依赖稳定前缀与请求间隔，无客户端续租接口。支持显式缓存的模型可以创建 `CachedContent` 并在请求中引用对象 ID，Vertex 默认 60m，可在到期前更新 TTL / expire time，更新无需模型 ping。当前 Neon 只支持隐式。 | Vertex 文档给部分模型显式缓存读价折扣 90%，另收创建及 token·hour 存储费。Neon API 隐式命中读价折扣 95%，本地实测的 3–5m 下降与两轮差异见上。价目折扣只作用于命中的前缀，显式存储的收益取决于复用频率。 [Gemini 隐式规则](https://aistudio.google.com/docs/caching) · [Vertex 计费](https://cloud.google.com/blog/products/ai-machine-learning/vertex-ai-context-caching) · [更新 TTL](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/context-cache/context-cache-update) |
| **LiteLLM** | SDK/proxy 转译缓存标记并归一 usage。路由可对命中前缀保持 deployment affinity，近期版本支持识别 1h breakpoint，将其路由保持期从 300s 延到 3600s。由真实调用继续使用同一部署，通用路由层不额外生成 ping。 | 公开文档提供用量核查和成本 header，未给独立 keep-alive 对照。有路由绑定仍需原生 prefix 命中，后端可变换模型及载荷转译规则。 [提示缓存](https://docs.litellm.ai/docs/completion/prompt_caching) · [路由](https://docs.litellm.ai/docs/routing) · [1h affinity 版本说明](https://docs.litellm.ai/release_notes/v1.108.0/v1-108-0) |
| **OpenRouter** | 用 `session_id` 绑定模型与成功的 provider endpoint，转发受支持的 Anthropic/Gemini/OpenAI 缓存控制。按上游 TTL，路由本身不发 ping，`cache_discount` 可核对真实调用。相同请求的 response cache 有单独 TTL。 | 文档展示单请求 10,318 / 10,339 命中，未给粘性路由的端到端开销对照。故障回退、显式 provider 顺序和流式取消可使结果变冷或丢失 cached usage。response cache 复用旧回答，有状态唤醒需要真实执行。 [提示缓存](https://openrouter.ai/docs/guides/best-practices/prompt-caching) · [响应缓存](https://openrouter.ai/blog/announcements/response-caching/) |
| **OpenClaw** | 识别路由及会话已报告的 TTL，≥50k 输入、有近期人类活动且上下文未重置的交互会话才安排。复用线上前缀，末尾临时占位，Anthropic `max_tokens: 0` 或 OpenAI Responses `prewarm: true`，无输出、不写会话。12h、Gemini、ChatGPT 登录路由无此定时保温。 | 文档给机制和止损规则，未报告该开关净省。新消息、过期、缓存写多于读、命中低于半数及预算到顶会停。预算约为一次重写差额的一半，状态可恢复且不因进程重启补发。 [OpenClaw 缓存与预热](https://docs.openclaw.ai/reference/prompt-caching#idle-keep-warm) |
| **Claude Code keepalive 插件** | `Stop` hook 等 240s 后用 block reason 注入一条短用户轮，请模型简短回复。最多 7 次，依赖 5m 命中刷新，是真实会话历史。 | README 的费用是公式示例，未提供独立对照。阻塞 Stop 时用户需中断等待，且生成仍可消耗额度、改变模型状态或触发工具。 [插件机制、参数与限制](https://github.com/yujiachen-y/claude-code-cache-keepalive) |

一项 2026 年公开预印本对 Anthropic、Google、OpenAI、DeepSeek 的 40k/100k 固定前缀做相同内容重发的受控实验。在 600s 等待档，每 30s ping 在有两组数据的所有 provider 上均增加含 ping 的总费用。约 240s 的策略把 ping 开销降为约 1/7.8。Anthropic 100k 的总费用从 $0.667 降到 $0.414，Google 100k 则从 $0.131 增至 $0.186，OpenAI 100k 从 $0.115 增至 $0.136。该研究使用公开 API 路由和受控固定前缀，适合作为调度策略对照。 [预印本方法与表 3](https://arxiv.org/html/2607.19214v1)

## loomd 建议

1. **先按依赖唤醒。** 以任务完成、依赖解锁、失败和阻塞为投递事件。成功结果合并成带证据指针的摘要，Auditor 保留独立验收，紧急失败与阻塞按现有时限提前送达。仅在提前投递能下一步派工或验收时缩短波次。保留稳定系统提示和工具定义，把变动状态附在末尾。跨长时间停顿时优先使用小型 handoff、必要证据按需读取。缩短上下文也降低了下一次全冷重建的成本。
2. **先记录本可触发的事件，再做 API 小流量试验。** 按 provider、模型、账户路由、会话与代次记录已观察的缓存读写、写入时长、上一请求起止、可复用前缀长度、完成事件和预计下次唤醒。预期净收益等于「预计在覆盖期内唤醒、且原缓存会冷、且这次预热能命中」的联合概率乘以可避免重写成本，再减去 ping 成本。仅考虑 **稳定前缀 ≥50k、已知刷新语义、可核对 API 计费** 的等待。要求预期可避免支出至少为 ping 成本的 **2 倍**。预计唤醒应落在原缓存过期至一次 touch 可覆盖的窗口，ETA 来源用已登记的工作队列和真实依赖完成进度。用真实未来时刻当作 ETA、每段最多一次、无输出的事后敏感性在 loom-next 仍增 **$0.233** 和 **1.093M raw**（8 次），Relay 中有已知续租语义的 provider 没有符合条件的候选。这支持先记录决策，等实际样本证明净收益之后再打开。
3. **只开放有明确 API 能力的可选项。** Claude API 已证实 5m 且预计 5–9m 会有实际唤醒时，可试一次约 **4m** 的零输出请求。观测到 1h 写入时优先保留该配置，本次运行内无需 ping。约 **55m** 的 1h touch 只适合已证实存在 60–115m 回访且预计能净省的 API 试验。OpenAI Responses 已知使用可刷新的 30m 写入时，可试一次 **25m** prewarm，目标 30–55m 的回访。12h 只为有反复长间隔复用的稳定前缀购买。Native Codex、Claude Code、agy 默认不向终端发送 keep-alive。agy 的 2–4m 候选只能先做受控测量。Neon 路由存在短间隔漏读且没有显式续租，把成功通知合并的优先级更高。长 TTL 只能作为高级角色选型维度，保留 Auditor 的独立模型家族。
4. **实现约束。** 首版每个等待最多 **一次**，全项目设置支出上限。用单调时钟安排截止前触发，在实际消息已排队、正在生成/执行工具、prefix/路由/代次变化、压缩、项目完成、输入额度接近上限时取消。timer firing 重新核对会话状态与身份，晚于已知期限就跳过，重启不追赶，用户与 worker 的真实通知优先。只用复用前缀的无输出接口，避免模型因收到 ping 主动派工、修改仓库、产生 hook/通知回路或增长历史。发现新增缓存写、明显低命中、错误或限额立即停。观察 API 等价成本和真实配额变化、额外 raw token、有效唤醒延迟与任务执行质量。若配额按 raw 计，任何额外 ping 都增加用量，维持关闭。

复现运行 `python3 tasks/CACHE-TTL-0/analyze.py`，使用 Python 标准库。本次为历史数据回放和公开资料对照，无新模型调用。验证记录见 [npm test 日志](npm-test.log)。

STATUS: done
