# loom 本地协议

## 1. 范围

单机采用 hc、薄 loomd 和 skill。hc 持有原生 TUI 窗格，所有角色通过 `loom spawn` 启动。loomd 负责会话索引、历史查询、投递和阻塞检测。重启后按窗格和已知原生会话重新绑定。角色分工、派工和验收由 skill 决定。

Super 主动用 `loom hist` 查历史，需要追问时用 `loom send` 默认排队。角色把结果、阻塞和问题写在普通最终回复里，由 loomd 搬运。[现行 TypeScript 类型](../../schema/protocol.ts)

## 2. 会话索引

每条记录保留以下字段，活动与已结束的会话均可查。时间为 Unix 毫秒。

| 字段 | 含义 |
| --- | --- |
| `role`, `project`, `task`, `wave` | 启动时登记的角色、项目、任务和波次。角色为 `super`、`leader`、`auditor`、`worker`。 |
| `addr`, `cli`, `model` | 索引中唯一的窗格地址、适配器 ID 和启动模型。 |
| `sessionId`, `transcriptPath` | 已绑定的原生会话 ID 和转录绝对路径，未知时分别填 `null`。 |
| `cwd`, `account`, `baseCommit` | 工作目录绝对路径、账号占位（固定 `null`）和启动时 cwd 对应的 Git 提交（无法取得时为 `null`）。 |
| `startedAt`, `endedAt`, `parent` | 窗格启动时间、会话确认结束时间、发起 `spawn` 的登记会话地址。尚未结束或从外部发起时，对应字段为 `null`。 |

## 3. 命令与回执

每次调用向 stdout 输出一条 JSON。成功分支含 `"ok":true`，退出码为 `0`。失败形如 `{"ok":false,"error":{"code":"not-found","message":"找不到目标"}}`。程序按退出码和 `error.code` 判断，`message` 供人阅读。

| 退出码 | 错误码 |
| --- | --- |
| `1` | `unavailable` 表示运行、读取或启动失败。 `unsupported` 表示能力缺失。 `not-ready` 表示目标已结束或所需活动轮不可用。 `uncertain` 表示操作结果尚待核对。 |
| `2` | `invalid-arguments` 表示命令参数无效。 |
| `3` | `not-found` 或 `ambiguous-target` 表示目标不存在或匹配多条记录。 |

`<target>` 可用角色、任务或窗格地址。先匹配精确的 `addr`，再按角色或任务匹配唯一会话。角色和任务在调用者的已登记项目内查找，从外部调用时在全索引查找。多条匹配时用 `loom ls --project <project>` 查明地址。

### `loom spawn <role> --cli <cli> --model <model> --effort <effort> --cwd <cwd> --project <project> --task <task> --wave <wave> [--skill <skill>] "<prompt>"`

除 `--skill` 外均必填。`cwd` 解析为绝对路径。可选 `--skill` 指定启动时使用的 skill，`prompt` 为首轮输入。`0` 返回完整索引记录，确认 hc 已启动窗格且 loomd 已持久登记。原生开轮由 `turn-start` 确认。参数无效返回 `2`，启动或登记失败、适配器不可用或结果待核对返回 `1`。

```json
{"ok":true,"session":{"role":"worker","project":"demo","task":"T1","wave":"W1","addr":"t101","cli":"codex","model":"gpt-6.2-sol","sessionId":null,"transcriptPath":null,"cwd":"/work/demo","account":null,"baseCommit":null,"startedAt":1760000000000,"endedAt":null,"parent":"t100"}}
```

### `loom send <target> [--mode queue|steer|interrupt] "<msg>"`

`msg` 为非空文本。默认 `queue` 在目标当前轮结束且可写空闲后投递，目标已空闲时可直接投递。`steer` 只在适配器已验证原生插话时写入请求针对的活动轮，否则降级为 `queue`。`interrupt` 中断请求针对的活动轮，确认该轮结束且原窗格可写后提交新文本，需要 `interrupt` 和 `resumeSamePane` 能力。原生插话和中断在写入前重新核对目标轮。

`0` 返回 `{"ok":true,"addr":"t101","deliveryId":"d1","requestedMode":"steer","mode":"queue","downgraded":true}`，表示 loomd 已持久接管。未降级时 `mode` 等于 `requestedMode`，`downgraded` 为 `false`。原生收件及回复见第 7 节。参数无效返回 `2`，目标解析失败返回 `3`，已结束、缺少所需活动轮或能力、接管失败或结果待核对返回 `1`。

### `loom hist <role|task|addr> [--turns <N>] [--level L1|L2]`

`N` 为正整数，默认 `5`。`level` 默认 `L1`。只读返回最近至多 N 轮，按轮号从早到晚排列。尚无轮次时 `turns` 为空数组。查询成功返回 `0`，参数无效返回 `2`，目标解析失败返回 `3`，已登记的历史无法读取时返回 `1`。

- L1 每轮包含轮号和摘要，如 `{"ok":true,"addr":"t101","level":"L1","turns":[{"index":1,"summary":"核对接口。工具调用 2 次。"}]}`。
- L2 返回 loom-transcript 的逐轮对象。`startedAt`、`endedAt` 为转录中的时间字符串，未知为 `null`。`calls` 按模型调用记录 `id`、`timestamp` 和已知的 token 用量。

```json
{"ok":true,"addr":"t101","level":"L2","turns":[{"index":1,"id":"r1","startedAt":null,"endedAt":null,"status":"completed","reply":"接口已核对。","usage":{},"calls":[]}]}
```

### `loom state <target>`

`0` 返回当前观测快照，如 `{"ok":true,"addr":"t101","state":"stuck","reason":"trust","deliveries":[{"deliveryId":"d1","status":"pending"}]}`。`reason` 仅在 `stuck` 时出现，`deliveries` 是该目标已接管投递的记录。参数无效返回 `2`，目标解析失败返回 `3`，快照无法取得时返回 `1`。

### `loom ls [--project <project>]`

可按项目精确过滤，省略时列出全部会话。`0` 返回 `{"ok":true,"sessions":[]}`，`sessions` 中每项是完整索引记录，无匹配时为空数组。参数无效返回 `2`，索引无法读取时返回 `1`。

### `loom stop <target>`

关闭目标会话并保留索引与历史。`0` 返回 `{"ok":true,"addr":"t101","endedAt":1760000000000}`，表示窗格中的会话已确认结束。已结束目标返回原 `endedAt`。参数无效返回 `2`，目标解析失败返回 `3`，关闭失败或无法确认时返回 `1`。

## 4. Role Session 状态

`state` 报告当前观测，取 `unknown`、`idle`、`busy`、`stuck` 或 `exited`。以绑定会话的原生 hook 和转录为准，屏幕分类用于可写性检查和阻塞诊断。屏幕空闲、按键成功和无输出超时均不足以确认收件或完轮。阻塞或可写性未确认时保留待投消息。

## 5. 事件

每条事件带 `eventId`、`addr`、`at`（Unix 毫秒）和 `type`。已归属的 `turn` 与历史的 `index` 对应，从 1 开始。按同一窗格及原生身份对账，重读 hook 或转录时沿用同一事件 ID。

| `type` | 字段和语义 |
| --- | --- |
| `turn-start` | `turn`。已确认的原生根回合开始。 |
| `turn-end` | `turn`、`finalReply`。已确认的原生根回合结束及其最终正文。hook 缺正文时查同一轮的转录，确认没有正文时填 `null`。 |
| `stuck` | `reason` 为 `trust`、`picker`、`rate-limit`、`auth` 或 `idle-without-stop`。最后一种表示未结算轮已持续空闲，补查原生记录后仍缺结束证据。同一次同原因的持续阻塞只发一条。 |
| `usage` | `turn`、`usage`。可归属到本轮的用量增量，累计原生值先去重并换算成增量。字段沿用 `calls`、`inputTokens`、`cachedInputTokens`、`cacheWriteInputTokens`、`outputTokens`、`reasoningOutputTokens`，未观测值省略。 |

## 6. 适配器

每家 CLI 导出一个适配器对象。能力按对应版本的原生 TUI 实测声明。[ADAPT-codex 任务卡](../tasks/ADAPT-codex/TASK.md)

| 成员 | 契约 |
| --- | --- |
| `id`, `capabilities` | `id` 对应 `--cli`。能力字段为 `steer`（`native`、`tui-queue`、`none`）、`interrupt` 和 `resumeSamePane`（布尔值）、`hookInjection`（`cli-flag`、`settings-arg`、`project-file`）。只有 `native` 表示可以插入活动轮。 |
| `launch({ model, effort, cwd, prompt, hookSink, extraArgs })` | 返回 `{ argv, env }` 用于 hc 启动免审批、无选择器的 TUI。`argv[0]` 为程序，`env` 为启动时的环境变量覆盖项。`hookSink` 为本次启动的本地 JSONL 收集文件绝对路径，记录由同一适配器解释。`extraArgs` 为额外参数数组。hook 按次注入。全局配置禁止写入，项目文件注入仅限本次使用且须验证该配置本身不会触发信任框。 |
| `screen.classify(text)`, `screen.dialogKeys(kind)` | 分类为 `idle`、`busy`、`trust-dialog`、`picker`、`rate-limit`、`auth-fail` 或 `unknown`。对已验证的弹窗返回按键序列，其余返回空数组。 |
| `hooks.normalize(payload)` | 返回 `{ type, sessionId, transcriptPath, finalReply? }`。`type` 为 `turn-start`、`turn-end`、`tool` 或 `stop-failure`，身份与路径未知时各填 `null`，无需处理时返回 `null`。`tool` 和 `stop-failure` 用于适配器观测。 |
| `transcript.locate({ sessionId, cwd })`, `transcript.parse(text)` | 定位已绑定的转录，返回绝对路径或 `null`。解析返回 loom-transcript 的 `Session` 结构 `{ provider, turns, lastReply, usage }`，供历史查询复用。 |
| `transcript.turnSummary(session, n)` | 按从 1 开始的轮号返回 L1，单轮至多 400 token。包含做了什么、工具调用计数、已知非零退出命令和最终回复首段。缺失事实应标明未知。 |
| `input.plan(mode)` | 返回 `{ mode, downgraded, steps }`，分别为有效模式、降级标记和有序步骤。`{"type":"text"}` 写入本次文本，`{"type":"key","key":"enter"}` 表示按键。队列等目标可写再执行计划，中断先执行中断键，核对轮末和可写性后继续文本步骤。 |

## 7. 投递与恢复

- **0 丢、0 重。** 先持久化意图再回执，事件、待投消息和合并批次在推进消费位置前持久化。同一目标串行写入，`queue` 按接管顺序等待。相同正文的独立 `send` 各有新 ID。原生证据确认收件后记为 `delivered`，仍在等候为 `pending`，确认未收件且该投递无法继续时为 `failed`。重启后按同一窗格的原生证据对账。确认未写入或原生明确未接管时沿用原 ID 重试。结果不明记为 `uncertain` 并暂停重发。已接管的记录和正文持续可查。目标仍能接收该输入且可对账时，同一 ID 最终送达一次。
- **回复路由。** `spawn` 的首轮最终正文回送 `parent`，`send` 所关联的原生回合最终正文回送发起该请求的登记会话。外部调用从 `hist` 取回复。每份最终正文按来源事件和收件地址去重，经默认队列送达。自动回送产生的新回合无回送路由。
- **按波合并。** 父会话同轮用相同的 `project`、`wave` 登记一批 `spawn`，父轮结束时确定成员。同一父会话的同项目波次号只用一次。成员首轮全部结束（或会话已退出）即向父会话合并投递。从父轮结束起最多等 900 秒，届时投递已到的正文并列出未完成成员。晚到正文入历史，按同波合并尚未回送的正文并补投。合并保留正文及对应任务，重启复用已持久化的批次 ID。

## 附录：不做

- app-server、headless 及第二套运行体系。
- daemon 内的业务方法论和任务状态机。
- 根据额度自动切换账号或模型。
- 多账号、容器和跨机在单机达标后再议。
