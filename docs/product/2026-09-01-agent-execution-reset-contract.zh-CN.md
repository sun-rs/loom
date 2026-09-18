# Agent execution restart / session reset 产品合同

状态：`restart/session` 已完成；`full` 进入 2026-09-02 单 fence 补强施工

日期：2026-09-01

## 1. 目标与非目标

2026-09-18 修正：`restart/session/full` 都接受已停止（disabled）的 Agent，
成功后在原有 Host fence 内恢复 enabled。已停止时跳过重复 disable；若 Host
重置失败，原本停止的 Agent 保持停止，原本启用的 Agent 沿用已有恢复处理。
不放宽 tombstoned、权限、terminal proof、幂等收据或工作区范围保护。
详见[重启语义及弹窗修复](../audits/2026-09-18-agent-reset-parity.zh-CN.md)。

本批只闭合本机 Agent 的两种显式运行控制：

- `restart`：终止当前 Run，并让尚未完成的 canonical Activation 重新调度；保留 Agent 身份、`MEMORY.md + notes/`、Workspace 文件和 Provider continuity。
- `session`：执行同一终止/重调度链，并隔离该 Agent 的 Provider continuity；保留 Agent 身份、Memory、Workspace 与 Room/Task ledger。下一次 Activation 必须 fresh。

`full` 的精确边界、单 fence saga、崩溃恢复和 failure-first 闸已经另立
[P4.6 Agent 完全重置合同](./2026-09-02-agent-full-reset-contract.zh-CN.md)。它只处理 Agent-owned
workspace，永不递归删除用户项目 cwd；本文件以下首批描述仍以 `restart/session` 的已验收合同为准。

RAH OS 的 Runtime 按 Activation 启停，不常驻一个空闲 LLM 进程。因此 Agent 空闲时的 `restart` 不伪造进程：操作完成后保持空闲；下一条 canonical Activation 按原 Provider session 启动。`session` 则按 fresh session 启动。

## 2. 来源优先级与复用裁决

### 2.1 Raft：产品合同与 UI 结构

授权快照：`raft-ui/vendor/raft/index-WTraJnrd.js`

SHA-256：`fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`

采用：

- `POST /agents/:id/reset {mode}` 的 `restart | session | full` mode 合同；
- 三档单选弹层、默认选择 `restart`、`full` 危险提示、取消不执行；
- `restart` 保留客户端 session/trajectory，`session/full` 清客户端 session/trajectory，并把 Agent 投影为 `starting`；
- 运行时配置变更可以携带 `restartMode`，但模型切换不能更换 Agent 身份或清 Memory。

不据此推断：

- Raft Server/Computer 如何终止进程、证明 terminal、恢复半完成操作；
- 前端收到 2xx 就足以证明 Runtime 已停止；
- `full` 可以对任意 cwd 做递归删除。

### 2.2 Multica：Provider 取消与 continuity 经验

源码 revision：`11861145abc59a0d39c8c8f24ad837d4584e664f`

采用其已在 RAH OS Provider adapters 中结构化移植并验证的部分：

- Codex `turn/interrupt`、ACP `session/cancel`、OpenCode abort、Claude signal/stream lifecycle；
- resume/fresh 的严格分类和 Provider session ID 只作为 Host 私有 continuity；
- 取消后不把 CLI exit 当作 Task 或 Activation 完成。

不采用：

- Multica Issue/Task/Chat session 作为 RAH OS 的业务真相；
- Provider transcript、stdout 或 session row 驱动 Room/Task 状态。

### 2.3 RAH OS：安全与业务 owner

沿用而不重写：

- Kernel `AgentExclusiveOperationLease(kind=execution_restart)`；
- Agent `disabled` 对所有 scheduler/lease 的 durable execution gate；
- AgentHost Provider-native cancel + process-group terminal proof；
- `ProviderSessionStore.quarantineParticipant()` 的 rollback-capable continuity 隔离；
- Room-first `Room event -> Inbox -> Activation -> RunAttempt -> explicit Room action`。

来源分类是 `structured-port + RAH safety glue`，不是 Raft 字节级后端复制。

## 3. 本机状态机

```text
Human request (mode, idempotency key, control Room seq)
  -> derive stable operation id and check terminal receipt
  -> disable Agent through canonical agent.manage
  -> AgentHost observes disabled during lease maintenance
  -> provider-native cancel
  -> RuntimeProcess terminal proof + RunAttempt terminal
  -> unfinished Activation remains/re-enters queued
  -> acquire execution_restart exclusive fence
  -> restart: no continuity mutation
     session: quarantine Provider continuity
  -> enable Agent through canonical agent.manage while fence is still active
  -> persist terminal receipt
  -> release fence
  -> queued Activation may run again
```

顺序中的关键点：

1. 先 durable disable，再等 terminal；不能先删 session。
2. terminal proof 之前不能取得最终操作 fence，也不能重新启用。
3. 先在 fence 内恢复 `enabled`，再持久化 terminal receipt，最后释放 fence；这样 release 后才允许新 Run，避免无保护的 release→enable 竞态。
4. session quarantine 失败必须 rollback；rollback 不能证明时保持 fail-closed。
5. Room、Task、Memory 和 Workspace 不随两种 mode 改写。
6. 操作重放必须返回同一 receipt；同一 idempotency key 不得改变 mode/Agent。

## 4. 前后端合同

首批新增 typed operation：

- request：`agent.execution.reset`；
- input：`agentDefinitionId`、`basedOnRoomSeq`、`idempotencyKey`、`mode=restart|session`；
- response：operation/participant/mode、deduplicated、continuity record count、完成时间；
- capability：后端未提供时按钮保持禁用，不能退化为浏览器本地状态变化。

UI 复用 Raft 三档布局：

- 默认 `restart`；
- `session` 明确说明保留 Memory/Workspace/Room；
- `full` 在 P4.6 capability 完整接线前可见但禁用；接线后仍由同一个 typed operation 提交；
- pending 期间禁止重复提交；失败留在弹层并显示可重试错误；Escape/取消不发请求，关闭后焦点回触发按钮。

## 5. 验收

至少证明：

1. idle `restart` 不清 Provider continuity；idle `session` 清 continuity；
2. active Run 先收到 cancel，只有 terminal proof 后才重新调度；
3. Memory、Workspace 文件、Room 消息、Task 状态不变；
4. 同 key 重放不重复清 session；不同 mode 冲突；
5. 中途失败不启动第二条 lane，失败后 Agent 要么恢复 enabled，要么显式保持 disabled/fenced；
6. daemon 重启后数据库、Memory、Workspace 不丢；未完成操作不得静默宣称成功；
7. 正式 Web 在桌面与 `390x844` 完成 pointer、keyboard、Escape、focus return、pending/error 验收。

本合同不证明跨 Computer transport、autonomous idle wake 或 `full` reset。
