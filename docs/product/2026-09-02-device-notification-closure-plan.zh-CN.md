# P5 设备通知 Raft-first 收口计划

状态：软件链与 Firefox 正式实例已收口；设备横幅/点击证据受系统共享屏幕策略阻塞

首次落盘：2026-09-02

基线提交：`023aad7 feat: establish Raft-aligned collaboration baseline`

本文只负责 Search / typed navigation 已完成之后的设备通知闭环。Web Push 是可丢失的 transport hint；Room、DM、Thread、Task 和 InputRequest 的 canonical event 仍是唯一业务真相。

## 1. Raft 源码合同

授权冻结发布物：`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256 前缀 `7328…`。

可直接结构化移植的函数位于 bundle byte offset `3166418..3168255`：

- `hce`：仅在没有既有 registration 时调用 `navigator.serviceWorker.register("/sw.js")`；更新失败不破坏当前 registration；
- `b4`：状态检查先 `navigator.serviceWorker.getRegistration("/")`，找到后只做 best-effort `update()`；
- `Lit`：启用路径使用 `b4() || hce()`；
- `Dit`：是否订阅只读取既有 registration 的 `pushManager.getSubscription()`，不在 focus/status refresh 时重新 register；
- `$8`：权限 granted 后复用或创建 subscription，再保存到 Server；
- `rft`：停用只处理既有 registration/subscription；
- `aft`：`POST /push/test`；503 显示不可用，409 显示未订阅，其他错误显示通用失败。

这组函数是本批第一修复源，不另发明 Service Worker 注册状态机。Raft 发布物没有公开 Server fan-out 事务和系统通知点击后的 Server ACL，因此本地 daemon/Kernel 只实现 canonical event 资格、typed target、outbox、endpoint 清理和点击时 ACL 重验。

## 2. 2026-09-02 真实设备反例

正式 `4173` 实例已有一个持久 Firefox subscription。受保护 API 直接调用 `/v3/client/push/test` 返回 `200 {"delivered":1}`。Firefox 正式设置页显示：

```text
权限：granted · 此设备订阅：存在 · 已登记设备数：1
```

但从页面用真实指针点击“发送测试推送”后，页面出现：

```text
NetworkError when attempting to fetch resource.
```

Firefox Network Monitor 同时证明 `/v3/client/push/test` 实际返回 `200`、15 bytes、约 `870 ms`；两次 `/v3/client/push/configuration` 也均为 `200`。因此失败不在 test API，而在页面 focus/visibility 触发的状态 refresh。当前 RAH `readBrowserPushStatus()` 每次都 `navigator.serviceWorker.register("/sw.js")`，与 Raft 的 `getRegistration -> ensure only on enable` 合同不一致。

macOS 系统设置还显示 Firefox 通知为“标记、声音和桌面”，但全局“当镜像或共享屏幕时”为“关闭通知”。Computer Use / 截图验收期间系统会抑制横幅，所以当前只能证明 Server 接受和浏览器订阅存在，不能把自动化录屏中无横幅判定为 RAH 失败或成功。修改这项全局系统偏好不属于本批隐式授权。

## 3. 唯一 owner 与施工顺序

```text
Raft registration helper contract
        -> apps/web/src/web-push-client.ts
        -> WebPushSettings / useDefaultWebPush

canonical Room event
        -> Kernel RoomWebPushProjection
        -> durable outbox
        -> daemon WebPush dispatcher
        -> Service Worker typed target
        -> notification click
        -> HumanNavigation.resolve (existence + current ACL)
```

严格顺序：

1. `apps/web/test/web-push.test.ts` 先写红测：状态读取不得调用 `register`；启用才允许 `register`；既有 registration 必须复用；update 失败不得把设备误报为无订阅。
2. 按 Raft `b4 / hce / Lit / Dit / rft` 结构移植唯一 registration helper；不得在 React 组件再写第二套。
3. 增加 test push 的 Raft 形结果分类，避免 transport 成功却被并发 refresh 的错误覆盖。
4. 在隔离状态验证事件资格矩阵：DM 新回复、精确 mention、followed Thread、InputRequest、Task submitted/blocked/changes_requested/completed/cancelled/reassigned；actor、Agent、control Room、普通 muted 消息必须不投递。
5. Firefox 正式实例复测：按钮请求 200，页面不再出现 `NetworkError`，状态保持已启用。
6. 不改系统全局“共享屏幕时关闭通知”。在无屏幕共享条件下由 Human 或设备级手工步骤补横幅与点击证据；点击必须聚焦既有窗口或开新窗口，并落到 Computer typed target。
7. Chrome 新建 subscription 属于新的外部订阅副作用，只有获得动作时确认后才执行；未确认前只做无订阅 UI/权限读取。
8. iOS/iPadOS 只在 16.4+、可信 HTTPS、主屏幕 PWA 的真实设备验收，不用桌面模拟器冒充。

## 4. 验收矩阵

| 层     | 验收                                                         | 当前状态                                            |
| ------ | ------------------------------------------------------------ | --------------------------------------------------- |
| `C`    | Raft registration helper 与事件资格 owner 接线               | 完成：状态只读既有 registration，启用时才 ensure    |
| `A`    | Web/unit、Kernel 资格、daemon 投递/失效订阅、SW typed target | 完成：定向 `261/261`、parity `34/34`、Firefox gate  |
| `L`    | Firefox 页面按钮、无假错误、订阅持久、desktop/390            | 完成：正式 Firefox 实点无假错误；隔离 gate 覆盖 390 |
| `R`    | Raft `b4/hce/Lit/Dit/rft/aft` 前端行为合同                   | 源码 offset 已取证                                  |
| `D`    | 正式 4173 重启后 Firefox 实页                                | 完成：新 PID `63740`，订阅仍存在且页面无假错误      |
| device | macOS 横幅 + 点击、Chrome、iOS PWA                           | macOS 被“共享屏幕时关闭通知”阻塞；Chrome/iOS 未验收 |

`delivered:1` 只表示 push transport 接受；没有横幅和点击证据时不得宣称设备通知完整可用。

## 4.1 2026-09-02 施工与验证回执

- failure-first：`apps/web/test/web-push.test.ts` 先因缺少
  `existingBrowserPushRegistration` / `ensureBrowserPushRegistration` 失败；随后证明状态读取不注册、
  启用才注册、既有 registration 被复用、`update()` 失败不会丢失当前订阅。
- structural port：`apps/web/src/web-push-client.ts` 按 Raft `b4/hce/Lit/Dit/rft`
  拆分 existing/ensure；focus/visibility 只刷新既有 registration，停用不再等待一个可能永远不完成的
  `serviceWorker.ready`。
- qualification：新增 followed Thread 的隐式关注、显式 unfollow 抑制、精确 mention 例外和 refollow 恢复；
  既有矩阵继续覆盖 DM、Room opt-in、Workspace mute、InputRequest、Task submitted/completed/
  changes_requested/blocked/cancelled/reassigned 与 self-authored suppression。
- automation：Web Push/Kernel/daemon/SDK/application service 定向集合 `261/261`；
  `test:parity:regression` `34/34`；Firefox workbench gate 在真实 Firefox `150.0.2` 的
  `1440x1000` 与 `390x844` 通过；Web build、workspace typecheck、`npm audit --omit=dev`、
  `git diff --check` 通过。
- formal state：重启前 active Activation/Run/Runtime/lease/pending input 均为零；备份位于
  `/Users/sun/.rah/backups/pre-p5-device-notification-20260902T111743Z-JNahzj`，两个 SQLite
  `quick_check` 均为 `ok`。精确 `4173` 优雅重启后 listener 为 PID `63740`。
- formal Firefox：真实指针点击“发送测试推送”后，权限仍为 `granted`、本机订阅仍存在、登记设备数仍为
  `1`，且等待并再次读取页面均不再出现 `NetworkError`。此前同请求已由 Firefox Network Monitor
  证明 `/v3/client/push/test` 返回 `200`。
- device blocker：macOS 全局设置明确为“当镜像或共享屏幕时关闭通知”。自动化验收本身触发该条件；
  未经用户授权不修改全局偏好，因此本批不能把系统横幅与通知点击标为通过。Chrome 新订阅与 iOS PWA
  也仍属于独立外部设备动作。

## 5. 回滚与安全

- registration helper 是前端状态读取修复，不变更现有 endpoint、VAPID key 或用户订阅；
- 正式实例只发送固定、无敏感正文的测试通知，不用真实 Room/DM 消息制造测试；
- 事件矩阵在隔离 `RAH_HOME`、隔离端口和 fake transport 验收；
- endpoint、VAPID private key、loopback session cookie 永不写入文档、日志或截图；
- 完成代码批次后，按 `AGENTS.md` 先审计活动工作、完整备份持久状态、优雅重启精确 `4173`，再做正式浏览器验收。
