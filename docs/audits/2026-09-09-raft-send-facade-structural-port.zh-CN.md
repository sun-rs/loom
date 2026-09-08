# Raft 发送工具合同的结构性移植：目标寻址、服务端游标与按目标草稿恢复

批次日期：2026-09-09。接手上一 session 的结论：忙时草稿恢复的失败不是提示词不够，而是**模型面对的工具合同与 Raft 结构不同**。
本批把协议机制从模型面前移到服务端，按 Raft 1.0.18 的合同重做发送工具，不再用提示词弥补。

## 上游证据

授权提取的 Raft Computer 1.0.18 SEA 函数原文见 `/Users/sun/Code/reviews/rah_os/2026-09-09-raft-upstream-refresh/sea-functions/`
（`main.js` SHA-256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`）。关键事实来自
`handleMessageSend-0.js`、`getSavedDraft-0.js`、`setSavedDraft-0.js`、`getConsumedSeq-0.js`、`recordConsumedSeqs-0.js`、
`formatHeldSendOutput-0.js`、`formatFreshnessHoldOutput-0.js`、`buildSendingMessagesSection-0.js`：

- Agent 面对的全部输入是 `--target` 与 stdin 正文；`--send-draft --target` 无 stdin；`--anyway` 仅在反复 hold 后使用。
- 工具内部按 (agent, target) 取草稿、按 target 取 `consumed seq` 作 `seenUpToSeq`、构造请求体、发送前先存草稿。
- hold 时：记录该 target 的 consumed seq、把草稿 `reholdCount + 1` 重存、打印有界新消息、以 `SEND_HELD_AS_DRAFT` 非零退出。
- 成功时清除该 target 的草稿。模型全程不接触游标、回执、幂等键、草稿 ID。

## RAH 的三处结构差异与本批裁决

| 机制 | Raft | 本批之前的 RAH | 裁决 |
|---|---|---|---|
| 已读位置 | 工具按 (agent, target) 本地保存 consumed seq，发送时内部补 `seenUpToSeq` | 把 Activation 游标与签名 `contextReceipt` 交给模型选择并搬运 | 服务端按 (participant, target) 持久记录已读位置；模型不再传 |
| 草稿身份 | 按 (agent, target)，`--send-draft --target` 即可 | 模型须记住 `heldDraftId` | 服务端按 target 查当前 held 草稿；`heldDraftId` 变为可选 |
| 幂等键 | 不存在，服务端按草稿/目标语义去重 | 模型须自造并保证唯一 | 服务端按稳定输入派生；显式键仍受支持 |

## 实现

**服务端（kernel + protocol + application-service）**

- 新 owner 模块 `packages/kernel/src/worker-target-read-position.ts` 与表 `worker_target_read_positions`
  （participant + room + thread_key 为主键，`thread_key` 用 `''` 表示 Room 级目标，避免 SQLite 的 NULL 唯一性语义）。
  仅在三处推进，与 Raft 的 `recordConsumedSeqs` 一致：目标读取窗口、目标历史读取、**hold 向 Agent 展示新消息时**。
  发送本身永不推进，否则 freshness hold 将永远不再触发。单条消息 `resolve` 也不推进，避免以一条消息冒充整个 Room 的已读位置。
  Room 删除擦除器与既有外键棘轮测试覆盖新表。
- `held-message-drafts.ts` 新增按目标查当前 held 草稿；无草稿时返回 Raft 原文形状的 `No saved draft exists for this target.`。
- `WorkerMessagePostRequestSchema` 的 `basedOnRoomSeq`、`idempotencyKey`、`contextReceipt`、`heldDraftId` 全部改为可选，schema 仍 `.strict()`。
  最小形态：`{channel, body}`、`{channel, sendDraft: true[, anyway: true]}`、`{body}`（沿用 Activation 原路由）。
  显式形态逐字保留原有校验路径（回执验证、游标相等、Thread 绑定、StaleContext 门、因果事件查找），既有测试全部不变。
- 派生幂等键：`sha256("rah-worker-message-post-v1", participantId, activationId, roomId, threadId, basedOnRoomSeq, content)`。
  语义为"同一 Activation、同一目标、同一已读位置上的相同内容是同一次逻辑发送"。**已知取舍**：纯派生键无法区分"成功后重试"
  与"故意再发一遍同样的话"，Raft 同样没有模型侧幂等键；需要严格区分时仍可显式传键。
- `freshnessFloorSeq`：派生路径的 hold 下界取"已读位置与本人在该目标已发布消息序号的较大者"，`basedOnRoomSeq` 保持为已读位置以便重试稳定。
  同伴消息若早于本人消息，必然在更早那次发送时已触发过 hold 并因此推进过已读位置，故不存在跳过同伴消息的路径。

**CLI（模型面对的那一层）**

- `WorkerCliRuntime` 增加 stdin，正文默认从 stdin 读取（64 KiB 上限、严格 UTF-8、拒绝 NUL；TTY 或不可读视为空；首字节窗口避免阻塞）。
  `--body` 保留兼容既有测试与 fixture，但 prompt 只教 heredoc 形态。`--send-draft` 拒绝 stdin 正文（改稿属于普通发送）。
- `message-post --target X` 即可发送；`--based-on-room-seq`、`--idempotency-key`、`--context-receipt`、`--held-draft-id`
  降级为可选透传。`--send-draft --target X` 无需草稿 ID。
- hold 输出按 `formatFreshnessHoldOutput` 结构移植：`Freshness hold: showing latest N of M newer message(s).` +
  省略提示 + `Your message has been saved as a draft. Review the bounded context shown here, then choose one path.` +
  有界新消息 + 三条路径（改稿普通发送 / `--send-draft --target` 原样重发 / 不发）+ 仅在 `continueAnywaySuggested` 时给出 `--anyway`。
  保留 `SEND_HELD_AS_DRAFT` 与非零退出。原先教模型搬运回执/游标/键/草稿 ID 的文字全部删除。

**Prompt**

移植 Raft `buildSendingMessagesSection`（bash 变体）为独立的 `### Sending messages` 段：按收到消息里的原样 `target` 回复
Room/DM/Thread、正文一律 stdin heredoc、hold 后三选一、改稿绝不用 `--send-draft`、务必复用原样 target。删除全部消息侧的
游标/幂等键/回执/草稿 ID 指令；**Task 命令仍需 `--based-on-room-seq` 与 `--idempotency-key`，那些段落未动**，并有断言守护。
上一 session 已删除的"hold 后 ACK 并成功退出"没有回潮。

## Thread 防串线（同批移植）

Raft 的 `detectThreadContextParentSend`：当 Agent 最近读过某 Thread、之后却向其父 Room 顶层发送，且父目标的 `read_order`
严格小于该 Thread 的 `read_order` 时，保存草稿并以 `THREAD_CONTEXT_TARGET_CONFIRMATION_REQUIRED` 拒发，给出两条路径
（改发 Thread 目标 / 以 `--send-draft --target <父目标>` 确认原意）。本批新表已有 `read_order`，故按原谓词逐条移植：
仅在 compose 发送、目标为 Room 级时评估；对 Thread 目标、`sendDraft`、以及"父目标读取不早于 Thread"的情形一律不触发；
拒发时不发布、不消费附件、不推进任何已读位置；确认路径不引入新参数，直接复用按目标取草稿。Activation 原路由（未给 `--target`）
不适用该守卫，与 Raft 只守显式目标一致。新增协议响应变体、CLI 渲染与 prompt 一句说明，narrowness 六条各有测试。

## 验证

- 服务端新增 13 个测试（发送 facade）与防串线的 kernel/service/protocol/CLI 测试（读取位置的单调性与五路目标隔离、hold 推进而发送不推进、按目标取草稿含过期与他人隔离、
  最小形态发布与重试去重、无草稿的 Raft 形状报错、伪造回执仍 403、显式陈旧游标仍 hold、Room 删除擦除）。
- CLI 与 prompt 新增 22 个断言与 1 条确定性链。
- **确定性回归 `packages/daemon/test/busy-hold-recovery-chain.test.ts`**：真实 daemon + 真实 worker CLI，Human 提出工作请求，
  Agent 工作期间第二条消息到达同一目标，发送被 hold（CLI 退出码 1、stderr 含 `SEND_HELD_AS_DRAFT`），Agent 仅凭 `--send-draft --target`
  恢复原稿，再单独回答追加问题。断言账本恰为两条 Agent 消息、顺序与正文精确、关库重开一致、三次 CLI 调用中不出现任何回执/游标/键/草稿 ID。
  连续 3 次运行稳定，约 1.9 秒。**这正是此前真实模型丢失原回复的那条链。**
- 全仓 `npm run check` 全绿：1167 通过、0 失败、6 跳过（付费门禁）；web 单测 388；棘轮 `room-kernel.ts` 6,787/6,925、
  `protocol/src/index.ts` 1,662/1,800。

## 未收口的边界

- **真实模型验收未做**：新增 opt-in 门禁 `packages/daemon/test/real-busy-hold-gate.test.ts`，用上一轮失败的原始措辞
  （不加"追加不取消原结果"的强化引导）跑 OpenCode DeepSeek 或 Kimi。按 AGENTS.md，付费门禁需用户明确授权，本批未运行。
  在真实模型上重跑通过之前，不能宣称该场景已收口。
- Thread 防串线已在本批移植（见上节），但只在确定性测试中验证；真实多 Agent、多 Thread 交错场景未跑。
- **按 Runtime 区分的忙时投递未对齐**：Raft 的 driver 能力为 Claude gated、Codex direct、Kimi direct、OpenCode none；
  RAH 目前是统一的冻结 Activation + 持久 follow-up。这是已确认的架构差异，尚未逐项对齐，也尚未证明它导致了每一次漏回复。
- **输出格式仍为 JSON**：Raft 默认可读文本、JSON 可选。本批只把 hold 路径改成可读文本（失败正是发生在该路径）；
  翻转默认输出格式会触及几乎所有测试，另批处理。
- 记忆体系、跨 Room/私聊延续、配置切换后底层 CLI 是否真的换了模型/effort，均不在本批范围。
