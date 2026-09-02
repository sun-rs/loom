# 消息富文本引用与消息列搜索验证报告

日期：2026-09-02  
范围：仅 RAH OS；旧 `rah` 仓库未修改。  
结论：首批 Agent / Task / Room 正文引用和消息列全文搜索已经收口；Markdown、GFM、代码、KaTeX 与 Mermaid 继续由同一 renderer 处理。本文不把不可见的 Raft Server 实现冒充已复制源码。

## 1. Raft 事实与来源边界

本轮只读检查了已登录 Raft 正式页面，并对冻结 Web bundle
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js` 复核。该文件 SHA-256 为
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。

- 富文本识别 owner `Brt`（bundle offset `2918628`）保护 fenced/inline code 后，才处理
  Agent mention、Task、频道、Thread、DM、Computer、App 和 message permalink。
- Task 候选语法为 `(^|[^\w/])(?:(task\s+))?#([1-9]\d*)\b`；裸 `#N` 必须能在当前
  Task 目录中解析，`task #N` 是显式候选，路径 `/#N` 不升级。
- Thread Search 的 `_v/Ne`（offset `3258211`）按 100 条向前/向后拉取整条 Thread，在浏览器
  本地匹配；`Ele/Crt`（offset `2913732`）以
  `mark[data-testid=thread-search-fragment-highlight]`、soft-signal 70% 呈现命中。
- 正式页 DOM 观察到 Agent、Task、频道引用，以及 heading、blockquote、table、代码和 Mermaid。
  Agent mention 的实测样式是 14px、700、2px 半透明黑色下划线、2px underline offset，hover
  为粉色；Task chip 常态为 yellow 40%，hover 为实心 yellow，1px 黑框、4px 水平 padding、
  `0.875em` / 700 / 1.3em。
- Agent 身份预览继续遵循已确认的 200ms 打开、120ms 关闭行为，而不是另造一套正文 tooltip。

Raft Server 源码不在可检查的 Web/Computer 分发物中。因而服务端如何存储 mention、Task 引用和
Thread Search rank/ACL 只能从请求与运行态推断；本轮没有声称逐行移植未知后端。

## 2. Multica 交叉证据

检查本机 Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f`：

- `packages/ui/markdown/mentions.ts` 与 `server/internal/util/mention.go` 使用带 ID 的 typed mention，
  证明显示名不应承担路由身份。
- `packages/ui/markdown/issue-identifiers.ts` 跳过代码、数学、链接、URL、邮箱和路径，只把可解析的
  候选升级为交互引用。
- `packages/ui/markdown/Markdown.tsx` 与 rich-content owner 统一承载 mention、GFM、KaTeX、代码和
  Mermaid。

RAH OS 采用的是 typed identity、保守识别和单一 renderer 结构；没有采用 Multica 的 Issue / Project
业务模型，也没有把 Multica URL 当成 canonical Message。

## 3. 已实施

- protocol 冻结完整 typed reference identity；`message-rich-text.ts` 依据当前 Workspace 目录识别
  Agent/Human、Room/DM、Task、Thread、Computer、App 与精确 Message，保护邮箱、路径、代码与大小写；
  歧义/缺失身份不会降级成较宽的可点击父目标。
- `message-markdown.tsx` 只变换 Markdown 解析后的直接 text node；authored link、inline/fenced code、
  KaTeX、Shiki 和 Mermaid 不被二次解析。
- Agent 引用复用现有身份预览和右侧 inspector；Human/DM、Task、Room、Thread、Computer 与精确 Message
  只发 typed navigation target，并由既有 `navigation.resolve` 在点击时重新进行存在性和 ACL 判断；App
  因本地产品没有对应 surface 而保持 display-only。
- 正式 Room/Thread 已注入当前 Workspace Room/DM、当前 Room Principal、Agent、Task/Thread 与本机
  Computer 目录，不是只在隔离 fixture 中成立。
- `/v3/client/search` 新增 `threadIds` 缩小条件，继续由 SQLite FTS5、冻结 cursor 和 Room membership
  ACL 拥有搜索真相。Web 以每页 100 条读完匹配 cursor；未加载命中通过 `message.context` 定位。
- 消息列搜索具备 180ms debounce、结果总数、上一条/下一条、大小写不敏感片段高亮；不再为了搜索
  hydration 整条 Thread，也不再保留旧的 5000 条客户端硬上限。

这是有证据支持的架构适配：Raft 的中央服务允许浏览器拉完整 Thread；RAH OS 是本机 daemon 真相，
采用 ACL-safe FTS 只传命中项。可见交互等效，但不会把整条长历史灌入 DOM/内存。

## 4. 测试与真实浏览器证据

- `npm run check`：通过；core 800 项（798 通过、2 项显式 skip），Web 215/215，callback audit 34/34。
- 最终定向回归：消息富引用、Thread 历史/面板合同和 Kernel discovery 共 27/27 通过。
- `npm run format:check`、`git diff --check`、Web build 与 TypeScript：通过。
- Chrome 大历史/Markdown gate：10,050 条逻辑消息、DOM 27 行、anchor delta 0；20 次刷新中 Mermaid、
  图片与代码块身份稳定，结果 `PASS`。
- 最终标准源码构建后，`npm run test:web:browser` 在 Chrome 的 `390×844` 真实浏览器通过；
  `npm run test:web:firefox` 在 Firefox 150.0.2 的 `1440×1000` 与 `390×844` 真实浏览器通过。
- 正式 `127.0.0.1:4173`：打开 Task #1 的消息列后搜索 `Kernel`，返回 `1/2`；点击下一条变为
  `2/2`。两条消息中共 5 个大小写不敏感命中片段，实测背景为 yellow 70%，页面无可见 alert、
  inline error 或 navigation error。
- 正式构建加载的 CSS 已在运行态确认：Task 常态 yellow 40%，hover 实心 yellow；未加载旧 CSS。
- 正式数据没有人为写入演示 Agent/Task/Room 引用；引用节点、typed Task 点击、代码不被改写与 Mermaid
  稳定性在隔离真实浏览器 fixture 中完成，不污染用户数据，也没有调用付费 Provider。

最终重启前再次确认 28 个 Activation 全部 `completed`、28 个 RunAttempt 全部 `exited`、28 个 Runtime
全部 `terminated`，且无 queued/leased activation、活动 exclusive lease、SOS、待处理 InputRequest、
Computer operation、Reminder、held draft、改派或未解决取消请求。唯一 Task 为等待 Human 验收的
`submitted` 业务状态，未被部署流程修改；28 条未发布 outbox 均为历史 `placement.ready`，重试数为零。
Room、runtime-registry 与 web-push 三个数据库均 `quick_check=ok` 且无外键错误。离线完整状态备份位于
`/Users/sun/.rah/backups/pre-rich-reference-final-20260902-3RfArz`。

正式服务不再依赖临时冻结目录：`npm run start:local-workbench` 从当前源码完成 Vite 产品构建后，标准
`node scripts/run-local-workbench.mjs` 以 PID `22529` 监听 `127.0.0.1:4173`。新建正式浏览器标签只读加载
后，Room/DM 目录、消息操作、报数 1–10、Task #1 与 composer 完整出现；旧标签跨重启留下的
`Failed to fetch` 没有在新标签复现，且正式数据未发生写入。

## 5. 审计裁决与剩余非阻断项

独立审计曾指出旧 Thread hydration 存在 5000 条客户端硬上限；本轮改为后端分页搜索后，该阻断已经
消失，手动向上分页也不再受该上限约束。

Computer、App、Thread/DM 与 message permalink 的正文语法已完成；剩余非阻断项是 composer typed
mention 自动补全，以及缺少可靠上游事务证据的 durable mention read receipt。前者必须复用现有 catalog
和原始 `Message.body`，后者保持 absent，不能用浏览器打开状态或正文正则伪造。

公式、表格、图表并不是 Agent 输出的隐藏系统标识：正文仍是 canonical Markdown；GFM/KaTeX/Mermaid
是显示层受限解析。Task/Agent/Room 则必须绑定可解析目录身份，二者不可混为一套字符串替换。
