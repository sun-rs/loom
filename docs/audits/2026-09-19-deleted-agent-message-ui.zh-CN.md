# 已删除 Agent 历史消息身份

## 消息标题名称与窄屏单行

删除身份的静态名字分支此前使用 message.author 的历史回退值，而悬浮卡
已经按 AgentDefinitionId 读取显示名称，导致同一 Gemini 在标题显示 OpenCode。
现 MessageArticle 的可点击/不可点击名字共用 ID 关联的 displayName，缺失时
才回退消息 author；不按名字查找或转移身份。

按用户明确的窄屏要求，共享 msg-head 使用 nowrap、子项不收缩、overflow
hidden，名称/模型/删除徽标/时间始终同一行，超出正文列宽度裁切；消息正文
仍正常换行。不改模型信息的数据来源。测试用不同的历史 author 和当前名称，
并强制显示长模型标识，验证 1280/390px 姓名、行高、无下划线与删除身份入口。
Chromium/WebKit 定向回归、类型检查和正式构建通过；备份重启后在正式历史
频道验证 Gemini 名称及 1440/390/320px 单行裁切。完整检查仍受下文既有后台
门禁/格式问题阻断。未修改历史消息、提交代码或执行付费 Provider。

## 2026-09-19 悬浮卡续修

下述 Raft bundle 的 `B5` 对删除身份仍消费 fallbackAgent/runtimeConfig，
保留彩色 mention-card 头像与最近五条动态；消息头像才应用灰度。此前本地
给 tombstone 的 PreviewCard 传入 null，造成空边框；现恢复共享 AgentPreview。
卡内删除身份显示离线、未分配计算机，名字仍由授权身份投影提供。消息名字
显式禁用旧 `.msg-head b:hover` 下划线及 pointer，不改正文 @ 引用行为。

Kernel `listAgentTrajectory` 移除 tombstone 状态过滤，保持 Human/control
membership、Workspace 及逐条 Room membership 校验；只恢复授权历史读取，
不恢复运行、提及或配置修改能力。新增删除后历史读取回归先失败再通过。
资料仍走已有 agent.get，失败时可用身份目录的已保存模型和运行时标签兜底，
不伪造推理强度。悬浮卡请求失败仍显示真实错误。

正式 latency-pair-0917 的旧 OpenCode 身份还复现了 agent.get 403：
读取函数在校验 Human 管理权限后，又读取已被删除的 Agent 自身的成员角色。
现对 tombstone 返回协议本已允许缺省的 membershipRole，不再要求删除身份
仍是成员；Human 管理权限保持不变。运行时展示由已保存 policy 的 allowedOfferIds
匹配只读发现目录，不伪造 Agent 仍绑定 Computer。此修复不修改正式 membership。
有读取权限的删除身份通过 Chromium/WebKit 1280/390px fixture 验证悬浮卡、
原色头像、模型、最近动态、无下划线和点击不可用面板。未做 iPhone 实机或
在线 Raft 同条件双边验收。

正式状态已备份并重启，新浏览器验证历史频道悬浮卡及无下划线。
定向 Kernel、Chromium/WebKit、类型和正式构建检查通过；完整 check
仍受既有 `/v1/worker/message-present` 未登记阻断，format:check 仍报告
五个既有后台文件；没有提交、推送、删除 Agent 或修改正式成员权限。

Raft 1.16.0 证据：`https://app.raft.build/assets/index-CKeqacxz.js`，
SHA-256 `7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`；
`AgentDetailPanel-CW_VMZT6.js` SHA-256
`918921bbb932ed020285d2f3639c0a5511249f4bca1d2468628da995078a37e3`。
授权 bundle 只读，不执行；结构移植而非字节复制。
上游删除头像 grayscale/opacity-60，不显示状态徽标；删除标识 border/bg-gray-300，
不可用文案来自 agent.detail.unavailableTitle/unavailableDescription。
警告图标移植 T7e/Ul Lucide triangle-alert（ISC，保留来源注释）。
不可用面板复用本地 PanelHeader/EmptyState；尚未完成在线同条件双边尺寸验收。

根因：agent.list 在 SQL 层排除 tombstoned，客户端删除后又丢弃身份，刷新后
历史消息无法识别已删除状态。协议新增可选 includeDeleted，默认 false，Kernel
仍要求认证 Human 与 control Room membership；前端明确请求历史身份，但活跃
目录、创建/分配候选继续过滤 tombstoned。删除返回结果写回身份目录而不清除。
不会把 disabled、离线或读取错误推断为删除。

消息头像灰度且无在线点，名字不再提供提及按钮，保留已删除徽标；头像点击只
对已经授权读取的 tombstone 打开不可用面板，不调用被拒绝的 navigation.resolve，
不读取失效 Agent 配置或启动执行。共享身份上下文覆盖 Room/私聊/消息列。
不修改历史消息正文，也不在本批处理历史模型快照。

TDD：Kernel 先复现 includeDeleted 查询仍无 tombstone，再验证默认过滤和显式
读取；浏览器检查实际 MessageArticle 的名字不可提及、头像灰度/状态点、点击
不可用面板、关闭和刷新，Chromium/WebKit 桌面及 390px。隔离 fixture 不删除
正式 Agent。源码实现、自动测试和正式部署分别报告。

## 私聊身份续修

### 同名重建的创建入口

此前“同名独立”只覆盖 ID 驱动的展示和私聊配对，未验证创建入口。创建窗口
从名称生成 handle，而 principals 的全历史唯一约束阻止了重建。现在由
Kernel provisioning 在同一事务中分配：若请求 handle 的占有者为 tombstone，
为新身份选择未占用的数字后缀（如 opencode-2），显示名称保持 OpenCode。
活跃身份及 Human handle 冲突仍拒绝。旧 handle 不改名、不释放、不转移，
从而历史正文中的 @handle 不会重新解析到新身份；现有 ID 引用保持不变。
这是适配 RAH 全历史唯一 handle 约束的本地策略，不声称 Raft 使用相同后缀。

请求摘要仍基于原始规范化请求，幂等重试返回同一个新身份，不重复分配；
名称冲突规范化沿用 messageReferenceNameKey。不改变 schema 或历史数据库。
测试覆盖实际创建、重复请求、旧 tombstone 保留、新旧 DM 独立、归一化冲突、
后缀碰撞及长度边界。浏览器使用临时 Kernel 和 Fake Provider 生成旧回复，
验证删除/重建后旧消息仍灰色、点击仍打开不可用面板、刷新及两条 DM 保留。
已通过 Kernel 定向测试及 Chromium/WebKit 的 1440/390px 完整重建流程，
包括正文旧 @ 引用点击不跳到新身份。类型检查、正式构建和 diff 检查通过；
完整检查仍为上文既有后台问题。备份重启正式实例后检查创建窗口正常加载，
没有在正式数据库创建或删除测试 Agent，也没有运行真实付费 CLI。

侧栏此前只接收活跃 Agent，并将已删除身份对应的 Room 回退为创建时名称；
私聊标题还使用 activeMemberIds 查找对方，删除退出成员后丢失头像和当前名称。
现由 direct-conversation-entries 按 Room.directParticipantIds 解析历史身份，
侧栏和标题使用已授权的完整身份目录。已删除 Agent 仅在已有私聊时显示，
不会为其生成新的开聊入口；活跃动态栏继续排除 tombstoned。

同名不是身份：旧 Agent 的 participantId/Room 保留，新 Agent 使用独立的
participantId 和 direct_room_pairs。未修改 Kernel 的 open-or-create 策略，
未按名字合并、迁移或删除历史。标题显示已删除，不显示在线状态点。

回归先复现旧名称回退，后覆盖删除、同名重建、新旧 Room 独立和重载。
隔离浏览器使用实际 RoomSidebar 检查两个同名条目的头像、点击分别选择
dm-old/dm-new，以及刷新后仍存在；Chromium/WebKit，1280 和 390 宽。
这不是在正式数据库执行删除和重建，也不等于真实 iPhone 验收。

## 关闭历史私聊

HumanSidebar.visible 原先从当前 memberships 生成 peer 键，删除 Agent 后
虽然 Room 仍对 Human 可读，hiddenDms 保存却被拒绝。改为只对既有可见
Direct Room 读取 direct_room_pairs，并要求当前 Human 是配对的一方。
可见 Room 查询、Workspace 权限和版本围栏保持不变，不扩大失效 Agent 的
执行权限。关闭仅保存个人隐藏偏好，不删除 Room 或消息。

临时数据库回归先复现 forbidden，再验证移除 peer membership 后关闭、读取
隐藏偏好及历史 Room 保留；未知 peer 仍拒绝。原有重新打开私聊取消隐藏、
幂等、版本冲突和跨用户偏好隔离测试继续通过。
