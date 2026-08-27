# state-matrix.md — 组件 × 交互状态矩阵

> **覆盖度声明（以实测为准，未实测的不冒充已验收）**
> 实测覆盖：hover / active / focus-visible × rail 钮 / 私信行 / 消息行 / 头部方钮 /
> tab / 发送钮 / 迷你钮 / 频道行 共 8 族 + 滚动条；成员/添加成员/频道设置的
> focused overlay 另由 `scripts/raft-ui-overlay-check.py` 按 live DOMRect 与真实点击验收；其余组件族为按协议推广，
> 加载 / 拖拽 / selected-私信行 未实测。
> Admin 是单独的完整状态样本：默认、hover、active、focus-visible、selected、disabled、展开、校验失败、
> pending、failed、succeeded 与 closed 由当前 `SettingsPanel-*.js`、三份 live capture 和
> `scripts/raft-ui-admin-check.py` 双引擎验收，不受上一句“其余组件族”的限制。
> 像素级验收仅覆盖 4 个状态 case（`scripts/raft-ui-diff.py` 的
> `state-hover-row` / `state-focus` / `state-press-btn` / `state-scrollbar`，
> 增量对比协议：各端「state − baseline」掩码在组件 bbox 内的 XOR 不一致率 ≤5%）；
> 矩阵中其余行是协议文字与目检结论，不构成像素验收。

数据来源：2026-08 对 live Raft 用 CDP `CSS.forcePseudoState`（hover / active / focus-visible）
与真实滚动实测，外加本模板 `styles.css` 现状。母版生成：`scripts/raft-ui-state-masters.py`
（每 case 产出 baseline / state / bbox sidecar 三件套）；验收：`scripts/raft-ui-diff.py`
的 `state-*` case。「实测」= 直接测自 live；其余为模板实现现状。

## 通用协议（先读这三条）

- **交互事务**：九个桌面路由族（Chat、Search、Activity、Tasks、成员/Agent、Computer、Settings、Billing、Admin）的产品动作统一进入
  `raft:ui-intent` v1，再由同一 identity 的 `raft:ui-state` 依次投影
  `pending → succeeded | failed | cancelled`；失败/取消回滚乐观状态，重复终结被拒绝，搜索旧请求按 key 替代，
  Chat 发送在确认前保留草稿，密码只进入 adapter sensitive context。
  参考页面只加载显式、无网络的 reference adapter；transport-neutral runtime 没有 fixture fallback，
  RAH adapter 只能由独立 product composition 注入，且在 reference surface 上会被拒绝。
  这是本地 UI/daemon 的行为协议，不冒充 Raft 官方 loading/error 视觉样本；后者在下表仍按实测覆盖度标记。

- **focus-visible**：所有可交互元素（rail 钮、行、方钮、发送钮……）键盘聚焦 =
  `outline: 2px solid var(--ink)`、`outline-offset: 0`（实测 #000 无偏移）。
  全局规则：`styles.css` 的 `:is(button,a,input,textarea,select,[role=tab]):focus-visible`。
  **唯一例外：tab 实测无 outline**（`.tab:focus-visible { outline: none }` 归零）。
- **press 笔法**：Raft 实测两类并存——阴影收缩 1px 不位移 / 收缩 + 位移
  （live 头部搜索钮实测 `translate(1px,1px)` + 阴影 2→1px）。模板统一取
  `translate(1px,1px)` + `--shadow-press`（1px 阴影）作为所有按钮的 press 笔法。
- **滚动条**：标准属性优先 `scrollbar-width: thin; scrollbar-color: var(--scrollbar-thumb) transparent`，
  作用于滚动容器（非 `*`）；live 实测布局宽 11px，本模板 headed Chromium 实测同为 11px。
  webkit 伪元素 10px（radius 5px、min-height 32px）仅旧浏览器兜底；
  同元素两种机制并存时 Chrome 取标准路径，不会双渲染。

## 矩阵

| 组件族 | default | hover | active(press) | focus-visible | selected | disabled | 加载 | 拖拽 |
|---|---|---|---|---|---|---|---|---|
| rail 钮 `.rail-btn` | 透明底 + 2px 透明框，黄带黑图标 40px | 白底+黑框，无阴影（实测） | 无变化（未单独实测） | 2px 黑 outline（实测协议） | `.is-active` 白底+黑框+`--shadow-s` | 未实测（模板无禁用 rail 钮） | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 频道行 `.channel-row`（聊天侧栏） | 透明底 + 2px 透明框，14px/500 | 未选中 = 白底+黑框+`--shadow-s`；选中行无变化（实测） | 选中行无变化（实测） | 仅 2px outline，无其他变化（实测） | 粉底 `--pink`+黑框+`--shadow-s`（实测） | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 私信行 `.dm-row` | 透明底（`.dm-list` L 形开口线框） | 白底+黑框+`--shadow-s`（实测） | 同 hover 白卡（live 实测 `active:border-black bg-white shadow-brutal-sm`） | 2px outline（协议） | 未实测（模板无选中私信样例） | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 消息行 `.msg` | 透明底 + 2px 透明框 | 白底+黑框（无阴影）+ 右上浮出工具条（实测） | 无变化 | 不可聚焦（article 无 tabindex） | — | — | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 消息作者名 `.msg-head b` | 14px/700 | 2px 下划线（实测） | 无变化 | 不可聚焦 | — | — | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 消息头像 `.msg .avatar` | 40px 像素 svg | `filter: brightness(.9)`（实测） | 无变化 | 不可聚焦 | — | — | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 方形钮 `.sq-btn`（btn-brutal-sm 系，28px） | 白底+黑框+`--shadow-s` | 阴影 2→4px，不位移（实测） | 阴影收缩 1px + `translate(1px,1px)`（实测 live 搜索钮 x/y +1 且 2→1px） | 2px outline（协议） | `.view-toggle .is-active` 黄底 | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 块状钮 `.btn`（btn-brutal 系） | 白底+黑框+`--shadow-s`，13px/700 | 阴影 2→4px，不位移（实测） | `translate(1px,1px)`+`--shadow-press` | 2px outline（协议） | —（静态变体色 `.btn-pink` 等） | 灰底 `--gray-chip`+`--muted` 字+无阴影+not-allowed（computers.css） | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 发送钮 `.send-btn` | 粉底+黑框+`--shadow-s` | 阴影 2→4px | `translate(1px,1px)`+`--shadow-press` | 2px outline（协议） | — | `opacity:.3`+pointer-events:none（实测：空输入=30% 透明粉底） | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| tab `.tab` | 白底、按钮自身无框；相邻项用 2px `::before` 分隔，组末单独 2px 右边 | 未激活 = `--tab-hover` 近白暖灰（实测） | 无变化（未单独实测） | **无 outline（实测 none；协议注明例外）** | `.is-active` `--tab-active` 黄底、无阴影 | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| chip `.chip` / `.filter-chip` / `.mention-chip` | 功能底色+黑框（mention-chip 带 `--shadow-s`） | filter-chip = `--hover-yellow` 浅黄底；feed 内 chip `cursor:default` 无变化 | 未实测 | button chip 适用 2px outline 协议 | — | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 下拉行 `.dropdown-row` | 透明底 13.5px | `--hover-yellow` 浅黄底（实测） | 无变化（未单独实测） | 2px outline（协议） | `.is-selected` 右侧 ✓ 显现（无底色变化） | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 工具条钮 `.msg-action-btn`（24px） | 透明底 + `--ink-50` 图标 | `--soft-signal` 黄 30% 底（实测） | 无变化（未单独实测） | 2px outline（协议） | 未实测 | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 迷你钮 `.side-actions button`（btn-flat-sm 系） | color `--ink-70`（实测 black/70） | bg `--ink-05` + color 黑（实测 black/5） | bg `--ink-10`（实测 black/10） | bg `--ink-05`（实测）+ 2px outline（协议） | 未实测 | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| feed 卡 `.feed-card` | 白底 + 1px black/30 细边 + 无阴影（实测） | 无变化（实测：无 hover 态） | 无变化 | 不可聚焦 | 已读 = `.is-read` `opacity:.4`+`grayscale(.7)` | — | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 任务卡 `.kcard` | 白底+黑框+`--shadow-s` | 无变化（实测） | 无变化（未单独实测） | 未实测 | 未实测 | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 文件行 `.file-row` | 白底+黑框+`--shadow-s` | 无变化（实测） | 无变化（未单独实测） | 未实测 | 未实测 | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 成员行 `.member-row` | 透明底行，Agent 行 52px / Human 行 48px（focused live） | 成员模态内 = `soft-signal/30`（实测官方 class + 浏览器验收）；成员页列表实测无 hover | 无变化（未单独实测） | 头像按钮适用 2px outline 协议 | 未实测 | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 添加成员候选 `.add-member-row` | 36px、20px avatar、透明底（focused live） | `soft-signal` 实色黄底（实测官方 class + 浏览器验收） | 无变化（未单独实测） | 2px outline | — | — | 搜索无结果本地模板有空态 | — |
| 频道设置操作 `.drawer-action` | 40px、2px 边与 2px 硬阴影；橙/绿/红按官方顺序 | 阴影 2→4px（浏览器验收） | `translate(1px,1px)` + 1px 阴影（浏览器验收） | 2px outline；打开抽屉先聚焦名称输入框 | 置顶立即切换为“取消置顶”；其余危险操作进入官方 ConfirmDialog | 执行中确认/X/取消禁用（官方 bundle 协议） | ConfirmDialog 的 loading label 来自官方 bundle；本地模板不调用 API | — |
| 二级确认层 `.action-confirm-*` | `Gi + Fl + Ln`：black/60 遮罩、384px 白卡、24px padding、2px 边、4px 硬阴影；warning=orange/20、delete=red/20 | brutal button 阴影 2→4px | `translate(1px,1px)` + 1px 阴影 | 打开先聚焦遮罩根；Tab 进入并循环；Esc/X/取消关闭回焦 | 打开在设置抽屉之上；背景点击不关闭 | 执行中三个按钮锁定并显示官方 loading label | 本地 360ms 模拟完成后只更新本地投影 | — |
| 设置导航行 `.sec-sidebar .channel-row` | 同频道行 | 无变化（实测；hover 卡规则限定聊天 `.sidebar`） | 无变化 | 2px outline（协议） | `.is-selected` 粉底+黑框+`--shadow-s` | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| 输入框 `.input` / `.input-wrap` / `.select` / composer `textarea` | 白底+黑框；composer 默认 `--shadow-s` | 无变化 | 无变化 | `.input:focus`/`focus-within`=`--shadow-s`；`.select:focus`=`--shadow-m`；composer textarea `outline:none`，外盒 focus-within 从 `--shadow-s` 增至 `--shadow-m` | — | 未实测 | 未实测（Raft 未提供样本） | 未实测（Raft 未提供样本） |
| Admin `.raft-select` | 官方 member picker 为 40px、role/onboarding 为 32px；2px 边与 2px 硬阴影 | member picker 仅 `soft-signal/30` 底；role/onboarding 上移 1px 并增至 4px 阴影（官方 route module） | brutal select 保持上移与 4px 阴影；主操作钮 `translate(1px,1px)` + 1px 阴影（双引擎验收） | 2px 黑 outline；搜索式 picker 打开后聚焦搜索框 | option `aria-selected=true` 且 ✓；选择成员后才解锁 role/update | role/update 初始禁用并 40%/50% 透明 | 菜单打开、外部关闭、Esc 回焦与 pending 控件锁均已验收 | — |
| Admin dirty form / 协议展开 | 当前值与 baseline 相等时保存禁用；协议字段 hidden | 标签与按钮沿用各自协议 | 保存按钮沿用 brutal press | checkbox 通过可视 marker 接收 2px outline | agreement 开启后标题 160、Markdown 5000、计数和预览进入正常流 | 未改值、加载中、提交中均禁用 | `保存中…/✓ 已保存/inline warning`；fake adapter 覆盖成功与失败；invite 覆盖本地校验 | — |

## 备注

- headless 渲染差异：headless Chromium 下 `scrollbar-width: thin` 渲染为覆盖式（布局宽 0），
  headed 才是经典 11px；playwright 的 **headless Firefox 会把 computed
  `scrollbar-width` 强制成 `none`**（不止不渲染，是引擎直接改计算值；headed 下
  computed 才是 `thin`）。滚动条验收见 `scripts/raft-ui-firefox-check.py`
  （headed 跑 computed 断言 + 留截图目检）。
- 状态 case 的验收不再是整页比整页（旧法整体 ~18% 全是 mock vs live 内容噪声，
  无验收能力）：改为增量对比——母版端与模板端各自先截 baseline 再制造状态，
  两掩码在目标组件 bbox（含 pad 外扩，outline/阴影画在盒外）内算 XOR 不一致率，
  阈值 5%，超过即 FAIL 并非零退出。组件 bbox 由 `raft-ui-state-masters.py`
  写入 `references/masters/state-<name>.json`。
- 移动端特有组件（`.m-tabbar` 胶囊、`.m-row` 等）的实测来源是 iOS / 移动 web 截图，
  交互态粒度与桌面不同，不在本矩阵范围内（见 `tokens.md` 交互笔法）。
