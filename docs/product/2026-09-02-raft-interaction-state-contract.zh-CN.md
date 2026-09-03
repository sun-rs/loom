# Raft 前端操作状态合同

冻结日期：2026-09-02。适用对象：RAH OS Web/PWA 的桌面与窄屏共用组件。

## 1. 证据与边界

Raft 当前已登录页面仍加载 `index-BoAC7nSE.js`，与
`docs/evidence/raft-web-20260831-current/` 的冻结入口相同；入口 SHA-256 为
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
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

| 控件族                     | default                                                | hover                                         | press / active                     | focus-visible                                    | selected / disabled                            | RAH owner                          |
| -------------------------- | ------------------------------------------------------ | --------------------------------------------- | ---------------------------------- | ------------------------------------------------ | ---------------------------------------------- | ---------------------------------- |
| 主 rail                    | 40×40、透明 2px 边                                     | 白底、黑 2px 边，150ms cubic                  | 不额外位移                         | 全局 2px 黑 outline                              | 当前页白底黑边+2px 硬阴影                      | `.rail-btn` + interaction protocol |
| 导航/频道/成员/Computer 行 | 透明 2px 边                                            | 白底黑边+2px 硬阴影，150ms cubic              | 同 hover                           | 2px 黑 outline                                   | 粉底黑边+2px 阴影；选中态无过渡                | `.rah-interaction-row`             |
| 分组标题                   | 12px uppercase，`cursor:default`                       | 仅文字变 black/70，150ms cubic                | 无额外视觉                         | 全局 outline                                     | 展开仅转动箭头                                 | `.rah-sidebar-disclosure`          |
| 平面小按钮                 | 透明、black/70                                         | black/5 底+黑字，100ms cubic                  | black/10 底                        | black/5+全局 outline                             | disabled 不响应                                | `.rah-interaction-flat`            |
| brutal 按钮                | 2px 黑边+2px 硬阴影                                    | 上移 1px、4px 阴影，100ms cubic               | `translate(1px,1px)`+1px 阴影      | 2px outline                                      | disabled not-allowed；页面可选 40%/50% opacity | `.btn` / `.rah-interaction-brutal` |
| Task 看板卡片              | 外层只拥有 DnD transform；内层白底 2px 黑边+2px 硬阴影 | 内层上移 1px、4px 阴影，100ms；外层不叠加位移 | 内层 `translate(1px,1px)`+1px 阴影 | 外层保留 dnd-kit 键盘拖动语义                    | 拖动源外层降透明；状态按钮为 10px、40% Pencil  | `TaskCard` / `DiscoveryFilter`     |
| segmented                  | 白底黑边                                               | yellow/30，立即变化                           | 无位移                             | 2px outline                                      | checked 为实黄；无 transition                  | `.rah-interaction-segment`         |
| 会话 tab                   | 白底、相邻 2px 分隔                                    | 未选中为暖灰，立即变化                        | 无额外视觉                         | **无 outline（Raft 例外）**                      | 所有 tab 均 `cursor:default`，当前 tab 黄底    | `.tab`                             |
| 卡片延迟动作               | opacity 0                                              | 父卡 hover 后 100ms cubic 渐显                | 小按钮按自身状态族                 | focus-within 同样显示                            | 触屏常显                                       | Activity completion action         |
| 消息行                     | 透明 2px 边                                            | 黑边+白底立即出现                             | 同 hover                           | 行本身不可聚焦                                   | 无 selected                                    | `.msg`                             |
| 消息工具条                 | opacity 0、pointer disabled                            | 行 hover 后 opacity 在 150ms cubic 内渐显     | 小按钮 yellow/30 且立即变化        | focus-within 同样显示                            | 触屏常显                                       | `.msg-actions`                     |
| 快捷回应浮层               | 224×40、白底 2px 黑边、软阴影                          | 单项 28×28、4px 圆角、flex 居中、pink/20      | 点击立即提交并关闭                 | 原生 `title="用 {emoji} 回应"`；Esc 还焦         | trigger/浮层均移出后桥接 120ms 关闭            | `DiscoveryFilter` reaction variant |
| 收藏状态                   | 未收藏图标 black/50                                    | 工具条 yellow/30                              | 收藏后图标常驻官方 orange 实心     | 工具条和徽标均可键盘操作                         | `已保存`与回应在同一 6px gap 摘要行；点击移除  | `MessageSocialButtons/Summary`     |
| 消息姓名/头像              | 粗体 / 原图                                            | 姓名 2px 下划线；头像 brightness(.9)          | 头像可有 1px press                 | 独立按钮走 outline                               | 无 selected                                    | identity interactions              |
| 文本输入                   | 白底黑边+2px 硬阴影                                    | 无                                            | 无                                 | 外盒变 4px 硬阴影；内部 textarea 无 outline/内框 | disabled not-allowed                           | form/composer primitives           |
| 下拉菜单行                 | 透明                                                   | soft-signal 黄底                              | 无                                 | 2px outline                                      | 选中显示勾；Esc 关闭并还焦                     | DiscoveryFilter / dialogs          |
| 拖动排序                   | 原行                                                   | pointer 激活前保持原 hover                    | 拖动源降透明；overlay 粉底黑框     | 键盘 DnD 保留                                    | drop 指示线为黑色，不变黄                      | SidebarDrag / resizers             |

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

- `interaction-state.css` 是跨页面状态语法的唯一**裁决层**；生成的 ui-token CSS
  继续拥有基础几何/默认阴影，专题 CSS 继续拥有消息工具条等明确例外，但不得再叠加
  第二个 hover/press 位移。遗留 token 与裁决层冲突时必须由裁决层显式归一并以真实
  浏览器 computed-style 门禁证明。
- 零特异度 button preflight 阻断浏览器原生灰底/outset 边框泄漏，但不把所有按钮
  强制成同一种 hover。
- 所有新交互必须先选择上表控件族；找不到族时先补 Raft 来源合同和反例测试。
- 真实浏览器门禁至少扫描七个核心路由，拒绝可见 native `outset` / `rgb(239,239,239)`，
  并抽测每族 hover/focus/selected/disabled。桌面和 390×844 共用同一实现。
- 对隐藏/权限条件组件只能写“源码合同”或“未验证”；不得由一个 class 字符串推导
  后端成功，也不得声称全站 1:1。
