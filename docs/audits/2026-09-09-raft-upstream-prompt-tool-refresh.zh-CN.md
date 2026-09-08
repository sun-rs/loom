# Raft 当前版本、Agent prompt 与工具合同重新取证

结论：当前稳定 Computer 仍为 **1.0.18**，重新提取结果与旧快照相同；RAH 与其主要差异是模型面对的工具合同和按 Runtime 区分的消息交付，而非缺少几句提示词。本报告为源码对照与移植设计，不是新一轮行为修复或双边验收通过声明。

## 1. 更新、提取和版本身份

2026-09-09（本机时间）查询官方 `https://cdn.raft.build/computer/manifest.json`，稳定指针 1.0.18；本地 CLI、Computer service 和 server runner 均为 1.0.18。官方 `upgrade --dry-run --channel latest` 返回 Already at 1.0.18。

按照用户更新要求执行官方更新命令：非交互 latest 要求指定解析后的版本，随后执行 `upgrade --target-version 1.0.18`。服务接受同版本操作，但最终 status 报告该更新操作 failed，detail 为 recovery settled at idle with stable 1.0.18。**不能称升级成功。** 最终原服务／runner 仍运行，连接状态 healthy/connected，二进制摘要仍与稳定 manifest 完全一致。没有擅自切到 alpha，也没有停止 Agent 或改登录状态。

原方法完整重跑：`extract_node_sea.py` → `index_esbuild_bundle.py` → `split_esbuild_bundle.py`。得到 3,686 个模块边界和 175 个第一方切片。新旧 main.js SHA-256 相同，为 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`；二进制 SHA-256 为 `b9d2637306a639003ac99cd0a9dc96ec70bc5173d6bdba7b9e5bb3242f690b90`。

必须分开四个发布面：

| 发布面                         | 本次最新版本 | 对照用途                                                          |
| ------------------------------ | ------------ | ----------------------------------------------------------------- |
| 官方 Computer SEA              | 1.0.18       | 当前运行的 daemon、管理式 Agent prompt 和内嵌 CLI 的首要基线      |
| npm `@botiverse/raft`          | 0.0.20       | 独立 Agent CLI，补查新工具能力；不能假定 managed wrapper 已调用它 |
| npm `@botiverse/raft-daemon`   | 1.0.17       | npm daemon prompt／CLI 的交叉验证                                 |
| npm `@botiverse/raft-computer` | 0.0.70       | 历史 npm 控制入口，不是当前 SEA 1.0.18 的包版本                   |

三个 npm 包均重新 `npm pack --ignore-scripts`，解包并验证 tarball SHA-512 integrity。没有把旧 npm Computer 全局安装覆盖现用 SEA。内嵌 `prepareCliTransport` 使用 daemon 指定的 bundled CLI／SEA `__cli`；全局 npm CLI 只在相应分发或 fallback 路径使用，不能通过全局安装推断 managed Agent 已升级工具。

完整可复核证据：[/Users/sun/Code/reviews/rah_os/2026-09-09-raft-upstream-refresh](/Users/sun/Code/reviews/rah_os/2026-09-09-raft-upstream-refresh)。包含 provenance、manifest、更新输出／最终状态、npm integrity、按 TypeScript AST 提取的函数原文及逐函数 unified diff。AST 提取没有执行上游 bundle；所有输入解析均无语法诊断。原始源码仅作授权分析证据，不成为 RAH 生产依赖，也不声称恢复了完整原始 TypeScript 仓库。

## 2. 首要差异：Agent 实际面对的工具

主要来源：当前 SEA 的 `handleMessageSend`、`formatHeldSendOutput`、`formatFreshnessHoldOutput`、`recordConsumedSeqs`、`getSavedDraft`、`setSavedDraft`；完整函数及位置见证据目录 `sea-functions/index.json`。RAH 对应 owner 为 Worker CLI、WorkerApplicationService、WorkerTargetContextService 和 Kernel held draft。

| 行为          | 当前 Raft 代码                                                                            | 当前 RAH 与裁决                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 发送内容      | stdin/heredoc，固定 target；工具构造 API 请求                                             | RAH 要模型拼 `--body`、basedOnRoomSeq、idempotencyKey 等。Shell 引用和协议搬运负担没有调平                                 |
| 已读序号      | 工具按 Agent + target 保存 consumed seq/readOrder；发送时内部补 seenUpToSeq               | RAH 把 Activation cursor 和 target receipt 暴露给模型选择。后端安全属性可保留，但应藏在 facade 内                          |
| hold 的呈现   | 输出有界 canonical 新消息，工具记录目标 seenUpToSeq；不等于任务完成                       | RAH 输出 JSON ledger/event 等技术结构，要求额外 room-read 和回执复制；上轮所谓“机制补齐”只证明路径存在，工具合同仍不一致   |
| 原稿重发      | `message send --send-draft --target`；工具查当前目标草稿，内部传内容和已读序号            | RAH 要模型记 heldDraftId、target、receipt、throughRoomSeq、新幂等键。真实 E 中错误组合 body/send-draft 正发生在这个界面    |
| 草稿身份      | Agent + target；保存 content、attachments、savedAt、reholdCount、seenUpToSeq，10 分钟 TTL | RAH 持久草稿可跨 Run，但当前 facade 没有按目标隐去草稿身份细节；不能为了模仿丢掉 Kernel 持久性或隔离                       |
| hold 后选择   | 原文重发／改稿／不发，工具明确区分参数；held 非成功退出                                   | 上轮 RAH 非零退出已修复；无条件退出指令已删除。但新加“追加不取消”的自研规则不构成对齐证据                                  |
| 改稿与原稿    | normal send 设置 draftReplacedExisting；成功清除目标草稿                                  | Raft 本身允许替换。不能擅加“永不允许改稿”或“自动强发旧稿”并称为移植                                                        |
| 输出格式      | 默认 canonical 可读文本，JSON 为可选；错误有稳定标签与恢复命令                            | RAH 默认 JSON，模型必须理解更多内部协议，仍有差异                                                                          |
| Thread 防串线 | target 带 Thread；记录近期 consumed Thread/readOrder，对从 Thread 误发父目标作确认        | RAH 已有显式 Thread 与签名目标围栏；尚未按同条件核查该“读 Thread 后误发父目标”的完整交互，不应仅凭 Thread API 存在判定通过 |

Raft 的本地 JSON consumed-state 不是必须照搬的存储实现。RAH 采用 Kernel／application service 单一 owner 保存投递证明，CLI 只呈现工具语义；不引入第二业务游标、不扩大 Task 权限、不把回执当作模型已经理解的证明。隐藏协议参数也不意味着自动读取全部历史或自动重发。

## 3. 完整 prompt 与忙时投递

已重新读取 `buildPrompt` 及其 `buildSlockCliGuideSections`：通信、发送、Thread、历史引用、Tasks、协作礼仪、Memory、压缩后恢复、Runtime-specific 通知等是组合单元，不是一段孤立的 held 文案。

核心规则来自上游：真实结果必须通过消息工具发布；一次调用一个工具并读其结果；完成当前工作后再停止；忙时通知不要求立刻中断；在自然停顿点选择读取，读取后再决定转向；只有通知而没有正文不等于没有工作。上游没有 RAH 旧版“held 后 ACK 并成功退出”的固定流程。

当前 SEA 的 driver 能力（源码事实，不等于本轮四 CLI 实测）：

| Runtime  | supportsStdinNotification | busyDeliveryMode | 对齐要点                                                         |
| -------- | ------------------------- | ---------------- | ---------------------------------------------------------------- |
| Claude   | true                      | gated            | 经过自身安全投递边界，不是无条件塞入 stdin                       |
| Codex    | true                      | direct           | 可接收忙时内容为空的目标通知，再明确读取                         |
| Kimi CLI | true                      | direct           | 忙时通知路径；SDK 另有 sdk_steer 描述，不能把两种 transport 混用 |
| OpenCode | false                     | none             | 不支持忙时直接通知；不得套用 Codex/Kimi 的同一假设               |

注意：prompt 的 `messageNotificationStyle: "direct"` 与 driver 的 `busyDeliveryMode` 是不同参数；Claude 使用前者时，其忙时投递仍为 gated，不能混为一种机制。

`sendStdinNotification` 有 session readiness、backoff、compaction、重复 notice fingerprint、发送失败后的 notification debt 保留。发送内容是按目标聚合的 Inbox notice，正文不随通知注入；只有写入成功才记该通知已展示，但这仍不证明业务消息已读。RAH 当前以冻结 Activation + durable follow-up 为主，不能用统一 prompt 代替 driver 能力对齐，也不能用临时 stdin 队列取代持久 Inbox/Activation。

## 4. 最新 npm 与当前 SEA 之间也有差异

`@botiverse/raft@0.0.20` 的 `handleMessageSend` 相对 SEA 内嵌版本，实际新增结构化 mention selectors、正文中 mention 存在性校验、草稿保留 mentions，以及 `messages.sendV2` 调用。held 文本输出新增去除重复说明的模式。`formatHeldSendOutput` 与当前 SEA 字节完全相同，核心“目标草稿＋内部已读序号＋原稿重发／改稿”的流程没有变成复杂手工回执流程。

npm daemon 1.0.17 对照中，`buildPrompt` 的所见差异是 bundle 变量名；发送指南同样主要是 delimiter 变量重命名。历史读取、历史引用、工作区记忆及会话礼仪函数字节一致。不能把 diff 行数直接当作功能变化数量；busy dispatcher 和 transport 的其他差异没有在本批逐条裁决，也不将 npm 较低版本视为当前 SEA 的更新替代。

## 5. 取代上一轮“继续补 prompt”的施工顺序

1. **先收口目标式消息 facade**：面向 Agent 提供 read/send/send-draft 的 Raft 语义，正文 stdin；内部通过已有 authenticated service 处理 target、已呈现上下文、幂等键和当前草稿。协议底层 cursor/fence 保留。先写失败测试：有新消息 hold → Agent 已看到有界新上下文 → 一条按目标 send-draft 命令成功；多 Thread、改稿、无稿、过期、重启、不同 Agent 隔离分别验证。
2. **同批收口输出与指南**：从此次冻结来源移植可读结果／错误格式和消息指南，清楚登记 API 名称、本地身份、认证围栏等必要适配；prompt 不再教模型搬运内部签名／序号。删除已被 facade 替代的自研操作流程，不追加补丁式规则。
3. **再收口 Runtime-specific 通知**：Claude gated、Codex/Kimi direct、OpenCode none 分开比较，保留持久 follow-up、单执行 lane、失败恢复。用真实忙时 marker 验证，不以 spawn/写入成功代替读取。
4. **最后重跑原旅程**：保留原失败措辞，不只跑强化后的“明确追加”样例；另加明确取消、修改原要求、多 Agent、多 Thread、跨 Room、切 CLI／重启。分别记录工具行为和模型决策，不能抽样到一次通过就宣布高可用。

本批未执行上述新 facade 的产品修改，未重跑付费模型；也没有重启未变更的 RAH 正式服务。上一轮未提交产品改动保留，审计结论不等于它们已被新的源码移植替代。
