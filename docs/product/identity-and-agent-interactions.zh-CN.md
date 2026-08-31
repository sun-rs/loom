# 空间标识、消息身份交互与 Agent 动态

## 官方实测与目标

2026-08-31 官方桌面 1440×1000：姓名按钮的 title 是“提及 @handle”，点击 Kimi 后 composer 为 `@Kimi `；头像是独立按钮，hover 显示 280px、2px 边框、4px 阴影摘要卡，包含身份/状态、Computer、runtime/model、最近五条活动；点击头像留在原 Room，右侧打开 Agent 详情且默认动态。不能把姓名和头像绑定成同一个跳转。

动态协议：time + dot + 黑色标签 + 灰色短摘要在同一行，窄屏自然换行。thinking/text 的长正文保留独立段落和展开能力，不把所有内容强行塞一行。工具标签/参数投影参考已提取的 Raft Computer TOOL_DISPLAY_METADATA；这些永远不是 Room 消息。

## 单一 owner

- Workspace 名称/头像归 Kernel，写入其 control Room ledger，依旧由 Human owner/admin 管理。默认名称只在第一次创建时由核心主机名提供，此后不随手机/远程执行机变化。头像采用既有本地预设 key，不引入图片上传/任意 URL 的旁路；自定义上传属于 Artifact 阶段。
- 姓名点击只对当前 composer 做可撤销草稿编辑，不发送、不创建 Task；使用 canonical handle，不用可重名的 display name。主 Room 与 Thread composer 分别持有草稿/光标。
- 头像 preview 是按需的只读查询，离开/切换身份取消请求，不在每条消息挂独立轮询。键盘 focus 也能看到摘要，Escape 关闭，移动端不依赖 hover。
- 右侧面板和成员页复用同一个 Agent 详情 owner、配置与 Memory 控件；打开不导航、不清 composer/滚动位置。默认 activity；关闭恢复触发器焦点。窄屏为同组件全宽 overlay。
- 资料控制复用现有 `agent.manage` / diagnostics / memory reset，不用“暂停再恢复”假装 restart。尚无执行重启合同的动作要明确区分，不清掉长期记忆来冒充重启。
- Runtime 轨迹聚合在 AgentHost 观察通道处理，参考 Raft 350ms/2000 字符边界，按 kind/subagent 合并，工具/状态/结束 flush。不能改变 Room/Task/Inbox truth。

## 验收

先失败测试覆盖：Workspace ACL/幂等/旧库迁移与持久化；提及的光标/选择区/空格；同一行短动态与块正文；轨迹合并与边界 flush；同组件侧栏。

再真实浏览器覆盖：空间名称/头像保存和刷新、姓名插入和不发送、hover→卡片→离开、点击→activity→profile→配置→取消、连续换 Agent、关闭保留草稿、Thread 独立输入、Escape/焦点、1440/390 布局。必要的真实 CLI 调用只在临时身份/目录进行。正式 4173 不自动重启。

## 本轮落地边界

### 后续分类与鼠标行为修复

OpenCode 的 `message.updated.info` 给出 message role，part/delta 只是内容更新。观察入口只发布已绑定 assistant message 的 part；先到的未知角色片段在有界缓冲等待身份，user 内容和其他 session 均不进入 Agent 输出。重复 session busy 仅视为同一状态，不推断为多次模型请求。身份过滤不得决定 404 重试是否安全：是否已经观察到工具活动仍独立按原生 active-session 事件锁定。需要覆盖嵌套 sessionID、user/assistant、乱序、跨 session、重复 busy、未知角色有界丢弃的测试及真实 CLI 验证。

Room 侧栏分组折叠是纯展示状态，由单一共享 disclosure 组件拥有，不生成 Room/Workspace mutation；使用 button、aria-expanded、鼠标/键盘一致操作。关闭 Agent 预览和侧栏、分组折叠均不得清掉聊天草稿。

本次补测发现 Search 导航卸载 composer 会丢草稿。未发送正文和 Task 目标选择现由连接级 `ComposerDraftProvider` / `ComposerDraftStore` 单独拥有，Room（包括 DM）和 Thread 使用不同 identity key。成功提交只清理提交时的同一 snapshot，迟到成功不清理新草稿；失败不清草稿。它是内存内 UI 状态，不写 localStorage/IndexedDB，不进入 Room ledger；断开连接或刷新后不承诺恢复。Provider 与 hook 分文件，避免开发时 Fast Refresh 更换 Context identity。

2026-08-31 live DOM 补测：Search 在无关键词时，即使预选频道/发送者也保留“搜索所有内容”初始态，不发消息搜索请求。侧栏分组按钮高24px、箭头12×12、gap4px、字距1.2px；hover 文字黑色70%，背景透明。SVG 必须显式定宽高，不能依赖不存在的 `.icon` 类或浏览器默认300×150尺寸。已补尺寸/样式约束测试，并通过截图和 DOM 尺寸复验。

Workspace 使用 `workspace.update`，经 Human application port 到 Kernel，名称/预设头像和 `workspace.updated` control Room 事件同事务持久化。SQLite schema 21 增加可空 `avatar_key`；v20 迁移不重建空间、不改历史序号、不覆盖已有名称。表单先取得 canonical 版本，再允许编辑；提交使用冻结 sequence 和幂等键，不自动覆盖并发修改。

动态 debounce 参考 Computer 1.0.18 的 `queueTrajectoryText` / `flushPendingTrajectory`（350ms）。同 kind、producerFactId、subagent 的连续文本才合并，其他事件立即 flush。与原版的一个明确差异：每 2000 UTF-16 code units 无损输出一段而非截去余文，边界不拆 surrogate pair；普通结束和 timer 都可 flush。它只降低观察事件碎片，不会生成 Room 消息、创建 Task 或改变记忆。

Agent 详情页和 Room 侧栏共用 `AgentDirectoryPane`。头像摘要按需读取身份、runtime/model 和最近五条轨迹；浮层按实际高度定位并允许鼠标移入，离开或 Escape 关闭。配置入口沿用现有 Kernel 写入合同；不以修改前端缓存代替保存。

最新验收与尚未实现的控制项见 [核心交互收口复审](../audits/2026-08-31-core-interaction-closure-review.zh-CN.md)，前一批见 [Workspace / Agent 对照报告](../audits/2026-08-31-workspace-and-agent-interactions.zh-CN.md)。这些报告只证明列出的交互链，不代表所有 Agent tabs、所有 Provider 和整个 Raft 产品均已收口。
