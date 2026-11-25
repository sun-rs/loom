# loom 组织结构（v1，2026-11-25）

依据：RESEARCH-ORCH-0 调研；loom-next 老 Auditor t17w、老 Leader t17g；Solars Auditor t13n、Leader t4c 的实战答卷（briefing/ANSWER-*-roles-ratio.md、ANSWER-*-org.md）。

## 角色
| 角色 | 定位 | 做 | 不做 |
|---|---|---|---|
| Super | 用户 | 定目标、红线、裁决升级事项 | — |
| Auditor（总审 / 用户代言人，常驻，安静） | 用户的默认对接人 | 持有项目章程与判例账本；向用户汇报（读历史与证据，不打扰 Leader）；裁决范围、预算、方法；核原件；合入前复核；监督 Leader 换班；看走偏信号 | 不写产品代码；不直接派 worker；不要求 Leader 复述 |
| Leader（执行督导，常驻） | 执行吞吐与交付真实性 | 把裁决拆卡、派 worker、守门禁、集成合入；监督 Auditor 换班 | 不对用户写长篇汇报（被问时一句状态） |
| Worker | 施工 | 按卡施工，三行最终回复；越过预算/事实不符/设计缺口即 BLOCKED | 不发消息、不自报统计 |
| Reviewer（一次性对抗审查，按需，15–30 分钟） | 补两者盲区 | 只读、无历史包袱，只回答一个"能不能出错"的命题 | 不跑大测试；用完即收 |

## 规则
1. 用户消息永远插队：任何角色收到 Super 消息，排在 worker 结果之前，在下一轮最先处理。
2. 并发：活跃写代码 worker 默认 2–3，硬上限 4；更多先拆成独立协调域。
3. 换班交叉监督：Leader 换班由在任 Auditor 监督，Auditor 换班由在任 Leader 监督；两者不得同时换，至少错开一个任务阶段；只在任务卡边界换；新会话首轮报到中的 SHA/路径必须现查（loomd 机械核验）。
4. 走偏信号（loomd 机械检测，报给 Auditor）：预算反复上调或实际净行数超预算；单次测试/编译耗时明显变长；计划文件膨胀；同类失败第二次出现；首次出现查无此物的 SHA/路径/指标。
5. Auditor 根据门禁包及 Reviewer 结论审查，深入核查交给临时 Reviewer。审查最多 2 轮，仍阻塞升级 Super 改设计。Auditor 自查验收要求是否过重。
6. 派卡模板：目标、可写范围、预算上限、测试行数不超过产品行数、只跑受影响的测试、停工触发器、三行回报格式。
7. 不新增常驻角色。不做缓存保活。


## 补充纪律（2026-11-25，用户裁决）
- **worker 一律由 OAR 管理。** 特殊形态的 worker，比如 Claude TUI worker，也要按 OAR 的 runtime 规范来写，不另开一条只属于 loom 的通路。
- **原生 subagent 只用于只读调研。** 高级角色可以用 CLI 自带的 subagent（agy subagent、Claude Task、Codex sub-agent）做回合内的只读调研。凡是改代码、跑测试、长时间运行、需要证据或审查的工作，一律派 loom worker。原因：原生 subagent 的消耗算在父角色身上，loom 也看不到、审不了它做了什么。
- **按门禁边界给 Auditor 换班。** 每完成一道门禁就换一次，避免单个长会话占满成本；Auditor 不与 Leader 同时换班。

## 消耗金字塔（2026-11-25，用户裁决）
目标结构：**worker 消耗最多，Leader 次之，Auditor 最少**。按 token 和调用次数衡量，不按价格。
- **Auditor 只看证据，不重新做一遍工作。**
  - 门禁复核时，只读证据卡、diff 统计和 reviewer 的结论，不通读代码，也不自己跑探针。需要深入核查时，派一个短期 reviewer，这部分消耗记在 reviewer 名下。
  - 只在三种情况下被唤醒：用户消息、门禁裁决（每道门禁一次，材料由 Leader 整理好）、升级事项。
- **Leader 只协调，不施工。**
  - 不自己跑全量测试，也不自己复现问题，这些交给 worker 或 reviewer。
  - 只读三行回执和证据卡。
- **worker 承担实际工作。**
  - 卡片做大一些，自带验收；
  - 测试由 worker 在自己的沙箱里跑完，并附上证据。
- **loomd 统计各角色的调用次数和 token。** `loom cost` 和 `loom status` 显示累计调用、原始 token、新输入和输出，同时检查最近一小时的调用数和原始 token。Claude 写入缓存的输入计入新输入。某项出现倒金字塔（Auditor 高于 Leader，或 Leader 高于 worker 合计）时，loomd 每项目每小时最多提醒 Super 一次。
- **门禁包是常规门禁的单次唤醒。** Leader 用 `loom gate pack <gate-id> --base <ref> --candidate <ref> --question <text>` 固定候选并打包同名 `--wave` 或 `--barrier` 的 Worker/Reviewer 证据，附测试摘要、审查结论、待决问题和指针。默认候选为 `HEAD`，基线为其第一父提交。门禁包保存在 `.project/gates/`，≤2 KB。同一 ID 的重试沿用原门禁包和投递；修订候选时使用新 ID。Reviewer 用与门禁相同的 `--wave` 登记。Auditor 对已打包门禁发起的追加审查将结论记入通知账本，Auditor 随时可查询。
- **Auditor 的门禁预算。** `roles.auditor.maxWakesPerGate` 默认 3，`maxContextTokens` 默认 150000。loomd 计两次门禁完成之间实际开始的原生轮次，含启动、用户消息和升级。当唤醒或当前上下文超限时，提醒 Leader 批量整理材料；Leader 或 Super 用 `loom notifications --gate-complete <gate-id>` 登记下一个安全边界，届时 loomd 建议换班。
