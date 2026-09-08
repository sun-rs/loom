# Core 模块边界与源码规模 Ratchet

2026-09-08：Task 弹窗的 Human `task.history` 经过 HumanApplicationPort/SDK 读取。
`human-task-history.ts` 负责 Human 认证、Room 成员和 Task 归属校验；
`task-history-projection.ts` 从既有 Worker 读取实现抽出，双方共用同一 canonical
生命周期查询、冻结 cursor 和安全字段投影；`bounded-read-rows.ts` 保留完整 UTF-8
行与响应体积上限。未新增 Task 状态机、事件、表或执行权限。

当前公开阅读增量：`collaboration-policy` 统一 Human 当前公开阅读资格，
`room.preview` 提供有界正文；Search、精确定位、附件与已关注 Thread Activity 共用该资格。
完整 sync/ACK、Task 写入、上传和 Agent execution scope 仍要求成员资格。
下方“仅元数据／正文权限不变”描述的是先前切片；当前边界与未完成事项见
[公开频道设计续节](../design/public-channel-discovery-and-join.md#2026-09-07-continuation-public-content-and-thread-attention)。

2026-09-07：public-channel.ts 的 HumanPublicChannels 通过现有 Human command factory
组合到 Kernel；collaboration-policy.ts 集中当前 Workspace/public Channel 资格。
HumanApplicationPort、HTTP 和 SDK 只委派。没有第二套 membership、通知队列或历史 cursor，
没有放宽 RoomKernel 大文件上限。协议错误响应 schema 原样提取到 error-response.ts，
保留原导出并使 protocol index 继续满足既有体积门禁。详见[增量设计](../design/public-channel-discovery-and-join.md)。

状态：Implemented slice 2（2026-08-26）

## 为什么现在拆分

Task Coordination v1 收口后，`RoomKernel` 同时承载认证、Room、Task、Inbox、Activation、Runtime 与 Placement，协议入口也集中声明了所有领域 schema。继续直接加入 Workspace、Thread、Artifact 和 Review，会让代码审查、owner 判断与回归定位越来越困难。

拆分的目标不是追求小文件，而是让每个业务不变量只有一个 owner，并让新增领域能力无法继续无上限地堆进入口文件。

## 不变量

1. SQLite Room state 仍是唯一业务真相；拆分不得建立第二个 Task store、缓存状态机或 UI truth。
2. `RoomKernel` 仍是当前公开 facade；每个 mutation 只能有一个明确的 transaction owner。协作权限/freshness/命令由 `CollaborationService` 实现，Provider 运行轨迹由 `RuntimeTrajectoryService` 实现，Room event 与 Inbox/Activation/Outbox 派生由 transaction-scoped `RoomEventWriter` 实现，不复制第二套 owner。
3. 领域 schema 可以从协议入口移到领域模块，但 `@rah-os/protocol` 的公开导出保持兼容。
4. 投影模块只能把 canonical row 转为协议对象。它可以执行构成该投影所需的只读查询，不能提交事务或改变业务状态。
5. 通用 SQLite row decoder 和 canonical digest 属于基础机制；领域模块复用它们，不复制各自的宽松解析器或摘要算法。
6. 源码规模 ratchet 是上限，不是目标。只能通过提取 owner-aligned 模块逐步下调；不得为了加入功能而直接放宽。确需放宽时必须同时更新架构证据并说明为什么现有 owner 仍然正确。

## Slice 2 的落地边界

```text
@rah-os/protocol/src/index.ts     public compatibility surface
  ├── room-event.ts               canonical Room event envelope
  ├── client-collaboration.ts     strict Human Client collaboration contract
  ├── client-health.ts            versioned v1/v2 health capability contract
  ├── common.ts                   internal identifier/time primitives
  ├── collaboration.ts            Workspace/Room/Role/Message/Thread schemas
  └── task.ts                     Task state + projection validation

@rah-os/kernel/src/room-kernel.ts public facade + command transaction owner
  ├── human-application-port.ts   frozen direct/transport Human capability whitelist
  ├── collaboration-service.ts    Workspace/Room/Role/Message/Thread command/query owner
  ├── room-event-writer.ts        event + Inbox/Activation/Outbox atomic derivation
  ├── collaboration-policy.ts     membership/manager/Human owner invariants
  ├── collaboration-projection.ts canonical collaboration read projections
  ├── schema.ts                   schema v11 canonical table declarations
  ├── context-manifest.ts         ContextManifest canonical digest、持久化与读回校验
  ├── run-attempt-projection.ts   RunAttempt + Placement + ContextManifest 只读投影
  ├── task-anchor.ts              Task Message/Thread projection + fail-closed v9 migration
  ├── task-projection.ts          canonical Task read projection only
  ├── capacity-policy.ts          pure capacity identity/limit validation
  ├── sqlite-row.ts               strict SQLite value decoding
  └── canonical-digest.ts         one canonical serialization/digest rule

@rah-os/daemon/src/daemon-application.ts composition root only
  ├── registry-runtime-recovery.ts immutable multi-registry recovery routing
  └── runtime-offer-publisher.ts   lease refresh + redacted Offer publication
```

Slice 2 已把现有 Room collaboration command 与 event derivation 按 owner 提取；纯 Capacity identity/limit policy 也已独立。Activation/WakeHint schema 已进入 `activation.ts`，运行轨迹的 Host/代际围栏、事务、持久化和 ACL 分页由 `RuntimeTrajectoryService` 单独拥有；`RoomKernel` 只保留稳定 facade。Actor/Host credential 数据库认证则回到 `auth.ts` 的单一 owner。Task command 仍有意不搬迁：它目前深度依赖 claim lease、Worker fencing、dependency、InputRequest 与 Run completion proof；在没有先定义窄 transaction context 前，机械搬到新 class 只会产生隐藏的第二 owner 或 callback soup。

## 自动门禁

`packages/core/test/source-boundary.test.ts` 固定当前第一轮边界：

- `packages/kernel/src/room-kernel.ts` 不得超过 6,925 行；
- `packages/protocol/src/index.ts` 不得超过 1,800 行。

`packages/daemon/test/source-boundary.test.ts` 进一步约束：

- `packages/daemon/src/daemon-application.ts` 不得超过 800 行。

config v4 引入多 participant、多 profile 和 Placement runtime resolver 后，恢复路由与 RuntimeOffer lease publisher 已从 composition root 提取；后续控制面或 Workspace 能力不能重新堆入该文件。

门禁只防回退，不代表两个文件已经达到最终大小。当前 `RoomKernel` 已继续保持在 6,925 行以内，protocol entry 通过 `room-event.ts`、`client-collaboration.ts` 与 `activation.ts` 保持在 1,800 行以内；下一轮加入新 aggregate 前仍应同步降低阈值。

## 下一轮拆分判据

只有同时满足以下条件，Task command 才能移出 `RoomKernel`：

- 一个 command 仍只开启一次 `BEGIN IMMEDIATE`；
- 权限、freshness、idempotency replay 与 event append 不被复制；
- Task mutation 与派生 Inbox/Activation 在同一事务内完成；
- `RoomKernel` 只做稳定 facade delegation，不保留另一份 Task 分支逻辑；
- 原有跨连接竞争、重启恢复和 Worker fencing 测试无需改写业务预期。

因此后续优先建立显式的 kernel transaction context，再按 aggregate 迁移命令；不能按文件行数把相互依赖的代码随机切开。
