# ADR-0023：Agent 私有 Memory、App Inbox、维护执行与安全 Reset

状态：Accepted（workspace/cleaner/Run receipt/本机 Human control/reset E2；maintenance lane/remote handoff 未完成）\
日期：2026-08-30

## 背景

授权提取的 Raft Computer 1.0.18 明确区分两种队列：聊天/Task 由 Server delivery 驱动；`system.cleaner/memory_size_hint` 属于 Computer 本地、per-Agent、typed App Inbox，没有 sender、Room/message identity 或 Server cursor。Raft 可向存活 Runtime 写 content-free notice，也可用 restart snapshot 唤醒 idle Agent；其 workspace reset 实现却只是对 Agent data directory 执行递归强删，没有在该方法内证明 Runtime 已停止。

RAH OS 必须吸收成熟对象和交互语义，同时保持 Room-first canonical truth、单 Agent execution lane、terminal proof 与远程 Computer 边界。不能为了快速接通 cleaner 而伪造 Human/System Room Message，也不能照抄缺少栅栏的破坏性删除。

## 决策

### 1. 三个 owner，禁止互相代替

1. `AgentMemoryWorkspace` 由实际执行该 Agent 的 Computer 持有，以稳定 `participantId` 的 opaque key 建目录；Room、模型、effort、RuntimeProfile 和 Provider session 都不参与 owner key。
2. `AgentAppInbox` 由同一 Computer 持有。其 item 必须通过 app/class registry 校验，且不能携带 Room sender/message/cursor 字段。`transient` item 不跨 Computer 服务重启恢复，`durable` item 才可进入 owner-private storage。
3. Room/Task/InputRequest/Artifact 继续由 Kernel 持有。App Inbox item、cleaner 执行或 maintenance receipt 均不能自行创建或修改这些业务对象。

### 2. Cleaner 复用 Raft 合同

- `MEMORY.md` 默认阈值 64 KiB；配置 interval、threshold 和 revision 使用 Raft 1.0.18 的上下界。
- 配置 revision 独立于 AgentDefinition revision。Computer 在 Agent home 外的私有 `.cleaner-config.sqlite` 保存三个字段的 override；使用 SQLite 事务 `expectedRevision` 条件更新，unset 恢复默认。数据库并非 Raft Server 源码移植，而是其配置合同的本机持久化适配。不保存任何记忆正文，不新增模型上下文。
- Human 配置读写复用 workspace Agent-management ACL；Run-scoped `rah app config --app system.cleaner` 先读取再条件更新，只能操作本 Agent，409 不自动重试。`enabled=false` 仅停止大小提醒，不关闭记忆读写。配置更改不发 Room event、不创建 Task、不启动模型。
- memory reset 保留配置；reset 回滚恢复最新已提交的配置，而不是重置前的旧副本。普通配置读取不创建记忆 workspace、不扫描 notes；新的合法 Activation 读取持久配置后重装 timer。
- cleaner 只测量并 upsert/drop `system.cleaner/memory_size_hint`；它不能总结、截断、向量化或静默改写 Agent 记忆。
- stable source identity 保留首次 `createdAt`；低于阈值时删除 transient hint。
- 每次 canonical Activation 在启动前重新检查，并把 pending typed items 注入匹配 Agent 的受控环境。standing prompt 明确该内容不是聊天，不授权 Room reply/Task mutation。
- 父进程/RuntimeProfile 不能注入保留的 App Inbox 环境变量；没有 Computer lease 时必须为空。

### 3. Maintenance 适配方案（待重新审议，尚未实现）

用户要求优先整体复用成熟体系后，以下独立 maintenance context 方案暂停实施；不能将“无 Worker credential + 新上下文”称为 Raft 原设计。Raft 使用现有 Runtime 或普通 startAgent；Claude-Mem 使用独立 observer 主链。下一步先核对 Raft 的启动/通知如何适配现有 AgentHost，设计差异再单独评审。全局单 lane、停止语义、terminal proof 与无伪造 Room 的不变量继续有效。当前裁决见[收紧后的实施计划](../product/agent-memory-raft-completion-plan.zh-CN.md)。

此前候选方案使用 Computer-local `AgentMaintenanceJob`（保留为审议记录，不是当前新增开发指令）：

```text
typed App Inbox item
  -> Computer maintenance scheduler
  -> acquire the same per-Agent execution-lane mutex
  -> either content-free notice to identity-fenced active Runtime
     or bounded maintenance Runtime after the canonical lane becomes idle
  -> source recheck / explicit scoped ack
  -> maintenance receipt
```

- maintenance Runtime 使用冻结的 Agent definition、RuntimeProfile、model/effort 和 workspace placement，但没有 Worker Room credential；它只能读取/整理该 Agent memory 和 scoped App Inbox。
- active Runtime 的 direct notice 必须绑定当前 process instance、Provider session/turn 能力和 safe-boundary evidence。`write()` 成功只表示 notice 已送达，不表示 memory 已整理。
- 不支持安全 direct notice 时只排队；不得中断 Human 的 Room 工作或并行启动第二个同 Agent Runtime。
- maintenance stdout、Provider transcript 和 exit code是诊断；只有 source recheck（例如 `MEMORY.md` 已回到阈值内）或显式 scoped ack 才完成 item。

### 4. Restart 与 Reset 是两个操作

- **Restart execution**：对正在执行的 canonical Activation 发起现有 cancellation fence，等待真实 Runtime terminal proof，再由 Kernel durable retry 同一 Activation。它不清 memory，也不清 Provider continuity。
- **Reset Agent workspace**：Human 管理命令先取得跨 canonical/maintenance 两条路径共用的 exclusive terminal fence。在 fence 持有期间将 workspace 原子移动到 Computer owner-private quarantine，并把该 Agent 的全部 Provider continuity record 移入独立可回滚 quarantine，写入 reset receipt，最后释放 fence。下次真实 Activation seed 新 workspace。
- receipt 前任一步失败都回滚两类 quarantine；无法取得 fence 时返回 conflict。默认不立即物理删除 quarantine，未来由有界 retention/显式 purge 管理。不可逆 `clear()` 不能冒充事务。
- 中央 Core 只保存操作身份、目标 Computer、状态与公开 receipt；不能直接读取远程 Computer 的 Memory 文件或接受任意文件路径。

### 5. UI 与 CLI

- Runtime 使用 Computer-local scoped `agent inbox check/ack` transport；Room Worker CLI 不新增 App Inbox route，避免把 Computer state伪装成 Kernel state。
- `check` 沿用 Raft 的只查看、不消费语义，也不触发测量。显式 `recheck` 是独立 RAH 适配，复用 cleaner 重新检查源文件；它不是默认策略改变。`ack` 必须携带观察到的 item/version，仅确认通知，不证明索引已变小或记忆质量合格。版本保护阻止旧确认删除同一 stable ID 的新提示。
- 每个真实 Run 的能力只绑定一个 Agent，通过 owner-private token 文件与 loopback listener 提供；复用现有 CLI wrapper/凭据释放基础设施。无 Worker Room token、无 owner 参数、无浏览器/CORS 接入。Run release 或 Computer close 关闭 listener 并回收凭据；同 UID/full-access 仍不是恶意 Agent 之间的 OS 隔离。
- Agent「资料/工作区」可展示有界 Memory index、notes 清单、大小、cleaner 状态和 reset receipt。内容读取、编辑、导出和 reset 通过目标 Computer control port；浏览器不能直接拼接本地路径。
- Raft 的「重启 / 重置」视觉协议可复用，但确认窗口必须分别解释“重试当前执行”和“清空 Agent 私有 workspace/Provider continuity”，不能用一个含糊按钮执行两种破坏等级。

## 当前实现（2026-08-30 收口增量）

- `AgentMemoryCoordinator` 已在本机 daemon 与远程 Computer Runtime composition 中复用同一个 workspace/cleaner owner。
- 真实子进程门禁证明首次 Run 写入 oversized `MEMORY.md` 后，下一次跨 Room/Profile Run 收到 typed transient hint；另一个 Agent 不共享 memory。真实 OpenCode 浏览器门禁又证明同一 Agent 跨 Channel/DM 与独立 RunAttempt 召回，Kimi 未获得该私有事实。
- 每个新 RunAttempt 在 child launch 前生成 immutable Computer receipt v2：`coverage=index_only`，只记录 `MEMORY.md` 的 digest/bytes/mtime、policy ref、来源及 Activation identity，不遍历 notes，也不再写全树 snapshot digest。旧 v1 全量收据只读保留；尝试以同一旧 Run 重新物化会明确拒绝，使用新 RunAttempt。receipt 不证明模型读取、正文完整性或备份；Human 显式检查与启动解耦。
- Human application service 已提供 ACL-gated inspect/read/reset。Web 的 Agent「工作区」使用相对路径展示 file tree、大小、cleaner state 与只读 UTF-8 内容；桌面和 PWA 已验证刷新恢复、reset 二次确认与取消。浏览器不能拼接 Computer 绝对路径。
- 正式本机 daemon 已把 `resetWorkspace` 绑定 Kernel 全局 exclusive fence 和 rollback-capable Provider continuity store。reset operation 由 owner + idempotency key 派生，持久 receipt 重放只读，不会再次删除后续新 seed；receipt 前失败会双向回滚，无法证明回滚安全时继续保留 fence。
- legacy daemon schema v2 与正式 v3/v4/remote Runtime composition 都已接 Memory 与 receipt，不再存在兼容路径静默跳过。
- Computer-local App Inbox scoped CLI 已接入 v2 compatibility、本机 v3/v4 和 remote Runtime composition。真实 Node 子进程已验证 check/ack/recheck、跨 Agent 拒绝、旧版本拒绝、关闭回收与 source-only 复核。它没有启动新的 Agent Runtime。
- autonomous maintenance lane、active Runtime safe notice、远程 Computer Human control、跨 Computer single-writer handoff 尚未完成，不能宣称 Raft memory 生命周期或多 Computer memory 已 100% 收口。当前修改尚未部署到用户在线实例，旧冻结 prompt 也不自动更新。

## 来源与差异

- 上游：Raft Computer 1.0.18，固定 bundle SHA-256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。
- 结构化移植：workspace seed、standing prompt、64 KiB cleaner、interval/threshold bounds、typed App Inbox identity、content-free notice语义。
- RAH OS security glue：0700/0600、owner/symlink checks、保留环境清理、single-lane maintenance、terminal fence、quarantine rollback 和 receipt。
- 有意不复制：Raft `resetWorkspace(agentId) -> rm(..., recursive, force)`；Raft Server account/DM/session identity；把 Provider session 当记忆 owner。

## 验收门禁

1. 同 Agent 跨 Room/Profile/model/daemon/Provider session仍注入同一 workspace；不同 Agent 路径和内容隔离。
2. oversized index 只产生一个 stable typed hint，无 Room event/message/cursor；父环境伪造值无法进入 child。
3. active notice、idle maintenance 和 canonical Activation永不形成两个并行 lane。
4. restart 必须有 terminal proof再 retry；reset 必须有 exclusive fence、quarantine、continuity clear、receipt 和失败回滚。
5. 本机与远程 Computer 走同一协议；断连后操作状态可恢复，中央 Core 不读取远程路径。
6. desktop 与 390x844 真实浏览器完成 Memory 查看、restart/reset确认、刷新恢复和错误状态；DOM/unit green 不代替视觉/交互证据。
