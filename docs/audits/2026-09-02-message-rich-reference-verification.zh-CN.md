# 消息富文本引用与消息列搜索验证报告

日期：2026-09-03
范围：仅 RAH OS；旧 `rah` 仓库未修改。  
裁决：引用 identity、共享 mention 语法、正文投影、点击时 ACL 与 canonical mention receipt 已形成一条协议链；Raft 可见的 Agent/Task/Room 样式由正式页 DOM/computed style 与冻结 bundle 双证据约束。仍不把不可见的 Raft Server 实现冒充已复制源码。

## 1. 上游事实

只读核验对象：

- 已登录 Raft 正式页面；
- `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
  `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`；
- 本机 Multica commit `11861145abc59a0d39c8c8f24ad837d4584e664f`。

Raft `Brt`/`g9` 先保护 code，再识别 Agent、Task、Room、Thread、DM、Computer、App 与 message permalink；
正式页实测 Agent mention 为 14px/700、2px 半透明黑下划线、2px offset，Task/Room chip 为父正文的
`0.875em`、700、`1.3em`、1px 黑框与水平 4px padding。Task 常态 yellow 40%、Room 常态 pink 30%，
均为零圆角。正式 DOM class 同时确认 Agent hover pink、Task hover solid yellow、Room hover pink 60%。

Multica 的 `mentions.ts`、`issue-identifiers.ts`、`Markdown.tsx`、`rich-content.tsx` 和服务端
`mention.go` 交叉证明：显示标签与 canonical identity 分离；code/link/path/math 不应被二次解析；一个共享
RichContent owner 应同时承载 mention、GFM、KaTeX、代码与 Mermaid。

## 2. 协议化结果

- `packages/protocol/src/message-reference.ts`：八种严格 discriminated union；禁止 href 猜测；Thread
  parent identity 成对出现。
- `packages/protocol/src/message-mention.ts`：显示、发送 recipients、Search/Activity 与 Web Push 共用的
  Markdown-aware mention lexer。中文正文可紧贴 mention；代码、公式、链接、URL、HTML 不唤醒 Agent。
- `apps/web/src/message-rich-text.ts`：Room slug/name、Principal handle/displayName 只在唯一解析时升级；
  schema-invalid、歧义、未知 child、错误结束边界都保留文字或 disabled candidate。
- `apps/web/src/components/message-markdown.tsx`：只改 ReactMarkdown 产生的 prose text node；authored link、
  inline/fenced code、KaTeX、Shiki 与 Mermaid 不被二次改写。canonical `Message.body` 始终是原 Markdown。
- Agent mention/头像打开 inspector 前也调用 `navigation.resolve`；Room/Thread/Task/Message/Computer 沿用
  typed `NavigationTarget`。daemon 在点击时重新检查存在性、stale parent identity 与可用 ACL。
- mention read dot 只由 `message.posted.recipients(reason=mention)` 和同 participant 的
  `inbox.acknowledged.throughSeq` 决定；只有完整 caught-up replay 才显示。索引每批事件一次，消息读取 O(1)。

## 3. 独立审计与修复闭环

独立子代理在未修改文件的前提下给出反例，主审逐项复现并修复：

| 等级 | 审计反例                                                                                          | 收口                                                                    |
| ---- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| P0   | renderer、composer recipients、Kernel 搜索/通知使用三套 mention regex；代码示例可能静默唤醒 Agent | 迁入共享 protocol lexer；三层复用；新增真实 Kernel Search/Web Push 反例 |
| P1   | 默认 Room `name=Agent Council`、`slug=agent-council`，正式 `#agent-council` 不可解析              | 目录同时注入 slug/name；测试明确 name≠slug                              |
| P1   | display alias 冲突时 `.find()` 首项胜出                                                           | Agent/Human/Room/DM 只有唯一 identity 才升级                            |
| P1   | Agent mention 点击直接 `setPeekAgentId`                                                           | inspector 打开前调用 daemon `navigation.resolve`                        |
| P1   | 每条消息扫描全部 RoomEvent，partial replay 可能误显 unread                                        | caught-up gate + 一次索引 + O(1) per-message lookup                     |
| P1   | 后置旧 CSS 覆盖新颜色与 read dot                                                                  | 删除重复层叠；浏览器读取最终 computed style                             |
| P2   | parser 直接构造类型且缺完整结束边界                                                               | `MessageReferenceSchema.safeParse`；后缀边界反例；非法候选不崩溃        |

独立审计同时确认的正确项保留不动：raw Markdown 不回写；code/authored link 受保护；未知 Thread 不降级为
父 Room；App 没有本地 surface 时 display-only；非 Agent typed target 已有点击时 Room ACL。

## 4. 验证证据

- 定向 protocol/UI/Kernel/Web：共享 mention、八种 identity、目录冲突、边界、read receipt、Search、Push、
  Room/Task 回归全部通过。
- Chrome 大历史/Markdown gate：10,050 条逻辑消息、27 个 DOM row、anchor delta 0；20 次刷新中 Mermaid、
  图片和代码块 identity 稳定。全部引用节点、Task/Thread/Computer/Message typed callback、代码保护和最终
  computed style 均为 `PASS`。
- TypeScript 全仓与 Web typecheck：通过。
- 最终全门禁、Firefox 与正式 4173 重启/新页面核验结果在本轮末尾追加，不用旧 PID 或旧构建冒充。

## 5. 有意边界

- Raft Server 搜索、引用存储与 receipt 表结构没有发布；RAH OS 的 SQLite FTS、canonical recipient/event 与
  click-time resolver 是 `rah-os-glue`，只声明外部合同和安全性质，不声明逐行复制。
- App identity 已协议化，但 RAH OS 没有中央 App 商店 surface，故不伪造点击。
- 当前只将已加载且唯一的 Thread 升级；跨 Room Thread 短 ID 不靠全量预载或猜测导航。exact Message 点击
  仍由 daemon 查存在性和 ACL。
- composer typed 自动补全尚未加入；未来必须使用同一目录和 lexer，不能建立第四套 mention 语法。
- Computer 引用只从当前本机 Runtime inventory 注入。本轮不扩大到用户明确暂缓的跨 Computer 产品能力。
