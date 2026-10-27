# AGY × Codex 最终复审与无 @ 自动返回

2026-10-27，owner 指示继续。源码基线 `ed76bb2f`，本批不修改产品代码。

## 结果与范围

**有限收尾验收通过**：原来的两个实例和原生 session 经 Human 显式恢复后，完成一次真实最终代码复审及无 @ 自动返回。此前无效开场和预算中止仍保留原判；本次不是从最初实现到最终审查全程无人介入的干净样本。

- 原实例：Gemini AGY-3（`gemini-3.8-flash-low` / low）及 Codex Reviewer-2（`gpt-6-luna` / low），模型精确绑定由 placements 核对，未改 Role 或模型。
- 为避免 SOS 恢复广播与单一 peer 请求混在同一个执行轮中，先让两位各回复“已恢复”，确认完成；这是明确的人工准备阶段，两次运行单独计量。
- 然后 Human 只点名 AGY，要求向 Codex 发起最终审查。此后三个运行由 Loom 正常交接，没有手动转述同伴回复。

| 因果位置         | 实际证据                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| AGY 发起请求     | 频道 seq 54，仅显式点名 Codex Reviewer-2                                                                |
| Codex 已收到请求 | 当前 Run 的 presented window 含 seq 54，且 sent_at 非空                                                 |
| Codex 实际审查   | 原生诊断记录有读取两份文件和执行 `node --test test/agy-stream.test.mjs`；输出 10 pass、0 fail           |
| Codex 正常回复   | seq 62，明确接受；正文没有 @，mentions 为空                                                             |
| Kernel 自动返回  | seq 62 的 `replyReturn.sourceEventId` 精确指向 seq 54，请求者为原 AGY Instance ID                       |
| AGY 收尾         | seq 70，`REVIEW_CLOSEOUT_COMPLETE`；所用 Activation 的 from/toSeq 都为 62                               |
| 无回环           | 收尾 mentions/recipientIds 都为空，5 个新增 Run 已结束、5 个 Activation completed，静默复查没有新增 Run |
| 会话和文件       | 两位原生 session ID 与恢复前相同；被审源码/测试 SHA256 前后相同，审查员没有修改产物                     |

Room 账本是业务证据；原生 transcript 只用来佐证测试命令实际运行，不取代交付、完成或权限判定。见 `summary.json`、`reviewer-test-evidence.json`。正式网页已显示最后的审查与收尾，见 `channel.png`。

## 传输与用量

AGY 通过 Host `WorkerFinalOutput` 发布 native-final-text。Codex 通过既有 MCP `loom_reply(final=true)` 发表最终回复，Kernel 随后派送自动返回。这证明“审查员不必再写一次 @”，不证明 Codex 已切成纯 native-final 或不再调用回复工具。

本批共 5 个运行（2 个恢复准备＋3 个复审交接）：

| 阶段               | 已记录输入 | 其中缓存读取 | 输出 | 模型生成次数 |
| ------------------ | ---------: | -----------: | ---: | -----------: |
| 人工恢复准备       |     44,537 |       16,000 |   42 |            3 |
| 最终复审与自动返回 |    100,481 |       91,347 |  591 |            6 |
| 合计               |    145,018 |      107,347 |  633 |            9 |

这是 token 记录，不是账单金额。没有原生/Herdr 对照，不给 Loom 开销倍数或模型质量排名。前两组失败/中止消耗仍在上一份报告中，不能从总历史中扣除。13 个 AGY 目录/effort 的核对结论保持；本批没有新增模型组合、Fork/Side、Fast 或压缩验收。

## 收口结论

AGY 接入的发现、实例调度、会话续接、原生最终回复、逐步骤用量，以及本批受限双实例复审/自动返回链路已有真实证据。本次无需重启服务：仅追加验收和文档，产品仍运行已验证的 `ed76bb2f` 修复。尚未覆盖的长任务成本、全部模型实测和完整无人介入开发流程，不因本批收尾成功而改判。
