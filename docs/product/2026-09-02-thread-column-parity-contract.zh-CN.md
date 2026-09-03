# 消息列（Thread）Raft 对齐合同

状态：已实现，等待持续回归。本文只约束 RAH OS；不修改旧 RAH 仓库。

## Raft 事实依据

本合同来自 2026-09-02 对 Raft 正式页面的浏览器实测，以及仓库冻结的官方 Web bundle
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，不是根据截图臆造：

- `o7` 与通用拖拽 owner `$_` 给出消息列默认宽度 400px、最小宽度 360px、最大宽度
  `max(400px, floor(viewport × 0.6))`；左缘命中区为 8px，拖动过程中黑色分隔线不变色。
- `thread-side-column` 另以 CSS 为主聊天区保留至少 320px；宽度偏好持久化。
- 标题栏高度 62px，标题为 16px；右侧依次是 Agent 关注者、消息列操作、关闭三个入口，
  方形操作按钮为 28px。
- 根消息块以 2px 黑线结束。有回复时，后面依次显示“回复的开头”和回复数量；两者不是
  同一条侧边带线标签。
- Task 在聊天消息中只显示紧凑关联入口（编号与 Agent），工作流 `submitted` 等状态属于任务页，
  不作为聊天消息徽章重复显示。
- Task 关联入口复用 Raft `Qet -> jg` 的 `in_review` 样式：内容自适应宽度、20px 高、1px
  `--ink` 边框、左右 6px、4px 间距、10px/10px 700 字重与 10px 图标；无圆角和阴影，
  hover 只在 100ms 内降为 90% 亮度。RAH OS 的 `submitted` 在聊天中映射为这一个
  `in_review` 可见状态；其他本地 Task 状态不能在没有语义映射合同前随意套色。
- Task 下方的紧凑回复不是第二套消息身份。Raft `ntt/rtt` 先以 `senderId` 解析同一个 Agent，
  再调用共享头像 owner 的 `compact-list` 尺寸；因此 RAH OS 必须保存每条预览的 `actorId`，
  用与 Room 正文相同的 `AgentAvatar`/头像键渲染 20×20 紧凑版本，禁止退化成名称首字母。
- Agent 关注者与当前人类是否关注是两套状态：前者驱动“正在关注的 Agent”弹窗，后者只驱动
  “关注/取消关注消息列”命令。
- “消息列操作”包括消息列内搜索、回到频道中的根消息、关注/取消关注消息列。
- Raft 以根消息 `parentMessageId` 暴露关注入口，不要求已经存在第一条回复。RAH OS 打开空消息列
  仍保持只读；用户第一次切换关注或发送回复时，才以同一个 owner 惰性建立 canonical Thread。
- Thread 初始读取最新 50 条；只有确实已经载入到首条时才显示“回复的开头”。向上分页保持
  可见锚点。Raft Web 打开消息列搜索会继续 hydrate 更早页；RAH OS 以同一 ACL-safe FTS 搜索
  指定 `threadIds`，分页读取全部命中而不把完整历史灌入浏览器，并用 `message.context` 定位窗口外命中。
- 管理员移除 Agent 关注者返回服务器生成的 5 秒 `undoToken`；客户端显示撤销入口，恢复请求
  重新检查 Room 管理权限、Agent 当前成员资格与 token 期限。

## RAH OS 单一所有者

- 宽度算法与存储：`apps/web/src/thread-panel-resize.ts`；React 生命周期：
  `apps/web/src/use-thread-panel-width.ts`；指针/键盘手柄：
  `apps/web/src/components/thread-panel-resizer.tsx`。
- 消息列布局和交互：`apps/web/src/components/conversation-panes.tsx`。页面不得另写第二套
  Thread 状态或宽度算法。
- canonical Thread 的惰性建立由 `apps/web/src/App.tsx` 中唯一的 `ensureActiveThread` 负责；
  首条回复与 provisional 消息列关注共用它，打开面板本身不写数据。
- 人类关注状态：`human_thread_follows`；Agent 关注状态：`agent_thread_follows`。两者由
  `packages/kernel/src/human-activity.ts` 在 ACL 校验后投影，Web 端不从消息文本猜测。
- 关注者撤销凭据：`agent_thread_follower_undo`，仅绑定执行移除的 Human、Thread 与 Agent；
  过期后不能恢复，也不能跨 Room 或跨主体使用。
- 对外协议：`HumanThreadFollowers*`；Client API 为
  `/v3/client/activity/thread-followers` 和
  `/v3/client/activity/thread-followers/remove|restore`。
- 搜索沿用 `WorkspaceSearchRequest.threadIds`、`GlobalDiscovery`、FTS5、冻结 cursor 与点击时
  `navigation.resolve`；不存在 Thread 专用缓存或第二份 ACL。

## 回归要求

- 单元合同必须验证宽度边界、键盘方向、持久化、标题入口、根消息分隔结构，以及聊天消息不再
  输出 Task 工作流状态；同时验证 Task 关联入口的精确尺寸/token，以及回复预览保留
  `actorId` 并复用共享 Agent 头像。
- 后端必须验证非成员不可读取、只有 Room owner/admin 可以移除 Agent 关注者，且人类关注切换
  不改变 Agent 关注者名单。
- `scripts/run-real-browser-gate.mjs` 必须在隔离 Chrome 中验证 400px 默认宽度、360px 键盘
  下限、8px 手柄、62px 标题栏、真实指针双向拖拽、provisional 关注/取消关注、操作菜单内容、
  Agent 关注者多项独立移除/撤销/5 秒过期与 Escape 关闭。人工验收另在 1280×720 比对 Raft；移动/窄屏
  继续作为右侧浮层，隐藏桌面拖拽手柄。
