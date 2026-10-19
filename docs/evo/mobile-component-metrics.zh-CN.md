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

## 手机文件窗口短屏修复

Loom的主机文件树没有可直接等价替换的原生App组件。本批继续使用既有raft-ui Dialog/Header/Body/Footer/SelectionPopover/Checkbox，不复制移动App的系统文件选择器。根因是本地固定256px文件树与80dvh窗口上限叠加，在390×560把隐藏文件开关挤出可见正文，造成双层滚动；增加授权目录选择后更明显。

只在手机宽度下将外窗固定为 `min(512px,100dvh - 32px)`，文件树占剩余高度且至少72px（导航行与一行文件），目录内容保持原滚动owner，切小目录不改变高度。一般短屏外层无需滚动；极短横屏保留外层滚动作为可访问性兜底，绝不裁掉字段。此尺寸是Loom本地兼容策略，不标称官方提取值。桌面与上传/引用业务逻辑不变。

回归先复现隐藏开关不可见，随后补测多授权目录复现空间不足。Chromium/WebKit各覆盖390×560、360×560（双授权目录）与1440×1000，检查开关可见、无外层滚动、取消可点击、切小目录树高不变。既有附件定向门禁仍验证390/820/1440的目录加载/失败恢复、上传引用与未知结果处理。不是物理手机系统文件对话框验收。

## 大页标题栏语义修复

记忆首页误用详情用的PanelHeader导致白底，手机端改用官方PanelSectionHeader；其颜色来自raft-ui0.6 `panel-header.recipe` 的layer-frame/on-frame语义，不硬编码黄色，桌面与记忆详情保持原组件。任务页上次只将PanelHeaderContent改成row，却继承justify-center，造成整组居中；手机端改为space-between，标题与数量分别对齐16px内容边缘（数量不是图标，不使用末尾图标的悬出边距）。高度仍48px。

ui-contract.json记下大页/详情标题栏区分。导航门禁新增五个主入口标题底色一致、任务左右16px断言，先复现居中问题后通过；Chromium/WebKit各390和1440通过。颜色比较使用已采用的设置根标题，不锁死当前主题RGB。该修复不改动态等二级页面标题的语义。

## 手机设置内容与主题预览

外观页的直接原因是AppearanceThemePicker使用 `grid-cols-1 sm:grid-cols-3`，手机把三个80px高预览和标签逐个纵向堆叠。保留官方Web原预览、RadioGroup、Card、主题切换和保存状态，仅手机使用现成三列排列，标签间距适应窄卡片。官方移动端本revision的SettingsAppearanceContent没有对应的三张主题预览，不能称为App原样移植。

SettingsHomePage的SettingsServerActionRow与SettingsFontOptionRow采用Button14/18、Caption12/16；手机设置详情中对应subhead/footnote文字使用该层级，外层16px留白已相符。输入、消息字号预览、按钮触区和桌面不受这两个文字规则影响。不把本批称为所有设置项与App像素级一致。

主题布局先复现三卡不同行；定向Chromium/WebKit各360/390/1440通过同行、整体高度<=180px、浅/深/系统选择、跟随系统、重载持久化与14/18消息预览。旧完整外观检查仍有两个问题：手机显示空分组的旧断言与已采用语义冲突（已修正测试）；WebKit完整流程报activity/member读取access-control错误，未证明根因、不列为通过。本批采用layout-only模式验证受影响内容，完整旧失败日志保留在private evidence。
