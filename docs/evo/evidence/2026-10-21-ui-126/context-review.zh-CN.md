# Raft 构造唤醒上下文：源码审查

日期：2026-10-21。前置 UI 工作已部署，见同目录 summary.json。
本项仅研究，没有更改 Loom 后端、启动付费实验或验证 Raft 线上开关。

## 固定证据

上游 `botiverse/raft-source`，提交 `db5e399f017d584e49597e3a28757645d6807893`。
以下均为该提交，不以宣传视频代替实现证据：

- [决策与组装](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/daemon/src/wakeSessionRecycle.ts)：`decideWakeRecycle`、`readRuntimeSessionResumeFacts`、`planWakeSessionRecycle`、`applyWakeRecycleBriefing`。
- [近期信息面板](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/daemon/src/wakeBriefingPanel.ts)：`buildConstructedPanel`、`formatConstructedPanel`。
- [记忆文件注入](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/daemon/src/startupMemoryBlock.ts)。
- [实际启动接线](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/daemon/src/agentProcessManager.ts)：回收时保留旧 session 诊断引用，清空新启动的 sessionId，不走原生 resume。
- [服务端开关](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/server/src/services/featureFlagService.ts)：constructed_wake_context，默认关闭。
- [Agent 记忆维护指令](https://github.com/botiverse/raft-source/blob/db5e399f017d584e49597e3a28757645d6807893/packages/shared/src/raftCliGuide.ts)：buildWorkspaceAndMemorySection。

## 实际行为

机制真实存在，但不是每次请求重建上下文。需要服务器启用，且满足旧 session 已存在、无显式恢复 prompt、无阻断的 runtime control、已知闲置时间超过默认一小时、已知上下文超过默认 128,000 tokens。未知信息保守 resume。阈值可配置。

运行时允许集合列了多家，但事实读取分发当前只有 Claude 实现；其他运行时返回未知，不能把列表视为多 CLI 实际支持。另有每十分钟的冷闲置进程扫描，使长驻进程下次启动也走回收判断；它检查待办、最近活动以及后台工作，不能理解为无条件杀进程。

回收会创建全新原生 session，首次输入依次包含：

1. 工作区 MEMORY.md 的有界开头，默认预算标称 4,000 tokens。
2. 旧 transcript 派生的近期消息、活跃对象/文件及近期操作，面板默认标称 8,000 tokens。
3. 普通唤醒 prompt，放在最后。

MEMORY.md 是 Agent 自己维护的持久索引；该组装器读取它，并不调用模型把所有聊天自动生成索引。近期消息与操作则由代码从 transcript 提取；文件尽量现场重读，陈旧对象只保留引用，无法现场读取的观察内容有来源/陈旧标记。这条构造链没有额外摘要模型调用。

默认最多 25 条近期消息、12 条近期操作、14 个展示对象，活跃对象窗口以旧会话最后动作往前两小时判断。消息、对象内容有独立限制。预算采用近似字符/字节换算，不是各模型 tokenizer 的精确计数，尤其不能将标称 4k+8k 当成中文场景的硬 token 上限；系统指令、普通 wake prompt 等也不在这两项之内。面板动作不足五条返回空；读取或构建失败可退化为较少上下文，但仍可能完成回收。这是需要评估的质量边界。

## 判断与 Loom 边界

这是有针对性的冷缓存、大上下文恢复优化，方向合理：避免把已经失去缓存优势的大段旧过程重新输入，并直接提供近期文件状态。不能从代码推出它已经优于原生持续 session，也不能推出所有协作成本问题已经解决。

代价是上下文选择造成的信息损失：早期约束、未维护进索引的承诺、跨文件原因可能消失，模型可能重新读取、复查或返工。温热连续工作的缓存前缀有价值，清空 session 不天然更便宜。比较必须同时看任务完成质量、累计输入/输出、缓存读写和实际费用、恢复工具调用、延迟；用多次同任务对照，不能只看首轮输入变小。

此前 Raft 高消耗观察与此机制不矛盾：版本、运行时、开关、闲置阈值和负载不同。没有当时原始条件与新版本重复实验，不能追溯断言旧消耗已经被修复。源码注释里的 canary 与评估数字属于上游自述，本审查没有复验。

Loom 已约定实例持续原生 session，不可静默轮换；不能直接移植自动回收。此外 Loom 的权威历史是 Channel ledger，transcript 只是诊断，Agent 私有 MEMORY.md 也不是当前共享 Channel memory 契约。可借鉴的方向是显式重启/新实例恢复时的有界上下文编排、文件新鲜度标记和避免重复注入；需先映射已有能力，再由 owner 决定是否提出新能力。此次不扩展冻结后端，也不重启开放式成本实验。
