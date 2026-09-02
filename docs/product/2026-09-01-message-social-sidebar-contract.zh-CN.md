# 消息回应、私人收藏、侧栏排序与官方头像库

## 施工前合同与复核

来源是获授权的 Raft 已发布 Web：`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`，以及同目录 `SavedPanel-BvhJ1TDV.js`。下述位置为 UTF-16 字符偏移，不是原始 TS 行号。服务端实现未被发布；本地数据库实现属于 RAH glue，不能称为复制 Raft 服务端。

| 官方触发                           | 源码／请求事实                                                                                                                | 显示与范围                                                                   | 本地 owner / 适配                                                                                 |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 消息右上添加回应、已选回应再次点击 | `$tt` 2878140 附近；POST/DELETE `/messages/:id/reactions`，`{emoji}`；GET `/messages/:id/reactions/viewer`                    | 共享计数与本人是否回应分开；本人只能撤销自己的回应                           | Kernel MessageSocial，共享消息注解；原子去重、鉴权、版本化结果；不创建 Task 或 Activation         |
| 消息右上收藏／取消                 | `Tb` 2409k–2412k；POST `/channels/saved {messageId}`、DELETE `/channels/saved/:id`、POST `/channels/saved/check {messageIds}` | 当前用户私人收藏，不是频道置顶，不是广播消息                                 | Kernel MessageSocial 私人关联；保持消息引用，每次读取重新 ACL 校验                                |
| 左侧已保存                         | SavedPanel `re/ae`；GET `/channels/saved`，limit/offset/q/channelId/sort                                                      | 时间排序卡片、移除、点击回到原 Channel/DM/Thread 消息                        | 同一 owner 有界分页；本地沿用已有 exact message context deep link；改为稳定游标，避免 offset 漂移 |
| 侧栏排序                           | `FW/Sj` 2730197，manual/recent/az；`updateSidebarOrder` 1739000 附近 PATCH `/servers/:id/sidebar-order`                       | 每个用户、每个空间独立的顺序和模式；版本冲突重载；迟到响应不能写入另一个空间 | Kernel HumanSidebar；Workspace + Human CAS；前端单飞提交、失败保留权威快照                        |
| 拖动频道／私信至已置顶，组内拖动   | `H5e/GA/Lf` 1729448，typed identity 去重；DndKit sensors/drop target；pinned、channelOrder、dmOrder                           | 手动顺序保留；recent/az 不以拖动悄悄覆盖；置顶不是 Room 公共配置             | 复用现有 DndKit；Room/peer 稳定引用；共享频道设置置顶入口；键盘有等效入口                         |
| Room 静音活动                      | 官方频道偏好开关；文案明确“只影响你”                                                                                          | 抑制当前 Human 的普通 Activity/未读摘要；精确 mention 仍保留                 | 复用 HumanSidebar CAS 的 `mutedActivity`；Kernel 查询层执行，不靠前端隐藏                         |
| Room 折叠长消息                    | 官方频道偏好默认开启；设置说明使用“「显示更多」开关”，消息正文按钮使用“展开全文/收起”                                         | 当前 Human×Workspace×Room 的显示偏好；关闭后此频道始终全文                   | `expandedLongMessages` 存显式例外，默认折叠；Chat 与 Thread 共享一个测量组件                      |
| Agent 默认头像                     | `JI/Kne/Z6` 1855376，18 个固定 8×8 预设，finch/mug 为保留项                                                                   | 官方库仍是像素风格，但不是程序随机造图                                       | ui-tokens 原样资产；protocol 共享预设键；Kernel 从尚未使用的 16 个普通预设随机选取                |

### 快捷回应与收藏的指针合同

- Raft 的快捷回应 portal 为 224×40，2px 黑边、4×6px 内距、2px 项间距和
  `0 4px 12px rgb(0 0 0 / 8%)` 软阴影；七个按钮各 28×28、圆角 4px，sprite
  实际显示 18×18，并在按钮中以 flex 双轴居中，中心偏差必须为 0。
- 快捷回应项不使用 brutal 边框/位移；hover 为 `brutal-pink/20`，并用原生
  `title="用 {emoji} 回应"` 显示 tooltip。trigger 与 portal 间允许指针跨越；离开二者
  后 120ms 关闭。外点、Escape、scroll、resize 立即关闭，点击回应立即关闭。
- 消息右上回复/回应/收藏按钮 hover 使用 `soft-signal`，即 yellow/30，不用粉色。
  收藏成功后书签 glyph 为官方 `brutal-orange`（`#F8A16F`），不是纯黄；正文下新增
  20px 高的“已保存”徽标，orange/15 背景，点击该徽标等价于“从收藏中移除”。
- “已保存”、Thread 摘要、快捷回应计数等消息后置状态共享一个 `flex flex-wrap`
  摘要行，项间距 6px，不各自占一行。本人回应 chip 和“已保存”徽标都可直接点击取消；
  本人回应底色为 pink/20，hover 为 pink/30。
- 回应不是单选。官方消息模型是 `reactions[]`，按 emoji 找索引，未存在的 emoji 追加，
  渲染层对全部正计数项逐项 `map`；因此一个身份可在同一消息上同时保留多个不同 emoji，
  但同一身份×同一 emoji 仍是一个集合成员。回应 chip 为 20px 高、4px 圆角、左右
  6px 内距、4px 图标／计数间距；sprite 15×15，计数 12px/700、`Space Mono`、
  tabular nums。`Space Mono` 必须加载 Raft 发布包引用的本地 woff2，不能只声明 family
  后退回系统字体；每个 chip 外有 `inline-flex` slot；父摘要 flex-wrap 后才在确实不足宽时换行。
- “已保存”徽标同为 20px 高，1px 黑边、左右 6px 内距，图标 10×10、文字
  10px/700/leading-none；hover 使用 100ms `brightness(.9)`，键盘 focus 为 2px 黑 outline。

### 已保存聚合页合同（2026-09-02 复核）

- Raft `SavedPanel-BvhJ1TDV.js` 的独立页面挂载时固定调用
  `loadSaved({query:"", sortDirection:"desc"})`，store 每页请求 20 条；请求层另保留
  `q`、`channelId`、`sort`，但当前独立页面**没有**渲染搜索、Room 筛选或排序控件。
  RAH 不为追求“功能更多”而自行添加这些不可见控件，只在协议与 Kernel owner 保留等效查询能力。
- Raft 服务端响应可观察字段为 `saved / hasMore / total / globalTotal`，消息卡片按收藏时间倒序。
  RAH 的 `message.saved` 对应返回筛选总数 `total` 与当前 Workspace 可见收藏总数
  `globalTotal`；分页改用冻结、查询范围绑定的 opaque cursor，而不是照抄 offset 漂移。
- 非空卡片是一个完整点击面：2px `black/30` 边、12px 内距、12px 间距；hover、active、
  键盘 focus 或右键菜单打开时转黑边和 2px brutal shadow。元信息依次为动态 `#Room`／
  `@发送者`、可选“消息列”、14×14 `preview-mini` 头像、姓名、相对时间；正文为 14/20，
  最多三行。点击回到精确 Channel/DM/Thread 消息，不只打开 Room。
- 卡片右侧移除入口为 28×28、orange/15 底、14px 橙色实心书签，hover 仅
  `brightness(.9)`；指针/键盘停留显示同色底、2px 黑边、2px shadow 的“从收藏中移除”提示。
  右键菜单按官方顺序提供“复制链接 / 复制 Markdown / 分隔线 / 从收藏中移除”；链接使用
  本地 typed message deep link，Markdown 项复制原始消息正文。菜单项按共享 Raft `sr` 使用
  14/20、500、`8px 12px` 内距和 yellow/30 hover，分隔线为 2px 黑线。冻结 Saved 源码只直接证明
  backdrop dismiss；RAH 另补 Escape（还焦卡片）、方向键/Home/End、滚动和 resize 关闭作为本地键盘与防悬空增强。
- 首次加载使用 6 行官方结构 skeleton；空态原文为“暂无收藏的消息 / 选择消息上的书签图标即可保存。”；
  标题栏为 62px 高、左右 20px，36×36 `size-icon-header` 黄色图标容器和 18px 书签，
  副标题为“{count} 项”。36px 是 2026-09-02 官方实页 computed style，覆盖早先按类名推断的 40px。
  滚动容器 16px 内距，无额外“刷新”按钮；无限滚动 sentinel 的 root margin 为 `240px 0px`。
- Raft 只发布了 Web 请求和投影代码，没有发布 `/channels/saved` 的服务端实现。RAH 的
  SQLite 私人索引、Unicode-aware lowercase 子串匹配、ACL 重新校验、冻结游标与幂等 receipt 都是
  `rah-os-glue`；它们实现相同行为边界，但不能记作 Raft 后端 direct copy。

## 经过复核的本地差异

- 收藏、侧栏偏好与现有 Human Activity read frontier 一样属于私人视图状态，不写入共享 Room ledger（否则其他成员能读到私人收藏），也不通知 Agent。共享 emoji 注解写入 Room event，但不 deriveAttention：不会仅因点回应启动／唤醒 Agent，也不会成为一条聊天消息、Task 或记忆。若之后有正常消息等原因创建新的 Activation，其有界 Room range 可以包含该注解，Worker 显式同步历史时能够看到；当前已签发且 `toSeq` 固定的 Activation 不会越界看到后来回应。
- Raft 发布前端把回应作为消息的共享 `reactions[]`，并暴露了 bound Agent credential 的 `messageReactionAdd/Remove` 能力，所以 Agent 可以显式读写可见消息的回应；但网页源码没有证据表明 Human 点回应会自动唤醒 Agent。RAH 保留这种“可观察但不触发工作”的安静反馈语义，不把不确定的服务端行为自行扩成 wake policy。
- 消息回应使用明确 `active=true/false`，不使用重试会反向翻转的服务端 toggle；请求幂等，返回消息注解版本。只允许完整 emoji 序列，不允许把任意文本当反应。
- 对持久化的消息 ID 操作，不把 Provider 输出或暂存 optimistic 消息当 canonical message。Thread 回复也走相同 owner。
- 本地私人偏好采用版本 CAS；冲突明确提示并重载，不覆盖另一个窗口的修改。所有读取／写入都从认证身份取 actor。请求不能指定别人作为收藏者或回应者。
- 头像：保持已选官方预设；旧 provider 占位键映射官方预设；旧 random/未知键只映射到固定官方预设，不再生成像素。不要改写历史 Agent revision 或记忆。新 Agent 在库未耗尽时绝不自动重复；16 个均使用后按最少使用次数分配固定预设，有限库不能承诺无限唯一。明确自选预设仍允许重复。
- sidebar peer 键在尚未创建 DM 时即可存在，创建 DM 后不丢失置顶。未加入／不可访问对象不得通过排序接口越权枚举。
- `mutedActivity` 与 `expandedLongMessages` 都是可见 Room 引用；ACL 变化后读回会过滤无权 Room。PATCH 字段必须是真正可选，不能由 schema 默认值把未提交字段重置为空。
- 长消息是否溢出由实际渲染高度测量；展开状态下不得因容器解除高度限制而反向判定“不溢出”，否则“收起”会消失。Room 偏好同时作用于根消息与 Thread 回复。

## 验收

新增原样资产：`apps/web/src/raft-reaction-sprite.svg` 来自 `https://app.raft.build/reactions/reaction-sprite.svg`，SHA-256 `10912fdacbbfc427fcd1cdd0bc8ad7a2fc0a40fa121ee663f0a8ad19c67499f8`。七个快捷回应使用该固定 sprite，不依赖 macOS/iOS emoji 字体。`smile-plus`/`pin` 图标来自同一官方 bundle 的 `mBe`/`nBe` 路径；资产哈希回归单独固定。

字体同样从冻结 Raft reference 经生成器窄投影进入产品：`official-fonts.css` 与
`Space Grotesk`、`Space Mono 400/700` 三份 woff2 均逐字节校验。回应计数实际使用
`Space Mono 700`；Vite 构建必须产出对应 hashed font asset，浏览器门禁还需等待
`document.fonts.ready` 并确认该 face 已加载。

测试先行覆盖：重复／反向操作、两位 Human 隔离、越权、Room/Thread 范围、重开数据库、并发版本冲突、取消收藏的旧快照、无额外 Activation；预设原样、分配去重和耗尽。

真实浏览器覆盖：消息 hover 工具栏、emoji 选取／撤销／计数、收藏→已保存→原消息（含 Thread）、刷新恢复、排序菜单与拖拽置顶／移出／组内排序、Room 静音/长消息折叠的切换与重开、长正文展开/收起、Escape／外点／焦点、390×844；再走完整门禁和正式版本安全重启。官方与本地实测证据另列，源码合同不等于全部双边验证。
