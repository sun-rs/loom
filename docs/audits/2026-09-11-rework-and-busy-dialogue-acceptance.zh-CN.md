# 执行／审计返工与忙时追加验收

沿用 `ac0f486` 产品代码与上轮双Agent隔离门禁，只扩充验收场景。临时角色由Human频道消息指派，未改产品prompt、调度、权限、正式Agent或记忆。模型精确绑定 Kimi `kimi-code/k3 / high` 与 OpenCode `deepseek/deepseek-v4-flash / low`，禁止fallback。

## 顺序与证据

1. `RAH_REAL_DIALOGUE_SCENARIO=rework`：测试仅预置错误交付 `repair-result.txt` 为 `SUM=5`，Human要求审计者读取文件并独立核验1到3的和。审计REWORK → 执行者修复并提及审计者 → 审计PASS → 执行者GOAL。验证原错误值、文件最终为SUM=6、持久消息发送者与Room序号顺序、每个业务标记一次、目标后20秒无新增消息。测试不会中途催促。
2. 上项通过后才运行 `rework-busy`：相同场景，执行者修复前创建标记并等待20秒；测试观察标记且该执行者确有leased Activation，才发送独立追加消息。追加要求单独回复NOTE:ACK，明确保留原修复和再审；原四步仍必须完成。保存追加时活动Activation及服务端发送回执。

`NOTE:ACK`与原修复链分开断言，不把合并一句话视为两项完成。停止条件是目标及消息/队列静止，不是CLI退出即认为业务完成。测试有12分钟上限，不自动重复付费运行掩盖失败；现场始终保留。

## 比较边界

这是用户要求的可验证旅程，不是新发明的产品协议。Raft端尚需以同一错误文件、同一Human临时分工及相同追加时机运行；只有客户端显示和可读取的文件/消息可以作为官方证据，不能推测闭源服务端内部状态。单次本地通过不代表Raft双边一致或所有Provider通过。

## 第一项：返工闭环通过

一次真实运行耗时201秒。审计消息实际报告 `OBSERVED=5` 并指出正确和6；执行者修复文件，再审PASS，执行者发布GOAL，之后20秒无新增消息。没有Human中途催促。证据 `/Users/sun/Code/reviews/rah_os/2026-09-11-rework-busy/rework.log`。

## 第二项的第一次运行：验证器失败，不能计作通过

实际消息已有REWORK、忙时追加Human消息、REPAIR:DONE、独立NOTE:ACK、AUDIT:PASS、GOAL，文件也已修正。但验证器只接受 `OBSERVED=5`，模型按原文件值输出 `OBSERVED=SUM=5`，导致解析断言失败，停止观察未执行完。因此该次不能作为完整通过样本。

新增确定性解析测试先红，修正后绿：接受同一数值的两种表达，仍拒绝6、50及仅提到预期值而没有OBSERVED的文本。产品代码不变。保留原失败日志 `busy-first-harness-failure.log`，修正后单独重新执行完整忙时场景，不用离线重解释覆盖失败。

## 第二项重跑：完整通过

修正验证器后真实重跑耗时333秒，通过原修复链、独立追加确认、目标与20秒停止观察。业务消息顺序：REWORK → Human忙时追加 → REPAIR:DONE → AUDIT:PASS → NOTE:ACK → GOAL:DONE。独立读取账本另确认修复、备注与目标具有三个不同Message ID，追加created_at落在lead实际RunAttempt的started_at/finished_at之间；不是仅凭UI busy标志判断。

8个Activation全部completed，8个RunAttempt为exited，8个Runtime进程terminated。新增Human消息只有测试要求的忙时追加，没有催促。完整输出 `busy-rerun.log` 与第一次失败分开保留。

**性能边界**：该次从追加发布到NOTE:ACK耗时177.857秒。无丢失、无合并不等于低延迟；尚未与Raft同条件实测，不能断言延迟是否对齐，也不能由单样本宣布高可用。

最终 `npm run check`、`npm run format:check`、`git diff --check` 通过。没有产品代码变更、正式数据操作、正式重启、commit或push。Raft双边、其他Provider与多Thread组合仍待验。
