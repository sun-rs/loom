# Provider Session 连续性与 Raft 生命周期差异

后续实施状态：[2026-09-18 P0 第一批](./2026-09-18-latency-p0-repair.zh-CN.md)已增加启动聚合、Kimi ACP 恢复去重与停止围栏；原生 system/常驻实例/steer 差距尚未据此闭合。下文是修复前的机制取证基线。

日期：2026-09-17。范围：复核用户提出的“长期运行上下文不能被消息箱与 Markdown 记忆替代”以及 RAH 是否偏离 Raft 的原生 Session 机制。本次只分析和运行隔离 fake 协议测试，不修改生产机制，不运行付费 Provider，不清理会话或记忆。

## 核心结论

用户关于运行上下文价值的判断成立，但必须区分 **Provider session、运行实例、模型 turn、消息箱/Room、文件记忆**。RAH 已有四家 Provider 的原生会话恢复，不是每次 Activation 都创建空白 Session；本次实际慢请求正是在旧 Session 上继续运行。与此同时，RAH 的确没有完成 Raft 的常驻运行生命周期：本地把 Activation/RunAttempt 的收口绑定到了 RuntimeProcess 终止，三个本应可跨 turn 存活的 Provider 被迫退出再恢复；Kimi 还额外把全量 standing prompt 逐轮追加成 user 内容。

因此这是一个**真实的执行生命周期对齐缺口，加上 Kimi 的具体传输缺陷**，不能概括为“所有会话上下文都丢了”，也不能仅以“已经有 resume”宣称对齐完成。Room-first 的权威边界不要求牺牲 Provider 会话连续性。

## 五种状态不能互相替代

| 层                  | 内容与用途                                                                   | 换成全新 Session B 后                                                |
| ------------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Room 持久历史       | 已显式发布的对话、Task、附件、审批等事实                                     | 有权限即可重新读取，但不会自动完整注入模型                           |
| Inbox/Activation    | 哪些事件待处理、当前授权交付范围                                             | 跟随 Agent 身份和交付状态，不是自动重放全部旧对话的 Session 备份     |
| Agent 文件记忆      | Agent 主动写下的 MEMORY.md 与 notes                                          | 可以重读；未写下的工作过程不能凭空恢复                               |
| Provider session    | Provider 保存的消息、工具调用/结果、压缩上下文，以及其支持保留的其他原生状态 | 新建 B 不自动继承 A；恢复同一 session 才利用 Provider 自己的恢复机制 |
| 运行实例与活动 turn | CLI 进程/SDK 对象、连接、当前执行及临时工具资源                              | 新进程可以恢复持久 session，但不等于保留原实例全部临时状态           |

例如 A 曾运行测试，读到失败栈，排除两个方案，最后只向 Room 回复“已定位，继续处理”。B 即使读完十轮 Room 对话，也没有自动拿到那些未发表的工具结果。只有它们保存在可恢复的 Provider 上下文，或被明确写入记忆/附件/Room，B 才有恢复路径。

用户说的“过程中的思考”不能一概视为可永久恢复的数据：可见工作记录、工具结果、计划和中间结论确实有价值；内部推理状态是否保留、压缩或再次提供给模型由 Provider 决定。即使 session ID 相同，也不能承诺保留每个历史 token。RAH 应复用原生能力，不能自行抓取 thinking 输出作为另一套权威记忆。

另外，Inbox 不是整个 Room 历史的同义词。`worker-delivery-window.ts:64` 从持久 cursor 与本 Activation 范围确定可重放起点，`worker-message-check.ts:10` 分页交付本轮范围。第 11 轮新 Session 只 check Inbox，并不等于自动看到了前十轮所有消息；需要通过 canonical history/read 恢复相关历史。

## RAH 已经保留了什么

`runtime-implementation-registry.ts:816` 的 ProviderSessionKey 由 participant、provider、RuntimeProfile revision、Workspace mount revision、standing-prompt digest 组成；Room ID 不属于存储键。四个 Adapter 都从 Host 私有 store 取得旧 handle，再调用原生恢复接口：

| Provider | RAH 正常恢复路径                                 | 本次真实材料                                                  |
| -------- | ------------------------------------------------ | ------------------------------------------------------------- |
| Codex    | `thread/resume`，再 `turn/start`                 | 同一 rollout 中有多轮 Activation 及旧工具结果                 |
| Claude   | `--resume` + stream-json                         | 同一 session JSONL 含 D1/D2；首轮约 45.6 万 input token       |
| Kimi     | ACP `session/resume`，再 `session/prompt`        | 同一 wire 记录覆盖私聊与新频道；D1 前已有 39 轮               |
| OpenCode | 读取已有 `/session/:id`，在同 ID 上发 `/message` | 同一 session 在 D1 前已有 366 条 message 记录，并继续两轮频道 |

原始计数及哈希见[延迟根因证据](../evidence/2026-09-17-latency-root-causes.json)。这支持“本次正在恢复旧上下文”，不支持“RAH 每次只有 Markdown 记忆”。Codex/Claude 关闭的 Provider auto-memory 功能（`provider-launch-arguments.js:140`）也不是关闭 thread/session 历史；原生恢复路径仍然生效。

正常切 Room 不会仅因 Room ID 变化就切 Provider session；编译器的稳定 digest 还明确排除了 Host/Room/cwd 运行上下文。但角色/指令、有效 delivery mode、RuntimeProfile revision、Workspace mount revision变化可能命中不同 continuity key。这些条件中有安全隔离需要，也有可以进一步核对原生原位更新能力的地方，不能一律删掉 key 围栏。

## 与 Raft 1.0.32 的实际差距

来源为已授权提取的 Computer `1.0.32/main.js`，SHA-256 `531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`。原始制品 URL 与提取记录见[证据清单](../evidence/raft-release-20260916/manifest.json)。这里只解析源码，没有执行或复制发布 bundle。

| 项目                 | Raft Computer 1.0.32                                                              | RAH 当前实现                                                               |
| -------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Codex                | persistent；空闲新 turn，忙时 steer；`main.js:837278`                             | 本轮内支持 steer；turn 完成后关闭 app-server，下轮恢复同一 thread          |
| Claude               | persistent；原生 stream-json 排队，busy direct；`:836632`                         | 已有 gated 忙时通知，但首次 result 就结束 stdin，随后退出、下轮 `--resume` |
| Kimi                 | 原生 SDK，persistent/direct/steer；`:839424`                                      | ACP 逐轮进程，恢复 session；无对应忙时 steer                               |
| OpenCode             | per_turn，具体消息到来才 spawn，完成后退出，再 resume；`:839488`                  | 每轮启动/停止本地 server，恢复同一 session；不能仅凭退出就判为违背 Raft    |
| Kimi standing prompt | `roleAdditional` 放 system 层；`:820569`                                          | 每次把整份 standing prompt 放入新的 user prompt                            |
| turn 完成            | `:847860` 进入 idle/交付后续；仅指定 `terminateProcessOnTurnEnd` 的 driver 停实例 | Host 等 reap/退出，保存终止证明，再完成 Activation                         |

Raft 的 persistent 不等于不断向模型发请求：空闲实例可以等待下次事件而不进行模型推理；也不等于永不重启，异常、配置变化、人工停止仍有重启/恢复路径。RAH 不应把“禁止 LLM 轮询等待人类”解释为“每轮必须销毁 CLI/SDK 实例”。

常驻实例与可恢复 Session 也并非二选一：优先保持实例与 Session，实例需要重启时恢复原 Session，原 Session 确实不可恢复时才走新会话加 canonical 历史/文件记忆的降级。

## 根因所在：有限 Run 与进程寿命耦合

这不是 UI 问题，也不是少传一个 `--resume` 参数。

1. `runtime.ts:53` 的 RuntimeAdapter 用 `start/cancel/reap` 和 RunExit 表达执行结果，没有独立的“本轮已静止，但宿主实例继续存活”收口接口。
2. `agent-host.ts:635` 等待 `runtime.reap(run)`；`:858` 起先写 RuntimeProcess termination proof、finishRunAttempt，再在 `:893` 完成 Activation。
3. `room-kernel.ts:4837` 拒绝完成仍有关联非 terminated RuntimeProcess 的 Activation；`:3974` 的 RunAttempt 结束检查同样要求终止。
4. 每轮 Worker 凭据、环境与 wrapper 都按 Run 签发并在退出时撤销。让一个旧进程直接承接下一 Run，会涉及运行身份和工具授权更新，不能继续使用旧环境里的授权。
5. 对应 driver 主动适配这个模型：Codex `codex-app-server-driver.mjs:233` 关闭 stdin；Claude `claude-stream-json-driver.mjs:218` 在 result 处关闭 stdin；Kimi `kimi-acp-driver.mjs:194` 收口后退出；OpenCode `opencode-server-driver.mjs:148` 等 idle 后停 server。

这是此前建立可靠恢复/取消围栏时选择的有限进程执行基线。后来补了 Provider resume 与 Codex/Claude busy notification，仍没有拆开“运行实例”和“执行轮次”。[08-28 传输审计](./2026-08-28-provider-execution-transport-audit.zh-CN.md)已识别 Raft 的长期 native runtime；[08-29 live-input 审计](./2026-08-29-runtime-live-input-ownership-audit.zh-CN.md)把补齐它列为后续延迟优化；[09-11 Codex](./2026-09-11-codex-native-busy-delivery.zh-CN.md)及[Claude](./2026-09-11-claude-gated-busy-delivery.zh-CN.md)交付也明确没有完成跨 Activation 常驻。现有证据说明这是持续未闭合的架构差距，不是本周某个 UI 改动突然造成的退化。

仅去掉 driver 的退出代码会使 `reap` 不结束、Activation 不完成，进而占住单 lane；直接删 Kernel 终止证明检查则会破坏现有取消/孤儿回收安全。正确修复必须由 owner 分离实例生命周期、回合执行与授权，而非跳过任何一端。

## 另一个连续性边界：第一轮中断

当前 Codex/Kimi/Claude/OpenCode 通常在成功完成后才写 Host-private session evidence。若该 key 还没有旧记录，第一轮被取消，即使 Provider 已经创建了 Session，下一轮也可能因 Host store 没有 handle 而新建。

这是代码和测试明确覆盖的行为：`codex-provider-session.test.ts:230` 断言 interrupted first turn 之后再次 `thread/start`，Kimi 测试也断言 cancel-seed 之后 `session/new`。它不等于 Provider 原始文件被删除，却意味着 RAH 没有自动恢复该部分上下文的入口。已成功运行过的老 Session 不会仅因一次中断就必然丢失已有 handle。

这个边界值得单独修正，但不能把“已分配 session ID”直接当成“已经安全可恢复”。Raft 对 Claude 的 `liveSessionReadyAt=turn_end` 也表明 ID 已知、可恢复、可以接收输入是不同状态。应分别记录这些事实并验证具体 Provider 的中断恢复能力，不能简单把 evidence 写入时间提前后宣称解决。

## 修复方向与验收要求

这份分析不改变现有已接受的 Kernel/Runtime 合同，以下是后续设计需要闭合的内容：

- **保留 Agent-owned Provider continuity。** 同一 Agent 在相容的配置下优先原实例、其次原生 resume；新 Session 是明确的恢复降级，不是默认性能优化。保留跨 Agent 隔离及原生上下文压缩。
- **先修 Kimi 重复注入。** 长期规则用安装版实际支持且已验证的原生 system/role 通道，每轮只传有界输入；不删有效历史、原始 MEMORY.md 或工具上下文来降低 token。
- **把实例与回合分开建模。** Host 持有可空闲的原生实例，Kernel 仍独占 Activation、投递和单执行 lane。完成一轮要有精确 turn 身份、无未完成工具、副作用授权撤销/轮换等证明；显式停实例、异常回收仍需真实终止证明。不能以 Provider turn_end 直接证明 Task 完成。
- **跨 Run 工具权限需有单一 owner。** 常驻 Provider 不能永久持有首轮 Worker grant；当前执行身份、已交付范围、请求幂等、旧授权失效与重启恢复必须可证明，且不能新增第二份消息队列。
- **补齐各家的真实能力。** Codex 保留原生 steer；Claude 对照 1.0.32 direct queue，而非无条件继续旧 gated 策略；Kimi 对照原生 SDK steer；OpenCode 保留有来源的 per-turn 降级，不强求四家完全相同。
- **连续性测试不再只验证 handle。** 连续十轮保留同一 session，第十一轮能利用前轮未发表到 Room/记忆的测试工具事实；重复规则计数不随轮次增长；覆盖 idle 唤醒、busy 纠正、第一轮取消、恢复失败、原生压缩、角色变化和 daemon 崩溃。真实付费语义测试必须单独授权/按既有授权范围运行，不能用 fake 协议通过来冒称模型记住了事实。

大上下文本身并非缺陷：历史工具结果可能正是用户需要保留的价值。上一份[延迟根因报告](./2026-09-17-latency-root-causes.zh-CN.md)中的大输入数字解释了比较条件与潜在成本，**不构成默认换新 Session、裁剪历史或用 MD 替代运行上下文的理由**。system prompt 作为当前模型请求上下文仍需存在；持续 session 可以避免反复应用层追加、重建与读取，但不保证所有历史和规则之后都不计 input token，也不保证供应商缓存始终命中。

## 验证状态

源码核对与既有真实运行材料支持上述连续性/生命周期区分。四 Provider 的既有 fake session 测试及 standing-prompt compiler 测试共 24 项通过，用于复核 resume、fallback、取消和 digest 边界；它们不是常驻实例或真实语义记忆验收。此次只新增分析文档，无产品代码、配置、Agent 记忆或在线进程变更。
