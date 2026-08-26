# Core 模块边界与源码规模 Ratchet

状态：Implemented slice 1（2026-08-26）

## 为什么现在拆分

Task Coordination v1 收口后，`RoomKernel` 同时承载认证、Room、Task、Inbox、Activation、Runtime 与 Placement，协议入口也集中声明了所有领域 schema。继续直接加入 Workspace、Thread、Artifact 和 Review，会让代码审查、owner 判断与回归定位越来越困难。

拆分的目标不是追求小文件，而是让每个业务不变量只有一个 owner，并让新增领域能力无法继续无上限地堆进入口文件。

## 不变量

1. SQLite Room state 仍是唯一业务真相；拆分不得建立第二个 Task store、缓存状态机或 UI truth。
2. `RoomKernel` 仍是当前公开 facade，并持有命令事务、权限、freshness、事件追加与 Inbox/Activation 派生。
3. 领域 schema 可以从协议入口移到领域模块，但 `@rah-os/protocol` 的公开导出保持兼容。
4. 投影模块只能把 canonical row 转为协议对象。它可以执行构成该投影所需的只读查询，不能提交事务或改变业务状态。
5. 通用 SQLite row decoder 和 canonical digest 属于基础机制；领域模块复用它们，不复制各自的宽松解析器或摘要算法。
6. 源码规模 ratchet 是上限，不是目标。只能通过提取 owner-aligned 模块逐步下调；不得为了加入功能而直接放宽。确需放宽时必须同时更新架构证据并说明为什么现有 owner 仍然正确。

## Slice 1 的落地边界

```text
@rah-os/protocol/src/index.ts     public compatibility surface
  ├── common.ts                   internal identifier/time primitives
  └── task.ts                     Task state + projection validation

@rah-os/kernel/src/room-kernel.ts public facade + command transaction owner
  ├── task-projection.ts          canonical Task read projection only
  ├── sqlite-row.ts               strict SQLite value decoding
  └── canonical-digest.ts         one canonical serialization/digest rule
```

这一刀有意不搬迁 Task command。Task command 目前深度依赖 membership、causal freshness、event append、attention 派生和同一 SQLite transaction；在没有先定义窄 transaction context 前，机械搬到一个新 class 只会产生隐藏的第二 owner 或 callback soup。

## 自动门禁

`packages/core/test/source-boundary.test.ts` 固定当前第一轮边界：

- `packages/kernel/src/room-kernel.ts` 不得超过 6,925 行；
- `packages/protocol/src/index.ts` 不得超过 1,800 行。

门禁只防回退，不代表两个文件已经达到最终大小。下一轮加入新 aggregate 前，应优先继续提取现有聚合的 command module，并同步降低阈值。

## 下一轮拆分判据

只有同时满足以下条件，Task command 才能移出 `RoomKernel`：

- 一个 command 仍只开启一次 `BEGIN IMMEDIATE`；
- 权限、freshness、idempotency replay 与 event append 不被复制；
- Task mutation 与派生 Inbox/Activation 在同一事务内完成；
- `RoomKernel` 只做稳定 facade delegation，不保留另一份 Task 分支逻辑；
- 原有跨连接竞争、重启恢复和 Worker fencing 测试无需改写业务预期。

因此后续优先建立显式的 kernel transaction context，再按 aggregate 迁移命令；不能按文件行数把相互依赖的代码随机切开。
