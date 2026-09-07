# Room 任务默认参与者（第 3 项）与监督可见性（第 4 项）

批次日期：2026-09-08。交接第 3、4 项。两项并行施工、合并验证、同一提交。

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
- reviewer 读取 owner 轨迹：新 worker 路由 `/v1/worker/tasks/trajectory` 与 CLI `task-trajectory --task-id [--limit] [--before-sequence]`；
  kernel `listWorkerTaskTrajectory`：调用者须在该 Task 的 Activation 投递范围内且为负责人/协作者/审查者（`task_participants`），
  条目限定 `participant_id = assignee AND room_id = task.room AND recorded_at >= task.created_at`，按 `server_sequence` 倒序分页；
  Task 释放后监督权随之撤销。`run_attempts` 无 `task_id`，故以时间下界而非 Activation 区间限定，已在模块注释说明。
- prompt：审阅段新增一句——记录 Review 前先 `task-trajectory` 读取 owner 的命令与文件改动，并在摘要里引用具体证据。

### 验证

agent-host 393、web 单测 377 全绿；kernel/protocol/service/CLI/compiler 新增 12 个测试。

## 合并验证

- 全仓 `npm test` 984 项：979 通过、0 失败、5 跳过（付费门禁）；`npm run check` 全绿；棘轮 `room-kernel.ts` 6,908/6,925、
  `protocol/src/index.ts` 1,793/1,800。
- 真实出口链门禁（Codex/Kimi/OpenCode，low）通过：360 秒，4 个 Activation 全部 completed，保留现场
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-real-split-chain-iWhGhD`。
- 主业务浏览器旅程 `npm run test:web:browser`（Chrome，390×844）通过。
- 正式实例：Web build `97b32b3c2b3e69fd9334c47a703bc938749d4d93a3aea1d019379b0e863c43c4`，备份
  `~/.rah/backups/pre-restart-0fabe3d3-1a58-4091-9350-2e399567eefa` 已验证，后继 6 秒上线（pid 36653）；
  6 Rooms、43 Messages、2 Tasks、4 Agent 定义不变；v51 迁移建出 `room_task_defaults`（外键指向 rooms，当前 0 行）。

## 边界

- Room 默认参与者只影响 Human 侧两条创建路径；worker `task-create`/`claim-message` 按 Raft 合同不受影响。
- reviewer 轨迹尚未在真实 CLI 出口链中被实际调用（该链的驳回由 Human 执行）；接入默认 reviewer 后的真实 Agent 审阅是下一批的回归项。
- 远程 Computer 的轨迹脱敏依赖各自 Host 的 lease，本批只覆盖本机 daemon 路径。
