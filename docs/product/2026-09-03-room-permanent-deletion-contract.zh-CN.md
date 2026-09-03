# Room 永久删除、文件 GC 与崩溃恢复合同

状态：P1.4 实施基线（2026-09-03）

长期运行增量：本文件的提交边界保持不变；schema 41 已把启动/同请求续收扩展为独立周期
reconciler、lease/backoff/tombstone 和完成明细压缩；schema 42 用精确作用域 SQL 和三组
索引关闭大 backlog 查询放大，不改变删除语义。精确状态机见
[Room 文件 GC 长期运行 Reconciler 合同](./2026-09-03-room-file-gc-reconciler-contract.zh-CN.md)。

## 1. 产品事实与来源边界

### 1.1 Raft 可证明的前端合同

冻结证据：`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。

官方 bundle 可直接证明：

- 普通 Channel 设置页提供红色永久删除入口；control Room 与 Direct Room 不提供；
- 点击删除后仍需二次确认；
- 中文确认文案为 `「{name}」及其中的所有消息都会被永久删除，且无法撤销。`；
- 请求为 `DELETE /channels/${id}`，等待态显示 `删除中…`；
- 成功后关闭设置并导航到仍可访问的 Channel，若没有则回 Workspace/Server 设置；
- 失败时保持确认上下文并显示错误，不能投影为已删除。

这是本批 UI、交互和结果语义的 `R` 级来源。公开 Web bundle 不包含 Raft 中央
Server 的数据库事务、引用图和文件对象清理实现，因此不能据此声称复制了其后端源码。

### 1.2 Multica 可复用的可靠性模式

`server/internal/handler/workspace.go` 与
`server/pkg/db/queries/workspace_delete.sql` 提供成熟的 `A` 级实现经验：

- 删除关系图由 Application owner 显式持有，不把旧 FK cascade 当主实现；
- 先建立阻止新引用进入的写入围栏，再按固定的 bottom-up 图执行；
- 全部 canonical SQL 清理处于一个事务，任一步失败都整体回滚；
- 删除后对象存储/外部副作用通过可恢复意图或回执继续完成；
- 对可能遗漏的后写入进行提交前复核，发现不完整时 fail closed。

Multica 的实体和 PostgreSQL 锁协议与本机 SQLite Room Kernel 不同，所以只复用这一
事务/显式图/外部 GC 的结构，不复制其 Workspace 业务 SQL。

## 2. RAH OS 产品合同

### 2.1 允许与拒绝

仅允许已认证 Human 对 `kind=channel` 的普通 Room 执行永久删除，且调用者必须是
Room owner/admin。以下情况 fail closed：

- control Room、Direct Room；
- `basedOnRoomSeq` 不是提交时最新 Room 序号；
- Room 内存在非终态 Task、InputRequest、Activation、Placement、RunAttempt、
  RuntimeProcess、重试围栏、取消/改派/SOS 操作或其他仍在执行的工作；
- 请求身份、Room 或幂等内容不一致；
- 事务后的外键检查证明仍有 canonical 引用。

`room.delete` 请求只有 `roomId + basedOnRoomSeq + idempotencyKey`。actor 只来自认证
上下文，不能由客户端请求冒充。永久删除不创建一个随后又被删除的 `room.deleted`
Room event；审计真相是脱离 Room 外键、可长期保留的删除回执。

### 2.2 成功定义

成功响应意味着：

1. Room 及其 canonical 内容已在一个 `BEGIN IMMEDIATE` 事务中不可见；
2. list/search/activity/saved/navigation/sync 均不能重新发现该 Room；
3. 每个本地 blob 已在同一事务中形成 durable GC 回执；
4. 文件字节可能已经回收，也可能处于 `pending/failed` 等待启动恢复，但这不会让
   Room 重新出现；
5. 用相同 actor、Room 和 idempotency key 重放会返回同一删除回执，不会再次删除。

这里的“永久”指产品数据面没有撤销、软删除或隐藏恢复入口。运维恢复只允许停机后
整体恢复经过校验的 state backup，不能选择性复活单个 Room。

## 3. 当前引用图与显式清理边界

schema 40 的正式数据库有 32 条直接 `NO ACTION -> rooms` 外键，沿外键反向可达
52 张表。删除 owner 必须显式覆盖以下类别：

- 对话：`messages`、`threads`、两类 thread follow/undo、held drafts、reaction、
  saved message、activity frontier；
- Task：`tasks`、dependency、participant、submission、submission artifact、review、
  InputRequest、reassignment 与 cancellation；
- Delivery/runtime：Room event、Inbox、Activation、obligation、retry fence、Outbox、
  Placement/capacity/workspace lease、RunAttempt、ContextManifest、RuntimeProcess、
  trajectory、subscription cursor；
- Files/MCP/SOS/Reminder：`room_files`、managed MCP calls、SOS operation/target/hold、
  Reminder source/target 及 event/fire receipt；
- Room 边界：membership、direct pair，以及只可能由 control Room 拥有的 Agent/
  execution policy/managed MCP definition 图。

Message↔Thread、Task↔Message/Thread 和 Runtime 图存在环。事务在显式删除期间启用
SQLite deferred FK checking；每张表仍由固定、可审计的 `DELETE ... WHERE` 语句处理，
提交前 `PRAGMA foreign_key_check` 必须为空。defer 只解决顺序环，不替代显式清理。

新增 schema coverage 测试会从 `PRAGMA foreign_key_list` 动态计算所有可达 Room 表，
并要求它们被删除图分类。今后新增一张引用 Room 的表而未更新 eraser，测试必须失败。

## 4. durable 删除与文件 GC 状态机

### 4.1 删除回执

`room_deletion_receipts` 不持有 Room 外键，记录：删除操作 ID、actor、Workspace、原
Room ID/name/slug、请求基线、幂等键、删除时间、blob 总数，以及当前 GC 汇总。

`room_file_gc_receipts` 只引用删除回执，记录 server-generated attachment ID、状态、
尝试次数、最近错误和时间。schema 40 的 `pending/reclaimed/failed` 基线由 schema 41
兼容迁移为 `pending/deleting/tombstoned/reclaimed/failed`，并增加 next-attempt、lease 与
tombstone pass；schema 42 只升级索引/查询路径。完成观察期后 per-file 行压缩进父回执 `gc_reclaimed_count`。它不引用已
删除的 `room_files/messages/tasks/rooms`。

### 4.2 提交与恢复

```text
BEGIN IMMEDIATE
  -> 验权、freshness、active-work gate
  -> 收集本 Room blob ID
  -> 写 deletion + per-blob GC receipts
  -> 显式删除完整 canonical 引用图
  -> 删除 rooms
  -> foreign_key_check
COMMIT
  -> 有界认领到期 GC receipt，删除 exact blob 与 .part
  -> 成功进入 tombstone 重删；失败保留错误并指数退避
  -> 观察期完成后汇总进父回执并清除 per-file 热行
```

崩溃点语义：

- SQL commit 前崩溃：SQLite 整体回滚，Room 仍存在，不能留下成功回执；
- SQL commit 后、文件删除前崩溃：Room 已永久消失，GC receipt 保持 pending；
- 删除字节后、标记 reclaimed 前崩溃：重试收到 `ENOENT` 视作幂等成功；
- 某个文件失败：其他文件继续，失败项由周期 worker 在 backoff 到期后重试；启动和相同
  请求重放也只处理已经到期的条目，不能绕过退避。

RoomFiles 是本地 blob 唯一 owner。GC 只能处理 UUID 形 server-generated ID，根目录
必须是 owner-private、非 symlink directory；目标路径只允许该根目录的直接子项。任何
别名根、非预期 ID 或越界路径都 fail closed，绝不删除工作区/用户文件。

## 5. UI 与浏览器验收

- Room 设置页沿用 Raft 的红色操作按钮和第二个 ConfirmDialog；
- 删除中禁用关闭、重复确认和其他 mutation；Escape/取消返回设置且不发请求；
- 错误只在确认弹层中显示一次；成功关闭设置并确定性选择下一可访问 Room；
- 桌面与 390×844 使用同一组件和同一 command；Enter/焦点/Tab 顺序与现有共享弹层一致；
- 正式 Room 只验证“打开→二次确认→取消/Escape”，绝不执行删除；
- 真删除、文件回收、重启恢复只在隔离 `RAH_HOME`、端口和 fixture Room 中验证。

## 6. 发布门禁

- protocol/application-service/SDK/kernel/UI 全链测试；
- FK 动态覆盖、权限/kind/freshness/active-work、幂等冲突、事务故障注入；
- 有/无文件、SQL commit 后崩溃、字节删后崩溃、symlink root；
- list/search/activity/saved/typed navigation 不可复活；
- Chrome + Firefox，desktop + 390×844；
- 代码审计需逐项标明 `R/A/L` 来源，不能把 Raft 未公开后端标成源码移植。
