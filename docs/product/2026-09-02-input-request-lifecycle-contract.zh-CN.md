# InputRequest 生命周期收口合同（2026-09-02）

## 1. 当前裁决

现有 `request -> waiting_input -> Human answer -> fresh Activation` 主链保留。P3
不引入一套自制的表单/工单系统，只关闭已经由 canonical Task 状态机证明存在的
失配：**Task 被取消后，它的 pending InputRequest 也必须在同一事务中终止**。

本批状态集合为：

```text
pending -> resolved
pending -> cancelled  (Task cancellation 的原子派生状态)
```

`resolved` 和 `cancelled` 都是 terminal。Task 重新打开不会复活旧 InputRequest；Agent
若仍需输入，必须在新的执行证据下创建新的 request。

## 2. Raft 源合同与可复用边界

授权冻结前端为
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
发布前端能够证明的相关合同是：

- NotificationCenter/card/dialog 的平面卡片、状态、关闭和键盘行为；
- 打开、查看、关闭不等于 durable dismiss；只有显式 dismiss 才写个人偏好；
- actionable target 点击后仍需重新检查当前存在性和 ACL；
- 通知/Activity/未读只是提示和投影，不拥有业务状态。

发布包没有暴露名为 `InputRequest`/`input_request`/`waiting_input` 的专门服务端
生命周期，也不能证明 server 端 TTL、取消或结构化回答事务。因此：

- Raft 前端交互继续按 `structured port` 使用；
- InputRequest 业务 owner 仍是 RAH OS Kernel；
- 不把未知的 Raft Server 实现描述成已复制源码。

## 3. Multica 对比

监督工作树 `/Users/sun/Code/repos/multica` 当前没有可直接复用的 typed Human
InputRequest 生命周期。命中项是普通 composer focus、API input 字段、Issue/Autopilot
表单或文档文字，不包含 `pending/resolved/cancelled`、designated responder、Task
suspend/resume 的 canonical 状态机。

因此本批不采用 Multica 代码。继续保留其 recipient/workspace 隔离、幂等 mutation、
写后重读 canonical projection 作为监督原则；不引入它的 Issue-centric Inbox。

## 4. 已证明的缺陷

当前 `TaskLifecycleService.cancelTask` 会把 `waiting_input` Task 改为 `cancelled`，但
留下 `input_requests.state = 'pending'`。这会同时造成：

1. Human Inbox 继续显示一个已经不能回答的动作；
2. `resolveInputRequest` 直到读取 Task 后才报冲突；
3. `idx_one_pending_input_per_task` 永久占位；
4. Room archive、Human leave/remove 的 active-work 检查被幽灵 request 阻塞；
5. 旧通知 target 仍像可执行事项，直到点击时才失败。

这不是新增产品功能，而是修复 Task 与 InputRequest 两个 canonical projection 的
原子一致性。

## 5. 单一 owner 与数据合同

### Protocol

`InputRequest.state` 增加 `cancelled`。取消态必须同时带有：

- `cancelledAt`；
- `cancelledBy`；
- `cancellationReason`。

取消态不得带有 `answer/resolvedBy/resolvedAt`；resolved 态不得带取消证据；pending
态两类 terminal 证据都不得存在。

### Kernel / schema 38

Kernel schema 38 重建 `input_requests` CHECK 和字段，保留历史行、外键、排序索引和
“每个 Task 至多一个 pending request”局部唯一索引。

`TaskLifecycleService.cancelTask` 在同一 SQLite transaction 中：

1. 校验 actor、freshness、Task 状态；
2. 若存在 pending request，将其改成 cancelled 并写入 cancellation evidence；
3. 将 `cancelledInputRequestId` 写入同一 `task.cancelled` Room event payload；
4. 再返回 Task projection。

一次用户 mutation 仍只追加一个 canonical Room event。InputRequest 的 terminal 状态
是该 `task.cancelled` event 的显式派生投影，不生成第二个竞争事件。

### Client / Web

Human Inbox 继续只投影 `pending`。切换/轮询到 cancelled 后，已打开的回答对话框应
关闭或在提交时得到 canonical conflict；绝不把关闭窗口写成取消 request。typed
navigation 对 cancelled target 应返回 stale/unavailable，而不是打开可回答 UI。

## 6. 明确延期，不得暗中实现

以下能力没有足够的 Raft/Multica 源证据，也不是当前安全闭环所必需：

- 任意时间 TTL / daemon 自动 expire；
- Human dismiss 即取消业务请求；
- requester 在 Runtime 已结束后通过隐藏旁路取消；
- single/multiple choice、confirmation 或动态表单 schema；
- 自动选择另一个 Human responder。

若 Provider 原生协议或真实产品用例证明需要，必须另立 owner 合同、迁移与浏览器
证据，不能在 Notification UI 内推断业务状态。

## 7. Failure-first 与验收

必须先失败、再实现：

1. protocol 拒绝缺失/混合 terminal evidence；
2. schema 37 的 pending/resolved 历史迁移到 38 不丢数据；
3. `waiting_input` Task 取消后 request 为 cancelled，Room event 带精确 identity；
4. resolve cancelled request fail closed，重复 Task cancel 保持原幂等结果；
5. reopen Task 不复活旧 request，后续新 request 不受旧 partial unique index 阻塞；
6. Human Inbox、active-room/membership 检查不再把 cancelled 当 active；
7. desktop 与 `390x844` 真实浏览器覆盖取消前 badge/card、取消后消失、旧 target
   不可回答、reload 一致，console error/warn 为零。

发布证据仍按 `C/A/L/R/D` 分层。Raft 双边只覆盖发布前端的通知/弹层行为，不把本机
Kernel cancellation transaction 写成未知 Server 的逐行等同。

## 8. 施工与验收记录（2026-09-02）

- failure-first：protocol 先拒绝 `cancelled`，Kernel 的 Task 取消测试先证明
  `cancelledInputRequestId` 缺失；实现后覆盖 terminal evidence 互斥、37→38 历史迁移、
  同事务取消、重开不复活、旧 target fail closed 与 Human Inbox 自动收口。
- implementation：typed schema 独立归入 `packages/protocol/src/input-request.ts`；Kernel
  schema 38 重建 `input_requests` 并保留索引/外键；`TaskLifecycleService` 是唯一取消
  owner，Web 只轮询 pending projection 并关闭已经失效的回答弹层。
- automated evidence：`npm run check` 全绿；Web `167/167`、真实回调 `34/34`；
  `format:check`、`git diff --check`、产品构建均通过，生产依赖漏洞为 `0`。
- browser evidence：隔离真实浏览器从 Task 创建、`waiting_input`、通知卡片、打开“回答
  Agent”，到另一标签页关闭 Task；回答弹层自动消失、Human Inbox 变为 `0 项待处理`、
  Task 进入 `cancelled`，刷新后不复活，页面无 JSON/Network 错误。Chrome 完整门禁和
  Firefox 150.0.2 均通过 desktop 与 `390×844`；Firefox 还通过持久会话重载。
- deployment evidence：正式状态迁移前 active Task/InputRequest/Activation/Run/
  Runtime/lease/SOS 均为零，两个数据库一致性检查通过；schema 37 的 732 MB 一致性
  备份位于 `pre-input-request-v38-20260902T151550`。旧 PID `49255` 优雅退出，新 PID
  `59686` 在 `4173` 启动并迁移到 schema 38；Room/Message 数量与备份一致，正式新页
  保留 Room、DM、历史消息与四个本机 Runtime，console 日志为空。
- evidence level：`C/A/L/D` 完成；`R` 只覆盖 Raft 冻结前端可证明的通知中心、卡片、
  dialog、显式 dismiss 与 stale-target 行为，不声称复制未公开的 Raft Server 事务。
