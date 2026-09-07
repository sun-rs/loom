# Task 协作入口与 canonical 创建验收

日期：2026-09-06

状态：S1 阻塞项已经按独立审查修正并通过当前本地自动化、隔离浏览器门禁和正式持久实例验收；累计独立复核仍在进行。

## 本批关闭的问题

Raft 的 `Kst` 多标题创建仍是打开弹窗后的默认界面。RAH 没有把负责人、协作者、审阅者或
依赖硬塞入该主界面，而是在提交前增加明确的“配置协作与依赖”第二阶段。该阶段与标题由
同一组 typed `task.create` 命令提交，避免先创建开放 Task、再编辑角色时被 Worker 抢先认领。
没有选择高级配置时仍创建普通开放 Task，纯讨论不会因此自动认领。

Room composer 与 Task 创建弹窗不再各自维护角色控件；两者共同使用
`apps/web/src/components/task-participant-fields.tsx`，角色组合仍由
`taskParticipantsForSelection` 校验。依赖候选来自当前 Room 的 canonical Task 列表，只显示
未完成、未取消的 Task。浏览器不维护第二套 Task、角色或依赖事实。

## Raft 与本地适配边界

- 官方冻结来源：`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，其中 `Kst`
  提供多标题行、删除、空白过滤、“再加一条”和复数提交的可观察合同。
- RAH 本地适配：第二阶段协作/依赖配置。当前没有证据证明这是 Raft `Kst` 的原样页面，
  因此行为登记明确标为本地可靠性交互，而不冒充官方源码。
- canonical owner：`task.create`、Kernel Task、Room ledger、Submission 和 Review。UI 只提交
  intent，不直接改完成状态，也不把看板标签当作业务完成。

## TDD 与结果

先在 `apps/web/test/task-page-family-contract.test.ts` 增加“默认多标题 + 单次原子协作步骤”
合同；旧实现因缺少“配置协作与依赖”而失败。独立复核随后发现部分成功后只保留稳定 key、没有冻结
精确请求，以及活跃 Task 超过 500 条后 Room 页面没有延续入口。第二次独立复核进一步发现已载入的早期页
会被普通轮询丢弃，并且移动 Workspace Home 只验证了组件回调、没有验证生产 App 接线。新的红测分别锁定
精确 command ledger、有界 Task window、轮询保留/刷新、旧 Room 响应围栏和生产 App 移动导航；实现后定向
Task/身份合同、TypeScript 与 UI registry 检查通过。

`apps/web/src/task-create-execution.ts` 现在持有每一行完整冻结的 typed command。服务端已确认的行从
待提交队列移除；发生 HTTP 成功但响应不可解析等歧义失败时，只重放未确认行的同一个
`basedOnRoomSeq`、幂等键和参与者/依赖配置，不能以当前表单重新生成另一条命令。界面同时锁定标题、
负责人、协作者、审阅者、依赖和返回动作，直到剩余行成功或 Human 明确放弃该批。显式
`stale_context` 仍允许重新生成，因为 Kernel 已经证明该命令没有被接受。

`apps/web/src/room-task-pages.ts` 把首次活跃页限定为 500 条，并暴露延续 token；Room Task 页面提供
明确的“载入更早任务”入口。每个 Room 只保留最近三个显式访问页，全局只保留八个 Room window；普通轮询
重新读取首屏和每个已访问 cursor，旧页 Task 因而既不消失也能反映新状态。App 的 Room 读取使用
generation/AbortSignal fence，迟到旧响应不能发布。浏览器真实构造 1,001 条活跃 Task，载入两个早期页，跨过
两轮普通轮询，更新中间页 Task 状态，再继续到最后一页。

歧义提交验收不再只由 fixture 假装抛错：第一次真实请求先交给服务端接受，测试随后用同一请求独立读取幂等
回执，再把成功响应替换为不可解析内容交给浏览器。浏览器显示失败后通过精确 `task.get` 证明 Task 已存在，
Human 的重试仍发送字节等价 command，Room ledger 中该 Task 只有一个 `task.created`。单元合同另以只改变
`basedOnRoomSeq` 的相同幂等键请求验证 `stale_context`，证明只有明确未接受才允许重新生成。

`npm run test:web:foundations` 的首次重跑又发现两个累积问题：

1. fixture 请求白名单没有登记新的 `workspace.human.list` 与精确 `task.get` 路由；先加失败
   policy 断言，再补明示路由，没有放宽为任意 API。
2. 账户写回后的 authenticated Human 被旧目录快照覆盖；先以实体网投影反例复现，再让当前
   authenticated principal 替换同一 membership 内的旧 principal，同时保留 owner/admin 角色。

当前基础门禁收据：
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-q5L8qJ/receipt.json`。
Chrome 14/14、Firefox 14/14，共 28/28；两个引擎均
`blockedRequests=[]`、`rejectedRequests=[]`。真实页面操作创建两个标题并选择同一前置 Task，
随后独立读取 `task.list`，确认两个 Task 的 `dependencyTaskIds` 均为所选 canonical Task，且
Room ledger 各有对应 `task.created`。同一矩阵还注入首行确认、次行“服务端已接受但客户端回执丢失”：
状态显示 1/2，已确认行不重发，第三次请求与失败的第二次请求深度相等；并验证 1,001 条活跃 Task 的
有界延续页、轮询保持、旧页状态刷新和 cursor 前进。

Firefox 150.0.2 的完整 production App 门禁同时通过 1440×1000 与 390×844。它为第二 Workspace
写入真实桌面 Settings 最近位置，再从移动菜单选择该 Workspace，证明生产接线复用既有 Home owner、
忽略桌面详情、使用 history replace，并通过 Back/Forward 与 reload 恢复 canonical Workspace/Room；
不是只断言 `WorkspaceIdentity` fixture 的 callback 参数。

最终候选上的 `npm run test:web:browser` 退出 0；隔离 Room 为
`room_09547ae3-679b-438c-9116-73080f81fff8`，浏览器为 Chrome，窄屏视口为 `390x844`。
正式业务门禁从真实 UI 进入第二阶段，指定 Kimi 为负责人、Alice 为 reviewer；fake Worker
通过真实 Activation/Worker facade 产生首个冻结 Submission，
reviewer 驳回，Worker 提交新 revision，reviewer 批准，Human 点击确认完成。最终断言独立读取
`Task.state=completed`、`workflowStatus=done`、`completedAt` 和 `task.completed` Room 事件，
没有退化成只检查看板属性。

同一最终候选还通过：

- `npm run check`：退出 0；覆盖 repository identity、UI library/registry、TypeScript、全量
  package tests、Web 单测、历史回归与浏览器请求策略。
- `npm run format:check`：退出 0。
- 最终内容确定 build ID 为
  `7cab52644662ab500144e4830ec123ebd47d41b91c2ca154f82784006655c84d`；正式 `4173`
  实例的 HTML meta 与 `x-rah-web-build-id` 均返回同一值，`/_rah/health` 为 `online`。
- 正式持久实例上的 Discovery 页面族 Chrome/Firefox 收据：
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-discovery-formal-aqRYic/receipt.json`；
  Settings 页面族收据：
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-settings-formal-pSCmrs/receipt.json`。
  两次验收前后 collaboration 内容计数和序列均未改变；只读 cursor 按预期推进。
- 正式重启前经 idle 检查和完整状态校验生成备份
  `/Users/sun/.rah/backups/pre-restart-994b51c5-12d1-4d7a-adb1-22b86aa2758e` 及同名
  `.receipt.json`；旧 PID 83386 仅通过 SIGTERM 优雅退出，新 PID 24385 继续使用同一 canonical 状态。
- `npm audit --omit=dev`：0 vulnerabilities。
- `git diff --check`：退出 0。

## 尚未声明

- 多标题通过顺序 typed 写入实现逐行幂等，不是跨多行数据库事务；若中途失败，已接受事实保留，
  其余行使用冻结的原请求精确重试，而不是只依赖稳定 ID 后重新采样表单状态。
- 本文不声明 Raft 中央服务内部实现同构，也不声明 84 条历史行为已全部重新核验。
- 累计独立审计将在候选冻结后补入；完成前本文保持“待独立复核”状态。
