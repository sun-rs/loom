# loom 组织结构（v1，2026-11-25）

依据：RESEARCH-ORCH-0 调研；loom-next 老 Auditor t17w、老 Leader t17g；Solars Auditor t13n、Leader t4c 的实战答卷（briefing/ANSWER-*-roles-ratio.md、ANSWER-*-org.md）。

## 角色
| 角色 | 定位 | 做 | 不做 |
|---|---|---|---|
| Super | 用户 | 定目标、红线、裁决升级事项 | — |
| Auditor（总审 / 用户代言人，常驻，安静） | 用户的默认对接人 | 持有项目章程与裁决账本；依据门禁包和集成 Worker 证据裁决；决定范围、预算和方法；监督 Leader 换班 | 源码调查、测试、构建、集成和合入交给执行侧 |
| Leader（执行督导，常驻） | 执行吞吐与交付真实性 | 把裁决拆卡、派 Worker、守门禁、安排集成卡和监督 Auditor 换班 | 不读源代码或测试；不运行测试；不直接集成合入 |
| Worker | 施工 | 按卡施工，三行最终回复；越过预算/事实不符/设计缺口即 BLOCKED | 不发消息、不自报统计 |

## 规则
1. 用户消息永远插队：任何角色收到 Super 消息，排在 worker 结果之前，在下一轮最先处理。
2. 并发：活跃写代码 worker 默认 2–3，硬上限 4；更多先拆成独立协调域。
3. 换班交叉监督：Leader 换班由在任 Auditor 监督，Auditor 换班由在任 Leader 监督；两者不得同时换，至少错开一个任务阶段；只在任务卡边界换；新会话首轮报到中的 SHA/路径必须现查（loomd 机械核验）。
4. 走偏信号由 loomd 记录，附在 Leader 下一次实际唤醒，并纳入所属门禁包。信号包括预算反复上调或实际净行数超预算、测试或编译变慢、计划文件膨胀、同类失败再次出现、事实核验和 Worker 卡死。
5. Leader 打包固定候选的 Worker 证据。Auditor 依包裁决，遇到异常时可就同一门禁启动一次临时只读 Reviewer。审查最多 2 轮，仍阻塞升级 Super 改设计。Auditor 自查验收要求是否过重。
6. 派卡模板：目标、可写范围、预算上限、测试行数不超过产品行数、只跑受影响的测试、停工触发器、三行回报格式。
7. 不新增常驻角色。不做缓存保活。


## 补充纪律（2026-11-25，用户裁决）
- **worker 一律由 OAR 管理。** 特殊形态的 worker，比如 Claude TUI worker，也要按 OAR 的 runtime 规范来写，不另开一条只属于 loom 的通路。
- **调查和施工分派给执行侧。** Worker 负责有交付物的任务。Auditor 确需复核原件时按门禁发起一次临时、可追溯的只读核查。

## 消耗金字塔（2026-11-25，用户裁决）
目标结构：**worker 消耗最多，Leader 次之，Auditor 最少**。按 token 和调用次数衡量，不按价格。
- **Auditor 只看证据，不重新做一遍工作。**
  - 门禁复核使用证据卡和 diff 统计。确需读原件时，Auditor 可用 `loom spawn reviewer --wave <gate-id>` 启动一次临时只读核查，默认限时 30 分钟，只答一个问题。有效结论回送一次，计入 Auditor 的 `maxWakesPerGate`。
  - loomd 只允许用户或 Super 消息、Leader 的门禁包或红色升级、Auditor 主动发起的追加审查结论，以及换班监督唤醒 Auditor。Leader 的投递停滞可由 loomd 发出一次基础设施告警。
- **Leader 负责协调（R21）。** 使用门禁包、三行回执、证据卡、`loom hist` 摘要、`git diff --stat` 和 `loom status`。源码、测试和缺陷诊断交给 Worker。Auditor 若转来临时核查结果，用 `loom send` 把原文的回执文件路径转给 Worker 卡片。Leader 在下一次正常唤醒接收 loomd 推送的证据摘要。
- **worker 承担实际工作。**
  - 卡片做大一些，自带验收；
  - Worker 在自己的沙箱运行测试并记录验收证据。候选分支集成、固定候选 SHA 的全量测试和获授权合入也由集成 Worker 按卡执行。
- **loomd 统计各角色的调用次数和 token。** `loom cost` 和 `loom status` 显示累计调用、原始 token、新输入和输出，同时检查最近一小时的调用数和原始 token。Claude 写入缓存的输入计入新输入。某项出现倒金字塔（Auditor 高于 Leader，或 Leader 高于 worker 合计）时，loomd 每项目每小时最多提醒 Super 一次。
- **每轮门禁包唤醒一次。** Leader 用 `loom gate pack <gate-id> --round <n> --base <ref> --candidate <ref> --question <text>` 快照同名 `--wave` 或 `--barrier` 的 Worker 证据、已有审查结论和待决问题。省略 `--round` 自动创建下一轮。只有 `--reuse` 才沿用已保存的快照和投递 ID。`.project/gates/` 的短包在每处缩略旁附完整段落路径。
- **Leader 与 Auditor 共用换班预算。** 两个角色的 `maxContextTokens` 默认 150000，可分别设置 `rotateAt: "gate"`。Leader 或 Super 用 `loom notifications --gate-complete <gate-id>` 登记门禁完成。Leader 的最近一次原生调用输入超过预算，或配置了门禁换班且已完成门禁时，loomd 在无卡片在途、无其他换班进行时写入换班建议。每个 Leader 地址一次，Super 和 Auditor 可用 `loom status` 或 `loom notifications --history` 查看，由 Super 安排接班。
- **Auditor 的额外门禁预算。** `roles.auditor.maxWakesPerGate` 默认 3，计两次门禁完成之间实际开始的原生轮次，含启动、用户消息、升级和追加审查结论。loomd 在每次预算评估和门禁完成时重新采样，意见附采样时间。两角色的换班共用持久化互斥约束。
- **Leader 的交接确认。** `loom spawn leader --handover-from` 把开放卡片、波次、续作、投递、近期门禁裁决和项目文件指针存入完整的 SHA-256 回执文件。继任者的首轮原生回复带回文件末尾的确认码后，loomd 绑定路由并退休前任。在途结果随后按原投递 ID 交付。简报交付受投递 SLA 监测，停滞时通知 Super。
- **高级角色工具守卫。** Leader 和 Auditor 启动时默认启用 `roles.<role>.toolGuard`。Loom 命令、`.project/` 读写、Git 摘要和最多 200 行的定点读取照常使用。测试、构建、Git 集成、广域读取和循环查状态优先派 Worker。必要时在原工具被拒后用 `"$LOOM_BIN" senior-tool --reason "理由" -- "命令"` 重试。loomd 认定 Worker、OAR 或投递不可用时可省略理由，按 `worker-unavailable` 登记。输出只保留末尾 40 行，最多 12 KB。每次拒绝和重试可在 `loom status` 与 `loom hist` 查看，每角色每门禁第 4 次重试提示 Super。
- **工具输出漂移。** loomd 对 Leader 和 Auditor 各统计最近一小时的工具输出，按测试、读取、Git、Loom 状态回执及其他归类。新增上下文达到 5000 token 且工具输出估计占比超过 35% 时，通知 Super 检查分工或卡片设计。

## 消息路由（R20，2026-11-25）

- Worker 的首轮和批量续作结果发给 Leader。请求 `loom send --expect-reply` 后，回送匹配到的第一条结论标签，放在回复正文开头，并保留完整回复。门禁请求与高级角色显式请求的无标签结论也回送，并标记「未带结论标签」。纯确认和 `NOREPLY` 记录原因，在发送者的下一次唤醒和 `loom status` 中显示。Auditor 主动请求的回复可回送一次，自动回送到此结束。
- Leader 核实红色事项后可运行 `loom escalate <gate-id> --reason REASON --evidence TEXT`。原因限 `protected-file`（保护或越界文件）、`assertion`（删除或削弱断言）、`skip-only`、`confirmed-fact-miss`、`sandbox-escape`。升级附证据，和门禁包共用每门禁一次的投递额度。额度已用时，结论记入通知账本，供查询。
- Worker 的卡死、事实核验和其他常规信号随 Leader 的实际消息送达。`loom status --json` 可查看完整信号及被白名单过滤的投递。旧项目中的 `drift.deferAuditorNotices` 字段可继续读取，路由由本规则统一执行。
- Auditor 用 `loom notifications --needs-decision TEXT --kind decision` 请求 Super 裁决。阶段或目标完成用 `loom notifications --complete TEXT --phase ID` 登记。成功回执给出登记 ID 和推送去向。同一阶段的不同正文会报冲突。省略阶段时按完整正文去重。无可用推送路线时返回非零，已登记事项留在待投递列表。
- Leader 用 `loom notifications --gate-complete ID` 登记门禁结束。常规合入回告若被静默规则过滤，发送者会收到明确回执，正文随 Auditor 的下一次允许投递附送。需要 Auditor 再作裁决时才提交新门禁轮次。

### 投递没到就必须有人知道

- Leader 和 Auditor 等待结果超过预期时，运行 `loom status` 查看置顶的停滞投递。Worker 已出结果、Leader 尚未收到时，卡片显示 `result-undelivered`。
- loomd 在发送方的下一次唤醒附上尚未送达的 ID、目标、原因和时长。Leader 的收件阻塞升给 Auditor。Auditor 的收件阻塞经桌面提示和 `loom notifications` 升给 Super／用户。告警按投递 ID 去重，按项目节流。
