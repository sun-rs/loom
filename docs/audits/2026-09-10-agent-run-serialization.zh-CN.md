# 多 Agent 运行为何完全串行：工作区独占租约

日期：2026-09-10。来源：核心链验收第 1 次运行的现场
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-core-chain-XenNDU`。只读取证，未改任何代码。

## 现象

24 次 RunAttempt 分属三个不同 Agent，**完全串行**，每次都在上一次结束后 3–5 毫秒开始，从不重叠。
三个 Activation 在**同一毫秒**入队（`2026-09-09T16:24:02.296Z`），说明工作本身同时可调度。

## 原因：不是并发上限，是工作区独占

排除了常见嫌疑：`MultiLaneAgentHost` 确实起了 3 条 lane 并以 `Promise.allSettled` 并行；
`lane_busy` 是**按参与者**的，正是 ADR-0009 的"一个参与者一条 lane"；
`agent_exclusive_operation_leases` 全表为空；SQLite 事务是毫秒级。

真正的约束是 placement planner 的工作区硬过滤（`placement-planner.ts:555-579`）：
候选 offer 必须挑到一个不在 `busyWorkspaceMountRevisionIds` 里的挂载点，挑不到就 `workspace_busy` 硬拒。
而这个忙集合是**全局的**（`room-kernel.ts:5832-5845`）：所有 `workspace_mode = 'in_place'` 的租约，
外加所有尚未拿到终止证明的 in_place placement。数据库还有独立约束
`idx_one_in_place_workspace_lease ON workspace_leases(workspace_mount_revision_id) WHERE workspace_mode = 'in_place'`。

账本证据：24 个 placement 共享**同一个** `workspace_mount_revision_id = local-workbench-mount-7209122e1fb036bc`，
三个 Agent 各有独立 offer 与 profile，每个 offer 的 `maxConcurrent: 1` 从未成为瓶颈（各自本来也只有一次预留），
host 的 `maxConcurrent: 3` 在每次 hold 时只用掉 1。**那个唯一的挂载点就是互斥量。**

结构性事实：daemon 配置 v4 的工作区模式是 `z.literal("in_place")`（`config.ts:185`），
且只有一个 `workspace` 块，所以每个 offer 发布的都是同一个挂载描述符。**在 v4 下全局串行是结构决定的，不是这次运行的偶然。**

## 定性：RAH 有意为之，但与 Raft 分歧

架构文档写明并行应当来自 worktree，而 worktree **尚未实现**：
`docs/architecture/runtime-registry-and-multi-lane-scheduling.zh-CN.md:591` 的 R4 仍是待办
（"durable workspace lease；in-place exclusive 与 worktree parallel"），`:506` 明说 v4"只支持固定 in_place cwd"。

上游 Raft **并行**，且没有工作区互斥这一层。提取物证据：`AgentStartCoordinator`
（`starting`/`queuedByAgent`/`activeStarts`/`maxConcurrentStarts`/`minStartIntervalMs`），
默认 `DEFAULT_MAX_CONCURRENT_AGENT_STARTS = 5`、`DEFAULT_AGENT_START_INTERVAL_MS = 500`——
它限的是**同时启动数**而不是同时运行数；能力快照里 `runningAgents` 是复数集合；
全 bundle 检索不到任何 `workspaceLock`/`exclusiveLock`/workspace-busy 词汇，`worktree` 命中只是 git 路径解析与提示词。

差异的根源在于工作区模型：Raft 的 Agent 各有自己的工作区，所以不需要互斥；
RAH 把所有 Agent 指向同一个仓库 cwd，因此必须互斥。

## 代价与一个被忽略的细节

代价：Room 里有三个 Agent 成员时，每条 Human 消息唤醒全部三个，耗时是三者之**和**而非最大值。
这直接压制用户的头号场景（一个 Room 内多 Agent 讨论与互相提及）。

被忽略的细节：**租约是无条件获取的**。一次纯讨论、不碰任何文件的回合，同样会占住整个挂载点的独占租约。
而多 Agent 讨论恰恰是最需要并行、最不需要独占的场景。

## 若要修，改的是工作区建模而不是调度器

- `packages/daemon/src/config.ts:182-190`：允许 `in_place` 之外的工作区模式与按 lane 的挂载描述符。
- `packages/daemon/src/local-workbench-bootstrap.ts:393-416`、`daemon-application.ts:406-414`：
  每条 lane 发布不同的 `workspaceMountRevisionId`，而不是共享一个。
- `placement-planner.ts` 与 `room-kernel.ts` **不需要放松**：忙集合本来就只收 `in_place`，
  唯一索引本来就允许 worktree/ephemeral 并行。**直接放松忙过滤是错的修法**——那会让多个真实 CLI 同时写同一个 cwd。

## 并行化必须保住的不变量

1. 一个 in_place 挂载点只有一个写者。并行必须来自不同挂载点，不是来自放松锁。
2. 一个参与者一条执行 lane（ADR-0009），由 `lane_busy` 与 per-offer 容量保证，工作区修法不触碰它。
3. 独占操作围栏（记忆重置、任务改派）仍须挡住该 Agent 的调度。
4. 释放资源前必须有终止证明，否则孤儿进程可能与新 Run 共享挂载点。
5. **行为变化**：现在因为串行，后一个 Agent 的 Activation 范围天然包含了前一个的回复
   （账本里可见 `from_seq 97 → to_seq 116`）。并行之后，同一轮内 Agent 看到彼此回复的机会变少。
   这不是数据损坏，但它是串行今天在悄悄换来的东西，改之前要想清楚。

## 待用户裁决

这是产品决定，不是纯技术修复：三个 Agent 是应当各自在独立 git worktree 里并行工作（快、隔离、但看不到彼此同轮的改动），
还是继续共享同一个仓库目录串行（慢、但所有人看到同一份工作树）。取证到此为止，不做实现。
