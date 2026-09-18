# 后台调度对齐 Raft 1.0.32：施工纲领

日期：2026-09-18。目标：RAH 的后台调度在行为上与 Raft Computer 1.0.32 一致——Agent 回答一个问题时不被塞入整段无关历史，不因为调度而多等数分钟；忙时追加、停止重发、频道同伴回复的处理与 Raft 同构。方法是结构移植 Raft 源码（已授权），本地架构逼出的差异（SQLite 账本、Activation、ACK 栅栏、终止证明、无中心 Server）保留并声明。

上游来源：Raft Computer 1.0.32，`main.js` SHA-256 `531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`，可读 daemon 切片 `slices/packages/daemon/dist/chunk-TEGPBMW7.js`（`AgentProcessManager`、12 个驱动描述符、`createChildProcessRuntimeSession` 的 `turnBoundary/startPolicy/postTurn`、`formatConcreteMessagesRuntimeInput`、inbox notice 退化路径、`turn_end` 处理）。来源与许可边界见 `docs/evidence/raft-release-20260916/manifest.json`。

## 已核实的现状（2026-09-18，正式账本与工作树）

- 内核路径不是瓶颈：消息落库到 Activation 同毫秒，租约 59–235 ms，进程就绪 <0.9 s，工具 1–678 ms；模型等待占 91–99.8%。
- 唤醒输入 `provider-activation-input.js` 仍是固定字面量，不含消息正文；模型先调 `message-check --startup`（已聚合清单、MEMORY.md、消息）再决定发帖，发帖前 2 次生成，回复后 1 次收尾，共 3 次；Raft 1 次。
- 四个驱动回合结束即终止进程；Raft 的 claude/codex/kimi-sdk/opencode 为 `startPolicy: immediate`、`postTurn: keep_alive`。
- 忙时投递：Claude/Codex 直接注入已落地（418 ms 接受），Kimi/OpenCode 无通道；通知 1 s 轮询，不含正文。
- Kimi 恢复会话已不重发全量规则（48,648 → 1,358 字符/轮），但仍是 `session/prompt` 用户层；同会话 A/B 首 token 8,812 → 8,827 ms，无收益；冷缓存一轮 145 s。
- 停止后重发：`placement-candidate-projection.ts` 已加 SOS hold 围栏（伪协议测试通过，无真实模型证据）。
- 无条件 1,800,000 ms 杀进程常量已移除，但正式账本 9 月 18 日仍有 3 次 OpenCode 运行跑满 30 分钟后隔离，须先确认正式实例构建与超时路径。
- 会话作用域：两边都按 Agent 一份、跨 Room、无上限；不是差异项。

## 第三方审计的约束（必须遵守）

1. **准备输入 ≠ 运行时已接收。** daemon 从数据库拼出的正文进入唤醒回合后，必须由运行时侧的接收信号确认，且确认绑定 Activation、RunAttempt、执行凭证与实际投递范围；退化为 notice 的部分保持未读。没有可靠接收信号的 Provider，保留显式的模型侧 `message-check`。stdin 写入成功不是 ACK。
2. **通道释放以原生回合结束为准。** Raft 在 `turn_end` 到来时处理待投递输入、空闲状态并区分是否终止进程；一条帖子可能只是"我开始检查"。禁止"发帖即释放"。目标是去掉人为的额外轮询回合与无新内容的重复启动，不是消灭所有零输出运行。不引入独立的后台记忆整理运行。
3. **system 规则按各 Provider 的真实语义处理。** Raft Kimi SDK 的 `roleAdditional` 在每次请求都渲染进基础 system prompt 并跨压缩保留，"只送一次"不是普适规则；Claude/Codex/OpenCode 的恢复与压缩语义要分别核验；grok 支持 `_meta.systemPromptOverride` 不能推出 Kimi ACP 支持。是否引入 Raft 的 Kimi SDK 属产品边界决定，需先证明兼容性。
4. **常驻与推送按驱动能力逐个落地。** 保留持久队列、执行隔离、断线重放与去重；分别测"落库→运行时接受"与"接受→模型响应"；旧回合凭证不得经环境变量变成新 Activation 的权限。

## 批次与顺序

### 批次 0：能力矩阵与原生结束事件审计（只读，进行中）

按驱动列出：输入接收信号（可否与投递载荷、turn id 关联）、原生回合结束/空闲信号与当前 RAH 结束 Run 的依据、system prompt 在 fresh/resume/compaction 下的语义、忙时投递能力、Run 与进程的耦合点；对照 Raft 同驱动描述符。产出 `scratchpad/sched/driver-capability-matrix.md`，作为批次 1–4 规格的绑定依据。

### 批次 1：唤醒回合携带正文 + 运行时确认投递

- Raft：`formatConcreteMessagesRuntimeInput` 把范围内消息正文放进唤醒输入，末句 "Respond as appropriate. Complete all your work before stopping."；超量时退化为不带正文的 inbox notice。
- RAH：daemon 渲染 Activation 范围 `[from_seq, to_seq]` 的正文（沿用 Raft 的 `formatIncomingMessage` 结构）并附清单与 MEMORY.md，作为唤醒输入；AgentHost 在收到该驱动的**接收信号**后，以 Activation + RunAttempt + 凭证 + 已投递范围向 Kernel 记录"已呈现"，推进 `worker_target_read_positions` 与 ACK 栅栏——只覆盖已确认投递的范围；notice 部分不推进。无可靠接收信号的驱动保留现有 `message-check --startup` 路径，唤醒文本仍携带正文但不代 ACK。
- 不变：显式 `message-post`、因果游标、幂等键、单执行通道、终止证明。
- 验收：临时 daemon 伪协议先红后绿（接收信号缺失/部分投递/拒绝时不得 ACK）；专用真实测试私聊与频道；账本相位表：简单问答发帖前生成次数 2 → 1，首个模型请求前工具调用 0；同会话前后对照端到端与首 token；不在 Agent Council 等正式会话上做。

### 批次 2：以原生回合结束释放通道（重写版）

- Raft：`turn_end` 事件驱动回合结束，`postTurn` 决定 keep_alive/close_stdin/terminate。
- RAH：Run 的结束条件改为"驱动上报原生回合结束 + 终止证明（或常驻模式下的回合边界证明）"；删除 standing prompt 中回复后再 check/final 的引导；同伴回复只在有新范围时排队，避免无新内容的重复启动；不因看到帖子而释放。
- 验收：Run 结束时间与原生结束事件的差值为毫秒级；不出现"帖子已发、进程仍改代码、调度器却认为已结束"的重叠；零输出运行只剩"读了同伴消息后合理不回复"的情形。

### 批次 3：system 规则按驱动语义挂载

- 逐驱动核验 fresh/resume/compaction 下的规则存在性；Kimi 的压缩后保障目前靠文件读取提示，需补强；是否引入 `@botiverse/kimi-code-sdk` 由业主在兼容性证明后决定。
- 验收：每轮 `turn.prompt` 只含正文；一次真实 compaction 后规则仍在。

### 批次 4：常驻进程与推送投递

- Raft：每 Agent 一个常驻进程，`deliverMessage(agentId, …)` 推送；忙时按 `busyDeliveryMode` direct/steer。
- RAH：进程生命周期与 Activation 生命周期解耦，Activation 变为向常驻进程投递的一次回合；凭证按 Activation 发放与回收；outbox 事件触发即时投递，保留持久队列、重放、去重；Kimi/OpenCode 补 direct 通道。
- 验收：分别报告落库→接受、接受→模型响应；同一 Agent 连续消息间无冷启动。

## 验收纪律

- 每批：能力矩阵 → 规格（Raft file:line）→ 先失败的测试 → 最小移植 → 临时 daemon 门禁 → 专用真实测试频道/私聊 → 账本相位表报告。
- 收益只由相位表证明，不预先承诺与 Raft 同速。
- 不在正在使用的正式会话上做破坏性 A/B；Agent Council 保持暂停。
- 与 Codex 会话共存：每次写入前检查其空闲状态与 `git status`，不 stash/checkout/commit。
