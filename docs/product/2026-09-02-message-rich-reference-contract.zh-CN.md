# 消息富文本引用、公式与图表合同

状态：正文显示与 typed 导航已实现；composer 自动补全仍是后续。本文只约束 RAH OS，不修改旧 `rah` 仓库。

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
- `packages/protocol/src/message-reference.ts` 冻结 Agent、Human、Room/DM、Thread、Task、Computer、App 与
  精确 Message 的 canonical identity；`apps/web/src/message-rich-text.ts` 是纯识别 owner，只把当前
  Workspace 目录中唯一可解析的候选升级为 typed token，并实现 Raft 边界规则和不区分大小写的搜索片段切分。
- `apps/web/src/components/message-markdown.tsx` 仍是唯一 Markdown renderer。它在 Markdown 已解析的
  text node 上投影引用，因此 inline/fenced code 与已有 Markdown link 不会被二次改写；KaTeX、Shiki、
  Mermaid sandbox/CSP 继续复用原 owner。
- Agent 引用复用 `MessageAgentReference` 与已有 `AgentMessageContext`：hover 是同一个身份预览，点击
  打开同一个右侧 Agent inspector。Human/DM、Task、Room、Thread、Computer 与精确 Message 只发送 typed
  `NavigationTarget`，由既有 `navigation.resolve` 在点击时重新检查存在性和 ACL。App 在 RAH OS 没有独立
  产品 surface，因此按官方语法显示但不伪造可点击目标。
- 正式 Room/Thread 将当前 Workspace Room/DM、当前 Room Principal、Agent、Task/Thread 与本机 Computer
  目录注入同一个 renderer；测试 fixture 不再是唯一能够解析完整语法的调用点。不可解析或歧义候选保持
  原文/disabled 引用，不从显示名猜测路由。
- Thread 搜索通过现有 `/v3/client/search`、SQLite FTS5、冻结 cursor 与 Room membership ACL；新增
  `threadIds` 只缩小范围，不建立第二个搜索数据库。客户端按 100 个匹配一页读到 cursor 尾部，传输
  的是命中消息而非整条 Thread 历史；点击未在窗口中的命中时，复用 `message.context` 定位。

这里与 Raft 有一个有意的架构差异：Raft Web 的 `_v/Ne`（bundle offset `3258211`）在输入 debounce
后以 `limit=100` 向前/向后读取完整 Thread，再在浏览器本地匹配；RAH OS 不复制这个中央服务器前提，
而以本机 ACL-safe FTS 返回匹配项。可见计数、上下一个、片段高亮与最终定位对齐，但长历史不会因为
搜索整段灌入 DOM/内存。

## 4. 回归与剩余边界

- `apps/web/test/message-rich-text.test.ts`：Agent/Human/DM/Task/Room/Thread/Computer/App/Message 解析、
  不可解析降级、邮箱/路径边界、大小写保真高亮。
- `packages/kernel/test/global-discovery.test.ts`：Thread 精确范围和 ACL-safe 索引。
- `apps/web/test/message-markdown-stability.tsx`：真实浏览器验证全部引用节点、typed Task 导航、mention
  read-state 投影、代码不被改写，并继续证明轮询不重建 Mermaid iframe/图片/代码块。
- `apps/web/test/thread-panel-parity-contract.test.ts`：Thread Search 不再触发完整历史 hydration，并存在
  fragment highlight。

仍未新增 composer 的 typed mention 自动补全，也没有把显示层目录解析冒充 canonical 写入格式。当前已支持
用户/Agent 明文输入官方语法后的保守显示与 typed 导航；若后续加入补全菜单，必须复用同一目录和原始
`Message.body`，不能建立第二套 mention identity。每位收件人的 durable mention read receipt 也尚无可靠
Raft Server 来源；UI 只显示调用方明确提供的 read-state，不从“已打开页面”等现象推断。
