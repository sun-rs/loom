# R5 Agent 删除阻塞的可观测与恢复(2026-09-16)

后续状态：本报告是初次交付记录；其中 orphaned RunAttempt 待修事项已由[09-17 接手收口](2026-09-17-ab-takeover-closure.zh-CN.md)处理，验收与部署以该后续记录为准。

来源:`docs/product/2026-09-16-rc-repair-and-hardening-guide.zh-CN.md` §6 R5;
审计行 H1(`docs/audits/2026-09-16-rc1-audit-and-latest-raft.zh-CN.md`)。
约束:§2「数据与执行」——不删除数据库、不伪造终止证明、不强杀活动执行、不移除 fencing。

## 工作项与裁决

| 项目               | 裁决                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| H1「无 UI/无超时」 | **部分成立**。前台确有 30 秒等待与错误展示,但错误不可操作;后台无持久阻塞原因、无恢复入口                                    |
| 阻塞可观测         | **确认缺陷,已修**。新增只读投影:阻塞表/谓词、RunAttempt/Activation/Host/recovery driver、首次与最近观察时间、可执行恢复步骤 |
| 协调器事件风暴     | **未成立**(原本就不追加事件),但原实现完全静默吞掉阻塞。已改为按状态变化上报一次                                             |
| 恢复完成           | **已有覆盖 + 新增回归**。原 Host 提交匹配的终止证明后,既有协调器继续完成删除                                                |
| orphaned 运行恢复  | **新增缺陷(未修,越权)**。恢复所有者已证明终止后,`run_attempts` 仍停在 `orphaned`,删除永久阻塞。见「剩余项」                 |
| 强制删除           | **不实施**。任何路径都不绕过终止证明                                                                                        |

## 证据

原行为(HEAD 98dc095 + 批次 A 未提交改动):

- `packages/kernel/src/agent-deletion.ts:117` 起,`finishAgentDeletion` 就 5 张表逐条判定
  (`run_attempts` / `runtime_processes` / `activations` / `placements` /
  `agent_exclusive_operation_leases`),命中即抛 `RuntimeTerminationProofError`,
  错误文本不含任何行身份。
- `packages/kernel/src/room-kernel.ts` `reconcileAgentDeletions()` 对该错误
  `if (!(error instanceof RuntimeTerminationProofError)) throw error;` —— 静默吞掉,
  不落库、不上报。
- `packages/daemon/src/agent-deletion-reconciler.ts` 每 1000ms 调用一次,只有其他异常
  才走 `onFailure`。
- `packages/application-service/src/client-application-service.ts`
  `manageAgentAfterTerminalProof` 的 30 秒 deadline 到期后原样抛出该无信息错误,
  前台 `agent-state-dialog.tsx` 仅显示 `error.message`。

先写的失败测试(`packages/kernel/test/agent-deletion-diagnostics.test.ts`),
首次运行 5/5 失败,失败原因为 `f.kernel.getAgentDeletionDiagnostics is not a function`
(其余断言因此未到达)。`packages/daemon/test/agent-deletion-reconciler.test.ts` 与
`apps/web/test/agent-deletion-status.test.ts` 同样先失败后实现。

## 改动

单一所有者:Kernel 拥有「为什么阻塞」和「怎么恢复」;application-service/SDK 只转发;
Web 只展示。

- 新增 `packages/kernel/src/agent-deletion-diagnostics.ts`:阻塞谓词表
  (与删除围栏同一顺序、同一谓词)、`findAgentDeletionBlocker`、签名、中文诊断与恢复步骤、
  投影读写、`readAgentDeletionDiagnostics`。诊断只读标识符与枚举状态,
  **不读** `recovery_descriptor_json`、`recovery_last_error` 等自由文本。
- `packages/kernel/src/agent-deletion.ts`:围栏改为调用同一 `findAgentDeletionBlocker`,
  错误文本带上表/谓词/RunAttempt/Host/recovery driver;删除成功时清除投影行。
  判定条件本身未放宽。
- `packages/kernel/src/schema.ts`:新增 `agent_deletion_blocks`(单行/每个被阻塞 Agent)。
  只持久化无法派生的事实——**首次观察到阻塞的时间**;其余全部按读派生。
  写入只发生在「阻塞打开」或「阻塞行身份改变」时,完成即删除,**没有每秒写**。
  该表**刻意不设外键**:它是派生记账,若引入到 rooms 的外键路径,就会把诊断投影拉进
  Room 删除擦除合同(`ROOM_DELETION_REFERENCED_TABLES`),改变本工作项不拥有的所有者。
- `packages/kernel/src/room-kernel.ts`:仅 `reconcileAgentDeletions`(新增可选
  `onBlockChange`,按状态变化回调一次)与新增只读 `getAgentDeletionDiagnostics`
  (control room manager 鉴权,复用 `requireHumanControlRoomManager`)。
- `packages/kernel/src/human-application-port.ts`:暴露该只读方法(路由必需的机械改动)。
- `packages/protocol/src/client-agent-deletion-diagnostics.ts` + index 导出:严格
  (`.strict()`)只读 schema。
- `packages/application-service/src/client-application-service.ts`:新增只读路由
  `/v3/client/agents/deletion/diagnostics`。
- `packages/client-sdk/src/index.ts`:新增 `agent.deletion.diagnostics` 操作。
- `packages/daemon/src/agent-deletion-reconciler.ts`:仅 onFailure/onStatus 语义。
  `onStatus` 默认回落到既有 `onFailure`,因此不改 R4 正在编辑的
  `daemon-application-support.ts` 也能生效。节奏仍是唯一所有权。
- Web:新增 `apps/web/src/agent-deletion-notice.ts`(纯逻辑,便于无 JSX loader 单测)与
  `apps/web/src/components/agent-deletion-status.tsx`(仅展示);
  `agent-state-dialog.tsx` 在删除失败后读取该只读投影并展示,
  `agent-directory-pane.tsx` 用已有 `client` 注入读取函数。**没有第二套状态存储**,
  文案不再宣称超时,而是说明请求仍然持久、缺什么证明、下一步做什么。

与 Raft 的有意差异:借鉴其「精确身份 + 终态读回」思路,但不把任何回执当作 Runtime 终止证明,
也不引入强制删除。

## 验证

实际执行(退出结果均为 0 / fail 0):

- `node --test --test-concurrency=1 packages/kernel/test/agent-deletion-diagnostics.test.ts`
  —— 先失败 5/5,实现后 6 pass / 0 fail。
- `node --test --test-concurrency=1 packages/kernel/test/*.test.ts` —— 428 pass / 0 fail。
- `node --test --test-concurrency=1 packages/kernel/test/agent-deletion.test.ts
agent-deletion-diagnostics.test.ts room-deletion.test.ts event-query-hotspot.test.ts`
  —— 36 pass / 0 fail(含 Room 删除外键棘轮回归)。
- `node --test --test-concurrency=1 packages/protocol/test/*.test.ts` —— 119 pass / 0 fail。
- `node --test packages/client-sdk/test/*.test.ts` —— 5 pass / 0 fail
  (更新了 `RAH_CLIENT_OPERATION_NAMES` 覆盖清单)。
- `node --test --test-concurrency=1 packages/application-service/test/*.test.ts`
  —— 171 pass / 0 fail。
- `node --test --test-concurrency=1 packages/daemon/test/agent-deletion-reconciler.test.ts`
  —— 3 pass / 0 fail。
- `node --test apps/web/test/*.test.ts` —— 447 pass / 0 fail。
- `npx tsc --noEmit` 与 `npx tsc --noEmit -p apps/web` —— 均无输出。
- `npx prettier --write` 覆盖全部改动文件。

覆盖的场景:orphaned 运行阻塞且诊断可查、driver 不匹配(`leaseNextRuntimeRecovery`
用错误 driver 返回 null)、迟到/冒名 Host 回执被拒、重复删除请求只有一条持久意图、
Host 恢复后删除完成、重启后诊断仍在(`first_observed_at` 不变)、阻塞期间新执行被围栏
(`authorizeWorkerExecution` 拒绝、`leaseNextActivation` 返回 null)、历史与 Agent 身份
未被提前删除、诊断序列化后不含 canary secret 与 token 字样、
协调器 5 个 tick 只上报 1 次阻塞与 1 次解除。

未运行(按指令):`npm run check` 全量、真实浏览器门禁、付费 CLI。
验证期间另一并行代理正在改写 `room-kernel.ts` 的 `SCHEMA_SQL` 导入
(拆分为 `SCHEMA_OBJECT_SQL`/`SCHEMA_PRAGMA_SQL`),曾造成瞬时 `SCHEMA_SQL is not defined`;
等其落定后重跑,上述结果均为一致状态下取得。

## 部署

**未部署**。未 commit/push,未 npm install,未重启正式本地工作台,未运行付费 CLI。
无备份/回退动作。Web 改动需要由 Fable 在集成冻结后统一 `build:web:workbench` 并按站立
要求重启,本工作项不执行。

## 剩余项

**backend(新增缺陷,未修,越权)**:`#persistRuntimeTermination`
(`packages/kernel/src/room-kernel.ts`)在恢复所有者证明终止时释放了 Placement,
却不把 `run_attempts` 从 `orphaned` 收束为终态;`finishRunAttempt` 只接受
`starting`/`running`,因此 orphaned 行没有任何离开路径。结果:即使匹配 recovery driver
的 Host 完整回来并写入真实退出结果,`state IN (...,'orphaned')` 仍永久阻塞删除。
这正是 H1「长期阻塞」的真实成因之一。修复属于 RunAttempt 生命周期所有者,
且不能由本只读投影代劳(那会变成伪造终止证明)。当前处理:
`packages/kernel/test/agent-deletion-diagnostics.test.ts` 用注释和断言固定了该现象,
诊断在 `runtime_processes=terminated` 且 `run_attempts=orphaned` 时输出专门的文案,
不再让运维去召回一台已经尽责的 Host。**建议作为独立工作项交给该所有者。**

**frontend**:`rah-agent-deletion-status` 及其子类名尚无样式(`product.css` 属 Fable/R9
范围,本批次未触碰)。当前继承对话框排版,可读但未做设计档位对齐;
需要样式的话由 UI 所有者按 `ui-component-spec` 走。

**验证缺口**:未做真实浏览器验收(未构建、未重启工作台),未做实机 PWA 验收,
未运行真实 CLI。「代码完成 + 自动化通过」不等于「真实浏览器通过 / 正式部署通过」。

**归属说明**:本工作项额外改动了两个不在 R5 归属表内、但也不在「不得触碰」清单内的文件:
`packages/kernel/src/human-application-port.ts`(只读路由必需的两行暴露)与
`apps/web/src/components/agent-directory-pane.tsx`、`agent-state-dialog.tsx`
(注入并展示只读投影所需的最小行)。另新增
`apps/web/src/agent-deletion-notice.ts` 作为 `agent-deletion-status.tsx` 的纯逻辑部分,
因为 `node --test` 不能加载 `.tsx`。请 Fable 在集成时确认。
`package.json` / `docs/README.md` 无需改动,故未提交
`scratchpad/batch-a/integration/R5-*.md` 补丁。
