# 消息回应、收藏、侧栏排序与头像库：交付审查

## 结论与边界

本批从 Raft 已发布源码确认产品合同后接入本地 Kernel，不把图标显示当成业务完成。已实现并通过真实浏览器操作的范围：七个快捷 emoji、共享回应/本人撤销、私人收藏/取消、已保存列表与原消息/Thread 定位、手动/最近/A-Z 排序、拖拽置顶/移出/组内排序、设置页置顶，以及固定官方头像库。

不宣称整个 Chat/Agent 页面与 Raft 100% 一致：联合频道、自定义侧栏分组/emoji、收藏高级筛选/右键菜单、收藏导航条的总数徽标、回应者专用浮窗和个别卡片细节未全量移植。当前回应者名字使用原生 title；官方则有自定义 hover 浮层。消息编辑/删除和其他 Agent tab 原有缺口没有被本批自动消除。

## 复用和本地实现分界

- 原样资产：ui-tokens 中官方 18 个固定头像预设，七个回应的官方 sprite；图形内容不再随机生成。普通自动分配使用 16 个非保留头像，优先未使用，耗尽后按最少使用分配。旧历史 revision 不改写；旧 random 键只做固定库兼容映射。旧生成函数只剩历史单测，不在产品调用路径。
- 源码结构移植：Raft 的明确 add/remove 意图、七 emoji 顺序、shared count/viewer 分离、私人 saved message 引用、manual/recent/az、typed identity 去重和数组移动。React owner、共享弹层和 DndKit 接现有 RAH 客户端，非整站 Vue/minified bundle 搬运。
- 本地实现：SQLite schema 23、Human 身份隔离、ACL、事务/幂等、侧栏 CAS、冻结游标和本地 deep link。没有官方服务端源码证据，不能称为“复制 Raft 服务端”。不使用 OpenAgents，不重新实现 CLI 调用。

源文件/字符偏移、官方请求和对应 owner 见[施工前合同](../product/2026-09-01-message-social-sidebar-contract.zh-CN.md)。

## 浏览器证据

本批使用内置浏览器。官方与本地桌面均为 **1440×1000**；本地另验 **390×844**，已人工查看截图。隔离测试地址 4201 使用真实 daemon/SQLite 与 Fake CLI，不是用户正式版本，也不是本批真实模型验收。

| 操作              | 官方实测                                               | RAH 实测                                                                       |
| ----------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------ |
| 消息 hover 操作条 | 回复/回应/收藏三个按钮；七个快捷 emoji                 | 相同三入口，使用官方 sprite，提交 👍 后本人计数 1，再点撤销                    |
| 收藏              | 收藏后“已保存 1 项”；卡片能返回原消息                  | 收藏后列表 1；刷新仍在；卡片回跳 URL 精确 message ID，显示前后文               |
| 取消收藏          | 测试新增项移除后刷新，已恢复无收藏计数；未修改消息正文 | 列表取消后刷新归零；取消后的旧幂等请求不复活收藏                               |
| Thread 收藏       | 本批未在官方新建 Thread，不计双边写入验收              | 真实 Thread 回复收藏，回跳携带 room、thread root、focused message 三个身份     |
| 排序菜单          | 打开私信排序，显示手动/最近/A-Z；本批未改官方用户顺序  | A-Z 选择回读、手动恢复；鼠标拖 Kimi 至空置顶区，打开新 DM 后刷新仍置顶         |
| 拖拽/设置置顶     | 发布源码合同明确；本批未写官方排序                     | 设置勾选频道置顶，组内改序，Kimi 拖回私信；Alt+P 等效置顶，Escape 关闭排序菜单 |
| 手机              | 本批官方以桌面对照为准                                 | 390×844 无页面横向溢出；取消收藏、侧栏展开与关闭均实点                         |
| 头像              | 官方固定预设是来源基线                                 | Alice/Kimi 显示不同固定预设；单测逐项比对库内容及新建自动分配的去重/耗尽       |

### 2026-09-02 快捷回应／收藏状态补充实测

再次读取相同冻结入口并在登录态 Raft DOM 检查：快捷浮层总尺寸 224×40，按钮 28×28、
4px 圆角，sprite 18×18 且中心偏差为 0/0；按钮 `title` 为“用 ✅ 回应”，hover 为
pink/20 且无边框/硬阴影。源码的
trigger/portal 指针桥接定时器为 120ms；外点、Escape、scroll、resize 立即关闭。顶部三键
hover 为 yellow/30；保存后书签 glyph 常驻 `#F8A16F` 实心态，正文下出现“已保存”徽标。
源码的消息后置摘要父容器为 `flex flex-wrap items-center gap-1.5`，收藏与回应是同级子项，
不是两个纵向块。

RAH Firefox 150.0.2 在 1440×1000 隔离持久 fixture 中逐项实点通过：工具条由 hover
显示；黄色 hover computed style 为 `rgba(255, 212, 64, 0.3)`；浮层 224×40、✅ glyph
18×18、tooltip 文案正确；按钮圆角 4px，sprite 中心偏差 0/0；指针移出后等待 140ms，
浮层已卸载。收藏后把指针移到页面外，toolbar glyph 仍为 `rgb(248, 161, 111)` 且
`fill=currentColor`；与回应同时存在时共享摘要为 flex、gap 6px、两项 y 坐标相同。
门禁分别点击回应 chip 和“已保存”徽标恢复初始状态，没有调用付费 Provider。

官方测试只增删本次回应/收藏，未新发消息、未调用真实 Agent、未修改官方用户排序。曾出现移除后的旧列表再次显示，随后再移除并刷新，确认恢复；不把单个乐观截图当最终成功。

本批最终补测进一步固定了三个此前过宽的“通过”结论：快捷按钮必须是 4px 圆角且
sprite 中心偏差为 0/0；收藏激活后即使指针离开仍是官方 orange 实心态；回应与收藏必须
是共享摘要行的同级项。隔离 Firefox、Chrome 全主链和重启后的正式页面均实点通过并回滚，
正式 `message_reactions` 与 `human_saved_messages` 最终都为 0。

## 测试发现并修正

1. StrictMode effect 重放过早 dispose 消息注解 store，造成按钮持续禁用：真实浏览器复现，延迟到确定 unmount 后释放，再次浏览器提交通过。
2. 迟到读取可覆盖已完成收藏，或卸载/重挂的同一消息：单调 generation fence；失败单测后修复，通过。
3. 拖到自身会移动到组尾、向后拖错一位：按 Raft 目标槽位移植，单测与鼠标排序复验。
4. 从收藏原消息定位后新开 Thread，两个 undefined threadId 相等导致整段 Room 历史误显示为回复：加入明确 Thread 身份门槛和过滤；不修改持久消息。
5. 旧接口枚举、schema 版本和源码布局断言随新合同更新；没有放宽权限/取消关键门禁。

## 自动化与安全

覆盖两 Human 回应计数与私人收藏隔离、越权、幂等重放/反向操作、侧栏 CAS 冲突回滚、删除后冻结分页、ACL 撤销与重开数据库、头像固定库/分配，以及迟到响应和排序边界。共享回应只追加注解事件，不 deriveAttention；私人收藏/排序不增加 Room sequence。

## 正式交付复核

- `npm run check` 完整结束：692 项 package 测试（690 通过、2 个 opt-in 跳过），111 项 Web 单测通过，34 项 callback 回归通过；合计 **835 通过，0 失败，2 跳过**。TypeScript 同时通过。
- `npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过；`npm audit --omit=dev` 为 0 vulnerabilities。构建仍有现存 >500 kB chunk 提醒，不将其报告为性能已全面优化。未额外重跑 Firefox/LAN/全量自动浏览器 gate，本批浏览器操作证据如上。
- 重启前正式实例只有 1 个 completed Activation、1 个 exited RunAttempt、0 Task，无活跃任务。在线 SQLite 备份及文件备份：`/Users/sun/Library/Application Support/RAH OS/backup-before-social-fXfupD`。
- 优雅停止旧 PID 42440；新 PID 61182 监听 **http://127.0.0.1:4173/**，冻结 bundle `f3da1aebe2fd4ab0068209a3bb00673542ed05f9d9ddb9c79b031dfb84b84f6f`，新浏览器实际加载 `/assets/index-DnYJRz81.js`。不是 Vite/Fake CLI 交付。
- 重启后首先比较 8 张受保护业务表及 Agent 记忆，哈希与备份完全一致。随后在正式已有 Codex 私聊消息上真实点击 ✅ 和收藏，刷新保存页、回跳、再撤销；全部成功。没有发新消息/调用模型。
- 正式测试前后：Message 2、Activation 1、RunAttempt 1、Task 0；最终 reaction 和 saved 关联都为 0。唯一预期业务表差异为该 DM 的 `next_seq` 11→13，对应添加/移除回应两条 canonical 注解事件；不删除审计历史。其余 8 表内容、Agent 配置和记忆保持不变。
- 自有 4201 隔离 fixture 已停止，用户正式页保持打开。本批未 commit/push，保留既有未提交修改。

## 后续首批：Room 个人偏好与长消息（2026-09-01）

- `HumanSidebar` 在同一 Human×Workspace CAS 中新增静音普通 Activity 与长消息折叠例外；精确 mention 不被静音，未授权 Room 引用在 Kernel 读写边界被过滤。协议 PATCH 单独定义可选字段，修复了 schema 默认值会重置未提交偏好的问题。
- Chat 与 Thread 复用同一实际高度测量组件，默认在 320px 预览高度折叠，显示“展开全文/收起”。修复展开后 observer 误把内容判为不溢出、导致“收起”消失的问题。
- Room 设置说明已按当前官方 bundle 对齐为“超过预览高度的消息折叠在「显示更多」开关后。关闭后此频道的长消息始终完整显示。”；这里的“显示更多”是设置说明，消息正文按钮仍为“展开全文/收起”。
- `npm run check`：694 项 package 测试（692 通过、2 个既有 opt-in 跳过）、114 项 Web 单测、34 项回归测试，0 失败。`npm run test:web:browser` 通过桌面 1440×1000 与手机 390×844；`npm run test:web:message-timeline` 证明 10,050 条逻辑消息、27 个 DOM row、prepend 锚点偏移 0px；持久化工作台 gate 和 Firefox 桌面/手机 gate 通过。
- 长聊天门禁同时修正无后端 Markdown 测试页缺失 favicon 造成的真实 404；门禁现在记录错误来源 URL 与所有 >=400 响应，不以忽略 console error 通过。
- 正式持久状态备份到 `/Users/sun/Library/Application Support/RAH OS/backup-before-room-preferences-XG6Aqy`，SQLite integrity check 为 `ok`。正式 production bundle 在 `http://127.0.0.1:4173/` 启动，`/_rah/health` 返回 `online`。正式浏览器切换静音与折叠后恢复默认；姓名点击写入 @ 草稿后清空；头像点击打开默认动态侧栏；消息三入口可见。未发送消息或调用真实 Provider。

## 独立审计复核与最终重启

- 独立浏览器审计确认生产 bundle、持久数据、排序菜单、Alt+P、消息回复/回应/收藏、Room 偏好、频道/私信/动态导航、姓名 @ 与头像侧栏主链均可实际操作。审计提到的约 4px“置顶按钮”是专供键盘等效入口的视觉隐藏控件；官方鼠标合同是拖拽到已置顶区域或从 Room 设置切换，本地 Chrome gate 已实际拖拽并验证刷新持久化，不把隐藏键盘控件改造成官方不存在的行内鼠标按钮。
- 独立审计指出 Room 设置说明和正文开关可能混用词语。再次读取当前官方 bundle 后确认：设置说明使用“「显示更多」开关”，正文按钮使用“展开全文/收起”。两处现已分别按官方原文冻结，并增加源码回归测试。
- 最终正式状态再次备份到 `/Users/sun/Library/Application Support/RAH OS/backup-before-room-copy-4cgmIl`，SQLite integrity check 为 `ok`。最新正式资源为 `/assets/index-D8jqXEre.js`，`http://127.0.0.1:4173/_rah/health` 返回 `online`。
- 最终正式浏览器实际恢复 1 个频道、4 个 Agent 私信；Room 静音恢复关闭、长消息折叠恢复开启。Codex 私信中 hover 显示回复/回应/收藏三入口，姓名点击产生 `@Codex `，头像点击打开默认“动态”tab，并展示跨对话的结构化 Provider 活动；临时草稿已清空，未发送消息或调用 Provider。
