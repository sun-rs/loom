# Raft 响应式 Shell 对齐审计

日期：2026-09-04。范围：RAH OS Web 的桌面/窄屏 Shell、移动根导航、
Room 与 Agent 下钻页、Tasks 默认视图，以及 701–760px 历史断档。

## 1. 来源事实

本轮以冻结的 Raft 生产 bundle
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js` 为源码证据，并以
同尺寸浏览器页面作交叉核对。可直接复核的事实是：

- 移动媒体查询为 `(max-width: 767px)`。
- 移动根导航只有 Home、Tasks、Members、Settings 四项；中文标签为
  `主页 / 任务 / 成员 / 设置`。
- 根导航使用白底、2px 顶边及项目间分隔，选中项为 signal yellow；
  高度不超过 600px 时图标隐藏、操作项压缩到 36px。
- Room、DM、Search、Agent/Human 详情、Computer 与其他下钻页不显示根级
  底栏；根 Home、Tasks、Members、Settings 显示。
- Raft 移动 Tasks 仍默认进入看板，而不是维护一套移动专用列表行为。

这批结论只约束 Shell/导航和可复核的响应式行为，不把 Raft 中央服务的
Computer 离线语义强套到 RAH OS 本机 daemon。

## 2. 修复

- 将本地 700px/760px 冲突断点收敛为 767px，移动时隐藏整个桌面 rail，
  消除 rail 子项在 701–760px 内容区溢出并拦截指针的问题。
- 移动底栏收敛为四个根目的地；Search、Activity、Saved 移入移动 Home。
- 移动 Home 使用黄色标题区和工作区入口；Room 与 Saved 标题改为返回主页，
  Room/Agent 详情隐藏根底栏。
- 新增短窗口桌面 rail 的 50px/36px/48px 几何合同。
- 移动 Tasks 保持看板默认值。
- 修复 Members 关系图与 Agent 详情返回时 URL 路由和可见层不同步的问题；
  关系图属于 Members 根视图并保留底栏，具体 Agent 资料属于下钻层并隐藏。
- 将 Room 各标签页右上角的频道设置入口从会横向扩张的成员按钮样式分离，按
  Raft `Button(size="sm", shape="icon")` 固定为 28×28，内部图标固定为 14px；
  搜索入口复用同一几何协议，移动 Room 仍只保留频道设置入口。
- Room Tasks 工具栏按来源整件换行并自适应高度；新建按钮固定单行，高28px、12px图标，
  视图切换按共享 CSS 的最终14px（不是调用参数12px）显示。390px 下列表与看板均不得重叠。

## 3. 自动门禁

`apps/web/test/responsive-shell-parity-contract.test.ts` 直接读取冻结 Raft bundle
与本地源码，锁定 767px、短窗口 rail 几何、四个根标签、详情显隐和移动 Tasks
默认看板。测试先以 4 项失败建立红灯，再由本轮实现转绿。

`scripts/run-real-browser-gate.mjs` 使用真实 Chromium 做以下检查：

| 视口                               | 验收                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| 800×598、768×598                   | 桌面 rail 可见；宽 50px；按钮高 36px；Tasks 切换按钮实际可点击                 |
| 767×598、760×598、701×598、700×598 | rail 不可见；四项底栏可见；无横向溢出；Tasks 切换按钮未被遮挡                  |
| 1440×900                           | 原有 Room、Task、Agent、Computer、Thread 等桌面链路继续通过                    |
| 1440×900 Room Tasks                | 频道设置按钮实测 28×28，内部设置图标 14×14                                     |
| 390×844                            | Home 四项导航、Room 返回、详情底栏隐藏、关系图根底栏显示、Agent 返回列表均通过 |

最终命令 `npm run test:web:browser` 返回 0，并输出
`RAH_REAL_BROWSER_GATE`，实际 viewport 为 390×844。门禁使用隔离临时
`RAH_HOME`、随机端口与 fake provider，没有访问付费 Provider，也没有改动
用户正式数据库。

## 4. 边界与剩余项

本审计证明的是响应式 Shell 协议和关键交互链路，不等价于“全页面零像素差”。
Raft 通知权限导致的横幅差异，以及第三方审计中的文案、相对时间、关系图
孤立节点等属于后续独立合同，不能混入本轮断点修复后宣称已经完成。

## 5. 同日 Firefox 全链路复核补充

- Computer 移动详情隐藏根导航，但返回 Computer 列表后必须恢复根导航。通过
  `computerDetailOpen` 显式追踪下钻状态；列表选择和返回由既有 Computer pane 通知 Shell，
  不为移动端另建业务状态。Firefox 门禁覆盖这两个方向。
- 隐藏整个桌面 rail 不能同时移除空间切换能力。Raft frozen bundle 约 `2779369`
  的 `mobile-server-switcher-menu` 使用 Home 标题的名称/chevron 触发同一个菜单，左右各 8px，
  选择后 `replace-with-home`。本地改为共享 `WorkspaceIdentity` mobile 入口；390px 下实测
  菜单宽 374px、无溢出，Escape 返回 trigger。
- Chrome 全业务、Firefox 全工作台与 Chrome 持久重启门禁均再次通过。旧脚本中“Room 详情仍应显示
  mobile nav”和“整个 rail 隐藏后仍从 rail 点击 Workspace”被更新为已提取的上游合同，
  未放宽真实点击、状态和几何断言。
- 正式截图人工检查发现 Home 图标引用了未打包的 `home` symbol。冻结 bundle 的 `y3e/x3e`
  （约 `1834029`）与移动底栏（约 `3350695`）证明应使用 Lucide `house` 两条 path；几何逐字移入
  共享 sprite，补 `home → house` 映射。新增先失败的源合同测试及 Firefox 四个导航 SVG 的非零
  `getBBox()` 断言，避免“按钮存在但图标空白”再次通过 DOM 验收。

完整证据与正式发布状态见
[附件投影与移动回归审计](./2026-09-04-forwarded-attachment-projection-verification.zh-CN.md)。

后续 Task 工具栏与标题设置按钮的全门禁、正式更新和截图证据，以
[Task 审计的9月4日补充验收](./2026-09-03-raft-task-workflow-parity-verification.zh-CN.md)为准；
本次正式页 Chrome/Firefox 桌面和390×844均验证了28/14px几何与不重叠，不外推为全模块像素差分。
