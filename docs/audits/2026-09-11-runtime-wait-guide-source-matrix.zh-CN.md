# 等待发送 / Guide：CLI、Raft、RAH 源码能力表

结论日期：2026-09-11。本批只下载与阅读官方源码、已发布安装包和上游测试，不修改业务代码、不安装依赖、不调用付费模型、不重启服务。读过上游测试不等于本机已执行这些测试。

## 用户确定的边界

等待发送由 RAH daemon 统一负责，不要求 CLI 自带消息队列或 steer；沿既有 Kernel Inbox/Activation 持久化，不在 adapter 再造持久队列。Guide 仅在实际 CLI/接入协议支持时提供。Guide 是当前执行的后续模型步骤可以使用新输入，不是修改已经生成的思考，也不是强制中断在途工具。

等待发送是否按条分别开启下一轮，或保持顺序合并一个批次，是另一个显式交付约定；无论哪种都不能丢掉较早问题或只留下最后一条。首个文字片段、工具输出、进程启动均不是“本轮彻底结束”。

本次源码核查时，RAH 只有 native busy 能力开关和自动通知，没有完成用户可选择的 Wait/Guide 合同。后续设置施工见 [Runtime 级 Guide 开关](./2026-09-11-runtime-guide-settings.zh-CN.md)，以下限制仍需按该批验证边界理解。已有 follow-up 不能被宣传为该模式已验收。另外，停止主动通知不等于 Agent 主动回查 Room 时绝对看不到追加；若需要严格下一轮才可见，必须核对消息发布时间、Worker 读取和 freshness，不能仅修改输入管道。

## 版本与可复核来源

已下载官方 Git 仓库并将三项检出到本机安装版本对应 tag，避免用 main 冒充安装版本：

| 项目                      | 本机版本/基线                                                           | 固定 Git commit                            |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------------------------ |
| Codex                     | 0.154.0 / rust-v0.154.0                                                 | `6b9826e3aa83b1a5947db50f4332cb9c65f1b340` |
| Kimi Code（TypeScript）   | 0.39.1 / @moonshot-ai/kimi-code@0.39.1                                  | `5efca0c3116743855c28426000073bfe34a4862f` |
| OpenCode                  | 1.18.30 / v1.18.30                                                      | `3104c1428ec91f809e5ab86631300de41eb6952e` |
| 旧 Kimi CLI（Python）     | 仅作旧 wire 路径参照，非本机安装 CLI                                    | `86f136422a0aae6b217ea49e7ea1d2e8a1defcd2` |
| Claude Agent SDK 官方仓库 | 本机 Claude 2.1.268；仓库主要为文档/示例，不能据此声称拿到 CLI 内核源码 | `80eebc4881da2f11140deb6114f4bceff8da704a` |
| Multica                   | 本地 checkout                                                           | `11861145abc59a0d39c8c8f24ad837d4584e664f` |

Raft Computer 为已提取 1.0.18，bundle SHA256：`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

下载目录：`/Users/sun/Code/reviews/rah_os/2026-09-11-runtime-capabilities/upstream`；逐文件 SHA256、remote、commit 与安装版本：[source-manifest.json](/Users/sun/Code/reviews/rah_os/2026-09-11-runtime-capabilities/source-manifest.json)。所有 clone 都位于产品仓库外，不是生产依赖。

## 四家能力总表

| Runtime   | CLI 本身及可用控制面                                                                                                     | Raft 1.0.18 实际采用                                           | RAH 当前接入                                                         | 裁决                                                                             |
| --------- | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Codex     | app-server `turn/steer`；active turn 校验和 expectedTurnId；输入入当前 turn 队列，下一模型请求前取出                     | persistent + direct，原生 steer                                | app-server 已接 steer；原生通知 gate 已有真实记录                    | 可支持 Guide；不能说即时改变正在生成的 token                                     |
| Claude    | 官方 streaming input 支持持续输入；本地实验已有 queued_command；闭源内核的全部接纳规则不能仅凭 SDK README 判定           | persistent + gated；新会话要首轮 turn_end 后就绪，恢复会话不同 | stream-json gated 已跑通，但新会话就绪条件仍有差异；首结果会关闭输入 | Guide 有依据，但需要收口新建/恢复及结果生命周期，不能宣称完全对齐                |
| Kimi Code | SDK `session.steer`；安装版本自带 `kimi web --no-open`，REST 有 prompts 提交和 steer；ACP 仍明确拒绝第二个 active prompt | 当前用 Kimi SDK direct，旧 kimi 使用 wire steer                | 只有 `kimi acp`，未接 SDK/Web steer                                  | 能力存在，缺的是接入。优先评估已安装 CLI 自带本地服务，不能说必须另装 SDK 或延期 |
| OpenCode  | serve 的 prompt 在运行中写入新 user message，ensureRunning 复用同一 loop；下一 LLM 输入读取它，上游有专门测试            | per_turn + busy none + coalesce_into_pending                   | 已有 serve adapter，但未接运行中第二次 prompt                        | CLI 有 Guide 类能力，Raft 未采用；如启用必须标明相对 Raft 的显式扩展并实测       |

## Codex：明确的当前轮追加

固定版本来源：

- [turn_input.rs:519](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/session/turn_input.rs#L519)：持锁检查 active task、expected turn ID、Regular/Review/Compact 类型；拒绝无 active turn、错轮次、Review 和独立 Compact task，输入按 acceptance order 入队。
- [turn.rs:326](https://github.com/openai/codex/blob/6b9826e3aa83b1a5947db50f4332cb9c65f1b340/codex-rs/core/src/session/turn.rs#L326)：在下一模型请求前消费 pending 输入；首个采样及自动 compact 后的恢复步骤有延后消费条件。`has_pending_input` 会让执行继续。
- `app-server/src/request_processors/turn_processor.rs:1006`：协议要求 expectedTurnId 非空；`app-server/tests/suite/v2/turn_steer.rs` 覆盖无 active、过大输入、active ID 等。

因此回执代表进入当前 turn 的输入队列，不证明模型已经消费，更不证明新问题已经回答。取消、崩溃后的未答问题仍应由 RAH 持久状态恢复。

## Kimi：需要纠正此前“只能 SDK”的结论

[SDK session.ts:193](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/node-sdk/src/session.ts#L193) 明确暴露 steer。当前安装版本还包含：

- [本地服务 prompts 路由](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/kap-server/src/routes/prompts.ts#L372)：提交后获得 prompt_id，再将 queued prompt_ids steer 到 active turn；路由挂在 `/api/v1`。源码 `::steer` 是 Fastify 对字面冒号的路径写法，不能原样拼成两个冒号给客户端。
- `packages/kap-server/src/protocol/rest-prompt.ts`：显式 prompt_id、queued/running/blocked 状态及批量 prompt_ids。已安装 bundle 同时包含路由和 handler，`kimi web --help` 确认本地监听、鉴权及 `--no-open`，无需另装 CLI。
- [promptService.ts:353](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/agent-core-v2/src/agent/prompt/promptService.ts#L353)：要求 active prompt，检查全部 ID，按队列顺序选择；异步准备后重查；无法分配 active turn 时恢复 pending，不伪造成功。
- `promptStepRequests.ts` 的 SteerStepRequest 是 mergeable、activeTurnOnly；loop 的 StepRequestQueue 在后续步骤组织输入，不修改已经完成的模型请求。
- [ACP session.ts:631](https://github.com/MoonshotAI/kimi-code/blob/5efca0c3116743855c28426000073bfe34a4862f/packages/acp-server/src/session.ts#L631)：ACP 没暴露此能力，第二个运行中 prompt 被拒绝。

重要差别：SDK 高层 submitSteer 在 idle 时可以退化为启动 prompt；REST 的 queued prompt steer 要求存在 active prompt。因此必须验证“检查 busy 后到实际发送期间原轮结束”的竞态，不能把 API 名称当作同轮保证。

旧 Python kimi-cli 的 wire/server.py:756 与 kimisoul.py:622/626 确有 steer 队列及 SteerInput 消费事件，但与本机 TypeScript kimi-code 不是同一个 CLI，不能混用参数。

## OpenCode：并非没有 Guide 类能力

[安装版本上游回归测试](https://github.com/anomalyco/opencode/blob/3104c1428ec91f809e5ab86631300de41eb6952e/packages/opencode/test/session/prompt.test.ts#L1433) 明确覆盖：第一模型请求挂起时提交第二条 prompt，第二条先保存；放开第一请求后，第二次 LLM 输入包含第二条 user message。

实现链：`session/prompt.ts:1051` 先 createUserMessage，再 loop；`effect/runner.ts` 的 ensureRunning 在 Running 状态等待当前 run 而不启动第二个；`session/prompt.ts:1089` 每次循环重新读取消息，完成条件要求 lastAssistant.parentID 对应 lastUser。

由此可判定：运行中的后续模型步骤可以看到新消息；不是改写正在进行的模型请求，也不承诺每条 prompt 对应独立的 SDK 返回值（并发调用可能等待同一个最终结果）。多消息顺序、Thread/模型配置归属及工具执行中的追加仍须真实验收。

Raft 1.0.18 main.js:760929 明确选择 per_turn / coalesce_into_pending / busy none。这是 Raft 接线选择，不是 OpenCode 能力缺失。

## Claude 与 Multica 的证据边界

[Claude 官方 streaming input 文档](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) 说明持续进程、多条输入与会话延续。它不能单独证明“任意 thinking 时刻输入必定同轮消费”。Raft 的工具边界与新会话 `liveSessionReadyAt="turn_end"` 位于 main.js:758042、764676；先前真实本地 queued_command 证据保留，但不覆盖所有边界。

Multica `server/pkg/agent/agent.go:18/142` 公开接口为 Execute、Messages、Result，没有通用 steer 入口；Kimi backend 使用 ACP。`internal/service/task.go:5465` 保留运行中工作，后续任务在后排队；`internal/daemon/prompt.go:390` 给合并评论保留独立 ID/Thread 定位。这些可参考等待发送和恢复，不是已经实现的跨 CLI Guide。

## 各状态如何验收

| 状态            | Codex                                                            | Claude（按 Raft）                         | Kimi 可用 steer 面                                   | OpenCode serve                               |
| --------------- | ---------------------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| 尚未开始 / idle | 不调用 steer，走下一轮                                           | 新建与恢复必须分开                        | SDK idle 可能启动新 prompt；REST steer 要检查 active | prompt 可启动 loop                           |
| 模型生成中      | 当前 turn 排队，后续请求消费                                     | 不能任意时刻无门槛写入                    | 后续 step 消费，不修改已生成 token                   | 新 user 入历史，下一次 LLM 请求消费          |
| 工具执行中      | 不意味着中断工具，等待消费边界                                   | 工具批次结束且就绪后投递                  | 不假定中断工具；必须验证 step、Wait 工具等边界       | 源码允许保存；工具组合实测未完成             |
| 压缩 / review   | 独立 Compact/Review 拒绝；自动 compact 有延迟规则                | 压缩期间阻止，恢复后仍检查就绪            | 需区分 SDK/REST 与具体压缩流程，不宣称全覆盖         | 压缩竞态待验                                 |
| 原轮刚结束      | expectedTurnId/active 校验阻止串到另一轮                         | turn_end 可触发积攒输入，须保持或恢复会话 | 高层自动退化与严格 active-only 接口不同              | prompt 可能启动下一 loop，不应误称原轮 Guide |
| 崩溃 / 重启     | 由 RAH 持久待交付/待回应事实恢复；write/steer 回执不代表业务完成 | 同左                                      | 同左                                                 | 同左                                         |

## 下一步施工依据

1. 先落实 Wait/Guide 显式合同：等待消息不主动注入 busy CLI；结束后按确定顺序交付；N 条追加和重启不丢不重。复用现有持久 owner，不能只增加内存数组。
2. Claude 先修新会话/恢复会话和结果收尾条件；Codex 保留已验证 steer，补模式选择、结束竞态与多条追加。
3. Kimi 优先为“现有 CLI 的本地 Web 服务”做最小非计费接线实验：会话创建/恢复、配置、鉴权、隔离、prompt_id/事件关联和退出。再与独立 SDK 的集成成本比较；没有必要预先宣布必须更换 CLI。
4. OpenCode 按 Raft 先保持等待默认；原生 Guide 列为有源码依据的候选能力，用户选择扩展后再跑隔离实测，不再归类为 CLI 不支持。
5. 最后做相同条件 Raft 双边比较，分别报告“等候”“引导”“被模型消费”“已回复”，不能用一次业务回答替代传输验证。

## 用户补充的 Claude 历史源码

用户提供目录 `/Users/sun/Library/Mobile Documents/com~apple~CloudDocs/Lab/crates/AI/claudecode-source`。本轮读取发现内部输入与 query 实现；根目录未见 package.json、Git 元数据或来源说明，版本通过构建期 MACRO 引用，尚未确定具体发布版本、来源完整性及与当前 2.1.268 的一致性。因此以下是这份历史文件树的实现事实，不升级为当前安装版已经验收。逐文件摘要保存在 `/Users/sun/Code/reviews/rah_os/2026-09-11-runtime-capabilities/claude-local-source-manifest.json`。只读分析，没有复制历史源码进入产品。

- `cli/print.ts:4102`：stream user 输入进入统一 command queue，带 uuid、priority；随后触发 run。`run` 在已运行时直接返回（1865），不会为每条输入启动并行 query。
- `utils/messageQueueManager.ts:128`：未指定 priority 默认 next；同优先级 FIFO。`cli/print.ts:1858` 的 now 分支会 abort 当前操作，因此不能把 now 当成无中断的 Guide。
- `query.ts:1397` 工具批次执行结束后，1570 按 priority 与 agentId 取队列快照，排除 slash command；通过 attachments 加入后续上下文，1632 只移除被消费的 prompt/task-notification。普通 next 输入可在轮中消费。later 在 Sleep 分支也可能被读取，不能直接等同于 RAH 严格等待发送。
- `cli/print.ts:1934`：未在轮中消费的连续且兼容的 prompt 可合并为后续 ask；这不是“一条输入一定独立一轮”的合同。
- `QueryEngine.ts:875`：启用 replayUserMessages 时，queued_command 转成带 source uuid 的 user replay。但 `cli/print.ts:4070` 重复输入也能产生 replay 回执，不能仅凭 replay 就证明本次模型新消费，更不能证明已回答。

这些源码支持 Claude 在工具批次边界消费追加，与 Raft gated 设计相容；不能据此推导 Raft 的所有外层限制都可删除，也不能证明只有初轮 turn_end 后才能消费是 CLI 内核硬限制。当前版本仍应通过同条件实验验证。统一等待发送仍由 RAH 持久 owner 控制，不借用 Claude 的 priority 语义冒充严格等待。
