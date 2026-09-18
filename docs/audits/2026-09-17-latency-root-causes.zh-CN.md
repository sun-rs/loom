# 短问答、频道与连续输入的延迟根因

后续修复与归因更正：[2026-09-18 P0 第一批](./2026-09-18-latency-p0-repair.zh-CN.md)。确定性复现将停止后旧范围抢跑的直接原因定位到 Placement 候选遗漏 SOS hold，而非既有 queued 合并本身；下面保留本报告当时的取证与判断，最新实现/实测状态以前述报告为准。

日期：2026-09-17。对[上一轮真实测速](./2026-09-17-native-cli-dm-and-channel-latency.zh-CN.md)的持久消息、Activation/RunAttempt、Provider 原生使用量和工具时间逐项归因；对照 Raft Computer 1.0.32 发布源码。此次没有再次调用付费模型，没有修改产品、重置会话或重启服务。

## 结论

RAH 的慢不是单一的数据库、网络或渲染问题。已确认的结构性来源是：**Kimi 把完整长期规则重复追加进用户历史；实际 Agent 恢复了远大于原生新会话的上下文；回答前后的串行模型/工具往返；停止后的旧 Activation 重跑；频道的新鲜度恢复与同伴回复引发的额外执行。** Kimi 忙时缺少 Raft 对应的原生 steer 能力，又把运行收尾放大为后续输入排队。

这些发现足以确定修复顺序，但不能把所有模型等待秒数都算成 RAH 自身耗时。尤其 Codex 的两段分钟级等待，现有记录不能进一步区分供应商排队、网络、内部重试与上下文预填充。Kimi 缓存命中率很高的一轮也出现 89 秒首 token 等待，说明单靠上下文大小不能解释全部长尾。

## 1. 发送短问题，实际使用的上下文很大

以下是 D1 问好的首个模型请求输入 token，包含缓存读取和缓存创建，不是累计会话 token。Codex 使用首个独立 `token_usage_record`；更早还有一条 113,924 的 `token_count` 事件，不混为同一种计数。

| Provider |       原生新会话 | RAH 恢复会话 | 相对规模 |
| -------- | ---------------: | -----------: | -------: |
| Claude   |           15,924 |      456,270 |  28.7 倍 |
| OpenCode |           12,874 |      659,975 |  51.3 倍 |
| Kimi     |           21,255 |      681,392 |  32.1 倍 |
| Codex    | 原测试未保存此项 |      113,965 |   不计算 |

大上下文是已测事实；它对延迟的独立贡献还需要同模型、同会话前置条件的对照才能量化。本机原生样本只有用户问题与 CLI 基础配置，RAH 有长期规则、旧工具结果及协作流程，不能把全部时间差称为纯 daemon 开销。

补充边界：有价值的工具结果和工作上下文应该通过原生 Session 连续保留，大输入本身不等于实现错误；不能据此默认换新会话、截断历史或用 Markdown 记忆替代它。RAH 已恢复同一 Session，但常驻运行生命周期尚未对齐，详见[Session 连续性审计](./2026-09-17-provider-session-lifecycle-parity.zh-CN.md)。

### Kimi 是明确的重复注入缺陷

`packages/daemon/src/standing-prompt-lease.ts:81` 每次交付整份 `compiled.prompt`；`packages/agent-host/src/kimi-acp-driver.mjs:236` 恢复旧 session，`:274` 又把 `options.prompt` 当作新的 `session/prompt` 用户输入提交。它并非放在原生 system/role 层。

原生 wire 记录证实：D1 前已经有 **39 次 turn.prompt，39 次全部包含长期规则，正文累计 1,880,541 字符**。本次每次又追加 **48,219 字符**。原始 JSON 序列化长度 48,645 包含转义和包装，不能当作正文长度。D1 请求携带 317 条消息、681,392 输入 token，其中 662,192 未命中输入缓存；D2 新一轮即涨到 692,107。两轮频道及消费同伴回复后涨到 742,998。

Raft Computer 1.0.32 `main.js:839424` 的 `KimiSdkDriver` 明确使用 `roleAdditional` 挂到 system 层，不需要每轮重新声明；同时是 persistent/direct/steer。这个差异在[09-11 的旧审计](./2026-09-11-busy-latency-root-cause.zh-CN.md#kimi传输层的进一步确认)已经出现，本次确认仍未闭合。不能把之前的诊断记录视为修复完成。

### 其他三个 Provider 不能套用同一病因

OpenCode 在 `opencode-server-driver.mjs:464` 使用原生 `system` 字段，Codex 在 `codex-app-server-driver.mjs:146` 使用 `developerInstructions`。不能说它们也逐轮把完整规则追加为用户消息。

但 OpenCode 当前恢复的旧 session 在 D1 前已有 366 条 message 记录；历史 bash/read/edit 工具记录的 JSON 长度分别约 138 万、105 万、25 万字符。这些是工具输入/输出及元数据的序列化大小，不是当前活跃 token 数；当前 659,975 输入 token 由原生 usage 单独确认。Claude 原生 usage 则确认首轮新建了 456,268 token 缓存，下一题仍带约 46 万 token。Codex 历史还包含运行项目的 AGENTS 内容与多轮环境/工具结果。

这说明“换成新 Room”不等于“新 Provider 上下文”。`provider-session-store.ts:19` 的键由 participant、provider、runtime revision、workspace revision、standing prompt digest 构成，没有 Room ID；本轮 Kimi/OpenCode 从私聊到新频道确实延续同一 Provider session。Agent 跨 Room 身份和私有记忆是既定合同，不能据此擅自改成每 Room 一份记忆，或清空用户历史。应先修复错误重复，再核查原生上下文压缩/恢复方式及运行目录规则的适用范围。

## 2. 工具本身很快，工具之间要重复等待模型

原生 CLI 一轮可以直接输出答案；RAH 要先取得工作上下文，再显式发布 Room 消息。这是产品能力带来的成本，但当前引导还会让模型花额外轮次读取环境、重复读取消息及收尾。

| 场景           | 正式回复前的实测路径                | 主要等待位置                                          |
| -------------- | ----------------------------------- | ----------------------------------------------------- |
| Claude D1/D2   | 读取 Activation 环境 → check → post | 每个工具决策都经过一次模型请求；回复后又 check、final |
| OpenCode D1/D2 | check → read → post                 | 工具之间约 9–11 秒；回复后又 read、final              |
| Kimi D1/D2     | check → post                        | D1 首轮 TTFT 87.834 秒，第二轮 11.487 秒              |
| Codex D1       | 引导/环境与交付检查 → post          | 两段长等待；check 0.627 秒、post 0.102 秒             |

例：OpenCode D1 check/read/post 各约 0.678/0.239/0.236 秒，正式回复却是 36.670 秒。优化 SQLite 毫秒级查询无法消除模型往返的数十秒。Kimi D1 原生指标显示请求构造 2 毫秒、CLI 标记的 server-first-token 87,832 毫秒、解码 1,530 毫秒、客户端消费 10 毫秒；这可排除 UI 动态显示或本地流解析积压为该段主要原因，但 server-first-token 仍包括 Provider/网络等待，不能称为纯推理时间。

本地 owner 是 `standing-prompt-compiler.ts:126` 的环境/manifest 引导和 mandatory `message-check`，以及 Worker 的交付确认合同。Raft 1.0.32 `main.js:836169` **也有不含正文的 inbox notice**，允许 `message check` 或目标 `message read`，并非所有输入都直接附完整正文；`:844217` 起还区分首次唤醒、Thread join 与 resume catch-up。Raft 自身也有记忆初始化。因此不能把“需要读消息/读记忆/显式发帖”整体判为 RAH 缺陷。

应合并的是可以由同一 owner 安全提供的重复环境/交付信息，减少不必要的 LLM 决策轮次；不能绕过显式发帖、授权、已交付范围与因果屏障，更不能把模型 stdout 当作 Room 回复。

## 3. 停止后重发：新问题确实先等了一遍旧问题

这是对上一份报告的实质性更正。“首个 RunAttempt 59–235 毫秒内启动”不等于“新题开始执行”。Codex D2 的首个运行属于旧 D1。

时间统一为 UTC，可加八小时查看本地时间：

| 时间         | 事实                                        |
| ------------ | ------------------------------------------- |
| 05:34:22.340 | D1 已正式回复                               |
| 05:34:28.386 | 测试发出停止请求                            |
| 05:34:32.825 | 旧运行获得终止证明，停止完成                |
| 05:34:32.989 | D2 正式消息落库                             |
| 05:34:33.178 | 重跑旧 D1 Activation，范围仍为 seq 13–13    |
| 05:36:02.625 | 旧 Activation 执行结束，没有新增正式回答    |
| 05:36:02.630 | D2 自己的 Activation 才启动，范围 seq 25–26 |
| 05:36:28.141 | D2 正式回复                                 |

因此 D2 的 115.152 秒 = **89.641 秒等待自己的 Activation + 25.511 秒本轮运行到回复**。上一轮不能用第一个进程启动时间排除排队问题。

根因在 `activation-cancellation.ts:167–214`：获得终止证明后，把原 Activation 重新置为 queued，只合并取消时已经存在的 follow-up。若新 Human 消息在停止完成之后才到，`room-agent-sos-service.ts:214–282` 会解除 hold 并派生 resumed 事件，却未把这条纠正输入合入那个旧范围，导致旧运行先启动、新输入留给下一次。

修复应由 Kernel 定义停止后恢复输入的归并语义，覆盖“停止前已发出回复”“停止完成后追加”“终止中追加”和幂等恢复。不能以看见 Agent 回复为由直接完成 Activation，也不能在进程未终止时开启并发执行。

## 4. 忙时追加：回复发出不等于执行通道已释放

原生记录和 RunAttempt 结束时间显示，D1/D2 正式回复后的占用时间分别为：Claude 10.327/11.300 秒，OpenCode 20.611/22.107 秒，Kimi 8.341/8.024 秒，Codex D2 14.860 秒。Codex D1 的尾部被人为停止，不能作为自然完成样本。

频道 P1 更明显：Kimi 05:30:58.243 完成发帖工具，最后一轮 end_turn 到 05:32:35.552 才结束，间隔 **97.309 秒**，其中首 token 等待 96.504 秒；这段不是用户可见回复时间，却会影响后续工作开始。

RAH Kimi ACP 没有 direct/gated busy capability，`runtime.ts:73` 与 `standing-prompt-delivery.ts:8` 因而走 wait。Raft Kimi SDK 支持运行中 `session.steer`。ACP 的第二次 prompt 不能直接冒充 steer，旧审计已经确认它会拒绝 busy prompt。Codex/Claude 在本地已有 direct/gated 支持，不应错误宣传“四家全部没有忙时输入”；OpenCode 的逐轮生命周期本身也不能直接认定与 Raft 不符。

优化方向是补齐经验证的原生忙时输入与执行生命周期，并减少无必要的模型收尾轮次。持久 follow-up 仍然是恢复依据；工具返回、steer accepted 或发帖成功均不能代替执行终止证明。

## 5. 多 Agent 频道增加了两层成本

**先回者会触发后回者的新鲜度恢复。** P1 Kimi 发帖前已经有 OpenCode 回复，post 被存为草稿，接着 send-draft，额外工具结束间隔 8.822 秒。P2 OpenCode 同样在 Kimi 已回复后被 hold，从首发帖工具结束到 send-draft 成功又用了 11.060 秒。阻塞来自真实新事实，不是已经修过的“同一交付内容重复 hold”；不能重新删除 freshness guard。

**同伴回复又产生后续消费。** Kimi P1/P2 后各有一轮只 check 同伴消息、没有新正式回复的执行（约 23/19 秒的 prompt 到 end_turn），每轮却仍追加完整 48,219 字符。这既增加模型调用，又加重上下文。当前频道投递允许成员看见同伴消息，不能为了测速默认取消 Agent 间沟通；应检查空转收尾、重复唤醒及有效忙时交付，保留既有成员/关注/静音规则。

这解释了为什么新建频道、只要求每人一句话仍可能很慢：它复用了旧 Provider 上下文，且成员互相产生新事实；问答本身的字数不是主要成本。

## 6. 哪些结论尚未得到证明

- Codex D1 750.748 秒的大部分落在 Provider 请求/输出等待。首个 runtime 请求信号到首段诊断文本 385.358 秒，check 完成到 post 开始又约 360.397 秒；更早存在 token_count，所以“首段诊断文本”不能写成真实首 token。第二个独立 usage 117,187 输入中仅 11,008 命中缓存，reasoning output 为零，但尚不能证明这几分钟全部由预填充造成。原生 Codex D2 本身也用时 92.542 秒。
- RAH 历史上下文更大不等于 Raft 同 Agent 的上下文一定更小；本轮没有取得 Raft 对应运行的 input-token 使用量。已证实的是 Kimi 原生 system/逐轮追加的实现差异。
- Raft 频道实际运行 Computer 1.0.18，1.0.32 是源码对照；Alice/OpenCode 模型不同，Kimi effort 也未配平，且 Raft DOM 采样有空档。不能把它写成 1.0.32 同配置精确性能排名。
- 本机测试脚本确实请求临时 cwd，但 OpenCode 原生日志的 session directory 仍为仓库目录，且原生使用 `--pure`。因此撤回“全部 Provider 已验证为完全隔离临时工作区”的隐含结论；新会话与 token 数仍有原生证据。
- 本轮覆盖了四 Provider 私聊、两 Agent 频道、停止后追加与回复后收尾。Thread/Task 使用同样的 runtime/prompt/交付 owner，会受到这些公共成本影响，但没有独立的新 Thread/Task 计时样本，不宣称已测出各自延迟或所有供应商根因。

## 修复优先级

| 顺序 | 工作                                                   | 单一 owner 与必须保留的边界                                                                         | 验证目标                                                                                           |
| ---- | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| P0   | Kimi 长期规则转原生 system/role 输入，运行输入保持有界 | AgentHost transport；daemon 仍独占规则编译。先验证安装版原生能力，不向 busy ACP 直接塞第二个 prompt | 连续多轮不再把整份规则追加进 user 历史；新会话、恢复、压缩后规则与身份一致                         |
| P0   | 停止后纠正输入归并                                     | Kernel cancellation/SOS/Activation；保留终止证明与单 lane                                           | 停止前后不同到达顺序均不先空跑旧范围，不丢新问题、不重复旧回答                                     |
| P1   | 精简启动/读取/收尾的模型往返                           | daemon prompt + Worker delivery；逐项对齐 Raft notice/read/check，而非删除 ACK/freshness            | 同一短问答减少无必要轮次；交付、失败恢复、重放和正式发帖仍正确                                     |
| P1   | Kimi 原生忙时输入与生命周期对齐                        | AgentHost；持久 follow-up 不变                                                                      | 回答已发出后的收尾不再无条件挡住纠正输入；busy/retry/restart/cancel 回归                           |
| P1   | 旧上下文与运行目录诊断、原生压缩验证                   | Provider session/运行目录 owner                                                                     | 先阻止重复增长，再验证 Provider 原生 compaction。不得批量清空会话、裁剪 MEMORY.md 或新建自研记忆层 |
| P2   | Provider 请求可观测性                                  | AgentHost diagnostics                                                                               | 记录首请求、首 token、工具、缓存、重试及结束；不把诊断升级为 Room 状态                             |

第一次性能复测应拆为：原生 fresh 与 RAH fresh、原生 resumed 与 RAH resumed、固定轮数连续问答、忙时纠正、停止后重发、同模型频道。分别记录正式回复与通道释放时间。保留本次已有用户会话，使用临时 Agent/状态验证新会话，不靠删历史制造“修好了”的结果。

## 证据与核验

机器可读记录：[脱敏根因证据](../evidence/2026-09-17-latency-root-causes.json)。提取脚本：`scratchpad/2026-09-17-latency-root-causes/analyze.mjs`。数据库以 read-only 打开；脚本仅输出时间、usage、长度、操作分类和证据哈希，不复制私有记忆、思考正文、工具正文或凭据。关键断言核对 Kimi 39 次重复输入、三家首轮 token 数和 Codex D2 的旧/新 Activation 区分。

Raft 原始来源为 `https://cdn.raft.build/computer/1.0.32/raft-computer-darwin-arm64`，提取 `main.js` SHA-256 `531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`；下载产物与 provenance 见[原证据清单](../evidence/raft-release-20260916/manifest.json)。本次只解析发布材料，不执行或移植 bundle；没有新增第三方运行依赖。`buildPrompt` 在 `main.js:815039`，native Kimi 在 `:839424`，inbox/具体消息输入在 `:836149`，启动分支在 `:844175`。

状态：根因证据提取及只读断言完成；文档/证据格式与 diff 检查完成。**本次没有产品修复、性能改善验收或新部署。** 对现有已通过安全属性的保留要求仍然有效。
