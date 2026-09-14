# 成员资料入口：聊天侧栏与成员整页

## 边界与依据

用户明确要求：聊天 Room 中头像打开右侧资料，保留聊天正文；成员页点击 Human、Agent 或 Human 创建的 Agent，都在成员主内容区切换，不能并列两套资料。

Raft 当前 Web `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA-256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`：路由 `human/:userId` → `Pmt` → `$ue` → `HumanDetailPanel`（wmt）；`agent/:agentId` → `jmt`。Human 主路由独立加载授权资料并直接呈现主内容，不把成员点击本身等同于叠加一个聊天侧栏。

分析副本 `/Users/sun/Code/reviews/rah_os/2026-09-13-member-entry/index-MqTUR4Ez.js` 仅供分析，保留发布物来源，不作为生产依赖。本次遵从用户指定边界，复用本地已有资料组件和路由；不是复制上游路由实现。

## 根因与修复

`App.agentDetailProps` 无差别传入 `onPeekHuman` / `onPeekAgent`，`AgentDirectoryPane.selectHuman` 因而提前返回，绕开现有 `memberView/humanId/onRouteChange`。Human 的已创建 Agent 卡片也绕过成员页内切换。`peekOpen` 又允许成员 surface 呈现叠加侧栏。

- 成员详情组件自己的选择入口统一走 `selectHuman` / `selectAgent`；去掉用于重定向到侧栏的可选回调。
- App 的侧栏容器只在 Room surface 呈现。
- 头像共享上下文按当前 surface 分流：聊天保持 peek，非聊天走已有成员资料路由。Agent 继续使用 navigation.resolve，Human 继续通过 HumanProfilePane 的授权查询读取；不新增权限或业务处理路径。
- 聊天侧栏中从 Human 切到其 Agent，复用同一个侧栏组件；成员页则复用同一个主内容组件。

## 验证

`scripts/test-member-profile-entry-browser.mjs`：修复前点击成员 Human 后预期侧栏0、实际1，失败日志 `/tmp/member-entry-red.log`。

Chrome / Firefox，1440×900和390×844：成员 Human 铺满主内容、无第二面板，地址正确，刷新/浏览器后退恢复；点击 Human 创建的 Agent 替换同一主内容；聊天 Human→Agent 只保持一个侧栏，URL与未发送草稿不变。日志 `/tmp/member-entry-{chrome,firefox}-final.log`。`test-human-avatar-preview-browser.mjs` 的头像 hover、移出、Escape和聊天点击侧栏回归也通过（`/tmp/member-entry-avatar-regression.log`）。

旧 `test-member-ui-details-browser.mjs` 错误要求成员页产生 Human 侧栏，已改成整页资料断言。早期审计对此的措辞不能继续作为当前验收标准。

## 正式检查与部署

共享标题的 container 声明从 `agent-directory.css` 移至共享 `panel-layout.css`，避免违反 PanelHeader 的单一所有权；不改变响应式行为。标题 480/481 边界与菜单交互浏览器回归通过。

`npm run check` 中类型、UI 组件与注册表检查通过；主测试 1559 通过、17 跳过、1 失败。唯一失败是并行测试占用了固定的 `agent-task-split-host`（`DaemonAlreadyRunningError`），该用例单独复跑通过；未改该测试或后端实现。因此不声明整次 check 全绿。后续 Web 单元 407、parity regression 34、formal-browser-policy 13、bilateral-captures 3 均单独通过。format:check、git diff --check、正式 Web 构建通过。

正式构建 `c5f4b489a032d8e5935569f962eee274f88f6f9dfe3935f622720f06887e9cc1`：经过空闲检查与持久状态备份后正常重启；备份 `pre-restart-3b9b9cc7-46c9-4811-950a-6a61ee6f738f`。正式 Chrome 页面在 1440×900 和 390×844 验证成员 Human/Agent 主详情、聊天室 Human 侧栏、草稿保留，均通过；未发送消息或修改 Agent 配置。日志 `/tmp/member-entry-formal.log`、`/tmp/member-entry-restart.log`。

期间另一操作将服务再次重启到同一构建，正式验证以重新连接后的页面构建标识为准。以上是本地正式浏览器验收与 Raft 源码对照，不是本轮 Raft 线上双边指针复验。未提交或推送。
