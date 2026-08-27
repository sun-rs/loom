# ADR-0012：Workspace、Room Role 与 Thread 最小边界

状态：Accepted / P1–P3 implemented with local Fake Agents（2026-08-26）

## 背景

当前 Room ledger、membership、message 与 Task 已经是 canonical state，但 Room 只有 `id/slug/name`，membership 没有角色，message 没有 thread。与此同时 Placement 已携带 `workspaceDefinitionId/workspaceMountRevisionId/workspaceMountDigest`，却尚无 Kernel-owned Workspace aggregate。若直接在 UI 或 daemon config 中补齐这些概念，会再次形成第二套权限、Thread 或 Workspace 真相。

本 ADR 先冻结最小业务含义，使 daemon v4、Human API 和 schema v7/v8 面向同一模型；它不把尚未实现的数据库/API 宣称为已完成。

## 决策

### 1. Workspace 是 Room 的上级业务边界

最小 canonical projection 为：

```ts
type Workspace = {
  workspaceId: string;
  controlRoomId?: string;
  slug: string;
  name: string;
  state: "active" | "archived";
  createdAt: string;
  archivedAt?: string;
};
```

- 每个 Room 必须且只能属于一个 Workspace；Task、Thread、Artifact 与 Review 通过 Room 归属 Workspace，不各自维护可漂移的 workspace 字段。
- `WorkspaceDefinition` 的 canonical identity 归 Kernel。Host-local path、worktree path 与 mount revision 归 Runtime Registry；RuntimeOffer 只公开 redacted mount descriptor，Placement 冻结 definition/mount/digest。
- daemon v4 可以配置 workspace mount identity 来执行 Placement，但该 identity 仍是 provisional startup-owned binding，尚未与本 ADR 的业务 Workspace 建立 canonical WorkspaceDefinition/mount mapping。
- 每个经 Human API 创建的新 Workspace 必须在同一事务内创建唯一 `control` Room。Workspace 的管理 authority 来自这个 control Room 的 `owner/admin`，不另建 `workspace_memberships` 或第二套 ACL；`Workspace.controlRoomId` 明确公开该 causal scope。legacy Workspace 可以没有 control Room，因此只能 discovery，不能经 managed create API 添加 Room。
- 创建普通 Room 的命令在 control Room 记 `workspace.room_created`，并以 `basedOnControlRoomSeq` 做 freshness；新 Room 自身仍以 `room.created` 作为 ledger 首事件。两者同事务提交。

### 2. RoomKind 只表达稳定业务语义

初版 Room kind 固定为：

```ts
type RoomKind = "channel" | "direct" | "control";
```

- `channel`：Human 与多个 Agent 的普通协作聊天室，可承载 Message、Task、Thread、Artifact 和 Review。
- `direct`：固定成员集合的直接对话；初版不支持退出后重新解释历史成员，也不引入单独 Session owner。
- `control`：AgentDefinition、ExecutionPolicy、Host/Capacity 等管理事件的 causal scope；它仍使用同一 Room ledger，不创建全局旁路账本。
- Room archive 只禁止新的业务 mutation，不删除 ledger、Task 或 Artifact。

### 3. MembershipRole 是 Room 权限的唯一来源

初版角色固定为：

```ts
type MembershipRole = "owner" | "admin" | "member";
```

- 创建 Workspace 的 Human 成为 Workspace owner；创建 Room 的 Human 成为 Room owner。
- `owner/admin` 才能修改 Room 设置、增删成员、改变角色和管理 Room-scoped Agent/Policy。
- AgentDefinition/ExecutionPolicy 只能在 `control` Room 中由 Human owner/admin 修改；AgentDefinition 引用的 ExecutionPolicy revision 必须属于同一 control Room。
- `member` 可以读取 Room，并按业务命令权限发送 Message、创建/处理 Task；Agent 初始只能作为 member 加入。
- owner/admin 初版必须是 Human。系统 principal 只执行显式 Kernel 派生，不因 `service` kind 自动获得管理员权限。
- 最后一个 owner 不得被删除或降级。ACL 判断必须在同一 Kernel transaction 内完成，Client/UI 不缓存可写权限真相。

### 4. Thread 是 Room 内的业务对象，不是 Provider Session

最小 projection 为：

```ts
type Thread = {
  threadId: string;
  roomId: string;
  rootMessageId: string;
  createdBy: string;
  replyCount: number;
  createdAt: string;
  lastReplyAt?: string;
};
```

- Thread root 必须是同 Room 的 Message，且一个 root 最多一个 Thread；reply Message 引用 `threadId`。
- Thread 继承 Room membership/ACL，不拥有独立成员表、cursor 或 session。
- `thread_subscription` 只派生 Inbox/Activation；订阅或 CLI session 都不能成为 Thread truth。
- 删除、编辑、reaction、bookmark 和 per-thread role 不进入首版。

### 5. 迁移必须可证明

schema v7 迁移旧数据时：

- 建立一个明确标记的 legacy Workspace；
- 旧 Room 迁移为 `channel`；
- 从每个 Room 的首个 `room.created` event actor 恢复 owner，其余旧成员迁移为 member；无法证明 Human owner 时 fail closed，而不是任意提升成员；
- 旧 Message 保持无 Thread；不得从正文、mention 或 CLI transcript 猜测回复关系。

## 分阶段门禁

1. **P0（已完成）**：冻结对象、owner 与迁移规则；daemon v4 只能消费 workspace mount identity。
2. **P1（已完成，schema v7）**：严格 Workspace、RoomKind、MembershipRole、Thread protocol schemas；Room→Workspace、role、Thread/root/reply 复合 FK；可证明 Human owner 的 legacy migration，以及无法证明时的 fail-closed gate。新 Room 目前进入显式 legacy Workspace，只有 Human 可以创建并成为 owner。
3. **P2（已完成，Kernel/API v2）**：Workspace/Room discovery、成员读取/添加/移除/角色管理、Message 有界分页读取/发送、Thread 读取/创建/回复；全部要求认证，写命令要求 freshness 与 idempotency。owner/admin 权限与最后 Human owner 不变量在同一 transaction 内校验；有 active Task/InputRequest/Activation/RuntimeProcess 的成员不能被静默移除。跨 Room root/thread 引用、跨命令幂等键复用、stale role mutation 均 fail closed。原 Client API v1 保持兼容窄 surface，不以扩展 strict capability 的方式静默破坏旧客户端。
4. **P3a（已完成，schema v8/API v3）**：Human 通过 `HumanApplicationPort` 或 HTTP v3 原子创建 Workspace + 唯一 control Room，再基于 control Room 权限、freshness 与幂等键创建普通 channel；v1/v2 surface 保持不变。
5. **P3b（已完成，Workspace-scoped Agent directory）**：Human API 的 Agent list 必须指定当前 Workspace 的 `controlRoomId`，且只能发现该 control Room 中非 tombstoned 的现有 AgentDefinition；onboard command 接受 `agentDefinitionId` 而不接受 caller-selected `participantId`。Kernel 除了校验 Human 对 definition control Room 的访问权，还必须证明 definition control Room 与目标 Room 属于同一 Workspace，再把 enabled Agent 以普通 member 加入目标 Room。隐式跨 Workspace 复用被禁止；未来如需复用，必须新增显式 grant，而不能放宽这个不变量。Agent provisioning/editor/lifecycle 不进入这一 slice。
6. **P3c（已完成，local Fake Agent E2）**：Human 经 HTTP v3 创建 Workspace/Room、从真实 managed Workspace control Room catalog 加入两个 Agent、写入 Message/Thread 上下文并创建一个开放 Task；两个 placement-managed daemon lane 同步完整上下文并原子竞争，单赢家提交、Human 完成；daemon 重启后原 consumer 从 durable ack cursor 恢复至 `task.completed`。业务判定不读取进程输出或 JSONL。

P3 完成只证明 local Fake Agent 的 canonical business flow，不等于生产浏览器、真实 mixed CLI certification、Workspace archive 或 canonical WorkspaceDefinition/mount control object 已完成。前端仍不得自行实现 Workspace/role/thread 命令状态。

## 后果

这套边界保持 Room 为最小同步与协作单元，同时给 Workspace 管理和 Thread 信息架构留下 canonical 位置。代价是 schema migration、显式 control Room 与权限收紧；旧的“任意 member 可 addMember”行为已经由 P2 的 owner/admin policy 替换并受兼容测试保护。
