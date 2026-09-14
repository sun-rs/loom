# 聊天任务标识复用任务详情弹窗

## 来源与边界

Raft release/v1.12.0 的 `index-BVfbaScj` 中 `db({presentation:"modal"}) / t9` 与 `TaskModalHead-CFi1iRLr.js` 是既有任务弹窗的来源。后者 SHA256：`f2cd06a95372e9a894f0311d3343ce78195fcead4dd84e396fe272da8daecece`，本地授权分析证据位于 `2026-09-08-frontend-repair/task-detail`。发布 bundle 仅用于分析；本次不复制发布代码，不新增第三方依赖，沿用已有结构化移植和许可证记录。用户本次截图确认任务标题、历史、状态、负责人、创建人及同一 Thread 回复的组合。

## 根因与修改

聊天 `message-task-badge` 错接普通 `openThreadFromMessage`，而 `globalTaskDetailFromSearch` 和 App 仅在全局 Tasks surface 打开已有任务弹窗。因而任务入口没有执行 canonical `task.get`，只依赖当前 Room 页里的 Thread 投影，表现为普通或空消息列。

标识现在发出 typed task NavigationTarget，经既有服务端 navigation.resolve 验证后打开共享 TaskThreadPresentation / TaskDetailMetadata。频道背景保留；刷新恢复同一任务，关闭清除任务选择而保留 Room。普通回复入口仍是右侧消息列。正文 task 引用也使用相同目标协议。

Task、负责人、历史及 Thread 回复分别继续由既有 Kernel 和客户端同步 owner 管理，不新增任务状态或讨论记录。状态与负责人控件复用现有真实命令、权限、错误和并发处理。原任务弹窗的尺寸、下拉菜单、键盘焦点和关闭协议保持共用。

## 验证

先加入聊天深链单测和聊天标识浏览器回归：旧实现分别无法解析任务选择、无法出现任务弹窗，确认失败后修改。扩展 `run-global-task-detail-browser-gate.mjs` 覆盖聊天打开、刷新、关闭、真实临时数据库回复持久化；原门禁继续验证状态与负责人修改、历史、错误重试、迟到响应、返回/前进及嵌套 Escape。浏览器使用隔离 Fake CLI，未向正式频道发送消息，未运行付费模型。

Chrome、Firefox 的 1440px 和 390px 浏览器门禁通过；`npm run check`、`npm run format:check`、`git diff --check` 及 `npm run build:web:workbench` 通过。正式服务通过空闲检查、持久状态备份后安全重启，冻结 Web 构建为 `7fa3e7df41040243fc514576e57ff292d5892819519f7b812d9755e2d3e63561`。本机、局域网、Tailnet 地址的新 Chromium 页面均验证现有任务标识打开详情、刷新恢复及关闭返回频道；正式环境仅执行读取与导航。已检查截图，不宣称 iOS 实机或 Raft 在线双边验收。

## 保留的后端差异

Kernel 的 assign/unassign 仅支持未认领待办，强制 reassign 仅支持 claimed/in_progress 且由创建者操作，并等待旧执行停止证明。待确认和终态负责人只读；候选负责人仅包含 Agent，不包括 Human。此次修复入口、复用现有操作，没有放宽这些执行与审阅边界，因此不宣称截图所有状态下自由改派或 Human 负责人已实现。
