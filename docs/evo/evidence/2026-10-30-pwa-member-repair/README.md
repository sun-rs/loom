# PWA系统栏、Tasks切页、成员头像与官方版本核查

## 结论

这次确认了以前遗漏的官方采用和数据接线，不能只归因于官网更新。
网页标题栏与手机OS状态栏是两块区域；上一批桌面浏览器检查没有证明实体PWA系统栏。
本轮代码、桌面/手机视口、Fullscreen网页规则通过，**实体鸿蒙和iOS系统状态栏仍需复验**。
不声称知道用户的具体WebView/OS版本，也不把WebKit已有同类报告当成用户设备的既定根因。

## 1. 系统状态栏

修前`theme-color`写入`oklch(88.29% .1623 91.9)`，与官方六位hex处理不同。
从固定Web1.21.40资源直接提取原生颜色映射、DOM/canvas转换和按主题/mode缓存闭包，
WorkspaceTheme仍是唯一运行时writer；首屏bootstrap也先写官方light/dark hex。
默认轻色现在为`#FFD440`，暗色为`#0D0D0B`，命名主题由官方解析。

官方这套resolver在1.21.39已经存在；我们之前仅保留CSS token，属于遗漏采用。
新的真实DOM顶边层跨路由保持，Standalone/Fullscreen下仅绘制既有安全顶部，
1px最小边缘，不占布局、接收指针或改变字体/标题高度；加载遮罩也不会使它换白。
这层是明确记录的Loom浏览器适配，不冒称原生iOS实现。

搜索实测：网页搜索顶栏**修前就已经黄色**，不是再改一次标题栏背景即可解决。
[WebKit维护者说明](https://bugs.webkit.org/show_bug.cgi?id=301756#c2)确认浏览器会
根据近视口边缘的fixed/sticky元素延伸底色；另有[SPA导航系统栏回归报告](https://bugs.webkit.org/show_bug.cgi?id=305546)。
因此本轮同时修正meta与独立实际绘制，但不能由桌面WebKit推定用户的OS最终取色。
没有循环重写meta、计时抖动、强制滚动或强制刷新页面。

## 2. Tasks的“整体刷新”

[修前探针](before.json)与[修后Chromium](after.json)、[WebKit](webkit.json)
均在首页→搜索→动态→任务→首页→任务之间只产生**1次document请求**；
document token与Loom shell身份保持。`framenavigated`中的URL变化包含SPA导航，
不能将它们每一条都算作整页重载。按需JS下载仍然允许，不等于重新加载全部资源。

但Task原先确有明显的内容替换：首次模块占位→首个数据读取→内容；退出还会销毁页面，
返回重新初始化并清空。现在全局任务页首次访问后保留其既有有界UI投影，
隐藏时hidden/inert并停止/取消任务读取；返回重新校验数据，但同query的正文不换首屏loader。
工作区或筛选key变化则遮住旧结果，不让其他query的内容泄露。
模块/首个query共用原生TaskLoadingList/Row，取代本地旧SkeletonRow+通用空白loader。
任务写入、权限、因果和分页上限没有另建owner；频道内任务继续沿原有默认生命周期。

修后检查了返回时同一个Tasks DOM、后台读取被挂起时仍保留正文，以及隐藏/inert。
首次真实下载/查询仍有加载状态，不能宣称首次读取零等待或零绘制。
[后台更新截图](tasks-refresh-pending.png)显示内容保留，只有标题的加载提示在更新。

## 3. 添加实例与头像选择

频道设置使用的是官方MemberPicker，但Role→Member投影没有传avatarUrl，所以它依法退回
默认机器人；另一个AddInstanceDialog同样漏传。两条数据入口均已补齐当前Role revision的头像，
成员的既有实例仍使用自己的冻结配置；描述也改读display-only description。
[桌面](candidate-1440.png)和[手机](candidate-390.png)确认512px皮卡丘原图被实际加载。

头像选择原先的40px粉色选择框/flex-wrap是本地实现，当前官方为44px preset、
原生selected/hover/focus、带语义标题的series，以及按容器408px在4/8列间切换。
本轮从官方资源提取原始函数/类字符串，生成JS和声明后消费。
539张owner素材、中文搜索、60项分批和随机策略仍属Loom数据/能力，
不把整个改造后的图库叫作未经修改的官方组件。

## 4. 官方版本与依赖范围

[独立版本及chunk记录](official-version.json)：

| 项目            | 当前事实                                                                              |
| --------------- | ------------------------------------------------------------------------------------- |
| 线上Web         | 1.21.40，a7bb80017084e766d68b8a1d7c6377496a16fbaa，builtAt2026-10-29T17:16:56Z        |
| npm UI          | 最新0.52.2；Loom本轮从0.52.0升级到0.52.2                                              |
| 公开完整源HEAD  | db5e399f017d584e49597e3a28757645d6807893；Loom选取源码同一版本，即Web1.21.23-source.1 |
| 线上vendor/CSS  | 与1.21.39相同的BHAojVZQ／DuvkFUT-，不能将npm最新号当成线上包号                        |
| 本轮Web资源采用 | 固定1.21.40的chrome resolver、preset按钮和grid声明；其他选段保留各自来源              |

0.52.0→0.52.2核对全部包文件后仅3处运行时代码变化，另2处是package/changelog：
PanelAction与PanelSplitAction补足边框后的触摸延伸，Badge按钮使用官方anchor扩展。
[官方发布说明](https://github.com/botiverse/raft-design/releases/tag/v0.52.2)。
已更新双alias、单runtime验证、资源hash锁，特别将三处变化文件纳入锁，未顺便升级其他依赖。
其中Badge在不支持anchor-scope的浏览器沿用上游回退，不宣称所有旧浏览器得到扩展。

1.21.39→40有45个chunk路径变化（记录全部候选，不静默忽略）；hash变化可能来自依赖引用传播，
**没有逐一审查语义，不当作45项外观变化或已完成45项对齐**。
chrome与avatar网格在139已经有，说明我们的既有消费链也有缺漏。
仍不能宣称“官方整站未改动依赖、Loom只接数据”。当前有基础包、旧选定源码、资源移植、
生成展示与Loom页面组合/移动适配五层；要按页面/空态/选中/尺寸/事件逐项核对，不能仅比包号。

## 5. 验证和边界

- [先失败检查](red.txt)、[UI补丁失败记录](ui-patch-red.txt)保留。
  旧bootstrap单测缺少新增真实DOM的querySelector，补齐fixture并增加首屏hex断言；未放宽产品行为。
  transition-probe-red.json记录探针在router提交前读取hidden的时序问题，改为等待真实提交。
- [91项定向检查](checks.txt)、[类型](types.txt)、[构建](build.txt)通过；无全仓/付费CLI测试。
- Chromium/WebKit：手机root切换、模块与数据分别挂起、返回时Task投影保持、隐藏/inert、
  成员候选头像和真实点击点。手机频道控制按钮实际命中范围45px，点靠下区域可打开设置。
- Chromium进入真实网页Fullscreen media后检查持续同一top surface、1px高度、frame颜色和不接收指针；
  WebKit此模式不可用，不把它记成Standalone通过。二者都是桌面引擎，不是鸿蒙/iOS实机。
- [头像资料回环](avatar-browser.txt)：桌面/手机44px preset、容器query列数、选择/保存/刷新、旧Role修订保护。
- [旧保存/拒绝保存与双模式回归](saved-draft-and-mode.json)继续通过。

正式部署另附收据，按既有备份/空闲/平滑重启/只读页面复查要求执行。
