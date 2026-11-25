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
- 写请求顶层用 `supersedeExpectedRevisions: { [id]: revision }` 声明每个新增替代目标的预期修订。先核对目标权限，再核对修订。缺少目标修订或修订不匹配时返回 `conflict`。任一目标无效、未获授权或冲突时不提交。成功时推进目标修订、标记为 `superseded`、在 `supersededBy` 记录新条目 ID，并使目标退出索引。
- Auditor 可用带原 ID 和预期修订的 `put` 恢复或修订本项目有权读取的 `stale` 经验，成功后恢复为 `active`。生效经验仍由原有写权限约束。Leader 只能维护本项目共享经验。
- 写核心串联绑定授权、格式及证据校验、脱敏、同层去重、CAS 与幂等检查。修订、变更序号、Markdown、索引和重放记录经一次 `commitState` 原子提交。
- 持久快照含 `entries, changes, seq, files` 及重放元数据。`files` 以路径为键，值为 Markdown 文本。允许空快照启动。`rebuildIndex()` 用生效条目重建持久索引。遗忘只保留最小标记，持久快照与旧回执重放均须去除旧正文。
- 有审结权的角色可遗忘对应候选，包括 `pending, returned, rejected, merged`。遗忘并入目标时一并遗忘源候选，删除 Markdown 正文、清理旧回执，并使源候选和目标的 `show` 均返回空。
- `evidence` 提供 `root, realpath(path), hasCommit(sha)`。可信观察与脱敏用 `getObservations(sessionId), classifySensitive(text), replacement`。未向 `createMemoryStore` 注入 `classifySensitive` 时，落正文的写操作（`put`、`propose`、`promote`、`merge`、`import_rulings`）返回 `ok: false`，不提交且持久状态不变。符合权限与修订要求的 `forget` 仍可删除内容。`readRaw(sessionId)` 提供待派生的历史。
- `merge` 将目标和候选已有的外部来源与审查者会话的 web/MCP 观察合并，经脱敏后存入结果的 `externalSource`。并入正文经脱敏后写入条目、Markdown 和回执，持久快照各处均须去除敏感原文。对已并入候选更换 `targetId` 或 `body` 的请求返回 `conflict`，不提交且持久状态不变。原样重放复用回执，仅更换 `requestId` 的重试也幂等成功且不新增提交。
- 来源候选为 `forgotten` 时，任何 `merge`（包括重放和改用其他目标）均返回 `ok: false`，不提交且持久状态不变，回应不含候选或目标的旧正文。无审结权的调用者仍返回 `forbidden`。
- 成功回执为 `{ ok: true, item, receipt, ... }`。`receipt` 含 `requestId, status`，状态为 `accepted | duplicate | candidate`。导入用 `items`，审结另带 `candidate`，遗忘的 `item` 为墓碑。
- 失败回执为 `{ ok: false, code, error, currentRevision? }`。`error` 为脱敏字符串，授权失败用 `forbidden`，CAS 失败用 `conflict`。同请求重放复用回执，审结幂等也按卡片与候选识别。
- `format.mjs` 的 `validateEntry` 和 `sanitize.mjs` 的 `sanitizeEntry` 为可独立测试的纯函数。
- `cas-cache.mjs` 导出 `createCellMemory`。其 `show` 使用统一读取形状并可附 `cachedAt`。离线也通过 `getBinding()` 核对当前绑定，绑定失效或当前范围无授权缓存时返回 `{ item: null, seq: null }`。`write` 离线时只记录本地发件箱并返回候选回执，重连通过 home 的同一 `write` 校验。

## 授权和读取

- `access.mjs` 导出 `createAccess({ readState, history, now, ...options })`，集中执行授权过滤。`readState()` 提供最新条目和变更，也可传静态 `entries, changes`。
- `store.access` 是接入持久快照的读取实例。授权在排名、计数、截断、摘录及报错前执行。
- `createIndexQuery({ access, countTokens })`（`index-query.mjs`）复用该实例提供启动索引和搜索。`createDeltaDelivery({ access, binding, prefix, initialCursor, send, ... })`（`delta.mjs`）复用它过滤增量与重试，可用 `() => binding` 读取最新绑定。
- `search(binding, { query, limit?, cursor? })` 返回 `{ rows, nextCursor }`。`index(binding)` 返回 `{ rows }`，启动索引另附 `indexText, text`。索引行含 `id, revision, line, usage`，搜索匹配标题和关键词。
- `show(binding, id, options?)` 返回 `{ item, seq }`，未知或不可见时均为 `{ item: null, seq: null }`。
- Super 维护用户层的 `preference` 和 `ruling`。Auditor 与 Leader 可通过 `index`、`search` 和 `show` 读取这两类条目，并通过 `delta` 接收新增与撤回。用户层的 `lesson`、Super 的私人笔记和跨项目材料对二者不可见。Auditor 与 Leader 对用户层条目的创建、修改、遗忘和替代均返回 `forbidden`。Worker 不可读用户层。Reviewer 仅读复核卡显式授权条目。
- `delta(binding, { cursor })` 返回 `{ rows, baseCursor, endCursor, truncated }`，每行有 `seq, id, revision, operation`。变更可用 `entry` 供内部授权，公开行提供安全元数据和使用已脱敏标题生成的索引行 `line`。投递的 `suffix` 使用同形结果，另附 `text`。
- 重试可复用已投递的批次，包括条目后来变成 `stale` 的情况。当前授权撤销、过期或条目被遗忘时，不再复用含该条目原索引行的批次。
- `attachments(binding, { keywords, project? })` 与 `hist(binding, { id?, project?, sessionId? })` 均返回 `{ rows }`。自动附件只选关键词匹配的生效共享条目。Worker 跨项目共享条目的读取要求接收卡片的 `dependencies` 声明来源项目、`attachments` 包含条目 ID，并具有有效共享授权。
- Super 用 `grant(binding, { sourceProject, targetProject?, recipient, reason, expiresAt })` 授予只读访问。省略 `targetProject` 时使用会话项目。接收项目为空或与来源相同时拒绝。`revoke` 撤销授权，跨项目结果带 `sourceProject, asOf`。`canWrite` 检查常规维护权限，`canRevise` 同时检查陈旧经验修订权限。
- `store.recordTurn(event), store.maintain()` 更新引用使用与陈旧状态。派生历史经 `hist` 统一授权并用同一脱敏规则展示。

## 其他模块导出

- `identity.mjs` 导出 `identifyProject, createIdentityStore`。身份绑定表以 `project` 标识记录归属。`bindSession` 返回统一绑定，`reconcile(identity, { decision, binding })` 和 `readProject(project, binding)` 使用该形状。
- `shipper.mjs` 导出 `createCellShipper, createHomeShipper, createOpenCodeAdapter, createHistoryPublisher, createHistoryStore`。原始来源身份为 `{ sessionId, fileId, generation }`，ACK 另含 `contiguousEnd`。
- `launch-config.mjs` 导出 `buildTuiLaunch, buildOarLaunch, buildResumeLaunch, buildSwitchLaunch`，通过 `binding` 接收会话信息。agy 的 `coverage` 为 `'not covered'`（未覆盖），OpenCode 为 `'not needed'`（无需关闭）。
- `prompts.mjs` 导出 `renderMemoryPrompt, handleMemoryEvent`，从输入的 `binding` 取角色，显式写入委托给注入的 `write(binding, request)`。固定提示引导按需使用 `show <id>`，并在使用记忆的根轮引用 `[memory:<id>]`。
