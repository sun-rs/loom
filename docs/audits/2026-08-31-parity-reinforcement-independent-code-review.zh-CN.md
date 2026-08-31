# 前后端补强：最终独立代码复审

日期：2026-08-31。复审对象：[A–F 补强方案](../product/2026-08-31-parity-reinforcement-plan.zh-CN.md)及共享工作树；前置约束见[施工前独立复审](./2026-08-31-parity-reinforcement-preimplementation-review.zh-CN.md)。

本审计员不参与产品实现。未构建、重启、读取正式数据库/凭据、调用付费 CLI 或操作浏览器。只执行了源码读取、现有隔离测试、真实回调提取后的受控 Promise 反证和临时 Kernel fixture。浏览器与正式发布必须引用主审另行提供的证据。

## 当前裁决

**最终增量代码复验通过：30 项真实回调/effect/SSR 回归全部通过；本报告列出的初审和最后增量阻断均已在所列证据范围解除。** 最后六项组合反例曾独立失败，修复后未降低断言原样复跑通过，见 P1-D5 / P2-D6 / P2-C4。这不代替真实浏览器或正式发布验收。初审虽然 34 个现有定向测试全绿，仍发现 Activity 筛选卡死、不同动态引用争抢导航、异步新私信回跳，以及“全部已读”迟到覆盖新请求状态。以下保留完整初审红灯，最终状态以本节和“最终复验”节为准。

## 执行记录

现有测试命令（不含构建）：

```sh
node --test packages/daemon/test/local-runtime-inventory.test.ts packages/kernel/test/global-discovery.test.ts packages/kernel/test/workspace-management.test.ts apps/web/test/parity-attention.test.ts apps/web/test/diagnostic-references.test.ts apps/web/test/global-discovery.test.ts apps/web/test/workbench-build-isolation.test.ts
```

结果：34 passed / 0 failed，约 4.42 秒。2,000-message Activity + Search 为约 25.8ms；1,200-reply unfollowed Activity 为约 6.2ms，仅是当前临时测试机器的观测，不是生产 SLA。

另行执行 `room-kernel.test.ts` 中 credential / generation pattern 的 3 项，以及 Client HTTP / SDK 的 6 项，均通过；本审计员共重新运行 43 项现有测试。它们不包含下面的独立回调红灯计数。

新增独立测试不改产品：使用 TypeScript AST 从现有源码抽取 `mark`、`readVisible`、`DiagnosticReferences.open`、`openDirectRoom` 的真实函数体，以受控 transport Promise 注入页面意图、error、pending 观察器。未用重新手写的算法替代待测回调。Kernel 测试复用 `global-discovery.test.ts` 的 `fixture()`，每次创建独立临时目录、临时 SQLite，并由 fixture 关闭和移除。

可重跑的[真实回调审计脚本](./fixtures/2026-08-31-real-callback-regressions.mjs)：

```sh
node --test docs/audits/fixtures/2026-08-31-real-callback-regressions.mjs
```

初次落盘 8 项为 3 passed / 5 failed；增加外层 Agent 面板收尾后为 9 项、3 passed / 6 failed。通过的是 Activity filter cleanup、跨动态行共享 ticket、复制失败重试；未通过的是全部已读 success/error 两条、迟到 DM、迟到 createRoom、Thread 同步 invalidate、迟到 DM 外层关闭新面板。这些红灯均为行为断言失败，不是未注入依赖的 ReferenceError。

修补后仅新增真实依赖接线（`beginNavigation`、`setCopyError`、成功 DM 的 `setPeekAgentId` 等），且把 `invalidateNavigation` 本身也改为抽取 App 的真实 callback，原 9 项得到 9 passed / 0 failed。再加强迟到 mutation 仍合并自己的 Room、不同点击共享 mutation 但不共享意图等断言，最终为 16 passed / 0 failed。未削弱旧断言来接受错误行为。

Inbox 追加 4 个实际 effect / callback 假时钟测试，初次 0 passed / 4 failed；实现修补后原样复跑为 4 passed / 0 failed，总计 20 passed / 0 failed。另独立复跑最新 Global Discovery 12 项、manager provision/configure 2 项，均通过。

最后重新执行 34 项基础集合，仍为 34 passed / 0 failed，约 4.32 秒。该审计脚本在 `docs/audits/fixtures/`，已由 `test:parity:regression` 接入默认 `npm run check`；本审计员确认 package.json 接线，并通过该 npm 命令实际运行，而不是只确认脚本存在。

最后增量新增的 hung Inbox、Activity exact callback、offline Avatar 与 Notification SSR 原 4 项均独立通过（合计原 24 项）。Global Discovery / filters / attention 三个测试文件另独立执行 14/14 通过。随后在真实 `mark` → App `openDiscoveryLocation` → filter change / Thread close 的组合上补出六项新反例：前五项运行得到 24 passed / 5 failed，第六项单独执行失败；均为行为断言，不是提取器缺少依赖。

实现 owner 修补后，本审计员原样执行 `npm run test:parity:regression` 得到 30 passed / 0 failed（约 555ms），另复跑上述三个 route/filter/attention 文件得到 14 passed / 0 failed。未运行 full check 或构建；这些由主审另行负责。

一轮测试脚本最初误用 `event.seq` 而不是 Room sequence，触发测试脚本自身的 undefined 校验错误；已改用同 fixture 的 `head(roomId)` 后重新执行成功，不将该脚本错误计为产品缺陷。

## 已得到独立通过证据的部分

### A：代码路径与资产快照

`vite.config.ts:35` 将普通 build 写入 `dist`、可信 workbench 写入 `dist-workbench`。`scripts/workbench-web-assets.mjs` 在内容摘要目录保存实际已读取的资产字节；两个 runner 使用快照目录，打包/安装使用产品目录。隔离资产测试验证后续源资产改变不改旧快照、相同摘要复用、产品目录缺失时拒绝。

限制：这不是本审计员执行普通 build 后与正式浏览器对照的证据，也不证明旧 4173 已切换 runner。真实运行目录及认证入口由主审另验。

### B：Host 观测和权限

- 已确认 management grant/revoke 与 provisioning 不再写 `last_seen_at/ms`；保留 participant scope 与 credential 条件。Host credential/instance/state fence 仍在 `auth.ts`，本次没有用前端状态取代运行权限。
- `local-runtime-inventory.ts:90` 固定读取当前 daemon Host，只返回 allowlisted Computer 字段；未暴露 Host credentials、processId 或整个 HostRecord。
- 独立边界模拟通过：age 等于 staleAfterMs 为 offline；少 1ms 为 online；未来 lastSeen 为 unknown；显式 offline 优先。没有 CLI 不会直接改变 Host 连接状态。
- 使用真实临时 Kernel 的 Agent actor 调用 inventory，仍因 `listAgentCatalog` 的 Human 要求而拒绝。现有 HTTP 认证路径未绕开。
- `App.tsx` 对 inventory error 将 Computer 展示为 unknown，未将一次 fetch 失败转换成“已证明离线”通知。新观察仍沿协议 schema / SDK 传递。

覆盖更新：`workspace-management.test.ts` 已在 configure、rebind、delete 前分别前进 fake clock，并比较所有 Host 的 lastSeen（含不相关 Host）保持不变；加上原 provisioning 断言，本审计员重新执行这两个测试均通过。原“仅 provisioning 有直接断言”的缺口已补。管理操作与接管 deadline 的完整组合 E2 未新增，但现有 generation/credential 测试此前独立通过。`useReconciledQuery` 的非合作 transport 截止行为仍需见下文。

### C：摘要不是当前页相加

`human-activity.ts:104` 的 summary 使用同一 CTE 的 grouped 数据，不复制 ACL/follow/read 算法。独立临时 Kernel 补测通过：

- 创建 55 个有未读回复的 Task Thread；`limit:1` 仅返回 1 张卡，`summary.unreadActivityCount` 仍为 55。
- unfollow 后变为 54；相似 handle `@humanity` 不恢复资格，精确 `@human` 恢复为 55。
- 仅 thread 未读时 `summary.rooms` 为空；增加顶层消息后对应 Room 为 1；标顶层已读不会清掉 55 个 thread 未读卡。
- 陌生 Human 对同 Workspace 的 summary 为 0；既有退群/跨 Workspace 测试亦通过。

必须如实说明的口径：Room/DM 摘要只选择 `scope_id = ''`，**不汇总 thread 回复**；全局 Activity 包含符合资格的线程。这是两个字段的明确差异，不能把 Room 计数称为全部未读消息。

**旧 cursor 差异已修复，撤回此前将其列为当前保留差异。** 初审确曾独立测得旧 cursor 摘要 55、新请求摘要 56；现实现以同一个 `eligibilityArguments(ceiling)` owner 为列表传 frozen ceiling、为 summary 传最新 ceiling，不复制资格 SQL。新增 `Activity summary stays current while the list cursor retains its frozen ceiling` 测试由主审记录先红 `2 != 3`；本审计员独立重跑后通过：旧页 total 保持 2，summary 变成 3 且包含后来新增的 DM。Global Discovery 全部 12 项通过。

### E：限定 Room 的短引用与 ACL

`global-discovery.ts:253` 先验证 Human 与给定 Room membership；完整 ID 必须属于给定 Room；非完整 ID 仅在该 Room 内用 literal `substr` 寻找、最多取两条，歧义拒绝；最后重新检查命中消息 Room membership。

既有授权/陌生人/错误 Room/过短 ID 测试通过，独立增加“两条相同八字符前缀”的临时消息后也确认拒绝，没有 SQL LIKE wildcard 或任意挑一条。解析结果只导航本地 canonical Room/message，不执行文本中的任意 URL。

这是有限的 `#channel[:messagePrefix]` / `dm:@name` 解析，不是全部 Task 引用格式或所有自然语言引用都已支持。后续源码已观察到 provider 按当前 Workspace 限定候选 Rooms；其浏览器正确目标由主审验证。

## 初审发现与修补复查账本

### P1-D1：不同动态行仍可能打开先返回的旧目标

初始 `DiagnosticReferences` 每个组件各持有一个 latest-request gate。按 A、再按 B；A 比 B 先返回，会导航 A 并改变全局 epoch，B 因而失效。

真实函数反证输出：

```json
{
  "case": "A click then B click across DiagnosticReferences components; A resolves first",
  "nav": ["message-a"],
  "expected": ["message-b"],
  "defect": true
}
```

最终复验：已改为 App provider 的共享 `requestGate` 和 `beginNavigation`，每个组件仅持有自己的取消 ticket。分别执行“无 cleanup、A→B、A先返回”和“旧组件 cleanup/迟到失败不能取消或污染 B”两类测试，均通过；不再以 cleanup 掩盖旧请求争抢。

### P1-D2：新私信 mutation 迟到仍会抢回页面

初审 `App.tsx:1553` 的 `openDirectRoom` 在 await 后无意图核对，直接清线程、设置新 Room/surface。提取真实 useCallback 执行“打开尚未存在的 DM → 用户选择 Settings → mutation 完成”：

```json
{
  "case": "open new DM then choose Settings before mutation returns",
  "surface": "room",
  "selected": "late-dm",
  "expectedSurface": "settings",
  "defect": true
}
```

修复要求：mutation 可以完成并合并自己的 Room 目录；但迟到成功不得选中 Room、清当前线程/定位或关闭用户新打开的面板。createRoom 同型 await 后选择路径也应检查。不能取消请求就声称业务 mutation 未发生。

另外，`agentDetailProps.onOpenDirectRoom` 包装器在 await 内层后无条件 `setPeekAgentId(undefined)`，即使内层抑制回跳，外层也可能关闭后来选中的 Agent 面板。脚本已独立断言“原 A 请求完成后，后来选择的 B 面板仍保留”；初审实际得到 undefined 而非 second-agent。

同型同步入口：`openThread` 与 Thread close 原先只改变 thread state，URL 由之后的 effect 写入；没有同步 invalidate epoch 的间隙仍可能接受旧诊断导航。原先为源码竞态证据，随后落成真实回调断言并先红后绿；不冒充真实浏览器已重现。

### P2-D3：Activity 请求中切筛选后永久 disabled

初审 Activity `mark(open=true)` 捕获 href；点击筛选后 href 改变，旧 current() 永远 false，而 finally 也仅 current 时清 pending。过滤按钮没有禁用，组件保持挂载，导致所有卡片和已读按钮始终 disabled。

```json
{
  "case": "Activity filter change while context pending",
  "pending": "channel:a",
  "opened": [],
  "expectedPending": null,
  "defect": true
}
```

最终复验：增加 actionScope/client/workspace 的 effect，取消旧 gate 并清 pending/error。脚本先使旧请求在 effect 之前返回，断言不导航，再执行真实 cleanup effect，断言 pending 释放；已通过。

### P2-D4：“全部已读”的迟到出口仍覆盖新请求

在上述 actionScope 修补之后，`readVisible` 初审仍未加入 gate。真实函数反证：全部已读 A pending → 改筛选、effect 清旧状态 → 新卡 B 开始 context → 旧 A 完成，其 finally 把 B pending 清空；catch/error 与 result.refresh 同样无身份限制。

```json
{
  "case": "old all-read completes after filter change and new context request",
  "pending": null,
  "expectedPending": "new-b",
  "defect": true
}
```

最终复验：同 action owner 发 ticket，循环每次发送前检查 current，成功/错误/finally 也受 ticket 限制。原 success 与 error 两个反例均通过，不会清 B pending、污染 B error 或刷新旧查询；已完成的 canonical read 不回滚。

### P2-F1：复制成功后快速重试失败会留下永久成功提示

初审代码第二次点击清除 1500ms timer，但失败只写 error，不清 copy=true。已反馈施工者；后续实际回调模拟“首次成功 → 1.5 秒内重试失败”结果为 `copied=false,timers=0,error=无法复制路径`，**本反例在修补后已通过**。

目录刷新取消与保留展开的测试目前主要是源码正则；看到移除 revision key 不等于验证展开状态和跨 Agent 晚返回的完整渲染。文件树真实布局由主审浏览器证据负责。

### P1-C3：首次读取后异步产生的 InputRequest 不自动出现在铃铛

主审转交的独立浏览器反例：隔离 4195、`FIRST_AGENT_INPUT=1`，Task 已是 waiting_input，但铃铛仍为 0，等待约两分钟仍不变；reload 后立即变为 1。本审计员未操作该浏览器，只接收此证据，并另做代码反证。

原 `refreshHumanInbox` effect 没有自己的周期 reconcile/focus 恢复；只在 effect 依赖变化后读取。首次查询返回空之后，Agent 异步提出问题不保证触发它。其 Promise.all 成功出口也未检查 signal，旧 Room/连接查询在取消后仍可回填。

实际源码提取后的 4 个测试全部先红：

- mount 返回空；模拟五个可见秒后产生的 pending 仍为 `[]`，期望 `['question']`；
- 已 abort 的旧查询迟到返回，实际写回旧 pending，期望保持空；
- hidden 15 秒后调用次数仍为 1，期望 2；
- 初次失败五秒后调用次数仍为 1，期望自动重试。

最新实现同一 effect 内拥有可取消单飞 reconciliation：成功/失败后按 visible 5 秒、hidden 15 秒调度，visibility/focus 可提前唤醒；卸载清 timer/listener 并 abort。refresh 入口和 Promise.all 成功出口都检查 signal。原 canonical `inputRequest.resolve` 因果 mutation 与按 ID 移除没有改成“点铃铛即解决”。原 4 项不改断言复跑全部通过，完整审计脚本 20/20 通过。

最后增量已加每次 request 独立 AbortController 和 15 秒 Promise.race deadline；受控 transport 永不 settle 时能超时并再次请求，旧请求后来返回也不会覆盖新数据。原“没有单次 deadline”的限制已撤回。下面另列此次发现的卸载 timer 清理遗漏。

### P1-D5：Activity 保持背景后，成功打开或取消线程目标留下永久 pending

这是最后 Activity Thread 增量的真实缺陷。`GlobalActivity.mark` 验证 current 后调用 `onOpen`，App 的 `openDiscoveryLocation` 最终调用 `setSurface`，同步 invalidate 导航 epoch；`mark` 的 finally 因 current=false 不清 pending。现在 surface 仍是 activity、组件 key 未变而不会卸载；pushState 也不触发 `useFilters` 的 popstate，actionScope 不保证改变。于是成功打开 Thread 后，原 Activity 卡片和已读按钮仍 disabled。

实际组合反例：`Activity mark opening a Thread releases pending despite its own route invalidation` 得到 `pending='thread-card'`，期望 undefined。另以真实 Thread onClose 取消尚未完成的 Activity 目标：旧目标正确没有导航，但 `pending='next-thread'` 同样未释放。后者证明只在成功 onOpen 前清 pending 仍不足。

修复要求：区分“此 ticket 仍拥有当前 action 状态”与“此目标仍有导航资格”；过期目标不得导航/覆盖 error/refresh，但可释放自己仍拥有的 pending。不能改成不加身份判断的 finally，否则重新引入原 P2-D4。

最终复验：`latest-request` 增加 `owns()` 只检查 action generation；`current()` 仍检查 generation、Abort 和目标 valid。Activity 两个 finally 用 owns，仅释放自己仍拥有的 pending；导航、error、refresh 仍受 current 保护。成功打开与关闭 Thread 两个组合反例均通过，原“旧全部已读成功/失败不得清新 pending”两个反例也继续通过。

### P2-D6：Activity filter 的旧 URL 快照覆盖正在显示的线程身份

`useFilters.changeMany/clear` 以 mount/render 时 params 为基础，但线程导航只更新 App state 和 history，没有同步该 params owner。三个真实 hook / callback 用例先红：

- 打开 Thread 后切 filter：当前 room/thread/message 丢失，界面仍开线程，reload 无法恢复；
- 从带 Thread 的初始 URL 进入，再关闭 Thread 后切 filter：旧 thread/message 重新出现，reload 会复活已关闭目标；
- 打开 Thread 后 clear filters：同样丢失当前 room/thread/message。

修复要求：filter owner 修改自己的筛选键，导航键 room/thread/message 取当前 URL（包含删除）；不要用旧 params 复活导航，也不要让纯导航身份变化伪装成筛选变化。已有 route 纯函数通过不代表组合状态同步通过。

最终复验：同一 `preserveCurrentLocation` owner 在 changeMany 和 clear 中读取当前 window search，先删除旧导航键再选择性写回当前值；Activity 取 room/thread/message，其他 surface 仅 room。三个方向的组合测试全部通过；Tasks/Search 的既有 filter 兼容测试亦通过。本次未重新实现一个客户端路由真相源。

### P2-C4：Inbox 卸载没有清理当前 deadline timer

最后增量在 reconcile 函数内声明 deadline，cleanup 只能访问周期 timer 和 activeRequest。真实 effect + 永不 settle transport：cleanup 已 abort signal、移除 listeners，但 fake timers.size 仍为 1，期望 0。残余 timer 到 15 秒才释放；现有 controller guard 没有观察到迟到状态污染，因此此项是资源清理缺陷，不升级为已证实的数据隔离失效。

修复要求：让 effect cleanup 拥有当前 deadline，卸载时同步取消；维持新请求独立 signal 与旧成功出口检查。

最终复验：effect 增加 activeDeadline，cleanup 同步清周期与 deadline 两种 timer 并 abort 当前请求。永不 settle transport 在 cleanup 后 timers=0、listeners=0、signal.aborted=true，推进假时钟也无重试/写回；超时后能正常重试且迟到成功不能覆盖的原用例继续通过。

## 仍须明确的证据边界

- `useReconciledQuery` 有单飞、15 秒 Abort、卸载 stopped guard 与 5/15 秒刷新；初审超时只 abort，没有独立结束 awaited Promise。独立抽取 effect、让 transport 永不 settle 后，15 秒 timer + focus 得到 `calls=1, aborted=true, state=null`。若自定义 transport 不配合 Abort，pending 会一直为 true，旧数据不产生 error。当前默认 HTTP fetch 可合作取消，因此这是适配器边界，不冒充默认生产 transport 已证实会卡死。
- 通知已分离 InputRequest 与 Computer 系统事项；dismiss 不 resolve InputRequest。版本采用 Host/generation/最后观测时间，采样时间 observedAt 不进入 key，稳定失联不会每轮重新提示。多窗口偏好同步和所有通知类别不在本轮证据内。
- 34 个绿测试包含纯函数和源码正则，不是交互总数，也不能取代上述真实回调反证。本次另以 30 项真实回调/effect/SSR 测试复验修补后的工作树，所撤销的仅是这些用例覆盖的初审未通过项。
- offline Avatar SSR 确认真实组件始终渲染 presence，并在 offline 时输出 `data-online=false` 与“离线”无障碍标签；CSS 对 false 使用 `--presence-off`。灰色还包括暂停/不可用/未知等非在线状态，区别由 label 保留，不应将所有灰点都声称已证明断线。Notification 的桌面/移动按钮 SSR 确认展开时仍保留系统事项点，实际 rail 接线已读到；这不是屏幕像素或色彩对比度验收。

## 最终复验

| 项目                             | 最新独立结果                    | 证据范围                                                  |
| -------------------------------- | ------------------------------- | --------------------------------------------------------- |
| 原 9 项反例                      | 全部通过                        | 同一真实回调抽取脚本，保留原行为断言                      |
| 同 Workspace + peer 重复点 DM    | 1 次 mutation，最后点击获导航   | Promise 复用、每点击新 intent、请求表清理                 |
| 不同 peer / 跨 Workspace 同 peer | 2 次独立 mutation，后点击获导航 | 旧结果先到不能抢先；两个 canonical Room 均补入目录        |
| DM 与诊断目标交叉点击            | 两种顺序均后点击获导航          | App 的真实 invalidate callback 与诊断 begin 共享 epoch    |
| 新头像面板打断旧 DM              | 新面板保留，不导航旧 DM         | 真实头像 onOpen 与 DM callback                            |
| 旧诊断组件 cleanup/迟到错误      | 不取消或污染新目标              | 组件 own ticket 与共享 gate 分离                          |
| B/C/E 基础测试集合               | 34 项再次全部通过               | fake/临时 Kernel，不是正式环境                            |
| Inbox 异步更新及取消             | 4 项先红后绿                    | 5 秒出现、hidden/focus/单飞、失败恢复、迟到成功拒绝       |
| Inbox 挂起与卸载 deadline        | 2 项通过，cleanup 项先红后绿    | 非合作 transport 超时重试、旧成功拒绝、卸载 timer=0       |
| Activity 保留背景的线程交互      | 6 项通过，其中 5 项先红后绿     | exact callback、自身/其他导航取消、filter 三方向组合      |
| Avatar / Notification SSR        | 2 项通过                        | 离线 presence 保留、桌面/移动铃铛展开仍保留系统点         |
| 最新回调/effect/SSR 默认门禁     | 30 项全部通过                   | 通过 npm script 实跑，已接入 npm run check                |
| 最新 Global Discovery            | 12 项全部通过                   | summary 使用最新 ceiling，列表仍保持 frozen cursor        |
| Host 管理写入                    | provision/configure 两测试通过  | configure/rebind/delete 前进 fake clock，全 Host 时间不变 |

截至本次复验，本报告初审发现的 P1-D1/P1-D2、P2-D3/P2-D4/P2-F1、浏览器补充后独立反证的 P1-C3，以及最后增量 P1-D5 / P2-D6 / P2-C4 均已在所列自动化范围解除。最新 30 项没有未通过项。Room 摘要顶层口径、有限引用格式、`useReconciledQuery` 非合作 transport 边界仍保留如上，不应在最终产品声明中消失。旧 cursor summary 不新鲜及 Inbox 没有 request deadline 两项旧限制已撤销。

本审计员未执行浏览器布局、真实服务切换或生产数据验证。最终主审只能将本报告与相应浏览器/部署证据合并，不能把本报告本身写成全站或正式交付 100% 通过。
