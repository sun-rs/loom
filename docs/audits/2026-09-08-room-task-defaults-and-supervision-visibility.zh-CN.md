# 监督可见性（第 4 项）与 Room 任务默认参与者的实施与回退（第 3 项）

批次日期：2026-09-08。交接第 3、4 项。两项并行施工后，用户当日裁决："现阶段复刻 Raft，审计是 Human 在 Room 里通过对话
临时指派某个 Agent 去做的事，不在系统里预设角色；要实现的是基础工具而不是定制化人物。"据此：第 3 项整体回退，
第 4 项的 reviewer 轨迹读取改为 Raft 的频道成员语义。本文保留第 3 项的实施记录作为历史，并记录回退。

## 第 3 项：Room 任务默认参与者

### 证据与定性

Raft 无对应合同：`agentApiContract.ts` 全文无 `reviewer`/`collaborator`/`default_assignee`；`agentApiTaskCreateBodySchema`
（359–369 行）只有单一可选 `assignee`；频道没有设置 schema；冻结官网 bundle 里 `assignee` 36 处全为单数，唯一 `reviewer`
命中是设计 QA 页文案。**这是纯 RAH 扩展**，由用户在 2026-09-08 明确要求推进，服务"主 Agent 干活、助手协助、审计监督"场景。
约束：ADR-0020 第 5 条"Web/PWA 只提交显式 Human 选择"——默认值只做客户端预填且必须可见，服务端不注入。

### 实现

- kernel：新表 `room_task_defaults(room_id PK REFERENCES rooms, default_assignee_id, default_collaborator_ids_json,
default_reviewer_ids_json, updated_at)`，schema v51 迁移（含对无外键预发布表的重建）；owner 模块 `room-task-defaults.ts`
  （读路径过滤非成员、无负责人则清空次要角色；写路径校验全部为启用的 Agent 成员）；`room.updated` 事件携带 `taskDefaults`；
  成员移除、退出、Agent 墓碑三条路径写侧清理；Room 擦除器覆盖新表。
- protocol：`RoomTaskDefaultsSchema`（唯一、负责人不在两表、两表互斥、无负责人不得有次要角色）；`ClientRoomSchema` 与
  `ClientRoomUpdateRequestSchema` 可选 `taskDefaults`。`/v3/client/tasks/create` 处理器未改动。
- web：Room 设置对话框新增"任务默认参与者"块（复用 `TaskParticipantFields`，仅脏时发送）；看板"新建任务"用默认值预填，
  标题页上方显示一行"默认参与者：负责人 @x · 协作 @y · 审查 @z"并紧邻"配置协作与依赖"入口；编辑器切到"作为任务"时
  在草稿未动过的前提下预填，参与者字段随即可见；无默认值时行为与此前完全一致。

### 验证

kernel/protocol/application-service 新增 15 个测试（含删除 Room 擦除、墓碑清理、Human/worker 创建 Task 不受默认值影响）；
web 新增 7 个源码合同测试。`node scripts/ui-behavior-registry.mjs` 有效，无需新增登记。

### 回退（同日）

上述 kernel/protocol/web 实现全部移除（提交 `3eb30ab` 中属于第 3 项的部分）：删除 `room-task-defaults.ts` 及三层测试；
`schema.ts` 不再建表，`migrateDropRoomTaskDefaultsV52` 以幂等 `DROP TABLE IF EXISTS room_task_defaults` 清理已跑过 v51 的库
（正式库该表为 0 行）；`ClientRoomSchema` 因仅为此而生一并移除；Room 设置、新建任务弹窗、编辑器恢复到回退前形态。
仓库内 `taskDefaults`/`room_task_defaults` 仅剩删表迁移两处。既有的 `collaboratorIds`/`reviewerIds` kernel 机制（ADR-0020）保留但不再扩展。

## 第 4 项：监督可见性

### 证据

Raft 官方截图（`~/Code/repos/raft_snapshot/*.png`）显示 `Running command /bin/zsh -lc '…'`、`Editing file …`；
Raft hook 截断 4096 字符，RAH `runtime-activity.ts:70` 已一致。对交接稿两处说法的核实：Kimi ACP **有**填 `toolInput`
（来自 `rawInput`），真正的问题是把 ACP 的展示 `title` 当 `toolName`，永远对不上标签表；网页标签表确实缺大写 `Bash`。
另发现：轨迹帧走 fd 3 独立管道，`toolInput`/`text`/`detail` 完全绕过凭据脱敏。

### 实现

- `provider-trajectory-normalizer.js`：Kimi 按 ACP `kind` 映射规范工具名（execute→bash、edit、read、search→grep、
  fetch→webfetch…），`rawInput` 中数组形式的 command 拼成字符串；Codex `fileChange` 的 `toolInput` 补 `filePath`
  （changes 首键），`imageGeneration` 补 prompt。
- `identity-presentation.ts`：标签表补 `Bash`、`Grep`、`Glob`、`MultiEdit`、`NotebookEdit`、`delete`、`move`、`think`、
  `webfetch`/`WebFetch`/`WebSearch`、`Task`；提取键补 `file`、`notebook_path`、`url`。
- `generic-process-adapter.ts`：`RuntimeTrajectoryCollector` 用与 `BoundedOutput` 相同的 lease 脱敏组件，在记录前脱敏
  `toolInput`/`text`/`detail`/`title`；fd-3 端到端测试证明 worker 凭据不再进入轨迹。
- 任意 Room Agent 成员读取 owner 轨迹（Raft 频道成员语义）：新 worker 路由 `/v1/worker/tasks/trajectory` 与 CLI
  `task-trajectory --task-id [--limit] [--before-sequence]`；kernel `listWorkerTaskTrajectory`：Task 须在调用者的 Room，调用者须是
  该 Room 已启用的 Agent 成员，不要求任何 Task 角色，也不要求该 Task 在调用者的 Activation 范围内（Human 事后 @ 指派的审计者也能读）；
  无负责人的 Task 无可监督轨迹（Forbidden）。条目限定 `participant_id = assignee AND room_id = task.room AND recorded_at >= task.created_at`，
  按 `server_sequence` 倒序分页。`run_attempts` 无 `task_id`，故以时间下界限定，已在模块注释说明。
- prompt：消息处理段新增无角色句——"没有预设的 reviewer/auditor 角色：当 Human 或其他 Agent 要求你审阅、审计或检查某个 Task，
  用 `task-trajectory`、`task-get`、`task-submission` 读取 owner 记录的命令与文件改动，在该 Task 的 Thread 里引用具体证据回复，
  不凭 owner 的自述判断"；既有 `task.submitted` 审阅段的措辞同步改为引用轨迹证据。

### 验证

agent-host 393、web 单测 377 全绿；kernel/protocol/service/CLI/compiler 新增 12 个测试。

## 合并验证（回退与语义调整之后）

- 确定性出口链 `agent-task-split-chain.test.ts` 新增第 4 个 Agent `auditor`：两个子任务首次提交后，Human 发
  `@auditor please audit Subtask A [AUDIT <id>]`（仅 @auditor）；auditor 无任何 Task 角色，调用 `task-trajectory` 后在 Room 回复
  "Audit of <id>: n trajectory entries; tools: bash"，断言其命中 helper-a 实际记录的工具且 auditor 未认领任何 Task；随后 Human 驳回、
  返工、验收照旧。连续 4 次运行确定性通过。fake CLI 新增两个受环境变量门控的行为（owner 发布一条 `tool_start`；被 @ 且带 `[AUDIT]`
  标记时读轨迹并回复）。
- 全仓 `npm test` 970 项：965 通过、0 失败、5 跳过；`npm run check` 全绿；棘轮 `room-kernel.ts` 6,907/6,925。
- 真实出口链门禁（Codex/Kimi/OpenCode，low）在新 prompt 下通过：411 秒，6 个 Activation 全部 completed，保留现场
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-real-split-chain-0cewCT`。
- 主业务浏览器旅程在回退前通过（Chrome，390×844）；回退使 Web 回到已验收形态，未再单独跑。
- 正式实例：Web build `5ea31a289fa5619d67c06bf243cc4e20e09249615944d862f0ed4715551f88bd`，备份
  `~/.rah/backups/pre-restart-31695f8f-0e09-4bf5-ba8c-3ea40577acc0` 已验证，后继 6 秒上线（pid 62800）；
  6 Rooms、43 Messages、2 Tasks、4 Agent 定义不变；v52 迁移已删除 `room_task_defaults` 表。

## 边界

- 真实 CLI 出口链里的驳回仍由 Human 执行；临时审计者读轨迹的路径目前只在确定性链里验证，真实 CLI 的审计回复留待后续按需运行。
- 远程 Computer 的轨迹脱敏依赖各自 Host 的 lease，本批只覆盖本机 daemon 路径。
