# Room-first 核心架构

当前发布范围以[单 Human 主线与多人备选项目](../product/single-human-mainline-and-multi-human-backlog.zh-CN.md)为准。
多 Human 加入、协作及差异化浏览/加入限制延期，不作为首版 Raft 对齐的阻塞项；
保留本地认证、Agent 参与/执行权限和私有记忆隔离。下方历史计划不改变此范围。

当前公开阅读增量：`collaboration-policy` 统一 Human 当前公开阅读资格，
`room.preview` 提供有界正文；Search、精确定位、附件与已关注 Thread Activity 共用该资格。
完整 sync/ACK、Task 写入、上传和 Agent execution scope 仍要求成员资格。
下方“仅元数据／正文权限不变”描述的是先前切片；当前边界与未完成事项见
[公开频道设计续节](../design/public-channel-discovery-and-join.md#2026-09-07-continuation-public-content-and-thread-attention)。

2026-09-07 公开频道发现与本人加入：仅开放当前 Workspace Human 的公开频道元数据目录，
加入事务复用 membership、Room event 与 Outbox。加入不等于已读、不创建 Inbox/Activation；
退出后的旧加入意图不能复活成员身份。所有正文读取仍使用原成员权限。
这是[公开频道合同](../design/public-channel-discovery-and-join.md)的第一阶段，非完整公共阅读。

Agent 删除的 Task 生命周期：Kernel 在终止 fence 成立后解除所有状态任务的该 Agent 负责人/认领，保留 workflow/state；删除不等于关闭或完成。历史 tombstone 负责人依据原删除 Room event 幂等补齐，详见[任务身份合同](../audits/2026-09-20-deleted-agent-task-identity.zh-CN.md)。

身份合同更新：账号保留大小写，仅存活身份占用；显示名可重复，账号与显示名均不能作为持久身份键。`agentId` 为独立 Agent 身份，`participantId` 保持 Room Principal 关联；旧 `agentDefinitionId` 只在兼容读取边界接受。消息提及在写入事务固定身份，删除/重建不改变旧消息指向。见[迁移与证据](../audits/2026-09-20-agent-account-identity.zh-CN.md)。

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

同名重建不复用身份：Kernel 为新 Agent 分配独立 AgentDefinition/Participant，
显示名允许与 tombstone 重复；若创建请求的 handle 被 tombstone 占用，分配
唯一数字后缀，保留旧 handle 与历史引用不变。DM 始终按 Participant 配对。
参见[删除身份与同名重建证据](../audits/2026-09-19-deleted-agent-message-ui.zh-CN.md)。

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

Room 生命周期由 Kernel 单一 owner 持有。archive 是带 Room event 的可逆只读状态；永久删除只允许 manager Human 对普通 Channel 执行，并要求最新 Room cursor 与无活动工作。永久删除不写一个随后随 Room 一起消失的事件，而在 Room 外持有幂等删除回执；完整 canonical 引用图在一个事务中清理，本地文件字节由提交后的 durable GC receipt 续收。UI、HTTP、Provider 或文件系统都不能单独宣称 Room 已删除。

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

### 本地工作台默认频道（2026-09-12）

正式 bootstrap 通过既有 Kernel 创建命令补齐公共 `all`，保留旧默认频道和全部历史，
默认入口指向 all；显式 Room 深链仍优先。Room lifecycle owner 保护其保留 slug，
拒绝删除、归档、离开、改名和私密化。该规则不增加 Agent 执行成员资格。
[来源、迁移与验证边界](../audits/2026-09-12-sidebar-context-menu-parity.zh-CN.md)。

## Agent 身份删除（2026-09-13）

Agent 删除仍使用 tombstoned 意图，由 Kernel `agent-deletion.ts` 将一次确认分成持久删除请求与终止证明后的最终事务。disabled 是执行停用投影，`agent.deletion_requested` 是恢复事实；不是让 UI 维护第二队列。请求后禁止重新启用/配置和旧 Worker 回写。未证明退出的进程、活动 lease/placement 或排他操作保持阻断，Daemon 只重试同一 Kernel 完成器。

最终事务取消待执行工作与提醒，解除未完成任务的该 Agent 归属（审核中保持审核状态），清理无效输入/重分配、成员关系和 Host 授权；保留 Inbox 未读事实、Room/Task 历史及本地文件。归档 Room 仅允许经持久删除请求校验的有限生命周期清理事件，普通写入仍拒绝。Raft 中央服务器清理顺序未知，以上属于显式本地适配。来源、测试及部署见[一次确认删除审查](../audits/2026-09-13-agent-deletion-cascade.zh-CN.md)。

系统频道 #all 的隐藏为 Kernel 工作空间策略，不能复用普通频道 private/archive。
`rooms.system_hidden` 与 control Room 的 `workspace.system_channel_visibility_changed`
事件在一个事务内更改，读取/发现/发送路径统一执行该策略；恢复需要 control Room
管理权限，不依赖隐藏频道访问。隐藏不删除 Room 成员、历史或私有记忆，且需无活动工作。
具体边界见[系统频道可见性审计](../audits/2026-09-13-channel-settings-and-system-visibility.zh-CN.md)。
