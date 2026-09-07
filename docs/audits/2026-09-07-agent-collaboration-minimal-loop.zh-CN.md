# Agent 协作最小闭环：接单、寻址、task-create 与 prompt 移植

批次日期：2026-09-07。来源：独立评审（`~/Code/repos/tmp/2026-09-07-rah_os-architecture-review-claude.zh-CN.md`）
判定的最大功能缺口——Agent 不能把同伴的消息 claim 成 Task、不能 @ 同伴、不能创建子任务，
Task/Review 链在 agent→agent 方向不启动。本批只做该缺口的最小补齐，不扩展到其他施工项。
所有改动均未提交；工作树中另含 Codex session 的 Computer 页面未提交改动，二者文件不重叠。

## Raft 证据与对应裁决

来源为提取源码 `raft-computer-1.0.18`（`~/Code/repos/raft-runtime-forensics/artifacts/extracted/`）。

| 能力 | Raft 证据 | RAH 裁决 |
|---|---|---|
| 同伴消息可 claim | `regions/agent-prompt-compiler.js:161-170`：任何人要求做事即 claim，仅顶层消息可成 Task | `claimMessageAsTaskTransaction` 去掉 `principals.kind = 'human'`，保留顶层、同 Room、Activation 因果范围、inbox 投递四个约束 |
| @mention 寻址 | `agentApiContract.ts:241-253` send 合同无 mentions 字段；`agent-prompt-compiler.js:212-220` 以唯一 handle 在正文 @ | 不新增请求字段；kernel 服务端用 `messageMentionCandidates` 解析 worker 正文中的 `@handle`，只解析同 Room 已启用 Agent 成员，命中者 reason=`mention`，其余仍 `room_policy`/`thread_subscription`；Thread 内 mention 同时订阅该 Thread |
| task create | `agentApiContract.ts:358-368` 仅 `title[]`、`assignee?`、`creates_resource?`；prompt 190 行：默认未分派 todo，`--assignee` 指向他人仅 owner/admin | 新增 worker `task-create --title [--assignee 本人 participantId]`；只允许自派（否则 Forbidden）；不加 description/collaborator/reviewer/dependency（Raft 无此合同，且 kernel 要求协作者必须搭配显式 assignee）；不做 creates-resource |
| 礼仪与拆任务 | `agent-prompt-compiler.js:155-211, 236-246` | 删除"agent 消息不是回复义务、沉默有效"段，逐段移植 Conversation etiquette、Tasks 决策规则、What task create really means、Creating new tasks、Splitting tasks for parallel execution、@Mentions |

## 代码改动

- `packages/kernel/src/task-intent.ts`：claim 过滤放开；新增 `createWorkerTaskTransaction`、
  `assertWorkerTaskCreationFreshContext`（创建游标可落在本 RunAttempt 自己产生的 task 事件上，
  但若有投递给本参与者的更新业务事件则 stale）；`assertWorkerTaskFreshContext`、
  `requireOwnedTaskClaim` 从 `room-kernel.ts` 下沉至此（棘轮要求抽模块而非抬上限）。
- `packages/kernel/src/worker-message-routing.ts`：`workerMentionRecipients` 与合并规则；
  send-draft 时从 `held_message_drafts` 读正文解析。
- `packages/kernel/src/collaboration-service.ts`：worker Thread 回复中的 mention 收件人订阅 Thread。
- `packages/kernel/src/room-kernel.ts`：`postWorkerMessage` 传入正文；`createWorkerTask` 门面。
- `packages/protocol/src/worker-task-create.ts`（新）+ `index.ts` re-export：`WorkerTaskCreateRequestSchema`。
- `packages/application-service/src/worker-application-service.ts`：路由 `/v1/worker/tasks/create`。
- `packages/agent-host/src/worker-cli.ts`：`task-create` 子命令与 help。
- `packages/daemon/src/local-cli-runtime-spec.ts`：prompt 移植；另补两句 RAH 机制说明：
  拆分后父 Task 空闲 claimed 会阻止 acknowledge，需 `task-block` 或继续工作；返工轮次的幂等键须包含
  触发事件（`task.reopened` / changes_requested）的 roomSeq，否则被去重成空操作。prompt 约 14.7 KB → 18.7 KB。

## 测试（TDD，先红后绿）

- kernel `room-kernel.test.ts` 新增 9 个测试：agent 顶层消息可被另一 agent claim、Thread 内不可；
  worker @mention 投递 reason、非成员忽略、Thread 内 mention 订阅；worker 创建未分派 Task 并被同伴 claim、
  只能自派、同一 Activation 连续创建、同伴消息到达后创建游标 stale。
- application-service、agent-host CLI、protocol、daemon prompt 断言各有新增。
- 新增确定性链 `packages/daemon/test/agent-task-split-chain.test.ts`（真实 daemon v4、三个 fake CLI 进程）：
  Human `[SPLIT]` 需求 → lead claim-message 并 task-create 两个子任务、@ 两个助手 → 助手各领一个并提交 →
  Human 以 UI 路径（workflow closed→todo）驳回其一 → 同一助手返工再提交 → Human 验收 → 关库重开一致。约 2 秒。
- `packages/agent-host/test/fixtures/fake-cli.mjs`：新增 `RAH_FAKE_SPLIT_HELPERS`、按 handle 归属子任务、
  `task.reopened` 返工、claim 409 视为让出；既有依赖该 fixture 的 46 个测试保持通过。
- 全仓 `npm test` 941 项：937 通过、0 失败、3 跳过（默认跳过的付费门禁）+ 1 新 opt-in 门禁跳过。
  `npm run check` 全绿（含 source-boundary 棘轮、typecheck、web unit 369、parity 回归、formal browser policy）。
  定向浏览器门禁 `npm run test:web:worker-message-tools` 通过。

## 出口链：真实 CLI（用户授权模型，low effort）

门禁 `packages/daemon/test/real-agent-split-chain-gate.test.ts`，`RAH_REAL_SPLIT_CHAIN_GATE=1` 启用，默认跳过。
lead=Codex `gpt-5.6-sol`，helper-a=Kimi `kimi-code/k3`，helper-b=OpenCode `deepseek/deepseek-v4-flash`，全部 low。

- 第 1 次运行（256 秒）：链条本身跑通，测试在"父 Task creator 应为 lead"处失败——`claim-message` 按设计以消息作者
  （Human）为 creator，是测试断言写错，改为断言 Human。
- 第 2 次运行（473 秒）通过。事实：lead 认领 Human 消息为父 Task（最终 `blocked`）、创建两个标题含 @handle 的子任务、
  发出一条同时 @helper-a 与 @helper-b 的顶层说明（recipients reason 均为 mention）；helper-a/helper-b 各认领与自己
  handle 匹配的子任务，写出 `SPLIT_A.txt`/`SPLIT_B.txt`（内容逐字节一致）并提交；Human 驳回子任务 A 后 helper-a
  第二次提交（其消息自述"Rework after reopen (seq 49)"，说明按新 prompt 用了带 roomSeq 的返工键）；Human 完成两个子任务；
  5 个 Activation 全部 completed，5 个 RunAttempt 全部 exit 0；关库重开后状态一致。
  保留现场：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-real-split-chain-KVrVY0`。

这条链是以后 Agent 协作的回归基线。

## 正式实例

`npm run build:web:workbench` → build `47a15ca7044b8deccf171dc87ae8cda00eae9ac94220c5cc31388c6e33e1ae53`；
`scripts/restart-local-workbench.mjs --pid 11346` 于 23:50 完成，备份
`~/.rah/backups/pre-restart-70424d9d-ff32-4b9d-a9da-4227af9205df` 已验证，后继 6 秒内上线（pid 79716）。
前后对照：6 Rooms、43 Messages、2 Tasks、4 Agent 定义、153 个记忆文件均一致；新增 8 条事件全部是控制 Room 的
`policy.revised`/`agent.revised`（bootstrap 以新 standing prompt 重新冻结 4 个 Agent 定义），无付费运行。

## 本批发现、未做与边界

- 已修：`task-create` 初版要求游标严格等于 Activation 头，与 prompt 的"逐次推进游标"矛盾（确定性链暴露）。
- 未做（不在第 1 项范围）：`requestTaskInput` 仍要求 Task creator 为 Human，agent 创建的 Task 无法向 Human 请求输入
  （Codex 深度审计亦复现）；reviewer Agent 驳回依赖 reviewerIds，Raft 无"创建时指定 reviewer"合同，
  故出口链的驳回由 Human 执行，reviewer Agent 驳回留待第 3 项 Room 协作模板（默认 reviewer）。
- 既有陷阱（非本批引入）：以 participant+task+operation 构造的幂等键在返工轮次会被去重成空操作；本批仅在 prompt 补救，
  kernel 未改。Codex 审计另报的"多 Thread 合并唤醒回复落到最后一个 Thread"与"成员变化后重试幂等冲突"未在本批处理。
- 过程事实：Codex session 在本批施工期间并未停止（19:50–20:01 执行深度审计并写入文档），
  与本 session 短时共享工作树；经核对它只新增/修改了文档，无代码文件冲突。
