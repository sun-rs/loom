# 批次 1 规格：唤醒回合携带正文 + 运行时确认投递

日期：2026-09-18。纲领：`docs/product/2026-09-18-scheduling-alignment-program.zh-CN.md` 批次 1。
能力矩阵（批次 0 产物，只读取证）：`scratchpad/sched/driver-capability-matrix.md`。

上游：Raft Computer 1.0.32，`main.js` SHA-256
`531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`；可读 daemon 切片
`RAFT_CHUNK` = `/private/tmp/raft-20260916-audit/computer-1.0.32/slices/packages/daemon/dist/chunk-TEGPBMW7.js`。
`RAFT_CHUNK` 与 `main.js` 同源，行号偏移 **+811783**（批次 0 已四点验证）。

## 0. 取证更正（必须先读）

### 0.1 Raft 没有「inbox notice 退化阈值」

纲领与任务书假设 Raft 用一个数量/字节阈值决定「正文 → notice」。**全仓取证后该常量不存在。**

- `formatConcreteMessagesRuntimeInput` 的全部 5 个调用点：`RAFT_CHUNK:32435, 32447, 32457, 36569, 36725`（= `main.js:844218, 844230, 844240, 848352, 848508`）。
- 定义处 `RAFT_CHUNK:24357`（= `main.js:836140`），签名 `(messages, driver, pendingInboxNotice)`：**对 `messages.length` 没有任何上界判断**，只用 `length === 1` 选单/复数表头。
- `grep -no "MAX_[A-Z_]* = [0-9]*"` 在 `RAFT_CHUNK` 的 34 个命中里没有任何一个与 inbox/concrete/notice 相关。

Raft 的退化判据是**结构性的，不是数量性的**：

| 路径                                           | Raft 位置                | 行为                                                                                                                                  |
| ---------------------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| 向**活进程**投递（`deliverMessagesToRuntime`） | `RAFT_CHUNK:36725`       | **无条件全量正文**，无上界                                                                                                            |
| 启动期 wake                                    | `RAFT_CHUNK:32431-32440` | 仅当 `renderedContextMessages.length > 0`（即该消息带 thread-join context）才渲染正文；否则整条退化为 `formatInboxUpdateRuntimeInput` |
| 启动期 starting-inbox                          | `RAFT_CHUNK:32450-32466` | 同上；已渲染 thread context 的走正文，其余走 notice 后缀                                                                              |
| busy stdin 通知                                | `RAFT_CHUNK:36569`       | 同上                                                                                                                                  |

**结论与决定**：批次 1 **不移植一个不存在的阈值**。RAH 仍需要一个上界，因为 RAH 的 Activation 范围 `[from_seq, to_seq]` 是账本上的有限区间、可以任意大，而 Raft 的 wake 只携带一条消息。因此本批次引入的上界**明确标注为 RAH glue，不是 Raft 移植**：

- `WAKE_BODY_MAX_MESSAGES = 20`
- `WAKE_BODY_MAX_BYTES = 64 * 1024`

取值理由：与 RAH 既有的 worker 输出预算同量级（`packages/agent-host/src/worker-message-check.ts:20-21` 的 `maxRounds 50` / `maxBytes 8MiB` 是整轮 drain 预算，单次唤醒输入需小两个数量级），并与 `packages/kernel/src/worker-delivery-window.ts:25` 的 `seqs.length > 500` 页上限不冲突。超出部分退化为 content-free notice，且**这些 seq 记为未呈现（NOT presented）**，永不参与本批次的隐式 ACK。

**预算口径（2026-09-18 第三轮评审后补，本批只记口径不实现）**：`WAKE_BODY_MAX_MESSAGES` / `WAKE_BODY_MAX_BYTES` 目前**只覆盖 Room 事件正文**（`room_events.payload_json` 的字节数）。完整唤醒输入还包含三块尚未计入的内容：

| 成分                                             | 属主   | 当前归属                                        |
| ------------------------------------------------ | ------ | ----------------------------------------------- |
| Room 事件正文（含非消息事件）                    | Kernel | **已计入** 20 条 / 64 KiB                       |
| 冻结清单 + MEMORY.md（`workerStartupContext()`） | Host   | **未计入**；并入 present 响应时须从同一预算扣减 |
| 包装文本（表头、notice 行、末段提示）            | Host   | **未计入**；排版模块落地时须计入                |

接线时的口径是**单一预算**：Host 先用清单、MEMORY.md 与包装文本的实际字节数向 Kernel 声明开销，Kernel 从 64 KiB 里扣掉后再选页——不是各自独立的三个预算。本批次不实现，见 §6。

**事件类型范围**：预算与呈现覆盖范围内的**每一种** Room 事件，不只 `message.posted`。判据不是自创集合，而是现有 `message-check` 页今天会返回什么：`syncRoomEventWindow` 的取数 SQL 无任何类型谓词（`packages/kernel/src/room-sync.ts:123-127`），Host 渲染器把 `message.posted` 打成正文行、把其余类型打成 `seq= time= actor= type=` 行加 payload（`packages/agent-host/src/worker-read-render.ts:465-497`）。任务取消、指派、状态变化因此都是 Agent 今天看得到的事实，presented 窗口不得静默越过。

### 0.2 已核对的 Raft 投递路径没有 runtime 侧接收确认（取证范围有限）

**2026-09-18 第二轮评审后收窄。**上一版写成「Raft 全 bundle 无确认机制」，这是超出取证范围的断言，现改为：

- **已核对**：`deliverMessagesToRuntime`（`RAFT_CHUNK:36725`）与 busy stdin notice 路径（`RAFT_CHUNK:36484-36514` = `main.js:848267-848297`）这两条投递路径上，记录下来的终点是 daemon 侧 `sendResult.ok` 加 `recordNoticeWritten`；`grep -rn "agent:delivered"` 在可读 daemon 切片与 `main.js` 上零命中。
- **未证明**：其余 11 个驱动描述符与服务端组件没有反编译，不能断定 Raft 全仓没有任何接收确认机制。

因此本批次的依据**不是**「Raft 也没有」，而是 RAH 自己的不变量（`AGENTS.md`：「A wake hint, process spawn, PTY write, RPC response, or exit code never proves that an agent read or completed work.」）。即使上游存在某种确认，daemon 侧写成功在 RAH 也不记为 ACK。

RAH 新增的 "presented" 是一个**比 ACK 弱的标记**：它不推进 `subscription_cursors`、不推进 `worker_target_read_positions`、不产生 room event。它只给后续的模型侧因果标记提供一个可被内核校验的凭据。

## 1. 三方权责

| 事实                     | 单一属主                       | 存储                                                              |
| ------------------------ | ------------------------------ | ----------------------------------------------------------------- |
| 唤醒输入文本（正文排版） | `packages/agent-host`（Host）  | 无持久化，进程环境/文件传递                                       |
| 「已渲染」窗口与 digest  | `packages/kernel`（服务端）    | `activation_presented_windows`（`rendered_at`、`content_digest`） |
| 「已送达运行时」事实     | `packages/kernel`（Host 身份） | 同表 `sent_at`、`sent_by_host_id`                                 |
| 投递 ACK 游标            | `packages/kernel`              | `subscription_cursors.last_seq`（不变）                           |
| 已读位置                 | `packages/kernel`              | `worker_target_read_positions`（不变）                            |
| 认证与路由               | `packages/application-service` | `/v1/worker/message-present`（worker 凭证，只读+记录）            |

## 2. 设计

### 2.0 可信边界（2026-09-18 第二轮评审后重做）

上一版让 Host 用**与模型同一份 worker 凭证**提交 `{范围, messageSeqs, contentDigest}`，服务端只存不核。凭证既然相同，服务端就无法区分「Host 真的呈现了」与「Worker 自报呈现了」。现在拆成三段，每段的属主不同：

| 段  | 谁写                                        | 内核入口                                                    | 能写什么                                            |
| --- | ------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- |
| (a) | **服务端自己**（在渲染同一事务内）          | `renderPresentedWindow`（`activation-presented-window.ts`） | 范围、`messageSeqs`、`contentDigest`、`rendered_at` |
| (b) | **Host 身份**（`AuthenticatedHostContext`） | `RoomKernel.markPresentedDeliverySent`                      | 只有 `sent_at` / `sent_by_host_id`                  |
| (c) | 模型（worker 凭证）                         | `presentedWindowAcknowledgement`（只读判定）                | 什么都写不了；只有 `sent_at` 非空的记录才生效       |

**结论**：没有任何入口能让 worker 凭证写 presented 记录。上一版的 `RoomKernel.recordPresentedDelivery(execution: AuthenticatedWorkerExecutionContext, input)` **已删除**（`room-kernel.ts`），请求体里的 `runAttemptId / fromSeq / toSeq / messageSeqs / contentDigest` 全部不再存在。

Host 身份复用现有机制，**未新造鉴权**：`agent_host_credentials` → `authenticateHostAccessToken` → `AuthenticatedHostContext`（`packages/kernel/src/auth.ts:50-190`），与 worker 执行凭证（`AuthenticatedWorkerExecutionContext`，由 `authorizeWorkerExecution` 从 Host 凭证派生）是两个不同的类与两张不同的表。`markPresentedDeliverySent` 走的是 `createRunAttempt` / `finishRunAttempt` 同一串校验：`requireAuthenticatedHost` → `requireHostParticipant` → `requireRunAttemptOwner` → `requireRunAttemptHostGeneration`。

`computer-application-service.ts` 的 `hostCredentialId`（`#workerGrants`）是**远端 Host 会话签发 worker 凭证**时记录的归属，不是一条可复用的 Host→Kernel 认证通道；本批次没有用它。

### 2.1 正文排版（Host）

新模块 `packages/agent-host/src/wake-message-input.ts`，结构移植，**本批次已实现并有 golden 测试**；但**尚未有调用方**——把它接到 Codex 唤醒输入上的那一跳未做，见 §6。

| RAH 函数                    | Raft 源                                                                      | 说明                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `formatWakeMessagesInput`   | `formatConcreteMessagesRuntimeInput`，`RAFT_CHUNK:24357`（`main.js:836140`） | 表头 `New message received:` / `New messages received:`；正文块；可选 pending notice；末段 `Respond as appropriate. Complete all your work before stopping.` + RAH 的 response-target 提示 |
| `formatWakeIncomingMessage` | `formatIncomingMessage`，`main.js` char 36502339                             | `[target=… msg=… time=…<senderType>] <sender>: <content>` + attachment/task 后缀                                                                                                           |
| `formatWakeInboxNotice`     | `formatInboxUpdateRuntimeInput`，`RAFT_CHUNK:24389`（`main.js:836169`）      | content-free `[RAH inbox notice: …]`                                                                                                                                                       |

排版的**输入**由服务端给定（§2.2 返回的 `messages` / `noticeSeqs`）；Host 只决定文字形状，不决定哪些 seq 算已呈现。

RAH 寻址替换（与 `worker-read-render.ts` 头注释同一约定）：Raft 的 `--target "#channel"` / `@handle` 在 RAH 写作
`--target '#room'`（频道/Room）、`@handle`（DM）、`--thread-id <threadId>`（线程，RAH 无 `#channel:msg8` 短 id）。
消息 id 打全量 canonical id（理由同 `worker-read-render.ts:50-57`）。

**不移植**（RAH 无等价物，逐条声明）：`thread_follow_reactivation` 前缀、`third_party_event` payload 块、`producerFactId` lineage 方括号、`slock_cli` attachment hint 分支。
**移植**：`thread_join_context` 前缀、`attachments` 后缀、`task_status` 后缀。

### 2.2 正文来源与投递记录（PRESENT-ONLY，已实施）

路由 `/v1/worker/message-present`（worker 凭证）→ `RoomKernel.presentWorkerMessages(execution)` → `renderPresentedWindow`。请求体是**空对象**（`WorkerMessagePresentRequestSchema = z.object({}).strict()`）：范围不接受任何客户端输入。

服务端在同一事务内：

1. `requireLiveRunAttempt`：RunAttempt 必须存在且非终态（`exited|failed|cancelled|timed_out|orphaned`）；
2. 范围 = `activations.from_seq` .. `min(activations.to_seq, scope.toSeq)`——取凭证冻结的 head，不取 Activation 行的活 `to_seq`；
3. **有界取数**：`SELECT * FROM room_events WHERE room_id=? AND room_seq BETWEEN ? AND ? ORDER BY room_seq LIMIT 21`（预算 + 1），加一条 `COUNT(*) / MAX(room_seq)` 聚合。范围再大，离开 SQLite 的行数与响应体都不增长；
4. 选页：按 seq 升序，`WAKE_BODY_MAX_MESSAGES = 20` / `WAKE_BODY_MAX_BYTES = 64 KiB`，**覆盖所有事件类型**；**逐条判定**，装不下的那条退化为 notice 并继续评估后面较小的事件，因此 presented 集合**可以有空洞**；
5. 未渲染的尾部以 `noticeCount` + `noticeFromSeq` / `noticeToSeq` 的**摘要**返回，**不逐条列出**——逐条会让响应体随账本增长；
6. `presentedThroughSeq` = presented 前缀头（见 §2.4），首条即退化时为 0；
7. `contentDigest = canonicalDigest({fromSeq, toSeq, events:[{eventId, roomSeq, type, payload}]})`——由服务端算；
8. 写入记录（`sent_at = NULL`）。重复调用返回同一条记录；范围或 digest 不一致 → `ConflictError`。

**不做**的事（逐条）：不写 `activation_delivery_windows`（不调 `workerDeliveryReplayStart`）；不登记 `grant.deliveredCursors`（因此 `/v1/worker/acknowledge` 与 `sync` 续传都不接受这个游标——链测试 `present-only fetch registers no delivered cursor and no acknowledgement` 断言 `sync{afterSeq}` 返回 409 `invalid_continuation`）；不推进 `subscription_cursors`；不推进 `worker_target_read_positions`；不追加 room event。

**唯一登记的是** `grant.knownRoomSeqs.add(presentedThroughSeq)`，且**前缀为空（0）时一个都不加**。

第三轮评审指出上一版登记的是整窗 `toSeq`：即使中间有未呈现事件，模型也能用最大游标越过新鲜度检查发帖。「没有确认未读」与「没有基于未读范围发帖」是两件事，上一版只守住了前者。现在可引用的因果依据也只到已呈现前缀；空前缀的 RunAttempt 只能走 `message-check` 才能碰到这个 Room。

不加这一条，`/v1/worker/messages/post` 的 `#requireKnownCausalCursor` 会 409，隐式 ACK 在 HTTP 上永远不可达（由红测发现）。

`workerStartupContext()` 的冻结清单与 MEMORY.md 尚未并入该响应：**待接线**，见 §6。

### 2.3 「已送达运行时」登记（Host 身份）

`RoomKernel.markPresentedDeliverySent(host, { activationId, consumerId, runAttemptId })` → `markPresentedWindowSent`：

1. 记录不存在 → `NotFoundError("no presented rendering to register as sent")`——只能引用服务端已写下的渲染；
2. 已由同一 Host 标记 → 幂等 no-op；由另一个 Host 标记 → `ConflictError`；
3. 只写 `sent_at` / `sent_by_host_id`；范围、`messageSeqs`、`contentDigest` 一个都不能改。

**调用时机**：只在驱动给出**接受信号**之后。四个驱动的接受信号强度，按「有 / 无 / 待核」重列（上一版把「Claude 初始化帧」「Kimi 无 error」直接写成「接受」，过强）：

| Driver             | 接受信号强度     | 现状                                                                                                                                                                                                                                                                                                                                          |
| ------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codex app-server   | **有（已接线）** | `turn/start` 请求的 JSON-RPC **应答**：`codex-app-server-driver.mjs` 在 `activeTurnId = nestedStringField(startedTurn, "turn", "id")` 之后发信号。两重关联——请求 id 由 `pending` 表在 `requestState.resolve` 前匹配，`turnStart.threadId === activeThreadId` 已由 `thread/start`/`thread/resume` 校验；`result.turn.id` 即该输入所属的 turn。 |
| Claude stream-json | **待核**         | 首个 `system`/`init` 帧只证明进程起来了，不证明这次输入被接收；协议无逐输入回执。需在批次 0 矩阵上补一次实测。                                                                                                                                                                                                                                |
| Kimi ACP           | **待核**         | `session/prompt` 只有**否定**信号（error 应答）可靠；「无 error」不等于已接收。                                                                                                                                                                                                                                                               |
| OpenCode server    | **待核**         | prompt HTTP 2xx 是服务端受理，不是模型侧接收；需确认 2xx 与 turn 的对应关系。                                                                                                                                                                                                                                                                 |

**绝不**以 stdin 写成功单独登记 `sent_at`。「待核」的三个驱动在核实前**不应调用** `markPresentedDeliverySent`，其 Activation 继续走显式 `message-check`。四驱动接线本批次不做，见 §6。

### 2.3b Codex 接受信号的传导链（本批次接线）

```
turn/start 应答
  → 驱动 fd3 写 {"protocol":"rah-delivery-accepted/v1","signal":"turn/start.response",threadId,turnId}
  → GenericProcessAdapter 的 fd3 解析器 parseDeliveryAcceptance（与 Provider session evidence 同一处拦截，
    先于 canonical trajectory 解析，因此 runtime 的 thread/turn id 永不成为 Room 或 UI 事实）
  → RuntimeCreationOptions.recordDeliveryAcceptance（**仅 Codex 工厂**透传并校验 provider）
  → createConfiguredRuntime 的 recordDeliveryAcceptance
  → daemon-application.ts：kernel.markPresentedDeliverySent(host, …)，**Host 凭证**
```

- **绝不**以 stdin 写成功、进程启动或退出码触发：这条线只有 `turn/start` 应答到达才会走。
- 信号缺失 / 超时 / 驱动报错：`writeDeliveryAcceptance` 不会被执行（它在 `await request(...)` 之后），`sent_at` 保持空，后续发帖不隐式 ACK，Activation 仍需显式 `message-check`。
- 尚未 `message-present` 的 RunAttempt 收到信号：`markPresentedDeliverySent` 抛 `NotFoundError`，daemon 侧吞掉并视为 no-op（这正是渲染注入未接线前的常态），其余错误照常抛出。
- **其余三个驱动**：`RuntimeCreationOptions.recordDeliveryAcceptance` 在它们的工厂里被解构丢弃，行为与本批次之前完全一致。

### 2.3c 竞态闭合（审查明令）

模型可能在 `sent_at` 落库之前就完成发帖。「首次回复成功却永远漏 ACK」不可接受，而在发帖当场 ACK 又会架空 `sent_at` 闸门。做法是**发帖只记录证据，不动用证据**：

- `deferPresentedAcknowledgement`（`activation-presented-window.ts`）在 `acknowledgePresentedDeliveryInTransaction` 里，**已经通过跨 Room 与模型显式游标两道闸门之后**，把该游标写进 `pending_ack_seq`（`UPDATE ... WHERE sent_at IS NULL`，取 MAX）；
- `markPresentedWindowSent` 返回该值，`RoomKernel.markPresentedDeliverySent` 在同一事务内用它重新调用 `acknowledgePresentedDeliveryInTransaction`，**四道闸门原样再走一遍**；
- 信号永不到达 → `sent_at` 恒空 → 该列从不被读取 → 游标不动。

跨 Room 的帖子在发帖当场就被闸门 1 拦下，从不入库为 pending，因此也不会在 mark-sent 时被"补做"。

### 2.4 隐式 ACK（Kernel，已实施）

单一确认入口 `RoomKernel.acknowledgePresentedDeliveryInTransaction(scope, { postedRoomId, modelBasedOnRoomSeq })`。**两条发帖路径都经过它**：

- 原生路径 `postWorkerMessage`（`room-kernel.ts`，`"event" in result` 之后）；
- `--target` 路径 `WorkerTargetContextService.post`（`worker-target-context.ts`，通过 `Context.acknowledgePresentedDelivery` 回调，同一事务内）。

上一版 `input.channel !== undefined` 直接 `return this.workerTargetContext.post(...)`，`--target` 发帖完全绕过确认；现已合流。

四道闸门，任何一道不过就不 ACK：

1. **跨 Room**：`postedRoomId !== scope.roomId` → 不 ACK。判定用发帖**实际落入**的 `result.event.roomId`，不是请求里的 target 字符串。`--target '#other'` 或 DM 发帖成功，不确认本 Activation 所在 Room 的任何范围。
2. **缺省游标**：`modelBasedOnRoomSeq === undefined` → 不 ACK。删除了上一版的 `basedOnRoomSeq ?? scope.toSeq`。`--target` 路径 Raft 不带因果参数、由内核 `#resolveSendWindow` 从自身状态解析——**解析出来的游标不算模型提交**，不触发隐式 ACK；模型要么显式带 `basedOnRoomSeq`，要么走 `message-check`。
3. **未送达**：`sent_at IS NULL` → 不 ACK（§2.0(c)）。
4. **游标不足**：`modelBasedOnRoomSeq < throughSeq` → 不 ACK。

通过后，`throughSeq` 与 `messageSeqs` 由 **presented 前缀**决定（`presentedPrefix`）：

- 按 seq 升序扫描窗口内的**全部** Room 事件（`LIMIT 已呈现条数 + 1`，有界）；
- 遇到第一条**不在** `presentedSeqs` 里的事件（**任何类型**），`throughSeq = 该 seq - 1`，扫描停止；
- 全部呈现则 `throughSeq = window.toSeq`；
- 传给 `recordCheckedWorkerMessages` 的 `messageSeqs` 只取该前缀内 `type='message.posted'` 的那些（读位置只对消息有意义）。

两次收窄：

1. 上一版只要 `messageSeqs` 非空就 `throughSeq = window.toSeq`，会越过退化为 notice 的消息。
2. 再上一版的前缀扫描只看 `message.posted`，任务取消/指派/状态变化被一概越过——而这些事件 `message-check` 今天就会渲染给 Agent（§0.1 事件类型范围）。现在任何类型的未呈现事件都会让游标停下。

实测：窗口内消息 A 呈现、Thread 消息 B 退化 → 游标停在 B 之前；20 条消息占满条数预算、其后的成员变更事件退化 → 游标停在第 20 条，成员变更与其后的消息保持未读。

随后执行与 `recordCheckedWorkerMessages`（`worker-delivery-window.ts:14-58`）完全相同的事务，再 `#acknowledgeCursorForParticipant`。`message-check` 路径行为不变；重试/围栏语义不变。

### 2.5 已呈现前缀参与新鲜度判断（`--target` 路径）

第三轮评审指出上一版把「首次 `--target` 发帖落为 held draft、第二次 `sendDraft` 才发布」写进了测试，等于把额外往返当成正常流程。根因：`#resolveSendWindow` 的派生分支用 `worker_target_read_positions` 当依据，而 present-only **不推进读位置**，于是 `basedOnRoomSeq` 解析成 0、新鲜度地板为 0，必然 hold。

改法（`worker-target-context.ts` `#resolveSendWindow` 派生分支）：

```
freshnessFloorSeq = max(basedOnRoomSeq, 自己最后一帖 seq, presentedFreshnessFloor(origin, target.roomId))
```

`presentedFreshnessFloor`（`activation-presented-window.ts`）刻意狭窄：

- 记录必须 `sent_at` 非空；
- 目标必须是本 Activation 自己的 Room；
- 取值是 presented **前缀**，不是 `toSeq`——第一条退化事件之后的内容确实未读，仍然要 hold。

**只抬地板，不动 `basedOnRoomSeq`**：因果游标仍是服务端自己的读位置，隐式 ACK 仍然只认模型显式提交的 `basedOnRoomSeq`（§2.4 闸门 2）。

实测：呈现后无新事实 → 首次直发成功并 ACK；呈现后又来一条新消息 → 仍然 hold。

**原生 `/v1/worker/messages/post` 路径（第四轮复核结论：无需改动，且已证明改了也是死代码）**。

本轮按要求实现了「原生路径以已呈现前缀为新鲜度依据，同一函数」，随后的变异验证**没有任何测试变红**。追查原因并证明如下：该路径自身的闸门是 `resolveWorkerReplyRoute` 的 `input.basedOnRoomSeq !== scope.toSeq → StaleContextError`（`worker-message-routing.ts:192-193`），所以因果游标恒等于 Activation head；而已呈现前缀按构造 ≤ `scope.toSeq`，于是 `Math.max(basedOnRoomSeq, presentedFloor) === basedOnRoomSeq` 恒成立——这行代码不可能改变任何结果。`sendDraft` 分支同样受该等值闸门约束，不构成例外。

因此该改动**已回退**，只在 `worker-message-command.ts` 留下说明为何缺席。要让前缀在这条路径上真正有意义，前提是允许因果游标**低于** Activation head，即修改那道 staleness 闸门（`worker-message-routing.ts`），属于另一项决定：**待接线**，见 §6。

### 2.6 Standing prompt（`provider-activation-input.js`）

**本批次不动**（任务书明确禁止）。待批次 1 接线完成后再处理。

## 3. 不变量核对

| `AGENTS.md` 不变量                                                                    | 本批次                                                                                            |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| wake hint / spawn / PTY write / RPC response / exit code 不证明已读                   | presented ≠ ACK；ACK 仍需模型侧凭证发起的、带模型自己因果游标的 mutation（§2.4）                  |
| Completing an Activation requires the runtime consumer to acknowledge through `toSeq` | 不变；隐式 ACK 只覆盖 presented **前缀**，前缀 `< toSeq` 时 Activation 仍未满足                   |
| Actor identity from authenticated context                                             | 记录内容由服务端生成；`sent_at` 绑定 `AuthenticatedHostContext`；请求体不含任何身份或范围（§2.0） |
| Idempotency keys prevent duplicate effects                                            | 记录按 `(activation, consumer, runAttempt)` 幂等；重复 render 与重复 mark-sent 都是 no-op         |
| Every accepted mutation appends one Room event                                        | present 与 mark-sent **不是** business mutation，与 `acknowledgeWorkerCursor` 同级，不追加事件    |
| Provider adapters must not own business status                                        | Host 只提供「已送达运行时」这一事实，页选择、digest 与 ACK 判定全在 Kernel                        |

**冲突项：无。**

## 4. 测试与变异验证（本批次已跑）

内核（`packages/kernel/test/activation-presented-window.test.ts`，真实 `RoomKernel` + 真实 SQLite + 真实 Activation/RunAttempt/凭证链）：

1. `the Kernel renders the range itself and the record is server-owned`
2. `the cursor stops before the first message that degraded to a notice`
3. `a window whose events were all presented reaches its head`
4. `a non-message event that degraded to a notice stops the cursor too`
5. `an unsent rendering acknowledges nothing`
6. `a post with no model-submitted causal marker acknowledges nothing`
7. `a presented record can only be created and marked sent by the server and the Host`
8. `a finished RunAttempt renders nothing`

链测试（`packages/application-service/test/presented-delivery-chain.test.ts`，真实 `RoomKernel` + 真实 SQLite 文件 + 真实 Worker HTTP 路由）：

1. `present-only fetch registers no delivered cursor and no acknowledgement`
2. `a plain post with the model's own cursor acknowledges the presented prefix`
3. `a post with no model-submitted cursor leaves the range unacknowledged`
4. `a --target post into this Activation's own Room acknowledges through the same entry point`（首次直发成功，无 held-draft 往返）
5. `a --target post into another Room acknowledges nothing here`
6. `a Thread post in this Room acknowledges the presented prefix`
7. `a retry under the same idempotency key does not change what was acknowledged`
8. `an Activation handled without posting acknowledges nothing and stays open`
9. `the full window is not a citable cursor once anything degraded`（`toSeq` → 409 `causal_cursor_not_delivered`）
10. `a notice-degraded Thread message stops the acknowledgement and stays readable`（前缀游标 → 发布成功，ACK 只到前缀）
11. `a Task event inside the window is presented and acknowledged with the messages`
12. `a reassignment the budget could not render stops the cursor before it`
13. `a new message after the rendering still holds the --target reply`
14. `the present response stays bounded as the range grows`
15. `a terminal RunAttempt's credential can neither present nor acknowledge`
16. `a late request after the Room was stopped acknowledges nothing`

变异验证（注掉守卫，确认恰好对应测试变红；基数 24 项）：

| 变异                                                  | 变红                                |
| ----------------------------------------------------- | ----------------------------------- |
| 前缀扫描只看 `message.posted`（非消息事件重新被越过） | 内核 4、链 12（fail 2 / 24）        |
| `knownRoomSeqs.add(toSeq)` 取代前缀                   | 链 9（fail 1 / 24）                 |
| 已呈现前缀不再抬新鲜度地板                            | 链 4、链 10（fail 2 / 24）          |
| 取数 `LIMIT` 放开且去掉条数预算                       | 链 14、内核 4、链 12（fail 3 / 24） |
| （上一轮）去掉前缀截断                                | 内核 2、链 10                       |
| （上一轮）去掉跨 Room 闸门                            | 链 5                                |
| （上一轮）恢复 `basedOnRoomSeq ?? scope.toSeq`        | 内核 6、链 3                        |
| （上一轮）去掉 `sent_at` 闸门                         | 内核 5                              |

**诚实说明**：SQL `LIMIT` 本身不可观测——单独放开它而保留条数预算，输出不变、没有测试会红。能被测试钉住的是**响应形状的上界**（`events` ≤ 20、notice 只给计数与范围、protocol schema 的 `.max(20)`），上表第四行正是同时破坏这两者才变红的。

回归：`agent-task-split-chain`、`busy-hold-recovery-chain`、`presented-context-second-activation` 三条 daemon 链全绿。

### 4c. 第 2 步（Codex 贯通）新增

Host 渲染 golden（`packages/agent-host/test/wake-message-input.test.ts`，9 条）：
`the closing line is Raft's, verbatim`、`one message renders the singular header and the Raft line shape`、
`several messages render the plural header`、`the three RAH target shapes render as written`、
`attachment, task and thread-context affordances ride the Raft suffixes`、
`a non-message event renders in the Worker read renderer's own shape`、
`the notice is a bounded summary and never a list`、
`a wake with bodies carries the notice between the bodies and the closing line`、
`a fully degraded range renders the notice alone`。

竞态与跨 Room（链测试新增 3 条）：
`a post that beat the Host's mark-sent is acknowledged when it lands`、
`a post that beat a mark-sent which never arrives is never acknowledged`、
`a parked marker from another Room is never replayed`。

Codex 接受信号（`packages/daemon/test/codex-delivery-acceptance-chain.test.ts`，5 条）：
`the acceptance signal registers the send over the existing Host session`、
`no acceptance signal leaves the send unregistered and the range unacknowledged`、
`a repeated acceptance signal is idempotent`、
`an acceptance signal with no rendering behind it registers nothing`、
`the remote Host session carries the same registration as a typed command`。

相位表（内核 1 条）：`the phase table's fields are readable without any new measurement`。

第 2 步变异验证（基数 32）：

| 变异                                          | 变红                                                      |
| --------------------------------------------- | --------------------------------------------------------- |
| 去掉 `deferPresentedAcknowledgement` 的记录   | 链「a post that beat the Host's mark-sent…」（fail 1/32） |
| `markPresentedWindowSent` 不返回 pending 游标 | 同上（fail 1/32）                                         |
| 原生路径不再取已呈现前缀作为新鲜度地板        | **fail 0/32** —— 见 §2.5：该改动可证为死代码，已回退      |

## 4b. 已覆盖 / 未覆盖

**已覆盖**：服务端渲染 + 不可变投递记录；全类型事件纳入呈现与前缀（含 Task 创建/取消/指派）；notice 退化停住游标（消息与非消息各一）；Host 身份的 `sent_at` 登记（幂等、异 Host 冲突、不可改范围/digest）；单一确认入口的四道闸门（跨 Room、缺省游标、未送达、游标不足）；可引用因果游标只到前缀；已呈现前缀抬新鲜度地板且新消息仍 hold；响应有界；幂等重试；终态 RunAttempt；Room stop 后迟到请求；不发帖时 Activation 不完成。

第 2 步后追加——

**已覆盖**：Codex 接受信号的传导契约（有信号 → `sent_at` 非空 → 前缀被 ACK；无信号 → `sent_at` 空且不 ACK；重复信号幂等；无渲染时拒绝）；竞态闭合两向（先发帖后 mark-sent → 最终推进；mark-sent 永不到 → 不动）；跨 Room 的 parked 游标不被补做；Host 排版 golden 九条（含末句原文、单复数表头、三种 target、非消息事件、notice 摘要）；相位表五个字段可读；`delivery.presented.sent` 命令的请求形状（拒绝携带范围/digest）。

**未覆盖**：`message-present` → 渲染 → 注入 Codex turn 这一跳（wake-message-input 尚无调用方）；真实 Codex app-server 进程发出的 fd3 帧（驱动侧代码已写，无伪协议门禁）；`delivery.presented.sent` 经真实 Host 会话的端到端往返（只钉了请求形状）；其余三驱动的接受信号；清单/MEMORY.md/包装文本的预算扣减；真实 CLI 门禁；任何延迟收益测量。

## 5. 真实 CLI 门禁（业主执行，本批次不跑）

```bash
cd /Users/sun/Code/repos/rah_os
RAH_REAL_CLI_GATE=1 RAH_REAL_CLI_RUNTIME=claude RAH_REAL_CLI_MODEL=sonnet \
  RAH_REAL_CLI_REASONING=low \
  npm run test -w @rah-os/daemon -- --test-name-pattern "real-core-chain-gate"
```

模型绑定必须与 `AGENTS.md`「Authorized paid CLI gate models (2026-09-09)」一致：Claude=`sonnet`/low、Codex=`gpt-5.6-luna`/low、OpenCode=`deepseek/deepseek-v4-flash`/low、Kimi=`kimi-code/k3`/high。永不使用 Fable。

## 6. 待接线（本批次未做，明确不是「完成」）

1. **`sent_at` 的 HTTP 路由**：内核函数 `RoomKernel.markPresentedDeliverySent(host, …)` 已就绪并由测试覆盖，但没有对应的 HTTP 端点。Host 目前只能在同进程内调用它。远端 Host 的路由归属（`computer-application-service` 的 Host 会话，还是新的 host-facing 路由）**待接线**。
2. **四个驱动的接受信号**：`agent-host` 一行未动。在 §2.3 表里标「待核」的三个驱动核实之前，不得调用 mark-sent。
3. **Host 排版模块** `wake-message-input.ts`：未创建。
4. **`workerStartupContext()` 并入 present 响应**：未做，present 响应目前只返回消息事件与 notice seq。
5. **Standing prompt**：按任务书要求未动。
6. **正式部署/重启**：未做。
7. **原生 `/v1/worker/messages/post` 的新鲜度依据**：`resolveWorkerReplyRoute` 仍要求因果游标等于 Room head，已呈现前缀不参与。改动落点在 `packages/kernel/src/worker-message-command.ts`（本批次文件集之外），**待接线**。
8. **唤醒输入的单一预算**：清单、MEMORY.md 与包装文本尚未从 64 KiB 里扣减（§0.1 预算口径表），**待接线**。
9. **渲染注入这一跳（第 2 步剩余的核心项）**：`wake-message-input.ts` 已实现且有 golden，但没有调用方。插入点是 `packages/daemon/src/runtime-profile-composition.ts` 的 `activationEnvironment`——它已经持有本次 Activation 的 worker 凭证与 `workerService.origin`，可在那里调 `/v1/worker/message-present`、渲染、以 env 传给驱动；Codex 驱动再用它替换 `turnStart.input[0].text` 里的固定字面量（`providerActivationInput()` 作为后缀保留，`message-check --startup` 回退不动）。**未做，一个未决问题先要业主/审查定**：present 响应目前只返回原始 `RoomEvent`，没有 `syncWorker` 那样的 `addressing`，因此渲染只能打 `#<roomId>` 与 `actorId`，而不是 `#slug` 与 `@handle`。要打对，present 响应需要复用 `workerAddressing` 增加 addressing 字段（又一次协议扩张）。在此之前不接线，以免给模型一份寻址比 `message-check` 更差的唤醒文本。
10. **伪 Codex app-server 协议门禁**：未写。驱动侧 `writeDeliveryAcceptance` 与适配器侧 `parseDeliveryAcceptance` 已实现，但没有伪协议进程验证「唤醒文本含正文与末句 / 有信号 → `sent_at` / 无信号 → 空 / notice 摘要 / 停止后迟到被拒 / 断线重试幂等」这一整组。其中与内核契约有关的四条已由 `codex-delivery-acceptance-chain` 以真实 Kernel 覆盖；剩下与驱动进程有关的部分待第 9 项接线后一并做。
11. **`delivery.presented.sent` 的会话端到端**：命令、响应、dispatch、port、远端控制端已实现并通过 tsc；只钉了请求形状，没有真实 `openSession` 往返测试（该测试与既有 fixture 的 Host 实例代际冲突，需另起 fixture）。
