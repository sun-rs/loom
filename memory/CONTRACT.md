# Memory v1 测试接口约定

行为以 [MEMORY.md](../docs/MEMORY.md) 为准。工厂接受注入的时钟和 I/O，`now()` 返回 Unix 毫秒，记录中的时间使用 ISO 8601。

## 会话绑定与条目

- 可信会话层传入 `binding = { sessionId, principal, role, project, cardId, dependencies, attachments, authorizedIds, ancestors? }`。
- `role` 为 `super | auditor | leader | worker | reviewer`。作者和私有材料所属的逻辑身份用 `principal` 标识。
- `project` 为项目 ID 或 null，`cardId` 为卡片 ID 或 null。`ancestors` 为同项目的祖先卡片 ID 数组。
- `dependencies` 为 `{ project, cardId }[]`，`attachments` 为记忆 ID 数组，`authorizedIds` 为 `{ memory: string[], history: string[] }`。无授权时使用空数组。
- 条目使用唯一的 `layer: shared | private | candidate | user | cross_project`，以及 `kind: ruling | preference | lesson | candidate`。
- 条目字段包括 `id, revision, project, layer, kind, status, author, role, title, body, keywords, importance, source, checkedAt, effectiveAt, updatedAt`。按需附 `cardId, owner, proposedKind, proposer, reviewer, original, supersedes, supersededBy`。替代关系使用 ID 数组。
- `source` 含经核验的 `path` 或 `sha`。`externalSource` 为观察到的 `{ kind: 'web' | 'mcp', location, observedAt }[]`。
- 生效状态为 `active`，其余包括 `pending, promoted, merged, returned, rejected, superseded, stale, forgotten`。历史使用相同的 `project, layer, owner` 字段。Worker 历史以 `role: 'worker'` 和 `cardId` 标识。
- 申请写入的项目是目标范围，作者身份与项目权限取自绑定，请求顶层的身份字段不参与授权。用户层和跨项目层归独立空间，允许 `project: null`。

## 写入

- `store.mjs` 导出 `createMemoryStore({ now, readState, commitState, evidence, ...options })`。`store.write(binding, request)` 是 home 的写入口。请求有 `op, requestId`，以及适用的 `id, expectedRevision, entry`。创建声明 `expectedRevision: null`。
- `op` 支持 `put, propose, forget, promote, merge, return, reject, import_rulings`。修改待审候选使用 `propose` 并带原 ID 和预期修订。审结用候选 `id, cardId, expectedRevision`，merge 另带 `targetId, targetExpectedRevision, body`。导入用 `entries`。
- `put` 可通过 `entry.supersedes` 增加替代关系，修订时保留已有关系。每个新增目标须为调用者有权维护的生效或陈旧条目，且不能指向自身。替代双方须同层。私有条目不能替代共享裁决。调用者无权访问的跨项目目标与未知 ID 返回完全相同的 `{ ok, code, error }`。
- 写请求顶层用 `supersedeExpectedRevisions: { [id]: revision }` 声明每个新增替代目标的预期修订。先核对目标权限，再核对修订。缺少目标修订或修订不匹配时返回 `conflict`，包括用被替代前的旧修订号再次指定有权维护的 `superseded` 目标。任一目标无效、未获授权或冲突时不提交，持久状态不变。成功时推进目标修订、标记为 `superseded`、在 `supersededBy` 记录新条目 ID，并使目标退出索引。
- Auditor 可用带原 ID 和预期修订的 `put` 恢复或修订本项目有权读取的 `stale` 经验，成功后恢复为 `active`。生效经验仍由原有写权限约束。Leader 只能维护本项目共享经验。
- 写核心串联绑定授权、格式及证据校验、脱敏、同层去重、CAS 与幂等检查。修订、变更序号、Markdown、索引和重放记录经一次 `commitState` 原子提交。
- 持久快照含 `entries, changes, seq, files` 及重放元数据。`files` 以路径为键，值为 Markdown 文本。允许空快照启动。`rebuildIndex()` 用生效条目重建持久索引。遗忘只保留最小标记，持久快照与旧回执重放均须去除旧正文。
- 有审结权的角色可遗忘对应候选，包括 `pending, returned, rejected, merged`。遗忘并入目标时一并遗忘源候选，删除 Markdown 正文、清理旧回执，并使源候选和目标的 `show` 均返回空。
- `evidence` 提供 `root, realpath(path), hasCommit(sha)`。可信观察与脱敏用 `getObservations(sessionId), classifySensitive(text), replacement`。未向 `createMemoryStore` 注入 `classifySensitive` 时，落正文的写操作（`put`、`propose`、`promote`、`merge`、`import_rulings`）返回 `{ ok: false, code: 'classifier-missing' }`，不提交且持久状态不变。授权失败使用独立的 `forbidden` 错误码。符合权限与修订要求的 `forget` 仍可删除内容。`readRaw(sessionId)` 提供待派生的历史。
- `merge` 将目标和候选已有的外部来源与审查者会话的 web/MCP 观察合并，经脱敏后存入结果的 `externalSource`。并入正文经脱敏后写入条目、Markdown 和回执，持久快照各处均须去除敏感原文。对已并入候选更换 `targetId` 或 `body` 的请求返回 `conflict`，不提交且持久状态不变。原样重放复用回执。仅更换 `requestId` 的重试也幂等成功，恰好提交一次以新增该请求的回执和指纹，其他持久状态保持不变。
- 来源候选为 `forgotten` 时，任何 `merge`（包括重放和改用其他目标）均返回 `ok: false`，不提交且持久状态不变，回应不含候选或目标的旧正文。无审结权的调用者仍返回 `forbidden`。
- 成功回执为 `{ ok: true, item, receipt, ... }`。`receipt` 含 `requestId, status`，状态为 `accepted | duplicate | candidate`。导入用 `items`，审结另带 `candidate`，遗忘的 `item` 为墓碑。
- 失败回执为 `{ ok: false, code, error, currentRevision? }`。`error` 为脱敏字符串，授权失败用 `forbidden`，CAS 失败用 `conflict`。审结幂等也按卡片与候选识别。
- 同一绑定范围的 `requestId` 命中回执时，须核对 `op`、候选或目标 `id`、`targetId` 及适用的条目或正文摘要。完全相同的请求复用原回执且不新增提交，遗忘后的回执仍遵循正文清除规则。若并入源候选已遗忘（包括遗忘目标导致的连带遗忘），原样重放 `merge` 仍失败，适用前述遗忘规则。内容有变则返回 `{ ok: false, code: 'conflict' }`，不返回旧回执，不提交且持久状态不变。遗忘或并入后改用同一 `requestId` 重放不同请求，冲突回应不得包含旧正文。
- 命中旧快照中缺少请求指纹的回执时，原样重放也保守返回 `conflict`。
- `format.mjs` 的 `validateEntry` 和 `sanitize.mjs` 的 `sanitizeEntry` 为可独立测试的纯函数。
- `cas-cache.mjs` 导出 `createCellMemory`。其 `show` 使用统一读取形状并可附 `cachedAt`。离线也通过 `getBinding()` 核对当前绑定，绑定失效或当前范围无授权缓存时返回 `{ item: null, seq: null }`。`write` 离线时只记录本地发件箱并返回候选回执，重连通过 home 的同一 `write` 校验。

## 裁决账本与历史迁移

自动机械同步只读取 `.project/rulings.md`。编号裁决和带「修正」「更正」「补充」的续行分别写入用户层，类型为 `ruling`。保留经脱敏的原话与日期，正文可超过普通记忆的 200 token 限制。同一账本条目使用稳定 ID，原地改写推进原条目的修订，重复同步或重启幂等。续行通过 `continuationOf` 关联原裁决，原裁决被整条取代时，续行一并退役并退出索引。

编号裁决中的每处「整条取代 Rn」都会建立 `supersedes` / `supersededBy` 链，使较早被取代的条目退出索引。一条裁决可以整条取代多个旧裁决。「取代 R24③」「取代 R21 中的……」等部分替代关系保留在原文中，相关旧裁决仍有效。

卡片结果、门禁结论、升级结论及换班交接保留在各自的历史和证据中。维护按历史事件 ID、来源及生成类别识别旧机械记录，标记其为 `stale`，以 `withdrawnBy` 和 `withdraw` 变更留痕。迁移可重复执行，保留合法裁决、人工条目和已审提案。高级角色明确写出的 `REMEMBER:` 仍属于显式记录。

## 回执保留

- 完整回执从首次成功提交起保留 30 天（每个 UTC 日按 24 小时计）。`createMemoryStore` 的 `receiptTtlMs` 可覆盖此期限，daemon 通过 `memoryOptions` 传入。重放不延长保留期，保留期内不按条数提前淘汰。
- daemon 的周期 `tick()` 调用 `store.maintain()`。到达期限后的首次维护从持久快照删除完整回执和响应，仅按绑定范围保留 `requestId` 与请求内容指纹，重启后仍可识别。维护保留条目、修订、变更序号及索引。
- 保留期内，同一绑定范围内相同 `requestId` 和内容复用原回执，内容变更返回 `conflict`。完整回执清理后，相同内容重放返回回执已过期的 `conflict`，内容变更返回 ID 已使用的 `conflict`。两种情况均不提交。

## `loom mem` JSON 接口

下表各命令均可附 `--project DIR --json`。`DIR` 选择要连接的项目，调用角色与权限取自可信会话绑定。传给 `--entry` 的值是单个 JSON 对象参数，字段遵循本契约的条目写入规则。修订参数使用十进制正整数，创建使用字面量 `null`。

| 命令及参数 | `--json` 成功输出 |
| --- | --- |
| `loom mem search <query>` | `{ ok: true, rows, nextCursor }`，`rows` 为无正文的索引行数组，`nextCursor` 为下一页游标或 `null`。 |
| `loom mem show <id>` | `{ ok: true, item, seq }`，`item` 为完整可见条目，`seq` 为可见变更序号。ID 未知或条目不可见时二者均为 `null`，包括 Worker 未获附的条目。 |
| `loom mem write --entry <json> --request-id <id> --expected-revision null` | `{ ok: true, item, receipt }`，`item` 为写入结果。 |
| `loom mem update <id> --entry <json> --request-id <id> --expected-revision <revision>` | `{ ok: true, item, receipt }`，`item` 为修订后的条目。 |
| `loom mem invalidate <id> --request-id <id> --expected-revision <revision>` | `{ ok: true, item, receipt }`，`item` 为无旧正文的墓碑。 |
| `loom mem proposals list` | `{ ok: true, proposals }`，列出当前角色可审核的待决提案，含完整 `id`、`shortId`、作用域和提案内容。 |
| `loom mem proposals approve <id>` | `{ ok: true, id, status: 'approved' }`，将提案应用到记忆库。 |
| `loom mem proposals reject <id> [--reason TEXT]` | `{ ok: true, id, status: 'rejected' }`，记录驳回及可选的脱敏原因。 |

`receipt` 为 `{ requestId, status }`，其状态取值见写入约定。成功在 stdout 输出单个 JSON 对象并退出 0。失败也在 stdout 输出单个 JSON 对象 `{ ok: false, error: { code, message } }` 并以非零状态退出，`message` 经过脱敏。Worker 搜索或写入，以及 Auditor 修改已知 ID 的外项目条目，均返回 `forbidden`。

`show`、`update`、`invalidate` 接受完整 ID，或 `memory-<uuid>` 与 `memory-event-<hash>` 中 UUID 或哈希开头的八位十六进制字符，大小写均可。短 ID 仅在调用者当前可见的条目中解析，之后执行相应的写权限与修订校验。多个可见命中返回 `ambiguous`，零命中返回 `not-found`，包括只有不可见条目命中的情况。完整 ID 的既有行为保持不变。

提案命令允许 Auditor 查看和决定项目级提案，Super 查看和决定项目级及用户级提案。Leader 与 Worker 无提案审核访问权。提案决定接受完整 ID，或可审核作用域内唯一的八字符前缀。完整 ID 优先匹配，前缀冲突返回 `ambiguous`。提案一经批准或驳回，任何再次决定均返回 `conflict`，审批指标不变。

## 整理提案的 daemon 接口

请求通过项目 daemon 的协议 1 发送 `{ protocol: 1, command, args, caller }`。在进程内测试中调用 `supervisor.handle(command, args, caller)`。调用者必须是该项目当前托管会话的地址或 pane。角色和项目取自会话绑定。下表为进程内返回值，RPC 成功时另附 `ok: true`。

当前 daemon RPC 仅信任同一系统用户下请求方自报的调用者身份。此角色校验不构成安全边界。基于会话凭证的强鉴权由 `main` 实现，合入 `main` 前必须解决。

| `command` | `args` | 返回值与权限 |
| --- | --- | --- |
| `memory-proposals` | `{ decision: 'list' \| 'approve' \| 'reject', id?, reason? }` | 对应上述 `loom mem proposals` 规则。 |
| `memory-review` | `{ id: string, decision: 'approve' \| 'reject' }` | `{ id, status: 'approved' \| 'rejected' }`。Auditor 审批项目提案，Super 审批用户提案。 |
| `memory-index` | `{ scope: 'user' }` | `{ rows }`。Super 可读取生效的用户偏好和裁决索引。每行有 `id, revision, line, usage`。 |
| `memory-show` | `{ id: string }` | `{ item, seq }`。Super 可按记忆 ID 读用户条目。未知或非用户条目返回 `{ item: null, seq: null }`。 |

任何重复决定或目标版本已变化均返回 `conflict`。未知提案和无审批权限均返回 `forbidden`。参数错误返回 `invalid-arguments`。进程内抛出的异常含 `code`，RPC 失败返回 `{ ok: false, error: { code, message } }`。

整理员输出 `{ proposals: [...] }`。每条提案含唯一小写 slug `id`、`action: 'add' | 'merge' | 'invalidate' | 'correct'`、`scope: 'project' | 'user'` 和 `source: { kind: 'delivery' | 'event', id }`。来源须对应本次整理输入里实际提供的投递或项目事件。新增提供 `title, body`。合并提供保留的 `target`、退出索引的 `targets` 及合并后的 `body`。作废只提供非空 `targets`。更正提供 `target, body`，用户更正可在有明确用户原话时省略 `target`，以生成待审的偏好条目。合并和更正可附新标题。阶段只接受合并、作废和更正，一批内退出索引的条目合计最多占所在范围生效条目的五分之一。

经代码验证的提案先进入持久待审队列。项目提案随下一门禁包交 Auditor，用户提案单独投递给 Super。批准应用变更，驳回记下决定。作废保留审计依据并撤出索引。

项目策略 `memory.extractor` 接受 `format: 'openai' | 'anthropic'`、`baseURL`、`model` 和 `keyRef: 'loom-memory-extractor-deepseek'`，钥匙串账户固定为 `loom`。脱敏始终开启。可在 `limits` 覆盖 `maxInputBytes`、`dailyCalls`、`dailyTokens`，默认分别为 16,384、40 和 100,000。回合和阶段共用 UTC 日预算。调用前持久预留预算，成功后按报告用量结算，缺少用量时保留预留。状态与成本报告显示停因，成本分别记录回合和阶段的调用量和已报告 token。

每次调用按请求 JSON 的 UTF-8 字节数（每字节估算一个 token）加 32 个协议开销 token，再加当日观测到的最大输入低估差额，估算输入额度。发送前原子预留估算输入与 `max_tokens`，在途请求计入同一日预算。余额不足时收紧 `max_tokens`，无法预留至少一个输出 token 时跳过。响应报告用量后，按实际输入与输出之和调整预留差额，缺少用量则保留预留。上限依赖本地估算，厂商实际分词可能多于本地估算。

回合与阶段整理的外发输入排除已存的用户层条目。阶段整理只提供项目记忆，Worker 历史以任务、轮次、工具及测试计数概括，批次和自动回执正文继续使用占位。

逐轮和阶段整理均按 `user`、`feedback`、`project`、`reference` 四类找可跨会话复用的观察，使用 `Why` 说明依据，使用 `How to apply` 说明适用情形及行动。没有值得记录的内容时返回空提案数组。观察取舍和空结果约定参考 claude-mem v17（Apache-2.0）。

提案入队前统一过滤标题或正文中只描述提交历史、代码位置、仓库已有文档和当前命令或任务进度的表述。完整的 `Why` 和 `How to apply` 保留有应用场景的结论，路径和提交号可以作为依据。过滤在证据、权限和审批规则之外额外执行，作废提案仍按其目标验证。

阶段整理的库上下文 `existing` 使用独立字节预算。按请求 JSON 中转义后的 UTF-8 字节计，预算为 `maxInputBytes` 的一半（向下取整），并按每批首条轮次或事件加入后的剩余字节和当日剩余 token 进一步压缩，预留至少一个输出 token。先处理项目条目，再处理共享引用，各组按条目 `id` 的字典序排列。依序保留完整条目，首个放不下的条目及后续条目只保留 `id` 和可外发的标题，摘要仍放不下时省略该条及其后的条目，必要时保留空库上下文。

阶段窗口超出 `maxInputBytes` 或当日剩余 token 预算时，从最早未处理的轮次起按时间顺序分批，每批的序列化请求都须符合字节限制，且余额须足以预留输入和至少一个输出 token。每批成功后立即持久记录进度，即使没有提案也推进游标。请求失败、凭据不可用或当日预算耗尽时，在下一次符合条件的边界继续处理未完成的部分，成功的批次不再外发。只有单轮或单条项目事件在空库上下文下仍超出字节上限，或按基础估算连整日 token 额度也放不下时，才告警并推进游标跳过该项。库上下文大小本身永远不会触发告警、跳过条目或推进游标。

`memoryPilot` 报告主角色每轮额外请求数、换班后首个已完成回合的 token 样本和平均值、事实遗漏数、提案通过率及 `indexSubstantiveRatio`。通过率的分母是已批准加已驳回，报告同时列出两项计数。可读行比例以本项目共享条目及用户指导中的生效条目为样本，在预算截断前计算具有可用短 ID、标题和正文钩子的条目占比，范围为 `0..1`。可在 `memory.pilot.handoverFileBaseline` 提供交接文件试点的首轮平均 token 作为比较基线。基线和无样本的指标使用 `null`。

## 授权和读取

- `access.mjs` 导出 `createAccess({ readState, history, now, ...options })`，集中执行授权过滤。`readState()` 提供最新条目和变更，也可传静态 `entries, changes`。
- `store.access` 是接入持久快照的读取实例。授权在排名、计数、截断、摘录及报错前执行。
- `createIndexQuery({ access, countTokens })`（`index-query.mjs`）复用该实例提供启动索引和搜索。`createDeltaDelivery({ access, binding, prefix, initialCursor, send, ... })`（`delta.mjs`）复用它过滤增量与重试，可用 `() => binding` 读取最新绑定。
- `search(binding, { query, limit?, cursor? })` 返回 `{ rows, nextCursor }`。`index(binding)` 返回 `{ rows }`，启动索引另附 `indexText, text`。索引行含 `id, revision, line, usage`。搜索匹配标题和关键词，账本同步条目也匹配正文。
- 启动索引采用 `MEMORY.md` 风格，每行 `- [标题](8位短ID) — 一句话钩子`，标题最多 60 个 Unicode 字符，整行最多 150 个 Unicode 字符。钩子接续标题之后的正文或给出不同的提示。裁决先于其他条目，重要性降序，同等重要性的裁决按日期从新到旧，日期相同时较高裁决编号优先。无日期的编号裁决沿用更早的账本日期。完整索引含提示文字最多 200 行及 25,000 UTF-8 字节。无短 ID 的旧式条目使用完整 ID。
- `show(binding, id, options?)` 返回 `{ item, seq }`，完整 ID 未知或不可见时均为 `{ item: null, seq: null }`。短 ID 的解析错误与 CLI 一致。
- Super 维护用户层的 `preference` 和 `ruling`。Auditor 与 Leader 可通过 `index`、`search` 和 `show` 读取这两类条目，并通过 `delta` 接收新增与撤回。用户层的 `lesson`、Super 的私人笔记和跨项目材料对二者不可见。Auditor 与 Leader 对用户层条目的创建、修改、遗忘和替代均返回 `forbidden`。Worker 不可读用户层。Reviewer 仅读复核卡显式授权条目。
- `delta(binding, { cursor })` 返回 `{ rows, baseCursor, endCursor, truncated }`，每行有 `seq, id, revision, operation`。变更可用 `entry` 供内部授权，公开行提供安全元数据和使用已脱敏标题生成的索引行 `line`。投递的 `suffix` 使用同形结果，另附 `text`。
- 单条撤回以可见标题、八位短 ID 和一句原因显示。已遗忘的条目省略标题，无权读取的撤回在计数及渲染前过滤。同批撤回合并为一行，列出总数和一个可见示例，在行数预算中只占一行。确认投递后一次推进该批全部撤回的游标，批次内的新增和修订仍按序投递。
- 重试可复用已投递的批次，包括条目后来变成 `stale` 的情况。当前授权撤销、过期或条目被遗忘时，不再复用含该条目原索引行的批次。
- `attachments(binding, { keywords, project? })` 与 `hist(binding, { id?, project?, sessionId? })` 均返回 `{ rows }`。自动附件只选关键词匹配的生效共享条目。Worker 跨项目共享条目的读取要求接收卡片的 `dependencies` 声明来源项目、`attachments` 包含条目 ID，并具有有效共享授权。
- Super 用 `grant(binding, { sourceProject, targetProject?, recipient, reason, expiresAt })` 授予只读访问。省略 `targetProject` 时使用会话项目。接收项目为空或与来源相同时拒绝。`revoke` 撤销授权，跨项目结果带 `sourceProject, asOf`。授权与撤销随项目状态持久化。从同一快照重启后，有效授权继续适用于 `index`、`search`、`show`、`attachments`、`delta`、`hist`，已撤销或到期的授权立即失效。`canWrite` 检查常规维护权限，`canRevise` 同时检查陈旧经验修订权限。
- `store.recordTurn(event), store.maintain()` 更新引用使用与陈旧状态。派生历史经 `hist` 统一授权并用同一脱敏规则展示。`store.access.hist` 和 `createAccess({ history }).hist` 缺少 `classifySensitive` 时均返回 `{ ok: false, code: 'classifier-missing', rows: [] }`。该规则适用于按 `id`、`project`、`sessionId` 单独或组合过滤和不带过滤参数的读取。

## 其他模块导出

- `identity.mjs` 导出 `identifyProject, createIdentityStore`。身份绑定表以 `project` 标识记录归属。`bindSession` 返回统一绑定，`reconcile(identity, { decision, binding })` 和 `readProject(project, binding)` 使用该形状。
- `shipper.mjs` 导出 `createCellShipper, createHomeShipper, createOpenCodeAdapter, createHistoryPublisher, createHistoryStore`。原始来源身份为 `{ sessionId, fileId, generation }`，ACK 另含 `contiguousEnd`。
- `launch-config.mjs` 导出 `buildTuiLaunch, buildOarLaunch, buildResumeLaunch, buildSwitchLaunch`，通过 `binding` 接收会话信息。agy 的 `coverage` 为 `'not covered'`（未覆盖），OpenCode 为 `'not needed'`（无需关闭）。
- `prompts.mjs` 导出 `renderMemoryPrompt, handleMemoryEvent`，从输入的 `binding` 取角色，显式写入委托给注入的 `write(binding, request)`。固定提示引导按需使用 `show <id>`，并在使用记忆的根轮引用 `[memory:<id>]`。
