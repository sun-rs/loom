# R9 前端故障回退与 iOS 键盘验证（2026-09-16）

施工单：`docs/product/2026-09-16-rc-repair-and-hardening-guide.zh-CN.md` §6 R9。
对照审计：`docs/audits/2026-09-16-rc1-audit-and-latest-raft.zh-CN.md` H3 行
（「有价值的未复现风险：需要 iPhone 实机验证；缺 visualViewport/某个 meta 不足以
证明必然遮挡」）与 Top-12 第 3 行「Web 错误边界与 iOS」。

## 工作项与裁决

本工作项拆成两个互不替代的裁决：

| 子项              | 裁决     | 说明                                                           |
| ----------------- | -------- | -------------------------------------------------------------- |
| R9-A 渲染故障回退 | 确认缺陷 | 全仓零错误边界，任一渲染抛错会白掉整个工作台；已按 TDD 修复    |
| R9-B iOS 键盘遮挡 | 待实机   | 现象未复现；只加只读诊断与验收脚本，未改 viewport/scroll owner |

R9-B 明确保留为**待实机验收**：本批次没有 iPhone 实机，不用 390×844 模拟视口
或 WebKit 桌面引擎的测量结果代替结论。

## 证据

### R9-A 原行为

- `apps/web`、`packages/ui-web` 内 `ErrorBoundary`/`componentDidCatch`/
  `getDerivedStateFromError` 命中数为 0。
- `apps/web/src/mount-app.tsx` 原本只有 `<StrictMode><App /></StrictMode>`。
- `apps/web/src/App.tsx` 的 `WorkspaceScreen` 单个组件约 4000 行，会话、话题、
  任务详情、成员目录、设置、全局发现共用同一棵子树。任一页面渲染抛错 → React
  卸载整棵根树 → `#root` 为空 → 白屏，连底部导航都消失，用户只能整页 reload。
- 失败测试（实现前记录）：`node --test apps/web/test/surface-error-boundary.test.ts`
  → `ERR_MODULE_NOT_FOUND surface-error-boundary-diagnostic.ts`，7 个用例 0 通过；
  补齐模块后仍有 5 个失败（渲染面板、脱敏、包裹契约、viewport 诊断）。

### R9-B 现有 owner 与预期行为

移动布局 owner：

- `apps/web/src/mobile-navigation.css:9-24`：`html:has(.rah-product-shell)` 为
  `position: fixed; inset: 0; overflow: hidden; overscroll-behavior: none`，
  `body`/`#root` 同为 `height:100%; overflow:hidden`。文档本身不滚动。
- `.app.rah-product-shell` 为 `position: fixed`、`inset: 0`，并带
  `padding-top: env(safe-area-inset-top)`。
- `.channel`（`packages/ui-tokens/src/neo-brutalist/styles.css:228`）是纵向 flex，
  `.messages` 为 `flex:1; min-height:0; overflow:auto`（唯一滚动体），
  `.composer` 是普通流末尾元素，不是 `position: fixed`；移动端额外有
  `mobile-navigation.css:140` 给 composer 的
  `padding-bottom: max(8px, calc(env(safe-area-inset-bottom) - 12px))`。
- `apps/web/index.html` 的 viewport meta 为
  `width=device-width, initial-scale=1.0, viewport-fit=cover`，无
  `interactive-widget`。全仓 `visualViewport` 命中数原为 0。

在 iOS standalone PWA 上键盘弹出时的预期（依据 MDN Visual Viewport API 与
WebKit 的已知行为）：

| 断言                                                                                                                                             | 置信度                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| iOS 键盘**不缩小布局视口**，只缩小 visual viewport；`window.innerHeight` 基本不变                                                                | 高（这也是 Visual Viewport API 在 iOS 上存在的原因）                    |
| `interactive-widget=resizes-content` 是 Chromium 的 viewport 特性，iOS Safari/WebKit 不实现                                                      | 高——所以「补上这个 meta」不是可依据的修复                               |
| `100dvh` 同样不随键盘变化                                                                                                                        | 高                                                                      |
| 因为 `html{position:fixed;overflow:hidden}`，Safari 无法用文档滚动把焦点元素移入可见区，会改用 visual viewport 的 `offsetTop`/`pageTop` 偏移整页 | 中——偏移量与是否回零必须实测                                            |
| 键盘弹出期间 `env(safe-area-inset-bottom)` 归零（home indicator 被键盘覆盖）                                                                     | 低——这正是必须在实机上量的一条：它直接决定 composer 的 `padding-bottom` |
| 焦点在 `.composer` 的 textarea、而其祖先是 `position:fixed` 且不可滚动的容器时，composer 是否被键盘遮挡                                          | 未知——**本批次不下结论**                                                |

结论：现有代码不存在可凭静态阅读判定的缺陷。缺 `visualViewport` 调用、缺
`interactive-widget` 都不是失败证据；在没有实机数字前修改 viewport 或 scroll
owner，会同时危及已锁定的移动导航合同（图标底栏、进入子页隐藏底栏、逐层返回）
和既有滚动位置/菜单合同。

## 改动

### R9-A 共享错误边界（单一 owner）

新增：

- `apps/web/src/components/surface-error-boundary.tsx`——唯一的渲染故障 owner。
  正常时**透明**返回 `children`（不额外包一层 DOM），因此依赖直接子元素的
  shell 选择器（`.rah-product-shell > .rah-mobile-nav`、
  `:has(> .rah-agent-directory-page…)`）保持成立。
- `apps/web/src/components/surface-error-boundary-diagnostic.ts`——纯函数：脱敏
  与复位规则。单独成文件是为了能在 `node --test` 下直接做行为断言（仓库的
  `apps/web/test/*.test.ts` 不经打包器，无法直接导入 `.tsx`）。

行为：

- 抛错时用**自带内联样式**的恢复面板替换该区域（样式表/令牌包本身出问题时仍
  可见可点），提供「重试此区域」（就地复位边界，重新渲染同一份父级数据）和
  「重新加载」两个动作。
- 诊断只保留 `错误名: 消息`，单行化、截断到 200 字符，并抹掉
  `Bearer …`、`token/secret/password/api_key/authorization/cookie/session=…`、
  JWT（`eyJ…`）、`sk-…` 及 24 位以上的连续 token 片段，替换为 `[已脱敏]`。
  堆栈不进面板；`componentDidCatch` 只写 `console.error` 诊断，不落库、不重启
  后台、不触碰 Room 账本。
- 边界只有 `{diagnostic, resetKey}` 两个字段，不含消息/草稿/选择/阅读位置；
  复位是 props-only：`resetKey` 变化才清除失败，同一 `resetKey` 下不自愈
  （否则失败子树会无限重渲染）。

包裹位置（`App.tsx` 只加包裹行，未移动任何状态 owner）：

| 边界            | 范围                                       | resetKey                                                |
| --------------- | ------------------------------------------ | ------------------------------------------------------- |
| 工作台          | `mount-app.tsx` 整个 `<App />`             | —                                                       |
| Room 列表       | `RoomSidebar`                              | —                                                       |
| 全局发现        | `GlobalDiscoverySurface`（任务/搜索/动态） | `surface`                                               |
| 收藏消息        | `SavedMessagesPane`                        | —                                                       |
| 设置            | `SettingsSurface`                          | —                                                       |
| 成员目录        | `AgentDirectoryPane`（agents 页）          | —                                                       |
| 成员浮层        | `AgentDirectoryPane`（peek 面板）          | `peekHumanId ?? peekAgentId`                            |
| Computer 运行时 | `ComputerRuntimePane`                      | —                                                       |
| 会话            | `<main class="channel">`（聊天/任务/文件） | `activeRoomId`                                          |
| 话题            | 话题与任务详情（含任务弹窗）               | `activeThreadRootMessageId ?? globalTaskDetail?.taskId` |

`WorkspaceNavigation` 仍由 shell 直接渲染，不在任何页面边界内部：单个页面失败后
底栏/导航仍可用，切换目的地即换到另一棵子树。

与 Raft 的有意差异：不引入上游的远程错误上报通道；诊断只留在本机 console 与面板。

### R9-B 只读 viewport 诊断

`apps/web/src/components/workspace-navigation-shell.tsx` 增加
`useViewportDiagnostics()`：只有 URL 带 `?rahViewportDebug=1` 时启用，订阅
`visualViewport` 的 `resize`/`scroll` 与 `window` 的 `resize`/
`orientationchange`，把 `innerHeight`、`documentElement.clientHeight`、
`visualViewport.height/offsetTop/pageTop/scale`、`document.activeElement.tagName`
以及 `.composer`/`.rah-mobile-nav`/`.messages` 的 bounding rect 和 composer 的
计算 `padding-bottom` 写进 `console.info`。它不写 DOM、不改样式、不阻止事件、
不调用 `scrollTo`，默认完全不注册监听。

**未改动**：`index.html` 的 viewport meta（`interactive-widget` 在 iOS 无效，
没有证据支持）、`mobile-navigation.css` 的 `html{position:fixed}` 与 scroll
owner、composer 的 safe-area padding。

## 验证

| 命令                                                                           | 结果                                          |
| ------------------------------------------------------------------------------ | --------------------------------------------- |
| `node --test apps/web/test/surface-error-boundary.test.ts`（实现前）           | 失败：模块缺失 / 5 个用例红，作为预期失败记录 |
| `npx tsc --noEmit -p apps/web`                                                 | 通过（`exactOptionalPropertyTypes` 下无错）   |
| `node --test apps/web/test/*.test.ts`                                          | 445 passed / 0 failed                         |
| `node scripts/test-mobile-tab-navigation-browser.mjs`（chromium 390×844）      | PASS                                          |
| `RAH_MOBILE_ENGINE=webkit node scripts/test-mobile-tab-navigation-browser.mjs` | PASS                                          |
| `node scripts/test-mobile-message-menu-browser.mjs`                            | PASS（`failures: []`）                        |
| `npx prettier --write <本次文件>`                                              | 已格式化                                      |

测试覆盖的外部可观察不变量：

- 子组件抛错后渲染出非空恢复面板（含区域名、两个动作、脱敏诊断），面板里没有
  `sk-live-…` 之类凭据片段、没有堆栈帧。
- 无错误时边界渲染结果与子元素**逐字符相同**（`<main class="channel">内容</main>`），
  证明不会破坏 shell 的直接子元素选择器。
- 脱敏：Bearer / `token=` / JWT / `secret:` / 超长消息截断 / 换行制表符归一 /
  非 Error 值。
- props-only 复位：同 `resetKey` 返回 `null`（不自愈），新 `resetKey` 清除失败。
- 源码契约：边界不含 `useState`/`localStorage`/`client-sdk`；`mount-app` 与
  App.tsx 十处边界存在；viewport 诊断受查询开关控制且不改布局。

未做（按交办范围）：未运行 `npm run check`、未构建、未安装依赖、未跑付费 CLI。

## 部署

**未部署**。本批次没有重启现役本地工作台，没有重新构建工作台资产，没有改动
daemon/内核/数据库。恢复面板的「重新加载」只做 `window.location.reload()`，
不触碰后台进程与历史。回退条件：本工作项改动集中在
`surface-error-boundary*.{tsx,ts}`、`mount-app.tsx`、`App.tsx` 的包裹行、
`workspace-navigation-shell.tsx` 的诊断 hook 与本文档，撤销即回到基线行为。

## 剩余项

### 前端

- 恢复面板的真实浏览器门禁（故障注入 fixture + 截图）未做：现有
  `apps/web/test` 不经打包器，边界的失败路径是用组件真实的
  `getDerivedStateFromError` + `render()` 经 `react-dom/server` 断言的；
  `react-dom/server` 不执行 class 错误边界，因此「客户端点击重试后恢复」这一步
  仍只有纯函数级证据。
- 恢复面板样式为内联，未接入设计令牌：这是刻意的（样式失效时也要可用），若日后
  要纳入 UI spec 需按 `docs/design/component-specs` 流程单独立项。

### iOS 键盘（待实机验收）

必须在真实 iPhone 的 standalone PWA 上执行，**不能用 390×844 浏览器窗口代替**：

1. 以 `?rahViewportDebug=1` 打开工作台（PWA 场景先在 Safari 打开该 URL 再
   加入主屏幕，或对已安装 PWA 走同一入口 URL），Mac 端 Safari「开发」菜单连接
   该设备读取 console.info。
2. 依次在 **Room 正文 composer、DM composer、Thread composer、搜索输入框**上：
   点击输入 → 键盘弹出 → 输入若干字符 → 收起键盘 → 横竖屏各旋转一次 → 逐层
   返回列表。每步记录 `visualHeight`、`visualOffsetTop`、`innerHeight`、
   `composer.bottom` 与 `composerPaddingBottom`。
3. 判定标准：标题栏与底栏（底栏在子页按既有产品决定隐藏）位置固定、composer
   可见且不被键盘覆盖、中间 `.messages` 可滚动且滚动位置在键盘收起后复原、
   旋转后不留白边、返回列表后 `visualOffsetTop` 归 0。
4. 先在 390×844 桌面浏览器跑同一路径确认无桌面回归（本批次已跑，PASS），再以
   实机结果决定是否需要改 viewport/scroll owner。任何改动都必须保留：图标底栏、
   进入子页隐藏底栏、逐层返回，以及 `html{position:fixed}` 之外不新增逐页
   `touchmove` 阻止器。

在拿到上述实机数字前，H3「iOS 键盘遮挡」既不判定为缺陷，也不判定为已修复。

### 后端

无。本工作项不涉及 daemon、内核、数据库与执行围栏。
