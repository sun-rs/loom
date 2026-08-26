# ADR-0012：Workspace、Room Role 与 Thread 最小边界

状态：Accepted / domain vocabulary frozen / protocol schema 与 Kernel migration pending（2026-08-26）

## 背景

当前 Room ledger、membership、message 与 Task 已经是 canonical state，但 Room 只有 `id/slug/name`，membership 没有角色，message 没有 thread。与此同时 Placement 已携带 `workspaceDefinitionId/workspaceMountRevisionId/workspaceMountDigest`，却尚无 Kernel-owned Workspace aggregate。若直接在 UI 或 daemon config 中补齐这些概念，会再次形成第二套权限、Thread 或 Workspace 真相。

本 ADR 先冻结最小业务含义，使 daemon v4、Human Client 和后续 schema v7 面向同一模型；它不把尚未实现的数据库/API 宣称为已完成。

## 决策

### 1. Workspace 是 Room 的上级业务边界

最小 canonical projection 为：

```ts
type Workspace = {
  workspaceId: string;
  slug: string;
  name: string;
  state: "active" | "archived";
  createdAt: string;
  archivedAt?: string;
};
```

- 每个 Room 必须且只能属于一个 Workspace；Task、Thread、Artifact 与 Review 通过 Room 归属 Workspace，不各自维护可漂移的 workspace 字段。
- `WorkspaceDefinition` 的 canonical identity 归 Kernel。Host-local path、worktree path 与 mount revision 归 Runtime Registry；RuntimeOffer 只公开 redacted mount descriptor，Placement 冻结 definition/mount/digest。
- daemon v4 可以配置现有 canonical workspace mount identity 来执行 Placement，但在 schema v7 落地前这仍是 provisional startup-owned binding，不能创建或修改 Workspace。

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

1. **P0（本 ADR）**：冻结对象、owner 与迁移规则；daemon v4 只能消费 workspace mount identity。
2. **P1（schema v7）**：Workspace、RoomKind、MembershipRole、Thread/Message FK 与 legacy migration 测试。
3. **P2（Kernel/API）**：Workspace/Room discovery、角色管理、message send、thread create/reply；全部要求认证、freshness 与 idempotency。
4. **P3（Client E2）**：Human 创建 Workspace/Room、加入两个 Agent、发消息/Task、Thread 回复，断线重连后完全由 canonical sync 恢复。

P1–P3 未完成前，前端不得自行实现 Workspace/role/thread 状态，daemon config 也不得被描述为 Workspace 管理面。

## 后果

这套边界保持 Room 为最小同步与协作单元，同时给 Workspace 管理和 Thread 信息架构留下 canonical 位置。代价是必须进行一次显式 schema migration 与权限收紧；现有“任意 member 可 addMember”的行为将在 P2 被替换，并需要兼容测试。
