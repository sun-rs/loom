# P6.3 消息上下文菜单 Raft-first 合同

状态：`C/A/L/D` 完成；Raft 未取得同一在线状态，未宣称完整 `R`

> 2026-09-05：Thread follow、stale-safe Task 状态动作与 Search 异步状态已由
> [Conversation 页面族设计](../design/conversation-page-family.md)接续；本文件以下
> “后续”段落保留为 P6.3 当时的历史边界，不再作为当前缺口登记。

日期：2026-09-02

## 1. Raft 冻结来源与可证明事实

唯一上游为获授权冻结发布物 `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`：

- byte offset `3024000..3039000`：普通消息 `contextmenu` 打开菜单；选择模式只阻止默认菜单；touch 长按
  500 ms 打开，移动取消；打开时关闭 reaction picker。菜单以 pointer/touch anchor 进入共享 floating position owner，
  resize/任意 scroll 关闭。
- byte offset `3053000..3059900`：菜单通过 body portal 呈现，backdrop 拦截下一次 contextmenu，
  `role=menu`、z-60、`card-brutal`、viewport 高度上限。动作顺序是：非系统消息的七项快捷回应、分隔线、复制链接、
  复制 Markdown、可选翻译、可选选择消息、分隔线、非 Thread 内的打开消息列、保存/取消保存、可选 follow/unfollow
  Thread、可选分隔线、已有 Task 的完成/重开或普通消息的转为 Task。
- copy link 使用 Raft 自己的 permalink builder；copy Markdown 写入 canonical 原文。Raft bundle 没有证明中央 Server
  的 Task/Thread/Save 事务，只证明触发、动作顺序、条件和 UI 状态。

## 2. 本批范围与产品裁决

P6.3a 只接现有 canonical owner 已具备的动作：

1. 七项快捷回应；
2. 复制本地 typed message deep link；
3. 复制 canonical Markdown；
4. 在主 Room 消息上打开消息列；
5. 收藏/取消收藏；
6. 无 Task 时转为 Task。

菜单在所有可读普通消息上存在，不能再由 `convertTaskAction` 是否存在决定。回应/收藏继续调用既有
`MessageSocialStore`，Thread 继续调用 `onOpenThread`，Task 继续调用 `onConvertToTask`；上下文菜单不成为第二个业务
owner。

下列动作本批不伪造：

- 翻译：RAH 没有已冻结的 translation owner；
- 选择消息/转发/渲染图片：需要独立多选状态机，不能把一个 checkbox 冒充 Raft select mode；
- follow/unfollow：主列表目前没有 Human Thread follow read model，后续复用既有 Thread follower owner再接；
- 已绑定 Task 的完成/重开：Task lifecycle 已有 owner，但菜单需要当前 Human 权限与 stale revision，另立子批接线。

这些是明示的功能差距，不影响 P6.3a 修复“普通消息右键只有 Convert to Task、且很多消息根本没有菜单”的当前反例。

## 3. 唯一交互 owner

新增一个共享 `FloatingContextMenu` 负责 portal、backdrop、viewport clamp、focus、Escape、方向键/Home/End、
outside、scroll/resize 和 focus return。Saved card 与 Message menu 都复用它，不再各写一套 window listener。

`MessageContextMenu` 只把 Raft 顺序映射为已有 typed action props；位置 owner 只接受 anchor 与测量尺寸，不读取
Room/Message。touch long press 由 message article 调用同一个 open API，移动/结束只取消计时器。

## 4. failure-first 与验收

1. 纯模型红测：pointer/touch anchor 必须在菜单真实尺寸已知后做四边 clamp；菜单方向键循环且跳过 disabled。
2. Web 合同红测：普通消息必须始终接 `onContextMenu`；菜单必须含 portal/backdrop、七项回应、复制链接/Markdown、
   Thread、收藏与可选 Task，且 Saved 与 Message 共用同一个 floating owner。
3. 定向 Web、typecheck、产品 build、完整 `npm run check`、format、audit、diff check。
4. 隔离 Firefox desktop 与 `390x844`：真实右键、菜单顺序、快捷回应、复制、Escape/focus、outside、scroll、resize、
   touch 长按、Thread/Save/Task 回归。业务写入使用隔离 state，正式 4173 只做非写入打开/关闭与错误复核。
5. active-work 审计、完整备份、精确重启后才补 `D`。

## 5. 施工与验收记录

- failure-first：`floating-context-menu.test.ts` 和 `message-context-menu-contract.test.ts` 首次分别因缺少
  `floating-context-menu-model.ts`、共享 `FloatingContextMenu` 与 `MessageContextMenu` 失败；实现后与 Saved 菜单合同
  定向 `7/7` 通过。
- single owner：`FloatingContextMenu` 统一拥有 body portal、backdrop、真实尺寸四边 clamp、焦点、Escape、方向键、
  Home/End、任意 scroll/resize 关闭和焦点归还；Saved 与 Message 不再各自注册第二套监听器。
- pointer/touch：普通可读消息不再受“是否可转 Task”限制；真实 Firefox 右键、500 ms touch 长按、移动取消、
  Escape/focus return、快捷回应写入和清理均通过。长按和右键进入同一 anchor/menu owner，没有第二条移动端行为路径。
- canonical actions：回应/收藏继续使用 `MessageSocialStore`，Thread 使用既有 `onOpenThread`，Task 使用既有
  `onConvertToTask`；复制链接使用 typed message navigation，复制 Markdown 使用 canonical message body。
- 自动化：`npm run check` 通过——packages `797` 项中 `795` 通过、`2` 个真实付费 Provider 用例按规则跳过，
  Web `198/198`，真实回调回归 `34/34`；`format:check`、生产 Workbench build、Firefox 150.0.2
  `1440x1000`/`390x844`、`npm audit --omit=dev` 和 `git diff --check` 均通过，依赖漏洞为 `0`。
- 正式发布：发布前 Activation、RunAttempt、RuntimeProcess、Agent 独占 lease、InputRequest、Placement、Computer
  operation、Room SOS、cancellation 和 workspace lease 均为 `0`；两个正式数据库 `quick_check`/FK 检查通过。离线
  备份为 `/Users/sun/.rah/backups/pre-p63-message-context-menu-offline-20260902TS6zQes`（1.5G），随后以冻结产品构建
  精确重启 `127.0.0.1:4173`，PID `90041`。
- 正式浏览器：在正式 Room 上只读打开菜单，确认 `role=menu`、七项快捷回应、动作顺序“复制链接 → 复制
  Markdown → 在消息列中回复 → 收藏消息 → 转为任务”、四边均在 viewport 8px 内；Escape 后菜单消失且焦点返回原
  `ARTICLE`。页面没有 `NetworkError`、`JSON.parse`、可见 alert 或 console error/warn。未在用户正式状态上写回应、
  收藏或 Task。

明确剩余仍是本文件第 2 节列出的翻译、多选/转发、Thread follow read model 和 stale-safe Task 状态动作；这些没有
canonical owner 的项不能被本批 `C/A/L/D` 掩盖。
