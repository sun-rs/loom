# 两篇文章与 Cindy：Loom 显著收益筛选及推进顺序

日期：2026-10-27；Loom 基线 83214f84。本批为源码研究与实施设计，不是性能验收，不修改运行时、系统提示词或调度。

## 结论

保留 Room-first、Role / Instance / Session / Channel。Loom 是用户选择多实例协作的平台，不是固定的“分类器→规划器→专家→总结器”流水线。把所有实例折叠成一个主 Agent，会删除用户需要的独立会话、不同模型与权限边界。

显著收益候选依次是：完整任务验收覆盖与证据归因、无效消耗诊断、按证据精简启动/交接输入。它们优先于复制一个新框架。收益目前是设计判断，未测得百分比。

## 来源核实与纠偏

### 文章一：article.md

用户文件 `/Users/sun/Code/solars/xhs_extract/article.md` 引用了错误的 `bcherny/cwc-long-running-agents` 路径（本次访问404）。实际可取得的是 [anthropics/cwc-long-running-agents](https://github.com/anthropics/cwc-long-running-agents)，本次检出 `ad107a974bced5244f74dd283dbf2bfd3baee3a1`。

核对 `claude-code-config/.claude/hooks/verify-gate.sh` 和 `track-read.sh` 后：

- 示例保护的是 test-results.json 的 Write/Edit，要求之前 Read 过一个匹配证据文件；不是禁止编辑全部测试目录。
- 文件注释主动说明 Bash 可以绕过、匹配只按 basename、任意证据读取可以解锁任意结果行。因此它不是操作系统级防篡改边界。
- 原文“外部测试 exit 0 自动改 SUCCESS”“连续3次阻断自动回滚”不能从这两个实现得到支持。不能据此宣称硬件级默认失败或零自欺。
- 独立 evaluator、完成标准与证据分离值得借鉴；其 fresh-session 外循环、Stop 自动提交不是 Loom 的默认执行模型。

[unclebob/ub-mode](https://github.com/unclebob/ub-mode) 的工程纪律与变异测试值得做开发参考，但不作为全仓 CRAP 阈值大改理由。先用于少量高风险判定函数，避免为指标拆碎代码或让小改动触发昂贵全量测试。本文中的模型/论文/语音推测不是当前 Loom 优化依赖，本批不拿未经核实的性能数字作结论。

### 文章二：Anthropic 子 Agent 文章

用户 HTML 是对 [Diane Sarkis 的官方文章](https://claude.com/resources/articles/building-agents-when-to-fold-subagents-into-your-main-agent-loop) 的转述。本次核对官方页面：它建议减少不必要的编排，同时保留有独立上下文、并行或权限价值的子 Agent，并没有否定协作。

真正可用的配套库是 [single-agent-loop-kit](https://github.com/anthropics/single-agent-loop-kit)，检出 `c43796287b83bec847db923f07131d1cc8de750d`，README 明示 reference / not maintained。读取了 README、`skill/scripts/compare.py`、`chain_coverage.py`：可借鉴逐任务多次比较和交接覆盖；不能把它当长期依赖或直接取代 Loom 的用量对账。

尤其注意：kit 的 chain coverage 用“调用过哪些 agent 的集合”判断覆盖，不能证明 A→B→A 顺序、消息内容已交付或 peer-return 因果关系。Loom 要沿 Room event→Inbox→Activation→RunAttempt 证据核验，不能只统计出现过两个名字。

### Cindy 源码

[makecindy/cindy](https://github.com/makecindy/cindy) 检出 `d571005ec68e56efbce8b3328c56d9901044b6be`；根 LICENSE 为 Apache-2.0，NOTICE 与依赖许可仍需在实际复制时核对。本批仅阅读，无源码复制、安装或执行其 agent。

| 具体源码                                                            | 借鉴价值                                                     | Loom 处理                                                                                          |
| ------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `packages/maker-core/src/agents/codex/compaction-storm.ts`          | 比较同一次压缩前后水位，忽略有限的零值标记，识别持续无效压缩 | 高价值候选。先读已有 trace 做只读诊断；不照搬3次/0.9阈值为跨 CLI 真理，不因多次正常压缩而熔断      |
| `packages/maker-core/src/agents/codex/retry-escalation.ts`          | 把长时间无进展重试转换为明确诊断                             | 对接既有 Host 生命周期；不能增加第二个调度队列，不能把未知输出推断成完成                           |
| `packages/maker-core/src/agents/pi/cindy-subagent-runner-source.ts` | 子执行单独 usageSegments、结果上限、截断标识与执行记录       | 借鉴“有界结果＋完整证据入口”。不植入其子代理调度器；Loom 继续统计父子总账并防双算，未知不能按0处理 |
| `packages/maker-core/src/agents/shared/auto-compact-controller.ts`  | 压缩 fire-once、压缩后清掉陈旧水位                           | 可借鉴采样规则；其 overflow rollover 不采用，Loom 不能自动换 session                               |
| `packages/maker-core/src/memory/flush-controller.ts`                | 当前实际是日志观察器，避免每阈值反复触发                     | 不能称它已实现自动持久化记忆。Loom 不添加额外静默模型轮次写记忆                                    |
| `packages/project-context/README.md` 与 `src/commands/query.ts`     | 按文件变更映射知识及过期状态                                 | 可用于未来项目知识工具，但非第一优先级；不直接引入 .cindy 文件或替换频道记忆                       |

## 已经存在的能力，不重做

- Task 与 Run 完成分离；`packages/kernel/src/task-review-service.ts` 已有冻结 submission 和 reviewer approval 检查。不能新增“任何命令 exit0 即任务完成”。
- `worker-memory-render.ts` 已区分索引与正文；原生 session 正常续接已保留历史。不能把文章的“共享上下文”误解为每轮重灌所有 box。
- `provider-session-fork.ts` 有独立身份、复制回执和不确定结果禁止静默重试；AGY 的外部接口缺失不应改变统一语义。
- `scripts/cli-efficiency/paired-usage-summary.mjs` 已处理不完整计量和不可比较样本；继续复用，不换成上游简单平均脚本。
- 原生 subagent 是实例内部执行，不是频道成员；人类指定 peer 的任务不能由内部 subagent 冒名完成。

## 按顺序实施的三个小切片

### 1. 收拢完整任务验收，不再追单次 token 比率

优先补验收汇总工具，不动后端业务。复用 `scripts/acceptance/loom-advantage-discussion.mjs` 和现有对账模块；目标报告应回答：最终交付是否满足条件、请求是否真的交给目标 peer、是否存在人工恢复/替代、失败消耗和测量缺口。

每次样本独立记录：case ID、代码/产物版本、精确 CLI/model/effort、记忆/子代理策略、所有 Run 和 descendants 覆盖、任务判据、关键因果 event ID、执行证据、人工介入、墙钟耗时、生成次数、input/cache/output 及可归属账单。未知保留未知。缓存命中影响费用，不从 raw input 中随意相减。

先整理下面10类已有用例，不重新造一套测试框架。定向 fake 测试只证明状态机；实模型质量须多次样本。不同 CLI/model 分层，不把 provider 混成一个均值。比较单实例与双实例时先满足同一最终目标；原生/Herdr 对照关闭自动记忆、保持同等权限与子代理政策。报告成功率、失败总账及成功样本分布；失败不删除。不追求每对0.9–1.1，不把任何一次1.3当系统性缺陷。

### 2. 消耗来源诊断，先离线再考虑运行时拦截

复用既有 Run/usage/compaction 记录，区分新请求、正常续接、缓存、重试和压缩；没有原生信号时只报未知。首个用例是同一次 compaction 的 pre/post 配对。先用已有日志和固定夹具确认确实存在重复无效工作，再提出 Host 中断策略；不能预先给所有 CLI 加“3次就杀”。AGY 缺上下文信号，不伪造该指标。

### 3. 有证据再精简交接输入

先判断反复读取的是同一证据、过期证据还是新事实。复用稳定 artifact/message ID 和有界读取，只在需要时取正文；回复格式可以推荐“结论、证据位置、未解决项”，不在 Kernel 写死 A做/B审流程，也不把摘要设成强制有损通道。用户消息、权限和新身份通知不为减 token 随意删除。

### 暂不推进

整合 Cindy 主循环、自动 session rollover、自动记忆 flush、全局严格禁改测试、默认生成器/审查员永远循环、Raft/Cindy 前端切换、安装第三方 MCP 管理平台、全仓复杂度/变异测试改造。没有实测收益之前也不称“重构必能降本”。

## 10类验收覆盖索引（本批仅映射，未宣称重新运行）

| 场景                   | 现有入口/证据                                            | 还需报告的任务层判据                           |
| ---------------------- | -------------------------------------------------------- | ---------------------------------------------- |
| 单实例长任务           | cli-efficiency 对照工具                                  | 原生波动分布与同目标完成率                     |
| A 请求 B，B不@自动返回 | kernel/test/peer-reply-return.test.ts；AGY closeout 实证 | 严格三段因果及最终产物，而非仅见三条回复       |
| 多实例明确@选择        | kernel/test/human-mention-wake.test.ts                   | 无关实例未被唤醒                               |
| 忙时新信息与人类纠正   | kernel/test/channel-steer.test.ts                        | 最终结果采用纠正，peer不能冒充Human steering   |
| 私密消息隔离           | kernel/test/instance-private-box.test.ts                 | 不泄漏到频道/同伴                              |
| 新成员长历史           | kernel/test/instance-first-wake-catch-up.test.ts         | 信息完整性与有界获取，不以摘要替代权限         |
| 重启后的连续工作       | agent-host/test/agy-print-runtime.test.ts 等provider测试 | 同session及配置，真实重启证据单列              |
| Fork新身份             | kernel/test/instance-fork.test.ts                        | 历史继承但身份不混淆；AGY当前不支持            |
| Side只读与丢弃         | kernel/test/instance-side.test.ts、side-discard.test.ts  | 不能修改源频道；不支持provider明确跳过         |
| 失败/审查拒绝/预算停止 | kernel/src/task-review-service.ts、acceptance讨论工具    | 未验收不成功，失败成本、人工救援和未知必须保留 |

以上是后续工具应读取的稳定场景目录，不是10个新测试已通过。本轮没有付费测试，没有后端修改，不需要服务重启。
