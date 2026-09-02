# Room-first 核心架构

## 1. 产品边界

RAH OS 的第一等对象是 `Room`，不是任何 Provider Session。

```text
Workspace
└── Room
    ├── Membership
    │   ├── HumanParticipant
    │   └── AgentParticipant
    ├── Message / Thread
    ├── Task / Dependency / InputRequest / Decision
    ├── InboxItem / Activation
    ├── Artifact / Review
    └── RunAttempt
        ├── RuntimeProfile
        ├── opaque ProviderSessionRef
        └── workspace/worktree/process reference
```

RAH OS 统一：

- 谁参与、谁应该关注、谁获得执行权；
- 任务、依赖、输入请求和业务状态；
- 产物、证据、审查与验收；
- RunAttempt 的启动、租约、失败和终止。

RAH OS 不统一：

- Provider 的隐藏思维；
- 原生 plan/tool 卡片；
- CLI 私有命令和终端 UI；
- Provider transcript/history 格式。

## 2. 身份、Runtime 与 Model 解耦

| 对象                        | Owner              | 生命周期                 |
| --------------------------- | ------------------ | ------------------------ |
| AgentDefinition/Participant | Room Kernel        | 跨 Room/Run 稳定         |
| RuntimeProfileRevision      | AgentHost registry | 不可变版本               |
| ModelSelector               | policy/config      | 可按 Run 解析            |
| CredentialRef               | secret owner       | 可轮换，不写事件正文     |
| ProviderSessionRef          | Provider           | opaque、可失效           |
| RunAttempt                  | Room Kernel        | 一次执行尝试的不可变身份 |

Agent 不永久等同于一个 CLI/model。每个 RunAttempt 固定记录实际 RuntimeProfileRevision、model、effort、host 和 workspace。ProviderSessionRef 当前只由实际执行的 Computer/Host 私有保存，不进入 RunAttempt 或 Kernel；切换 Host、RuntimeProfile revision 或 WorkspaceMount revision 会自然 cold-start。切换模型或 CLI 会创建新 RunAttempt，但 identity、ACL、Task、Room cursor 和 Kernel memory 保持。Provider Session 可以被当作 cache 恢复，Room 不依靠它重建历史。

## 3. Canonical Ledger

每个成功 mutation 必须在同一事务中：

1. 更新当前 projection；
2. 追加一个带 Room 内单调序号的 domain event；
3. 派生必要 Inbox/Activation；
4. 写入可靠 Outbox。

事件至少具有：

- `eventId`
- `roomId`
- `roomSeq`
- `type`
- `actorId`
- `aggregateType/aggregateId`
- `payload`
- `idempotencyKey`
- `schemaVersion`
- `createdAt`

WebSocket、SSE、NATS、Redis 或进程内事件都不是顺序真相。断线恢复只认 Room continuation token；token 必须由成功消费方在下一次请求或显式 ack 时推进，不能因为服务端“已经返回”就假设客户端收到了响应。

## 4. Command 边界

MCP、CLI、HTTP 和未来 SDK 是同一 Application Service 的 facade：

```text
room_sync
message_post
task_create / task_claim / task_progress / task_submit
input_request / input_resolve
artifact_publish
review_submit
```

actor identity 必须来自认证上下文，工具参数不能指定或冒充 actor。上下文敏感 mutation 除 idempotency key 外还携带 `basedOnRoomSeq`；Room 已前进时 hold/reject 并返回缺失 delta，防止 Agent 在过期上下文上作出有效但错误的决定。

## 5. Task 与 Run 不等价

- Task 描述需要完成的业务工作。
- RunAttempt 描述某个 RuntimeProfile 的一次执行。
- CLI exit 0 只结束 RunAttempt，不完成 Task。
- `task.submit` 表示执行者交付审查。
- `task.complete` 当前只能由 Task creator Human 执行；声明 reviewer 时还必须先具备当前 submission 的全部 approved Review。

## 6. Artifact 与 Review

Artifact 必须显式发布并携带 hash、MIME/kind、producer、Run/Task provenance 和生命周期。裸文件路径不是 artifact truth。当前本机 Agent 已可用 Activation credential 为自己持有的 in-progress Task 显式发布文件；`task.submit` 原子把仍未归属的完成文件绑定到提交 Thread message、冻结进 TaskSubmission v2 digest，并由 Room Files 投影同一 Message owner。

Review v1 已是独立对象，固定关联不可变 TaskSubmission digest、reviewer、evidence summary 和 disposition；`changes_requested` 会重开 Task，新 submission 不继承旧 Review。TaskSubmission v2 已关联 canonical Artifact references，但仍未冻结 Git diff、base/head、构建日志或 verifier result；Reviewer 可以验收明确提交的 Message/Artifact evidence，不能把变化中的全局 Git 状态当作真相。协议见 [ADR-0021](../adr/0021-frozen-task-submission-and-canonical-review.md)。

## 7. Runtime 与业务协议边界

所有 CLI 先满足不解析 transcript 的 L0 Worker contract。ACP/app-server/session resume/live input 是可选 L1；thinking/tool/usage 是可丢失 L2 observation。详见 [Runtime Adapter 与观察平面](./runtime-adapter-and-observation.zh-CN.md)。

所有 UI 都是 Room client。Room Kernel service 与 AgentHost daemon 独立于浏览器、PWA 或桌面窗口生命周期；本地单进程部署也不能合并它们的状态 owner。详见 [Client、Daemon 与部署边界](./client-daemon-and-deployment.zh-CN.md)。

## 8. 外部经验的采用边界

- Matrix：Room event、sync cursor 与独立 push plane。
- Raft：长期 Agent identity、content-free wake、freshness hold 和 delivery proof。
- OpenClaw：常驻 Gateway、session lane、durable delivery 和实用文件 memory。
- AutoGen Core：消息驱动 runtime、topic subscription、virtual agent。
- LiveKit Agents：standby worker、显式 dispatch、job isolation。
- LangGraph/Temporal：durable queue、lease、checkpoint 和无资源等待。
- Multica：持久 Agent identity、Issue/Task(run) 分离、daemon claim、触发合并和多 protocol-family adapter。
- Commonly/Letta：runtime-agnostic memory 与跨 conversation memory。
- Patchwork/Kandev：ACP-first 的多 CLI Room/Kanban/worktree。
- AHP：host-authoritative snapshot、server sequence、pure reducer 和多客户端 reconciliation。
- A2A：远程 opaque Agent 的 Task/Artifact connector。

这些项目提供约束和模式，不成为 RAH OS 的 canonical owner。
