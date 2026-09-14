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

## 打开中的消息列持续同步

Thread 明细读取必须跟随已提交的 Room 同步结果，不能只依赖会被 runtime/catalog 刷新取消的 reload 定时器。继续复用 MessageSession 的增量与历史窗口；切换目标后，异步引用状态不得写回旧 Thread 的结果。对应 [实时更新修复与双边证据](../audits/2026-09-08-thread-live-repair.zh-CN.md)。

## 2026-09-13：关注 Agent 行打开侧栏

来源：2026-09-08 冻结官方 `index-BVfbaScj.js`（SHA256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`）中 `thread-follower-profile-row` 是 `flex-1` 的独立按钮；点击先准备 Agent 信息再打开 Agent panel，移除按钮是旁边独立 sibling。沿用现有 Raft Thread 合同，不为该行引入 Multica 的其他导航模型。结构移植，发布 bundle 仅为证据。

本地 ThreadPane 通过已有 AgentMessageContext.onOpen 进入与聊天头像相同的右侧 Agent inspector，沿用 navigation.resolve 的身份校验与异步导航围栏，不整页跳转或修改 Thread 业务状态。点击关闭关注者弹层；侧栏内容与默认 tab 沿用既有 inspector。整行头像/文字/空白内容共用原生 button，支持 Enter/Space；“×”是独立移除按钮，错误/撤销逻辑保持不变。没有可用导航 context 的隔离组合中入口禁用，不连接虚假成功。

专项 `scripts/test-thread-follower-profile-browser.mjs` 先复现原行不存在可操作入口，再验证头像区和空白区点击、Enter/Space、频道 URL 不变、真实既有侧栏打开，以及移除失败时只显示原错误、不打开侧栏。使用临时 daemon、Fake CLI 和受控关注者响应，无正式业务写入、无付费 CLI。原综合门禁移除按钮定位改为独立 remove class，避免把新增资料按钮误作删除操作。完整 `npm run check`、格式检查、diff 检查与正式构建通过。空闲检查、持久状态备份和优雅重启后，冻结构建 `d278a2743bd3a163cae3e6b8e11d545a3ef6b8f398d7bc387d88a05023050ccd` 经 loopback、LAN、Tailnet 三个正式入口的全新 Chromium 页面验证：使用原有消息列及关注记录，点击行后既有右侧 Agent 侧栏打开，频道 URL 不变。截图已检查；未发送消息、改变关注关系或调用付费 CLI。

## 2026-09-14：操作菜单与数量入口稳定性

使用较新的官方 `index-MqTUR4Ez.js`（SHA256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`）的 `Adt` / `kR` 作为本次证据：菜单依次为搜索、新标签页、频道定位和按真实状态关注/取消；14px medium 文字、14px stroke-2 图标、8px gap、12px/8px padding、192px 最小宽度、4px 弹层间距。`g6e/Ose` 与 `b6e/Gv` 的 Lucide ISC 几何作为带版本说明的精确图标追加到 ui-tokens；保留原 sprite 冻结哈希，仅独立校验追加块。三点不再使用依赖字体的 Unicode 字符。

新标签页通过既有 navigationSearch 生成当前消息列的同源地址，以 noopener/noreferrer 打开，不移动当前频道。关注菜单仍由真实 Human following 状态驱动，不能为匹配截图强制显示取消关注。

数量入口原先以解析后的 followers.length 为显示条件，空数据或身份目录暂未解析时会卸载按钮；同时 thread.followers 没有可见页定时恢复。按用户要求，RAH 现在保留数量按钮与真实 0 的空态（此处有意不同于 Raft u9 的零成员隐藏规则）；计数使用后台 agentParticipantIds 长度，头像使用已有目录解析。沿用 useDiscoveryQuery 的可见页 5 秒刷新及 focus 刷新、AbortController 和 queryKey 隔离，覆盖后台新回复带来的关注变化，不新增队列或业务状态。

专项浏览器测试先复现菜单缺项，再验证菜单顺序/字号/图标尺寸、新标签页地址及原页不变、零成员时入口保留，以及随后后台关注者增加无需重载便恢复计数。原关注行的鼠标、键盘和独立移除测试继续通过。`npm run check`、`npm run format:check`、`git diff --check` 和正式 Web 构建通过。正式服务已在空闲检查和持久状态备份后安全重启，冻结 Web 构建为 `94ebae7e486821a79a60b89878db043cdfdbbfff83d7520578ab26f7e82d43a9`。新开的 Chromium 页面在本机、局域网和 Tailnet 地址均通过菜单、新标签页同一消息列和 390px 窄屏无横向溢出检查；这是本机浏览器验证，不代表 iOS 实机或 Raft 在线双边验收。
