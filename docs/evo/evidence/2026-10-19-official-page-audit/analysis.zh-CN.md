# 官方页面层差异审计（2026-10-19）

## 结论与证据边界

当前不是最新版官方完整前端：它是 `raft-ui@0.6.0`、公开旧页面源码、v1.21.16 的部分发布代码移植及 Loom 本地页面组合的混合体。上一轮完成了依赖、字体和主题模式迁移，但没有完成最新页面组合迁移；已有测试通过不能证明官网页面对齐。把上一轮称作“整套 UI 完整替换”超出了证据范围。

本次从官方生产入口取得发布身份：`release/v1.21.22`，commit/release `af3d6ef4a22f0f05f5f9db9424285755d67e9726`，构建时间 `2026-10-18T18:31:04Z`。入口、主包、CSS 和动态模块已取得；177 个 JS/CSS 文件（11,930,092 字节）归档，摘要见 [release-lock.json](./release-lock.json)。图解析包含语言包，未成功的候选名留账，其中包含字符串误匹配；不宣称这是全部字体、媒体及原始源文件。离线资源在 `/Users/sun/.loom/reviews/2026-10-19-official-page-audit`。

公开 `raft-source` 的 HEAD 仍为 `a98ae003246a0360872a77d76dec2fccd0347ef7`。主包 sourcemap 请求返回 404。最新 commit 的 GitHub API 请求返回 403，不能用此结果断言仓库不存在对应提交。已取得的发布 JS 是官方可验证实现，格式化产物可用于结构移植，但不能冒充原始 TSX，也不能整包运行并连向 Raft 账号/API。

本轮为代码审计，没有修改产品代码，没有重启或运行模型。尝试通过原生 Firefox 查阅现场，工具返回 `cgWindowNotFound`；以下“确认”指代码证据，不冒充本轮浏览器视觉验收。用户现场观察保留为视觉问题清单。

## 根因

1. 资源版本和页面版本分离。`adoption.json` 锁的是旧公开源码；`rui-v6-ports.json` 证明旧页面适配过新组件，并不证明其已采用新页面结构。
2. 页面仍主动指定旧 variant、固定字号和容器。新版 recipe 无法越过调用端指定的 `underline`、`Card`、旧包装层或空的通知槽。
3. 共享动作表过于粗略：`ui-action-props.ts` 把 `panelIcon` 固定为 `outline`。原生不同容器的动作依赖 `PanelAction`、Composer 专用部件等，不能只凭“都是图标按钮”套相同外观。
4. 本地业务适配扩展成了页面实现。真实未读数据、角色/实例差异必须适配，但不应顺便另造标题、筛选条、抽屉内容和标签样式。
5. 测试主要证明可用、无溢出、数据与写入边界正确；多个断言仍以本地结构为基准。哈希证明“锁住了什么”，不证明“锁住的是最新官方页面”。

## 逐项核对

发布主包下文简称 `app-shell-D1-nY-va.js`；符号名仅对本锁定版本有效。归档中的 `.pretty.txt` 为格式化阅读副本，原始字节摘要单独保留。

| 表面                     | 官方代码证据                                                                                                                                          | Loom 当前证据/判断                                                                                                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 顶栏计算机名             | 主包 `Gbt/Bbt/Obt/Wbt/zbt`：36px 控件、`text-subhead`，根据可用空间/组织数量决定头像或文字下箭头；`Obt` 明确包含 hover/active/expanded 背景           | `loom/TopBar.tsx` 固定头像、disabled Button、text-sm，缺少这套组合。不能把“无 hover”当官方全局规则；本地单工作区不应伪装可切换组织            |
| 顶栏铃铛                 | `Kbt` 渲染 `R6 flavor=top-bar`；LeftRail 根据顶栏存在与否决定是否放到底部                                                                             | `Navigation.tsx` 无条件 rail-bottom，TopBar 右侧槽为空。位置错误已确认，现有通知数据服务可复用                                                |
| 导航提醒方块             | LeftRail 调用 `V6` 时对聊天/动态/计算机传 `showDot`、`dotInactiveOnly` 等                                                                             | 本地 RailTabButton 没传未读状态。不是缺图标；要从现有业务读模型提供各自状态，不以系统通知条数替代全部大页未读                                 |
| 聊天/任务/文件选中态     | 新 ChatPanel 的 SortableTabsList 使用默认 variant；0.6 默认 recipe 有 `data-active:bg-primary`                                                        | `ChannelTabs.tsx` 强制 underline，绕过原生黄色状态，已定位直接根因                                                                            |
| Role 配置/实例标签       | 最新 `AgentDetailPanel-B3FrpUPj.js` 使用 ConversationPanelTabs + Tabs + SortableTabsList 整体包装，不强制 underline                                   | `RoleWorkspace.tsx` 额外 overflow 容器 + 裸 Tabs + underline；应沿用完整包装，仅替换业务 tab 数据。过短/裁切还需窄宽度复现                    |
| 动态列表                 | `ThreadsInbox-CbSKTW4g.js` 的 `Ie/Le/Re`：普通 div 行、相邻 before 分割线、px-4 py-3、hover:bg-fill-pressed、active bg-info-soft，正文用 text-callout | `ActivityMessageRow.tsx` 仍使用 Card、圆角边框、投影、text-sm/text-xs，属于页面旧版本，不是原生库缺能力                                       |
| 大页标题图标             | 最新任务、动态调用不传旧标题图标；PanelHeader `NW` 仍支持 icon/avatar，按场景传入                                                                     | 本地任务页手写图标块，动态主动传 Activity 图标。应改各页 composition；不可全局删除所有头像/标题图标                                           |
| 任务筛选/列表            | 主包 TasksPanel 使用专用 picker trigger、频道/创建者/负责人选择、清除状态；专用行/看板组合                                                            | `TasksPage.tsx` 仍有本地手写 header、Button filter 和固定 h-8。完整过滤与 hover 组合待替换；新增筛选维度必须先核查现有查询能力                |
| 聊天设置                 | 最新 `Xxt -> bxt` 仍明确使用 modal Drawer、swipeDirection=right，组合已改用原生 DrawerHeader/Body 等                                                  | 本地 `OverflowSheet.tsx` 也是右抽屉，但自行固定宽度和头部。右侧打开本身不等于错误；需替换整套头部/内容/动作/关闭守卫，不能猜测改成另一种菜单  |
| 排序/+及其他工具图标     | 官方页面通过专用动作组件传递尺寸和状态，主包 `yxt` 使用 PanelAction                                                                                   | 本地 sidebar 仍手写 h-6/text-xs/14px 图标；动作表也有统一 outline。按页面追溯源组件，不全局抹背景/改尺寸                                      |
| Composer 的任务标识/发送 | 主包 composer 使用专用 task toggle/send/icon 部件，外层焦点与布局条件参与最终效果                                                                     | 旧 composer 及本地移动适配仍需逐层对照。此项未完成逐状态测量，不能仅据已升级字体宣告一致                                                      |
| 聊天内任务残留实例图标   | 最新频道任务页组合已取得                                                                                                                              | 本轮未定位用户所指具体实例图标分支，保留复现项，不推测删除所有实例入口                                                                        |
| 设置页共同 tab 风格      | 最新 settings 组合在主包，原生 Tabs/Sidebar/表单各有不同层次                                                                                          | 本地 SettingsPage/各子页保留不同年代组合，需逐类映射，不能靠统一全站字号解决。尚未逐 tab 验收                                                 |
| 计算机大页               | 已取得 `MachineDetailPanel-C2oaC119.js` 和主包 computers 列表/路由                                                                                    | `Navigation.tsx` destinations 没有 computers。属于缺失页面能力而非换肤；先接已有本机/AgentHost 状态，远程部署/升级/账号能力不因 UI 引入而开放 |

## 采用方式

优先取得同一 release 的原始页面源码；公开 HEAD 未跟上时，采用已锁定发布代码的完整页面结构移植。直接复用原生组件/recipe，发布代码负责组合、参数、事件与响应式条件；Loom 只提供数据和动作接口。标注“官方包直接依赖”“发布代码结构移植”“Loom 业务适配”，不可把后一种称作原封不动复制。

不要替换成官方整包应用或照搬业务 store。官方身份、组织、云端接口、缓存和任务业务状态不能成为 Loom 第二事实来源；已有 SDK、权限、版本校验、未知写入确认、历史分页和草稿逻辑必须保留。停用不支持的控件，不改变仍保留控件的交互规则。

### 施工顺序（每批完成完整路径）

1. **壳与共同层**：顶栏/铃铛、导航状态、原生 PanelHeader/PanelAction、标签完整包装、列表工具动作。先消除错误覆盖；同时核对设置与 Role 页共同容器。未读绑定使用现有权威投影，不能新增客户端猜测状态。
2. **核心聊天路径**：聊天标签 → Composer → 频道任务页 → 设置抽屉。采用最新完整组合；保留拖动、焦点、关闭守卫、移动响应和未知提交语义。
3. **动态与任务大页**：原生分割行、选中态、过滤条、点击/键盘/跳转；再处理设置子页。不是只换 Card 标签，而是同批替换行外围间距、列表容器和详情展开关系。
4. **计算机页**：按现有 backend 可查询/操作范围绑定列表和详情；未支持功能明确省略。与视觉校准分开验收。

每批先从锁定官方代码建立结构/参数与行为的失败断言，再实施；浏览器只覆盖受影响路径的 desktop/390x844，外加涉及标签裁切的中间宽度。验证 default/hover/active/selected/focus/disabled、展开关闭/返回焦点、窄屏溢出，不以无报错或构建通过替代同源对齐。无需运行后端全套或付费模型。

## 本轮交付状态

完成：版本锁定、发布资源归档、关键模块差异定位、迁移顺序和事实纠偏。未完成：产品页面替换、剩余模块逐状态核对、现场视觉验收。产品未改动，部署状态不变。
