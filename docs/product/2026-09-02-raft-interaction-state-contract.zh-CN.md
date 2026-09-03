# Raft 前端操作状态合同

冻结日期：2026-09-02。适用对象：RAH OS Web/PWA 的桌面与窄屏共用组件。

## 1. 证据与边界

Raft 当前生产入口（release/v1.11.0，commit
`16856201b6d089c251967fe2afdb2b0a0dcbb1a0`）加载 `index-Biin3FEA.js`；入口
SHA-256 为 `e798f35bde09eeda2927669406e10718392ff7574796016441def59dbc5b05f9`。
`docs/evidence/raft-web-20260831-current/` 继续作为旧发布冻结样本，不再冒充当前生产入口。
本轮对强上浮 brutal 族的七处直接字面调用、CSS 计算规则和本地取舍另存于
`docs/evidence/raft-brutal-lift-inventory-20260903.json`。
机器索引覆盖 23 个已归档发布文件、1,836 个**原始回调位置候选**（其中
`onClick` 892；另有 pointer、drag、键盘及 focus/blur 事件族），仍有 13 个引用 JS
未归档。候选包含同一共享组件的重复实例、库内部回调、权限分支和内容渲染器；它既不是
1,836 个产品功能，也不是 1,836 个未完成缺口。

因此本合同有两个不同的“全面”口径：

1. 对当前七个核心路由里实际可见的操作位置，按控件族覆盖 default、hover、
   active、focus-visible、selected、disabled、open/close 和 drag；相同组件实例
   不重复抄写页面 CSS。
2. 1,836 个候选不是 1,836 个功能。未加载模块、权限分支、emoji/Markdown 等
   缺失 chunk 仍须逐条追踪；本合同不能被解释为“Raft 全站所有业务逻辑已完成”。

行为请求与返回的 74 项旧 intent 继续由
[行为指南](./raft-behavior-inventory.zh-CN.md)登记；本文件只拥有输入设备导致的
视觉和操作状态，不另造 Room、Task、Agent、通知或文件业务 owner。

## 2. 单一状态语法

| 控件族                     | default                                                | hover                                         | press / active                     | focus-visible                                    | selected / disabled                            | RAH owner                                                  |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------- | ---------------------------------- | ------------------------------------------------ | ---------------------------------------------- | ---------------------------------------------------------- |
| 主 rail                    | 40×40、透明 2px 边                                     | 白底、黑 2px 边，150ms cubic                  | 不额外位移                         | 全局 2px 黑 outline                              | 当前页白底黑边+2px 硬阴影                      | `.rail-btn` + interaction protocol                         |
| 导航/频道/成员/Computer 行 | 透明 2px 边                                            | 白底黑边+2px 硬阴影，150ms cubic              | 同 hover                           | 2px 黑 outline                                   | 粉底黑边+2px 阴影；选中态无过渡                | `.rah-interaction-row`                                     |
| 分组标题                   | 12px uppercase，`cursor:default`                       | 仅文字变 black/70，150ms cubic                | 无额外视觉                         | 全局 outline                                     | 展开仅转动箭头                                 | `.rah-sidebar-disclosure`                                  |
| 平面小按钮                 | 透明、black/70                                         | black/5 底+黑字，100ms cubic                  | black/10 底                        | black/5+全局 outline                             | disabled 不响应                                | `.rah-interaction-flat`                                    |
| brutal 按钮                | 2px 黑边+2px 硬阴影                                    | 上移 1px、4px 阴影，100ms cubic               | `translate(1px,1px)`+1px 阴影      | 2px outline                                      | disabled not-allowed；页面可选 40%/50% opacity | `.btn` / `.rah-interaction-brutal`                         |
| Task 看板卡片              | 外层只拥有 DnD transform；内层白底 2px 黑边+2px 硬阴影 | 内层上移 1px、4px 阴影，100ms；外层不叠加位移 | 内层 `translate(1px,1px)`+1px 阴影 | 专用隐形 handle 聚焦后显形并拥有键盘 DnD 语义    | 拖动源外层降透明；状态按钮为 10px、40% Pencil  | `TaskCard` + `.rah-interaction-brutal` / `DiscoveryFilter` |
| segmented                  | 白底黑边                                               | yellow/30，立即变化                           | 无位移                             | 2px outline                                      | checked 为实黄；无 transition                  | `.rah-interaction-segment`                                 |
| 会话 tab                   | 白底、相邻 2px 分隔                                    | 未选中为暖灰，立即变化                        | 无额外视觉                         | **无 outline（Raft 例外）**                      | 所有 tab 均 `cursor:default`，当前 tab 黄底    | `.tab`                                                     |
| 卡片延迟动作               | opacity 0                                              | 父卡 hover 后 100ms cubic 渐显                | 小按钮按自身状态族                 | focus-within 同样显示                            | 触屏常显                                       | Activity completion action                                 |
| 消息行                     | 透明 2px 边                                            | 黑边+白底立即出现                             | 同 hover                           | 行本身不可聚焦                                   | 无 selected                                    | `.msg`                                                     |
| 消息工具条                 | opacity 0、pointer disabled                            | 行 hover 后 opacity 在 150ms cubic 内渐显     | 小按钮 yellow/30 且立即变化        | focus-within 同样显示                            | 触屏常显                                       | `.msg-actions`                                             |
| 面板标题栏图标操作         | 28×28、14px 图标、2px 黑边                             | 沿用 square button hover                      | 沿用 square button active          | 全局 outline                                     | 移动 Room 只保留频道设置入口                   | `.rah-panel-header-action` / `.rah-channel-options`        |
| 快捷回应浮层               | 224×40、白底 2px 黑边、软阴影                          | 单项 28×28、4px 圆角、flex 居中、pink/20      | 点击立即提交并关闭                 | 原生 `title="用 {emoji} 回应"`；Esc 还焦         | trigger/浮层均移出后桥接 120ms 关闭            | `DiscoveryFilter` reaction variant                         |
| 收藏状态                   | 未收藏图标 black/50                                    | 工具条 yellow/30                              | 收藏后图标常驻官方 orange 实心     | 工具条和徽标均可键盘操作                         | `已保存`与回应在同一 6px gap 摘要行；点击移除  | `MessageSocialButtons/Summary`                             |
| 消息姓名/头像              | 粗体 / 原图                                            | 姓名 2px 下划线；头像 brightness(.9)          | 头像可有 1px press                 | 独立按钮走 outline                               | 无 selected                                    | identity interactions                                      |
| 文本输入                   | 白底黑边+2px 硬阴影                                    | 无                                            | 无                                 | 外盒变 4px 硬阴影；内部 textarea 无 outline/内框 | disabled not-allowed                           | form/composer primitives                                   |
| 下拉菜单行                 | 透明                                                   | soft-signal 黄底                              | 无                                 | 2px outline                                      | 选中显示勾；Esc 关闭并还焦                     | DiscoveryFilter / dialogs                                  |
| 拖动排序                   | 原行                                                   | pointer 激活前保持原 hover                    | 拖动源降透明；overlay 粉底黑框     | 键盘 DnD 保留                                    | drop 指示线为黑色，不变黄                      | SidebarDrag / resizers                                     |

所有时间函数使用 `cubic-bezier(0.4,0,0.2,1)`；不能再写页面私有 `ease`
覆盖这些族。`transition:none` 只允许已选中行和确实没有动画的来源事实。

## 3. 页面操作位置归类

| 页面            | 操作位置                                                                                       | 状态族                                         | 点击/键盘合同与业务 owner                                                                                                         |
| --------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Shell           | 计算机标识、Search/Chat/Activity/Tasks/Members/Computers、通知、设置                           | rail / brutal logo                             | 点击导航；当前页 selected；通知粉点不因 hover/read 外观自动清除                                                                   |
| Chat 侧栏       | 已保存、分组折叠、排序、创建、Room/DM 行、设置、拖拽/置顶                                      | row / disclosure / flat / drag                 | 排序菜单 Esc 回焦；Room/DM 选择关闭旧 Agent inspector；偏好走 Human×Workspace owner                                               |
| Chat 正文       | 频道搜索/设置、Chat/Tasks/Files、消息头像/姓名、Thread/回应/收藏、展开全文、回到底部、composer | square / tab / message / flat / input / brutal | 消息框 hover 即时；工具条渐显；Enter 发送、Shift+Enter 换行；头像 hover 卡和点击 inspector 分开                                   |
| Search          | 查询框、sender/scope/channel/date/sort、清除、历史建议、Esc                                    | input / row / dropdown / flat                  | Esc 是键盘提示，不是可点击按钮；旧请求按 query key 取消；结果导航重验 ACL                                                         |
| Activity        | 筛选、查询、类型 segmented、卡片、read/done                                                    | dropdown / segment / row / flat                | 打开目标保留 Activity 中栏；read 与 done 不混用；个人未读粉点按 canonical frontier                                                |
| Tasks           | 查询、筛选、看板/列表、新建、任务卡                                                            | input / dropdown / segment / brutal / row      | 视图纯前端；Task 动作走 typed task owner，不由 CSS 乐观终结                                                                       |
| Members / Agent | 列表行、添加、头像、字段 pencil、runtime/model/effort、tabs、操作按钮、splitter                | row / flat / tab / brutal / drag               | model/effort 可编辑；保存走 Agent 管理 revision；切换身份丢弃旧响应                                                               |
| Computers       | Computer 行、splitter、runtime/Agent 项、恢复/复制动作                                         | row / drag / flat                              | RAH 本机 daemon owner 替代 Raft 中央 Computer；daemon 离线时 Web 本身不可用，中央式“页面在线而 Computer 离线”不列为本地同前置目标 |
| Settings        | 侧栏行、头像、输入、switch、通知启停/测试、保存、MCP/LAN 行                                    | row / input / segment / brutal                 | 账单与应用排除；保存只在 dirty 时启用；通知权限由浏览器/daemon owner 决定                                                         |

## 4. 实现约束

### 4.1 窄屏 Shell 与短窗口合同

Raft 冻结 bundle `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`
把移动断点声明为 `(max-width: 767px)`；RAH OS 不得再同时维护 700px 与
760px 两套互相冲突的 Shell 断点。宽度 `>=768px` 保持桌面 rail，宽度
`<=767px` 切换为移动 Shell：

- 根级移动导航固定为四项：`主页 / 任务 / 成员 / 设置`，每项等宽、白底、
  相邻项 2px 黑色分隔，当前项为 signal yellow；不得把 Search、Activity、
  Saved、Computer 再复制成第二套底栏业务入口。
- 主页把 Search、Activity 与 Saved 放回 Room 列表内部；Room、DM、Agent
  详情是从根级页面进入的下钻层，显示返回入口并隐藏底栏，不能让底栏与详情
  同时争夺高度。
- 移动 Tasks 默认仍是看板；不能因窄屏暗改为列表。看板横向滚动属于同一个
  Task 投影，不建立第二条业务路径。
- 高度 `<=600px` 的桌面 rail 使用 50px 宽、36px 操作项和 48px 头部；
  这是高度压缩，不得触发移动布局。短窗口中的 rail 子项不能溢出到内容区，
  更不能截获看板/列表按钮的 pointer event。
- 必测边界为 800、768、767、760、701、700px（高度 598px），另测
  1440×900 与 390×844。每个边界同时检查布局制式、可见导航标签、
  `documentElement.scrollWidth` 与 Tasks 视图切换按钮的实际命中元素。

上述合同的实现和真实 Chromium 结果见
[响应式 Shell 对齐审计](../audits/2026-09-04-raft-responsive-shell-verification.zh-CN.md)。

- `interaction-state.css` 是跨页面状态语法的唯一**裁决层**；生成的 ui-token CSS
  继续拥有基础几何/默认阴影，专题 CSS 继续拥有消息工具条等明确例外，但不得再叠加
  第二个 hover/press 位移。遗留 token 与裁决层冲突时必须由裁决层显式归一并以真实
  浏览器 computed-style 门禁证明。
- 强上浮 brutal 族的静止 2px 阴影、hover 上移 1px/4px 阴影、active 右下 1px/1px
  阴影和 100ms timing 必须由 `.rah-interaction-brutal` 的共享变量持有。专题 CSS 只拥有
  几何、颜色和内容排版；最接近的非滚动父层用 `.rah-interaction-shadow-host` 明示允许
  阴影越界，不能把整个页面滚动 owner 改成 `overflow:visible`。
- Task 卡片专题 CSS 只能拥有尺寸、边框、内边距和静止态 2px 硬阴影；视觉内层必须消费
  `.rah-interaction-brutal`，不能再声明私有 `:hover` / `:active`。DnD 位移仍只属于外层，
  真实指针门禁必须分别测量静止和 hover，而不能用脚本添加 class 冒充鼠标操作。
- Task 卡片不得继续继承旧 `.kcard` 的 `display:flex`、8px `gap` 或 14px 根行盒。Raft 的视觉卡为
  `display:block`、`gap:normal`、16/24px 根行盒；点击层为 `inline-block`，其内部固定经过
  `flex/items-start/gap:8px` 与 `min-width:0/flex:1` 两层，再进入 16.5px 高的编号头和 20px 标题。
  这组 DOM/行盒在同一 Chrome、1440×1000 下共同得到单行无描述卡片 105.25px 的 border box；
  DPR=1/2 分别取整为 105/211 个物理像素。高度依内容派生，不能用 `min-height` 模拟；跨浏览器只允许
  字形度量造成的亚像素差，来源与 RAH 必须在同一引擎中逐项比较。
- 看板列的卡片容器必须保持 `overflow:visible`，否则即使 computed shadow 已从 2px 变为 4px，右边和
  下边仍会被父层裁掉，形成“代码 hover 了、页面没变化”的假通过。滚动只属于看板更外层；列表与看板
  必须复用同一卡片 DOM，列表只通过可用宽度减少标题换行。
- Raft 看板列头到卡片是 `mb-3`（12px）；列表不是复用该间距，而是 `Xit` 的
  `space-y-2.5`（10px）。列表分组之间为 `space-y-6`（24px），同组卡片之间为虚拟列表
  `gap:10`。验收要分别量测卡片 border box、阴影 visual footprint 和分组占位，不能把
  “从列头到卡片多 2px”误报成卡片本体变高。
- Task 状态入口的 `mt-0.5`（2px）属于按钮外部留白。Raft `_it` 把 `badgeClassName` 直接加到
  带 2px 黑框的 `<button>`；颜色不得画在无边框 wrapper 上，也不得由按钮用 `background:inherit`
  穿透继承，否则父层颜色会在上边框之外露出。五种状态统一由 trigger 自己持有 tone class，真实浏览器
  必须断言 wrapper 透明、trigger 着色且二者顶部相差 2px。
- Task 视图切换不是通用 `kanban/list` 占位图标。冻结 Raft bundle 的 `ZUe/R3e` 分别是
  `columns-3/layout-list`，调用点传入 `size:12`，但 `q5/II` 的共享选择器
  `[&_svg:not([class*='size-'])]:size-3.5` 将最终尺寸覆盖为 14×14px；两处 Tasks 工具栏必须共用这组几何和最终尺寸。
  Room 模式的卡片编号头只显示 `#任务号`，全局 Tasks 才显示
  `#Room + #任务号`；空分组沿用 `px-3 py-5`（12px 20px）并保持左对齐。
- Room Tasks 工具栏对应官方 `px-4 py-3` 外层和 `flex flex-wrap items-center gap-2` 行：
  高度随整件控件换行增长，不能固定高度或压缩“新建任务”成竖排。该按钮是 12/16px 字体、
  4px 8px padding、2px 边框、12px 图标，最终高 28px；看板/列表仍使用上述共享 14px 图标。
- 零特异度 button preflight 阻断浏览器原生灰底/outset 边框泄漏，但不把所有按钮
  强制成同一种 hover。
- 所有新交互必须先选择上表控件族；找不到族时先补 Raft 来源合同和反例测试。
- 真实浏览器门禁至少扫描七个核心路由，拒绝可见 native `outset` / `rgb(239,239,239)`，
  并抽测每族 hover/focus/selected/disabled。桌面和 390×844 共用同一实现。
- Task 专项门禁必须使用真实 pointer，记录 board/list 同一 Task 的 CSS 高度及 DPR 取整高度、
  2px border、2px→4px shadow、`translateY(-1px)`、100ms、列头间距，以及到 Tasks 滚动层
  之间所有祖先的 overflow。像素验收裁切卡片并至少保留 6px gutter，分别比较静止/hover
  右边和下边的黑色硬阴影外延；动态文本不同的整页截图不设“零像素差”这种伪精确指标。
- 对隐藏/权限条件组件只能写“源码合同”或“未验证”；不得由一个 class 字符串推导
  后端成功，也不得声称全站 1:1。
