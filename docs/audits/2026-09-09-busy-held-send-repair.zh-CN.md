# 忙时追加消息与原草稿恢复修复

状态：恢复机制已实施；真实追加请求部分通过，原措辞仍漏原回复，整项未签收。范围仅为忙时发送被 freshness hold 后的恢复路径。

最新纠偏见[完整 prompt／工具与版本重新取证](./2026-09-09-raft-upstream-prompt-tool-refresh.zh-CN.md)：工具合同仍未调平，不能把恢复路径可用称为完整机制对齐。

## 来源与根因

来源为已授权的官方 CDN Raft Computer 1.0.18 SEA 二进制（https://cdn.raft.build/computer/manifest.json），并非 npm `raft-computer@1.0.18`；本地分析目录 `raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/`。
`packages/daemon/dist/dist-UT7IQEHX.js` SHA-256 为 `21b1bb9e6ed5ec2c7d5303a09e81e9b8bcf67c81c46b1994ec803c13382a42c1`；约 9107 行 `formatFreshnessHoldOutput`、9735–9830 行发送处理：保存草稿，向当前 Agent 呈现新消息并记录目标已消费序号，返回 `SEND_HELD_AS_DRAFT`，允许审阅后重发原稿或改稿。

[上一轮双边实证](./2026-09-08-frozen-core-four-class-acceptance.zh-CN.md)中，Raft 在真实 sleep 期间收到追加消息，原发送被 hold，随后同轮 send-draft，原回复与追加回复均发布。RAH 三次漏原回复。

RAH 根因包括：

- held 返回的 seenUpToSeq 不属于 Activation 已交付序号，直接用于重发被拒绝；普通 sync 仍冻结在原范围。这些围栏本身正确，缺的是向 Agent 暴露已有的目标读取／签名回执恢复路径。
- CLI 将 held 当作退出码 0 的成功结果，未提供可执行恢复指引。
- 常驻运行指令明确要求 held 后 ACK 原游标并成功退出，将草稿留到下一 Activation；这与 Raft 的同轮恢复行为冲突。

注意：Raft 新撰写回复也会替换同目标旧草稿，不能把“替换草稿”本身当作已证实的独有差异。本批不更改草稿替换、TTL 或自动发送策略。

## 实现边界

这是行为的结构移植与 RAH 接线，不是逐字复制 bundle。原始 npm bundle 仅为分析证据，不进入生产依赖；未新增第三方源码或变更既有授权声明。检索 Multica server/packages 未发现同等 freshness draft 恢复实现，采用已验证的 Raft 合同。

- Kernel 使用现有 Room/DM/Thread 寻址 owner 生成 `recoveryTarget`，不新增 cursor 或队列。
- Worker CLI 保留 held JSON，返回非零退出码与审阅／重发／改稿路径。
- 常驻指令要求当前 Run 审阅目标的新上下文，决定恢复原结果或修订，不再命令无条件退出。
- 继续使用已有 `room-read` 完整窗口和签名 contextReceipt；不放宽 Activation sync/ACK、Task 权限、成员检查或 Run 围栏。
- 不自动发布草稿，不把 materialization、CLI 退出或模型承诺视为交付。

## 验证记录

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-09-busy-send-repair`。

TDD：CLI held 非零退出／恢复指引与 HTTP 忙时原稿恢复用例先失败，修复后通过；错误退出指令的测试先失败，改正后通过。HTTP 用例验证原稿通过签名目标回执发布、重复重发幂等、普通同步仍冻结、伪造新游标仍拒绝。Thread 原目标、跨 Run 附件及评论草稿回归覆盖不变的身份和寻址围栏。

首次真实 DeepSeek 复验 F0909A 仍失败：工具已返回新指导，但旧常驻指令仍要求退出。这是定位第三个根因的失败证据，不能计为通过。后续结果如下，失败没有被成功样例覆盖。

| 实验   | 条件与结果                                                                                                                              | 裁决                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| F0909B | 删除无条件退出指令；沿用旧追加措辞。Agent 同轮 room-read 后发布 FOLLOWUP，仍未发布 BUSY                                                 | 恢复路径可用，原场景不通过             |
| F0909C | 明确“追加、不取消也不替换，先发送原结果，再发送追加结果”；DeepSeek 原稿 send-draft 后另发追加结果，两条各一次                           | 本地真实模型通过；输入不同，不能抵销 B |
| F0909D | 同 C 的明确追加请求；OpenCode 忙时配置切换 Codex，旧 Run 的两条回复已发布，后续 Codex Run 结束后没有重复                                | 本地通过；不是断电后的草稿恢复实验     |
| F0909E | 增补“追加不取消原结果，未发布不算重复”的运行指令，重新使用原措辞；DeepSeek 曾错误组合 body/send-draft，最终仍把追加回复当改稿，缺原回复 | 不通过；提示词没有提供可靠保证         |

C/D 的 canonical 消息各严格两条，分别核对精确正文、顺序和 ID，队列排空后断言，没有只用 includes 或 CLI 退出码充当交付证明。`native-visible-tools.json` 只保存命令／工具结果与模型字段，不保存推理正文；OpenCode 原生记录确认 deepseek/deepseek-v4-flash，variant=low。D 的新 Run placement 选择 gpt-5.6-sol/low；本批未另外核查 Codex 原生配置回执，因此不把 placement 单独冒充完整底层配置验收。

新一轮 Raft C 实验的浏览器发送未得到消息或执行标记证明，不计为已运行；本批上游行为依据仍是上一轮 F0908S2 的实景及对应源码，官方当时未暴露 OpenCode effort 选项，不能声称与本地 low 完全同参数。

## 尚未收口的边界

原措辞的实际结果仍与已观察到的 Raft 结果不同。已经排除了“无合法新上下文重发路径”和“平台指令强迫退出”，不能因此推断所有剩余问题都属于后端丢消息；B/E 可见的是模型主动选择了新正文替换原稿。Raft 同样允许改稿替换，所以禁止改稿或自动发布原稿都不是本批有证据支持的直接移植。

需要继续区分：明确取消／替换与独立追加的意图、原回复与改稿的关联、跨 Run 如何呈现尚未处理草稿、更多 Agent/Thread 交错条件。不能用继续加提示词、提高 effort、重复抽样直到通过，或“永远自动发送旧稿”宣告完整收口。

## 检查及部署

最终代码的 `npm run check`、`npm run format:check`、`git diff --check` 和正式 Web 构建均通过，日志保存在证据目录。`test:web:worker-message-tools` 的 Chrome/Firefox 桌面及移动用例通过，已查看截图；它使用明确标识的 Fake CLI，与 C/D 的真实模型证据分开。真实浏览器已查看隔离 DM 中 C 的两条回复，正式 Room 的历史和输入框已恢复。

首次检查正式实例时，旧 PID 已不存在，4173 无监听。正式状态确认无活动 Run/Activation，完成 `formal-backup` 和摘要校验后以持久状态重新启动；保留历史、配置与私有记忆。最终再次通过 guarded restart 执行闲置检查、备份校验和温和重启，正式构建 `6f5e7daf9d9a0e1acf8b16c389e31a1342fc323c92208f59e57dbb834bc97dda`，实际返回的 HTML 与冻结资产摘要一致，新浏览器页面可读原 Room 历史。进程信息见 `final-formal-verification.json`。隔离测试服务已在排空和验证备份后停止。没有提交或推送代码。
