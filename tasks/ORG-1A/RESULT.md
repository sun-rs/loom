# ORG-1A 实施结果

- 收件箱按实际调用者识别 Super。已排队的 Super 消息优先于普通排队消息。有可交付波次时，loomd 将 Super 消息放在同一提示词的首段，并用分隔标题接上波次结果。组合投递共享原生回执，失败重试保留波次。
- `loom spawn reviewer` 启动一次性只读意图的审查会话，问题随首轮发送，收尾时回送结果并关闭会话。默认时限 30 分钟，可通过 `roles.reviewer.maxDurationMs` 调整。外部发起者可从项目通知获取结果。Reviewer 独立于 Worker 席位，Worker 默认 3 席，策略上限 4 席。
- Leader 与 Auditor 的换班在项目索引中记录前任、后任、绑定、首报核验与失败状态。换班中的后任必须给出通过核验的报告才能解除互锁。首报有事实缺失时保留原记录，修正报告通过后解锁。后任退出则记录换班失败。可用 `loom state <addr> --project DIR` 查看历史。
- loomd 核对确认回复中引用的 Git 对象、仓库文件路径，以及明确标示的测试和指标名称。Leader 的事实缺失发给 Auditor，Auditor 的事实缺失发给 Leader，Worker 的事实缺失写入证据卡。名称核验在仓库源码和配置中精确搜索，目标是验证所引用的名称存在。
- 走偏告警按项目和接收角色合并排队，默认发给 Auditor。策略的 `drift` 配置支持净行数预算、预算上调次数、同命令耗时倍数及样本数、PLAN 行数、重复失败次数、事实缺失开关和采样间隔。净行数以 Worker 启动时的 Git 工作区快照为基线，预算优先读项目根卡片。耗时以同一项目中已观察到的同命令样本中位数作为基线。默认间隔 30 秒，轮次结束时也采样。
- `loom status --project DIR` 显示活跃角色、波次与卡片、续作、阻塞项、告警、最近合入和按角色划分的已记录 token。可加 `--json` 获取完整结构化数据。策略校验和示例中已移除缓存保活字段。
- `loom switch <leader|auditor|worker> --project DIR --to <编号或 cli/model/effort[/fast]>` 使用从 1 开始的 preferred 编号。常驻角色沿用同一套换班和首报验证逻辑。所选配置可指定启动模式，否则继承前任模式。Worker 切换持久化为新会话的默认配置，显式选择仍受 deny 限制。选择非首项会通知 Super，配额失败保留原 CLI。Super、Leader 和 Auditor 的示例列表各含两个厂商。
- `preferred[].fast` 是可选布尔值。支持时通过单次启动参数配置，忽略该设置时在回执中给出原因。启动回执区分配置值和运行时已核实值。[Codex 配置参考](https://learn.chatgpt.com/docs/config-file/config-reference) · [Claude Code fast mode](https://code.claude.com/docs/en/fast-mode)

## 验收

- 在隔离 HOME 中运行 `npm test`，265 项通过。新增夹具覆盖 Super 优先与波次同轮投递、Reviewer 单轮收尾和超时、首报存在事实缺失时的互锁、Claude Leader 切到 agy、agy Auditor 切到 Codex、Worker 默认切换持久化、配额失败保持原 CLI，以及六类走偏信号合并。原容量测试保留默认 3 席的断言，并将上限断言更新为 4 席，同时验证第五席被拒绝。
- `git diff --check` 通过。厂商账户的实际 fast 档位未实跑，验证范围为本地配置、启动参数路径和协议夹具。工作仓库未提交。

## Super 追加的投递策略

- Worker 结果和普通续作结果默认流式投递。首项结果进入队列后，空闲 Leader 的合并窗口为 `delivery.coalesceMs` 毫秒，默认 45 秒。窗口内的结果合为一轮。Leader 忙碌时，已排队的结果在下一可写轮合并，即使到达时间跨过多个窗口。若有 Super 消息，已就绪及已排队的结果附在 Super 消息之后。
- `loom spawn worker --task T --wave W --deliver barrier --barrier SET …` 显式等待同一集合。集合 ID 可以跨跟踪波次。集合在派工轮结束时封口，成员齐全或达到原有超时条件后投递。集合的 BLOCKED 可先上报 Super，成员结果仍由屏障收口。旧版已登记的波次延续其原有收口规则。
- Worker 的原生结果确认后释放施工席位，会话保留给后续续作。席位满时续作保持排队。流式超时报出具体 Worker 及最近活动，迟到时补投该 Worker 的结果。Auditor 按原规则收到 FAILED 和有证据差异的抄送。合并后的原生投递使用一个稳定的主 ID，重启后以该 ID 确认各成员回执。
- 预计 Leader 唤醒数按实际完成节奏变化。旧整波通常每组唤醒 1 次。流式模式下，3 个 Worker 若一个先完成、另两个在同一个后续窗口完成，且 Leader 当时空闲，预计唤醒 2 次。三个结果分别跨窗时最多 3 次。结果集中在同一窗口，或都在 Leader 忙碌期间到达，仍合为 1 次。显式屏障正常收口仍为每组 1 次。首个结果先到时，Leader 可在慢 Worker 结束前补上空出的席位。
- 投递策略更新后在隔离 HOME 中重跑 `npm test`，269 项全部通过。新增覆盖默认窗口与补位、跨窗积压合并、流式超时与迟到补投、组合回执在重启后的去重。屏障回归覆盖跨跟踪波次的同一集合及其重启恢复。

## 交接简报接入章程和裁决

- `loom handover` 与 `loom spawn --handover-from` 共用的简报增加项目章程和裁决账本两个小节。章程提取目标、非目标、红线和验收要点。裁决优先摘录当前工作明确引用的编号和匹配的在途工作条目，缺少匹配时选最近三条，按原文展示引句。
- `.project/charter.md` 和 `.project/rulings.md` 的路径预留在 1,500 token 上限内。文件缺失或不可读时在对应路径后标明。
- 隔离 HOME 下运行 `npm test`，271 项全部通过。新增覆盖原文裁决的相关性筛选和不可读文件，扩展了两条交接入口及长简报裁剪的回归断言。

STATUS: done
