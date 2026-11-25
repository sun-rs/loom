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
- 写核心串联绑定授权、格式及证据校验、脱敏、同层去重、CAS 与幂等检查。修订、变更序号、Markdown、索引和重放记录经一次 `commitState` 原子提交。
- 持久快照含 `entries, changes, seq, files` 及重放元数据。`files` 以路径为键，值为 Markdown 文本。允许空快照启动。`rebuildIndex()` 用生效条目重建持久索引。遗忘只保留最小标记，持久快照与旧回执重放均须去除旧正文。
- `evidence` 提供 `root, realpath(path), hasCommit(sha)`。可信观察与脱敏用 `getObservations(sessionId), classifySensitive(text), replacement`。`readRaw(sessionId)` 提供待派生的历史。
- 成功回执为 `{ ok: true, item, receipt, ... }`。`receipt` 含 `requestId, status`，状态为 `accepted | duplicate | candidate`。导入用 `items`，审结另带 `candidate`，遗忘的 `item` 为墓碑。
- 失败回执为 `{ ok: false, code, error, currentRevision? }`。`error` 为脱敏字符串，授权失败用 `forbidden`，CAS 失败用 `conflict`。同请求重放复用回执，审结幂等也按卡片与候选识别。
- `format.mjs` 的 `validateEntry` 和 `sanitize.mjs` 的 `sanitizeEntry` 为可独立测试的纯函数。
- `cas-cache.mjs` 导出 `createCellMemory`。其 `show` 使用统一读取形状并可附 `cachedAt`，`write` 离线时只记录本地发件箱并返回候选回执，重连通过 home 的同一 `write` 校验。

## 授权和读取

- `access.mjs` 导出 `createAccess({ readState, history, now, ...options })`，集中执行授权过滤。`readState()` 提供最新条目和变更，也可传静态 `entries, changes`。
- `store.access` 是接入持久快照的读取实例。授权在排名、计数、截断、摘录及报错前执行。
- `createIndexQuery({ access, countTokens })`（`index-query.mjs`）复用该实例提供启动索引和搜索。`createDeltaDelivery({ access, binding, prefix, initialCursor, send, ... })`（`delta.mjs`）复用它过滤增量与重试，可用 `() => binding` 读取最新绑定。
- `search(binding, { query, limit?, cursor? })` 返回 `{ rows, nextCursor }`。`index(binding)` 返回 `{ rows }`，启动索引另附 `indexText, text`。索引行含 `id, revision, line, usage`，搜索匹配标题和关键词。
- `show(binding, id, options?)` 返回 `{ item, seq }`，未知或不可见时均为 `{ item: null, seq: null }`。
- `delta(binding, { cursor })` 返回 `{ rows, baseCursor, endCursor, truncated }`，每行有 `seq, id, revision, operation`。变更可用 `entry` 供内部授权，公开行仅提供安全元数据。投递的 `suffix` 使用同形结果，另附 `text`。
- `attachments(binding, { keywords, project? })` 与 `hist(binding, { id?, project?, sessionId? })` 均返回 `{ rows }`。自动附件只选关键词匹配的生效共享条目，再核对卡片与跨项目授权。
- `grant/revoke` 管理按接收方、来源项目和期限约束的只读授权。`canWrite` 检查维护权限。跨项目结果带 `sourceProject, asOf`。
- `store.recordTurn(event), store.maintain()` 更新引用使用与陈旧状态。派生历史经 `hist` 统一授权并用同一脱敏规则展示。

## 其他模块导出

- `identity.mjs` 导出 `identifyProject, createIdentityStore`。身份绑定表以 `project` 标识记录归属。`bindSession` 返回统一绑定，`reconcile(identity, { decision, binding })` 和 `readProject(project, binding)` 使用该形状。
- `shipper.mjs` 导出 `createCellShipper, createHomeShipper, createOpenCodeAdapter, createHistoryPublisher, createHistoryStore`。原始来源身份为 `{ sessionId, fileId, generation }`，ACK 另含 `contiguousEnd`。
- `launch-config.mjs` 导出 `buildTuiLaunch, buildOarLaunch, buildResumeLaunch, buildSwitchLaunch`，通过 `binding` 接收会话信息。
- `prompts.mjs` 导出 `renderMemoryPrompt, handleMemoryEvent`，从输入的 `binding` 取角色，显式写入委托给注入的 `write(binding, request)`。
