# 已删除 Agent 的任务身份和负责人

## 上游证据与边界

2026-09-20 只读检查 Raft `parity-task-choice-0911` 任务 #1：回复者
ParityTaskCodex0911 显示已删除，负责人未指派，任务仍为进行中。
因此删除 Agent 并非必然关闭任务。本批不新增自动关闭或完成语义。

页面：<https://app.raft.build/s/hakasemac/tasks?thread=2fed72f0-f821-42d1-a5b0-9af69575f22b%3A0d8876eb-40f3-4212-911f-55fa2fac25f1&task=1>。
发布源码 `index-CKeqacxz.js`，release/v1.16.0，commit
`ba2a1dbac175595f28dfe1c09e4df2556d59ac0c`，SHA-256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
`deleteAgent` 仅请求删除并更新 Agent 缓存，没有客户端批量关闭 Task 的逻辑。
中央服务删除事务不可见；上述现存任务不能证明该任务的完整历史时序。
沿用[复用台账](2026-08-29-raft-multica-reuse-ledger.zh-CN.md)的许可边界，
原始发布 bundle 仅分析使用，本批为 RAH owner 适配，不是上游服务器复制。
Multica 的删除动作差异沿用[删除审计](2026-09-13-agent-deletion-cascade.zh-CN.md)，不采用其取消 Task 策略。

## 单一 owner 与修复

Kernel `task-agent-deletion.ts` 在终止证明和删除 fence 成立后清空所有状态的
Task 负责人/认领，保留 workflow/state、讨论、提交和审计历史。
此前只处理未完成 Task，并把普通任务改回 todo；此规则由本批替代。
启动补齐只处理 tombstone 仍拥有的 Task，依据原始经过认证的
`agent.deletion_requested` 写入幂等 `task.unassigned` 和同事务投影。
没有原删除凭据时不伪造 actor；重复启动不再追加事件。

前端审批讨论使用 Workspace 的历史 Agent 目录，以 participant ID 关联；
活跃候选和发送对象仍由有效成员/启用状态过滤。Task 徽标与参与者文案使用
最新 displayName，正文复用既有已删除身份头像与不可提及规则。
`@handle` 是稳定标识文本，不等于不可变 participant ID；改显示名不改 handle，
同名新建 Agent 不接管旧消息或任务。

## 验证

`agent-deletion.test.ts` 先复现状态被重置，再覆盖进行中、审核中、完成、关闭的
解除负责人、旧库补齐和重复重启不重复事件。`room-view-model.test.ts` 先复现
改名后仍显示 handle，再验证消息作者与任务负责人使用 displayName。
浏览器门禁 `scripts/test-deleted-agent-task-identity-browser.mjs` 使用隔离 Fake CLI，
验证改名徽标、删除后灰色历史回复、未指派及保留关闭状态；不是付费 CLI 验收。

本批执行结果：相关 34 项单测通过；TypeScript、正式 workbench build、diff 检查通过；
Chromium/WebKit 的 1440px 和 390px 门禁通过（窄屏审批沿用仅元数据的紧凑视图，
历史回复在桌面审批验收）。已检查两浏览器截图。
全量 `npm run check` 被已有 `/v1/worker/message-present` 未登记项阻断；
`format:check` 仍报告 5 个既有 wake/delivery 文件。Web 全量单测 447 通过、
8 项旧 UI 源码契约断言失败，涉及头像、重置、侧栏、Workspace composition、
附件 overlay 和 reaction placement；不宣称全仓库绿灯。

正式部署：守护重启完成持久数据备份、活动工作检查和优雅切换，构建
`75fc70223cbe9be95bdfced41c3ca483fbdedeceac99ed8127840a8fae6b4df7`。
新 Chromium 页面只读查看 Agent Council 任务 #5，确认已关闭、未指派，
原回复显示 Gemini、已删除、灰色原头像；徽标无旧 handle。
数据库只读核验 tombstone 仍作为 Task assignee 的记录为 0。
没有提交、推送或真实付费 CLI 测试。

## 续修：两个任务入口的右侧留白

用户截图补报后，在正式页面 1000px 视口复现：外框内容宽 956px，讨论列只有
520px。共享 DialogLayer 已 portal 到 body，但 `task-detail.css` 的宽度覆盖仍依赖
`.app` 祖先；因此 1280px 以下继承普通侧栏线程的固定宽度。删除这一个失效祖先
限定，使弹窗线程始终复用本文件的全宽、无侧边框布局，不改普通线程侧栏。
上游宽度合同仍采用本文件记录的 Raft db/t9 全宽 Thread 弹窗；是 RAH portal
接线修复，不新增 modal 布局算法。

浏览器门禁先在原 CSS 上断言失败，再覆盖 1440、1000、768、390px；
Chromium/WebKit 均通过。桌面两种入口均断言讨论列与弹窗内部等宽、历史
Gemini 名字及删除标识存在；390px 保持既有紧凑审批。用户截图中旧 OpenCode
和 Gemini 负责人仍在，但本次改动前正式新页面已经是 Gemini 历史回复、
未指派，确认此前身份修复未丢失。本批继续验收两入口，未再改写身份。

续修正式交付：备份并优雅重启到构建
`e3892c7e725b7f7d8a31001a5b1038fa17a32ef69a6e2860734379fb887fc0ff`。
新浏览器 1000×900 查看真实任务 #5，两入口均测得弹窗内部 956px、讨论列
956px；显示 Gemini、灰色头像、未指派。TypeScript、build、diff 通过；
组件 CSS 匹配报告和 UI catalog 已重新生成。全量 check 和 format 的既有阻断
与前述一致。

## parity-core-20260829 任务 #1 的关闭原因查证

2026-09-20 经 Firefox 已登录页面只读打开任务 #1 并展开「历史」。
[官方任务与时间线](https://app.raft.build/s/hakasemac/channel/ca806598-6298-4b05-bf26-3ec882689449?thread=ca806598-6298-4b05-bf26-3ec882689449%3A61c4e852-1021-485e-8d98-4e8fb07a2904&task=1)
显示以下记录（时间为页面显示值）：

| 时间          | 操作者         | 动作                           |
| ------------- | -------------- | ------------------------------ |
| 8月29日 18:15 | ParityAuditorA | 变更负责人，待办→进行中→待确认 |
| 8月29日 18:16 | Hakase         | 待确认→完成                    |
| 9月8日 18:35  | Hakase         | 关闭任务，完成→已关闭          |
| 9月18日 21:24 | system         | 变更负责人，取消指派           |
| 9月20日 01:19 | Hakase         | 变更负责人，负责人Sun          |

因此这个具体实例的关闭早于system取消指派约十天，是独立的已记录任务关闭
操作，不能归因为删除Agent。当前负责人为Sun是后续重新指派的结果，不是旧Agent
仍占用负责人。关闭对象是频道内的任务 #1，频道仍显示聊天、任务、文件及输入框；
不存在从此记录推导「频道随Agent删除而关闭」的依据。

同一发布bundle中 `updateTaskStatus` 调用 `PATCH /tasks/:id/status`，传入status；
`jZe.done` 明确允许closed。`updateTaskAssignee` 调用独立的
`PATCH /tasks/:id/assignee`；`loadTaskHistory` 读取 `GET /tasks/:id/history`。
`deleteAgent` 调用 `DELETE /agents/:id` 并更新删除标识和诊断缓存，没有前端
批量关闭任务的步骤。这些代码与该任务时间线吻合，但不能替代不可见中央服务的
完整删除事务实现，也不能从操作者Hakase推断当时是浏览器点击还是其他认证客户端。

RAH当前 `task-agent-deletion.ts` 清空被删除Agent的assignee/claim并保留原工作流
状态，符合这份证据：进行中可保持进行中，已关闭保持已关闭，随后允许正常重新
指派其他存活身份。本次仅调查并更新证据，没有修改运行逻辑、发送消息或删除上游
Agent。文档格式与diff检查通过；无需重启未改变的正式运行时。
