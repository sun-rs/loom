# Runtime 双边验收前置核查

本次仅只读核查源码与已有验收记录，没有运行付费模型、操作官网或修改产品。不能据此宣布双边通过，也不使用历史完成百分比。

## 证据版本

RAH 当前工作树基于 `ac0f486`，存在其他未提交工作。上游为 Raft Computer 1.0.18，文件 `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。下文上游行号均指该文件。

## 源码可确定的差异

| Runtime  | Raft 实现                                                                                     | RAH 当前实现                                                                                                                       |
| -------- | --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Claude   | 758043–758064：persistent、gated；注释明确避免任意忙时注入撞上 signed thinking block          | `packages/agent-host/src/claude-stream-json-driver.mjs:126` 每轮启动，147 支持 `--resume`，228 写一个输入后关闭 stdin              |
| Codex    | 758703–758724：persistent、direct；759060–759068 使用 `turn/steer` 并传 expectedTurnId        | `packages/agent-host/src/codex-app-server-driver.mjs:138` 有 `thread/resume`；204–216 回合完成后关闭输入并回收进程                 |
| Kimi     | 760313–760331：persistent、direct；另有 kimi-sdk，不应混成一个驱动                            | `packages/agent-host/src/kimi-acp-driver.mjs:235` 使用 session/new 或 session/resume；203–209 收尾关闭 stdin 并回收                |
| OpenCode | 760930–760968：明确 per_turn、terminate_on_turn_end、coalesce_into_pending、busyDelivery none | `packages/agent-host/src/opencode-server-driver.mjs:93` 能恢复 session，结束时回收所启动服务；不能把它列成缺少 Raft 常驻进程的反例 |

因此“RAH 不支持会话恢复”和“Raft 所有 Agent 都是常驻进程”都不成立。前三者的进程复用及忙时通知确有结构差异，OpenCode 需要比较的是每轮执行、恢复与积压消费的结果。

RAH `packages/kernel/src/room-event-writer.ts:126` 只扩展 queued Activation，不扩展 leased；`packages/agent-host/src/agent-host.ts:472` 将领取范围放入 envelope，493 启动 runtime。`packages/agent-host/src/runtime.ts:49` 的 RuntimeAdapter 只有 start/cancel/reap/recover，没有忙时追加接口。这是持久 follow-up 策略的具体边界，不表示 Agent 主动读取时永远看不到新消息。

Raft `sendStdinNotification`（769113）还包括关闭状态债务、idle flush、session ready、错误退避、已贡献消息抑制（769195）、重复通知指纹（769205）及失败后的重排（769284）。不能只移植一次 stdin.write 就称为复制上游机制。`prepareCliTransport`（738599）是 CLI 执行环境准备，并不是忙时投递状态机。

## 双边测试中的 effort 陷阱

Raft OpenCode 的 `buildOpenCodeLaunchOptions`（741854–741891）只从 runtime 字段取 model，不传 `--variant` 或 reasoningEffort。它仍合并全局 `~/.config/opencode/opencode.json` 与 Agent 的 `OPENCODE_CONFIG_CONTENT`（741762–741851），所以不能进一步推论模型一定没有推理设置或默认等于 low。

RAH `packages/agent-host/src/runtime-implementation-registry.ts:1062` 传 `--variant`，`packages/agent-host/src/opencode-server-driver.mjs:459` 写入请求 body.variant。因而“同型号 + 官网无 effort 选项”不足以证明双方同 effort。应白名单核查所选 Agent/模型配置以及实际请求的 variant/推理设置；不得输出完整 provider 配置、环境或凭据。若上游无法证明等效，必须记录该实验条件差异，不能擅改授权模型矩阵并声称公平性能比较。

后续只读预检找到了受支持的配置路径：本机 `opencode models deepseek --verbose` 返回目标 `deepseek/deepseek-v4-flash` 的 `variants.low.reasoningEffort = low`。已安装 `/opt/homebrew/lib/node_modules/opencode-ai/bin/opencode.exe` 的嵌入源码在字节66138324附近定义 Agent 的 optional string variant，在65909366附近令 SessionPrompt 从显式请求或 Agent 的有效模型 variant 取值。因此可通过 Raft 已支持的 Agent 环境变量 `OPENCODE_CONFIG_CONTENT`，合并 `agent.slock.variant = low`。仍须从实际执行消息的 model.variant 核实生效，不能把可配置当成已运行。

**真实执行推翻了“只设置 slock.variant 就已生效”的假设。** 本机 OpenCode 1.18.30，专用 ParityAuditorA 在上海时间2026-09-11 02:24:12–02:24:49的实际消息为 `agent=build`、模型deepseek-v4-flash，未带variant；数据库 session `ses_fb3052d3cffemeH0TIpZV1sz31` 的model.variant为default。该时段不得计为同effort通过样本。原因有对应源码：上游741879仅在 `requiresAgentCliFlag(version)` 条件成立时才传 `--agent slock`，而已安装CLI默认选build。binary字节73174247定义受支持的 `default_agent` 字段，66142734按它选择primary Agent。应显式配置 `default_agent=slock` 加 `agent.slock.variant=low`，并用专用新会话验证，避免旧会话继续保留build。此选择也关系到上游741821–741834只挂在slock上的standing prompt，不能忽略。配置方案尚不是修正后运行通过证据。

Kimi 的上游 `buildKimiArgs`（741444）未传 thinking，但 `resolveKimiSpawn`（741427）直接解析 PATH 上的 kimi；环境准备（738760）继承进程与 Agent 环境。本机 kimi 实际链接 `@moonshot-ai/kimi-code/dist/main.mjs`，其60697按显式home、`KIMI_CODE_HOME`、`~/.kimi-code`顺序选数据目录。可在专用实验 Agent 显式指定现有 KIMI_CODE_HOME，避免误把上游旧模型发现函数读取的 `~/.kimi/config.toml` 当作真实运行配置。RAH ACP 则显式设置 thinking 并核实返回（`kimi-acp-driver.mjs:299`）。双方仍需记录实际会话值，特别是恢复旧会话时。

第二次真实预检补出另一个前提：设置default_agent=slock后，新session `ses_f736aa02bffeGesiwdfgAcmkKq` 在02:30实际为slock，但仍无variant。二进制73463869的字段说明明确：Agent variant只用于Agent自己配置的model；65909366的条件也要求Agent.model存在且匹配。因此完整配置必须同时包含 `default_agent=slock`、`agent.slock.model=deepseek/deepseek-v4-flash`、`agent.slock.variant=low`。本次审查最初仅核字段和variant目录，漏掉该调用条件，已纠正；两次失败预检均不得计为同条件成功，证据保存在 `/Users/sun/Code/reviews/rah_os/2026-09-11-runtime-preflight/` 的两个白名单JSON中。完整配置仍待实际消息确认。

继续付费运行前已补上不计费解析门槛：先核对CLI帮助，再以临时环境中的完整JSON运行 `opencode debug agent slock --pure`（没有tool参数）与 `debug config --pure`。前者实际解析为model providerID=deepseek/modelID=deepseek-v4-flash、variant=low；后者确认default_agent=slock及model/variant。两项exit 0，白名单结果保存为同目录 `opencode-resolved-agent-whitelist.json` 和 `opencode-resolved-config-whitelist.json`。这证明配置解析与前述catalog/调用前提一致，下一次实际会话仍须核验，且不能覆盖前两次不合格样本。

**第三次实际参数已确认。** 新session `ses_f73668187ffedOOI6ZcBTwJPF1` 的session、user消息和assistant消息均记录 `agent=slock`、DeepSeek V4 Flash、`variant=low`；白名单证据为 `third-raft-run-model-whitelist.json`。以上“待确认”是前两阶段的历史状态，第三次已满足该运行参数条件。

本次verified频道的业务发送成功回执共7条，均有实际Message ID，保存在 `third-raft-business-receipts.json`。本机观察时间（上海）：PROPOSE1 02:34:36.094、REVIEW1 02:34:47.635、PROPOSE2 02:35:02.609、REVIEW2 02:35:13.467、PROPOSE3 02:35:41.792、REVIEW3 02:35:54.311、GOAL 02:36:08.774。三个REVIEW均有hold后send-draft成功回执，未将hold误算发送成功。这是CLI接到成功回执的时间，不是服务端created_at；Human精确接受时间未取得，不能据此给出Raft总耗时，亦不能与本地181秒的不同计时区间直接比较。其它组合用例尚未由这7条消息验证。

随后返工频道 `parity-rework-0911` 也取得4条成功回执：REWORK 02:42:53.573、REPAIR:DONE 02:44:26.317、AUDIT:PASS 02:44:36.637、GOAL:DONE 02:44:54.474。证据 `raft-rework-business-receipts.json` 与 `raft-rework-model-whitelist.json`；该段OpenCode持续low，Kimi持续K3/high。Human正文从Agent实际读取的官方输出核实完整，含末句“不使用Thread，消息全部发在当前频道”，显示时间02:42:42（秒精度），不是用AX截断猜测指令。两Agent默认cwd不同；本轮工具使用Human指定的同一共享绝对文件，未把两个同名相对文件混为一次返工。停止观察、官网显示和最终文件验收由主线程另行记录，此处不越界宣布全部旅程完成。

主线程初次页面采集只显示Human和REWORK，与回执不一致，故追加逐条目标复核：四条工具输入和关联回执都明确指定 `#parity-rework-0911`；OpenCode实际message check还读到该target下的REPAIR消息b4bce39b。主线程随后重新激活页面，四条消息均出现且链接属于返工频道，旧verified频道没有返工消息。发送错频道已排除；最初页面或采集为何未及时更新未判，不把它宣称为Raft实时刷新缺陷，也不掩盖这次观察不一致。

## 忙时追加：本次官方运行证据与裁决边界

频道 `parity-busy-rework-0911`（f14153a2-4813-47f3-b557-8783d568e90d）的5条消息均取得该target对应的成功发送回执，保存于 `raft-busy-rework-business-receipts.json`：

| 消息         | 本机观察成功回执时间（上海） |
| ------------ | ---------------------------- |
| AUDIT:REWORK | 02:57:36.209                 |
| NOTE:ACK     | 02:58:36.057                 |
| REPAIR:DONE  | 02:58:58.177                 |
| AUDIT:PASS   | 02:59:08.747                 |
| GOAL:DONE    | 02:59:25.967                 |

`raft-busy-rework-model-whitelist.json`确认本段Kimi实际请求持续kimi-code/k3/high，OpenCode实际消息持续DeepSeek V4 Flash/low。NOTE与原流程分别有独立Message ID，且NOTE先于修复完成。本次没有把五个标记合在一个回执中计算完成。

触发证据：Kimi指定的touch/sleep工具开始于02:57:53.846，标记mtime为53.866，本次在02:57:54.005观察到标记并通知主线程；工具结束于02:58:13.882。官方读取输出只给追加Human消息创建时间02:58:13（秒精度），daemon收到它在14.226，Kimi真实turn.steer在17.237。因此可以证明追加在原修复任务未完成时到达，不能证明它精确在sleep20结束前被接受或消费。回执时间与Human显示时间还不是同一计时层，不能伪造毫秒级端到端耗时。

源码与实景现在共同支持的结论是：Raft Kimi SDK direct路径确有忙时steer，且这次先确认追加再完成原任务。RAH是否需要缩短已有follow-up等待，应结合主线程本地同场证据和分段时间决定；不能从这一个样本推断所有CLI表现，也不能把所有延迟归于进程重启、声称同sleep窗口完全一致，或直接照搬整个调度器。前三种场景的业务通过也不能替代下表第2项的组合验收。

主线程通过官网重启专用 ParityReviewer0908 后，本次补查发现其实际运行的是 **kimi-sdk**，不是外部 wire CLI；760861–760909明示这是原生 RuntimeSession，spawn 不受支持。其会话创建在741637–741698，经现有home配置和 SDK harness 创建/恢复。只读会话证据 `~/.kimi-code/sessions/wd_fb22428b-e2f2-4f14-9c2b-ab5b44ffa7a8_10ea62f78c27/session_1544693f-035b-485b-9879-6a8fc5d538d7/agents/main/wire.jsonl` 的白名单字段实际出现 `model=kimi-code/k3`（请求侧为k3）和 `thinkingEffort=high`。可以确认该实际会话的模型/强度；不能称双方使用同一种CLI传输。SDK/ACP差别应作为待比较的产品实现记录，而非阻止相同模型的业务实验。

## 已验与未验

[本地返工与忙时追加记录](./2026-09-11-rework-and-busy-dialogue-acceptance.zh-CN.md)记录一次完整追加运行：原修复、再审、独立 NOTE:ACK、GOAL 均到达，目标后观察20秒；追加到确认177.857秒。它证明该单次本地结果，不证明延迟来源、所有 Provider、高可用或 Raft 双边一致。既有跨 Room/DM 和切换记录也不能替代当前冻结版本的组合实验。

## 最小后续顺序

1. 先锁定双方 CLI、模型、实际 effort、初始文件和工作区共享条件；配置条件不齐先解决测量条件。原始场景与失败记录保留，不换提示词凑通过。
2. 双边依次运行三轮、返工、忙时追加；以 Human 消息被接受为起点，同时记录回复、消息归属、文件结果与追加确认时间。再加入多 Thread、跨 Room/DM、记忆更正/隔离和切换/重启。
3. 把积压等待、启动排队、进程启动、模型执行、工具发送分别计时。先定位177秒落在哪一段，再决定移植范围。不能将它直接归因于每轮重启。
4. 若决定移植前三类 Runtime，单一 owner 保持 AgentHost；保留 Kernel Inbox/Activation 与执行围栏，增加持久进程中的回合/通知通道，按 Raft 驱动能力分档。必须先覆盖通知失败、重复、回合边界、重启和未完成 follow-up 恢复的反例，再做真实双边验收。不能把“写入成功”当成读取或任务完成。

未修改任何 owner 合同；此文件是核查依据与实施前置条件，不是批准重写调度或宣布差异已关闭。

## 第2项最小待验组合

核查 `packages/daemon/test/real-core-chain-gate.test.ts` 与9月10日第2次运行记录后，不建议重复拆出跨Room、DM、记忆、切换四套基础建设。已有本地样本覆盖这些基本路径，但以下组合未闭合；均应在本次冻结版本保留双边证据。

| 最小实验                                                                                         | 复用已有能力                                    | 本次必须补的断言                                                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 两个Thread并行返工，其中一个忙时追加，同时另一Agent在Room B继续工作                              | 本轮三轮/返工门禁、已有跨Room成员约束           | 每条回复的Room/Thread/parent准确；原任务和追加分别回复一次；无跨Thread错误消费、无重复唤醒失控；无关Agent确实继续产生业务结果。当前core-chain门禁无threadId，旧跨Room样本不能证明这一组合                                                                       |
| Room A记忆 → Room B召回 → DM私有新事实 → 回Room；更正后重置运行会话再询问，并让另一Agent独立回答 | 既有记忆索引、隔离目录、成员范围及DM配对        | 必须证明provider session实际变新且保留同一Agent记忆；输入不包含待召回答案；读取更正值、旧值不当现值；负对照未获得私有事实。当前1117–1159只证明新RunAttempt和receipt，并未证明新provider session；部分召回项只有observed布尔记录，应明确逐条判定而非仅看进程退出 |
| 在前述有未完成消息时切换执行Agent CLI/model/effort，并分别测试浏览器断线重连、服务重启           | 已有冻结placement、实际argv与有序daemon重启证据 | 记录实际请求模型/effort；旧Run冻结不被改写；其他Agent继续；用户不重发即可恢复；消息、草稿、Thread及滚动/展开状态恢复，无重复交付。当前1552是有序AbortController停启，不证明崩溃恢复；浏览器断线亦未覆盖。崩溃注入应独立标记，不能拿有序重启冒充                 |

这些是已有旅程的组合验收与证据补齐，不是新增产品功能。三个实验也不能合成一个无法定位故障的大场景：先关闭双Thread寻址，再做确实新会话的记忆，最后叠加切换/恢复。Raft侧只能验证可观察的对应结果，本地Kernel内部断言不能冒充Raft服务端合同。
