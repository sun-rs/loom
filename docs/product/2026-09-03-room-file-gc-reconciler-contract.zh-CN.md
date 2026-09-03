# Room 文件 GC 长期运行 Reconciler 合同

状态：已实施并验证（2026-09-03）

## 1. 目标与非目标

本批只收口普通 Room 永久删除提交后的本地 blob 回收。Room 是否已经永久删除仍只由
`RoomDeletionService` 的 canonical SQLite 事务决定；GC 失败不能复活 Room，页面轮询、
HTTP 请求和 Provider runtime 也不能成为磁盘回收 owner。

不引入 PostgreSQL、对象存储、跨 Computer 传输或第二套任务队列。RAH OS 是单机
local-first daemon，SQLite 的 `BEGIN IMMEDIATE` 足以提供本批单条 claim 所需的原子性。

## 2. 上游证据与采用方式

### 2.1 Raft：启动恢复与人工诊断基线

冻结包：`@botiverse/raft-computer@0.0.70`，归档 SHA-256
`51d03a453266d756cbc29e94a847e88231a1dc0ee8a14c8863fa27ade8d9afcf`。

发布包 `dist/lib/index.js` 的 `cleanup.ts` 与 service startup 组合可证明：Raft Computer
在启动时回收 stale pidfile、orphan process、power-loss partial state、tmp file 和 stale
lock；单次启动恢复失败不会伪装成功，而是保留诊断并在下次 restart 再试；`doctor
--cleanup` 提供人工恢复入口。可访问 Raft Server 源码没有暴露 Room attachment GC
状态机，因此本批不能声称复制了 Raft Server 的文件回收实现。

### 2.2 Multica：直接状态机基线

仓库：`https://github.com/multica-ai/multica.git`，冻结 revision
`11861145abc59a0d39c8c8f24ad837d4584e664f`。

结构性移植以下已验证实现：

- `server/internal/service/channel_media_reconciler.go`：独立周期 worker、单条 claim、
  两分钟 lease、每轮最多 50 次尝试、失败从一分钟开始指数退避并在一小时封顶、
  `[15m, 1h, 6h, 24h]` tombstone 重删；
- `server/pkg/db/queries/channel.sql`：短事务认领、lease-token fenced settle、失败释放、
  tombstone schedule 和每次删除前的 durable reference recheck；
- `server/cmd/server/source_context_sweeper.go` 与
  `server/internal/service/source_context.go`：独立于 runtime tick、有界批次按“尝试数”而非
  “成功数”计数，存储故障不能形成无限单轮扫描。

这是 `A` 级结构移植，不是 Go/PostgreSQL 的逐字复制。RAH OS 的时间来自注入 Kernel
clock 并以整数毫秒持久化；单机 daemon 没有副本时钟漂移和惊群，因此不凭空加入
jitter。local `unlink` 也没有远程 HTTP delete timeout；每轮 50 条是本地事件循环的工作
上界。

## 3. 单一 owner 与触发

```text
RoomDeletionService transaction
  -> room_deletion_receipts + per-blob room_file_gc_receipts(pending)
  -> canonical Room graph commit
  -> RoomFiles immediate bounded reconcile

daemon lifecycle
  -> RoomFileGcReconciler every 60s
  -> RoomFiles.reconcileRoomDeletionGc(limit=50)
```

- Kernel 内独立 `RoomFileGcService` 持有 durable 状态机、迁移、claim、lease、backoff、
  tombstone 和汇总；
- `RoomFiles` 仍是 exact blob/path 校验和本地字节删除的唯一 owner；
- daemon 只持有一个可取消的 60 秒调度循环，不解释数据库状态；
- Kernel 启动执行一次有界 sweep，daemon 周期继续清空 backlog；同一删除请求重放只
  触发到期项，不绕过 `next_attempt_at_ms`。

## 4. schema 41 状态机与 schema 42 性能闭环

`room_file_gc_receipts` 在原有字段上增加：

- `next_attempt_at_ms`：下一次允许 claim 的 Kernel clock；
- `lease_token`、`lease_expires_at_ms`：崩溃后可被其他 sweep 续收的短租约；
- `tombstone_pass`：成功重删进度，不能藏在 `last_error` 中。

状态：

```text
pending --claim--> deleting --delete ok--> tombstoned(pass=0)
   ^                  |                         |
   |                  +--delete error----------+-- due claim/re-delete
   |                       (same state, error,       |
   |                        exponential backoff)     +-- pass 0..3 -> parent summary
   +-- legacy failed --claim-------------------+

deleting + expired lease -> reclaim by a later sweep
```

任何 settle 更新都带 `lease_token`；过期旧 worker 的写入更新零行，不能覆盖新 owner。
删除前重新检查 `room_files.attachment_id`：若仍有 canonical 引用，保留字节、记录异常并
退避，绝不删除活文件。

schema 42 不改变上述业务状态机，只关闭大 backlog 的查询放大：

- 全局 sweep 与单个删除回执续收使用两条精确 SQL，不再用 nullable `OR` 合并作用域；
- 全局 due claim 使用 `(next_attempt_at_ms, created_at, deletion_id, attachment_id, ...)`
  索引，单删除续收使用 `(deletion_id, next_attempt_at_ms, created_at, attachment_id, ...)`
  索引；
- `last_error IS NOT NULL` 使用独立 partial index；
- schema 41 的旧索引在一次 `BEGIN IMMEDIATE` 中原子替换，不能出现半迁移的查询面；
- `EXPLAIN QUERY PLAN` 回归测试要求两种 claim 都命中对应索引且不能退化为 table scan 或
  temporary B-tree。

这是一项本地 SQLite 的必要适配，不改变 Multica 的 50 次尝试/轮、60 秒 cadence、lease、
backoff 或 tombstone 语义。索引会增加活动回执的磁盘成本，但避免同步 SQLite 工作长时间
占用 daemon 事件循环。

用户可见 `fileGc` 保持既有四计数：已成功物理删除但仍处于 tombstone 观察期的条目算
`reclaimed`；带 `last_error` 的条目算 `failed`；尚未尝试或正在持 lease 的条目算
`pending`。最后一次 tombstone pass 成功后，Kernel 在同一事务中递增父删除回执的
`gc_reclaimed_count` 并删除 per-file 操作行；幂等重放仍由父回执返回完整汇总，而热表不再
随已经完成的附件无限增长。四项始终满足 `pending + reclaimed + failed = total`。

## 5. 正确性场景

必须用失败测试证明：

1. 文件系统故障后同请求重放不会绕过一分钟 backoff，时钟到期后可恢复；
2. claim 后进程崩溃留下的 lease 在到期前不被抢，到期后幂等续收；
3. 首次 delete 后才出现的 `.part` 会被 15 分钟 tombstone pass 再删；
4. 单轮最多处理 50 次尝试，即使每次都失败也不会无限扫；
5. schema 40 的 `pending/failed/reclaimed` receipt 无损迁移到 schema 42；schema 41 的旧
   due 索引被原子替换；
6. tombstone 尾段压缩 per-file 行后，父删除回执仍可支持同一幂等请求重放；
7. daemon 周期循环在一次 isolated failure 后继续，在 abort 后停止；
8. 原 P1.4 权限、freshness、完整引用图、重放、Chrome/Firefox 删除交互不回归。
9. 0、1,000、10,000 和 100,000 条 future/due backlog 的隔离压力基准必须记录 wall time、
   CPU、RSS 与数据库大小；不能只以功能测试通过宣称长期运行可靠。

## 6. 明确保留的边界

- 不使用 jitter：Multica 的对应 channel-media reconciler 也只使用 capped exponential
  backoff；单 daemon 没有 herd；
- 不做无限 retry 次数封顶：本地文件可能因短暂权限/占用恢复，删除意图不能因次数耗尽
  而被遗忘；持续失败通过 receipt/daemon health 暴露；
- 删除回执保留最小审计元数据。完成 tombstone schedule 的 per-file 行会被压缩进父回执，
  因而热表容量只与尚未完成的附件数相关，不随历史附件总数或轮询次数增长；父回执按
  Room 删除次数线性增长是永久删除幂等语义的有意成本；
- Workspace/Principal 永久删除、跨 Computer 文件复制和远程对象存储另立合同。
- 固定吞吐上限是 50 次尝试/分钟；它优先保证前台交互不会因 GC 形成长任务。极端历史
  backlog 的完全排空时间可能很长，属于运维延迟而非同步 UI 阻塞；未来若改为自适应批次，
  必须显式 yield 并重新做 CPU/IO 压力审计，不能只提高 limit。
