# TODO-SLA-1：统一待办表与环节时限提醒（2026-11-28，用户已批准）

设计依据：`docs/research/2026-11-28-todo-sla-unified.md`，第 6 节的修订优先于前文。

## 用户裁决（2026-11-28），优先于设计稿
1. **一张表，三种用法。** loomd 的待办/状态表是唯一真源，同时服务三处：
   - 用户 TUI 的提醒和状态速览，这是最主要的用途；
   - 系统提醒；
   - 高级角色主动查询（`loom status --todo`、`loom status --json`）。
   三处不得各存一份状态。
2. **不做 Alma 推送。** 给用户的提醒以 `loom status --tui`（交互界面）为主。macOS 桌面通知只作为可选回落，默认关闭。
3. **控制提示词开销。** 提醒尽量不写进模型上下文：
   - 角色要了解状态时，自己调用 `loom status --todo` 查询；
   - 确需推送给模型时，搭在下一次正常投递里，并且合并，每次不超过 6 行。
   - 本卡需要给出"每回合注入字节数"的前后对比，并加回归测试，确保不超过预算。

## 范围
1. **待办模型。** 字段：id、kind、project、subject、owner（角色别名，可为 user）、stage、createdAt、stageEnteredAt、pausedFor[]、escalations[]、resolved*。数据持久化，重启后保留。
2. **自动建项。** 以下事件发生时自动建待办：BLOCKED、expect-reply、needs-decision、gate 打包、换班首报、host-run、投递。
   - 手动建：`loom status --todo-add "<subject>" --owner X --due <时长>`，没有 `--due` 就拒绝。Worker 不能手动建。
   - 机械办结：主体事件已发生，或主体已被取代（`superseded`）时自动关闭。
3. **SLA。** 默认值见第 6 节，项目可在 policy.json 覆盖。
   - 计时扣除暂停时段，暂停原因包括：等额度或 429、冷启动、CCP 不可用、卡在弹框、等用户。
   - 升级链：办理人 → 上级 → Super → 用户，到用户为止。
   - 每一级只升级一次，并去重。
   - 办理人催不动的情况直接升级，比如投递停滞、办理人被弹框卡住。
4. **TUI。** `loom status --tui [--all]` 首页改为读待办表，显示：
   - 每个项目谁手上有几件、最老的一件等了多久、哪些已逾期（按严重度排序）；
   - 单击可看环节历史和建议动作。
   项目的 Status 页也读同一张表。
5. **查询接口。**
   - `loom status --todo [--project] [--owner] [--overdue] [--json]`，输出要短。
   - 新 Super 首轮、Leader 和 Auditor 换班首投时，只附"你名下逾期待办"的计数和最老 3 条，每条一行。
6. **迁移。**
   - 现有未关闭的 notifications 导入待办表：createdAt 保留用于展示，SLA 从迁移时刻开始计时。
   - 已失效的标记 `migrated-stale`，其余汇总成一条消息交给 Super。旧数据只读归档。
   - 在同一版本内停用 IDLE-ALARM、30 分钟重提醒、DLV 停滞这几套旧计时器，不与新机制并行。

## 验收
- 测试先行，覆盖：
  - 各 kind 的建立、办结、转办，换班时计时不清零；
  - 暂停后的计时；
  - 升级去重；
  - 迁移；
  - TUI 快照；
  - 注入预算的回归测试。
- 回放本周三起事故，都必须在 SLA 内出现在 TUI 上，并升级到正确的人：
  - pilot-2 5 小时无进展；
  - 2c0fc285 卡了 10 小时；
  - pilot-cell 请示等了 8 小时。
- 固定 Node 26，全量测试 0 fail / 0 cancelled / 0 skipped。
- 每条消息不得增加模型请求。

## 命令面约束（用户 2026-11-28）
"能合并进 loom status 的就合并，别搞太多的 loom xxxx，最后用户记不住，高级角色调用聊天也乱；可以通过 -- 参数区分内容。"
- 本卡**不得新增顶层子命令**。查询类能力一律作为 `loom status` 的参数，例如 `--tui`、`--todo`、`--card`、`--json`、`--project`、`--owner`、`--overdue`。
- 旧命令保留为兼容别名，帮助里标注"已并入 `loom status --…`"。
