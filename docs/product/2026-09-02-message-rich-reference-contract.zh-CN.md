# 消息富文本引用、公式与图表合同

状态：typed identity、共享 mention 语法、正文显示、已读投影、点击时 ACL 导航与 composer 自动补全已实现。本文只约束 RAH OS，不修改旧 `rah` 仓库。

## 1. Raft 已确认事实

证据来自 2026-09-02 已登录 Raft 正式页面的只读浏览器检查，以及冻结的官方 Web bundle
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`（SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`），不是从截图猜测：

- `Brt`（bundle offset `2918628`）先保护 fenced/inline code，再解析结构化 mention、裸
  `@name`、Task、频道、Thread、DM、Computer、App 与 message permalink。裸名称只有在当前目录
  中存在时才升级为交互引用。
- Task 候选使用 `g9()`：`(^|[^\w/])(?:(task\s+))?#([1-9]\d*)\b`。显式
  `task #N` 可以显示为 Task 引用；裸 `#N` 只有在 `knownTaskNumbers` 中存在时才升级，路径中的
  `/#N` 不升级。
- Agent mention 的 brutal 样式是黑色粗体、30% 黑色双像素下划线、2px underline offset；hover
  改为 brutal pink。其身份预览沿用 Raft 的 200ms 打开、120ms 关闭合同。
- Task chip 是 1px 黑框、水平 4px padding、`0.875em` 粗体和 1.3em line-height；常态为
  `bg-soft-signal/40`，hover 为 `bg-soft-signal`。频道 chip 为 brutal pink 30%，hover 60%。
- Thread 搜索命中由 `Ele/Crt`（offset `2913732`）用
  `mark[data-testid=thread-search-fragment-highlight]` 与 `bg-soft-signal/70` 包裹，匹配不区分大小写。
- Room 侧栏注意力是两条独立信号。官方 `met` 频道行（offset `2736299`）同时读取
  `unreadCounts[channelId]` 与 `mentionFlags[channelId]`：提及当前 Human 时渲染 16×16、1px 黑框、
  黄色底的 `@`，未读数另以粉底白字计数显示；同 bundle 的 `fet/get` DM 行只读取
  `unreadCounts[dmId]`，即使 DM 正文提及当前 Human 也不另显示黄色 `@`。
- Raft 的 Markdown owner 同时启用 GFM、代码渲染、公式与 Mermaid；正式页已观察到标题、表格、
  inline/block math、代码复制，以及 Mermaid 图表/源码/缩放/复制/下载/全屏入口。

Raft Server 源码并未随 Web/Computer 发布。因此不能声称 Task/mention 的服务端存储、Thread Search
ranker 或权限事务被逐行复制；可证明的是以上客户端语法、请求和可见行为。

## 2. Multica 交叉证据

检查版本为本机 Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f`：

- `packages/ui/markdown/mentions.ts` 把旧 shortcode 统一为
  `[@LABEL](mention://member/ID)`；`server/internal/util/mention.go` 在服务端解析同一 typed link，
  说明路由身份不应依赖显示文本。
- `packages/ui/markdown/issue-identifiers.ts` 只把独立、可解析候选升级为引用，并明确跳过代码、数学、
  已有链接、URL、邮箱和文件路径；解析失败退回普通文字。
- `packages/ui/markdown/Markdown.tsx` 与 `packages/views/rich-content/rich-content.tsx` 由一个共享
  Markdown owner 处理 mention、GFM、KaTeX、代码和 Mermaid，而不是在 Chat/Task 页面各写一套。

采用的是 typed identity、保守解析和单一 renderer 的结构；未采用 Multica 的 Issue/Project 业务
模型或服务端 mention URL 作为 RAH OS canonical Message 格式。

## 3. RAH OS 所有权与实现

- canonical `Message.body` 继续保存用户/Agent 发出的原始 Markdown；不把显示 chip 或 HTML 回写数据库。
- `packages/protocol/src/message-reference.ts` 冻结八种严格 identity：Agent、Human、Room/DM、Thread、Task、
  Computer、App 与精确 Message。协议对象只携带 canonical ID、原显示片段及必要的 parent identity；禁止
  保存猜测 href。Thread identity 必须同时有 `threadId + rootMessageId`。
- `packages/protocol/src/message-mention.ts` 是 mention 语法的单一跨层 owner。发送时的 Agent recipients、Kernel
  Search/Activity/Web Push 的 `rah_has_mention` 与 Web 正文显示都复用它：中文正文允许 `请@Alice处理`；邮箱/
  路径前缀、inline/fenced/缩进代码、公式、inline/引用式 Markdown link、URL/autolink、HTML 与 comment 示例
  都不产生 mention，因而不会发生“正文不高亮但后台已唤醒 Agent”的分裂。屏蔽区间与 JS RegExp 都使用
  UTF-16 code-unit 索引，emoji 不能再把后方代码示例错位成真实 mention。
- `messageReferenceNameKey()` 冻结 `trim + NFKC + lowercase` 比较键。`@` 只绑定 canonical Principal handle，
  `#room` 只绑定 canonical Room slug；displayName/name 只负责显示，不能成为第二套路由。大小写或 NFKC 等价但
  指向不同 identity 的目录必须 fail closed。Kernel 在 Principal/Room 写入时拒绝此类冲突，并在启动早期审计
  旧数据库，不能让一次 mention 唤醒两个 Agent。
- `apps/web/src/message-rich-text.ts` 是其余引用的纯识别 owner，只把目录中**唯一**可解析的候选升级为 typed
  token。Principal 使用 handle，Room 使用 immutable slug；冲突时保持普通文字，不以数组首项猜身份；子
  Thread 不存在时也不会退化成可点击父 Room。所有生成 token 都经过
  `MessageReferenceSchema.safeParse`，超长或协议非法候选保持原文而不会使消息渲染崩溃。
- `apps/web/src/components/message-markdown.tsx` 仍是唯一 Markdown renderer。它在 Markdown 已解析的
  text node 上投影引用，因此 inline/fenced code 与已有 Markdown link 不会被二次改写；KaTeX、Shiki、
  Mermaid sandbox/CSP 继续复用原 owner。
- Agent 引用复用 `MessageAgentReference` 与已有 `AgentMessageContext`：hover 是同一个身份预览；头像与正文
  mention 打开右侧 inspector 前都会调用 `navigation.resolve` 重新检查 Agent 存在性及 control Room ACL。
  Human/DM、Task、Room、Thread、Computer 与精确 Message 同样只发送 typed `NavigationTarget` 并在点击时
  重新解析。App 在 RAH OS 没有独立产品 surface，因此按官方语法显示但不伪造可点击目标。
- 正式 Room/Thread 将当前 Workspace Room/DM、当前 Room Principal、Agent、Task/Thread 与本机 Computer
  目录注入同一个 renderer；测试 fixture 不再是唯一能够解析完整语法的调用点。不可解析或歧义候选保持
  原文/disabled 引用，不从显示名猜测路由。
- mention 小圆点只来自 canonical `message.posted.payload.recipients(reason=mention)` 和相同 participant 的
  `inbox.acknowledged.throughSeq`。Web 只在 Room replay 已 `caughtUp` 时投影，并为整批事件建立一次索引、每条
  Message O(1) 读取；正文、在线状态、hover 或“打开了页面”都不能推断已读。read 为 green、unread 为白色。
- `packages/kernel/src/human-activity.ts` 是 Room 注意力的 canonical 投影 owner，分别返回
  `unread_count` 与 `has_mention`；Web 的 `sidebarRoomAttention()` 只做有界显示投影，不能从高亮正文重新计算。
  频道保留黄色 mention 与粉色 unread 两个并列标记；DM 永远只投影粉色 unread。点击/进入 Room 后是否清除
  继续由 canonical read frontier 决定，React 本地状态或 timeout 不能提前抹除。
- Thread 搜索通过现有 `/v3/client/search`、SQLite FTS5、冻结 cursor 与 Room membership ACL；新增
  `threadIds` 只缩小范围，不建立第二个搜索数据库。客户端按 100 个匹配一页读到 cursor 尾部，传输
  的是命中消息而非整条 Thread 历史；点击未在窗口中的命中时，复用 `message.context` 定位。

这里与 Raft 有一个有意的架构差异：Raft Web 的 `_v/Ne`（bundle offset `3258211`）在输入 debounce
后以 `limit=100` 向前/向后读取完整 Thread，再在浏览器本地匹配；RAH OS 不复制这个中央服务器前提，
而以本机 ACL-safe FTS 返回匹配项。可见计数、上下一个、片段高亮与最终定位对齐，但长历史不会因为
搜索整段灌入 DOM/内存。

## 4. 语法与可见样式矩阵

| 文本                                        | identity / 行为                       | Raft 对齐显示                                                                            |
| ------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------- |
| `@Agent`、`@Human`                          | Principal；唯一目录匹配；Agent 可预览 | 14px 继承正文、700、2px/offset 2px 下划线；hover pink                                    |
| 当前 Human 的 `@self`                       | Human principal；不把自己导航成 DM    | solid yellow                                                                             |
| `#room-slug`、`dm:@peer`                    | Room                                  | pink 30%，hover 60%，1px 黑框                                                            |
| `#room:threadShort`、`dm:@peer:threadShort` | Thread + root Message                 | cyan 30%，hover 60%                                                                      |
| `task #N`、当前 Room 已知 `#N`              | Task + canonical Thread/root          | yellow 40%，hover solid yellow                                                           |
| `computer:host`                             | 当前可见本机 Host                     | cyan 30%，hover 60%                                                                      |
| `app:reverse.dns.id`                        | App identity；当前 display-only       | yellow 40%                                                                               |
| `#room msg=id` 及带 Thread 变体             | exact Message；点击时查存在性/ACL     | yellow 40%，hover solid yellow                                                           |
| 频道侧栏 `hasMention + unreadCount`         | 当前 Human 的 canonical Room 注意力   | 16px 黄色 `@` + 未读数；静音频道另显示 16/12px `bell-off` 与灰色 quiet count；标记可并列 |
| DM 侧栏 `unreadCount`                       | 当前 Human 的 canonical DM 未读       | 仅粉底白字未读数；不显示频道 `@` 标记                                                    |

所有 chip 共用 1px 黑框、水平 4px padding、`0.875em`、700、`1.3em` line-height、零圆角；CSS 只保留一组
最终规则，浏览器门禁读取 computed style，不能用“源码里曾出现目标规则”代替实际层叠结果。

## 5. 回归与剩余边界

- `packages/protocol/test/message-mention.test.ts`：中文相邻 mention、dotted handle、邮箱/路径边界、emoji 后
  UTF-16 索引、大小写/NFKC 歧义，以及 code/math/inline+reference link/URL/HTML 不产生 delivery。
- `apps/web/test/message-rich-text.test.ts`：Agent/Human/DM/Task/Room/Thread/Computer/App/Message 解析、
  slug≠name、canonical handle、完整结束边界、schema-invalid 安全降级、大小写保真高亮。
- `packages/kernel/test/workspace-management.test.ts`：新写入拒绝等价 handle/slug；启动拒绝旧库中的歧义
  canonical handle 目录。
- `packages/kernel/test/global-discovery.test.ts`：Thread 精确范围和 ACL-safe 索引。
- `apps/web/test/message-markdown-stability.tsx`：真实浏览器验证全部引用节点、typed Task/Thread/Computer/
  Agent/Task/Thread/Computer/Message 导航、mention read-state、全部可交互引用的最终 computed style 与真实
  hover、代码不被改写，并继续证明轮询不重建 Mermaid iframe/图片/代码块。
- `apps/web/test/thread-panel-parity-contract.test.ts`：Thread Search 不再触发完整历史 hydration，并存在
  fragment highlight。
- `apps/web/test/sidebar-attention.test.ts`：频道 mention/count 相互独立，静音频道保留灰色 quiet count，DM 即使
  `hasMention=true` 也只显示 loud count；`scripts/run-message-timeline-browser-gate.mjs` 在真实 Chrome 以桌面和
  390×844 检查 16px 黄色 marker、10px 居中图标、两种 count、黑框、圆角和 Direct Row 最终层叠结果。

composer 的 typed Agent mention 自动补全现已按 Raft 实测的 `.mention-menu/.mention-row` 合同接入：Room、DM
和 Thread 共用一个输入所有者，候选只来自当前 Room 的 active canonical Agent 成员，显示正式头像；方向键、
Enter/Tab 和 Escape 都不建立第二条发送路径。补全触发器复用 `message-mention.ts` 的 Markdown 可见正文 mask，
不会在 inline/fenced code、公式、链接、URL 或 HTML 中承诺实际不会投递的 mention；它只替换光标所在的未完成
`@token`。最终收件人仍由同一 protocol lexer 从原始 `Message.body` 解析，显示层候选不能冒充 canonical 写入格式。

跨 Room Thread 的短 ID 不会为了“看起来可点”而预载全 Workspace Thread 或猜测目标；只有当前已装载的唯一
Thread 目录会升级，精确 Message 点击仍由 daemon 解析。若后续加入全局引用目录，必须复用同一协议、分页/ACL
和原始 `Message.body`，不能建立第二套 mention identity。
