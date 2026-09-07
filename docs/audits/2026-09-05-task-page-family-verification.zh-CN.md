# Task 页面族 Raft-first 收口与验收审计

> 历史说明：本文记录 2026-09-05 当时的代码与运行证据，不再作为当前候选的通过声明。
> 其“角色在创建后详情编辑”的表述已被 2026-09-06 的提交前原子协作步骤取代；当前状态见
> [Task 协作入口与 canonical 创建验收](./2026-09-06-task-collaboration-entry-verification.zh-CN.md)。

日期：2026-09-05

## 结论

本批将频道 Task Tab 与全局 Tasks 作为一个完整页面族验收。Raft 提供页面结构、五列、
折叠默认值、状态菜单、筛选、看板/列表和多标题创建合同；RAH Kernel 继续独占 Task、
RunAttempt、Submission、Review、依赖释放和 Room 事件事实。没有引入 Multica 的 Issue
状态机，也没有建立第二套页面或业务真相。

本批范围通过 TDD、全仓检查、隔离的真实 Chrome/Firefox、独立 canonical 读取、生产构建
以及正式实例重启后实页核验。该结论仅覆盖已登记的 Task 页面族，不扩张为全产品 Raft parity。

## 基线与来源裁决

- 施工前里程碑：`0fa8f89 feat: close canonical workflow and UI foundation milestone`。
- Raft 官方发布 bundle：
  `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
  `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
- 官方提取定位：`pce` 页面组合、`Vst` 卡片、`qst` 状态菜单、`Kst` 多标题创建。
- Multica 参考版本：`11861145abc59a0d39c8c8f24ad837d4584e664f`。其 Issue
  状态、catalog 和 cache 只被审阅，没有复制进生产；该模型不能替代 RAH 的交付/审阅生命周期。
- 本地适配：Raft 的中央批量创建在 RAH 中映射为顺序 typed `task.create`。每一行保留稳定
  client ID/idempotency key，失败重试不会重复已接受行；每项仍由 Kernel 单独写入 canonical ledger。

机器行为登记 `task-page-family` 已钉住上述四个 Raft 函数及文本定位；B035–B038 分别绑定
列折叠、创建、筛选与视图切换的生产 owner 和浏览器场景。生成索引不是手写完成率。

## 前后端结果

- Room 与 global 页面复用 `GlobalTaskBoard`、Task toolbar/filter 和五态菜单。
- 待办、进行中、待确认默认展开；完成、已关闭默认折叠。
- 卡片在全局页显示 Room，在 Room 内不重复显示 Room；长标题和空列均进入同一布局协议。
- 主创建弹窗按 Raft `Kst` 只呈现可增删的标题行、“再加一条”和复数提交。负责人、协作者、
  reviewer 没有从业务系统删除，仍在 canonical Task detail 中编辑。
- In progress、In review、Done 不能由 UI 伪造；缺少 RunAttempt、Submission 或 Review
  证据时选项保留但禁用。Closed/Reopen 分别产生 `task.cancelled`/`task.reopened`。
- 创建两项 Task 后，验收独立读取 `task.list` 与 Room ledger，证明两项 projection 和两条
  `task.created` 事件同时存在。

## TDD、浏览器与请求边界

`apps/web/test/task-page-family-contract.test.ts` 先对旧的单标题高级表单、空数据 fixture、
缺失 canonical 结果断言和未登记 owner 失败，再实现至 4/4 通过。

最终门禁收据：
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-C2lBGx/receipt.json`。

- 967 个生产、内部 UI 库、fixture、脚本和机器行为登记输入具有内容哈希。
- Chrome 13/13、Firefox 13/13，共 26/26 场景通过。
- `discovery-page-family` 覆盖 1440 桌面与 390×844、五列、折叠、真实卡片、三组筛选、
  官方 sentinel、状态菜单、close/reopen、双标题创建、Room/global scope 和 board/list。
- 两个引擎的请求守卫均为 `blockedRequests=[]`、`rejectedRequests=[]`；仅允许 fixture 明示的
  `task.create` 和 `task.workflow` 写入。
- 人工查看 Chrome/Firefox 创建弹窗及 390px 页面截图，没有发现边框错位或横向溢出。

全仓 `npm run check` 退出 0；其中 Web 335/335、parity regression 34/34、browser policy
8/8 通过。`npm run format:check`、`git diff --check`、`npm audit --omit=dev` 均通过，生产依赖
漏洞为 0。

## 构建、重启与实页核验

- 受信任工作台构建通过，build ID：
  `513e3f8140f32dd00b1c9e30424cbfb76ae3d3c33eb8e4282b4df457e63acfc6`。
- 无参数重启被保护脚本拒绝；随后以旧 PID `82039`、规范状态目录
  `/Users/sun/.rah/state` 和精确 build ID 执行。
- 校验后的重启前备份：
  `/Users/sun/.rah/backups/pre-restart-73a3a6d3-a671-45e4-b8d0-50c31ae55b26`。
- 新 PID `9927` 持有同一 `room.db` 与 `127.0.0.1:4173`；`/_rah/health` 返回 online。
- 实际 HTML meta 返回相同 build ID，实际资产为 `/assets/index-fbefJkpi.js`。
- 重启后真实浏览器从 Agent Council 聊天切入任务页：两个现有 Task 由 canonical 数据显示在
  待确认列，Done/Closed 折叠，URL 为 typed `roomTab=tasks`，页面无横向溢出。

## 明确未声明与下一步

- 顺序多项创建具备逐行幂等，但不是跨多行数据库原子事务；这与 Raft 中央 bulk call 的
  部署结构不同，失败时保留已接受事实并允许安全重试。
- Vite 仍报告若干大于 500 kB 的既有 lazy/语言/图形 chunk；本批没有把 bundle 体积改善
  冒充为完成，后续应独立做加载预算。
- 尚未完成的全产品范围包括部分 Search/Message 状态、Human/ACL、Computer 管理、通知
  设备送达专项及 Raft 相同页面的其余鼠标/权限/错误组合；继续按机器登记和完整页面族推进。
