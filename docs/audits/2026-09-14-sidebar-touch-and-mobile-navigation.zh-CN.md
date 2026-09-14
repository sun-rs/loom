# 聊天列表触摸修复与移动导航取舍

## 来源和定位

Raft授权发布源码 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
以下为2026-09-13授权pretty副本行号，不引入发布bundle作为产品依赖。

- 136250：sidebar-root具有select-none；137641、137915的菜单也具有select-none。
  同版index-DPaRRgFJ.css（SHA256 `0d658697e96e6569a8a9d29279e0765da20517a7133a2facf708f45af39afbf0`）
  设置-webkit-tap-highlight-color:transparent；本地只在侧栏行/菜单采用，避免浏览器蓝色触摸闪烁。
- 128496附近Ett：500ms长按，移动任一轴超过10px取消；结束/取消清理计时，
  长按后的touchend preventDefault，并用suppressClickRef防止普通点击。
- 134430：Sidebar同时使用PointerSensor(distance 6)、TouchSensor(delay 500,
  tolerance 10)、KeyboardSensor；134589–134655将Ett绑定到频道/DM，并在导航前检查抑制标记。
  46998–47074证明Mf是Pointer而非Mouse，Fk是Touch。长按拖动和长按菜单可能竞争；
  不把源码风险等同于已定位每台iPhone上卡顿的全部原因，也不宣称Raft完全不支持触摸排序。
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
  `packages/ui/components/ui/context-menu.tsx:19` 给Base UI Trigger加select-none。
  与RAH共用同一库系列，没有理由为这次修复重写菜单状态机。

本地 `@base-ui/react` 1.3.0 的 `context-menu/trigger/ContextMenuTrigger.js`
已有500ms长按、10px移动取消、touchcancel清理、WebkitTouchCallout:none及焦点/关闭机制。
但它未替业务子元素阻止长按后的普通click。RAH的SidebarDrag使用PointerSensor，
加上行文字可选，造成触摸排序竞争与选字风险。

## 决策与唯一owner

用户允许不兼容时放弃触摸拖动排序。本批明确停用**手指拖动**排序，保留鼠标及键盘排序。
按实际输入类型分流，不以屏幕宽度或PWA标记禁用鼠标：iPad接鼠标仍走MouseSensor。
触摸短按打开会话，滑动交给浏览器，长按打开同一上下文菜单；置顶、移动到分区继续走原偏好命令。
不增加另一套排序状态或持久化路径，不改变分区/频道顺序数据。

- `SidebarDrag`仍唯一负责拖动协调，PointerSensor替换为现有库的MouseSensor，
  KeyboardSensor保持；不增加TouchSensor、全局preventDefault或touch-action:none。
- 侧栏行/分区标题禁止user-select和WebkitTouchCallout，既有pan-y保持；
  菜单禁止选字。规则限定在导航，搜索输入、消息正文仍可选字。
- `ui-web/ContextActions`继续复用Base UI的长按计时、焦点和关闭。
  从其touchstart打开通知设置一次手势的click抑制，capture阶段阻止子元素导航/折叠；
  新pointer/touch手势清理标记，键盘click(detail=0)不被误吞。
  这是对Raft“长按后不执行普通点击”的结构化移植和本地事件适配，没有复制上游状态机或新素材。

## 红绿测试与验收边界

`scripts/test-sidebar-touch-browser.mjs` 使用临时Kernel/假Provider建立24个频道，
390×844下先复现文字可选；修复该项后，再复现9px横向触摸激活拖动；
停用触摸拖动后，进一步复现长按松手错误收起列表。逐项保留失败断言再修复。
截图复查发现蓝色tap highlight，再由computed-style断言复现蓝色值后改为透明。
Base UI继承的500ms菜单开启保护期保持，外部关闭检查在保护期后进行，不把保护期改成零。

Chromium使用原生Input.dispatchTouchEvent，检查原生滚动、长按、移动取消、touchcancel、
松手不导航、不折叠分区、无排序写入、后续短按可用。WebKit没有自动化触摸拖动接口，
使用合成DOM触摸/释放click仅检查组件事件逻辑与渲染；不能证明iOS原生选字/callout或惯性滚动。
真实iPhone Safari及添加到主屏幕PWA验收仍需设备，不能以桌面WebKit模拟替代。

交付验证：`npm run test:web:sidebar-touch`通过；桌面分区拖动、混合组归属、刷新保留和
上下文菜单回归在Chromium/Firefox通过。已查看触摸菜单及原生滚动截图，蓝色tap flash消失。
`npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench`通过；最终CSS规则登记、匹配报告及UI目录也已更新并复检。
未运行付费Provider或提交/推送。

正式实例空闲检查、备份校验后优雅重启，备份
`pre-restart-7fa4638a-d875-4811-819a-e8a0dcfff74e`；新冻结构建
`7840f707db34a9296d5bccfd6c71b2927bd62fbe1aaaf02d06e927a436deafe9`。
新鲜正式浏览器核对构建ID，在390×844实际频道/私聊上长按、松手、关闭菜单，
390×500短屏上验证原生触摸滚动；侧栏偏好写入为零，没有发送消息或创建测试数据。
已查看正式截图。这是正式产品的Chromium触摸模拟，仍非真实iPhone/PWA或Raft同条件双边验收。

## 底栏换成左上角抽屉：分析，未实施

Raft当前Oue/Emt（169558–169670）在根页面显示主页/任务/成员/设置，
进入channel、DM、search、activity、人物详情或打开thread/inspector时隐藏底栏。
因此“Raft每一页始终占底部空间”不是当前源码规则。RAH当前App无条件组合MobileNavigation，
product.css移动底栏为52px加safe-area；这与旧审计描述的详情隐藏已经不一致。
本批以当前代码为准记录差异，不偷偷扩大为导航布局改版。

主页含搜索、动态入口，本质上是一个入口集合，不能仅由此推导所有页面应该使用抽屉。
但RAH作为桌面导向、多区域工作台，把主导航统一放进移动抽屉是可行选择：

| 维度       | 当前底栏                            | 左上角入口＋抽屉                                         |
| ---------- | ----------------------------------- | -------------------------------------------------------- |
| 内容空间   | 根页占用一条导航，RAH当前详情也占用 | 关闭时只占顶栏已有按钮位；safe-area仍须保留              |
| 功能切换   | 已露出的根目的地一次点击            | 通常两次点击；从聊天到搜索可能比“返回主页再点搜索”更直接 |
| 发现与提醒 | 目的地与选中态可见                  | 隐藏入口，需保留当前页标题、入口汇总提醒和抽屉内分项未读 |
| 单手操作   | 底部更易触达                        | 大手机左上角更难够到                                     |
| 桌面一致性 | 移动主页混合搜索/动态/聊天          | 同一目的地、权限、排序和导航动作；展示改为带文字的列表   |
| 状态复杂度 | 根标签＋内部返回                    | 抽屉开关、模态焦点、返回顺序、手势冲突都需明确           |

建议采用抽屉作为有意识的产品差异，前提是长时间阅读/处理聊天比频繁切换根功能更重要。
不是“把桌面窄图标栏原样滑出来”：复用导航数据和动作，移动端使用图标＋标签、至少44px触摸目标。
入口固定在共享顶栏布局内，尊重安全区，不用悬浮最高z-index覆盖标题、返回按钮或模态窗口。
详情页同时保留返回上一层与打开全局导航的能力，不能让同一无提示图标时而返回、时而开抽屉。

抽屉为覆盖层、不挤压正文；打开后独立滚动、背景停止滚动，遮罩/关闭键可关闭并归还焦点；
关闭抽屉不改变路由、草稿或滚动位置，选择目的地才调用原导航动作。
系统返回先关闭抽屉，再返回页面；不得强抢iOS左边缘返回手势。
“永远存在”适用于普通页面的同一入口，确认弹窗/文件全屏预览等覆盖层仍遵守模态优先级。
迁移应删除旧底栏占位，保留safe-area和键盘布局，避免同时保留两套全局导航与状态。

Apple关于[tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)
强调根功能可发现性和保留导航状态；[导航设计讲解](https://developer.apple.com/videos/play/wwdc2022/10001/)
也提示把所有功能挤进Home会造成发现问题。这些是权衡依据，不是强制RAH必须沿用原生tab bar。
