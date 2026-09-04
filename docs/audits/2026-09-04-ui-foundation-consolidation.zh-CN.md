# UI 收敛：A / B1 与 B2 首段实施证据

本报告记录 2026-09-04 本批证据，不是全站双边一致证书。当前登记始终以
[机器登记](../product/ui-behavior-registry.json) 和其生成索引为准；顺序见
[收口计划](../architecture/ui-consolidation-plan.zh-CN.md)。本次为实施者自审，
不冒充独立第三方审计。

## B2 首段追加证据（2026-09-04）

范围只含 Room / Agent / Thread 标题，以及 Room / Agent Tabs。未重写业务系统，
没有改变 Kernel、SDK、权限判断、消息、调度或记忆策略；依旧是原页面把选中值、
capability 与回调传入共享展示组件。

### 来源与迁移

- 冻结官方 `index-BoAC7nSE.js` 的 CI Panel slots：
  `flex h-(--shell-header-height,62px) shrink-0 items-center gap-2`、brutal
  `gap-3 border-b-2 border-black bg-white px-5`、矮屏48px、Tabs底边2px。
  提取的是展示合同，不是完整官方 React；本地依旧消费现有生成 token。
- 新 `PanelHeader` / `panel-layout.css` 统一三种标题的几何。旧 reference CSS 保持
  冻结，但已迁移生产组件不再使用 `.channel-head`、`.thread-head`、`.tabs`，
  避免继续以覆盖链控制高度。删除 product / Agent / Chat 页对应重复规则。
- Thread 菜单和关闭按钮加入既有 `PanelHeaderAction`，保留 ref、弹层与焦点返回。
- `PanelTabs` 合并两份键盘逻辑；参考官方 TabList 的 Home/End、loopFocus、
  disabledIndices。自动激活沿用 RAH 既有 Agent 语义；横向滚动仅作用自身容器，
  不使用会连带滚动聊天的 scrollIntoView。能力失效不擅自变更页面选择。
- Agent 76px 移动端标题及各标签宽度保留既有参考组合，本批不宣称这些值是
  新提取的官方原始 CSS。Settings / Computer / 全局发现标题尚未迁移。

### TDD 与检查结果

先复现两条明确失败，再施工：

1. Room 在 Task 不可用时按右方向键，Files仍未选中（`false !== true`）。
2. 598px高窗口中，Agent标题仍62px而Room为48px（`62 !== 48`）。

修复后新增矩阵检查：单一键盘停靠点、首尾循环、跳过禁用项、两组独立、空/全禁用、
窄侧栏末尾MCP可见且命中，28px标签轨道+2px底边。整页使用现有真实
Kernel/daemon的临时fake-provider环境，覆盖11组viewport、Room→DM→Inspector、
边框基线、关闭按钮命中、移动端满屏和实际Files读取回调。没有向正式Room灌入fixture。

| 门禁                           | 结果                                                               |
| ------------------------------ | ------------------------------------------------------------------ |
| `npm run check`                | 864 package tests：862通过、2个既有opt-in跳过；278 Web、34回归通过 |
| `npm run test:web:foundations` | Chrome152 / Firefox150，每个6场景，共12/12通过；含完整应用布局     |
| `npm run test:web:firefox`     | 持久化隔离工作台桌面/390×844通过                                   |
| `npm run test:web:browser`     | 首次关系图浮窗Escape超时；未修改断言，重跑完整流程通过             |
| `npm run build:web:workbench`  | 通过，已有大chunk警告仍在                                          |
| format / diff                  | 通过                                                               |

首次Chrome关系图失败不能撤回：该控件未在本批修改，单次重跑不能证明它不存在竞态。
`PreviewCard`的DOM显示与effect监听注册时序是待验证线索，不是已证实根因；列入B3
浮层优先复查，不称为已修复。测试脚手架还修正了两处自身问题：fixture启动公告
未到便解析；在canonical projection首次水合期间就读取临时header。后者改为等待
真实composer可用与header可见，并未放宽几何预期。

本批矩阵回执目录：
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-V6USTf/`。
登记摘要 `f836b6ef7b6f7807c5efe35de781b01abb6cd98f7c21d6bd230b63815d12e191`。
78条登记中新增UI003/UI004仅表示上述限定迁移，不是78项功能完成率。

### 正式发布

确认30个Activation completed、30个RunAttempt exited、30个runtime process terminated、
placement/独占lease均released后，私有备份到
`/Users/sun/.rah/backups/pre-ui-b2-20260904-nGPHZY`。两库quick_check/foreign_key_check
通过。旧PID24802收到SIGTERM正常退出，确认端口释放后启动新PID47779。
冻结Web build为 `61ad63476ca4602f32f8f14c9d3f7881e9400f959017783b2a878679a1089170`。

正式地址仍是 `http://127.0.0.1:4173`。新Chrome/Firefox实际打开已有消息的Agent
动态、Room与Agent键盘切页、1440×1000/1440×598/1024×598/390×844测量、关闭面板、
打开关闭频道设置、刷新后检查build，均通过且无console/page错误；截图已查看。
回执在 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-b2-formal-BilGK6/`。
Room仍6个、Message仍40条、Activation仍30个；备份中5个MEMORY.md/notes正文文件
逐字节核对未变。没有调用付费模型。以上是本地真浏览器与部署验收，不是本轮官网双边实测。

新代码尚未额外commit/push；改造前里程碑仍为22086e2。后续继续B2其余页面标题，
再B3浮层/表单/空态/工具栏；不能宣称完整Shell或全站与Raft完全一致。

---

以下是此前A/B1时点证据，保留历史含义，不覆盖上方B2追加结果。

## 已交付范围

- 首先提交原工作树里程碑 `22086e2b9767343984bb0b5f4d4725240ac09d20`：
  138 文件，包含此前尚未提交的转发、Files、Task、响应式修复；提交前 check、
  format、diff 通过，提交后工作树为空。没有 push。本批新重构在该里程碑之后，
  未擅自追加提交。
- 74 个旧 intent 保留 ID、范围及旧声明，明确标作历史；新增 2 个基础层登记。
  只有 B034、B041、UI001、UI002 声明了本批限定迁移范围，不宣称 76 项完成。
  来源区分官方原样、提取移植、参考重建、本地适配；`raft-ui` 不再被称为官方源码。
- 机器门禁检查来源哈希、原样产物字节相等、提取片段存在、ID/owner/场景、旧意图
  覆盖及 Markdown 生成一致性。旧审计不自动提升为当前 `verified`。
- 三个分隔手柄共用 `PanelResizer`；宽度策略、min/max、存储键和各 hook 未重写。
  原三份组件合计 249 行缩为 70 行策略接线，事件循环集中在 91 行的公共组件。
- Room 和 Agent 标题栏按钮复用 `PanelHeaderAction`，28px 按钮/14px SVG；继续使用
  已有 `sq-btn`、`interaction-state.css` 的颜色/阴影/状态协议，不再复制状态样式。
- 原页面 CSS 删除 85 行重复规则，公共 `panel-foundations.css` 只接收迁移过的几何。
  `product-styles.ts` 是生产和新矩阵的唯一样式装配入口，不增加另一份测试主题。
- 本批没有改 Kernel、协议、typed SDK、授权、调度、模型提示词或记忆系统。

## TDD 与复核发现

1. 来源登记测试先因实现缺失失败，再通过实现及负例：摘要漂移、伪官方分类、错误
   提取定位、owner 缺失、重复 ID、遗漏旧 intent、未知场景、伪造通过状态、路径越界。
2. Chrome 实际拖动先复现聊天边栏丢失 capture 后少一次提交（`2 !== 3`）。合并
   owner 后，pointerup/cancel/lostcapture 共用结束逻辑，先清除 origin 再释放 capture，
   提交最终宽度且只提交一次。
3. 自审发现共享伪元素会给 Thread 叠加一条旧实现没有的 hover 线。新增失败断言
   （预期透明、实际 `rgb(20,17,17)`），再以显式 `highlight={false}` 保留其已有
   divider；不靠另一个页面 CSS 覆盖修补，也未改变键盘焦点线。
4. Firefox 的程序 focus 不等于键盘 focus-visible。矩阵改用真实 Tab / Shift+Tab /
   Space，而不是放宽断言或把浏览器差异当产品缺陷。
5. 正式实例持续轮询时 `networkidle` 曾超时；正式核验改为 DOMContentLoaded 后等待
   实际控件及字体就绪。该超时没有算作通过，也没有通过关闭业务轮询来让测试通过。

## 可复跑验证

| 门禁                                       | 本批结果 / 边界                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `npm run check`                            | 864 package tests：862 通过、2 个既有 opt-in 跳过；277 Web tests 全通过；34 回归测试全通过 |
| `npm run format:check`、`git diff --check` | 通过                                                                                       |
| `npm run test:web:foundations`             | Chrome 152.0.7977.77 / Firefox 150.0.2；每种浏览器 3 个登记场景实际执行，6/6 通过          |
| `npm run test:web:browser`                 | 隔离真实 Chrome 完整应用门禁通过，含 390×844                                               |
| `npm run test:web:firefox`                 | 持久化隔离工作台，1440×1000 / 390×844，通过                                                |
| `npm run build:web:workbench`              | 通过；已有大 chunk 警告仍存在，不称为已优化                                                |

新增矩阵覆盖：hover/press/键盘焦点/native disabled/loading/权限不足、三种宽度边界与
左右方向、capture 丢失/取消、长名称、空数据、inspector 打开，以及
390、700/701、767/768、1023/1024、1279/1280、1440 宽度（390×844，其余矮屏598）。
这些是迁移组件及其宿主组合，不是所有页面/所有状态的穷举。

机器回执目录：
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-htTLk0/`。
回执记录登记摘要、源文件摘要、浏览器版本和逐场景结果；测试结束校验源文件未漂移，
且所有登记场景确实执行。截图已人工查看。临时截图会随系统清理，重复验收应重跑
上述命令，不依赖永久堆积截图。

## 正式部署核验

开始发布时旧 4173 已无监听进程；检查无活动 Activation/RunAttempt 后，使用私有目录
`/Users/sun/.rah/backups/pre-ui-foundations-20260904-sUE0mZ` 保存 SQLite backup、配置、
令牌、附件与 Agent 私有文件。备份 quick_check / foreign_key_check 通过。
最终冻结前的临时构建已用 SIGTERM 正常退出（不是强杀），最终实例 PID `24802`。

最终 Web build：`5285be0327b874dff5e27f881974221c72ac4840bbb1e72c9ecdab13fc4b5aa0`。
正式地址 `http://127.0.0.1:4173`；新 Chrome / Firefox 页面读取的 build 与产物一致。
实际点开 Agent 动态 inspector、用键盘改变/还原宽度、关闭侧栏、390×844 打开/关闭
频道设置并刷新；28px/14px 几何断言通过，无浏览器脚本/控制台错误。

正式截图/回执目录：
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-final-formal-3wCBVf/`。
只读业务核验，没有发送消息、启动付费模型或执行破坏性动作。
库中仍为 6 Rooms / 40 Messages / 4 Agents / 1 Task；35 个 Agent memory 文件与备份
逐一相同，完整性检查通过。内存文件摘要比对只用于本次发布核验，不加入运行时流程。

## 审计结论与下一批

本批已形成可执行的来源/组件门禁，并删除对应重复实现；没有重写业务系统。
但不能声称共享 UI 已全部收口，也不能声称所有页面等同 Raft 官网。

1. B2：统一完整 Shell、标题区域、Tabs 与组合布局；继续迁移 Thread/Computer/Settings
   标题控件。本批公共按钮并没有解决所有页面整体高度、信息密度或导航布局问题。
2. B3：复用既有 overlay owner，逐族迁移浮层、表单、空态、工具栏和其余按钮。
3. C：逐页把历史声明升级为有当前 owner/测试证据的登记，再补功能；数据只走原 typed
   SDK/canonical owner，不能导入参考项目 mock 状态机。
4. 本轮没有重新登录官网逐页做在线双边操作；来源是冻结官方发布物与既有合同。
   状态矩阵是本地真实浏览器证据，不自动等于官网最新版本一致或全站验收。
