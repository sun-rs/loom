# 任务弹窗与消息操作条（2026-09-15）

## 范围与来源

本批次按用户新决定覆盖此前频道任务卡片打开消息列、创建入口仅加号的表现。
单一呈现 owner 为 App 的 typed navigation、TaskThreadPresentation、TaskCreateDialog
和共用 MessageItem；不新增任务、回复、审批业务路径。

Raft 授权参考：`https://app.raft.build`，vendor manifest build
`666bab60d8658d9e382e2c286ce1e423231e8f31`，`index-WTraJnrd.js`：

- `Xtt -> Gf`：标题数组、再加一条、取消/创建；`max-w-md`（448px）、`p-6`（24px）、标题下 `mb-4`（16px）。
- `mu` brutal message toolbar：`size-6` 按钮、13px 图标、`text-black/50`，hover/focus/popup 显示，默认 opacity 0。
- 既有 TaskThreadPresentation 的 `db/t9` 来源仍见原任务详情记录；本批次统一 Room task card 与全局 Task target 的入口。

这是参数/结构移植及 RAH glue，不是字节复制；原始发布 bundle 仅作分析证据，
维护代码不依赖 sibling。沿用既有 Raft 授权/provenance，不新增分发第三方原始源码。
对照 Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/modals/create-issue-dialog.tsx`：单一 Dialog 外壳保留，内层切换手工/Agent 创建。
RAH 已有同类 Dialog owner，本次标题创建无需引入其 draft/mode store 或 Agent 创建流程。

## 当前规则

- 频道任务工具栏显示「＋新建」，使用与筛选器同规格的 2px 边框，没有硬阴影；PWA 保持单行。
- 创建为居中、有限宽高的标题弹窗，PWA 也不全屏；周围遮罩变暗。保留多标题与逐项 idempotent 重试，移除负责人/依赖配置。创建时不隐式指派或设置依赖；详情中的合法状态/负责人操作保留。
- 全局任务卡片、频道任务卡片、聊天内彩色 task 标识均进入任务审批详情。频道 task tab 是可重载的导航来源，关闭后回该 tab。聊天的阅读预览/消息列入口仍进入并排 Thread。
- 桌面审批详情独立遮罩弹窗、右上 X；不占用 Room 的 split 列。PWA 全屏详情、左侧返回、隐藏 X；复用同一个关闭动作和焦点恢复 owner。
- MessageItem 的 Room、DM、Thread、task detail 实例统一用 `useMessageActions`：桌面细指针 hover；键盘 focus-visible；触摸轻点显示，点外/ Escape 收起，拖动/长按不当作轻点。弹出的表情选择器保持可用。无触屏默认常显规则。
- 默认图标为 `--ink-50`，不是 `--ink-40`；已收藏等状态颜色保留。三个操作的实际含义由原有入口决定，不把「在消息列回复」改成私聊。

## 验证入口与边界

- `scripts/test-task-presentation-browser.mjs`：1440×900、390×844，标题创建、任务来源/返回、正文宽度、触摸/hover 操作条；变更前复现失败。
- `scripts/run-global-task-detail-browser-gate.mjs`：任务详情真实状态/负责人修改、消息回复、重载、错误恢复、迟到响应与关闭；使用隔离 Fake provider。
- `scripts/test-mobile-tab-navigation-browser.mjs`：选中两项筛选仍为单行、控件可点击、白/黄色状态；新建文字可见。
- 既有 discovery-family 保留双任务丢回执后的幂等重试，改验空依赖与冻结标题；不再验已撤回的配置表单。

本地浏览器自动化不等于实体 iPhone Safari/PWA 的人工验收；本批次未运行付费 CLI，
也不声称同条件 Raft 线上双边验收。正式重启须保留原 Tailnet/LAN 启动收据，先备份并检查活动工作。

### 执行结果

Chromium / WebKit 的 1440×900 与 390×844 创建、审批、消息操作条场景通过，
包括 Room、DM、阅读 Thread 和审批详情中的消息；手机创建输入框为 16px。
专项 global-task-detail 的桌面/移动状态与负责人更新、重载、迟到响应和错误恢复通过。
任务卡片原生触摸滚动以及桌面鼠标/键盘拖动回归通过。
`test-task-title-retry-browser.mjs` 另行验证双标题第二项已接受但回执丢失：冻结标题、
重用原命令、仅重试剩余项、最终每个标题只有一个 canonical Task。

额外尝试旧 `verifyDiscoveryFamily` 整页门禁，在第 224 行旧断言
「进行中 cannot counterfeit canonical execution evidence」提前失败：它要求管理员的
状态菜单禁用，而当前 `globalTaskTransition` 已使用显式 `task.workflow.update`。
该失败发生于创建段之前，本批未改变该状态协议，未把它计为通过，也未为旧断言改回生产行为。
上述创建重试已由独立可重复门禁覆盖；旧整页状态断言的整体迁移仍待另行处理。

正式交付复查：`npm run check`、`npm run format:check`、`git diff --check`
与 `npm run build:web:workbench` 均通过。正式实例经空闲校验、持久状态备份和
优雅停止后启动新冻结资源；原 Tailnet/LAN 网络模式及端口保留。
两个原访问入口的新浏览器页面均验证新构建；1728×1050 与 430×932 的
创建弹窗、审批返回/关闭、正文宽度以及消息操作条截图已人工查看。
长列表复查采用视口内稳定 Message ID，避免虚拟窗口滚动后「第一条」指向另一消息。
正式环境仅做浏览与开关窗口，没有发送验收消息或创建验收任务；没有提交或推送代码。
