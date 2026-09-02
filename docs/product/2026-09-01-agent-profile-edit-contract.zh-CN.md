# Agent 资料编辑合同与施工边界

状态：名称、描述、模型/effort 与官方头像 preset 修改均已按测试先行实施；浏览器与部署证据另记。

## 来源与复用

Raft 授权前端快照 `docs/evidence/raft-web-20260831-current/AgentDetailPanel-DKwoNvgK.js`
（SHA-256 `b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845`）：
`hc` 的名称入口约 UTF-16 offset 87761、描述入口 89548、运行时编辑 99106。
名称在资料页就地编辑，Enter 保存、Escape 取消；描述支持换行与 Escape 取消。
运行时由专用编辑器选择模型、推理强度。官方离线 Alice 页面已实际打开名称编辑、取消。
本地采用该交互合同的结构移植；不是字节级拷贝，也不采用 Raft 中央服务 PATCH 作为本地后端。
本改动不涉及新的模型发现算法或 Multica 运行时移植；已有发现与配置 owner 保留。

2026-09-01 头像入口补充使用同一冻结版本：Chat 私信顶部 Agent 头像在
`index-BoAC7nSE.js` UTF-16 offset 3191440 调用 `openProfile("agent", peerId)`；
Message Agent 头像在 2935728 的 `Xrt` 经 `onNavigateAgent` 打开同一资料 owner。
资料头像在 `AgentDetailPanel-DKwoNvgK.js` 137580 切换选择区，138961 显示
`Choose Avatar`，134119 以 `avatarUrl: pixel:<key>` 保存并关闭。RAH 结构移植这组
入口、即时 preset 保存和焦点闭环，不导入官方 store 或网络 endpoint。

## 责任与必要差异

- UI：资料字段独立编辑器维护草稿，显式保存/取消、pending、错误与焦点；姓名和描述不得打开整套运行时管理。
- Protocol：`agent.manage / update_profile`，字段为 `displayName`、`description` 或官方 `avatarKey`，携带冻结 revision、Room sequence 和幂等键。头像值只接受 allowlisted 官方 Agent preset，不接受路径、URL 或任意上传内容。
- Kernel：同一事务校验 Human control-Room 管理权限、freshness、revision CAS，追加 AgentDefinition revision 和 `agent.profile_updated` 事件。
- 修改资料不要求 Computer 在线，不发布 ExecutionPolicy revision，不修改 Host grant、handle、角色人设、技能、记忆引用或 Agent/Participant identity。
- 名称仍按本地 schema 要求非空、最多 128 字符；描述最多 2000 字符、可清空。与 Raft 的空名称回退和 3000 字符上限不同，暂不扩大现有数据合同。
- ACL 角色不是人设、模型或 CLI 读写模式。ADR-0012 规定 Agent 只能为 member；保留该限制并显示原因，不能用一个铅笔绕过后端安全边界。
- 模型/effort 继续通过现有 `configure` 原子更新，下一次执行生效；不停止在途执行、不抹除私有记忆。资料芯片可明确打开该编辑器。当前值/目录不匹配必须报错，不能伪造选项保存。
- Chat 顶部头像与 Message Agent 头像只调用 App-owned `openAgentPeek`；两者默认打开 Activity，不建立第二个 inspector、route 或 Agent 状态。资料 tab 的头像按钮展开同页选择区，成功后通过 catalog reconciliation 同步顶部、Message、目录和资料头像。
- 头像选择区打开时，Escape 由该层在 capture 阶段消费：只关闭选择区并把焦点还给头像按钮，不得继续触发外层 Agent inspector 的 Escape 关闭。
- 官方上传图片依赖独立 multipart/avatar 存储合同；本地尚无该 canonical owner，因此上传格明确标为暂不可用。不能把浏览器 object URL、宿主路径或附件 URL 写入 `avatarKey` 冒充上传完成。

## 二次审查

复用完整 configure 做改名会要求在线 offer，并更新 execution policy，语义不合适；因此最小字段命令有必要。
不新增资料表、不修改 Room 身份体系、不自动变更管理员政策。编辑过程中外部 revision 改变时拒绝覆盖并保留草稿。
切换 Agent 的草稿必须隔离；异步保存只能更新自身身份的 catalog，不得导航或写入另一 Agent。

## 验收

先红后绿验证：离线资料/头像更新、字段约束、幂等重放、过时 revision、权限拒绝、删除状态拒绝、重开数据库持久化及无策略/记忆副作用。
真实浏览器检查：同尺寸官方入口/取消、本地名称 Enter、描述换行/Escape、失败保留草稿、配置模型+effort 保存与刷新回显、390px 响应式。
头像补充检查：顶部头像与 Message 头像打开同一右侧 Activity inspector；资料头像打开16枚官方 preset；保存后所有共享头像同步；Escape/关闭恢复触发焦点；上传格不可提交。
运行时配置保存仅在隔离状态中验收，不启动付费 CLI，不改用户正式模型偏好。
最后全量门禁、正式状态备份、安全重启、新页面复核；分别报告代码、浏览器、实际 CLI 和双边限制。
