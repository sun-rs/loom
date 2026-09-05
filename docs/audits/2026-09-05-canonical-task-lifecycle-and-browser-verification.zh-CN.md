# Canonical Task 生命周期与浏览器验收审计

日期：2026-09-05

## 结论

本批关闭了第三方复核中的 Task P1/F1、F2、F3、F5：看板状态不再是第二套业务真相；
无效看板动作不会破坏 Worker 接续；幂等重放会校验目标状态；浏览器验收同时证明可见 UI
和 canonical Task 结果。Raft 的五列、状态菜单顺序和页面交互继续保留，但其点击只表达
intent，最终副作用由本机 Kernel 统一裁决。

本结论不扩大为全产品与 Raft 完全一致。长历史有界同步、冻结交付证据、完整团队闭环、
后续页面族和通知设备专项仍按修复计划继续。

## 来源与采用层级

| 来源                            | 本批用途                                  | 采用结论                                                         |
| ------------------------------- | ----------------------------------------- | ---------------------------------------------------------------- |
| Raft 官方 Task 文档             | 五态的用户可见含义和 Done/Closed 边界     | 作为产品行为合同；Done 表达已审阅并完成，Closed 表达取消且可重开 |
| Raft 真实页面与既有授权 UI 证据 | 五列、菜单顺序、卡片、颜色与交互          | 保留相同可见结构；未把参考实现当作后端真相                       |
| RAH Kernel、SQLite 与 typed SDK | 本机生命周期、ACL、Review、依赖唤醒与幂等 | 单一 canonical owner                                             |
| 第三方隔离复现                  | F1/F2/F3/F5 失败样例                      | 转为回归测试和真实浏览器业务断言                                 |

未发现可直接采用、且能证明是 Raft 官方服务端实现的 Task 状态机源码。因此本批没有伪称
“复制 Raft 后端”；Raft 决定外显合同，RAH Kernel 负责与本地架构相容的确定性实现。

## 根因与修复

此前 `workflowStatus` 可被前端看板独立写入，而 `Task.state`、Review、执行 lease 与依赖
调度仍由另一套生命周期控制。结果是 UI 可以显示 Done，但 Task 仍为 todo；运行中的任务
被移到待确认后，后续 Worker 提交又会被旧状态拒绝。验收脚本只读取看板属性，因此没有
发现业务结果仍未完成。

schema 48 将两者收拢为同一事实：

- 数据迁移修复既有分裂行，数据库 trigger 拒绝后续不一致写入；协议 schema 同样拒绝矛盾投影。
- `task.workflow.update` 只进入 `TaskLifecycleService`。Closed 映射 canonical cancel，Todo 只允许
  已关闭且有停止证明的任务 reopen，Done 走 Review/Submission 完成门；进行中和待确认由真实
  claim/submit 产生，不能由看板伪造。
- Room owner/admin 或 Task creator 可执行 Human 管理动作；依赖任务实际生成的 Activation ID
  通过 Kernel、application service 与 typed SDK 原样返回。
- 幂等记录比较完整目标。相同 key 改投另一状态返回冲突，不能伪装成成功重放。
- Web 的 Room Task 与全局 Tasks 复用同一 action owner。五个 Raft 菜单项始终可见；不满足
  canonical 前置的目标显示 disabled 及原因。拖拽也只发送可成立的迁移。

## TDD 与自动门禁

先固化失败样例，再实现 owner：

- `packages/kernel/test/task-workflow-canonical.test.ts` 覆盖状态分裂、Worker 接续、关闭/重开、
  Human manager、冻结 Submission/Review 完成门、迁移与数据库约束。
- Web contract 覆盖五态顺序、禁用原因、canonical action、完成回执和消息菜单真实指针辅助。
- `npm run check` 通过：protocol/core 886 项中 884 通过、2 项预期跳过；Web 329 项通过；
  parity regression 34 项通过；正式浏览器请求策略 8 项通过；UI registry 84 项通过。
- `npm run build:web:workbench` 通过。发布 build ID 为
  `dfad9427433166be3b09f1eb0a3b4d02b9918fb0a78b9430bad3d9931fa7521e`。

## 真实浏览器与业务结果

真实 Chrome 门禁在桌面、800/768/767/760/701/700 断点及 390×844 下完成：创建 Task、提交
冻结交付、Review、Human 完成、读取 canonical Task、核对 `task.completed` ledger、关闭、
重开、再次关闭，以及全局看板/列表和真实鼠标消息菜单。门禁结果为 PASS，隔离 Room 为
`room_d64759d4-a53f-49fe-836c-6be36930e43b`。

正式实例重启后又在用户现有 Firefox 实页只读核验：

- 旧构建提示按协议出现一次，刷新后加载新 build，不出现 JSON/网络错误附着到消息的回归。
- Tasks 页面仍按“待办、进行中、待确认、完成、已关闭”显示五列。
- 状态菜单保持同一五项顺序；当前待确认 Task 的“完成/已关闭”可用，“待办/进行中”保持
  可见但 disabled，并显示 canonical 前置原因。
- 现有两个待确认 Task 刷新后仍由真实 canonical 数据投影，没有被 UI 操作改写。

浏览器验收不是只看 CSS：完成路径同时读取 `state=done`、匹配的 `workflowStatus`、
`completedAt` 和 `task.completed` 事件；关闭/重开使用独立 Task 并复查服务端结果。

## 正式重启与恢复证据

- 正式地址：`http://127.0.0.1:4173`
- 新服务 PID：`22527`
- 校验后的重启前备份：
  `/Users/sun/.rah/backups/pre-restart-3b714478-62ee-41a0-a8b7-6d410c5e2aad`
- HTML、资产清单与 `.rah-web-build.json` 均返回同一 build ID。
- 正式 SQLite 只读检查确认两条 schema 48 约束 trigger 已存在，历史 Task 的
  state/workflow 分裂计数为 `0`。

## 剩余风险与下一批

下一批必须处理长历史 F4，而不是把虚拟列表误当成已经解决：

1. daemon 冻结游标/快照与有界热窗口；客户端禁止从零自动拉完全部正文。
2. prepend 锚点、断线重放、重复页、10 万事件、窄屏和内存上限门禁。
3. Task、Review、Submission 有界查询，并消除逐 Task 的依赖/参与者 N+1。

其后依次处理冻结 Git/Artifact 交付证据、完整团队返工/验收闭环，再继续与 Raft 同功能的
Search、Tasks、Message、Human/ACL、Computer 与通知页面族双边验收。
