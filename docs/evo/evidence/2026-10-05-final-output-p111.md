# P111：Codex warm 显式最终输出三轮对照

2026-10-05，owner持续授权，干净源码 `dcd2d5330cd50fab0de43c9fe6be90f2ec0f730e`。Codex 0.160.0 / `gpt-6-luna` / low；同一固定 P97 两文件快照、原生三轮后 Loom warm 三轮。[脱敏原始结果](2026-10-05-final-output-p111.json) 的机器状态保持 `needs-quality-review`，测量结论为 `within-budget`。独立审查确认核心技术结论在该有限样本内可接受，机械约束通过；准确回顾前文仍有瑕疵，不能写成全部质量或全部指令无瑕疵通过。机器原始状态不回写。

| 指标         |                     原生 |                     Loom |
| ------------ | -----------------------: | -----------------------: |
| 每轮模型生成 |                2 / 1 / 1 |                2 / 1 / 1 |
| 每轮 input   | 22,121 / 13,630 / 13,970 | 27,587 / 16,477 / 16,895 |
| 总 input     |                   49,721 |                   60,959 |
| 总 cached    |                   34,048 |                   42,240 |
| 总 uncached  |                   15,673 |                   18,719 |
| 总 output    |                      852 |                      934 |
| 每轮工具调用 |                1 / 0 / 0 |                1 / 0 / 0 |

原始 input 倍率 **1.226**，uncached 倍率 **1.194**；首次生成输入差 2,708 tokens。双方各四次生成，没有增加协议工具调用。所有已记录的产品 usage 均在 Room 回复前，四条 usage 与总量一致、无 gap；这不是凭最后 usage 到达时间推断额外生成，也不证明供应商 HTTP 请求数或账单金额。预算依据仍以[目标合同 §6](../target-contract.zh-CN.md)为准，不调整分母或扣除本次额外 input。

原生每轮 spawn 配置明确关闭 `features.memories`、`memories.generate_memories`、`memories.use_memories`；不是把临时 HOME 冒充官方 memory-off。每个 arm 内保持同一 native session、模型和 low effort，两个 arm 各用独立 session。Loom 的执行模式为 cold / warm / warm，同一 instance runtime，三个 Run 各一次 attempt。

独立 Kernel 证据：三个 Activation 均 completed，delivery `toSeq` 为 4 / 13 / 22，ACK cursor 到 22；三个 final marker 的 `submission_kind=final-output`，发布序号 9 / 18 / 27。模型在最终 envelope 显式回填本轮 `basedOnRoomSeq`，应用服务沿原 Run 凭据发表并走既有 ACK 确认，未以 CLI 退出代替 ACK。没有请求 final interrupt；因此 `preemptedFollowUp=unknown` 不应写成“中断节省一轮”。

独立质量审查的共同判断是：核心事实、PID 不等于真实性、函数级与流程级保证区分基本成立，无 P108 式“PID 足以证明可信”的关键错误。仍有瑕疵：Loom 对“无法证明写入权限”的概括忽略了源码写入 `0600` 及相应测试，未知应限于外部改写或目录保护；后两轮撤回的部分强断言并未出现在自身上一轮中。原生第三轮把可用的行为刻画测试改为依赖新增真实性机制的测试，明确当前函数不能通过，不能称为等质无瑕疵对照。真实性机制只是条件，不是本次两文件已经证明存在的能力。Loom 三轮中文字符数为 247 / 236 / 202，符合题面 400 / 300 / 300 的限制；每轮一次最终回答。双方首轮均以一次 exec 只读相同两文件，工具输出相同且完整（14,728 字符，无截断），后两轮无工具或重读。六个实际 turn_context 均为指定模型和 low；Loom 三个原生最终 JSON 合法并分别回填 4 / 13 / 22。

本批只证明单实例、单目标、固定只读三轮场景的显式最终输出与效率；不覆盖多方协作、附件、held 恢复、不同 CLI 或长期上下文。正式开关保持关闭；付费 gate 中启用候选不等于默认部署验收。[P109](2026-10-05-final-output-p109.md) 与 [P110](2026-10-05-final-output-p110.md) 的失败和已发生消耗继续保留，未借用它们的分母。

原始目录：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-cli-efficiency-tx7ng5`。原始 result SHA-256：`60bcd50b13ac710b0b6361f945a09c8002e7dcd120a54fb41192ca612378a0b3`。公开 JSON 仅将临时 root 替换为 `<tmp>`，保留原机器结论、答案和数字；独立私有审计在 `~/.loom/reviews/2026-10-05-final-output-product/codex/p111/`。

剩余输入的只读分析：两边原生默认系统指引完全相同；产品额外平台指引约7,363字符，每轮消息包装约多270字符。生成轮数相同，因此本样本的剩余差主要表现为每次携带的内容增加，但不能把字符数转换成精确token归因。付费rollout未提供完整provider请求中的schema/工具定义，未调用MCP也不证明其定义零成本。后续优先审查平台指引的重复说明，再以免费请求结构差分和独立配对样本验证；本批没有继续修改prompt或补跑。
