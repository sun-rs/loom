# 搜索点击丢失修复与 Raft v1.21.26 差异分析

## 搜索：已复现并修复的产品缺陷

历史“搜索偶发超时”不是已证明的 API 慢请求。输入事件先更新 URL，React Router 默认过渡稍后提交：条件过滤行插入，按 query keyed 的结果树被替换。鼠标按下旧按钮、松开时旧按钮已移除，浏览器不会产生有效 click。详见前批 `2026-10-20-search-timeout/summary.json`。

本批只在 DiscoveryPage 搜索输入更新中使用数据路由已有的 `flushSync: true`，让 URL 与交互布局在同一输入事件提交。没有调整网络超时、添加请求重试、pointerdown 导航或改动结果查询/权限。API 请求仍在效果中异步执行。过滤行、结果键、IME 与页面展示模式不变。

新增 `search-transition` 隔离浏览器门禁：原生输入事件结束时 URL、过滤行与结果按钮文字必须一致，然后真实鼠标按下、等待 300ms、松开进入完整搜索。旧实现确定失败（URL 已更新但过滤行不存在）；修复后 WebKit、Chromium 通过。WebKit 顶栏现有门禁在 1440/390 通过，包括 IME、清除、浮层/完整页面。不是用延长等待把错误变通过。

## 官网版本确已更新，但不能把所有差异归因于更新

本次抓取官方生产 v1.21.26 / aa975b0e25ecc07ee6917d88d3ca973782550e6a，构建时间 2026-10-21T00:10:40Z；前次锁定 v1.21.22。文件 URL/hash 见同目录 upstream-lock.json。取得的是正式发布 JS/CSS，格式化仅供定位，不是未经修改的 TSX 源文件。后继查证纠正：旧无作用域 npm 包 raft-ui 停在 0.6.0；官方已更名为 @botiverse/raft-ui，有更新版本。本段初查漏查了新包名。后继已直接采用0.10.5，见 ../2026-10-21-ui-126/summary.json。以下分析不是已替换/已通过全页面视觉验收的声明。

| 用户观察 | 官方证据与 Loom 差异 | 对接方式 |
| --- | --- | --- |
| 多页字体变小 | 新 CSS 在 `(width>=48rem) and (pointer:fine)` 将 body 16→14、subhead 15→14、footnote 13→12；body/subhead/callout 行高22。旧发布 CSS body只有16。Loom固定0.6资源尚无该桌面覆盖。 | 从官方共享排版层按原媒体条件吸收；不能给所有手机/平板也覆盖14px。 |
| 左上计算机名 | 新 AAt 使用 on-frame/md Button，名称 span 不再独立加 text-subhead/font-bold。Loom TopBar仍有该覆盖。 | 采用当前完整 trigger 组合，单工作区不增加组织切换。 |
| 顶栏搜索随宽度变化 | Qze原生 SearchTrigger；wAt测量左右容器及子元素空余，xAt在基础clamp宽度上对称扩展，并由Resize/MutationObserver更新。Loom只有固定clamp Button。 | 移植测量函数和组件链，保留本地通知/单工作区数据。检查768附近、长计算机名与缩放。 |
| 左列表默认更宽 | 官方J8依然 min180/max320/default240，与Loom panelBounds相同；compact详情min320/max480/default320也一致。 | 不盲目加宽。用干净浏览器和同一viewport核对已保存拖动值、当前列数；目前没有新默认宽度证据。 |
| 语言和区域下拉、外观文字 | 官方保持subhead/footnote与原生表单recipe；会受新版全局桌面字体/行高影响。LoomLanguageRegionSettings是旧组合，局部手机压缩另有登记。 | 排版先统一，再对照实际控件DOM高度与recipe；不能靠页面级缩放。中文固定范围保持。 |
| 聊天正文 | 新jW/JKe三档改为body token−2 / token / token+2，行高也±4；桌面即12/14/16，默认触屏14/16/18。LoomappearanceStore仍为固定14/16/18，另有已批准手机默认小档。 | 连同正文、预览、标签/姓名映射及偏好语义一起迁入，保留用户显式选档，不只缩正文CSS。 |
| 动态、任务卡片文字 | 都消费原生排版token，首先受桌面覆盖影响；尚未完成这两个页面新版全部状态参数的双边DOM复核。 | 共享层更新后做局部双尺寸取样，不能在此宣称每张卡片已完全对齐。 |
| Role资料与逐项编辑 | 官方AgentDetailPanel有profile-hero头像、agent-change-avatar入口、字段编辑状态；LoomRoleProfile仍整体“编辑配置”，RoleWorkspace仍叫“配置”。这是明确本地组合缺口，不全是新版本造成。 | 名称改资料；字段后原生铅笔，字段级草稿/保存/取消。写入仍经Role manager完整修订，CLI切换联动模型/推理校验，不能绕过旧实例冻结规则。 |
| Role头像 | RoleConfiguration继承的provision schema已有avatarKey，Kernel role-catalog保留该元数据；但Role资料未接头像选择/展示。不能据此声称上传全链路已完成。 | 优先复用已有头像资产能力，核实Key格式/读取权限/快照显示；Role修改不暗改旧实例。 |
| 计算机实例组 | MachineDetailPanel以ct（ListRowGroup）包成员；SJ AvatarListRow已改为Gk ListRow，头像list-row，标题/副文分层，统一外框和内分隔。Loom仍space-y-2+独立SurfaceListItem Card。 | 整体迁入Group/Row组合，不仅外加一个div边框。保留实例数据与Role跳转，不引入未支持的批量模型操作。 |

## 推荐迁入顺序

1. 锁定这次生产资源作为一个一致版本；检索可复用的官方基础组件源码，明确npm0.6之外的兼容port。
2. 共享桌面排版与正文三档、顶栏原生trigger/响应式测量一起升级。
3. 原生ListRowGroup/AvatarListRow与计算机实例模块；语言和区域/外观控件同步核对。
4. Role资料逐字段编辑和头像接线，保存继续走既有Role Revision，不把官方单Agent可变配置直接套给实例。
5. 仅测本批触及路径：搜索、顶栏缩放、设置、资料、计算机，以及聊天/动态/任务的排版取样；不用全后端或付费模型验收。

本批产品改动仅搜索竞态修复。新版UI是已锁定并查证的待迁入范围，不计作已完成。
