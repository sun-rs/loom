# Search / Tasks / Message 页面族收口审计

日期：2026-09-05。范围：E 批第一段的 Search、全局/Room Tasks、普通消息操作与共享空态；
不把这一批外推为全产品或全部 Raft 页面一致。

## 结论

本批关闭了一个组合层根因：同一种空态曾由 Search、全局 Tasks、Room Tasks 和 Activity
分别维护 DOM/CSS，导致图标、字号、垂直占位和移动断点漂移。现在这些页面只消费内部
`EmptyState` 的命名 context，Raft Tasks 的 36px 图标、18/28px 标题、14/22.75px 正文和
48×24px padding 继续来自固定的官方 computed token。请求失败和加载中仍是独立状态，
不会被误画成空数据。

Search／Tasks 控件没有获得第二个状态机：筛选、排序、URL 投影和请求仍由既有 typed SDK
及 canonical 本地索引负责；任务卡片的五列展示不拥有 Task 完成语义。普通消息的三按钮、
七项快速回应和收藏入口仍由消息 social owner 接到 Kernel，不会改变 Task 或 Activation。

## 来源与采用边界

| 合同                               | 来源                                                     | RAH owner / 明确差异                                                                                             |
| ---------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Tasks 空态几何                     | 固定 Raft Tasks computed-style token                     | `body-primitives.css` + `EmptyState`；Search/Activity 以命名 context 保留各自官方形态                            |
| 创建者/负责人 sentinel、搜索与排序 | 固定 Raft Web bundle 的 RN/MN/uat/mat/fat、HG 行为       | `raft-discovery-controls.ts`；身份来自 Workspace 实体网，查询由本地 canonical 索引执行，不声称复制中央相关度服务 |
| 普通消息操作                       | 固定 Raft bundle 的三操作与 quick reaction/bookmark 标记 | `message-social.tsx`；共享回应、私人收藏是 RAH Kernel 事实，不引入参考项目模拟 store                             |
| 页面组合                           | 实际 RAH 生产组件                                        | `global-discovery.tsx`、`conversation-panes.tsx`；删除旧 `.empty-state` / `.tasks-empty` 页面规则                |

机器登记现把 B025、B057–B060、B072–B074 和 UI007 关联到来源、当前 owner、明确差异与
`discovery-page-family` 场景。`migrated` 只表示登记中写明的有限范围已迁移并挂接测试，
不是运行成功或官网全功能一致的同义词。

## TDD 与浏览器发现

先把单一 owner、四种 context、Tasks 官方 token、禁止旧选择器和禁止页面私有 `Empty`
写入 `ui-body-ownership.test.ts`，确认旧实现失败后再迁移。第一次 Chrome 页面族运行发现
自动聚焦后的筛选输入使用 4px hard focus shadow，门禁据真实状态收紧。后续真实截图又发现
Search 零结果把 JSX 条件里的数字 `0` 渲染为正文；新增红测后改为显式 Boolean，浏览器门禁
同时拒绝这个孤立数字。

最终 `discovery-page-family` 在 Chrome 152.0.7977.77 与 Firefox 150.0.2 都通过，覆盖：

- 1440×900 与 390×844；
- 全局 Task 无筛选空态、看板/列表切换和 URL 投影；
- 频道／创建者／负责人筛选，self/未分配无头像 sentinel、canonical Agent 头像、清除与 Escape；
- Search 发送者／范围／频道／时间／排序、清除、历史建议、无结果 section，且不渲染孤立 `0`；
- 普通消息 hover 三按钮、24×24 hit target、七项 quick reaction、回应者浮层、私人收藏与上下文菜单；
- Room Task 同一空态 token。

完整 UI foundation 回执位于临时目录 `rah-ui-foundations-1svaf8`：26 个 engine/scenario 结果
全部通过，包含 10 张本批桌面/移动截图；请求守卫、页面/console/HTTP 错误均为空。
回执的 `startedAt` 与 `finishedAt` 都为非空时间，截图由主审查者抽样检查。临时目录不是持久产品证据，机器登记、场景源码和输入摘要才是
可复跑入口。

补充回归：

- `npm run test:web:browser` 通过真实 Chrome 的 canonical Task/Review/Human complete 与消息链；
- `npm run test:web:firefox` 通过持久工作台的回应、收藏、搜索及桌面/390px 行为；
- `npm run build:web:workbench` 通过。

## 正式实例重启后验收

正式工作台先通过空闲守卫，并生成校验备份
`/Users/sun/.rah/backups/pre-restart-f31997ea-aa58-457b-aa4c-e36da702ad14`，然后从旧构建
`7452387e…` 切换到 `40cf7cfb…`。新实例由 PID 82039 在 `127.0.0.1:4173`
提供服务；响应头和 HTML 内嵌 build identity 完全一致。

新增可复跑的 `run-discovery-formal-browser-acceptance.mjs`。它使用正式 `room.db`，在 Chrome
152.0.7977.77 和 Firefox 150.0.2 中验证真实 2 条 Task 与 43 条消息，而不是仅运行静态
fixture：

- 全局 Task 的 Raft 标题、创建者弹层、无头像 self sentinel、canonical Agent 头像、Escape
  还焦点、看板/列表投影，以及桌面/390px 组合；
- Search 真实本地索引请求和共享零结果空态；
- 真实消息 hover 后的三个 24×24 操作、七项 quick reaction，并且未点击任何回应或收藏写操作。

请求守卫将 Search、全局 Task 和消息 social 投影与正常的 Room acknowledge／Activity 已读
frontier 分开记录；回应、收藏、follow、Task/Message 写入和未知 API 仍然拒绝。验收前后 principals、
Rooms、Messages、Tasks、Reviews、Submissions、reactions、saved messages 和 376 条 Room event
的计数/最高序列一致。正式导航产生了 2 个新的 transport subscription cursor；审计现在显式
记录这一允许的读模型副作用，而不再把整个运行称为“只读且状态完全不变”。页面、console、HTTP
错误均为空。8 张截图的合并摘要为 `24144a3b…`，主审查者检查了桌面 Task、Search、message
actions 和 Firefox 390px Task。
持久摘要见 `docs/evidence/rah-discovery-formal-20260905.json`。

同一新构建还重新通过了 Settings 正式实例双浏览器验收：12 个 section、两种视口、48 张截图，
前后协作内容状态相同；Room acknowledge 产生的 subscription cursor 变化同样单独记录。
foundation 回执现在写入非空 `finishedAt`。全仓 `npm run check`、
`npm run format:check` 与 `git diff --check` 均通过。

## 独立复核

只读独立审计先发现 foundation 回执早于最后一次行为登记更新，将其记为证据级 P2。
冻结登记后重跑的 `rah-ui-foundations-1svaf8` 现已闭合该问题：回执顶层、输入清单与
当前 registry 的 SHA-256 均为 `50b460bb…`，966/966 输入无漂移，26/26 场景通过，
`finishedAt` 非空，Chrome/Firefox 的 blocked/rejected 请求都为空。复核结论为
P0=0、P1=0、P2=0；下节所列未验收边界仍然保留。

## 没有被本批掩盖的差距

1. Raft 中央搜索相关度质量不可由页面形态证明；RAH 明确使用本地索引。
2. 消息编辑/删除、所有角色下的上下文菜单以及非空 Activity 同前置双边回放仍需继续核验。
3. Task unblock、Closed/恢复和列折叠的完整 Raft 双边分支仍在后续页面族范围。
4. 完整 Human/ACL、Computer 管理及 macOS/Firefox/Chrome/iOS 通知设备送达仍是 E 批后续。
5. 本轮系统浏览器是真实 Chrome/Firefox，但 Mac 在官方页面复查阶段重新锁定；因此没有新增
   一条“当日 live Raft 同条件手工通过”的声明。固定官方 bundle、computed token 与先前 live
   记录继续作为本批来源；解锁后仍应补非空组合的当日双边抽查。

## 架构审查

本批没有改变 Task、Review、Activation、Message 或身份事实 owner；页面仅投影 typed 结果。
共享组件采纳消除了叶子层重复规则，组合层仍由真实页面矩阵验收。未引入外部 `raft-ui`
运行依赖、第二套业务 store、Provider 日志解析或模型上下文补丁。该方向符合 Room-first 与
“同功能 Raft 页面继续对齐”的双重约束。
