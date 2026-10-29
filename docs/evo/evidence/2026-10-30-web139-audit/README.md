# Web 1.21.39 像素差异与 Kimi Highspeed 语义审计

本批是**分析／测量，不是已上线的1.21.39适配**。未修改产品前端、模型映射或后台；
正式服务仍是01987e8a对应的产品版本。新增工具只在临时Core/Fake CLI目录运行，未调用付费生成。

## 1. 版本事实

2026-10-30重新读取官网index.html，其发布身份为：

- Web **1.21.39**，commit `5a4264c05bf9d8e166849d8b444a1d63f1a665e9`。
- builtAt `2026-10-29T16:30:57Z`（北京时间10月30日00:30:57）。
- app-shell `CMYocQVA`，vendor UI `BHAojVZQ`，CSS `DuvkFUT-`；URL/SHA/字节数在candidate.json。
- Loom采用的Web资源为1.21.38，原始选取TSX仍为1.21.23/db5e399，npm为0.52.0。
- npm0.52的sidebarItem、Section、List、Header、Disclosure、Control、Root七项选取配方，
  展开本地引用后与官网1.21.39逐字符串相同，无未解析引用。见recipe-comparison.json。
  这是选取基础配方相同，不是所有组件、variant、调用参数或全站页面自动通过。

1.21.38确实使用旧Sidebar配方；上一批17.5px是该版的8px外层+8px padding+1.5px实体边框。
1.21.39改成新list-cell的8+12=20px，hover/选中边框改为伪元素，不占内容宽度。
因此上一版局部几何兼容层现在会与新版基础包冲突。
另外，上一批仅校正横向而没有完整移植原生SidebarList等容器，纵向差异并非全由新发布造成。

## 2. 像素差异表

Loom列为1440×1000、DPR1、zoom1的真实临时Core Chromium实测。
官网列是1.21.39完整包裹／配方的源码值及4px spacing换算；不是官网整页截图逐像素diff。
选择了有置顶、有频道、两个Role及一个Computer的状态；没有修改正式数据。

| 项目（相对各自侧栏左边界）            | Loom 当前实测 | 官网1.21.39                      |
| ------------------------------------- | ------------- | -------------------------------- |
| Role头像左距                          | 17.5px        | 20px                             |
| Role分组标题内容起点                  | 16px          | 20px                             |
| Role的Computer分组内容起点            | 16px          | 20px（mx-2 + px-3）              |
| Role相邻行间距                        | 0px           | 2px（gap-0.5）                   |
| Role Computer分组按钮到首行           | 2px           | 8px（SidebarList顶部py-2）       |
| 普通Role／频道行高                    | 38px          | 38px：这一项一致，不应整体缩放   |
| 聊天频道hover左距                     | 8px           | 8px：这一项一致                  |
| 聊天标题框底部到首行hover顶部         | 0px           | 8px（列表py-2）                  |
| 聊天相邻频道行间距                    | 0px           | 2px                              |
| 最后置顶行底部→下个频道标题框顶部     | 12px          | 8px                              |
| 最后置顶行底部→下个频道标题内容区顶部 | 28px          | 24px（8px列表底部+16px标题顶部） |
| Computer标题内容／图标左距            | 28px          | 20px                             |
| Computer hover左距                    | 16px          | 8px                              |
| Computer标题框底部到首行hover顶部     | 0px           | 8px                              |

根因位置：

1. RoleWorkspace仍使用`OfficialRoleSidebarGeometry`的1.21.38局部参数，
   以及旧`OfficialComputerGroup`的px-2、mb-0.5；没有原生SidebarList间隔。
2. ChannelSidebar直接map DragRow，没有原生新列表的gap/py；SidebarDrag的DragSection
   固定mb-3=12px，而官网B5容器没有这个margin，z5列表自身gap-0.5/py-2。
3. ComputersPage外层px-2叠加0.52原生内容20px，形成28px；row hover伪元素也被推到16px。
4. ChatSidebarFrame仍额外pt-2；官网最新主列表scrollbar容器只有pb-2，
   各页头部由原生header/list自己排。首屏起始位置也需要随整体组合重新核对。
5. 旧生成行的`SIDEBAR_ROW_PHONE_CLASS`仍有8.5px等旧Web参数；手机另有owner批准的
   iOS密度覆盖。桌面Web基线和移动App例外必须分别验收，不能全局缩放或一并抹掉。

## 3. 任务图标

1.21.39全局及移动导航的任务图标是ListTodo。可追溯：app-shell的On导入startup的mo，
mo导出LD，LD由元数据ID生成，`ID.name === "list-todo"`。
1.21.38对应Ce→Ka→PE→NE，也是list-todo；因此它是**此前遗漏，不是这次才新增**。
Loom Navigation仍为CheckSquare（别名square-check-big）；ChannelTabs已使用ListTodo。
这说明仅升级组件或检查聊天语义图标，没有覆盖同一语义的全局入口／空态等全部调用点。

## 4. Kimi Highspeed：界面模式与原生模型ID分层

[官方模型文档](https://www.kimi.com/code/docs/en/kimi-code/models.html)明确：
K3.1 Pro Highspeed与标准K3.1 Pro能力相同，约2–3倍速度，约2倍额度消耗；
但官方接口及CLI通过两个模型ID选择。当前CLI目录两者均支持low/high/max，
现有Loom绑定都仅发布`serviceTier:default`，没有Codex那种priority参数。
所以底层保留`k3.1-pro-highspeed`**本身正确**，但用户界面可合并为：

- 模型：K3.1 Pro。
- 推理强度：low/high/max。
- 快速模式：明确勾选后选择真实highspeed binding，取消后选择真实标准binding。

应沿用AGY的展示选择→精确binding映射，复用官方Boolean/Fast控件。
不把UI选项伪装成Kimi原生支持的`serviceTier:fast`，不改现有Revision或已运行实例。
已有highspeed配置打开时应显示勾选，仍无脏稿；保存/重开/切effort须保持对应真实ID。
只在当前目录确实存在两枚已核实binding时提供可切换选项，缺项不硬编码。

**不能泛化合并所有-highspeed后缀。** 官方当前将`kimi-for-coding`定义为K2.8 Preview，
而`kimi-for-coding-highspeed`是K2.7 Code Highspeed，不是同一模型的普通／快速组合。
额度消耗和会员可用性也应保持真实文案，不能仅凭CLI名字推出Fast能力。

## 5. 后续顺序与可声明范围

1. 固定1.21.39作为这批目标，比较官网实际vendor与npm；不把npm最新号当生产Web版本。
2. 三页侧栏一起使用原生Header/List/Row完整组合：撤下1.21.38横向兼容，
   移除重复包裹，替换旧group组件，补正确列表容器和拖动容器；保留Loom数据/菜单/执行围栏。
3. 同一批对齐ListTodo语义入口，检查空／默认／选中／hover／折叠和滚动条状态。
4. K3.1 Pro双binding映射为UI Fast选择；测试普通/快速/effort往返、旧配置和缺目录情况。
5. 用固定viewport/DPR/缩放/字体/主题构造官方参考与Loom同内容状态，比较几何与截图。
   本批只完成Loom几何实测与原始源码对比，尚不能宣称最终全页面像素一致。

两个新增工具只用于源码比对和临时浏览器测量；有意输出差异，不把不同值自动当作通过。
复测命令及源文件见同目录evidence。**本次没有移动生产依赖pin，也没有重启服务。**
