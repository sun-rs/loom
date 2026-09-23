# Role / Instance 纵向 MVP

2026-09-23：用户确定的新执行优先级，替代横向完成 P1–P8 的施工顺序；产品语义仍沿用已批准设计。

## 首条可用路径

保存 Role 配置（不启动 CLI）→ 选择频道实例化 → 频道成员获得独立 principal 和配置快照 → Human 发言 → 既有 Inbox/Activation/Host 路径唤醒 → Worker 读取 box 并显式回复 → 再次发言继续原实例 session。

先复用已认证的 RuntimeOffer 和现有 start/resume，不重新实现 provider harness。每实例独立 principal，使不同频道的同 Role 不再共用执行 lane/session。Role 是配置，不加入频道、不拥有执行 lane。实例限制在所属频道；不能自动加入 #all 或被追加到其他频道。

首批创建不可变 Role 配置版本和新实例；第二条用户路径接入模板修订，现有实例仍保持原配置。实例运行时调整后续接入，不改现有 Agent/历史。UI 复用当前表单、频道和聊天组件，保留大页结构。业务通过后再替换旧入口与迁移数据，不先铺开四家 CLI 的新能力。

## 开发与验收顺序

1. 用临时库测试保存 Role、实例化、频道发言到回复与第二轮，验证同 Role 跨频道不串身份。
2. 接同一条 authenticated API / SDK 和最小 Role 页面，浏览器创建并使用；假运行器只用于明确标识的测试环境。
3. 选一条现有真实 CLI 通路做受限验收（仅在当次获准时），确认原生 session 续聊；不能拿 fake 结果宣称真实能力。
4. 主路径成立后再做下一条用户可用路径，避免只交付未接线类型/表/状态机。

## 延期清单

| 能力 / 触发条件                   | MVP处理                                        | 后续时机                 |
| --------------------------------- | ---------------------------------------------- | ------------------------ |
| 同实例模型/effort调整             | 模板已支持修订；实例暂不新增调整入口           | 后续纵向路径             |
| 私聊、Side、持久fork              | 不开放新入口                                   | 分别作为下一条纵向路径   |
| 原生session丢失、认证账户切换     | 显示现有错误，人工处理；不自动重建             | 有复现或发布该恢复能力时 |
| 并发fork/恢复接管、孤儿清理状态机 | 不建设尚未使用的完整框架                       | fork/恢复进入范围时      |
| 平台记忆、旧记忆迁移              | 暂沿现有实例隔离机制，不声称共享平台记忆已完成 | 独立记忆纵向路径         |
| 全CLI能力矩阵、压缩统计           | 不阻塞第一条可用通路；未知保持未知             | 主通路稳定后逐项加入     |
| 大规模旧数据迁移与复杂回滚        | 不转换现有数据                                 | 新路径验收后             |

这不是安全降级：基本授权、实例所属频道、原子写入/幂等和历史保留必须从首条路径成立。低概率未知不应被臆测成开工前提。

## 首条实现边界

Protocol 的 Role schema、Kernel 的 RoleCatalog 是配置与实例来源关系的唯一 owner；应用服务和 SDK 暴露 create/list/instantiate。复用既有 provision、Principal、AgentDefinition、Room membership、Inbox/Activation 和 AgentHost。schema 59 仅新增 role_templates / role_instances，不转换已有 Agent。

这是 RAH 的适配实现，并非复制 Raft 源码。来源比较沿用 [v0.1 设计](./role-instance-session-v0.1.zh-CN.md) 和 [能力核查](../audits/2026-09-22-role-session-capabilities.zh-CN.md)：有意用每频道独立实例替代跨频道共享执行身份；不新建第二套调度器。

首条入口暂放在成员页的“Role 管理”，保留旧成员入口和现有大页。模板保存不初始化 CLI；加入频道不自动启动，收到 Human 消息后由原调度器启动。实例具有唯一 principal/agent ID，handle 使用配置前缀与唯一后缀；名称不是寻址键。模板现可修订为新版本；旧实例保留快照，目录显示“使用旧版本”，新加入实例使用最新版本。实例禁止从 legacy 配置入口切换 RuntimeOffer；同运行时的模型/effort 沿现有能力，本轮不声称切换后的原生 session 已实测。实例不进入左侧私信候选；私聊未接入 private box 前不能走旧 canonical DM 入口。含实例频道暂只支持归档，不开放永久删除，避免丢失实例来源。

原生 session 的正常续聊仍使用现有 provider store 的 participant/runtime/config key。2026-09-23 第二批：Kernel 在运行上下文保留 instanceChannelId，正式本机 daemon 为新实例设置严格恢复策略；四个驱动在已绑定会话恢复失败时停止，不自动改开空白会话，失败进入既有 sticky_terminal 分支。旧 Agent 的恢复策略保持兼容。详见 [续聊保护](../audits/2026-09-23-role-session-continuity-guard.zh-CN.md)。

这仍不等于完整的 session 绑定系统：配置 key 变化已由[实例稳定键修复](../audits/2026-09-23-instance-stable-session.zh-CN.md)覆盖；Host 绑定记录本身被外部删除、首次会话尚未形成可恢复记录等情形仍未闭合；MVP 暂不承诺自动恢复接替。真实 CLI 的语义连续性、压缩与模型切换仍需受限验收，不能用 fake 协议结果代替。

## 第二条路径：Role 修订 → 新旧实例版本区分

同一 roleId 保持不变，roleRevisionId 每次保存生成。role_templates 是当前版本投影，schema 60 的 role_revisions 保存完整不可变快照；已有 schema 59 模板回填首个快照。RoleCatalog.revise 在控制 Room 单事务中做权限、expectedRoleRevisionId、basedOnRoomSeq 与幂等校验，更新模板并追加 role.revised。禁止顺带更新 AgentDefinition、实例 lane、provider session 或记忆。

role.list 同时返回当前有效成员实例及来源版本是否最新，前端直接呈现该投影，不自行按名称猜身份。编辑沿共享配置表单，提供名称、描述、角色指令、运行时、模型和推理强度；它们只影响后续实例。目录显示来源频道和实例 ID 区分同 Role 多实例。这里的“当前版本”指来源模板版本，不代表当前实例没有运行时 override。

这条路径不包含模板归档、旧实例升级、全量 Agent 页面替换、私聊或 Side。详见 [修订验收](../audits/2026-09-23-role-revisions.zh-CN.md)。

## 第三条路径：频道实例私聊

复用 canonical direct Room 作为 Human ↔ instance 私有 box，不增加消息表、队列或执行 lane。仅 Human 能创建；要求 Human 和实例仍在来源频道。实例 principal、AgentDefinition、RuntimeOffer 和 provider session key 不变。旧 Agent DM 行为保留；新实例私聊不进入左侧私信列表。

Kernel 是权限与调度 owner：频道执行不能枚举、搜索或读取私有 box；私聊开始执行后才能读取该目标。公开频道历史仍沿已有 membership 可读，实例回复只允许发往当前执行目标。凭据继续受既有 RunAttempt 生命周期约束。忙时通知对新实例仅包含当前目标的 Human 消息，不把私聊插进频道工作，也不把其他实例回复作为 steer。

Web 在既有实例右侧详情的消息动作中打开私聊，复用 ChatPane、MessageSession、RoomSession、草稿、滚动与响应式容器。首批仅普通文本交流；不额外扩展私聊附件、Task、消息列、Side 或 fork。重开私聊通过相同 pair 恢复历史；关闭面板不终止实例工作。

本批不新建 native session 绑定表，不更改四家 CLI 的会话实现。测试分别证明同 principal 串行、目标权限、相同 standing-prompt session key；真实 CLI 的历史连续性必须单独验收，不能以 Fake CLI 收发代替。

## 下一条路径：频道内持久 fork（验证阶段）

2026-09-23 已完成 [Codex 本机原生验证](../audits/2026-09-23-codex-native-fork.zh-CN.md)，使用隔离 HOME 和本地假模型，确认真实 CLI 的截止复制、不同 session ID、身份交接与关闭恢复。直接传 fork developerInstructions 在本机未送达模型；首轮 collaborationMode 的后续 developer 指令可以送达并持久化。旧身份仍在历史中，不将其描述为覆写或安全隔离。

接线只覆盖空闲 Codex 实例 → 同频道新实例 → 新凭据与原生子 session → box 回复。Kernel 拥有实例/权限，Host 拥有原生复制和持久回执；不继承任务、Inbox 或私聊 box 权限。当前还没有产品 fork API/UI，不把此验证当作第四条纵向流程交付。忙时 fork、Side 和跨 provider 能力保持延期。

## 2026-09-23 主线审计修复

[绑定失败、记录缺失与私聊撤销](../audits/2026-09-23-instance-continuity-mainline.zh-CN.md)优先于 fork：
缺失绑定现在停止，不再静默新建；依据现有 Kernel 执行历史派生的标志，而非新建完整 binding 状态机。
自动恢复接替仍未交付，真实模型上下文质量仍需独立验收。
