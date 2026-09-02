# Room 永久删除、文件 GC 与崩溃恢复验证审计

日期：2026-09-03

范围：RAH OS P1.4；普通 Channel 永久删除；协议、Kernel、Client API、Web、文件字节回收和启动恢复。正式持久 Workspace 不执行破坏性删除。

## 1. 最终裁决

P1.4 的核心闭环成立：只有具备管理权限的 Human 能在最新 Room cursor 上永久删除无活动工作的普通 Channel；完整 canonical 图在一笔 SQLite 事务中消失；提交后的文件字节由 durable GC receipt 回收并可在进程重启后续收；Web 使用 Raft 的二次确认、红色危险语义、逐字中文文案、等待态、错误停留和成功导航合同。

本结论不等于复制了 Raft Server。Raft 可证明的是发布 Web 的行为合同；后端采用 Multica 的显式删除图/事务/外部副作用恢复模式，再映射为 RAH OS 本地 SQLite 与本地 blob owner。

## 2. 上游证据与采用级别

| 来源    | 只读证据                                                                                                                                | 采用内容                                                                                                                      | 级别                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Raft    | `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a` | 普通 Channel 红色删除入口、二次确认、精确文案、`删除中…`、失败保留确认、成功关闭并导航；官方客户端调用 `DELETE /channels/:id` | `R` 行为合同         |
| Multica | `/Users/sun/Code/repos/multica/server/internal/handler/workspace.go`、`server/pkg/db/queries/workspace_delete.sql`                      | Application owner 显式 bottom-up 图、事务内清理、写入围栏/复核、外部清理意图和 fail-closed 结果                               | `A` 结构模式         |
| RAH OS  | 本报告列出的 protocol/Kernel/transport/Web owner                                                                                        | actor-free command、本地事务、Room 外回执、本地 UUID blob GC、启动恢复                                                        | `L` local-first glue |

Raft 的 HTTP method 没有机械复制到 RAH Client API：RAH 的 versioned Client mutation surface 统一使用认证 `POST /v3/client/rooms/delete`，内部 command 仍为严格 typed `room.delete`。这是 transport 外壳差异，不改变删除语义，也不引入中央 Server 依赖。

## 3. 前后端所有权审计

| 层              | 单一 owner                                                         | 审计结果                                                                                                                         |
| --------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Protocol        | `ClientRoomDeleteRequestSchema` / `ClientRoomDeleteResponseSchema` | 请求只有 `roomId + basedOnRoomSeq + idempotencyKey`；actor 无法由客户端注入；GC 汇总强制 `pending + reclaimed + failed = total`  |
| Kernel 生命周期 | `RoomDeletionService` + 共享 `assertNoActiveRoomWork`              | Human、owner/admin、普通 Channel、freshness、活动 Task/Input/Activation/Placement/Run/Runtime/MCP/取消/改派/SOS 全部 fail closed |
| 引用图          | `RoomDeletionService.#eraseCanonicalGraph`                         | 动态 `PRAGMA foreign_key_list` 计算出 52 张可达表；固定棘轮与 schema 完全相等；事务末 `PRAGMA foreign_key_check` 必须为空        |
| 幂等审计        | `room_deletion_receipts`                                           | 回执不引用被删 Room；相同 actor/key/Room/seq 重放同一结果；相同 key 改目标或 cursor 冲突                                         |
| 文件字节        | `RoomFiles`                                                        | 事务内只写 per-blob receipt；提交后只删除 owner-private 非 symlink 根下的 exact UUID 与 `.part`；`ENOENT` 是幂等成功             |
| 崩溃恢复        | `RoomFiles.initialize`                                             | `pending/failed` 在 Kernel 启动时由文件 owner 自行重试；字节已删但状态未写时可再次回收并标记 `reclaimed`                         |
| HTTP/SDK        | `HumanApplicationPort`、application service、RahClient             | 只鉴权、schema 校验和委派，不复制删除图；实际 route 及重复请求已覆盖                                                             |
| Web             | `WorkspaceScreen.deleteCurrentRoom`、`RoomMembersDialog`           | manager + caught-up + channel 解锁；二级 ConfirmDialog；pending 禁止重复；成功移除投影并确定性导航下一 Room                      |

## 4. 故障与不可复活证据

### 4.1 SQL commit 前

测试向 `messages` 安装一次性 `RAISE(ABORT)` 触发器，在显式图清理中途制造错误。结果：Room、Message、`room_files`、删除回执全部回滚；磁盘 blob 保持；没有伪成功响应。这证明文件删除不会跑到数据库提交之前。

### 4.2 SQL commit 后

测试把 blob root 临时替换为 symlink，使数据库提交成功而字节回收 fail closed。结果：产品面 Room 已消失，GC 回执为 `failed`，原字节仍在安全持有目录；恢复非 symlink 根并重新打开 Kernel 后，启动 reaper 把 exact blob 删除，尝试次数从 1 变 2，状态变为 `reclaimed`，错误清空。

### 4.3 用户数据面

删除后的验证同时覆盖：Room list 不含目标、Saved 为空、FTS Search 无命中、Activity 不含目标、Message context 与 typed navigation 均拒绝目标、文件字节不可见。另一个 Room 以目标 Room 作为投递位置的 durable Reminder 及 event 被清除，但来源 Room 和 anchor Message 保留。同一请求重放返回原 deletion identity，不会形成第二次业务删除。

## 5. 浏览器证据

- Chrome：`npm run test:web:browser` 通过；真实 Chromium 执行完整产品回归以及隔离 Room 成员/生命周期 fixture，覆盖 desktop 和 `390×844`，最终输出 `RAH_REAL_BROWSER_GATE`，移动端 `scrollWidth=390`。
- Firefox：`npm run test:web:firefox` 通过；Firefox `150.0.2` 在隔离、持久但临时的本地 Workbench 中创建 `Second Council`，桌面打开删除确认并用 Escape 关闭、核验焦点返回；切换到 `390×844` 后实际点击“永久删除”，确认弹层无横向溢出，随后自动导航到 `Agent Council`，Client API 的 Room list 不再包含目标。
- 正式状态：只允许打开确认并取消；任何真实用户 Room 均未作为破坏性样本。

## 6. 审计发现与剩余边界

1. **Raft Server 实现不可见。** 本报告只宣称 Raft 可见行为一致；事务与 GC 是经过测试的本地实现，不冒充上游源码。
2. **回执有意保留最小审计元数据。** 删除回执保留原 Room ID/name/slug、actor、Workspace、时间和文件数量，但不保留消息正文、Thread、Task 或文件内容；这是幂等/运维审计需要，不是产品恢复入口。
3. **GC 不是业务提交条件。** 成功可以携带 `failed/pending` 汇总；这时 Room 仍不可恢复，字节由启动恢复或相同请求重放继续清理。若未来要求长期运行实例的定时重试，应由 RoomFiles maintenance owner 增加有界 cadence，不能由页面轮询删除磁盘。
4. **Workspace/Principal 删除需另立合同。** 当前 deletion receipt 仍引用 actor 与 Workspace；未来若增加这两类永久删除，必须显式决定回执保留/导出/匿名化，不能临时级联。
5. **没有选择性撤销。** 仅支持操作员停机后恢复整套经过一致性检查的 state backup；不提供单 Room 恢复或 UI 撤销。
6. **Direct/control 仍禁止永久删除。** 这是显式 kind invariant，不是遗漏。

## 7. 门禁记录

- 定向 protocol/kernel/SDK/application：`16/16` 通过；
- P1.4 Kernel 故障、GC、跨 Room Reminder、不可复活、FK ratchet：`6/6` 通过；
- Core facade 与 schema 棘轮：`98/98` 定向通过；
- `npm run check`：全库通过；中途捕获并修正一条已过期的异步 Agent 导航回归夹具，最终 `34/34` parity regression 通过；
- `npm run format:check`、`git diff --check`、`npm audit --omit=dev`：通过，production dependency vulnerability 为 `0`；
- Workbench production build：通过；
- Chrome：`npm run test:web:browser` 单独重跑通过，输出 `RAH_REAL_BROWSER_GATE`，最终 viewport `390×844`；并行运行 Chrome/Firefox 曾使 Chrome 的长门禁在文件菜单处超时，单独重跑排除产品回归；
- Firefox：`npm run test:web:firefox` 通过，输出 `RAH_FIREFOX_WORKBENCH_GATE`，覆盖 desktop、`390×844` 与隔离实际删除；
- 重启后的正式页面：Codex 内置真实浏览器打开 `http://127.0.0.1:4173`，核验“删除频道”入口、精确不可撤销文案、二级“永久删除”、Escape 关闭与焦点返回；最后关闭设置，未提交破坏性请求；
- 正式迁移前活跃工作审计：运行中 Activation、Placement、RunAttempt、RuntimeProcess、MCP、InputRequest、取消、改派和 SOS 均为 `0`；保留一个 durable `submitted` Task，重启前后 identity/state/title 不变；
- 正式 schema 39 停机备份：`/Users/sun/.rah/backups/pre-p14-room-delete-20260903-EqxXXo`，`room.db`、`runtime-registry.db`、`web-push.db` 均 `quick_check=ok`；
- 正式 schema 40 重启：PID `54876`，`http://127.0.0.1:4173/` 返回 `200`，`room.db quick_check=ok`，两张 receipt 表存在，待恢复 GC 为 `0`。

## 8. 备份收口记录

- 清理前 `/Users/sun/.rah/backups` 有 50 份目录、约 38 GiB；已精确移除 47 份旧备份，只保留三份近期、数据库可验证的完整快照。
- schema 40 部署前新增并验证 `pre-p14-room-delete-20260903-EqxXXo` 后，把被替换的 `pre-p66-computer-offline-20260902Tc5HJpC`（852 MiB）和散落的 `pre-discovery-ui-KIflm6`（1 MiB）移动到 macOS 废纸篓，仍可恢复。
- 当前正式备份集合固定为三份：`pre-p14-room-delete-20260903-EqxXXo`、`pre-p67-computer-profile-20260903-ktjnMv`、`pre-rich-reference-final-20260902-3RfArz`。

## 9. 结论

可以把 P1.4 标记为 `C/A/L/D` 完成。它满足“显式引用清理 + durable 文件 GC 回执 + SQL/进程崩溃恢复”的本地永久删除定义，并保留 Raft 的用户可见合同。不得把这一结论扩大为 Raft 全站后端等价、Workspace 永久删除、跨计算机文件 GC 或可选择恢复。
