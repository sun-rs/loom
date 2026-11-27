# loom 组织结构（v1，2026-11-25）

依据：RESEARCH-ORCH-0 调研；loom-next 老 Auditor t17w、老 Leader t17g；Solars Auditor t13n、Leader t4c 的实战答卷（briefing/ANSWER-*-roles-ratio.md、ANSWER-*-org.md）。

## 角色
| 角色 | 定位 | 做 | 不做 |
|---|---|---|---|
| Super | 用户 | 定目标、红线、裁决升级事项 | — |
| Auditor（总审 / 用户代言人，常驻，安静） | 用户的默认对接人 | 持有项目章程与裁决账本；依据门禁包和集成 Worker 证据裁决；决定范围、预算和方法；监督 Leader 换班 | 源码调查、测试、构建、集成和合入交给执行侧 |
| Leader（执行督导，常驻） | 执行吞吐与交付真实性 | 把裁决拆卡、派 Worker、守门禁和安排集成卡 | 不读源代码或测试；不运行测试；不直接集成合入 |
| Worker | 施工 | 按卡施工，三行最终回复；越过预算/事实不符/设计缺口即 BLOCKED | 不发消息、不自报统计 |

## 规则
1. 用户消息永远插队：任何角色收到 Super 消息，排在 worker 结果之前，在下一轮最先处理。
2. 并发：活跃写代码 worker 默认 2–3，硬上限 4；更多先拆成独立协调域。
3. Leader 和 Auditor 在安全点写交班判断，用 `loom rotate --self` 启动同配置接任者。同一项目一次只交接一个角色。在途卡片须写入交班单。新会话首轮报到中的 SHA 和路径须现查。Leader 的交班结果随 Auditor 的正常投递附送，Auditor 的交班结果通知 Super。
4. 走偏信号由 loomd 记录，附在 Leader 下一次实际唤醒，并纳入所属门禁包。信号包括预算反复上调或实际净行数超预算、测试或编译变慢、计划文件膨胀、同类失败再次出现、事实核验和 Worker 卡死。
5. Leader 打包固定候选的 Worker 证据。Auditor 依包裁决，在阶段边界核查确定性结果和 Worker 证据，抽一条已记录的命令交给 Worker 重跑。审查最多 2 轮，仍阻塞升级 Super 改设计。Auditor 自查验收要求是否过重。
6. 派卡模板：目标、可写范围、预算上限、测试行数不超过产品行数、只跑受影响的测试、停工触发器、三行回报格式。
7. 不新增常驻角色。不做缓存保活。


## 补充纪律（2026-11-25，用户裁决）
- **worker 一律由 OAR 管理。** 特殊形态的 worker，比如 Claude TUI worker，也要按 OAR 的 runtime 规范来写，不另开一条只属于 loom 的通路。
- **调查和施工分派给执行侧。** Worker 负责有交付物的任务。Auditor 确需复核原件时按门禁发起一次临时、可追溯的只读核查。

## 消耗金字塔（2026-11-25，用户裁决）
目标结构：**worker 消耗最多，Leader 次之，Auditor 最少**。按 token 和调用次数衡量，不按价格。
- **Auditor 只看证据，不重新做一遍工作。**
  - 门禁复核使用证据卡和 diff 统计。Auditor 在阶段边界核查固定候选与原件，依 Worker 证据卡核对测试。旧配置中的 `roles.reviewer` 会触发迁移提示并被忽略。
  - loomd 只允许用户或 Super 消息、Leader 的门禁包或红色升级、Auditor 主动发起的追加审查结论，以及换班监督唤醒 Auditor。Leader 的投递停滞可由 loomd 发出一次基础设施告警。
- **Leader 负责协调（R21）。** 使用门禁包、三行回执、证据卡、`loom hist` 摘要、`git diff --stat` 和 `loom status`。源码、测试和缺陷诊断交给 Worker。Auditor 若转来临时核查结果，用 `loom send` 把原文的回执文件路径转给 Worker 卡片。Leader 在下一次正常唤醒接收 loomd 推送的证据摘要。
- **worker 承担实际工作。**
  - 卡片做大一些，自带验收；
  - Worker 在自己的沙箱运行测试并记录验收证据。候选分支集成、固定候选 SHA 的全量测试和获授权合入也由集成 Worker 按卡执行。
- **loomd 统计各角色的调用次数和 token。** `loom cost` 和 `loom status` 显示累计调用、原始 token、新输入和输出，同时检查最近一小时的调用数和原始 token。Claude 写入缓存的输入计入新输入。某项出现倒金字塔（Auditor 高于 Leader，或 Leader 高于 worker 合计）时，loomd 每项目每小时最多提醒 Super 一次。
- **每轮门禁包唤醒一次。** Leader 用 `loom gate pack <gate-id> --round <n> --base <ref> --candidate <ref> --question <text>` 快照同名 `--wave` 或 `--barrier` 的 Worker 证据、已有审查结论和待决问题。省略 `--round` 自动创建下一轮。只有 `--reuse` 才沿用已保存的快照和投递 ID。`.project/gates/` 的短包在每处缩略旁附完整段落路径。
- **Leader 与 Auditor 的换班。** 项目默认使用 `rotation.mode: "explicit"`。在此模式可主动交班，也可显式设置 `rotateAt: "gate"`、`maxContextTokens`、`maxContextFraction` 或 `minRemainingAfterCompaction`。最后一项只在已有一次成功压缩、其后的剩余比例再次低于配置值时触发。未知窗口保留为空。
- **Auditor 的门禁唤醒预算。** `roles.auditor.maxWakesPerGate` 默认 3，计两次门禁完成之间实际开始的原生轮次，含启动、用户消息、升级和追加审查结论。超额时向 Super 发一次组织流程通知，后续采样更新同一条记录。唤醒次数独立于换班策略。
- **接任简报。** loomd 将章程、判例账本、当前事实卡、开放卡片和投递清单存入 SHA-256 回执文件。v2 的继任首报由另一方核实后才绑定路由并退休前任。简报投递受投递 SLA 监测。
- **高级角色工具守卫。** Leader 和 Auditor 启动时默认启用 `roles.<role>.toolGuard`。Loom 命令、`.project/` 读写、Git 摘要和最多 200 行的定点读取照常使用。测试、构建、Git 集成、广域读取和循环查状态优先派 Worker。必要时在原工具被拒后用 `"$LOOM_BIN" senior-tool --reason "理由" -- "命令"` 重试。loomd 认定 Worker、OAR 或投递不可用时可省略理由，按 `worker-unavailable` 登记。输出只保留末尾 40 行，最多 12 KB。每次拒绝和重试可在 `loom status` 与 `loom hist` 查看，每角色每门禁第 4 次重试提示 Super。
- **工具输出漂移。** loomd 对 Leader 和 Auditor 各统计最近一小时的工具输出，按测试、读取、Git、Loom 状态回执及其他归类。新增上下文达到 5000 token 且工具输出估计占比超过 35% 时，通知 Super 检查分工或卡片设计。

## 高级角色换班 v2

在项目策略设置 `rotation.mode: "v2"`。建议先有在位的 Leader、Auditor 和 Super。Unix socket 使用 SOCK-AUTH-1 的角色凭证，既有会话用内核对端验证。外部 Super 使用 `LOOM_EXTERNAL_SUPER=1`。托管角色继续使用 `"$LOOM_BIN"`。

- 在卡片已结算且角色空闲时，跨项目或 Git 根、主目标重置、授权变化、连续两次经另一方核实的硬约束漏派、反复核实错误、或同会话两条裁决被取代可提出换班。普通门禁只更新边界。同项目的 integration、regression 等子阶段提供干净窗口和加严核对提醒。Super 本身不进入自动换班流程。
- 默认比较过去 24 小时的去重卡片数 >10、子系统数 >4、原生压缩次数 ≥5，任一达到阈值后进入加严核对，并在下一个干净边界提示评估换班。计数本身只触发核对和评估。单主线且只有一个子系统时，卡片阈值放宽为 >20。可用 `rotation.densityRequiresCompaction: true` 要求切换和压缩都达到阈值。路径优先匹配最长 `rotation.subsystemPrefixes`，再按顶层目录分组。文档、卡片说明、运行元数据和账本目录不计子系统。统计使用派卡记录、交付的提交差异和原生压缩事件，缺少原生用量时保留缺测。
- 第三次原生压缩、连续运行 48 小时及进入新阶段都会随下一次已有投递提示用命令现查每项 SHA、路径和数值。加严期间按原生轮次每 150 轮附账本检查。阈值可设置 `rotation.strictCompactions`、`rotation.strictRuntimeMs`、`rotation.ledgerTurns`。
- loomd 在派工和待审交接单中探查缺失路径、Git SHA 及与当前引用不一致的 SHA，并按工作卡位统计重复故障原因。`rotation.repeatedWorkerFailures` 默认 3。命中是异常候选。另一方核对原件并登记确认后才计已核实错误。候选和审查回执见 `loom status --json` 的 `rotationPolicy`。
- 默认绝对高水位为 Claude 675,000、Codex 210,000、agy 420,000。用 `rotation.highWaterTokens` 分 CLI 覆盖或设为 `null`。高水位进入只读核对并在边界建议换班。用户纠正、原生阻塞超过 30 分钟、模型或 CLI 版本变更各自登记。阻塞或版本变更只有实际发生接任时才计一笔被动换班。
- `rotation.protectedRefs` 为项目指定的完整受保护分支名列表。启用后，先在隔离工作树定稿目标提交和审核证据。Leader 或 Super 用 `loom notifications --gate-complete GATE --candidate SHA` 登记已收到 Auditor 明确批准的精确 SHA。该授权只消费一次。受保护分支移到未授权目标、被删除或失去祖先关系时，loomd 记 P0 并冻结其执行责任角色。普通门禁结算仍用 `--gate-complete GATE`。
- 正常换班由在位的另一方先核对拟交接单的 SHA、路径和在途事项。loomd 用交接单与当时仓库、在途状态绑定核对回执。事实变化则重新出单。P0 保留即时冻结和启动，首轮提供独立生成的事实卡。
- 按 [交接模板](../skills/loom/modules/rotation.md) 填全部标题。继任按 [首轮核验](../skills/loom/modules/successor.md) 只核对事实卡，首行写确认码，逐行写 `HEAD:`、`Branch:`、`Base SHA:`、`WIP:`、`Rulings:`，以及原件路径。WIP 包含 Git 已跟踪改动的增删行数和未跟踪文件数。有差异在第二行写 `MISMATCH` 并停止。
- 另一方收到核实信封后登记通过或失败。通过后 loomd 绑定继任并退休前任。继任收到「接管生效」信封后才释放改投工作。失败回退前任并锁同阶段。首报发出后 30 分钟未获核实会通知 Super，交接继续待定。Super 可取消该次等待，或让另一方继续核实。另一方继续核对接任后首个完整阶段的派工、门禁和审计决定。此窗口及未结决定核对期间禁止另一方常规换班。以阶段开始后登记完成或再进入新阶段作为完整阶段证据。
- loomd 在压缩后首次托管投递、换班的首份简报和长等待后的首次托管投递附事实卡。等待阈值默认一小时，由 `rotation.longIdleMs` 配置。新任当日改变合入时机、并发上限和预算需要另一方或 Super 确认。Project socket 与支持该版本工具守卫的运行时均执行只读和规则限制。已经启动的旧版无头 CLI 若固定了旧钩子，其原生工具限制随下一次运行时启动更新。

| 命令 `loom rotation-policy` | 角色及字段 |
| --- | --- |
| `scope --phase ID` 或 `scope --goal ID` | Super 登记子阶段或主目标。 |
| `ruling --target ROLE --detail TEXT --evidence FILE[:LINE]` | Super 登记影响该角色的职责或授权裁决。普通取代可附 `--id NEW --supersedes OLD`。账本的编号标题与 `取代 OLD` 行也可自动识别。 |
| `incident --target ROLE --verdict overreach\|fabrication --detail TEXT --evidence FILE[:LINE]` | Super 或另一方登记 P0 原件。loomd 冻结写入并立即启动接任。 |
| `error --target ROLE --detail TEXT --evidence FILE[:LINE]` | Super、另一方或当事角色登记已核实的事实错误。首次进入加严核查，此后新增错误在干净边界换班。 |
| `spot-check --target leader --id DELIVERY --verdict ok\|error --detail TEXT --evidence FILE[:LINE]` | Auditor 在收到门禁包后登记抽查，`ok` 也计入分母。 |
| `audit --id CARD --verdict return\|pass --detail TEXT` | Auditor 登记独立审查往返。门禁回执也从原生裁决提取。连续三次退回通知 Super。 |
| `correction --target ROLE --detail TEXT` | Super 登记用户纠正。当事角色需要同时给出已收到的用户或 Super 投递的 `--id`。 |
| `profile --target ROLE --version TEXT --detail TEXT` | Super 登记版本变更。确认过的被动原因也可用 `loom rotate --target ROLE --passive`。 |
| `constraint --target ROLE --id DELIVERY --verdict omitted\|present --detail TEXT --evidence FILE[:LINE]` | 受管的另一方对已送达的派工登记硬约束证据。 |
| `verify-note --target ADDR --id REQUEST --verdict pass\|fail --detail TEXT --evidence FILE[:LINE]` | 在位另一方核对同一请求的交接单。通过后 loomd 才启动常规继任。 |
| `verify-decision --target ADDR --id DECISION --verdict pass\|fail --detail TEXT --evidence FILE[:LINE]` | 原核对方登记新任首阶段决定的原件检查。 |
| `verify --target ADDR --verdict pass\|fail --detail TEXT --evidence FILE[:LINE]` | 在位的另一方核实继任首报。 |
| `abort --target ADDR --detail TEXT` | Super 可取消核实已超时的交接，恢复前任。 |
| `rule-change --target ADDR --id merge\|concurrency\|budget --detail TEXT --evidence FILE[:LINE]` | Super 或另一方确认接任当日的一项规则变更。 |

## 消息路由（R20，2026-11-25）

- Worker 的首轮和批量续作结果发给 Leader。请求 `loom send --expect-reply` 后，回送匹配到的第一条结论标签，放在回复正文开头，并保留完整回复。门禁请求与高级角色显式请求的无标签结论也回送，并标记「未带结论标签」。纯确认和 `NOREPLY` 记录原因，在发送者的下一次唤醒和 `loom status` 中显示。Auditor 主动请求的回复可回送一次，自动回送到此结束。
- Leader 核实红色事项后可运行 `loom escalate <gate-id> --reason REASON --evidence TEXT`。原因限 `protected-file`（保护或越界文件）、`assertion`（删除或削弱断言）、`skip-only`、`confirmed-fact-miss`、`sandbox-escape`。升级附证据，和门禁包共用每门禁一次的投递额度。额度已用时，结论记入通知账本，供查询。
- Worker 的卡死、事实核验和其他常规信号随 Leader 的实际消息送达。`loom status --json` 可查看完整信号及被白名单过滤的投递。旧项目中的 `drift.deferAuditorNotices` 字段可继续读取，路由由本规则统一执行。
- Auditor 用 `loom notifications --needs-decision TEXT --kind decision` 请求 Super 裁决。阶段或目标完成用 `loom notifications --complete TEXT --phase ID` 登记。成功回执给出登记 ID 和推送去向。同一阶段的不同正文会报冲突。省略阶段时按完整正文去重。无可用推送路线时返回非零，已登记事项留在待投递列表。
- Leader 用 `loom notifications --gate-complete ID` 登记门禁结束。常规合入回告若被静默规则过滤，发送者会收到明确回执，正文随 Auditor 的下一次允许投递附送。需要 Auditor 再作裁决时才提交新门禁轮次。

### 投递没到就必须有人知道

- Leader 和 Auditor 等待结果超过预期时，运行 `loom status` 查看置顶的停滞投递。Worker 已出结果、Leader 尚未收到时，卡片显示 `result-undelivered`。
- loomd 在发送方的下一次唤醒附上尚未送达的 ID、目标、原因和时长。Leader 的收件阻塞升给 Auditor。Auditor 的收件阻塞经桌面提示和 `loom notifications` 升给 Super／用户。告警按投递 ID 去重，按项目节流。
