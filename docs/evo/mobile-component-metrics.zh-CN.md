# 移动端组件尺寸收拢（2026-10-20）

官方来源：https://github.com/botiverse/mobile ，revision `655975433b8492a8f4eef7bbce1b913140bc7485`，FSL-1.1-ALv2。路径均在 `compose/shared/src/commonMain/kotlin/build/raft/app/`。本批是来源明确的 CSS 结构适配，不是直接复制 Compose，更不宣称浏览器与 UIKit 完全相同。官方 Web 及 raft-ui 保持锁定版本。

根因是部分 Web 桌面配方未被移动端覆盖，首页还残留额外放大样式。统一规则归 `frontends/raft/loom/mobile.css`；不改后端、桌面、消息字号偏好、调度和输入框生命周期。

| 部件             | 来源                                                                      | 处理                                                                                           |
| ---------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 首页入口、频道行 | SlockHomeComponents.kt，SidebarActionRow / ChannelRow                     | 入口46→32，频道36→32；文字14/18、图标14、间隔6                                                 |
| 空分组           | 同上，homeSidebarSectionOrder，mobile always hides empties                | 手机始终隐藏空组，桌面仍使用原偏好，不持久化手机覆盖                                           |
| 分组标题         | SlockSectionHeader.kt，SlockCollapsibleSectionHeader                      | 最小30、前间隔4，移除桌面顶部16内边距；保留原菜单/折叠                                         |
| Role列表         | MembersPage.kt，MembersList*                                              | 行34、名称14/20、头像18；与消息头像分开                                                        |
| 任务卡片         | SharedTasksPage.kt，SharedTaskCard                                        | padding12×10，标题14/20，说明12/16，编号11/14                                                  |
| 任务筛选         | SharedTasksPage.kt，LazyRow                                               | 横向滚动，不靠换行无限增加高度                                                                 |
| 保留项           | SlockDesignTokens.kt / ThreadPage.kt / SlockTopTabBar.kt / SlockTabBar.kt | 主操作44点击区域、消息头像36、标签栏49、设置行36、细分隔线1与控件边框1.5；不是所有尺寸都应缩小 |

不同页面不共用一个无差别的尺寸：列表与消息头像分开、紧凑行与主要操作按钮分开。动态及Loom专属记忆卡片未声称已逐项对齐原生App。系统文字缩放、物理手机键盘、安全区及PWA行为仍需真机验证。

导航测试先复现46≠32；正式旧页面卡片检查复现16/24≠14/20。定向浏览器检查覆盖首页入口图标、空分组、任务卡片和Role列表、桌面保持原尺寸；已有导航与短屏密度检查保留点击/输入断言。本批不运行付费CLI或全量后端测试。

截图复查还复现了WebKit特有的长任务空白：卡片正文为inline-block按钮，截断文字仍影响基线行盒。同一长卡片高度240.625，局部改为block后174.03125，正文与状态行之间恢复8px。新增实际间距断言；这是Loom局部浏览器兼容修复，不冒充上游代码。首次桌面头像断言把16px内容误当外框，查raft-ui的2xs配方确认为19px外框，已纠正测试，产品桌面未改。

## 动态与记忆补查

继续采用同一移动端revision的 `SharedInboxPanel.kt / SharedActivityRow`（1636起、1836头像常量）：手机动态头像容器32、主文字14/18、时间12/16、左右12。保留当前最新版Web的单行标题/摘要、分隔线、点击及菜单逻辑，不搬入原生App不同的内容排序或旧式选中阴影；这是有界尺寸适配，不是宣称两端布局完全相同。分隔线随头像列右缘对齐。

临时Core的Chromium/WebKit各390/1440检查通过，手机行高64→60、桌面仍64；菜单关闭、触屏不常驻Done及计算机实例→Role详情跳转保留。记忆采用现有Loom六行预览和原生控件，不存在对应的全局记忆App页面可照搬；两种引擎的定向布局检查均通过六行截断、打开详情、关闭返回原列表，以及32px关闭按钮周围扩展点击区域。为减少无关验收，记忆浏览器脚本增加layout-only模式，跳过编辑/删除/权限CRUD。没有因此宣称已验证真机长按、键盘、安全区或全站细节。
