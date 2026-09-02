# Search、typed navigation 与 Web Push 验收报告

日期：2026-09-01

## 结论

Search 已按 Raft 发布前端合同收口到本机产品：200ms 可取消查询、目录/消息分区、Thread“消息列”聚合、追加分页、搜索历史/常用、ACL-safe target 以及返回/刷新恢复均已实现。服务端使用 SQLite FTS5 + 字面量校验和确定性排序；这是因为 Raft 未发布服务端搜索实现，不能虚构为直接复制。

OS/iOS 通知的完整软件链也已接通：稳定 VAPID、多设备订阅、canonical Room event 资格投影、outbox 投递、失效订阅清理、设置页、Service Worker 前台抑制和 typed 点击恢复。正式服务已迁移到 schema 27 并重启。

通知业务事件矩阵已补齐到 canonical Room 语义：DM、精确提及、关注的消息列、InputRequest、Task 待审核、阻塞、要求修改、完成、取消和最终改派。普通频道消息默认不产生系统横幅，但可由每位 Human 在 Room 设置中单独开启；普通静音不会吞掉精确提及、InputRequest 或关键 Task 状态。

后续产品裁决已补充：设备通知偏好默认开启；已有权限时全局启动逻辑自动订阅，未决权限在第一次产品 click 的用户手势内请求；设置关闭会持久化设备 opt-out、取消订阅，并阻止 focus/visibility 自动复活。该语义由纯决策测试、Web unit 及隔离 desktop/390×844/PWA 浏览器门禁覆盖。

Firefox 的真实浏览器订阅与 Mozilla Web Push transport 已在正式实例验收：页面报告 `permission=granted`、本设备订阅存在、登记设备数 1；三次“测试”操作均完成且无页面错误，证明服务端成功向该订阅投递。macOS 没有出现可观察的横幅，因此“OS 横幅展示与点击恢复”仍不能宣称通过。Chrome 的正式页面仍报告 `permission=default`、本设备订阅不存在，测试按钮正确禁用；不能把用户在另一 profile/站点设置中允许通知的事实冒充为该受控 Chrome profile 已订阅。物理 iPhone 也仍需设备级验收。

账号、套餐、资源计费和 Raft 中央 push server 不属于 RAH OS。

## 来源裁决

- Raft 授权 bundle：`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256 前缀 `7328…`；结构化移植 Search 参数/展示/取消/分页/历史和 Web Push 订阅/自愈/Service Worker 行为。
- Raft 服务端 rank/fan-out 未发布；本机 SQLite FTS5、canonical eligibility 和 outbox 属于 `rah-os-glue`，但均受 Raft 可见产品合同约束。
- Multica commit `64ec7f54163d918d5d7fd4dcae857f241b7842d0` 只用于隔离、幂等和持久后重拉原则；其 issue/PostgreSQL 语义不优于当前 Room-first owner，未直接移植。
- `web-push@3.6.7` 仅承担标准 Web Push 加密与传输，不拥有业务通知资格或导航。

## 正式重启与持久状态

重启前确认没有 active Activation、RunAttempt、RuntimeProcess 或开放 Task，SQLite `quick_check=ok`；随后创建 owner-private online backup 并优雅停止旧进程。

正式实例现为 `http://127.0.0.1:4173`，`/_rah/health` 返回 `online`。重启后：

| 项目                  |       结果 |
| --------------------- | ---------: |
| schema                |         27 |
| Workspace             |          2 |
| Room                  |          6 |
| Message               |          8 |
| AgentDefinition       |          4 |
| FTS external table    |          1 |
| FTS synchronization   | 3 triggers |
| active activation/run |          0 |
| SQLite `quick_check`  |         ok |
| web-push subscription |          0 |

Web Push state directory/file 权限分别为 `0700/0600`，VAPID key 已生成并在重启后稳定。正式重启后的 owner-private Web Push store 结构可读、订阅数为 0；没有把 endpoint、密钥或 token 输出到审计日志。

## 真实浏览器证据

### Desktop Search

1. `?surface=search` 初始显示“搜索所有内容”；
2. 输入“你是谁”得到 1 条 canonical 消息，位于“消息”分区；
3. 点击后进入 typed message URL，并显示原消息及“已定位原消息及前后文”；
4. 后退恢复 `surface=search&q=你是谁`；重新打开初始 Search 显示“常用”“搜索历史”和可清除查询词；
5. 浏览器控制台无新增 error/warning。

### 390×844 Search

同一查询得到相同结果并定位同一 canonical target；移动导航存在，页面无横向溢出。

### 通知设置

- desktop 与 390×844 均显示“通知”设置页；
- 没有设备偏好记录时按“期望开启”展示；显式关闭后显示“已关闭”，重新聚焦不会恢复订阅；
- in-app 浏览器准确显示已拒绝权限、无订阅；Chrome 在 permission=`default` 时显示“等待授权”和“关闭通知”，测试按钮在未订阅时禁用；
- 未在无确认下点击系统授权，因此没有伪造 OS 横幅或后台点击证据。
- 正式重启后的 in-app 页面再次实测为“权限被拒绝 · 此设备订阅：无 · 已登记设备数：0”，页面控制台无 error/warning；这证明产品会诚实呈现设备阻断，而不是把“期望开启”冒充为“已经订阅”。
- 用户随后为本机浏览器开放权限。Firefox 正式页面实测为“已开启 · permission=granted · 此设备订阅存在 · 已登记设备数 1”，测试请求完成后没有投递错误；Chrome 受控 profile 仍为 `default`/未订阅，测试按钮禁用。订阅/取消订阅属于持久浏览器状态，未在没有 action-time 确认的情况下替用户点击。

### 普通重启与消息错误回归

- loopback gateway session capability 改为 owner-private `0600` 文件，并在普通 Core 重启间稳定；同源 stale cookie 可通过结构化 `401 session_expired` 自愈，不再返回会被客户端误解析的文本错误；
- `HttpRahClient` 对非 JSON 错误返回结构化 `http_error`，不再泄漏原生 `JSON.parse` 文本；
- Message social background refresh 失败只保留既有投影，由全局连接状态统一呈现，不再在每条 Human/Agent Message 下复制同一个错误；用户主动回应/收藏写入失败仍保留局部错误；
- 隔离 production Chrome 门禁在同一文档、同一 Room 中优雅停止并启动 Core，MutationObserver 全程捕获 0 个 `.rah-message-action-error`，顶部 `.rah-error` 为 0，历史回复仍可见；
- 正式 Firefox 页面在第二次优雅重启后不刷新即恢复，真实页面中 `JSON.parse`、逐消息错误、`NetworkError` 与“重新连接”均为 0。页面从通知设置回到默认 Room，作为独立 typed-route 恢复差异保留，未冒充完全一致。

### 业务事件资格

- Kernel 集成测试使用真实 canonical 事件验证 DM、精确 mention、普通 Room opt-in 与静音优先级；
- 完整 Task worker 流程验证 `task.submitted` 向创建者和关注者发送“待审核”，Human 验收产生的 `task.completed` 只通知其他相关 Human；
- 真实 Task lifecycle 验证 `task.blocked`、`task.cancelled`、`task.reassigned`；真实 reviewer execution 验证 `review.submitted(changes_requested)`；
- 真实 InputRequest 流程验证仅指定 responder Human 获得 typed InputRequest target；
- 每个候选排除事件 actor，并保留 typed target；Task 资格限定为创建者、Human task participant 或 Task Thread follower/participant，不广播全 Room；
- 隔离 Chrome 门禁验证 Room“通知所有新消息”控件可写、关闭 drawer 后重新打开仍保持，并在验收末尾恢复初始偏好。

### HTTPS LAN/PWA

`npm run test:web:lan-workbench` 在真实 Chrome 验证：受管 TLS、正式配对页、一次性配对码、Secure/HttpOnly/SameSite=Strict cookie、PWA manifest/Service Worker、设备管理、daemon 重启后配对会话保持、390×844 移动导航及无横向溢出。

第一次运行在“重启后仍显示 Agent Council”旧断言处超时。页面实际保持在 typed URL 的“局域网设备”设置页；门禁已改为验证真正的不变量——没有回到配对页、当前设备仍可见且会话有效——随后完整通过。这是测试合同修正，不是掩盖失败。

## 自动门禁

- `npm run typecheck`：通过；
- `npm test`：726 项，724 通过，2 项付费真实 CLI gate 跳过，0 失败；
- `npm run test:web:unit`：132/132；
- `npm run test:parity:regression`：34/34；
- `npm run build:web:workbench`：通过；
- `npm run test:web:browser`：通过，Chrome，390×844；
- `npm run test:web:message-timeline`：10,050 条逻辑消息、27 DOM rows、prepend anchor delta 0；
- `npm run test:web:lan-workbench`：通过；
- Prettier、`git diff --check`：通过；
- `npm audit --omit=dev`：0 vulnerabilities。

## 剩余差距

1. 在 macOS Chrome 的受控 profile 完成用户确认后的订阅，并与 Firefox 一起验证后台横幅与点击聚焦/打开；Firefox transport 已通过，OS 展示尚未观察到；
2. 在 iOS/iPadOS 16.4+ 的 HTTPS Home Screen PWA 内授权，验证后台通知和 typed target 恢复；
3. Raft 未公开的服务端相关度算法无法逐行复刻；当前本机排序需要用真实大语料继续做质量对照，但 ACL、分页和稳定性合同已完成；
4. Raft desktop 页内通知 hover 的精确视觉/0ms–120ms 时序仍属于全站鼠标对齐，不影响 OS Push 主链。

因此可以宣称“Search 与 Web Push 软件链已实现并通过本机/HTTPS PWA 门禁”，不能在用户尚未授权设备时宣称“macOS/iPhone 实际通知已经投递成功”。
