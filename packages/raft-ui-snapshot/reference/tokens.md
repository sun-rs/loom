# tokens.md — brutal 主题令牌契约

本文件是「新粗野 Slack 工作台」UI 体系（方案 P1 阶段）的令牌契约。
语义接口在 [`tokens.brutal.css`](tokens.brutal.css)，当前 Raft 的实际数值由
[`generated/raft-official-tokens.css`](generated/raft-official-tokens.css) 自动生成并覆盖。
生成来源是发布 CSS 变量与 Firefox computed style/DOMRect，不是截图。

## 三条禁令

1. **组件禁止硬编码**任何色值、尺寸、阴影、字体——只允许消费语义层变量。
2. **页面 CSS 只写布局栅格**，禁止覆盖组件样式；写不进现有组件时，先新增组件再进页面。
3. **刻度层（`--brutal-*-50…950`）不参与组件消费**，它只是语义层的取值来源与将来派生新令牌的调色板。

## 分层结构

```
刻度层  --brutal-yellow-50…950 / --brutal-pink-* / --brutal-cyan-* / --brutal-cream-* / --brutal-black
   │（取值）
语义层  --yellow --pink --cyan --lavender --orange --coral --green --mint
        --cream --paper --bg --ink --muted --preview-bg/hover-bg --preview-count/sender/text/time
        --placeholder --scrim --gray-chip --hover-yellow --soft-signal
        --bd --bd-heavy --shadow-s/m/l --sans --mono
        --rail-w --sidebar-w --thread-w --head-h
   │（唯一允许消费）
组件层  .rail .sidebar .msg .msg-actions .composer .btn .chip .modal .drawer .kanban
        .notice-banner .mention-menu .dropdown-panel .role .chip-loading .env-mask
        .required-star .presence(.off) .m-header .m-back .m-tabbar .m-tab
        .m-fab-bottom .ws-chip …（styles.css）
```

下拉面板（`.dropdown-panel`）实测实例：侧栏排序菜单（手动 / 最近 / A-Z，宽 136px）、通知中心面板（320×288，含空态文案）。

## 语义变量速查

### 主色与功能色
| 变量 | 值 | 用途 |
|---|---|---|
| `--yellow` | `#FFD440` | 导航栏、激活 tab、频道徽标、抽屉头 |
| `--pink` | `#FE7DA8` | 选中态、主按钮、发送键、角色徽章 |
| `--cyan` | `#27CCF3` | 进行中、运行时 chip |
| `--lavender` | `#BBAFE6` | 提及 chip、待确认、附件图标 |
| `--orange` | `#F8A16F` | 待办、警告级操作（退出/归档/报告）（bundle 实测 hex） |
| `--coral` | `#F97264` | 危险操作（删除）（bundle 实测 hex） |
| `--green` | `#A9D877` | 完成、置顶、在线（bundle `--color-brutal-lime`） |
| `--mint` | `#A9D877` | 在线状态点（live `bg-brutal-lime`） |
| `--presence-off` | `#A0A09A` | 离线状态点（iOS 截图估读，非 bundle 实测） |
| `--gray-chip` | `#E8E6E0` | 已关闭、未安装、加载态 chip |
| `--hover-yellow` | `#FFF3C4` | 下拉行 hover |
| `--soft-signal` | `rgba(255,212,64,.3)` | 悬浮工具条按钮 hover 底（实测 `hover:bg-soft-signal/30`） |
| `--m-tabbar` | `#EFEFEA` | 移动端胶囊底栏底色（iOS 截图估读） |
| `--m-tab-active` | `#E3E3DC` | 移动端胶囊 tab 激活底（iOS 截图估读） |

### 底色与文字
| 变量 | 值 | 用途 |
|---|---|---|
| `--cream` | `#FFFAEF` | 侧栏 / 二级侧栏底色 |
| `--paper` | `#FFFFFF` | 顶栏、标签栏、输入区底色（live `layer-panel`） |
| `--bg` | `#FFFFFF` | 内容流底色 |
| `--black` | `oklch(0% 0 0)` | 结构描边（bundle `--color-black`） |
| `--ink` | `#141111` | 正文与硬阴影墨（bundle `--color-brutal-black`） |
| `--ink-40` | `rgba(0,0,0,.4)` | 时间戳、角色、副标题等 meta 文字（live `text-black/40`） |
| `--ink-50` | `rgba(0,0,0,.5)` | 次级 meta（live `text-black/50`） |
| `--ink-55` | `rgba(0,0,0,.55)` | `text-black/55` |
| `--ink-08` | `rgba(0,0,0,.08)` | `black/8` 结构底色 |
| `--ink-05` | `rgba(0,0,0,.05)` | 迷你钮 hover/focus-visible 底（live `black/5`） |
| `--ink-10` | `rgba(0,0,0,.1)` | 迷你钮 active 底（live `black/10`） |
| `--ink-70` | `rgba(0,0,0,.7)` | 迷你钮基色、分组标题 hover（live `black/70`） |
| `--scrollbar-thumb` | `rgba(0,0,0,.24)` | 滚动条滑块（实测 `.scrollbar-quiet`，纯黑 alpha 非 --ink 基） |
| `--scrollbar-thumb-hover` | `rgba(0,0,0,.36)` | 容器 hover 滑块（webkit 兜底路径） |
| `--scrollbar-thumb-active` | `rgba(0,0,0,.52)` | 滑块 hover（webkit 兜底路径） |
| `--tab-active` | `--brutal-yellow-400` | 激活 tab 底（实测刻度值） |
| `--tab-hover` | `oklch(95.08% .00036 1.5)` | 未激活 tab hover（实测近白暖灰） |
| `--term-ink` | `#F5F2E9` | 终端块文字（实测米色） |
| `--preview-text` | `rgba(0,0,0,.60)` | 线程预览正文（live `text-black/60`） |
| `--muted` | `#555552` | 次要文字（副标题、时间戳、角色） |
| `--preview-bg` | `rgba(0,0,0,.03)` | 线程预览块（live `bg-black/[0.03]`） |
| `--preview-hover-bg` | `rgba(0,0,0,.08)` | 线程预览 hover（live `hover:bg-black/[0.08]`） |
| `--preview-count/sender/time` | `black/55`, `black/70`, `black/40` | 回复数、作者、时间 |
| `--placeholder` | `rgba(20,17,17,.50)` | textarea 当前墨色的 50% 透明值 |
| `--scrim` | `rgba(20,17,17,.3)` | 模态遮罩 |

### 描边 / 阴影 / 字体 / 布局
| 变量 | 值 | 用途 |
|---|---|---|
| `--bd` | `2px solid var(--black)` | 标准描边（官方边框纯黑，与 `--ink` 阴影墨分离） |
| `--bd-heavy` | 同上 | 全宽分隔线（实测同为 2px，语义上区分） |
| `--shadow-xs` | `1px 1px 0` | 微型件 |
| `--shadow-s` | `2px 2px 0` | 小按钮、chip、小徽标 |
| `--shadow-m` | `4px 4px 0` | 卡片、选中态、输入框、下拉面板 |
| `--shadow-l` | `6px 6px 0` | 模态、抽屉 |
| `--shadow-press` | `1px 1px 0` | 按压态 |
| `--shadow-soft` | `0 4px 16px rgba(20,17,17,.10)` | 移动端软化件柔和投影（iOS 实测，「无模糊」规则的唯一例外） |
| `--shadow-side` | `-6px 0 0 rgba(20,17,17,.12)` | 线程浮层 / 抽屉左缘侧影（实测 12% 墨） |
| `--shadow-logo` | `2px 2px 0 var(--ink)` | rail logo（live `shadow-brutal-sm`） |
| `--sans` | Raft Quote Glyphs + Space Grotesk + system-ui | 标题与正文 |
| `--mono` | Space Mono 栈 | 时间戳、副标题、角色、编号、代码 |
| `--rail-w` | `64px` | 图标导航栏宽 |
| `--sidebar-w` | `320px` | 当前 live `sidebar-root` DOMRect（可拖拽） |
| `--thread-w` | `520px` | 消息列宽 |
| `--head-h` | `62px` | 各列头部高度（头线对齐基准） |
| `--tabs-h` | `28px` | 聊天/任务/文件分段带总高度 |
| `--message-line` | `20px` | 14px 聊天正文行高 |
| `--composer-box-h` | `96px` | 带边框 composer 盒高度 |

*Raft 来源：当前官方 `index-EQxYM8hQ.css` 与 Firefox computed style。阴影 1/2/4/6px → `--theme-shadow-xs/sm/md` + `--shadow-brutal-lg`；rail 项 40px → `size-10`；方钮 28px → `size-7`；composer 默认阴影 2px、focus-within 4px；消息悬浮工具条 28px / 内钮 24px。*

布局度量当前在壳层样式（`styles.css` 栅格）中实现；React 移植（P2）时统一改由这组变量驱动。

### 字号与字重
| 变量 | 值 | 用途 |
|---|---|---|
| `--text-xs` | `12px` | 刻度：meta/分组标题 |
| `--text-sm` | `14px` | 刻度：正文 |
| `--text-base` | `16px` | 刻度：频道标题、移动端输入框 |
| `--text-lg` | `18px` | 刻度：侧栏大标题 |
| `--text-xl` | `20px` | 刻度：页面标题 |
| `--text-2xl` | `24px` | 刻度：特大标题 |
| `--fs-sidebar-head` | 18px / 700 | 侧栏大标题 |
| `--fs-channel-title` | 16px / 700 | 频道标题 |
| `--fs-body` | 14px | 正文、输入区 |
| `--fs-section` | 12px / 700 / 字距 0.1em | 分组标题 |
| `--fs-meta` | 12px | 时间戳、角色、副标题 |
| `--fs-micro` | 10px | 微型标签 |
| `--fw-medium` | 500 | 频道行 |
| `--fw-semibold` | 600 | 消息作者 |
| `--fw-bold` | 700 | 标题与按钮（实测 Raft 最高字重） |
| `--tracking-widest` | `0.1em` | 分组标题/微型标签 |

*Raft 来源：刻度 ↔ `text-xs/sm/base/lg/xl/2xl`；正文 14px → `text-sm`；分组标题 → `text-xs bold tracking-widest`。*

## 交互笔法（组件共同遵守）

- 零圆角（唯二例外：`--mint` 在线点 / `.presence` 状态点、移动端 `.m-tabbar` 胶囊底栏与 `.m-tab`，后者为 iOS 实测形态）。
- 移动端分层原则（实测 iOS）：操作件（按钮 / 任务卡 / 模态）保留黑边硬阴影；结构件（列表行、feed 卡、文件行、底栏）软化——`--ink-08` 细灰线或无框、无硬阴影。
- 移动端底栏 = 悬浮浅灰胶囊 `.m-tabbar`（左右各距屏 16px、`border-radius:999px`，底色 `--m-tabbar`，激活 tab 底 `--m-tab-active`）。**软化件：无黑边、柔和投影 `--shadow-soft`（实测 iOS）**。
- 移动端页面导航 = 整块黄色 `.m-header`（图标块 + 标题 + mono 副标题，副标题色 `--ink-55`，**下缘无描边**——实测 iOS 黄头无黑线）+ `.m-back` 返回箭头栈式导航；底部主操作用 `.m-fab-bottom` 悬浮于胶囊栏上方；进入栈式页后胶囊底栏隐藏。
- 移动端列表选中态 = 粉底 + `--bd`、**无阴影**（弱化版；iOS 首页实无选中态）。
- 角色徽章三色（实测自成员管理界面）：管理员 = `--pink`、成员 = `--lavender`、所有者 = `--bg` 中性白底。
- 状态点双色：在线 = `--mint` 绿点；离线 = `.presence.off`（`--presence-off`，截图估读灰）。
- 按钮 hover：阴影 2→4 增长（`--shadow-s` → `--shadow-m`）、不位移（实测 `.btn-brutal` 系）。
- 按钮 press：`translate(1px,1px)` + `--shadow-press`（1px 1px 0），`transition: all .1s`（实测 `.btn-brutal` / `active:translate-px` / `active:shadow-brutal-active`；Raft 另存在「阴影收缩 1px 不位移」类，模板统一取带位移笔法）。
- focus-visible 协议：可交互元素键盘聚焦 = `outline: 2px solid var(--black)`、无 offset（实测 #000）；**唯一例外 tab 无 outline（实测 none）**。
- 消息行 hover：2px 黑框 + 白底（实测 `hover:border-black hover:bg-white`）+ 右上悬浮工具条（在消息列中回复 / 添加回应 / 收藏消息）。
- tab 激活底 = `--tab-active`（yellow-400）；inactive hover = `--tab-hover`（近白暖灰）。
- @ 提及菜单选中行 = 黄底（`--yellow`，不是浅黄）。
- 频道选中态 = 粉底 + `--bd` + `--shadow-s`（实测选中阴影 2px）；选中频道行 hover/active/focus 无视觉变化（仅 focus outline，实测），未选中行才有 hover 白卡。
- 滚动条 = 标准属性优先：`scrollbar-width: thin` + `scrollbar-color: var(--scrollbar-thumb) transparent`，作用于滚动容器（实测 live 布局宽 11px，本模板 headed Chromium 同为 11px；headless Chromium 为覆盖式宽 0，headless Firefox 强制 `scrollbar-width:none`）；webkit 伪元素 10px + 2px 透明边内缩（`background-clip: padding-box`）+ radius 5px + min-height 32px 仅旧浏览器兜底（radius 5px 为圆角例外之一）。
- 完整的「组件 × 状态」对照（含 active/focus-visible/selected/disabled）见 `state-matrix.md`。

### 行级 hover 矩阵（live 实测 computed style）

> 本表只管 hover；完整的「组件 × 状态」（default/hover/active/focus-visible/selected/disabled/加载/拖拽）
> 矩阵在 `state-matrix.md`（2026-08 CDP `forcePseudoState` 实测）。

| 元素 | hover 效果 |
|---|---|
| rail 按钮 | 白底 + `--bd` 黑框（无阴影） |
| 分组标题 | 文字降淡 black/70（`--ink-70`） |
| 侧栏频道行/私信行（未选中） | 白底 + `--bd` + `--shadow-s`（选中行 hover 无变化） |
| 消息作者名 | underline 2px |
| 消息头像 | `filter: brightness(.9)` |
| 消息行 | 2px 黑框 + 白底 + 右上悬浮工具条 |
| 下拉行 | `--hover-yellow` 浅黄底 |
| 工具条按钮 | `--soft-signal` 黄 30% 底 |
| 任务卡 / 文件行 / 成员页行 / 设置导航行 / feed 卡 | **无 hover 变化** |
| feed 卡基线 | 1px black/30 细边、无阴影 |
- 阴影永远无模糊、纯偏移、不透明 `--ink`（唯一例外：移动端软化件的 `--shadow-soft`，见上）。

## 数值来源与授权边界

本项目已获授权使用 Raft 的公开 UI 资源。发布 CSS/JS、字体、SVG 的 URL、字节数和 SHA-256
记录在 `vendor/raft/manifest.json`；脱敏后的 class、DOMRect、computed style 与 SVG 记录在
`generated/raft-official-components.json`。截图仅用于视觉回归，不能作为数值来源。
Raft 改版后应重新运行 `scripts/raft-official-sync.py`，而不是人工改令牌追图。

## 新增皮肤的方法

1. 复制 `tokens.brutal.css` 为 `tokens.<name>.css`，改语义层取值（保持变量名不变）。
2. 页面引入处切换文件名（或在未来的 React 壳里用 `data-theme` 切换变量组）。
3. 组件零改动即完成换肤——这是本契约存在的意义。
