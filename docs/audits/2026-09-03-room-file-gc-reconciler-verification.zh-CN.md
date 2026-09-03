# Room 文件 GC 长期运行 Reconciler 验证审计

日期：2026-09-03

范围：schema 42；普通 Room 永久删除提交后的本地附件字节回收、长期重试、崩溃恢复、操作回执压缩与大 backlog 查询性能。

## 1. 最终裁决

本批已完成，可以宣称 RAH OS 在“单机、单 daemon、SQLite、本地 blob”边界内具备长期运行的 Room 附件 GC 闭环。失败的物理删除不再只依赖重启或用户重放删除请求；daemon 每 60 秒执行一次有界 sweep，Kernel 用 durable receipt、lease token、指数退避和 tombstone 重删确保可续收且不误删仍有 canonical 引用的文件。

不需要 PostgreSQL。Multica 的 PostgreSQL `SKIP LOCKED` 是为多 Server 并发 worker 准备的；RAH OS 的本地单 owner 用 SQLite `BEGIN IMMEDIATE` 完成原子单条 claim，再用 lease-token fenced settle 阻止过期 worker 覆盖新 owner，不引入一套与产品形态不相称的分布式数据库。

## 2. 来源与复用级别

| 来源    | 冻结证据                                                                                                                                              | 采用内容                                                                                                                                 | 裁决                                                             |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| Raft    | `@botiverse/raft-computer@0.0.70`，SHA-256 `51d03a453266d756cbc29e94a847e88231a1dc0ee8a14c8863fa27ade8d9afcf`                                         | 启动时回收 stale pidfile/orphan process/power-loss partial state/tmp/stale lock，失败保留诊断并下次重试，`doctor --cleanup` 人工恢复思路 | Raft 未公开中央 Server 的 Room attachment GC，不声称复制未知后端 |
| Multica | revision `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `channel_media_reconciler.go`、`channel.sql`、`source_context_sweeper.go`、`source_context.go` | 独立 worker、单条 claim、2 分钟 lease、每轮 50 次尝试、1 分钟到 1 小时指数退避、`[15m, 1h, 6h, 24h]` tombstone、删除前重验引用           | `A` 级结构性移植                                                 |
| RAH OS  | `RoomFileGcService`、`RoomFiles`、`RoomFileGcReconciler`                                                                                              | Kernel clock/SQLite 毫秒时间、owner-private UUID blob、daemon 组装和 health 错误投影                                                     | 最小 local-first glue                                            |

未采用 jitter：Multica 的 channel-media 路径本身也是 capped exponential backoff，本地单 daemon 不存在惊群。未设置最大重试次数：删除意图不能因临时权限或文件占用而被永久忘记；长期失败由 receipt 和 daemon health 暴露。

## 3. 单一 owner 与数据流

```text
RoomDeletionService SQLite transaction
  -> 删除 canonical Room 引用图
  -> room_deletion_receipts + room_file_gc_receipts(pending)
  -> COMMIT
  -> RoomFiles 有界立即回收

RoomKernel startup / daemon 60s cadence
  -> RoomFiles.reconcileRoomDeletionGc(limit=50)
  -> RoomFileGcService claim/reference-check/backoff/tombstone/settle
  -> RoomFiles exact UUID blob + .part unlink
```

- `RoomDeletionService` 只冻结删除意图和显式引用图，不在 SQL 提交前删字节；
- `RoomFileGcService` 是 durable 状态机、schema 40 状态升级和 schema 41→42 索引迁移的唯一 owner；
- `RoomFiles` 是路径验证、symlink fail-closed 和精确字节删除的唯一 owner；
- `RoomFileGcReconciler` 只调度，不解释 receipt，不把 Provider/runtime 日志当业务真相；
- Web 只发起人类确认的 Room 删除，不轮询、认领或删除 blob。

## 4. 状态机和不变量

1. `pending/failed` 或已过期的 `deleting/tombstoned` 才能被 claim；未到 `next_attempt_at_ms` 不工作。
2. claim 是单条 `BEGIN IMMEDIATE` 事务，带随机 `lease_token` 和 2 分钟租约。
3. 每次 unlink 前再查 `room_files.attachment_id`；仍有 canonical 引用时保留字节、记录错误并退避。
4. 失败退避为 `min(1m * 2^(attempt-1), 1h)`；每轮最多计 50 次“尝试”，不是 50 次成功。
5. 首次 unlink 后进入 `tombstoned`，在 15 分钟、1 小时、6 小时、24 小时再删，回收延迟出现的 `.part`。
6. settle 必须命中同一 lease token；过期 worker 更新零行，不能覆盖新 owner。
7. 最后一次 tombstone 成功后，同一事务中删除 per-file 操作行并累加父回执 `gc_reclaimed_count`；同请求重放仍返回完整汇总。
8. `pending + reclaimed + failed = total` 始终成立；Room 业务删除不因 blob GC 失败而回滚或“复活”。

## 5. 失败注入和自动化证据

定向新增/增强用例 `16/16` 通过，覆盖：

- 文件系统失败不绕过 backoff，时钟到期后恢复；
- claim 后崩溃留下的 lease 到期前不被抢，到期后续收；
- 首删后才出现的 `.part` 在 tombstone pass 被删除；
- 51 条失败工作首轮仅尝试 50 条；
- 12 次失败的退避精确到 1 小时封顶；
- schema 40 的 legacy `pending/failed/reclaimed` 迁移到 42，压缩 reclaimed 行且外键检查为空；
- schema 41 的旧 due 索引原子替换为全局、单删除和失败 partial index；两条 claim 的
  `EXPLAIN QUERY PLAN` 不得 table scan 或使用 temporary B-tree；
- 完整 `[15m, 1h, 6h, 24h]` 时序后热表行消失，父回执仍支持幂等重放；
- canonical 文件引用误入 GC 时 fail closed；
- daemon 一次 isolated failure 后继续下一轮，`AbortSignal` 后停止。

全量门禁结果：

- TypeScript 类型检查通过；
- package tests `826` 项：`824 pass / 2` 个真实 Provider opt-in `skip`；
- Web unit `229/229`；真实回调审计 `34/34`；
- `npm run format:check`、`git diff --check`、`npm audit --omit=dev` 通过，production vulnerability `0`；
- Workbench production build 通过，仅有 Vite 大 chunk 已知警告，无 build 失败。

全库过程中一次捕获到无关 memory 并发测试“同 revision 只一个胜者”的临时目录权限抖动；该项紧接两次隔离重跑通过，最终全库日志为上述零失败结果。它不涉及 Room GC 代码，但本报告保留该非确定性证据，不把首轮失败隐去。

## 6. 真实浏览器与正式数据验收

- Chrome 产品门禁通过，覆盖 desktop 和 `390×844`，最终输出 `RAH_REAL_BROWSER_GATE`；
- Firefox `150.0.2` 门禁通过 desktop、`390×844` 和持久隔离 Workbench，输出 `RAH_FIREFOX_WORKBENCH_GATE`；
- 真删除只在隔离 state/workspace/browser profile 中执行；正式用户 Room 只打开二次确认并用 Escape 取消，然后关闭设置；
- 正式页面刷新后 `Agent Council` 和原有 1–10 报数历史正常，页面无 `JSON.parse` 或 `NetworkError`，1280px 无横向溢出；
- 二次确认精确显示“「 Agent Council 」及其中的所有消息都会被永久删除，且无法撤销。”，Escape 后焦点返回“删除频道”；
- 正式 Room 数据库已从 schema 40 迁移为 41，`PRAGMA quick_check=ok`、`foreign_key_check=0`，新的 lease/backoff/tombstone 列和索引存在；
- 跨过至少一个 60 秒调度周期后，服务仍在线，GC backlog 为空，正式已提交 Task
  `task_4253d826-9ffd-45f7-970b-d5619636231b` 的 identity/state/title 前后不变，日志无 Room GC failure。

## 7. 正式备份、重启和可恢复性

停止前只读审计结果：28 条 Activation 全部 completed，28 条 Placement 全部 released，28 条 Run 全部 exited，28 个 RuntimeProcess 全部 terminated；InputRequest、MCP、未决 cancellation/reassignment/SOS 均为零。已对精确旧实例发送 `SIGTERM`，确认监听退出后才备份。

本批的完整停机备份：`/Users/sun/.rah/backups/pre-p15-room-file-gc-20260903-myjmPC`，约 1.6 GiB；`room.db`、`runtime-registry.db`、`web-push.db` 均 `PRAGMA quick_check=ok`。

当前仅保留三份已验证备份：

1. `pre-p14-room-delete-20260903-EqxXXo`；
2. `pre-p15-room-file-gc-20260903-myjmPC`；
3. `pre-sidebar-attention-20260903-YGomNi`。

为保持三份上限，`pre-rich-reference-final-20260902-3RfArz` 和 `pre-p67-computer-profile-20260903-ktjnMv` 已精确移到 macOS 废纸篓，仍可人工恢复，未使用不可恢复删除。

schema 42 的最终正式重启、空闲资源采样和新浏览器页证据记录于
[性能与剩余缺口审计](./2026-09-03-room-file-gc-performance-and-remaining-gaps.zh-CN.md)。

## 8. 剩余边界和长期运行风险

1. **多进程/远程存储不在本批。** 如果未来多个 daemon 共写同一数据库，或 blob 进入 S3/跨 Computer，必须重新评估分布式 claim、远程 delete timeout 和凭证边界；不能直接外推本结论。
2. **父删除回执按 Room 删除次数增长。** 这是幂等和最小审计语义的有意代价；per-file 热行在 tombstone 完成后已压缩，不随历史附件总数无界增长。
3. **持续权限错误会持续重试。** 一小时退避封顶防止紧循环，receipt/health 保留诊断；如果未来增加操作员手动恢复 UI，必须委派同一 Kernel owner，不得让页面直接改 receipt。
4. **不是 Room 恢复功能。** 删除提交后 canonical Room 仍不可恢复；GC 的 tombstone 是物理重删观察期，不是用户可撤销的软删除。
5. **Workspace/Principal 永久删除仍需另立合同。** 本批只闭合普通 Channel 及其本地附件。

## 9. 结论

schema 41 已把 P1.4 从“事务删除 + 启动/重放续收”提升为“事务删除 + 长期 durable reconciler”；schema 42 进一步关闭极端 due backlog 的同步查询阻塞。在 RAH OS 当前本地单 daemon 架构下，不引入 PostgreSQL 是经过上游代码对照和并发所有权审计后的明确结论，不是暂时省略。

可宣称本批 `C/A/L/D` 完成：`C` 为 Raft/Multica 来源合同，`A` 为结构性移植审计，`L` 为本地实现，`D` 为隔离真删除、双浏览器、正式迁移和重启证据。`R` 仅能覆盖可见的 Raft 产品合同，不能冒充不可见的 Raft Server Room attachment GC 后端同构。
