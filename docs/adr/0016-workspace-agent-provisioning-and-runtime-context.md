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

## 尚未由本 ADR 完成

- 已有 Agent 的原子编辑、启用/停用、删除与运行中 drain 语义；
- skill/instruction artifact 上传、版本选择、解析与 ContextManifest；
- private memory policy 编辑和凭据/环境变量安全绑定；
- Provider 安装、登录探测、RuntimeOffer 管理与 Computer placement 控制；
- launchd/签名安装包、Keychain、生产 pairing/TLS/allowed-origin LAN 服务；
- 真实付费 Provider 的自动测试。默认门禁继续只用 fake executable。

因此，本 ADR 证明“创建的 Agent 是持久且能进入真实进程的”，不等于“Agent 管理或正式桌面产品已经与 Raft 全量等价”。
