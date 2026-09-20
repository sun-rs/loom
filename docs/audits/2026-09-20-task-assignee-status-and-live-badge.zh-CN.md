# Task 负责人权限和聊天徽标实时更新

## 来源与规则

Raft v1.16.0，commit `ba2a1dbac175595f28dfe1c09e4df2556d59ac0c`，
[发布 bundle](https://app.raft.build/assets/index-CKeqacxz.js)，SHA256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
任务详情元数据组件的负责人条件为 `e.status!=="done" && ZAe(...)`；
`task.permissions.done` 对应“已完成的任务不能更换负责人，请先重新打开任务。”
PATCH status 与 assignee 仍为独立接口。完成禁止更换/取消负责人；其余四种状态保留既有写入权限。
此证据修正 09-14 旧版本审计的任意状态可编辑结论，不把关闭与完成混为一谈。

沿用复用台账许可边界，发布 bundle 仅供分析。本轮为行为移植和 RAH glue，未复制闭源后台。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`server/internal/handler/task_lifecycle.go` 区分历史执行 Agent 与当前 issue assignee；
不将其执行重试模型引入 RAH Task。采用 Raft 更直接的产品状态条件。

## 所有者与实现

- Kernel `human-task-edit.ts` 在因果和精确幂等校验后拒绝完成任务的人工指派/取消指派，拒绝不写事件。
  Agent 删除系统清理仍对所有状态解除负责人，保留状态；无新业务状态。
- `taskAssigneeMode` 与共享 TaskAssigneeControl 使用同一状态条件；禁用按钮外围保留 hover/focus tooltip。
  共享 tooltip body portal 层级高于 dialog/drawer，避免提示被遮挡。
- Task 状态/负责人命令返回 canonical Task，聊天审批入口立即更新当前 Room 投影，随后沿既有刷新链路同步。
  正文徽标按 assigneeId 解析实体显示名，支持 Human/Agent；空负责人不显示 @。
  不修改身份 ID，不按名称合并历史身份。

## 验证

先记录完成任务可编辑的单测/Kernel 失败，再实现；浏览器临时恢复旧 Agent-only 渲染时，
Human 指派徽标从预期 `@Assignee Display` 得到 `#1`，确认复现后恢复修复。
新增 tooltip 层级断言先得到 50 小于 modal 100，修复共享层级后通过，并检查截图。

28 项相关单测/Kernel 测试通过。隔离真实 Kernel、临时数据库和 Fake CLI 浏览器门禁
`scripts/test-task-assignee-live-browser.mjs` 在 Chromium/WebKit 通过：Human/Agent 显示名、
指派/取消指派的一秒内徽标更新、五状态编辑矩阵、完成提示，以及重新打开后解除负责人。
未运行付费 CLI；未修改正式任务以构造测试状态。

Typecheck、正式 Web 构建和 diff 检查通过。全量 check/format 的既有阻塞与正式重启结果见下方交付记录。

## 正式交付记录

`npm run check` 通过 UI library、choice、component spec、catalog 和 UI contract 后，
被既有 `/v1/worker/message-present` 未登记问题阻塞。`format:check` 仍报告五个既有文件：
`docs/product/2026-09-18-batch1-wake-body-delivery.zh-CN.md`、
`packages/agent-host/test/wake-message-input.test.ts`、
`packages/application-service/test/presented-delivery-chain.test.ts`、
`packages/daemon/test/codex-delivery-acceptance-chain.test.ts`、
`packages/kernel/test/activation-presented-window.test.ts`。未改写这些无关内容或放宽检查。

按 guarded restart 检查活动工作、验证持久状态备份后重启正式工作台，
冻结 Web build `3dfb65a3b681ace66c091c76bbad87845463ee64dd43b583d27723e3a9ab332b`。
备份 receipt `pre-restart-ba2c8505-f03e-4423-9a70-dab048736c39`，新进程已监听正式端口。
全新 Chromium 页面打开真实 Agent Council 任务 #4，完成/未指派按钮禁用、提示浮于弹窗之上、
两条已删除 Kimi 历史回复正常显示；保存并检查截图 `/tmp/rah-assignee-formal.png`。
此正式检查只读，不代表对 Raft 后端事务的双边验收，也未运行真实 CLI。

## 属性标签与控件同行

用户要求与 Raft v1.16.0 `index-CKeqacxz.js` 的 Task properties 一致：外层
`flex flex-wrap items-center gap-x-6 gap-y-2`，EL 每个字段为
`flex min-w-0 items-center gap-2`，label 为 `mb-0 shrink-0`（格式化源码约
188469、188705 行；来源 hash/许可沿用页面选择审计，结构化移植，非字节复制）。
RAH 的状态/负责人多套一个 assignment div，导致原有直接子项样式没有作用到
标签和值。现在两者各自为 dl 的直接子组，与创建人并列；组内 gap 8、横向居中，
外层按完整字段组换行，不把标签单独放到按钮上面。沿用原状态和指派控件及权限。

`scripts/test-task-property-rows-browser.mjs` 先在 1440px 复现状态标签位于按钮
上方，再修改结构。Chromium/WebKit 均在 1440/390/320px 验证标签和值中线一致；
截图确认 320px 时创建人整组换到下一行，状态与负责人仍为标签+按钮同行。
类型检查与正式构建通过；CSS 变化后重新运行 sidebar-row/sq-btn 规格与匹配规则
取证，不放宽规格。全仓检查与正式重启结果以本次交付记录为准。

本次正式重启未执行成功：restart guard 在停止旧进程之前发现 6 个活动 Activation，
拒绝重启；未强制停止或打断 Agent。因此本批仅为代码、隔离双浏览器、构建验证通过，
正式运行实例尚未应用新 Web bundle。目标 Web build 为
`e16d27cad7313ade7a7ae7dba7f54e91419d9a0c6fc5e4d8f383f476e31dd535`。
`npm run check` 经 CSS 规格取证更新后仍在既有 message-present 登记处失败；
format:check 为既有五个 wake/delivery 文件，diff 检查通过。
