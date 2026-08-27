# Raft UI reference

这是独立管理的 Raft Web/iOS 界面复刻与交互参考项目。Raft 已授权本项目使用其公开发布的
Web UI 资源；模板以发布 CSS、字体、SVG、运行时 DOM/计算样式和浏览器交互为规格源，
不是 RAH runtime、Conversation store 或 hosted service。

## 运行

从本仓库根目录启动任意静态服务器：

```bash
python3 -m http.server 8137 --directory .
```

入口：

- `slack.html`：Room 聊天、线程列、频道内 Task、Artifact、统一 composer。
- `activity.html`：Activity / inbox 聚合。
- `tasks.html`：全局 Tasks 路由、频道/创建者/负责人过滤菜单及看板/列表协议。
- `search.html`：跨 Room 搜索与过滤。
- `members.html`：Membership 目录；`agents.html` 是 participant / run 详情。
- `computers.html`：Computer / Runner / RuntimeProfile / Agent 分配与诊断。
- `settings.html`：个人与 workspace 设置。
- `billing.html`：套餐、容量与席位交互。
- `admin.html`：成员角色、系统 Room、邀请、加入协议、引导、翻译与成员权限。
- `mobile.html`：早期移动端组件陈列；核心页面自身也包含 390×844 响应式布局。

## RAH 对象映射

| UI 名词 | RAH owner | 说明 |
| --- | --- | --- |
| 频道 / 私信 | `Room` + `Thread` | UI 可以使用熟悉的协作语言，协议内部仍以 Room 为聚合根 |
| 成员 / Agent | `Membership` + `AgentParticipant` | 长期身份与 provider/runtime 解耦 |
| Computer | Runner registry | 机器在线状态、版本、能力与 workspace 探测 |
| Agent 运行时 | `RuntimeProfile` | provider、harness、model、auth profile 与 capability snapshot |
| 一次执行 | `RunAttempt` | 不可变记录；原生 Session 只作为 opaque inspector ref |
| 任务 | `Task` / `Decision` | 完成权不来自 stdout 或进程退出 |
| 文件 | `Artifact` | 只有显式发布并校验的 artifact 才进入 Room truth |
| 审查 | `Review` | 绑定 frozen diff、RunAttempt 与 evidence |
| 消息列 | `Thread` | 与 Room ledger 共用 cursor/identity，不建立第二套会话 store |

## 交互协议与组件边界

Chat、Search、Activity、Tasks、成员/Agent、Computer、Settings、Billing 与 Admin 九个桌面路由族已经迁移到版本化的
`raft:ui-intent` / `raft:ui-state` v1 协议。协议结构由
`protocol/raft-ui-protocol.schema.json` 约束，当前动作目录在
`protocol/raft-ui-actions.json`；请求具有稳定 identity、domain/action/target/payload，
并严格经过 `pending → succeeded | failed | cancelled`。失败和取消会执行乐观投影的回滚，
同一事务不允许第二次终结。

`ui/raft-ui-runtime.js` 是唯一事件/异步 owner，并按版本化动作目录拒绝未登记动作；它不再内置 fixture
成功路径，没有 adapter 时以 `ADAPTER_REQUIRED` 失败。11 个静态对照入口显式加载无网络能力的
`ui/raft-ui-reference-adapter.js`；产品只能在另一 composition 中通过 typed adapter 接入 `RahClient`，
`rah-client` adapter 不能安装到 reference surface。Chat composer
在确认前保留草稿和稳定 message/turn identity；搜索请求可按 key 替代旧事务；密码只通过 adapter
的 sensitive context 传递，不进入 DOM 事件；事务控件在 pending 期间由 runtime 独占，永久成功态在
临时锁解除后的 `commit` 中落地。`ui/raft-ui-primitives.js` 统一了 Chat、成员与 Computer 的拖拽边栏，
并提供 disclosure、分段单选和带搜索/键盘/外部关闭协议的 listbox select。旧 `raft:*` 页面事件仍兼容发出，但不是新集成契约。
当前这层尚未接入 `rah_os` 的 transport、权限与 canonical stores，独立 `mobile.html` 也仍是早期组件表面；
`integrations/rah-os/` 不被任何参考 HTML 加载，也不包含 HTTP path、credential 或内建 command mapping；
`protocol/rah-ui-capability-inventory.json` 对 74 个 intent 逐项记录前端 owner、所需能力和当前后端阻塞状态。
这些缺口不能被解释为“全站交互已 100% 收口”。

## 视觉协议

- 发布规格单一事实源：`vendor/raft/manifest.json`（发布物 URL/bytes/SHA-256）和
  `generated/raft-official-components.json`（主页面 DOMRect、computed style、官方 class/SVG）、
  `generated/raft-official-overlays.json`（成员、添加成员、频道设置的 focused live 状态）和
  `generated/raft-official-activity.json`（Activity 路由的脱敏 DOMRect/computed style）、
  `generated/raft-official-tasks.json`（Tasks 路由与过滤菜单的脱敏 DOMRect/computed style）、
  `generated/raft-official-members-page.json`（Agent 资料页与内联编辑态的脱敏 DOMRect/computed style）、
  `generated/raft-official-computers.json`（Computer 详情、Agent 列表、升级与恢复区的脱敏 DOMRect/computed style）、
  `generated/raft-official-admin.json`（Admin 默认态、成员选择与角色菜单的脱敏 DOMRect/computed style）、
  `generated/raft-official-avatar-pack.json`（从发布 bundle 直接提取的 8×8 像素头像协议）。
  `generated/raft-official-release-local.css` 是发布 CSS 的机械派生副本，只把远程 Google Fonts
  依赖改写为 manifest 已哈希的本地字体；原始 bundle 保持不变并继续接受 SHA-256 审计。
  `tokens.brutal.css` 只保留语义接口与离线 fallback，实际 Raft 数值由自动生成的
  `generated/raft-official-tokens.css` 与 `generated/raft-official-overlays.css` 覆盖；
  组件 × 状态矩阵在 `state-matrix.md`；页面级完成度、证据与已知缺口记录在
  `coverage-matrix.json`，由 `raft-ui-coverage-check.py` 阻止“未完成却标成 verified”。
- 桌面壳：`64px rail + 320px context sidebar column + fluid content + optional 520px thread`。
- 频道侧栏保持可拖拽；默认 `320px` 来自当前 live `sidebar-root` 的 DOMRect，不从截图量取。
- 频道头为 `62px`，分段页签总高 `28px`，聊天正文 `14px/20px`，带边框 composer 盒为 `96px`。
- 标准边界：2px 黑线；小/中/大硬阴影分别 2/4/6px，无模糊。
- 主状态色：yellow navigation、pink selection/action、cyan runtime、lavender mention。
- 桌面消息行、频道行、作者和头像拥有各自实测 hover；Task/File/Member/feed 卡不继承聊天 hover。
- 移动端不是缩小桌面：使用栈式 header、返回事务、全宽内容和四项 bottom navigation。
- 主阅读区、panel、code 的滚动容器在 React 移植时必须映射到 RAH 的
  `rah-scroll-main / rah-scroll-panel / rah-scroll-code` 协议。

## 验收

黄金母版位于本地 `references/masters/`（含私密内容，已 gitignore）。运行：

```bash
.venv/bin/python scripts/raft-source-audit.py
.venv/bin/python scripts/raft-ui-calibration-check.py
.venv/bin/python scripts/raft-ui-overlay-check.py
.venv/bin/python scripts/raft-ui-shell-check.py
.venv/bin/python scripts/raft-ui-search-check.py
.venv/bin/python scripts/raft-ui-notification-check.py
.venv/bin/python scripts/raft-ui-activity-check.py
.venv/bin/python scripts/raft-ui-tasks-check.py
.venv/bin/python scripts/raft-ui-members-check.py
.venv/bin/python scripts/raft-ui-computers-check.py
.venv/bin/python scripts/raft-ui-mobile-check.py
.venv/bin/python scripts/raft-ui-admin-check.py
.venv/bin/python scripts/raft-ui-protocol-check.py
.venv/bin/python scripts/raft-ui-boundary-check.py
.venv/bin/python scripts/raft-ui-control-ownership-check.py
.venv/bin/python scripts/raft-ui-a11y-check.py
.venv/bin/python scripts/raft-ui-coverage-check.py
.venv/bin/python scripts/raft-ui-diff.py
```

脚本覆盖 chat、tasks、files、agent detail、members、computers、settings、billing、admin、activity、search
及其关键移动端表面，外加四个交互状态 case（`state-hover-row` / `state-focus` / `state-scrollbar` /
`state-press-btn`，母版由 `scripts/raft-ui-state-masters.py` 连 live Chrome 用 CDP `forcePseudoState`
制造同状态后生成），并在 `test-results/diff/` 生成渲染图与阈值 mask。像素率只用于定位病灶：母版中的
真实内容、加载态和模板 mock 数据天然不同，不能把整体百分比当成唯一发布门禁。
`computer-detail-2560.png` 来自旧版 Computer 详情结构；当前 bundle 已增加运行时用量、升级和恢复区，
因此该母版只保留作历史诊断，当前 Computer 裁决以 live spec 与 `raft-ui-computers-check.py` 为准。
原生 iOS 首页截图同样只作为信息架构/状态证据，不裁决 Web CSS 像素；移动端证据分层、
现有截图清单与 Web/PWA 源码规格见 `protocol/mobile-surface-protocol.md`。

依赖安装：

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt
.venv/bin/playwright install chromium firefox
```

## 官方资源同步与比例校准

登录 Raft 后，在 Firefox 中导出的完整 DOM 与 runtime inventory 只保存在已忽略的
`references/live/`，避免把 workspace 文案或标识提交进仓库。授权发布物和脱敏后的组件规格用下面命令重建：

页面级 inventory 使用 Firefox DevTools Console 执行
`scripts/raft-live-route-inventory.js`；脚本不读取或导出消息、成员、workspace 名称和表单值，只记录
class、ARIA、DOMRect 与计算样式。下载文件移动到 `references/live/` 后再执行同步命令。

```bash
.venv/bin/python scripts/raft-official-sync.py \
  --dom references/live/raft-live-dom.html \
  --inventory references/live/raft-live-inventory.json \
  --settings-inventory references/live/raft-live-channel-settings.json \
  --members-inventory references/live/raft-live-members-modal.json \
  --add-members-inventory references/live/raft-live-add-members-modal.json \
  --activity-inventory references/live/raft-activity-live-inventory.json \
  --tasks-inventory references/live/raft-tasks-live-inventory.json \
  --tasks-channel-menu-inventory references/live/raft-tasks-channel-menu-live-inventory.json \
  --tasks-creator-menu-inventory references/live/raft-tasks-creator-menu-live-inventory.json \
  --members-page-inventory references/live/raft-members-page-live-inventory.json \
  --members-edit-name-inventory references/live/raft-members-edit-name-live-inventory.json \
  --computers-inventory references/live/raft-computers-live-inventory.json \
  --route-dom-assets references/live/raft-administration-live-dom.html \
  --admin-inventory references/live/raft-administration-live-inventory.json \
  --admin-member-menu-inventory references/live/raft-administration-member-menu-live-inventory.json \
  --admin-role-menu-inventory references/live/raft-administration-role-menu-live-inventory.json
```

它会：

1. 从 `app.raft.build` 当前入口解析并下载实际 CSS/JS bundle，下载 bundle 引用的字体；同时生成只改写远程字体 URL 的离线 CSS 派生物，原 bundle 不修改；`--route-dom-assets` 还会同步 live DOM 暴露的 Admin 动态模块（例如 `SettingsPanel-*.js`）；
2. 为每个发布物记录 URL、字节数和 SHA-256；
3. 从 Firefox `getComputedStyle()`、`getBoundingClientRect()`、官方 class 与 live SVG 生成脱敏组件规格、图标集和语义令牌桥；focused overlay 抓取只保留组件元数据，不保留表单值或 workspace 文案；
4. 用 build SHA 将这三层绑定。`scripts/raft-source-audit.py` 会阻止文件被手改后继续冒充官方值。

头像协议另由下面命令从同一个已授权 bundle 重建；它会提取 18 个预设、调色板、确定性随机生成参数和
10 种上下文尺寸，不从截图描摹头像：

```bash
python3 scripts/raft-extract-avatars.py
```

截图只能发现和回归定位差异，不进入规格生成过程。只有无法从当前官方页面或 bundle 得到的状态，
才允许在矩阵中明确标成“未提取”；不得用截图估值填空后宣称 1:1。

桌面数值以浏览器报告的 CSS px 为准：采样视口 `2560×771`、`devicePixelRatio=2`、Raft 页面缩放 `100%`。
Retina 截图像素不能再次乘除 DPR。此次校准只改动经 DOM 实测有偏差的轴，rail 和 40px 导航按钮没有做整体缩放。
布局当前值由 `generated/raft-official-tokens.css` 生成；差异脚本也直接读取组件规格，禁止维护第二套手写常量。

### Live Web 取值纪律

视觉值以已授权账号中官方 Web 页的运行时 DOM、Firefox `getComputedStyle()` 和当前发布 CSS bundle 为准，
截图只负责发现差异，不能反向估算已经可以直接读取的参数。2026-08-25 当前 bundle 为
`https://app.raft.build/assets/index-EQxYM8hQ.css`；hash 更新后必须重新读取页面的 resource entries，
不得继续把旧 hash 当作官方现状。

当前聊天基线包括：logo `40×40`、`2px` 黑边与 `2px` 硬阴影；tab `76×28`、
`14px` 图标、`6px` gap、`6px 16px` padding；回复块 `black/3%`、hover `black/8%`、
`8px 10px` padding；composer `96px`、默认 `2px` 阴影、focus-within `4px` 阴影。
官方内容、头像 URL、登录态通知 banner 与实时消息属于数据/状态，不得通过全局 scale 掩盖。

### 当前覆盖边界

当前 source audit 覆盖发布 bundle、Admin 路由动态模块与字体哈希，以及聊天页壳层、rail、sidebar、频道头、tabs、消息、
回复预览、composer 的 29 个代表组件、当前 live 页面出现的 28 个 SVG 图标，以及成员、添加成员、
频道设置三种 focused overlay、Activity、Tasks、Agent 资料页、资料内联编辑态、Computer 详情页和 Admin 默认/成员菜单/角色菜单。`scripts/raft-ui-overlay-check.py` 会在浏览器中逐项核验其
DOMRect，并验收 hover/press、初始焦点、焦点循环、Esc/遮罩关闭、取消还原与回焦。
频道操作的点击分支则直接来自已校验 SHA-256 的官方 bundle：退出/公开/归档/删除打开同一套二级
ConfirmDialog（背景点击不关闭，Esc/X/取消关闭，执行中锁定）；置顶立即切换为“取消置顶”。模板只模拟
确认后的本地投影，不调用 Raft API。NotificationCenter 的 `320×288` popup、空状态文案、rail/header
触发、Esc 回焦及外部点击关闭来自当前 bundle 的 `Ko + YYe` 组件协议。Agent 资料页的成员选择、标签键盘协议、内联编辑保存/取消、
生命周期事务和侧栏拖拽由 `raft-ui-members-check.py` 在 Chromium/Firefox 双引擎核验；Computer 的运行时、Agent 列表、命令复制、
恢复指南和侧栏拖拽由 `raft-ui-computers-check.py` 核验；Admin 的源码几何、hover/press/focus、listbox 键盘与关闭、dirty/disabled、展开重排、校验、pending/failed/succeeded 由 `raft-ui-admin-check.py` 在固定桌面与 390×844 视口核验。跨页面的 v1 envelope、严格动作登记、identity、pending、成功、失败、取消、
请求替代/AbortSignal、控件独占、回滚、post-unlock commit、无效 adapter result、重复终结保护、
Chat 确认式发送、敏感字段隔离、分段按钮键盘/ARIA 和旧事件兼容由
`raft-ui-protocol-check.py` 在两种浏览器核验。模板不会执行真实停止、重启、升级、付款或删除。
未出现在本次 live DOM 中的其他菜单、Agent 非资料 tab、加载/流式、
拖拽状态、其他页面模块和大部分移动端状态仍需逐项采集；Admin 的真实服务端成功/权限拒绝结果仍由 fixture adapter 代替。全站 11 个桌面入口的 rail/head 结构已由
`raft-ui-shell-check.py` 锁定为同一份 64px/62px 框架协议；这只证明全局框线不再漂移，不等于各模块
内容区已经完成像素级复刻。
在这些条目完成以前，本仓库不作“所有元素与所有交互已经 1:1”的声明。

## 移植纪律

1. 先建立 Room ledger owner，再移植 shell；不要让 React page 自己发明 Room/Task/Run 状态。
2. 先抽取 semantic tokens 和无状态 primitives，再替换 navigation/composer；禁止把整页 HTML 塞进 `App.tsx`。
3. 当前 Session/Conversation 页面继续作为 Legacy Run Inspector，直到 Room bridge、Artifact 与 Review 门禁满足删除条件。
4. 桌面与 PWA 复用同一组件和事件；响应式 CSS只改变布局，不创建第二条行为路径。
5. 真实迁移必须通过 RAH 的 typecheck/web/runtime/build/browser/release/hygiene gates。
6. 参考 HTML 永远只加载 reference adapter；RAH binding、FakeRahClient、HTTP/IPC 与认证代码只能位于 integration/product composition，反向依赖由 `raft-ui-boundary-check.py` 阻止。
