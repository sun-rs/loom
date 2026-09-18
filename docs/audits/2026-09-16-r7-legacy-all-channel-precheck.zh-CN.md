# R7 旧 all 频道的升级预检（2026-09-16）

## 工作项与裁决

实现 `docs/product/2026-09-16-rc-repair-and-hardening-guide.zh-CN.md` §6 R7
「旧 all 频道的升级预检」。Owner 入口仍是
`packages/daemon/src/ensure-all-channel.ts`，所有修复写入仍走 Kernel 命令。

裁决范围：

- 预检必须发生在任何破坏性或创建性写入之前，返回结构化诊断（频道身份、原因、
  受支持的恢复步骤），而不是一句无信息的 `Error`。
- 只有「安全且不改变身份/隐私」的情形才自动恢复：缺失（照旧创建 canonical）、
  仅显示名漂移（改回保留名）。
- 私有、归档、多候选、非 Channel 占位一律 fail closed：不静默公开、不删改历史、
  不创建第二个 canonical all。
- Human 成员缺失只报告，不修复：永久 `#all` 的成员关系由 Kernel 自动管理
  （`addRoomMember`/`addMember` 对 `slug='all'` 直接抛
  `permanent #all membership is managed automatically`），daemon 侧补一行
  `memberships` 属于绕过 canonical 合同，因此按指南「否则报告」处理。
- 不触碰 §2「数据与执行」红线：不删库、不清历史、不伪造证明。

## 证据

### 修复前的真实缺陷

`packages/daemon/src/ensure-all-channel.ts`（HEAD 98dc095，19-24 行）：

```ts
const existing = kernel
  .listRooms(actor, { workspaceId })
  .find((r) => r.kind === "channel" && r.slug === "all");
if (existing) {
  if (
    existing.archivedAt ||
    existing.visibility !== "public" ||
    existing.name !== "all"
  )
    throw new Error("Existing #all needs explicit recovery before startup");
  return existing;
}
```

两个实测问题：

1. **诊断为零。** 抛出的字符串不含 roomId、slug、name、visibility、归档时间、
   成员数、事件数，运维无法据此决定做什么，也没有任何受支持的恢复路径。
2. **可见性盲区导致误判「缺失」。**
   `packages/kernel/src/collaboration-service.ts:981` 的 `listRooms` 是
   `JOIN memberships ON memberships.principal_id = ?`，即**成员范围**查询。旧库里
   一个私有、且当前 Human 已不在成员表中的 `#all`，`listRooms` 根本看不到，旧代码
   会进入 `createWorkspaceRoom` 分支去新建 canonical all——只是被
   `UNIQUE (workspace_id, slug)` 兜住而报一个与真实原因无关的错误。本次新增测试
   `private legacy all is never publicized and never duplicated` 直接断言了
   `listRooms` 看不到该 Room 这一前提。

另注：`name='all'` 且 `slug!='all'` 的「冒名」Room 无法经由 Kernel 命令创建
（`createWorkspaceRoom`/`updateWorkspaceRoom` 都有保留名检查），只可能来自旧库或
外部写入，因此多候选场景在测试中用直接 SQL 构造。

### 实际输出的诊断（私有 + Human 已非成员）

```text
Existing #all needs explicit recovery before startup (private): the canonical #all is private; startup never publicizes a private Room
  candidate: roomId=room_58866927-… slug=all name="all" kind=channel visibility=private archived=no systemHidden=false members=0 humanMembers=0 events=1 lastEventAt=2026-09-16T13:33:22.575Z
  option: decide explicitly whether this Room becomes public again, which exposes its history to every Workspace member
  option: or move its content elsewhere and free the #all identity yourself
  option: the Human principal_24b1… is not a member of this Room; permanent #all membership is Kernel-managed, so decide explicitly whether to restore that membership
```

## 改动

- `packages/kernel/src/all-channel-membership.ts`：**只新增只读查询**，原
  `reconcileAllChannelMemberships` 一字未改。新增
  `AllChannelCandidateSnapshot` 类型与 `readAllChannelCandidates(database, workspaceId)`：
  按 `workspace_id` 且 `slug='all' OR name='all'` 取出全部候选（不经成员过滤），
  每条带 roomId / workspaceId / kind / slug / name / description / visibility /
  archivedAt / systemHidden / createdAt / latestRoomSeq（`next_seq-1`）/ memberCount /
  humanMemberPrincipalIds / eventCount / lastEventAt。该函数不含任何写语句。

- `packages/kernel/src/index.ts`：新增两行导出（`readAllChannelCandidates` 与其
  类型）。**这是本工作项唯一一处共享文件改动**，纯增量；`@rah-os/kernel` 的
  `exports` 是单一字符串入口，daemon 无法深路径导入，故必须走 index。

- `packages/daemon/src/ensure-all-channel.ts`：

  - 新增 `precheckAllChannel(kernel, accessToken, workspaceId): AllChannelPrecheck`
    ——纯只读。状态机：`hidden` / `missing` / `canonical` / `name_drift` /
    `archived` / `private` / `ambiguous` / `unsupported`，每个状态带 `reason`、
    `candidates[]`、`recovery[]`（供操作者选择的具体选项）、`humanMembership`
    （`present` / `missing` / `not_applicable`）与 `autoRecoverable`。
  - 新增 `AllChannelPrecheckError`，`message` 为多行诊断（保留原句
    `Existing #all needs explicit recovery before startup` 前缀，便于既有日志匹配），
    并挂 `precheck` 结构体供调用方处理。
  - `ensureAllChannel` 先跑预检，再按结果分支：`hidden` → `undefined`；
    `missing` → 与原来完全一致的 `createWorkspaceRoom`（同一 idempotencyKey
    `local-workbench-permanent-all-v1`）；`name_drift` → 一次
    `updateWorkspaceRoom`，**保持同一 roomId、visibility=public、原 description
    原样回填**，只把 name 改回 `all`；`canonical` → 返回既有 Room；其余状态一律抛
    `AllChannelPrecheckError`。
  - 签名向后兼容：新增可选第 5 参数 `{ onPrecheck }`，
    `packages/daemon/src/local-workbench-bootstrap.ts` 的现有四参调用不受影响。
  - 候选读取用 `new DatabaseSync(kernel.databasePath, { readOnly: true })` 打开
    同一文件，查询后立即 `close()`。原因：`listRooms` 的成员范围盲区（见证据），
    而 R7 的文件归属不允许在 `packages/kernel/src/room-kernel.ts` 上加只读方法。
    连接以 `readOnly` 打开，物理上无法写入。

- `packages/daemon/test/ensure-all-channel.test.ts`：重写为 8 个用例（下节）。
  原用例（幂等 + 隐藏 + 不改名其它 Channel）的断言全部保留在新用例中。

未触碰：`local-workbench-bootstrap.ts`、`room-kernel.ts`、
`collaboration-service.ts`、`room-lifecycle-policy.ts`、`schema.ts`，以及归属清单
「不得触碰」的全部文件。

### 为什么不自动修这三类

- **私有**：改公开会把该 Room 的全部历史暴露给 Workspace 的所有成员，属于
  §2「不得静默公开私有频道」，只能由人决定。
- **归档**：`unarchiveWorkspaceRoom` 是恢复动作，但归档本身在当前 Kernel 合同下
  不可能由命令产生（`assertPermanentChannelChange` 禁止），出现即说明旧库或外部
  写入越过了合同，自动 unarchive 会掩盖真实原因。
- **多候选**：任何自动挑选都等于替用户判定哪一份历史是「正品」。

## 验证

TDD：先写测试并记录失败，再实现。

初始红（把三个源文件临时回滚到 `git show HEAD:` 版本后
`node --test packages/daemon/test/ensure-all-channel.test.ts`）：整文件失败，
`pass 0 / fail 1`，原因是 `precheckAllChannel` / `AllChannelPrecheckError` /
`readAllChannelCandidates` 在 HEAD 版本中不存在（导入级失败）。中途一次实现不完整
时另见 4 条断言级失败（历史摘要、`assert.throws` 返回值），已修正。

新增/重写测试（8 个，全部通过）：

| 用例                                            | 断言要点                                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 正常（两次启动幂等）                            | 预检 `missing` → `canonical`；两次 roomId 相同；`slug='all' OR name='all'` 的行恰好 1 条；除 all 与 control 外每个 Room 的事件摘要逐 Room 相等                  |
| 隐藏系统频道                                    | 预检 `hidden`，`ensureAllChannel` 返回 `undefined`，隐藏位不变                                                                                                  |
| 归档                                            | 预检 `archived`、`autoRecoverable=false`、带 archivedAt；抛错信息含 roomId 与 `archived`；候选数仍为 1；**全库**事件摘要与调用前逐 Room 相等                    |
| 私有（且 Human 已非成员）                       | 先断言 `listRooms` 看不到该 Room；预检 `private` + `humanMembership=missing`；抛错；`visibility` 仍为 `private`；无重复 all；全库历史不变                       |
| 改名（canonical 仅显示名漂移）                  | 预检 `name_drift`；恢复后 roomId 不变、name=`all`、visibility=`public`、description 原样保留；其它 Room 历史摘要不变；再次调用无新事件                          |
| 多候选                                          | 预检 `ambiguous`、候选 2 条；抛错信息同时含两个 roomId；两个 Room 都在；全库历史不变                                                                            |
| 恢复中断（Proxy 让 `updateWorkspaceRoom` 抛错） | 失败时**一个字节都没写**（全库事件摘要不变、无重复 all）；下一次正常启动把同一 Room 恢复为 canonical                                                            |
| Human 成员缺失                                  | 预检 `canonical` + `humanMembership=missing`，`recovery` 含 membership 决策项；`ensureAllChannel` 返回同一 roomId（不新建）；`memberships` 行数仍为 0（不伪造） |

历史不变的证明方式：`historyDigest()` 直接从 DB 文件按 `room_id, room_seq` 读
`room_events` 的 9 个列，逐 Room 滚动 sha256，前后 `deepEqual` 比较整张 Map，
而不是只比条数。

命令与退出码：

| 命令                                                                    | 结果                                           |
| ----------------------------------------------------------------------- | ---------------------------------------------- |
| `node --test packages/daemon/test/ensure-all-channel.test.ts`（实现前） | 失败（导入级，预期）                           |
| `node --test packages/daemon/test/ensure-all-channel.test.ts`（实现后） | 8/8 通过，0.55s                                |
| `node --test --test-concurrency=1 packages/daemon/test/*.test.ts`       | tests 221 / pass 204 / fail 0 / skip 17，58.8s |
| `node --test packages/kernel/test/permanent-all-channel.test.ts`        | 2/2 通过                                       |
| `node --test packages/daemon/test/local-workbench-bootstrap.test.ts`    | 通过（与上面两个文件合跑 13/13）               |
| `npx tsc --noEmit`                                                      | 本工作项文件 0 错误                            |
| `npx prettier --write`（四个改动文件）                                  | 通过                                           |

跳过的 17 个是 `real-*-gate` 系列：未设置 `RAH_REAL_CLI_GATE` 等环境变量时
`{ skip: true }`，本次**没有运行任何付费 CLI**。

`npx tsc --noEmit` 另报 `packages/kernel/src/room-kernel.ts` 的
`AgentDeletionBlockChange` / `readAgentDeletionDiagnostics` 等 8 个 `TS2304` 与
`packages/kernel/test/agent-deletion-diagnostics.test.ts` 1 个错误——属于并行进行中的
R5 未完成改动，与 R7 无关，本次未触碰这些文件。

未按要求运行完整 `npm run check`。

## 部署

- **未部署。** 正式重启由 Fable 在冻结后执行。
- 本次改动不含任何 schema 迁移、不新增表或列、不改写任何已有行。
- 正常库（canonical `#all` 已存在且合规）的启动行为与改动前完全一致，只是多一次
  读查询；`missing` 分支的创建命令与 idempotencyKey 未变，重复启动幂等。
- 旧库若命中 archived / private / 多候选 / 非 Channel 占位，daemon 会**拒绝启动**
  并打印完整诊断——这是刻意的 fail closed，与改动前的行为方向一致，但现在带
  身份、原因与可选恢复路径。

## 剩余项

- **需要 Fable 注意的集成点**：`packages/kernel/src/index.ts` 增加了两行导出，
  R3/R5 若同期改同一文件需合并。
- 预检结果目前只通过 `onPrecheck` 回调与异常对象暴露；
  `local-workbench-bootstrap.ts` 属于他人归属，**尚未接线**，因此
  `humanMembership=missing` 这类「可启动但需知会」的诊断当前不会出现在启动日志里。
  建议后续在 bootstrap 处接一行日志（本次未改该文件）。
- 读取候选时开了第二个 `readOnly` SQLite 连接。更干净的做法是在
  `RoomKernel` 上加一个只读方法，但 `room-kernel.ts` 不在 R7 的文件归属内，留作
  后续归并。
- `precheckAllChannel` 只覆盖单个 Workspace；多 Workspace 库需要调用方逐个传入。
- Human 成员缺失仍只报告不修复。若产品决定它应当自动补齐，属于 Kernel 侧
  canonical `#all` 成员合同的变更（`#assertMutableMembershipRoom` 与
  `reconcileAllChannelMemberships` 目前只自动纳入 Agent，不含 Human），不应在
  daemon 侧绕过。
- 未做实机验证：未重启现役工作台、未在真实旧库上跑过升级。
