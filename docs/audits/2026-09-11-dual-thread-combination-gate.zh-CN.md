# 双Thread组合验收

本批只新增独立测试 `packages/daemon/test/real-dual-thread-gate.test.ts`，不修改产品、现有门禁或调度。使用临时数据库与工作区，不接触正式实例。

## 上游依据与边界

Raft Computer 1.0.18 的 `main.js:735562`（SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`）`buildThreadsSection` 明确：Thread附着于消息；收到Thread消息应回同一target；被提及时先读该Thread；不允许嵌套Thread。来源路径和版本详见[Runtime预检](./2026-09-11-runtime-bilateral-preflight.zh-CN.md)。本场是这些寻址规则与用户多Agent要求的组合实验，不声称上游规定了特定计算提示词。

RAH规范Message只有threadId，没有独立parentMessageId；父锚点由Thread.rootMessageId持有。门禁验证Message.roomId/threadId与Thread.roomId/rootMessageId完整对应，不伪造不存在的父字段。`worker-message-routing.ts:238`对多目标合并Activation拒绝猜测默认target，是当前单一寻址owner。

## 场景与判据

Human建立两个Thread并临时分工：A由Kimi执行1+2、OpenCode审计，B反向执行2+3并审计。执行前各自创建不同标记并sleep20，RESULT→PASS→DONE必须留在本Thread；A实际开始且有leased执行时，再向A追加独立NOTE请求。双方可以同时工作，同一Agent也须处理两个Thread，不能混用上下文。

精确绑定Kimi `kimi-code/k3/high`、OpenCode `deepseek/deepseek-v4-flash/low`，目录不支持则失败，禁止fallback。角色没有固化为产品角色，仍由本次Human消息指派。

验收要求7条独立Agent业务消息：两个RESULT/PASS/DONE和一个NOTE；发送者正确、每个标记一次、Room/Thread/根消息准确、结果3和5准确、各自因果顺序成立。之后队列静止并观察20秒无新增消息。不用stdout、CLI退出或Agent声称完成代替账本。

验证器先红后绿：初版只统计标记，错误Room反例未被拒绝；完善Room、Thread、root、唯一Message ID和结果断言后，错误目标/父锚点、缺失、重复、合并两答及错误结果均被拒绝。无付费运行的测试和类型检查通过后才开始一次真实门禁；失败不改提示词重跑。

## 实际运行

一次运行耗时409秒，临时现场 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-real-dual-thread-wWuWIY`，日志 `/Users/sun/Code/reviews/rah_os/2026-09-11-dual-thread/real-gate.log`。**原门禁失败，原因是验证器的因果顺序匹配缺陷，不是已证实的产品串线。** 审计者在PASS正文中引用下一步的DONE标记，旧顺序查找未限定发送者，把该引用当成执行者已发DONE。

本次实际七条业务消息齐全，逐条发送者、Room、Thread、root、唯一性和计算结果断言先通过；最后所有Activation自然完成，才进入错误的因果断言。没有为凑通过修改提示词或重新付费运行。

补充反例先红后绿后，顺序查找绑定每个标记的预期发送者。用已保存 `dual-thread-evidence.json` 离线重放，修正后的目标和因果验证全部通过，日志 `replay.log` 保留。`lifecycle-evidence.json` 另列实际运行时间窗及不同Agent重叠，避免把两Thread串行完成说成并行。

**剩余边界：原门禁因验证器失败，没有执行最后20秒自然静止观察。** 离线重放不能补出该运行证据，故状态为“本次业务与路由结果已复核，完整门禁尚未通过”。随后daemon已关闭，不把停机后的安静冒充运行时静止。本次只修测试，未改产品。

## 其余最小补测

- 跨Room/DM可复用 `real-core-chain-gate.test.ts` 的场景2/3与既有成员范围、DM配对、记忆目录断言，不需要重建业务。
- 真正新会话记忆：现有1117–1159只证明新RunAttempt。应在Agent空闲后经 `/v3/client/agents/execution/reset` 的 `mode=session` 清运行会话、保留记忆；记录操作回执及前后实际provider sessionId不同，再从另一Room/DM问更正后的事实，不把答案放进新提示。正反召回答案须明确判定，目录receipt不证明模型已读。
- 切换/恢复可复用该门禁场景4：冻结placement、实际model/effort argv、其他Agent正常运行、有序daemon停启后不重发请求。其1552使用AbortController有序退出；不能冒充进程崩溃或浏览器断线验证。最小额外组合是在双Thread未完成时切换一Agent并重启，核每个原目标和追加仍可恢复；浏览器断线需主线程另做可见结果对照。

## 官网对应结果与不等价条件

主线程在官网Room `3d1fdd34-3807-45c2-b20a-e1891d36f12b`运行对应两个话题。只读工具回执核对到七条独立发送成功，A全部target后缀efe00c2d，B全部后缀89349909；与主线程创建的两个根消息一致。证据 `/Users/sun/Code/reviews/rah_os/2026-09-11-dual-thread/raft-receipts.json` 含实际Message ID、调用/回执target、时间以及模型白名单。

**不能算同并发条件双边通过。** 官网A初次按钮没有实际落账，后来补送；B的执行sleep窗口08:42:54.171–08:43:14.231，B DONE回执08:43:52.552，而A执行sleep开始08:43:59.656。两个执行等待窗不重叠；官网A追加又在A RESULT之后才发送。原样记录这些条件差异，不用最终七条结果掩盖。当前可确认双方各次回复留在各自话题；真正同忙时并发条件与本地20秒自然静止观察仍需补齐，不能宣布整个核心链高可用。
