# Notifications、typed deep link 与 Search 产品合同

状态：2026-09-01 已完成 Search、typed navigation、页内通知与 Web Push 的协议、Kernel、daemon、HTTP/SDK、Web/PWA 接线；schema 27 已正式迁移并通过 desktop、390×844、HTTPS LAN/PWA 浏览器门禁。Firefox 的真实订阅与 Web Push transport 已通过正式实例验收；macOS 横幅/点击、Chrome 受控 profile 订阅和 iOS 设备级验收仍未关闭。

## 1. 目标与排除项

本合同覆盖两条互相分离的产品链：

1. Search 在当前 Human 可见范围内搜索目录实体与消息，并通过稳定 typed target 定位 canonical 对象；
2. canonical Room event 投影为 Human 专属通知资格，再以 Web Push 作为可丢失 transport hint 唤醒浏览器/PWA。

deep link 只用于 RAH OS 产品内跳转，不是公开分享链接，不携带凭据，也不成为业务真相。账号、套餐、资源计费及 Raft 中央服务器均明确排除；RAH OS 的本机 daemon 拥有索引、订阅、投递资格与目标解析。

## 2. Raft 源合同

授权冻结 bundle：`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256 前缀 `7328…`。已结构化移植的发布行为包括：

- Search 请求的 `q/limit/offset/sort/senderId/mentionTarget/senderType/channelId/after/before` 语义；
- 输入后 200ms debounce、`AbortController` 取消、过期响应丢弃；
- 初始搜索历史/常用搜索、目录结果和消息结果分区、Thread 命中聚合为“消息列”、`hasMore` 追加分页；
- Web Push 的 capability 检查、VAPID 配置、用户手势授权、已有订阅复用、订阅/取消/测试、已授权后的 focus/visibility 自愈；
- Service Worker 在前台且已位于相同 target 时抑制系统通知；点击通知优先聚焦已有窗口，否则打开产品页；
- 页内事项只有显式 dismiss 才写 preference，open/close/view 不自动 dismiss；
- push target 限制为 same-origin。RAH OS 进一步限制为 protocol `NavigationTarget` union，不接受任意 URL。

Raft 发布包没有公开服务端搜索排序或 push fan-out 事务，因此不能声称逐行复制未知服务端。RAH OS 只把可观察的前端行为当产品合同，再以本机 canonical owner 实现服务端能力。

## 3. Multica 取舍

监督版本：Multica commit `64ec7f54163d918d5d7fd4dcae857f241b7842d0`。

采用 recipient/workspace 隔离、幂等 mutation、持久 mutation 后重新读取 canonical projection。未采用 issue-centric Inbox 正文复制、read/archive 全状态机或 PostgreSQL 特定搜索方案：它们与 Raft 的 Room/Search 产品合同和 RAH OS 的本机 SQLite owner 不同，不能为了“复用”引入第二套业务真相。

## 4. 唯一 owner

```text
canonical Room/Message/Task/Agent/Computer
       |                         |
       | GlobalDiscovery        | RoomWebPushProjection
       v                         v
ACL-filtered Search         eligible Human target
       |                         |
NavigationTarget            Web Push outbox/transport
       |                         |
HumanNavigation.resolve <-------+
existence + current ACL
       |
Web/PWA same-origin navigation; then canonical sync
```

- `packages/kernel/src/global-discovery.ts`：Search ACL、排序、冻结 cursor 与索引查询；
- `packages/kernel/src/discovery-schema.ts`：SQLite FTS5 external-content 表和消息同步 trigger；
- `packages/protocol/src/client-navigation.ts`：typed target；
- `packages/kernel/src/human-navigation.ts`：点击时 canonical existence/ACL 重验；
- `packages/kernel/src/room-web-push.ts`：DM、精确 mention、Thread follower/participant、Room 普通消息个人 opt-in、InputRequest responder 与关键 Task 生命周期的通知资格；
- `packages/daemon/src/web-push-state.ts`：owner-private VAPID 与 Human 多设备订阅；
- `packages/daemon/src/web-push-dispatcher.ts`：outbox lease、投递、404/410 清理和重试；
- Web/PWA：Search presentation、通知设置、Service Worker 和 typed navigation。

Web Push 是 hint，不是消息账本。Service Worker 收到或点击后必须通过 typed target 重新解析权限并 sync canonical Room；payload 不包含完整消息历史，也不能绕过 ACL。

## 5. Search 语义

- 3 个及以上 Unicode code point 使用 FTS5 trigram 缩小候选集合，再做字面量校验；短查询和 CJK 边界使用有界 fallback；
- exact/prefix/substring rank、时间和稳定 identity tie-breaker 共同保证确定性；cursor 冻结 Human、Workspace、筛选条件和水位；
- 每页重新检查当前 Human 的 Workspace/Room membership；control/不可见 Room 不进入结果；
- 目录实体与消息分区显示，Thread hits 聚合为“消息列”；翻页是 append + identity 去重，不覆盖既有结果；
- 历史/常用只保存 workspace-scoped 的有界查询词，不保存 transcript；
- 点击任何旧结果仍调用 `navigation.resolve`，失效或失权目标不得打开。

本机排序是可审计的 RAH OS 适配，不声称等同未公开的 Raft 服务端相关度算法。

## 6. OS/iOS Web Push 语义

- 只有 Human 可管理自己的订阅；每个 principal 可有多个设备 endpoint；状态文件目录/文件分别为 `0700/0600`；
- 通知资格来自 canonical event，不从 Provider 日志、屏幕文本或浏览器缓存生成；actor 自己、Agent、control Room 与普通 muted 事件被排除；
- 默认系统通知覆盖：DM 新回复、精确 mention、明确/隐式关注的 Thread 回复、指定给当前 Human 的 InputRequest、Agent 提交 Task 待审核、Task 阻塞、Review 要求修改、Task 完成、取消和最终改派；
- `task.submitted` 表示 Agent 已交付 frozen submission、等待 Human 审核；`task.completed` 表示 Human 验收通过后的最终业务完成。两者不能合并成一个含糊的“完成”事件；
- 普通频道顶层消息默认只进入 unread/Activity。Human 可在频道设置中开启“通知所有新消息”；这是 Human × Workspace 的个人偏好，不改变 Room 或其他成员；
- 普通静音压制 DM/普通频道 opt-in/普通 Thread 通知；精确 mention、InputRequest、Task 待审核/阻塞/要求修改/完成/取消/改派属于直接或关键工作注意，可越过普通静音；
- Task 通知只发送给仍有 Room ACL 的相关 Human：Task 创建者、Human collaborator/reviewer，以及明确或隐式关注该 Task Thread 的 Human；不向整个 Room 广播；
- 所有消息通知使用 typed Message target；InputRequest 使用 typed InputRequest target；Task 生命周期使用 typed Task target。点击后仍由 `HumanNavigation.resolve` 重新检查存在性与当前 ACL；
- endpoint 返回 404/410 时移除失效订阅；临时失败保留 outbox 重试；rollout 前过旧 hint 不补发；
- 每个浏览器/PWA 设备的通知偏好默认开启。已有权限时产品启动、重新聚焦或恢复可见后自动补齐订阅；权限仍为 `default` 时，在进入产品后的第一次 click 用户手势中调用系统权限请求，因为浏览器禁止页面加载阶段可靠弹出权限框；
- 设置页可显式关闭：先持久化此设备 `disabled` 偏好，再取消浏览器 subscription 和 daemon endpoint。后续 focus/visibility 不得把它自动恢复；再次开启由设置按钮同一用户手势请求权限并订阅；
- 权限被拒绝时保留“期望开启”状态和系统设置指引，但不循环弹窗；用户在浏览器/系统设置改为允许后，产品自动补齐订阅；
- iOS/iPadOS 需要 16.4+、HTTPS、添加到主屏幕后从 PWA 内由用户手势授权；RAH OS 的 LAN 产品路径必须使用受信 TLS 和设备配对；
- foreground/same-target suppression 只避免重复系统横幅，不改变页内 unread/notification truth。

## 7. URL 与键盘不变量

- Message/Thread/Task/InputRequest/Agent/Computer/Artifact 都携带稳定 identity，不携带显示名、token、Provider session 或正文；
- back/forward/reload 恢复 surface/tab/target；导航失败只显示局部错误，不清空当前页面或消除通知；
- `Enter` 发送，换行使用产品明确提供的组合键；Search 输入的 Enter 只执行搜索；
- push click 只能生成 same-origin typed URL；Web 挂载后仍须 `navigation.resolve`。

## 8. 验收门槛

- protocol/kernel/daemon/application-service/SDK/Web unit 覆盖 schema、ACL、订阅、多设备、资格投影、投递失败和 URL codec；
- desktop/390×844 真实浏览器覆盖 Search、结果定位、返回、历史、全局通知设置和 Room“通知所有新消息”偏好的写入/重载/恢复；
- HTTPS LAN 浏览器覆盖 TLS、PWA Service Worker、配对、Secure/HttpOnly cookie、daemon 重启后的设备会话与 390×844；
- schema 27 正式重启后业务数据、FTS trigger、VAPID key 和 owner-private 权限保持；
- 真正宣称 macOS/iOS OS 通知可用前，必须由用户在目标设备授权，并发送一次测试通知验证后台展示和点击恢复。这个设备级动作不能由无授权的自动化测试冒充。
