# R6 通用升级迁移保护

后续状态：本报告保留初次实现与事故经过；其中所有 drift 放行、只读失败降级可写、仅凭事件数量恢复等规则已由[09-17 接手收口](2026-09-17-ab-takeover-closure.zh-CN.md)取代，当前规则与验收以该后续记录为准。

日期：2026-09-16。基线：`98dc095`（工作区含批次 A/B 未提交改动）。施工单：[rc.1 修复与补强施工指南](../product/2026-09-16-rc-repair-and-hardening-guide.zh-CN.md) §6 R6。

| 字段         | 内容                                                                                                                              |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| 工作项与裁决 | R6；**确认缺陷已修复**（迁移前无识别、无快照、无统一失败语义；`verifyCanonicalState` 在正式库上第二次跑迁移）。新增回归测试 12 项 |
| 证据         | 见「原行为与失败反例」                                                                                                            |
| 改动         | 见「改动与单一 owner」                                                                                                            |
| 验证         | 见「验证」                                                                                                                        |
| 部署         | **未部署**。无正式重启、无实机验收。下次正式重启时的行为已在「下次正式重启会发生什么」写明                                        |
| 剩余项       | 见「剩余项」                                                                                                                      |

## 原行为与失败反例

1. **没有识别步骤**。`RoomKernel.initialize()` 直接顺序执行约 20 个迁移函数，最后才写 `PRAGMA user_version = 56`。没有任何入口能在写之前回答“打开这个库会不会改 schema”。
2. **迁移前没有快照**。kernel/daemon 内零 backup 逻辑；唯一的 online backup 在 `scripts/workbench-restart-guard.mjs`，只服务于 `restart-local-workbench.mjs` 这一操作员命令，已安装产品（`rah-os-core`）的升级路径根本够不到它。
3. **失败语义不统一**。整条链在事务外执行，中途抛错会留下“部分新对象 + 旧 `user_version`”的半套状态。
   - 失败反例（`packages/kernel/test/kernel-schema-migration-protection.test.ts`「a failing migration unit leaves no half-applied schema」）：预置一个与 `idx_outbox_unpublished` 同名的表，使 `SCHEMA_SQL` 后段建索引失败。修改前该库会留下 142 个已建表/索引；期望是一个都不留。初次运行的失败输出即为这 142 项与 `[]` 的 diff。
4. **正式库上的第二次 initialize**。`local-workbench-bootstrap.ts:432 verifyCanonicalState` 为“验证”再次 `new RoomKernel().initialize()`，在活数据库上重跑整条迁移链（含可能的 `VACUUM`）。
5. 其余初次失败：`kernel_schema_migration_journal` 表不存在；`RoomKernel.inspectSchemaState` 不存在；daemon 侧快照/恢复函数不存在。

## 改动与单一 owner

### Kernel 拥有 schema 迁移

- 新 `packages/kernel/src/kernel-schema-state.ts`（只读识别 + 迁移日志 owner）：
  - `inspectSchemaState()` 以 **read-only** 打开数据库（WAL 未回放时才降级为 read-write，并在结果里如实报告 `openMode`），比较 `user_version` 与本构建的 `KERNEL_SCHEMA_VERSION`，并把库内 `sqlite_schema` 对象（类型 + 名字 + 归一化 SQL）与本构建初始化出的参考 schema 逐项比对，输出 `missing_object` / `changed_object` / `schema_version`。参考 schema 由一次性的内存库构建并缓存，因此不依赖手工维护的探针清单，新增索引/表会自动被识别为待迁移。
  - 本构建不创建的遗留对象记为 `unknownObjects`，**不计入待迁移**，避免老残留让每次普通启动都像升级。
  - `migrationUnitRunner()` / `recordMigrationUnit()`：unit 级执行与 `kernel_schema_migration_journal` 记录。
- `packages/kernel/src/room-kernel.ts` `initialize()` 重组为命名 unit（顺序与原实现逐行一致）：
  - `transactional`：`base-schema`、`room-metadata`、`reminder-targets-v36`、`task-and-profile-schema`、`service-schema`、`agent-thread-follow-backfill`、`host-and-offer-columns`、`placement-columns-and-version`。每个 unit 一个 `BEGIN IMMEDIATE`，一处失败整组回滚。
  - `external`：`legacy-task-schema`、`collaboration-v7`、`task-anchors-v9`、`activation-retry-fences-v35`、`input-request-cancellation-v38`、`run-attempts-placement-fk`（都必须切换 `PRAGMA foreign_keys` 并自带事务）、`room-file-schema`、`all-channel-memberships`、`task-review-backfill`、`activation-obligation-backfill`、`runtime-process-reconciliation`（自带事务）、`vacuum`。它们靠 journal 记录可恢复。
  - `PRAGMA user_version = 56` 与最后一组 DDL 在同一事务里提交：**被中断的升级不可能宣告自己没有的版本**。
  - 连接 pragma 从 `SCHEMA_SQL` 拆成 `SCHEMA_PRAGMA_SQL` + `SCHEMA_OBJECT_SQL`（`SCHEMA_SQL` 仍导出、语义不变），因为 `journal_mode` 不能在事务内改。这是「必须包一层才拆」的最小改动，没有给任何 helper 加 SAVEPOINT。
  - **无待迁移项时完全不写 journal**：普通启动的迁移日志零写入。
  - `pendingSchemaChanges()` / `RoomKernel.inspectSchemaState()` 为只读方法。
  - 为满足 `packages/core/test/source-boundary.test.ts` 的 6,925 行 ratchet，上述逻辑落在新模块而不是堆进 `room-kernel.ts`（当前 6,912 行，未放宽 ratchet）。

### 部署入口拥有停写与快照

- 新 `packages/daemon/src/state-backup.ts`：`fileInventory` / `backupState` / `verifyStateBackup` / `assertWorkbenchIdle` 从 `scripts/workbench-restart-guard.mjs` **整体移入 daemon 包**，已安装产品不再需要仓库脚本；脚本改为薄门面再导出，`restart-local-workbench.mjs` 与既有测试不变。新增：
  - `stateWriteEvidence()`：只读读取每 Room `max(room_seq)` 与事件总数。
  - `snapshotStateBeforeMigration()`：独占目录 + online backup + 完整性校验 + `*.receipt.json`（sha256、`from → to`、待迁移项、写入证据）。
  - `protectKernelSchemaMigration()`：识别 → （无变化则直接返回，**不复制任何数据**）→ 快照 → 才允许 `initialize()`。快照失败抛出“migration aborted / 数据库未迁移”。
  - `restoreStateSnapshot()`：显式确认串 + 快照校验 + 工作台已停止（可选 pid 存活检查）+ `assertWorkbenchIdle` + 写入证据完全一致，才允许恢复；恢复也不覆盖现场，先把 `state/` 改名为 `state.superseded-<时间>`。
- `packages/daemon/src/local-workbench-bootstrap.ts`：`prepareLocalWorkbench` 在读出凭据后调用 `protectKernelSchemaMigration({ stateDirectory })`；`verifyCanonicalState` **不再 `initialize()`**，改为断言 `pendingSchemaChanges()` 为空后只做验证与既有 `ensureAllChannel` 业务修复。

### 会触发 `initialize()` 的入口盘点

| 入口                                                                                                                           | 是否受保护                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `scripts/run-local-workbench.mjs` → `startRestartableLocalCoreWorkbench` → `startLocalCoreWorkbench` → `prepareLocalWorkbench` | 是（本次接入）                                                                               |
| 已安装产品 `rah-os-core`（LaunchAgent → `local-core-cli-dispatch.ts` → 同一条 `startLocalCoreWorkbench`）                      | 是（同一 owner，无需改 `macos-local-core-launch-agent.ts` / `install-macos-local-core.mjs`） |
| `local-workbench-bootstrap.ts:168`（首次 `initializeState` 的 staging 库）                                                     | 全新库，无数据可保护                                                                         |
| `local-workbench-bootstrap.ts` `verifyCanonicalState`                                                                          | 已移除该次 `initialize()`                                                                    |
| `local-workbench-runtime-bindings.ts:53`、`daemon-application.ts` `RahCore.open()`                                             | 都排在受保护迁移之后，届时已无待迁移项，不再产生 schema 写入（见剩余项）                     |
| `packages/daemon/src/cli.ts` 通用 `rah-os-daemon --config`（开发者入口，不是已安装产品路径）                                   | **否**，见剩余项                                                                             |

## 先测与验证

新增 `packages/kernel/test/kernel-schema-migration-protection.test.ts`（6）与 `packages/daemon/test/upgrade-migration-protection.test.ts`（6），全部先写、先记录失败（`no such table: kernel_schema_migration_journal`、`RoomKernel.inspectSchemaState is not a function`、半套 schema 的 142 项 diff）再实现：

- 真实 WAL 临时库；迁移中断后重开只会得到旧完整状态或新完整状态；
- 磁盘写失败（`backups` 目录 0o500）→ 快照失败、迁移未发生、库字节 sha 不变、版本仍为 49；
- 坏快照（篡改 `human.token`）→ 校验失败、不恢复；
- 重复启动幂等：无待迁移项时不建备份、不重写 journal；
- 版本较新的库被拒绝且不建备份；
- 文件阶段失败保留可恢复记录（journal 全部 `completed`；失败 unit 记 `failed`）；
- 升级后 `room_events` / `messages` / `memberships` / `principals` / `agent_definitions` / `agent_definition_revisions` / `execution_policy_revisions` / `agent_memory_homes` 计数一致，消息正文一致（历史、Agent 配置、私有记忆 home、权限/成员关系均保留）；
- 快照后有新业务写入时恢复被拒绝且现场不变；
- 恢复需显式确认串，且把旧 `state/` 原样留在 `state.superseded-*`；
- `verifyCanonicalState` 不再迁移：普通再次启动后 journal 的 unit/attempts 完全不变。

实际执行命令与结果：

```
node --test --test-concurrency=1 packages/kernel/test/*.test.ts     # 434 pass / 0 fail
node --test --test-concurrency=1 packages/daemon/test/*.test.ts     # 213 pass / 17 skipped（付费 CLI 门禁）/ 0 fail
node --test --test-concurrency=1 scripts/*.test.mjs                 # 165 pass / 0 fail
node --test packages/core/test/source-boundary.test.ts              # 2 pass（room-kernel.ts 6,912 行 ≤ 6,925 ratchet）
npx tsc --noEmit                                                     # 无输出
npx prettier --write <本次改动文件>                                   # 已格式化
git diff --check                                                     # 无输出
```

`packages/core/test/core.test.ts` 的 `getAgentDeletionDiagnostics` 断言失败属于同批 R5 的在途改动，不在本项 owner 范围内，未触碰。

## 下次正式重启会发生什么

当前正式库 `user_version = 56`，但工作区相对 HEAD 已新增 `agent_deletion_blocks` 表、两条 `agent.deletion_requested` 局部索引（R5/R3），本项又新增 `kernel_schema_migration_journal` 表。因此下次正式重启 **算“有待迁移项”**：

1. `restart-local-workbench.mjs` 仍按原合同先做 `pre-restart-*` 全量备份与校验，再停止在役进程；
2. 继任进程启动、`prepareLocalWorkbench` 只读识别出 `missing_object`（三类新对象，`user_version` 本身不变），
3. 因此会在 `<RAH_DATA_HOME>/backups/pre-migration-<时间>-<uuid>` **再建一次已校验的迁移前快照**并写 `*.receipt.json`，
4. 然后才执行迁移：新表/新索引在各自事务 unit 内提交，journal 记录每个 unit；
5. 若快照因磁盘/权限失败，启动会直接失败并留下“数据库未迁移”的诊断，不会带着半套 schema 上线。

也就是说：这次重启会产生两份备份（重启前全量 + 迁移前快照），这是预期行为；之后再无 schema 变化的普通重启将不再复制数据目录。

## 剩余项

- **后端**：`local-workbench-runtime-bindings.ts:53` 与 `RahCore.open()` 仍各自调用一次 `initialize()`。受保护迁移已在它们之前完成，所以它们不会再改 schema、不写 journal；但“同一进程内三次 initialize”本身是可以再收敛的冗余，属于另一 owner 的重构。
- **后端**：`packages/daemon/src/cli.ts` 的通用 `rah-os-daemon --config` 入口不经过 `prepareLocalWorkbench`，因此不受快照保护。它不是已安装产品路径；若要保护，应由该 CLI owner 在打开 Core 前调用 `protectKernelSchemaMigration()`。
- **运维**：`restoreStateSnapshot()` 目前只是带显式确认与全部前置证明的库函数，尚未接上一个操作员命令（CLI/npm script）。接线属于 CLI owner，不在本项文件范围内。
- **验证缺口**：全部为临时目录 + 真实 WAL 的故障注入测试；**未在正式部署上执行过一次真实升级重启**，也没有真实浏览器/实机验收。R5/R3 的迁移与本项的 unit 划分同时落库的真实效果需在下次正式重启时观察 journal 与 `backups/` 目录。
- **有意差异**：Raft 新版 `kOperationAcknowledgement` 是制品升级回执，不是 SQLite schema 迁移保护；本项没有据此移植任何升级状态机，只借鉴了“终态读回、前驱证明”的思路用于恢复前置条件。

## 热修：文本比对导致升级后永久启动失败（同日）

**事故**：正式重启时迁移本身成功（`agent_deletion_blocks`、两条局部索引、`kernel_schema_migration_journal` 均已建立），但 `verifyCanonicalState` 抛出「still has 14 pending schema changes (first: `changed_object:index:idx_room_file_gc_pending`)」，继任进程退出。

**根因**：`kernel-schema-state.ts` 原先比较 `sqlite_schema.sql` 原文。真实演化过的库（`ALTER TABLE ADD COLUMN` 增列、更早版本的 CREATE 文本、类型大小写差异）与全新参考库**结构相同但文本不同**，这类差异任何迁移都无法消除，于是变成永久待迁移项 → 每个升级过的安装都会启动失败。

**修复**（仅 `kernel-schema-state.ts` + 其测试，与 `local-workbench-bootstrap.ts` 的一处收窄）：

1. 结构化比对：表用 `PRAGMA table_info`（列名、归一化类型、notnull、归一化默认值、pk）作为**集合**；索引用 `PRAGMA index_list`（unique/partial）+ `PRAGMA index_xinfo`（列、key、desc）；trigger/view 无 pragma，改用归一化文本（折叠空白 + 小写）；无法结构化比对的对象类型签名为空，**永不判为 changed**。`missing_object` / `schema_version` / `unknownObjects` 语义不变。
2. 启动韧性收窄：受保护迁移完成后若剩余项**全部是 `changed_object`**，打印诊断并继续启动（`blockingSchemaChanges()`）；`missing_object` 与 `schema_version` 仍然 fail closed。

**先测**（记录失败后实现）：参考库 `CREATE TABLE probe(a TEXT NOT NULL, b INTEGER DEFAULT 0)` 对比「`CREATE TABLE probe(a)` + `ALTER TABLE ... ADD COLUMN b integer DEFAULT 0`」与重排版索引/视图 → 初次运行报告 `changed_object: index:idx_probe, table:probe`，期望 `[]`；另有真实 Kernel 库上重排版 `idx_room_file_gc_pending` → 0 待迁移，以及把该索引重建到别的列上 → 仍准确报告一条 `changed_object`。daemon 侧覆盖 `blockingSchemaChanges` 两个分支，并端到端验证「结构漂移的索引不再阻止启动」。

**对现役库的含义**：那 14 项是文本假阳性，结构化比对后归零；两项 `missing_object` 已由本次迁移建立。因此继任进程可正常启动，且下次普通启动不会再判为有待迁移项（不会再建快照）。

## 二次收敛：把无法迁移的遗留漂移移出 `pending`（同日）

结构化比对上线后，现役库只读核验仍剩 **3 项真实的遗留约束漂移**，且任何迁移都无法消除：

| 对象                                       | 现役库       | 本构建参考  | 成因                                                     |
| ------------------------------------------ | ------------ | ----------- | -------------------------------------------------------- |
| `reminders.target_room_id`                 | 可空         | `NOT NULL`  | `ALTER TABLE ADD COLUMN` 无法在没有默认值时加 `NOT NULL` |
| `room_file_gc_receipts.next_attempt_at_ms` | 无 `DEFAULT` | `DEFAULT 0` | 历史 CREATE 文本                                         |
| `room_files.created_at`                    | 可空         | `NOT NULL`  | 同上                                                     |

若它们留在 `pending` 里，`protectKernelSchemaMigration` 会在**每次**普通启动都判为有待迁移项并复制整个数据目录，违反 R6 合同「无 schema 变化的普通启动不反复复制整个数据目录」，诊断也会永远刷屏。

**改动**：

- `KernelSchemaState` 拆成 `pending`（只含迁移能处理的 `missing_object` / `schema_version`）与 `drift`（`legacy_drift`，只报告不处理），`unknownObjects` 不变。原 `changed_object` 这个 kind 被 `legacy_drift` 取代。
- `protectKernelSchemaMigration`：只有 `drift` 时**直接返回、不复制任何数据**；每次启动在 stderr 打一行漂移诊断；有快照时把漂移写进回执的 `legacyDrift`。
- `verifyCanonicalState` 回到简单的 fail closed：`pending` 非空即失败（现在只可能是迁移没做完），漂移不再经过它，`blockingSchemaChanges()` 随之删除。

**测试**：参考库 `NOT NULL` / `DEFAULT 0` 对比现役式的可空/无默认三张表 → `pending` 为 `[]`、`drift` 3 项；删掉其中一张表 → 仍报 `missing_object`。daemon 侧：制造真实结构漂移 → `inspectSchemaState.pending` 为空、`protectKernelSchemaMigration` 不建备份目录、`prepareLocalWorkbench` 正常返回；再删掉 `kernel_schema_migration_journal` → 照常建立并校验快照后迁移。

**裁决**：这三项作为**已知遗留漂移接受**，不在 R6 内修。要消除它们需要对三张表做整表重建迁移（`CREATE TABLE new … NOT NULL/DEFAULT` + 回填 + rename），涉及历史数据回填策略与停写窗口，是另一次独立决定。
