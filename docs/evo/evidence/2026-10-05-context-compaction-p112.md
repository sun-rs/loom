# P112：上下文精简后回复路径偏离，整批超预算并回撤

2026-10-05，owner持续授权，干净源码 `bd5c0717255e6d20f8cacb085047bdb5c4e1bb92`，Codex 0.160.0 / `gpt-6-luna` / low，固定 P97 两文件题面、同批原生三轮分母。原始结果与测量结论均为 **over-budget**，不改写为通过。[脱敏结果](2026-10-05-context-compaction-p112.json)。

本批 shared standing prompt、bootstrap/workspace 重复层和 final-output system/wake 精简**整体回撤到 `24a6ea8` 的产品源码**，不保留声称“安全节省”的 subset。回撤后的 packages/scripts 与该基线一致；回撤后的完整`npm run check`已重新通过。候选版也通过自动检查，但付费验收失败，二者不相互替代。没有追加付费补跑。308 个 standing 字符、约 100 个 wake 字符的文本缩减不能换算成本收益。

首轮实际路径是：读取指定两文件 → 调用 MCP `loom_reply`，误把频道 `#efficiency` 填入 `threadId` → scope 校验拒绝且未发表 → 读取 `worker help messages` → 按帮助经 CLI `message-post --final` 发表。后两轮沿同一 session 直接使用 CLI final，没有回到最终 JSON 路径。实际 developer instruction 和三轮 wake 都已带上精简后的 final-output 指导，因此不能归因为漏传开关；`outputSchema` 只约束最终文本，不能禁止模型在最终文本前选择工具，或保证被中断的 turn 产生最终候选。

| 指标        |                     原生 |                     Loom |
| ----------- | -----------------------: | -----------------------: |
| 每轮生成    |                2 / 1 / 1 |                4 / 1 / 1 |
| 每轮 input  | 22,156 / 13,687 / 14,002 | 60,435 / 17,367 / 17,945 |
| 总 input    |                   49,845 |                   95,747 |
| 总 cached   |                   35,840 |                   75,520 |
| 总 uncached |                   14,005 |                   20,227 |
| 总 output   |                      866 |                    1,588 |

总 input 倍率 **1.921**，uncached 倍率 **1.444**。首轮双方业务读取均一次，产品多出的 MCP 回复、help、CLI 发表属于协议开销，额外两次生成不得当业务差抵扣。首轮 input、额外生成及回复延迟均超[目标合同 §6](../target-contract.zh-CN.md)的预算；后两轮数值通过不能掩盖整批失败。生成数来自已完成的 usage 记录，不是供应商 HTTP 请求总数或账单金额。

Kernel 的三个 Activation 完成，`toSeq=4/13/22`、ACK cursor 到 22，final marker 位于 9/18/27；但三个 `submission_kind` **全为 null**，证明走的是旧工具 final，不能写成显式 final-output 三轮采用成功。六条 usage 无 gap、与 gate 数值一致。业务发表和 ACK 成功不等于效率通过；中断指标也不证明供应商没有已开始但尚未返回的请求。

双方各自保持同一 native session，六个实际 turn_context 都是批准模型及 low。原生逐轮官方记忆关闭配置 enforced，产品原生 session 记录 `memory_mode=disabled`。两边均完整读取固定两文件，未越范围读项目源码、写文件、写记忆或建 Task；Loom help 是协议读取，不是业务重读。

独立质量审查认为主要技术结论有边界、基本成立，中文字符数原生 331/255/201、Loom 287/244/236 均符合题面限制，发表正文均以“审查结论：”开头且无额外 Room 进度确认。但双方第三轮都出现撤回此前未作强断言的叙述，不能称全部质量和指令无瑕疵通过。收据“过期”只有在 PID/格式校验拒绝时才会失败；不能由两文件推断同 PID 的旧收据均能检测。

[P111](2026-10-05-final-output-p111.md) 的一次有限样本通过不保证路径稳定。本次多段提示共同改变，单样本无法裁定哪一句造成偏离；也不能把首输入观测少 71 tokens 当成精确的提示因果收益。免费假模型可以主动选择正确 envelope，只证明路径可工作。保留本次失败及全部精简回撤决定，不以字符缩减理由保留未经独立验收的子集。

原始目录：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-cli-efficiency-X9qDfT`。原始 result SHA-256：`a8819af512084174052c6944307a6a11c6a19df2ca992f42de96cd5ed583c573`。公开 JSON 隐去临时 root 和 turn 能力值，保留原状态、答案及指标；两个独立审计位于 `~/.loom/reviews/2026-10-05-context-compaction/p112/independent-quality-review.txt` 与 `cost-delivery-review.md`。

后续设计排查（未实施）：`loom_reply`目前允许模型传threadId，P112将频道名误填为线程。可优先评估收窄为沿用原Activation唯一目标，保留显式basedOnRoomSeq及现有多目标/附件回退；这只能减少已知误用面，不能保证模型选用native final或直接声称成本改善。本批不混入schema改动。

回撤后正式服务已备份并优雅重启，产品源码哈希与P111部署相同，业务数据哈希不变；实验开关仍关闭。见[部署凭据](2026-10-05-context-compaction-deployment.json)。本里程碑保存基线与失败边界，不是优化成功或全面验收。
