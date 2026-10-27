# 文章吸收与回复修复经过（历史快照）

以下保留清理前状态页记录；当前状态以 status.zh-CN.md 为准。失败、人工介入和费用不删除。

## 4. 未决项

2026-10-27 实际协作任务未完成：Codex luna/low＋Claude sonnet/low 停在方案阶段。lead开场的流程说明误含审查者完整@，同时唤醒两位；实施者最终方案又未点名，无新的peer请求，不是已接受投递丢失的证据。2 Run、已记录221,102输入/1,787输出保留；未补跑。Markdown工具由lead另行完成，新增发送前canonical mention预检；不改变Kernel路由。见[本次任务与接手边界](../evidence/2026-10-27-daily-report/README.md)。

Owner随后授权正确开场复验：7 Run完成设计→实施→审查拒绝→修复→复审→收尾，三次无@自动返回，无Human救援；候选5项独立复跑通过。716,094输入/6,474输出与原生去重计量一致；单次非效率对照、不推断长期成功率。适用报告展示遗漏以TDD补入现有工具，7项通过，无产品重启。见[复验证据与边界](../evidence/2026-10-27-daily-report-r2/README.md)。

没有因本次整理新增产品阻断或重新开启历史验收。新的能力改造顺序是[文章/Cindy研究](../article-cindy-adoption-review.zh-CN.md)中的：复用完整任务验收汇总 → 离线无效消耗诊断 → 有证据再精简交接输入。第一步已落地[离线报告入口](../task-outcome-report.zh-CN.md)：重放旧三对团队批与 AGY 恢复审查，保留失败/人工介入/未知计量，复用已有算术；未重新运行真实模型或补判验收。第二步已增加[原流离线诊断](../runtime-diagnostics.zh-CN.md)，旧 Pi 批9份stdout哈希匹配，仅1次压缩且post为估计值，未建立无效压缩/不必要重试根因。没有证据支持继续改prompt或运行时；不新增调度框架、自动换session、静默记忆生成或收益数字。

成功批后续只读诊断确认：Codex三次新回复遗漏final后修正、两次原生wait超时（违反本批指令）；业务交付通过不等于工具首试和指令遵循通过。Claude重读发生在代码修正前后，非无效重读证据。共用MCP参数错误指引已修复并重启部署，13项针对性测试及类型检查通过；非法调用不转发、不回显输入、不默认final。后续共用MCP指引已补频道交接结束本轮、原生等待仅适用于自身子代理的区分，8项测试及类型检查通过并安全重启；修复当时没有新付费复验，不宣称模型行为已根除或节省比例；后继对照见下文。见[修复边界](../evidence/2026-10-27-peer-wait-guidance/README.md)；不据此重构上下文或扩大付费实验。见[诊断](../evidence/2026-10-27-handoff-diagnostics/README.md)。

Owner 后续授权修复后原生对照：Codex、OpenCode、Claude CLI/Kimi、Pi/Kimi各3组×双臂3轮，输入总和比依次3.611、1.189、1.076、1.042。Codex三组均高、11次缺final参数拒绝，错误指引未根除重试；Kimi第二轮EOF退出失败且有缺usage请求，不给完整倍率；AGY自动记忆禁用仍未证实，不发起不公平对照。四家用量已与原生账本核验，非长任务/质量/全部门禁通过。Pi明确为native-final试验、两臂扩展隔离与cacheWarming关闭，非日常默认配置。测试保护器版本/服务层参数/Claude路由传递缺陷及先前费用保留，本次不改部署。见[重复短任务报告](../evidence/2026-10-28-postfix-cost/README.md)。

共用 MCP 的对外 JSON Schema 已补齐新回复 final 必填/修订互斥约束，修复 advertised schema 与实际校验不一致；Kimi 免费 ACP+MCP 探针正常退出 6.299 秒，超过旧 5 秒期限，改为有界 15 秒且保留真实退出/取消围栏。15 项针对性测试、类型检查与 Codex 免费工具发现通过，无新付费模型调用；Kimi 取消请求缺 usage 与旧成本失败保留，未宣称倍率改善。见[修复证据](../evidence/2026-10-28-reply-eof/README.md)。

修复后固定复验两家均在首对按规则停止：Codex 无缺 final，但四次投递未确认及 CLI 兜底漏 turn，单对输入 3.622 仍失败；Kimi 三轮退出成功，三个取消请求缺 usage，仍无完整倍率。已补共用 Reply context 的 CLI 序号到 MCP basedOnRoomSeq 的明确映射说明，保留因果围栏；12 项针对性测试与类型检查通过，尚无该说明的后继付费效果证据。[本批记录](../evidence/2026-10-28-schema-cost/README.md)。

已追溯近期失败与历史好结果的传输差异：旧 v7 为 native-final，近期 Codex/Kimi 为工具发表。Codex 常驻补接已有 final_answer 验证/共享发布器，并移除竞争回复 MCP；Kimi复用既有native-final。最终固定三对输入总和比分别1.241、1.088，请求12/13和12/12，完整原流核账；零回复MCP拒绝、Kimi无取消usage缺口。本机正式服务已采用；复杂长任务/多模型/全部质量时延门禁仍不外推。首次不完整候选费用另留，详情见[传输修复](../evidence/2026-10-28-native-repair/README.md)。

文档与退役引用整理见[清理记录](../../audits/2026-10-27-repository-cleanup.zh-CN.md)；后继报告工具的检查与重放见[证据](../evidence/2026-10-27-task-outcome-report/README.md)。

