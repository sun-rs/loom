# Agent full reset / 完全重置 Raft-first 合同（P4.6）

状态：`C/A/L/D` 完成；正式数据未执行 destructive full

日期：2026-09-02

2026-09-07 Web 重试补强：一次弹层提交保留同一操作键，提交后固定 mode，失败重试查询原回执；
关闭重开才创建新意图。见[续修证据](../audits/2026-09-07-agent-reset-retry.zh-CN.md)。

## 1. 目标、来源和证据边界

本批只补 Raft Agent `restart | session | full` 中尚未闭合的 `full`。冻结来源为：

- `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`
- SHA-256：`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`
- store：字节偏移约 `1805999` 的 `resetAgent: async`，请求
  `POST /agents/${id}/reset { mode }`；`restart` 保留前端 session/trajectory，
  `session/full` 清前端缓存并把 Agent 投影为 `starting`。
- dialog：字节偏移约 `2671193` 的 `wJe`；三档为 cyan/orange/red，默认
  `restart`，`full` 可选且额外显示不可撤销警告。
- 文案：`agent.reset.restart* / session* / full* / fullWarning`。`full` 的可见合同是：
  清除运行时会话、删除所有 Agent workspace 文件并从零开始重启，包括
  `MEMORY.md` 与 `notes/`，不可撤销。

这份发布物只证明 Raft 前端行为和请求 shape，不能证明未取得的 Raft Server / Computer
删除事务、崩溃恢复或磁盘回收算法。因此复用分类为：

- Raft：产品合同、三档弹层、颜色/文案/loading/error/focus 的 structural port；
- RAH OS：复用现有执行 terminal proof、全局 per-Agent operation fence、Provider continuity
  quarantine、Agent workspace 原子 rename 与 receipt 的安全 glue；
- Multica：当前没有比上述现成 RAH owner 更完整、且与 Raft `full` 同语义的复位 saga，
  不引入第二套 session/workspace owner。

## 2. “所有 workspace 文件”的精确边界

`full` 只重置 Computer 管理的单一 Agent 持久 workspace：

```text
<state>/supervisors/agent-memory/<agent-participant>/
  MEMORY.md
  notes/
  该 Agent 自己放入的其他 workspace 文件
```

它不得删除、清空或改写：

- daemon 配置冻结的 `runtime-project` / `workspace.cwd`；
- 任意真实 Git checkout、用户主目录或浏览器提交的 host path；
- AgentDefinition、头像、角色 prompt、名称、模型、effort、Runtime Profile；
- Workspace/Room/DM/Thread/Message/Task/InputRequest/Artifact/Review canonical ledger；
- 其他 Agent 的 workspace、Memory 或 Provider continuity；
- canonical `RunAttempt` 和 `run_trajectory_entries` 审计事实。

Raft store 在 `session/full` 后清的是客户端 `activityLogs/trajectoryLogs` 缓存。公开前端无法证明
Server 永久删除审计历史。RAH 因此只建立新的 runtime/session 边界；历史轨迹仍按 ACL 可审计，
不得用一次 destructive UI 操作抹除跨 Room 执行证据。

## 3. 不能采用的串联实现

禁止按下列方式实现：

```text
execution reset(session) -> release execution_restart fence
memory reset             -> acquire memory_reset fence
```

两个现有公开操作各自获得并释放全局 per-Agent 独占 lease。它们之间存在无栅栏窗口：已重新
enabled 的 Agent 可能取得一条新 Activation，然后 Memory 才被移走，形成新 Run 与重置并发。
这违反单 lane、terminal proof 和 reset 后 fresh workspace 的合同。

也不得让 UI 先调用两个 HTTP endpoint、用 setTimeout/polling 猜测完成，或在浏览器删除目录。

## 4. 唯一 owner 与复用改造

不新增第二个 reset 服务。继续由 `AgentExecutionResetCoordinator` 拥有一次 Host-local reset saga，
并把既有 `AgentMemoryCoordinator` 的“私有 workspace 原子 quarantine”拆成可组合内部 effect：

| owner                 | 责任                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| protocol              | 把 `AgentExecutionResetMode` 扩为 `restart                                                                                                                 | session | full`；请求仍只有 definition、freshness、idempotency、mode |
| daemon administration | durable disable、等待现有 Host terminal proof、调用一次 coordinator、在同一 fence 内 re-enable                                                             |
| execution coordinator | 一次 `execution_restart` fence、一次 Provider continuity quarantine、一次 workspace effect、receipt 与失败回滚                                             |
| memory coordinator    | 只解析固定 Agent workspace，移除 cleaner config，原子 rename 到 owner-private `.quarantine`，提供 commit/rollback；不再获取第二个 fence，不再清 continuity |
| Kernel                | 继续以现有全局 Agent exclusive-operation lease 阻止任何新 lane；不拥有文件删除                                                                             |
| Web                   | Raft 三档 dialog、危险确认、pending/error/Escape/focus；不编排多个 API                                                                                     |

公开 `agent.memory.reset` 仍保留自己的 `memory_reset` fence，并复用同一个 workspace effect；它
不经执行 reset 路由，也不改变其“重置 Agent Memory”的现有权限和回执。

## 5. 单 fence 事务顺序

```text
Human agent.execution.reset(full)
  1. 根据 agentDefinitionId + idempotencyKey 派生稳定 operationId
  2. canonical set Agent disabled（freshness + idempotency）
  3. Host 取消 active Runtime，等待 RuntimeProcess/RunAttempt terminal proof
  4. acquire execution_restart exclusive fence
  5. memory effect：固定 owner workspace -> 同盘 .quarantine 原子 rename；停 cleaner
  6. ProviderSessionStore.quarantineParticipant(operationId)
  7. fence 内 canonical set Agent enabled
  8. fsync execution reset terminal receipt
  9. commit memory effect（旧目录继续只对 operator recoverable）
 10. release fence
 11. 下一条 canonical Activation 懒创建全新 Raft baseline MEMORY.md，并使用 fresh Provider session
```

空闲 Agent 不伪造常驻 LLM 进程；Raft 的“重启”在 RAH 的 Activation 模型中表示下一条工作从
fresh runtime/session/workspace 启动。

## 6. 失败、回滚与崩溃窗口

- workspace rename 前失败：不改变 workspace/continuity，恢复 enabled 后释放 fence。
- workspace 已移、continuity 失败：把 workspace rename 回原路径，恢复 cleaner；成功后恢复
  enabled 并释放。回滚不能证明时保持 Agent disabled + fence fail closed。
- continuity 已 quarantine、re-enable 或 receipt 失败：先 rollback continuity，再 rollback
  workspace/cleaner；任一 rollback 失败均保留 fence，不允许新 lane。
- receipt 成功后：产品语义已提交。旧 bytes 留在 owner-private quarantine，不能由产品 UI 恢复；
  后续只允许独立、带保留期与引用检查的 operator GC 清理，不把递归删除放进用户请求临界区。
- daemon 在 rename 后崩溃：恢复必须从稳定 operationId、workspace absence/quarantine 命名和
  Provider quarantine receipt 继续同一操作，不能重新开放旧 workspace，也不能因缺 HTTP response
  宣称失败后自动运行。施工前必须以进程重启红测证明该窗口。

这里的“不可撤销”是产品合同：提交后普通用户没有恢复按钮。owner-private quarantine 和正式状态
备份是故障恢复措施，不是产品软删除或撤销承诺。

## 7. 前端行为合同

- 默认选中 `restart`；三档均可 pointer/keyboard 选择。
- `full` 使用 Raft red tone，选中后显示：会永久删除 Agent workspace 的全部文件，包括
  `MEMORY.md`、`notes/`，且无法撤销；明确补充“不会删除本机项目目录”。
- submit 只发一次 typed `agent.execution.reset`，pending 时禁用选择、取消、outside press 和 Escape；
  成功关闭并把焦点还给“重启 / 重置”，失败留在 dialog 并可重试。
- `full` button 文案/颜色按 Raft；后端 capability 未包含 full 时继续 disabled，不能只在前端解锁。
- desktop 与 `390×844` 必须覆盖选择、Tab/方向键、Enter、Escape、outside、失败重试、focus return，
  不在正式用户 Agent 上执行 destructive full。

## 8. Failure-first 施工闸

按顺序先红后绿：

1. protocol：接受 `full`，拒绝未知 mode/额外字段；response 可稳定重放。
2. memory effect：只移动 exact Agent workspace；`runtime-project` 与 sibling Agent 完全不变；
   rename/receipt/rollback/cleaner 失败时状态可证明。
3. execution coordinator：full 在一个 fence 内完成 workspace + continuity + enable + receipt；
   同 key 重放不重复移动；同 key 改 mode/Agent 冲突；回滚失败不 release。
4. daemon administration：disable/terminal proof/full/re-enable 顺序；中途失败恢复或 fail closed；
   restart 后继续稳定 operation。
5. HTTP/SDK/Web：单请求三 mode、capability、Raft dialog 状态机与错误。
6. 隔离端到端：临时 RAH_HOME、临时 Agent workspace、临时真实项目与 Fake Runtime；证明
   `MEMORY.md/notes` 被 fresh baseline 取代而项目文件、Room/Task/轨迹和另一个 Agent 均不变。
7. Chrome/Firefox desktop + `390×844`；正式 4173 只验按钮/弹层/disabled-to-enabled contract，
   不对用户数据执行 full。

在 1-6 全部通过、崩溃恢复反例关闭之前，正式 UI 的 `full` 保持禁用。本文件状态只能从
`R/design` 逐级更新为 `C/A/L/D`，不得因 dialog 看起来一致就宣称后端闭环。

## 9. 施工与二次审计结果（2026-09-02）

本批已经按前述 owner 完成结构化移植，不用 UI 串联两个 endpoint：

- protocol 现在只接受 `restart | session | full`，daemon 通过独立
  `agentExecutionFullReset` capability 解锁前端；旧 daemon 不会被新 Web 误判为支持 full。
- `AgentMemoryWorkspaceQuarantine` 只接受解析后的 opaque Agent workspace，使用稳定 operation hash
  派生 owner-private quarantine；项目 `workspace.cwd`、其他 Agent 和任意浏览器 path 从未进入该
  primitive 的参数面。
- `AgentMemoryCoordinator.beginWorkspaceResetInsideFence` 把既有 cleaner 停止、同盘 rename、
  commit/rollback 拆成内部可组合 effect；公开 Memory Reset 仍持有自己的 `memory_reset` fence，
  没有第二套目录 owner。
- `AgentExecutionResetCoordinator` 的 full 分支在一次 `execution_restart` fence 内顺序执行 workspace
  quarantine、Provider continuity quarantine、re-enable、terminal receipt 与 commit；失败先回滚
  continuity，再回滚 workspace，无法证明回滚时不释放 fence。
- `ProviderSessionStore` 增加稳定 `.operation-manifest`。红测证明旧实现会在 daemon 崩溃后重放
  同一 operation 时因 quarantine 目录 `EEXIST` 失败；现在会验证不可变 participant/session，复用
  已存在记录，并拒绝同 key 改目标。
- Kernel exclusive lease 增加显式同 operation 恢复：只有旧 lease 已过期、Host ID 相同但 Host
  instance 已更换、且可证明没有 active lane 时，恢复进程才能取得新 lease generation；旧 generation
  不能释放新 fence，不同身份和未过期 owner 仍 fail closed。
- Web 结构化复用了 Raft 三档 dialog。full 只有 capability 存在时可选，使用 red tone，并同时提示
  `MEMORY.md`、`notes/` 和其他 Agent workspace 文件不可撤销；额外明确本机项目目录不会删除。

Failure-first 证据：protocol mode、workspace scope、full 单 fence、rollback-before-release、Provider
crash replay 和 expired Host generation recovery 均先失败后转绿。相关 protocol/AgentHost/Kernel/daemon/
application/Web 定向自动化共 `38` 项通过。Chrome 隔离门禁在 `390×844` 通过；Firefox 150.0.2 在
`1440×1000` 与 `390×844` 通过，覆盖 full 选择、警告、Escape 与 focus return，均未提交 destructive
请求。Web production build、Raft callback regression `34/34`、`npm audit --omit=dev`（0 漏洞）和
`git diff --check` 已通过。

全库 `format:check` / Web typecheck 当前被同时写入、非本批所有的 Thread panel 文件阻塞：
`apps/web/test/thread-panel-parity-contract.test.ts` 未格式化，
`apps/web/src/components/thread-panel-resizer.tsx` 有三个 ref 类型错误；`packages/kernel/src/human-activity.ts`
也有外来格式差异。P4.6 触及文件单独执行 Prettier 全部通过。不得删除、覆盖或把这些共享改动伪装成
P4.6 失败；应在它们的 owner 收口后重跑全库门禁。

正式部署前确认 28 个 Activation 全部 `completed`、28 个 RunAttempt 全部 `exited`、28 个
RuntimeProcess 全部 `terminated`、3 个 Agent exclusive fence 全部 `released`，没有运行中工作；唯一
Task 为 `submitted`，等待 Human 验收，不持有运行 lease。旧 4173 精确实例随后被优雅停止；完整状态
备份写入 `/Users/sun/.rah/backups/pre-p46-agent-full-reset-20260902T105415Z`，`room.db` 与
`runtime-registry.db` 的 `quick_check` 均为 `ok`，外键检查无行。

新 production build 已重新监听 `127.0.0.1:4173`。正式页只做非破坏复核：打开 Kimi Agent 资料页，
确认 full 被 dedicated capability 解锁，选择后出现不可撤销 workspace 警告和“本机项目目录不会被删除”；
Escape 关闭后焦点精确回到“重启 / 重置”。`390×844` 下 dialog `left=0/right=390/width=390`，document
与 body `scrollWidth=390`；console 无 error/warn。未点击最终 full submit，用户 Agent 数据没有被重置。
因此本批 `D` 完成；全库共享 worktree 的 Thread panel 阻塞仍按上一段单独保留，不能隐去。
