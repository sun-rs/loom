# Web 1.21.39 侧栏对齐与 Kimi 快速模式

本批固定目标为 Web **1.21.39 / 5a4264c**，UI包保持 **0.52.0**。
原始 TSX 依赖仍是 **db5e399 / 1.21.23**，本次不是整套官网源码升级。
先前[审计及资源身份](../2026-10-30-web139-audit/README.md)保留原结论与候选SHA。

## 实现与来源

- Role、频道、Computer 列表改用包原生 SidebarSection/List/Item 组合。
  撤下运行中的 Web138 Role 水平覆盖，移除重复 Computer padding、额外 Frame 顶距和
  DnD 分区 margin；列表自己提供 py-2/gap-0.5，原生伪元素负责选中/hover 框。
- 原样提取官网 Computer 分组按钮表达式、K5 cell-state 函数、P5 空分区说明函数。
  新来源锁在 `upstream/published-2026-10-30-sidebar`，经 `generate-sidebar139.mjs`
  校验并生成；Loom 只接身份、数量、折叠回调和原有排序写入。原件和旧来源未修改。
- 设置共用滚动框，追查后发现其列表也缺少新版间隔；因此同时接入官网 Q4e 原始声明。
  接线只绑定原生组件、中文字符串与既有页面动作；不接云反馈和外部目的地通知能力。
- 频道行改回原生 ChannelIcon/Content/Title/tone，收藏入口使用原生 Icon/List；
  频道和独立单聊菜单打开时使用原生 inset 伪元素，移除整行背景覆盖。
- 全局/手机任务入口及任务空态统一 ListTodo。`task-icon.json`对照官方实际SVG元数据，
  五个形状、坐标、viewBox和描边与本地实际渲染一致，未另画图标。
- Kimi K3.1 Pro 标准/Highspeed 目录合为一个展示模型，复用官方 Boolean 快速模式控件，
  effort 独立。保存仍是两个真实 binding，serviceTier 始终 default；打开旧 Highspeed 配置
  显示勾选且不产生脏稿。不改任何既有 Role Revision、实例冻结快照或 CLI 全局配置。
  只合并已核实的 K3.1 Pro 成对目录；缺项或 effort 不一致则保持精确选项。
  K2.8 Preview / K2.7 Code Highspeed 不合并，无付费模型执行。

## 几何复测

1440×1000、DPR1、默认缩放、浅色、中文；真实临时Core/Fake目录，无正式数据写入。
官网目标来自锁定的源码组合与4px spacing，而不是猜测截图；下列修后值在
**Chromium 和 Firefox 两个浏览器**均实际得到相同结果。

| 项目                               |   修前 | 修后／官方目标 |
| ---------------------------------- | -----: | -------------: |
| Role头像左距                       | 17.5px |           20px |
| Role分组标题／Computer分组内容左距 |   16px |           20px |
| Role相邻行间距                     |    0px |            2px |
| Role Computer分组到首行            |    2px |            8px |
| 频道标题框底部到首行               |    0px |            8px |
| 频道相邻行                         |    0px |            2px |
| 最后置顶行到下一分组标题框         |   12px |            8px |
| 最后置顶行到下一分组标题内容       |   28px |           24px |
| Computer内容左距                   |   28px |           20px |
| Computer hover左距                 |   16px |            8px |
| Computer标题框底部到首行           |    0px |            8px |
| Role／频道行高                     |   38px |   38px（保留） |
| 频道hover左距                      |    8px |    8px（保留） |

另测设置相邻行2px；hover与菜单只涂 inset frame、不涂整行；Role组的鼠标折叠和
Enter展开、频道独立折叠、拖动排序后刷新持久化通过。截图见roles/channels/computers/settings.png，
Firefox另存firefox-roles.png。它们是临时数据的实际页面截图，**不是官网同内容整页像素差分**；
随机头像内容不同，不据此报告图片相似率。

## 验证范围

先运行新增六项断言全失败；实际浏览器以17.5≠20失败；Kimi分组断言也先失败，之后实现。
设置侧栏新增断言先失败，再接入原声明。完整失败输出保留，不把失败改写为通过。

- 83项定向检查通过：受影响的来源完整性、生成一致性、单UI运行时、侧栏排序/分组、
  原生表单、Kimi/AGY精确binding映射、设置、图标、UI合同与构建后自适应CSS。
- Loom类型检查、产品构建通过。既有大于500kB的chunk提示保留，本次不额外重做加载架构。
- Chromium与Firefox：上述桌面几何、hover/menu、折叠/键盘、拖动持久化、设置列表。
- Chromium 1440×1000及390×844触屏：角色/已删除分组折叠与刷新保持、两个28px按钮热区、
  20px行内容左距；AGY模型/effort保存回环，Kimi普通→快速/max→重开→普通/max精确保存，
  重开未编辑时提交禁用，设置入口可见。手机原生紧凑例外未移除，kimi-mobile.png可阅。
- 频道菜单同两种视口：创建、移动、静音、手动未读、未知结果不重复写入、归档/恢复与
  活跃工作拒绝归档通过。旧脚本把“名称 *”当作精确“名称”而超时；修复为名称文本框的
  正确可访问名称查询，保留失败，未改产品或放宽业务断言。

复测：

```sh
LOOM_BROWSER_SLICE=sidebar-pixel-audit LOOM_PIXEL_AUDIT_EXPECT=139 node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_ENGINE=firefox LOOM_BROWSER_SLICE=sidebar-pixel-audit LOOM_PIXEL_AUDIT_EXPECT=139 node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_SLICE=runtime-sidebar node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_SLICE=sidebar-actions node scripts/official-web/channel-browser.mjs
```

不宣称全站每页/每个variant最新一致、官网真实业务同状态截图差分、实体手机验收或新模型性能验收。
后端schema、通知网络与执行机制均未改动；正式部署与实际页面收据在本目录单独记录。

终端日志仅规范行尾空白；失败内容与结果保留，原始运行文本另存于本机临时目录。

## 正式部署

产品提交 `b31cd7eb` 已先推送，再以干净工作区构建、冻结静态快照并部署。
现有服务经运行围栏检查、SQLite/文件备份与迁移预演后平滑替换；schema91不变，
账本、消息、Role/修订/实例、收藏、关注、未读及偏好逐表校验保持。
本地通知/记忆文件和网络配置保留，LAN/Tailnet使用原CA校验证书与新首页字节。

正式Core的1440及390浏览器页面确认新buildId、六个现有Role的20px左距、设置行间2px；
实际Kimi目录显示5个模型选项，K3.1 Pro只有一个，快速开关可见，打开原配置提交禁用。
频道/计算机入口与空态正常；无页面异常、配置保存或付费生成。
两个视口分别存在1次正常读取确认，保护表验收后仍与部署收据相同。
详见deployment.json与formal-page.json，不以单独健康检查代替页面验收。

正式探针初版误把所有HTTP POST当作写操作；本项目查询也使用POST，因此触发了
工具断言而非产品故障。修正为逐项核实的查询路径和正常读取确认白名单，未知写入仍失败，
并独立核对保护表指纹；保留formal-probe-red.txt，不根据HTTP方法推断业务写入。
