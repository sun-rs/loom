# 第三方本地代码／行为映射审计（2026-08-31）

## 结论与审计边界

当前源码不能宣称 Raft 前端行为已闭环。主要问题不是缺一个中央服务器，而是已有本机 owner 的状态没有正确接到 UI：Computer 把混合 Runtime availability 当在线状态，Activity 的持久已读水位没有接到导航／Room／DM 提醒，Notifications 仍是待答 InputRequest 的窄投影。另独立复现了 Activity 点击预检晚返回导致导航倒退。

本审计只读取源码、当前官方归档和相关 owner 文档，执行隔离 fake／内存检查，并新增本文件；没有修改产品代码、访问生产数据库或凭据、调用付费 CLI、操作用户服务、提交、部署或重启。浏览器由另一审计工序独占；这里不把 SSR、源代码断言或历史截图当本轮真实浏览器通过。

分级：P0 为已证实的严重安全／数据完整性问题；P1 为核心可见状态错误、漏提醒或导航错误；P2 为次要交互、能力／权限差异。分类分别使用“真实缺陷”“设计差异／合同缺口”“证据不足”。本子审计未确认 P0，不等于完成安全认证。

### 检查的源码版本

- 工作目录：`/Users/sun/Code/repos/rah_os`。
- 审计时 HEAD：`72c75938ebeb2e552b34b654cfb763271b224b41`；工作树有大量已修改及未跟踪文件，结论针对读取时的工作树，不仅针对 HEAD。
- 当前官方冻结入口：`index-BoAC7nSE.js`，SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
- 未检查正式进程当前服务的资产哈希。因此“旧正式页面缺 Enter”等现象不能反证当前源码仍缺 Enter，也不能把当前源码修复反称正式部署已升级。

关键本地文件 SHA-256：

| 文件                                                  | SHA-256                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------ |
| `apps/web/src/App.tsx`                                | `9482886f46e82787e9023bb6a89e32894ffb7abc00333dbc6238053176aa7f04` |
| `apps/web/src/components/workspace-navigation.tsx`    | `0561c4d2de06230ec510de4f24b88edc8390e8eb0eaac61c99d0331c2f6a4342` |
| `apps/web/src/components/workspace-catalog-panes.tsx` | `2cf7350fd3fb4932923e763a536b6e4a5f78e3a8293f3a3671b08d1335ebc7ef` |
| `apps/web/src/components/global-discovery.tsx`        | `2c862922687487e09edbb1412c27c2b9dc2e5c0d3add8c7a1840d2c3a30006fd` |
| `packages/kernel/src/human-activity.ts`               | `7d8c0013a67f3852df055e73c05b6928a7fe5ccaf916d5ea77024d5c32b90520` |

## 圆点／计数的实际映射

不要把以下几类状态合并成一个 `unread` 或 `disabled`：

| 表面                  | 当前本地计算／渲染                                                                                    | 点击后的真实结果                                             | 裁决                                     |
| --------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | ---------------------------------------- |
| Activity 主导航       | `workspace-navigation.tsx:59` 仅 active/icon/label/onClick，没有未读参数                              | 打开 Activity，不直接推进水位                                | 缺提醒接线；不是 Kernel 没有未读模型     |
| Notifications 主导航  | `App.tsx:1922` 使用 `humanInputRequests.length`；`workspace-navigation.tsx:131` 渲染粉色数字 badge    | `App.tsx:1924` 只切换浮层；不清除 badge，不标 read           | 是“待答数”，不是通用未读通知粉点         |
| Computer 主导航       | `workspace-navigation.tsx:77` 没有在线／离线／attention 点；可点击                                    | 打开 Computer 页                                             | 不能用按钮未 disabled 推断 Computer 在线 |
| Computer 列表／详情点 | `workspace-catalog-panes.tsx:34` 的 `runtimes.some(available)`，`:102`／`:152` 输出灰／绿点           | 点击只设置本地 selected                                      | 在线事实取错来源，见 P1-L01              |
| Room 侧栏             | `workspace-navigation.tsx:234` 只渲染 `#`、名称和 selected，没有 unread 字段                          | 选择后，由实际可见 Message 推进 Human read 水位              | 缺 Room 未读提示，不是没有 read owner    |
| DM 侧栏               | `workspace-navigation.tsx:254` 没有未读计数／粉点                                                     | 选择现有 DM 或调用既有 direct-room owner                     | 头像上的绿色 presence 不是未读提示       |
| Agent 头像 presence   | `agent-directory-pane.tsx:1786` 仅 `runtimeAvailable && state === enabled` 时出现；不可用时不渲染灰点 | 头像另有 preview／详情入口                                   | presence、启停策略、消息未读必须分开     |
| Activity 卡片         | `global-discovery.tsx:806`／`:862` 使用 canonical `unreadCount`                                       | 打开准确上下文后由 viewport 确认；显式 read/done 调用 Kernel | 有真实持久模型，不能扩大成所有提醒闭环   |

`product.css:44` 的 disabled 只是透明度和禁止指针；`:53` 的粉色 badge 是有数字的 16px 胶囊。Computer 灰点来自 `computer-directory.css:115` 的 presence-off 背景。这些 CSS 不能生成缺失的数据事实，也不是同一种通知。

## P1 问题

### P1-L01：Computer 在线状态被 Runtime 可用性替代【真实缺陷】

证据链：

1. `App.tsx:367` 调用 `host.runtime.list`；SDK `packages/client-sdk/src/index.ts:568` 将其映射为 `POST /v1/local/runtimes/list`。
2. `packages/application-service/src/client-application-service.ts:394` 调用 daemon 注入的 local Runtime inventory，而非 Computer read model。
3. `packages/daemon/src/local-runtime-inventory.ts:103` 对 **configured** Runtime 的 `available` 同时检查既有 probe 和当前 canonical Offer。不能笼统说所有 `available` 都只是 PATH。
4. 但 **discovered** Runtime 的 `available` 只由找到可执行文件决定（同文件 `:199`）；`:151` 又把 configured 与未匹配 discovered 合并。
5. `ComputerRuntimePane` 在 `workspace-catalog-panes.tsx:34` 对这个混合数组做 `some(available)`，再以“已连接／离线”显示。即使唯一 available 条目尚无配置、无 Offer，也会显示已连接。
6. `App.tsx:352` 至 `:422` 的 inventory effect 依赖只有 `[client]`。Room 的 `reload` 轮询（`:692`）不重读 inventory；所以后续 Offer／Host 变化也不会及时更新这里的副本。

隔离反例：直接 SSR 执行未修改的 `ComputerRuntimePane`，仅提供 `hostId: audit-host` 和内存 props（图标 URL 由测试模块加载器代替，未修改状态算法）：

| 输入                                                                                      | 实际输出                                                |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `runtimes: []`                                                                            | `showsConnected=false, showsOffline=true`               |
| 一个 `available:true, configured:false, source:discovered, agentBindings:[]` 的 fake 条目 | `showsConnected=true, showsOffline=false, onlineDots=2` |

第一行说明此组件无法表达“Computer 已连上、但没有已安装 CLI”；第二行说明“发现 CLI”足以制造连接状态。它们是实际组件输出，不是读取真实主机状态后的结论。

还有同源问题：`:35` 先筛 `available && configured`，`:205` 把其 Agent bindings **一律**显示绿色“在线”；binding schema 只含 Agent ID/handle/participant ID，不含 Agent enabled 状态。暂停 Agent 可以继续列为在线。Agent 资料 hero 的 `<i>` 也没有状态 class（`agent-directory-pane.tsx:1270`），CSS `agent-directory.css:407` 固定 mint，而旁边文字可能为“已暂停／不可用”（`:1845`）。

最小 owner 方向：沿既有 Kernel Host record（`room-kernel.ts:3300` heartbeat、`:3392` listHosts、`host-projection.ts:19` 的 state/lastSeenAt/instanceId/buildVersion）提供经授权、带 freshness 的 Computer read model。不要在 React 以 CLI availability 推断心跳，也不要把 persisted `online` 字符串脱离 lastSeen 新鲜度直接使用。Runtime ready、Agent paused、Host offline、UI capability disabled 分别投影。现有本机 daemon 可以提供这些事实，不需要 Raft 在线或外部中央服务。

### P1-L02：Activity／Room／DM 未读提示在主入口缺失【设计差异／合同缺口】

当前导航和侧栏未消费任何 Human unread 状态，见上表。独立 SSR 执行 `Rail({active: activity, notificationCount:3})`，八个主入口中只有“通知，3 项待处理”渲染 badge；Activity、聊天、Computer 等均没有。

可重现交互：在隔离 fixture 中让另一 Human 或 fake Agent 给非当前频道／DM 发消息；`activity.list` 会报告未读，但侧栏行和 Activity 导航不会出现相应提醒。打开、标读、新内容再出现的**入口圆点闭环无法成立**，因为圆点本身未接入。该反例的本轮证据是静态接线、真实组件 SSR 和 Kernel 测试，不是本子审计的浏览器截图。

不能为此另建客户端通知真相：

- `packages/kernel/src/human-activity.ts:55` 从 canonical Message 加载当前 Human frontier；`:65` 对“非本人、seq 大于 read_seq”的消息计数。
- `:69` 使用 `latest_seq > done_seq` 决定进行中；`:163` 用 `MAX` 单调推进 read/done。Read 不等于 done，done 不等于 Task completed。
- SDK 已有 `activity.list`／`activity.mark`／`activity.follow`（`discovery-operations.ts:26`）；HTTP 路由 `client-discovery-routes.ts:44` 委托 `HumanApplicationPort`，后者在 `human-application-port.ts:122` 委托 Kernel。
- 如果官方 Activity 点仅表示“有未读卡片”，当前 `activity.list({workspaceId, filter: unread, limit:1}).total > 0` 已能提供全范围判断：`total` 在分页前 SQL COUNT（`human-activity.ts:92`），不是 `items.length`，也不是消息条数。
- 若需要未读消息总数、提及优先或每 Room／DM 摘要，应在同一 HumanActivity owner 提供轻量聚合。不能把已加载第一页 `items[].unreadCount` 相加冒充整个 Workspace，不能用 Room transport ack 代替 Human read。
- 顶层 Room read 调用在 `App.tsx:2123`，Thread read 在 `:2222`；viewport 测量由 `use-visible-message-read.ts:21` 完成，overscan 不等于阅读。

现有 Kernel 测试确认 read/done 分离、并发新回复越过旧水位重新出现、重开数据库恢复（`packages/kernel/test/global-discovery.test.ts:388`），但没有证明 rail／Room／DM 点。

### P1-L03：Notifications 实际只承载待答 InputRequest【设计差异／合同缺口】

`App.tsx:284` 对所有可访问 Room 请求 `inputRequest.list(state:pending)`；`human-inbox-projection.ts:10` 再筛指定 responder 并去重。`HumanInboxCenter` 的 item 只有“查看 Room／回答”（`human-inbox.tsx:79`），没有单条已读、全部已读或通用通知历史。

因此：

- 打开／关闭通知只切换浮层，不清 badge；这对“尚待回答的任务数”是合理行为，不应修成“点开就把 InputRequest resolved”。
- 回答成功调用 canonical resolve，列表才移除该 InputRequest（`App.tsx:321`）；看过但未回答仍然待处理。
- 普通频道消息、DM 新消息、Agent 状态或 Computer 离线，不会仅因此进入这个列表。
- 面板空态写“暂无通知”（`human-inbox.tsx:58`），只能证明没有待答 InputRequest，不能证明系统没有任何未读内容。

最小方向是先冻结通用 Notifications 与 Activity／InputRequest 的产品关系，再接现成 owner 的只读通知投影及独立已读状态。保留 InputRequest 完整业务生命周期；不要用 read/dismiss 假装回答，也不要反过来用 pending 数冒充通用未读。

### P1-L04：Activity 卡片预检晚返回可覆盖较新的导航【真实缺陷】

`global-discovery.tsx:703` 的 `mark(item, read, true)` 先 await `message.context`，未传 AbortSignal，也没有 workspace／navigation epoch 校验；成功后 `:707` 无条件调用 onOpen。父级 `App.tsx:212` 的 `openDiscoveryLocation` 会 push URL、setActiveRoomId、setSurface(room)。卸载 Activity 不会取消这个 promise。

本轮从 TypeScript AST 提取并执行**原始 mark 函数**，用可控 Promise 代替 client.request；待查询时把模拟页面从 activity 改为 settings，再完成查询，得到：

```text
user navigated while context pending -> settings
late onOpen -> room:old-room
finalPage -> room:old-room
```

这是源函数级反例，未启动浏览器或修改产品。真实浏览器补测应在隔离服务延迟 `messages/context`，点击 Activity 卡后切 Settings／另一 Workspace，验证晚响应不抢导航。不要误以为 `useDiscoveryQuery` 的 AbortController 已覆盖这里：预检调用没有经过它。

应由已有导航 owner 校验最新意图；失败／失效只结束旧动作。当前官方 `RefText-DkZjWJTy.js` 的导航 resolver 在 await context 后检查 authority（UTF-16 约 2,000），这至少说明合同不能忽略异步目标失效。

### P1-L05：Agent 动态只有来源 Room 链接，没有工具精确目标解析【设计差异／合同缺口】

`agent-directory-pane.tsx:1607` 将诊断 detail 作为普通字符串；`:1619` 仅追加 `activity.context.roomId` 的“对话”链接。Kernel `runtime-trajectory.ts:107` 将 Room 绑定为 **RunAttempt 的 Room**；`:287` 的 context 只有该 Room 的 ID、名称和 kind。它没有声称这是工具实际操作的 Task／Thread。

当前官方 `RefText-DkZjWJTy.js`（UTF-16 约 1,232、2,000）则识别 `#频道`、`#频道:短号`、`dm:@成员`、`dm:@成员:短号`，从可见频道／Thread 数据解析，必要时 GET `/messages/context/:shortid` 并携带 channelId，失效目标保留文本。

可重现反例：fake 轨迹来自 Room A，但文字包含已授权 Room B 的消息列引用；本地文字不会成为 B／Thread 精确链接，只能点击附加的来源 A。“能点击对话”不等于“动态指向操作对象”。

最小方向：沿已冻结合同采用受约束候选引用 resolver，落到已授权 stable ID＋existing message.context／navigation owner，并检查异步 scope；不把 provider 日志转换为 canonical Message，也不允许任意诊断 URL 获得文件／Room 权限。

## P2 问题及已核对边界

### P2-L06：工作区文件树与冻结合同仍有多项差异【设计差异／合同缺口】

| 行为                 | 当前官方归档证据                                                                | 当前本地证据／反例                                                                                                |
| -------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 逐级文件列表／读预览 | `AgentDetailPanel-DKwoNvgK.js` UTF-16 21,536、约22,300                          | 已有 `agent.workspace.list/read`，不是静态假树                                                                    |
| 刷新保留展开         | 同模块约22,800，刷新根后遍历原 expanded set 重新读目录                          | `agent-workspace-browser.tsx:126` 的 key 包含 revision；`:208` 的 expanded 随 remount 清空。展开两级后刷新会折叠  |
| 文件树拖宽           | 同模块 23,231／24,280：default256、min160、max600、8px命中区、pointer up/cancel | `agent-workspace.css:57` 固定256、max50%；组件没有文件树 separator／pointer resize                                |
| 复制路径反馈         | 同模块 23,401：成功后1500ms归零                                                 | `agent-workspace-browser.tsx:60` 只 setCopy(true)，没有 timer/reset；成功提示持续到卸载                           |
| 隐藏文件偏好         | 同模块约21,200、23,000，按 Agent key 记忆                                       | 本地 `:21` 仅 useState(false)；切 tab／Agent后卸载重建会丢偏好                                                    |
| 选中样式             | 同模块文件行 pink/20＋右侧pink边线                                              | 本地 CSS `:105` 为 yellow，无相同右边线                                                                           |
| 紧凑布局文件／树切换 | 同模块约23,900 的 selected/compact 分支隐藏一侧                                 | 本地 CSS 无 compact媒体分支；始终横向 tree+preview，只有关闭预览按钮。390布局需实页复核，不能因桌面可读称移动对齐 |

文件根目录差异应继续公开：本地 `agent-workspace-browser.tsx:177` 明确是 Agent 私有目录、不是当前项目 cwd。官方显示 runtime profile workspacePathRef（缺省私有 home）；不能把本地 private-home 内容冒称项目文件树。

实际本地链已经存在且无需 Raft：

`AgentWorkspaceBrowser` → `agent-workspace-operations.ts:4` typed SDK → `client-agent-workspace-routes.ts:37` Human manager授权（I/O后再次校验）→ daemon `daemon-application-support.ts:68` → `agent-memory-coordinator.ts:208` → AgentHost `agent-workspace-browser.ts:92/154` → 本地私有文件系统。

Host 实现拒绝路径穿越、symlink／非普通文件／多链接文件，限制 secret预览、文本1MiB、图片5MiB、扫描／结果数。隔离测试通过不等于对所有文件类型和竞态做完安全证明。官方 Computer 离线只阻碍现场取得官方成功文件内容，不阻碍本地 owner 实现这些冻结行为。

### P2-L07：资料／hover的读写权限合同尚未分层复核【设计差异／证据不足】

`agent.get` 路由直接使用 `getWorkspaceAgentManagementView`（`client-application-service.ts:732`），Kernel `workspace-agent-management.ts:101` 要求 control Room owner/admin。`agent.trajectory.list` 则允许有相应 membership 的 Human（`runtime-trajectory.ts:205`）。

头像 `AgentPreview` 在 `agent-message-identity.tsx:66` 将二者放在 Promise.all；普通 member 的 agent.get 失败会令已经授权的 trajectory 也不进入 state，整个“最近动态”变为无法读取。资料页 `agent-directory-pane.tsx:200` 同样无条件调用管理读取接口，再把其结果用于角色、runtime/model显示。

普通成员不能修改 Agent 是合理权限边界；“能看 Agent 但查看摘要必须拥有管理权”是否有意需要独立产品裁决。同期官方源码审计提供定位后，本子审计复读确认：hover最近轨迹本就受 manageAgents／Agent人类creator条件限制（当前index的Ctt，UTF-16 `[2864746,2864825)`；RO约2,867,100条件调用loadTrajectoryLog）。因此本地member缺少hover轨迹**不能直接判成需要放开权限的缺陷**，本地允许读取轨迹的范围也不能自动视为官方等价。官方基础身份、Computer/runtime/model卡片与受限轨迹是分支显示，不应混成一个授权成功／失败结果。应先区分公开身份摘要、管理配置、受限轨迹三种字段，再决定是否使用最小只读profile以及局部查询失败策略。不得为了修hover放开管理／私有文件权限。本轮未在官方普通权限账号下核对角色矩阵，故将该项列为需冻结合同的设计／证据缺口。

### P2-L08：资料按钮／数据字段存在但不等于功能完整【设计差异／合同缺口】

- 名称／描述编辑、runtime/model/effort 编辑沿既有 agent.manage owner，有实际入口（`agent-directory-pane.tsx:1276`、`:1311`）。
- 重启／重置按钮明确 disabled（`:1374`）；报告问题 disabled（`:1383`）；“已创建的 Agent”固定0并说明 projection未接（`:1343`）。它们不能记为已完成操作。
- Computer 名称派生 hostId（`workspace-catalog-panes.tsx:263`），描述固定“暂无描述”（`:159`），当前 model缺 hostname/OS/arch/注册来源/last heartbeat等字段。没有只因本地拓扑就必须删除这些产品字段的理由；但 CLI安装和账号配置不是本批待开发项。
- 头像 hover和点击已拆分：preview `PreviewCard` 在 `preview-card.tsx:41` 使用200ms打开／120ms关闭，`:80` 支持Escape／outside／focus；点击 `agent-message-identity.tsx:30` 打开共用详情。姓名 `conversation-panes.tsx:753` 插入 canonical handle，而非打开头像详情。这些有真实接线，但本子审计未做鼠标／390焦点的浏览器验收。
- 点击头像的默认tab也有差异：本地 `agent-directory-pane.tsx:97` 固定 panel→activity、完整页→profile；官方当前index约2,913,241的vrt发送 `defaultAgentTabIntent: ordered-first`，相邻brt按保存顺序选择有效tab。不能把某张官方“打开在动态”的截图当成所有用户都应固定activity的合同。

### Enter 不是当前源码的未实现项

`composer-keyboard.ts:4` 被 Room/DM 与 Thread 共用（`conversation-panes.tsx:455`、`:989`）。Enter 通过同一 enabled submit按钮 requestSubmit；Shift+Enter、IME确认、repeat和已经被候选消费的事件不发送。按钮disabled涵盖上传／pending／permission／Task校验（`:488`、`:1004`）。本轮四项键盘测试通过。

这不等于所有官方快捷键完全相同：移动粗指针 Enter换行、Ctrl/Meta+Shift+Enter强制Task是已声明未复制的分支；也不证明旧正式资产已带当前实现。

## 本轮执行与缺失的验收

执行命令（隔离 fake／临时数据库，不运行 paid gate）：

```sh
node --test \
  packages/kernel/test/global-discovery.test.ts \
  packages/agent-host/test/agent-workspace-browser.test.ts \
  apps/web/test/composer-keyboard.test.ts \
  apps/web/test/human-inbox-projection.test.ts \
  apps/web/test/agent-trigger-contract.test.ts \
  apps/web/test/identity-interactions.test.ts \
  apps/web/test/global-discovery.test.ts \
  apps/web/test/agent-activity-projection.test.ts \
  apps/web/test/agent-trajectory-window.test.ts
node --test packages/daemon/test/local-runtime-inventory.test.ts
```

结果：第一组37通过，第二组4通过；0失败、0跳过。另执行上述真实组件SSR和原始点击函数延迟反例。SSR加载器仅处理TSX/CSS/静态图标包导入，第一次受Vite资产导入方式限制，补齐测试加载后成功；这不是生产功能报错，也没有被算成产品缺陷。

未执行全仓 `npm run check`／完整format／release gates，因为本子任务不修改产品，只做定向审计；不能把41个通过称为完整工程门禁。

最缺的负向验收是：

1. 未读超过一个分页、后台Room/DM来信、显式已读与新消息并发、Activity/Chat/DM入口提示同步；逐项验证而非仅调用SQL。
2. Notifications看过但未回答、完成回答、普通通知与InputRequest并存的不同生命周期。
3. Host在线无CLI、Host离线但CLI仍被发现、Offer不可用、Agent暂停、inventory失败／恢复；灰点和按钮readiness不得混用。
4. Activity预检晚返回期间切页面／Workspace；Agent/文件查询乱序和权限撤回。
5. 同尺寸桌面及390×844真实鼠标／键盘：文件树展开后刷新、拖宽上下界、复制1.5秒反馈、移动tree/preview返回、普通member hover。

## 架构裁决

保留本机 Kernel 的持久 Room／Task／Inbox／Human frontiers；由 AgentHost 处理 provider结构化运行诊断。当前 `runtime-trajectory.ts` 的表与 Room Message相分离，append需匹配Host generation、RunAttempt和prepared runtime，查询重做Room ACL；这条边界应继续保持。

Local-first 是单机可自足的持久 owner与受限本地文件能力，不是“静态页面＋不能访问文件”，也不是“必须复刻 Raft中央服务器后才能补按钮”。本次修复排序应为：先纠正状态来源与入口提醒、补晚返回导航护栏，再补既有文件树／精确引用合同；不重新制造第二套持久通知队列或 provider transcript消息真相。
