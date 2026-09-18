# 安装、改名与用户数据生命周期合同

状态：Accepted，2026-09-02。

## 结论

RAH OS 的可替换程序与不可替代用户数据拥有不同生命周期。规范 durable root 是 `~/.rah`；当前应用显示名不进入默认磁盘路径，因此将来改名、替换源码 checkout、升级 SEA 或删除应用本体都不会改变 Room/Agent/Task/Memory/TLS 的身份位置。

`RAH_DATA_HOME` 是规范覆盖变量；`RAH_OS_HOME` 只保留为旧部署的直接根目录别名。两者同时存在但不一致时 fail closed。LaunchAgent 只写 `RAH_DATA_HOME`，不把 secret 放进 plist。

## 旧数据迁移

旧默认 `~/Library/Application Support/RAH OS` 在首次未显式覆盖的启动/安装前迁移：

1. 若 `~/.rah` 不存在，同卷原子 rename 整个旧根。
2. 若 `~/.rah` 已有旧 RAH 的 `runtime-daemon/`、`auth/`、`council/` 等数据，先递归检查所有交叠路径；任何同名文件、类型冲突或符号链接都在移动前拒绝。
3. 通过预检后，旧根先原子 rename 为 `~/.rah/.local-core-migration-v1`，再把无冲突 child 移入稳定根；中途崩溃由下一次启动继续 staging。
4. 完成后写 `0600` migration receipt，根目录收紧为 `0700`。迁移不复制 25 GB 数据，也不覆盖旧 RAH 状态。

显式 `RAH_DATA_HOME` / 兼容 `RAH_OS_HOME` 不触发默认旧目录迁移，避免把用户有意隔离的数据偷偷合并。

## 卸载边界

`rah-os-core uninstall` 与 `npm run uninstall:core:macos` 只执行 launchd bootout 和 plist 删除，并返回保留的数据根。服务卸载接口不再接受 `--purge-data`，因为共享 `~/.rah` 后删除整个根会误删旧 RAH 数据。未来若提供“清除本产品数据”，必须拥有逐目录清单、活动工作 fence、备份/预览和单独确认，不能复用卸载命令。

## 来源与本地适配

- Raft Computer 1.0.18：runner/升级制品在 `~/.local`，身份、Agent memory、runtime session、transport 与 token 状态在 `~/.slock`；程序替换不等于数据删除。
- Multica：`/Applications/Multica.app` 与 Electron `userData`、`~/.multica/profiles` 分离；更新采用临时文件/rename 与回滚。
- RAH OS：保留同一隔离原则，但采用用户指定的稳定 `~/.rah`，并针对同机旧 RAH 数据增加无覆盖合并协议。

## 验收 owner

- `packages/daemon/src/rah-data-home.ts`：解析、冲突、迁移与 crash resume 的唯一 owner。
- `packages/daemon/src/macos-local-core-launch-agent.ts`：LaunchAgent 与无数据删除卸载 owner。
- `packages/daemon/test/rah-data-home.test.ts`：默认、别名冲突、原子采用、并存合并、冲突不动、恢复和显式覆盖。
- Local Core 安装/LaunchAgent 测试：规范环境变量与卸载保留。

## 升级迁移与恢复限制（2026-09-16 补充，R6）

程序可替换、用户数据不可替代这一分界同样约束 schema 升级：**制品回滚不等于数据回滚**。

### 先识别，再快照，最后迁移

1. 部署/启动 owner 先做只读识别：`RoomKernel.inspectSchemaState(room.db)` 只读打开数据库，比较 `user_version` 与本构建的 `KERNEL_SCHEMA_VERSION`，并把库内 `sqlite_schema` 对象与本构建初始化出的参考 schema 逐个比对。它不写入任何字节。
2. **无待迁移项的普通启动不复制数据目录**，也不写迁移日志。
3. 有待迁移项时，`protectKernelSchemaMigration()` 先在 `<RAH_DATA_HOME>/backups/pre-migration-<时间>-<uuid>` 建立独占快照：复用既有 SQLite online backup、`quick_check`/`foreign_key_check` 校验与 sha256 回执，并另写 `*.receipt.json`（快照路径、每个库的 sha256、`from → to` 版本、待迁移项、以及 Room 账本进度证据）。
4. 快照失败一律 fail closed：抛出诊断并且**不迁移**数据库。
5. 只有快照建立并校验通过后，Kernel 才被允许执行迁移。

2026-09-17 收口：结构签名保留索引 WHERE/表达式/排序规则、默认值字面量大小写、CHECK、外键和唯一约束。仅接受 `kernel-schema-signature.ts` 列出的精确历史 ALTER 遗漏；同一表的其他差异仍拒绝。当前版本的未知漂移在写入前拒绝，旧版本迁移后必须通过结构复核。只读打开失败不再降级为可写打开。正式重启命令在停止在役进程之前，对已校验备份的临时副本执行新 Kernel 初始化及完整性检查；副本预检失败不会停掉旧服务。

2026-09-18 重启预检修正：operator 正式重启使用 `assertWorkbenchRestartable`，允许原样保留已无租约的隔离 Activation；隔离是暂停调度的失败记录，不等同于仍在执行，也不等同于 Task。queued Activation 仅在租约字段全部为空、同 Room 存在有效 SOS hold 且对应操作为 stopped 时允许原样保留：Kernel 的调度候选投影排除此类 Room，重启不解除 hold。普通 queued、leased Activation、starting/running/orphaned RunAttempt、未 terminated 的 RuntimeProcess、未 released 的 Placement、active 独占操作租约仍阻止重启；stopping/resumed 或错误 Room 的 hold 不满足例外。重启不会删除、重试、恢复或完成暂停记录。恢复/其他严格空闲检查继续使用 `assertWorkbenchIdle`，不放宽数据库恢复条件。详见[暂停通知与重启检查](../audits/2026-09-18-held-activation-restart.zh-CN.md)。

### 数据库内的统一失败语义

Kernel `initialize()` 的迁移链被划分为命名 unit：可事务的 DDL/数据步骤按最大安全单位合并进单个 `BEGIN IMMEDIATE`（`PRAGMA user_version` 与最后一组 DDL 同一事务提交，因此中断的升级不会宣告自己没有的版本）；必须在事务外执行的步骤（`PRAGMA foreign_keys` 切换的整表重建、`VACUUM`）保持原样，并在 `kernel_schema_migration_journal` 留下可恢复记录（running/completed/failed、尝试次数、有界错误）。不给每个 helper 强加 SAVEPOINT。

### 恢复限制

- 旧二进制读到更新的 `user_version` 一律拒绝打开，并说明“制品回滚不回滚数据”。
- 恢复库函数尚未暴露为产品命令。调用者必须先停止工作台；函数检查给定 PID、所有 Host offline 与无活动执行，检查快照回执、账本进度、所有状态文件摘要、全部数据库对象与行内容。事件数量相同不足以证明无新写入。
- 恢复先在旁边准备并验证完整目录，复查当前状态后才把 `state/` 改名为 `state.superseded-<时间>` 并置换；置换失败则恢复原目录。不会先移走现役目录再复制快照。
- 此入口仅接受与快照逻辑内容完全一致的离线状态。已迁移的结构、迁移日志或其他数据变化也会拒绝，不能用它自动回滚已经迁移的数据库；这种恢复需要专门的数据迁移方案。
- 任一条件不满足即拒绝并保留现场，返回明确诊断，绝不自动丢弃迁移后产生的新数据。

owner：`packages/kernel/src/kernel-schema-state.ts`（只读识别与迁移日志）、`packages/kernel/src/room-kernel.ts` 的 `initialize()` unit 划分、`packages/daemon/src/state-backup.ts`（快照/校验/恢复；`scripts/workbench-restart-guard.mjs` 只是它的脚本门面，已安装产品不依赖仓库脚本）。
