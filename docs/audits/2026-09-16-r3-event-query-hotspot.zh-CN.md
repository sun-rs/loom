# R3 事件查询热点修复（2026-09-16）

## 工作项与裁决

修复 `docs/product/2026-09-16-rc-repair-and-hardening-guide.zh-CN.md` §5 R3
「修复事件查询热点」，对应
`docs/audits/2026-09-16-rc1-audit-and-latest-raft.zh-CN.md` Top-12「查询热点」行
（裁决：成立）。

裁决范围：

- 只按真实查询计划补索引，不引入新的事件系统、不建删除队列、不改
  `packages/daemon/src/agent-deletion-reconciler.ts` 的调度节奏（它只拥有节奏）。
- 用户指令「R3 先满足本次索引迁移的必要保护，不扩大为整套迁移重构」：迁移保护
  只覆盖本次这两个索引的创建（幂等、重复启动、旧库升级、创建失败），不建立通用
  备份/快照框架（那是 R6）。
- 不添加 `messages(room_id, created_at)`、`agent_definitions(state)`：这两条热点
  查询的实测计划都没有要求它们。`agent_definitions` 在 `agent_definition_id`
  （主键）与 `participant_id`（UNIQUE）上已有自动索引，join 两侧都已是点查。

## 证据

### 热点语句

两条语句原样取自 `packages/kernel/src/room-kernel.ts`：

- `reconcileAgentDeletions()`（约 3050 行）——daemon reconciler 每 1000ms 调用一次：

  ```sql
  SELECT e.* FROM room_events e
    JOIN agent_definitions a ON a.agent_definition_id=e.aggregate_id
   WHERE e.type='agent.deletion_requested' AND a.state='disabled'
   ORDER BY e.created_at LIMIT 50
  ```

- `#assertWorkerGrantScope`（约 5750 行）——每次 Worker 授权都会执行一次：

  ```sql
  SELECT 1 FROM agent_definitions a
    JOIN room_events e ON e.aggregate_id=a.agent_definition_id
   WHERE a.participant_id=? AND e.type='agent.deletion_requested' LIMIT 1
  ```

`packages/kernel/src/schema.ts` 原有的 `room_events` 索引
（`idx_room_events_sequence`、`idx_room_events_message_aggregate`）与
`packages/kernel/src/discovery-schema.ts` 的 `idx_room_events_aggregate` 全部以
`room_id` 打头，而这两条语句都没有 `room_id` 条件，因此无法有效利用。

### 数据量与测量方法

临时 Kernel DB（`RoomKernel.initialize()` 建库后直接批量 `INSERT`）：

- 计划测量用 **200000** 条无关事件（5 种类型轮换，2000/5000 个 `aggregate_id`）
  外加 **200** 条 `agent.deletion_requested`，DB 文件约 135MB，`page_size` 4096。
- 回归测试（`event-query-hotspot.test.ts`）用 **50000** 条无关事件 + 12 条删除事件，
  单测约 0.43s。
- **不执行 `ANALYZE`**：全仓 `packages/kernel/src` 与 `packages/daemon/src` 没有任何
  `ANALYZE` 调用，生产库没有 `sqlite_stat1`，规划器必须仅凭结构选中索引。
  （附带发现：一旦人工 `ANALYZE`，SQLite 会对
  `idx_room_events_message_aggregate` 做 skip-scan，掩盖问题；生产不存在这一情况。）

### 计划（前）

| 查询        | EXPLAIN QUERY PLAN                                                                                                                       |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| reconcile   | `SCAN e` / `SEARCH a USING INDEX sqlite_autoindex_agent_definitions_1 (agent_definition_id=?)` / `USE TEMP B-TREE FOR ORDER BY`          |
| grant-scope | `SEARCH a USING INDEX sqlite_autoindex_agent_definitions_2 (participant_id=?)` / `SCAN e USING COVERING INDEX idx_room_events_aggregate` |

即：每秒一次全表扫 20 万行 + 临时 B 树排序；每次 Worker 授权全扫一遍
`idx_room_events_aggregate` 覆盖索引。

### 计划（后）

| 查询        | EXPLAIN QUERY PLAN                                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| reconcile   | `SCAN e USING INDEX idx_room_events_agent_deletion_requested_created` / `SEARCH a USING INDEX sqlite_autoindex_agent_definitions_1 (agent_definition_id=?)`                          |
| grant-scope | `SEARCH a USING INDEX sqlite_autoindex_agent_definitions_2 (participant_id=?)` / `SEARCH e USING COVERING INDEX idx_room_events_agent_deletion_requested_aggregate (aggregate_id=?)` |

reconcile 的 `SCAN e USING INDEX ...` 走的是**部分索引**，只含
`agent.deletion_requested` 行（200 条 / 4 页），不是表扫描；`USE TEMP B-TREE`
消失，`ORDER BY e.created_at` 由索引顺序直接满足。grant-scope 变成
`aggregate_id` 点查。

### 候选对比（200k 行实测）

| 候选                                                                    | reconcile                        | grant-scope                    | 索引大小             | DB 增长  |
| ----------------------------------------------------------------------- | -------------------------------- | ------------------------------ | -------------------- | -------- |
| `(type, aggregate_id)`                                                  | SEARCH(type=?) + **TEMP B-TREE** | SEARCH 覆盖(type,aggregate_id) | 6.79 MB / 1657 页    | +6.99 MB |
| `(type, created_at, aggregate_id)`                                      | SEARCH(type=?)，无排序           | 只能 `type=?` 前缀扫           | 11.85 MB / 2892 页   | +5.06 MB |
| `(type, aggregate_id, created_at)`                                      | SEARCH(type=?) + **TEMP B-TREE** | SEARCH 覆盖                    | 11.85 MB / 2893 页   | —        |
| 部分 `(created_at, aggregate_id) WHERE type='agent.deletion_requested'` | 索引顺序扫，无排序               | 部分索引全扫                   | **16 KB / 4 页**     | **0**    |
| 部分 `(aggregate_id) WHERE type='agent.deletion_requested'`             | 无序                             | SEARCH(aggregate_id=?)         | **12 KB / 3 页**     | **0**    |
| **采用：上述两个部分索引**                                              | 索引顺序扫，无排序               | SEARCH(aggregate_id=?)         | **28 KB / 7 页合计** | **0**    |
| 完整索引对（type,created_at,aggregate_id）+（type,aggregate_id）        | 同上                             | 同上                           | 18.6 MB / 4549 页    | +6.78 MB |

写入代价（同一 DB 连续插入 20000 条 `room_events`，单事务）：

| 索引配置                                    | 耗时   | 相对基线 |
| ------------------------------------------- | ------ | -------- |
| 基线（不加新索引）                          | 374 ms | —        |
| **采用的部分索引对**                        | 434 ms | **+16%** |
| 完整索引对                                  | 549 ms | +47%     |
| 单个完整 `(type, created_at, aggregate_id)` | 692 ms | +85%     |

## 改动

- `packages/kernel/src/schema.ts`：新增 `AGENT_DELETION_EVENT_INDEXES` 与
  `migrateAgentDeletionEventIndexes(database)`。两条语句都是
  `CREATE INDEX IF NOT EXISTS`，均为部分索引：

  ```sql
  CREATE INDEX IF NOT EXISTS idx_room_events_agent_deletion_requested_created
    ON room_events(created_at, aggregate_id)
    WHERE type = 'agent.deletion_requested';
  CREATE INDEX IF NOT EXISTS idx_room_events_agent_deletion_requested_aggregate
    ON room_events(aggregate_id)
    WHERE type = 'agent.deletion_requested';
  ```

  创建失败时抛出带索引名、原因与「只增索引、不改写任何行、可安全重试」说明的
  错误，而不是裸 SQLite 消息。

- `packages/kernel/src/room-kernel.ts`：`initialize()` 在
  `migrateBoundedRoomReadsV49` 之后调用 `migrateAgentDeletionEventIndexes`；
  新增一处 import。

- **两条 SQL 未作任何改写。** 现有列序（`ORDER BY e.created_at`）已能被
  `(created_at, aggregate_id)` 部分索引直接满足，因此没有触碰
  `reconcileAgentDeletions` 或 `#assertWorkerGrantScope` 的语句、结果或顺序语义。

- `packages/kernel/test/event-query-hotspot.test.ts`：新增 6 个测试（见下）。

未触碰：`sqlite-transaction.ts`、其它迁移步骤、
`packages/daemon/src/agent-deletion-reconciler.ts`、其它任何 package。

### 为什么否决其它方案

- `(type, aggregate_id)`：reconcile 仍需 `USE TEMP B-TREE FOR ORDER BY`，且为
  全量事件建 6.8MB 索引。
- `(type, created_at, aggregate_id)` 单独一条：能解 reconcile，但 grant-scope 只能
  按 `type=?` 前缀扫描（随历史删除次数线性增长），同时对每一条事件写入都多付一次
  b-tree 插入（+85% 写入耗时、11.8MB）。
- `(type, aggregate_id, created_at)`：grant-scope 好，但 reconcile 排序回退到临时
  B 树。
- 完整（非部分）索引对：计划与部分索引对完全相同，却多占 18.6MB 并把写入代价推到
  +47%。`agent.deletion_requested` 在 `room_events` 中占比极低，部分索引让其余每一
  类事件的插入只多一次 `WHERE` 判定，不写 b-tree。
- 单个部分索引 `(created_at, aggregate_id)`：reconcile 最优，但 grant-scope 退化为
  扫描整个部分索引，其规模随产品生命周期内累计删除次数增长；第二个部分索引只要
  3 页即可把它变成点查。

## 验证

TDD：先写测试并记录失败，再实现。

初始失败（实现前，`node --test packages/kernel/test/event-query-hotspot.test.ts`）：
`tests 6 / pass 0 / fail 6`，关键输出——

```
✖ the per-second deletion reconcile query reads an index instead of scanning every unrelated room event
  reconcile plan must read idx_room_events_agent_deletion_requested_created, got:
  SCAN e | SEARCH a USING INDEX sqlite_autoindex_agent_definitions_1 (agent_definition_id=?) | USE TEMP B-TREE FOR ORDER BY
✖ the Worker grant-scope fence looks the deletion event up by aggregate id
  grant-scope must search, not scan, got:
  SEARCH a USING INDEX sqlite_autoindex_agent_definitions_2 (participant_id=?) | SCAN e USING COVERING INDEX idx_room_events_aggregate
✖ repeated initialize() keeps exactly one copy of each deletion index  (actual [], expected 两个索引)
✖ initialize() adds the deletion indexes to a populated database that predates them ... (no such index)
✖ a blocked deletion index makes initialize() fail with an actionable message ... (no such index)
✖ the new indexes change neither the rows nor the order the reconcile query returns (no such index)
```

新增测试（`packages/kernel/test/event-query-hotspot.test.ts`，7 个，全部通过）：

1. reconcile 计划：访问 `room_events` 的那一行必须引用
   `idx_room_events_agent_deletion_requested_created`，且整行等于
   `SCAN e USING INDEX <索引名>`（即不是表扫描），计划中不得出现 `TEMP B-TREE`。
2. grant-scope 计划：该行必须以 `SEARCH e` 开头，并同时包含
   `idx_room_events_agent_deletion_requested_aggregate` 与 `aggregate_id=?`。
3. 结果与顺序：断言**具体期望值**，不只是「前后相等」。fixture 现在写入真实的
   `agent_definitions`（连同 `principals` 外键）——
   **55 个 `disabled` 且各带一条 `agent.deletion_requested` 事件**（超过 `LIMIT 50`，
   因此排序真正决定返回哪些行；事件的插入顺序按确定性置换打乱，与 `created_at`
   刻意不一致），外加四类排除样本：`enabled` 带删除事件、`tombstoned` 带删除事件、
   `disabled` 但无删除事件、以及两条 `aggregate_id` 无对应 Agent 的删除事件
   （四类的 `created_at` 都刻意早于全部 pending，一旦过滤失效就会排在最前被抓到）。
   断言：恰好返回 50 行、`aggregate_id` 序列等于按 `created_at` 升序算出的前 50 个、
   `created_at` 自身升序、五个排除 id 均不出现；随后 `DROP` 掉两个索引重跑，整行
   `deepEqual`，id 序列仍等于同一期望值。
4. grant-scope 行为：对带删除请求的 participant 命中（最早与最新各一个）、对
   `enabled` 但已有删除请求的 participant 也命中（围栏先于 `disabled` 生效）、对
   无删除请求的 `disabled` Agent 与不存在的 participant 均不命中；`DROP` 掉
   aggregate 索引后同样的命中/不命中结论不变。
5. 重复 `initialize()` 三次，`sqlite_master` 中这两个索引各恰好一份。
6. 旧库升级：在已填充数据的库上 `DROP` 掉两个索引模拟旧版本库，再
   `initialize()`，索引补齐且 `room_events` 行数与前 200 行 `event_id` 序列不变。
7. 创建失败注入：预先建一张与索引同名的 TABLE（`CREATE INDEX IF NOT EXISTS`
   在此仍会报错），`initialize()` 抛出含 `room_events`、索引名与
   「safe to retry」的错误；移除占名对象后再次 `initialize()` 成功，两个索引齐备。

计划类断言只针对计划属性（索引名、`SEARCH`/`SCAN`、有无 `TEMP B-TREE`），不锁定
SQLite 的完整输出文本；未引入任何毫秒阈值断言。

评审修正记录（P2）：初版第 3 条测试的删除事件 `aggregate_id` 没有对应的
`agent_definitions` 行，join 结果两边都是 `[]`，「前后相等」不证明任何东西。已按上述
方式补齐真实 Agent 行、`LIMIT 50` 边界、排除样本与具体期望值断言，并新增第 4 条
grant-scope 行为测试。

命令与退出码：

| 命令                                                                     | 结果                                    |
| ------------------------------------------------------------------------ | --------------------------------------- |
| `node --test packages/kernel/test/event-query-hotspot.test.ts`（实现前） | 6/6 失败（预期）                        |
| `node --test packages/kernel/test/event-query-hotspot.test.ts`（实现后） | 6/6 通过，1.24s                         |
| 同上（评审修正、测试加强后）                                             | **7/7 通过，1.27s**                     |
| `node --test packages/kernel/test/agent-deletion.test.ts`                | 7/7 通过，0.49s                         |
| `node --test --test-concurrency=1 packages/kernel/test/*.test.ts`        | 421/421 通过，42.4s，exit 0             |
| 同上（评审修正后复跑）                                                   | **422/422 通过，0 失败，40.6s，exit 0** |
| `npx prettier --check`（三个改动文件）                                   | exit 0                                  |

`agent-deletion.test.ts` 覆盖「删除后 Worker 立即被围栏阻止」（`a live runtime,
forged exit identity, and late worker calls cannot cross the deletion fence`）与
删除协调顺序，均未改动即通过。

未按要求运行完整 `npm run check`。

## 部署

- **未部署。** 正式重启由 Fable 在冻结后执行。
- 本次迁移**只新增索引，不改写任何行**，不修改表结构、不动 `PRAGMA user_version`。
- 旧库升级行为：下次 `initialize()` 在已有库上创建两个部分索引。因为是部分索引，
  构建量与 `agent.deletion_requested` 事件数成正比（200k 行库上实测 10ms，DB 文件
  大小增长 0 字节），不会出现长时间启动阻塞。
- 重复启动幂等；若创建被阻塞（同名对象、只读库），`initialize()` 抛出可操作错误并
  保留已建成的那一个索引，清除原因后下一次启动补齐剩余部分，不留卡死的半成品状态。

## 剩余项

- 未建立通用迁移备份/快照/回滚框架——按用户指令留给 R6。
- 生产库始终没有 `ANALYZE`/`sqlite_stat1`。本次修复不依赖统计信息，但一旦将来有人
  引入 `ANALYZE`，`room_events` 上的其它查询计划可能整体变化，需要重新体检。
- 只覆盖了 R3 指名的这两条语句。`room_events` 上其它不带 `room_id` 的查询（若有）
  未在本次盘点范围内。
- `packages/kernel/src/discovery-schema.ts` 另有一套 `room_events` 索引，本次未触碰；
  索引归属分散在 `schema.ts` 与 `discovery-schema.ts` 两处，可在后续整理。
