# ADR-0016：Workspace Agent 原子创建与冻结运行上下文

状态：Accepted（Kernel/API/SDK/真实子进程/daemon restart/desktop-mobile browser E2，2026-08-27）

## 背景

Raft 形态的 Agent 不是聊天页里的临时收件人，也不是 Computer 或 CLI Runtime 的别名。它是 Workspace 范围的长期身份，拥有版本化的角色、指令和执行策略；被加入某个普通 Room 后，才获得该 Room 的消息投递。

如果前端分别创建 principal、policy、definition 和 Host lane，任一步失败都会留下半成品。若 Agent 配置只停留在网页表单或 fixture prompt 中，即使页面显示“已创建”，实际 Provider 进程也不会受到约束。

## 决策

1. Workspace control Room 的 owner/admin 通过一个 `agent.provision` Human command 创建 Agent。Kernel 在同一 SQLite transaction 中创建 Agent principal、control Room membership、不可变 ExecutionPolicy revision、AgentDefinition revision 和 Host participant grant，并追加 `agent.provisioned` 终态事件。
2. 创建必须引用一个当时可用、未过期、属于在线 authenticated Host、且以 `in_place` 挂载当前 Workspace 的 RuntimeOffer。浏览器不能提交 executable、cwd、环境变量或任意 shell。
3. provision command 使用 control Room `basedOnRoomSeq` 与 idempotency key。相同请求可以安全重放；相同 key 的不同内容 fail closed。
4. AgentDefinition 保存产品身份和行为：handle、display name、avatar key、role、description、instructions，以及未来 instruction/skill/memory 的 versioned content references。ExecutionPolicy 单独保存 Runtime/model/session 选择，避免把 Provider 配置混进身份对象。
5. Placement 在 launch claim 时解析并冻结确切 AgentDefinition revision。AgentHost 把该上下文放进 `ActivationEnvelope.agent`；通用进程适配器以只读 `RAH_AGENT_CONTEXT_JSON` 注入直接或 supervised 子进程。正式 profile 的 worker contract 必须读取该值，不能依赖 UI 内存或最新可变 definition。
6. Host credential 的 participant scope 以 Kernel 数据库中的未撤销 credential 为权威。manager provision 可以扩展已有 Host credential；Host 每次受保护操作读取当前 scope，因此无需重启才能运行新 Agent。config v4 的静态 participant 列表只是一组启动必需成员，必须是 credential scope 的子集；数据库中额外的 manager-granted Agent 在 daemon restart 后仍有效。v2/v3 compatibility 继续要求精确单 participant scope。
7. Web 只通过 typed `RahClient` 调用 provision command。Raft 视觉快照仍只提供 token、图标和交互规格，不成为 Agent 状态 owner。
8. 已有 Agent 通过单一 `agent.manage` command 原子修订 Definition 与 ExecutionPolicy。handle、显示名称、头像 key、角色、描述、指令、RuntimeOffer、model intent 和 session policy 同步产生新 revision；已经领取的 Placement 保持旧 revision，新 Placement 才读取新 revision。
9. `enabled / disabled / tombstoned` 是 Kernel-owned 状态。暂停把 Agent 原子改为 disabled，立即阻止新 Message delivery 和 Placement；当前 lane 在 lease maintenance 读取 canonical Agent 状态后受控 cancel，只有 RuntimeProcess terminal proof 成功才把 RunAttempt 记为 cancelled，并将原 Activation 留在 durable queue。恢复为 enabled 后继续排队工作；cancel 无法证明则 quarantine，不能伪造安全暂停。tombstone 必须从 disabled 且没有 queued/leased/quarantined Activation、未完成 Task 或 active Run 的状态进入，随后原子移除所有 Room membership并撤销 Host participant scope。
10. 标准产品直接采用 Raft 的无人值守 Computer 权限协议：Agent 创建/设置页不显示 CLI 权限选择，新 Agent 与每次 configure 生成的 ExecutionPolicy 固定为 `full_access`，标准 RuntimeOffer 也只发布该值。Codex 映射为 `approvalPolicy=never + danger-full-access`，Claude、Kimi、OpenCode 等映射为当前版本已验证的最高自治参数；Provider 即使继续发出 approval RPC，也只有身份匹配的当前 turn 可以自动获准，重复 ID 内容冲突或外来 thread/turn 一律 fail closed。旧 durable policy 的宽 enum 只用于读取历史数据，下一次 configure 收敛为 `full_access`，不能重新进入新 client contract。这里的 CLI 自治绝不授予 Workspace 管理、Room membership、MCP assignment 或 App 安装权限；这些仍由 Kernel ACL 独立决定。真正需要人类判断的业务输入进入 durable `InputRequest`，不能依赖浏览器在线。

## 安全与一致性

- Human command 只能由当前 Workspace control Room 的 owner/admin 发起。
- RuntimeOffer、Host credential、Workspace mount 和 participant binding 都由 Kernel 复核；客户端显示的 inventory 不是授权证据。
- `RAH_AGENT_*` 名称保留，RuntimeProfile 环境覆盖不能伪造 Agent context。
- 运行上下文有 schema 与大小上限；其中不得放明文 Provider credential。密钥仍属于 Host/Runtime 的安全配置。
- 已领取的 Placement 始终使用当时冻结的 revision；后续编辑只影响新 Placement，不能悄悄改变运行中的工作。

## 已有证据

- Kernel：权限、stale context、幂等、完整 aggregate、Host grant、普通 Room onboard、Message→Placement→旧 Host credential claim。
- process：真实 child process 读取 `RAH_AGENT_CONTEXT_JSON`，并观测到预期 role/instructions。
- daemon：运行中创建动态 Agent，daemon 用原静态 config 重启后该 Agent 仍在 authenticated scope。
- browser：桌面和 390×844 页面创建 Agent，重载后仍在 Workspace catalog，并继续通过真实 daemon/fake executable 完成 Room 消息链。
- management：Kernel/API/SDK/browser 证明配置 revision、暂停、恢复与删除；多 Lane Host 门禁另证明运行中暂停会受控 cancel、保存 terminal proof、durable retry，且不阻塞另一 Agent。暂停时不生成新 Activation，恢复后的 Placement 携带修订后指令。

## 尚未由本 ADR 完成

- 独立的“重启当前执行”“清除 Provider session”“取消/重派遗留 Task”管理动作；删除仍要求 Agent 已暂停且所有工作达到安全终态；
- Workspace instruction pack 的受限协议、hash 与可回滚安装器，以及每 RunAttempt 的 ContextManifest v1 引用冻结已经实现；skill/instruction Artifact 上传、版本选择、Server assignment、内容解析与 Host materialization proof 仍未实现；
- private memory policy 编辑和凭据/环境变量安全绑定；
- Provider 安装、登录探测、RuntimeOffer 管理与 Computer placement 控制；
- launchd/签名安装包、Keychain、生产 pairing/TLS/allowed-origin LAN 服务；
- 真实付费 Provider 的自动测试。默认门禁继续只用 fake executable。

因此，本 ADR 证明“Agent 是可持久创建、版本化配置、停用/启用/删除且能进入真实进程的”，不等于“技能/记忆管理或正式桌面产品已经与 Raft 全量等价”。
