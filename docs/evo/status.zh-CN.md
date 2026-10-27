# Loom 当前主线现状（原 evo）

整理日期：2026-10-27。本页区分当前结论与历史试验，不改变目标合同或补判未通过的验收。文档整理基线为 `fe5d65fc`；后继离线任务报告基于 `937a9ac9`，没有产品部署或新真实模型实验。

完整原文保留在[截至本日的状态快照](status-history-through-2026-10-27.zh-CN.md)。其中过时的 main 冻结、控制台在用、临时监听地址和早期“下一步”均不再作为当前指令；历史失败及限制仍可追溯。第一至六十五节另见[九月日志](log/status-history-2026-09.zh-CN.md)。

## 1. 环境与服务

- `main` 是当前 Loom；`evo` 已晋升并移除；`chatbox` 独立承载 `rah/main` 导入，不参与 Loom 构建。见[分支记录](branch-promotion.zh-CN.md)。
- 唯一产品前端为 `frontends/raft`。旧复刻 UI 和 `apps/console` 已退役，不恢复其路由、构建或测试入口。
- 保留部署标签 `com.loom.evo`、数据目录 `~/.loom/evo`、日志目录及频道主目录 `~/.loom/channel-workspaces/`。这些名称不是旧分支残留任务，不能为整洁搬迁数据。
- 最近产品后端代码已在 `57299f8a`（MCP频道交接/原生等待边界指引）安全重启，Web静态产物沿用原版本；[备份及真实页面证据](evidence/2026-10-27-peer-wait-guidance/summary.json)。此前AGY部署为 `ed76bb2f`。实际部署结论见[运行时证据](evidence/2026-10-27-agy-runtime/README.md)与[协作收尾](evidence/2026-10-27-agy-closeout/README.md)，不能把文档 HEAD 当成服务版本。
- HTTP 4176、LAN HTTPS 4178 和隔离预览的部署记录见[HTTPS接入](evidence/2026-10-22-https-trusted/summary.json)、[预览边界](evidence/2026-10-23-https-preview/summary.json)。本次未重新探测监听地址、数据库版本或运行时设置；部署前仍须读取实际状态，不沿用旧快照里的临时 loopback 配置。

## 2. 当前状态

### 后端与运行时

本地单 Human 后端 MVP 已冻结；维护现有 Room-first、独立实例执行 lane、连续原生 session、权限、幂等和因果围栏。冻结证据见[2026-10-14记录](evidence/2026-10-14-backend-freeze/summary.json)。冻结不等于所有 CLI、真实模型、故障时序和效率门禁全部通过。

- Role 配置修订、实例、频道、独立单聊/频道私密消息、任务、记忆及文件能力沿既有合同运行；模型回复不自动证明 Task 完成。
- 唯一已送达顶层 peer 请求的单跳 final 可由 Kernel 自动交回，不要求回复者额外 @；自动返回不能继续产生自动返回。Claude/OpenCode 既有自主协作与运行维护证据见[业务](evidence/2026-10-13-backend-finish/team-v8.json)、[运行边界](evidence/2026-10-13-backend-finish/operational-mvp.json)。
- Codex、Claude、OpenCode、Kimi、Pi 的 Fork/Side 统一接口和各家限制见[实施记录](session-branches.zh-CN.md)。不将其覆盖外推给新增运行时或 SEA。
- Antigravity 1.4.8 已接入原有运行时体系：13 个精确模型/effort 绑定、连续会话、Host 最终回复和逐步骤用量。真实生成只验收 Gemini 3.8 Flash Low，含重启续接；启停/错误分支的假 CLI 测试不冒称全模型实测。[接入](evidence/2026-10-27-agy-runtime/README.md)、[日常页面](evidence/2026-10-27-agy-daily/README.md)。
- AGY→Codex→AGY 原 session 协作已在显式人工恢复后完成；AGY 使用 native-final，Codex 使用既有 `loom_reply(final=true)`。原中止保留，不能称无人救援或成本通过。[收尾证据](evidence/2026-10-27-agy-closeout/README.md)。

### 前端与通知

- `@botiverse/raft-ui@0.35.1` 提供组件；不可变选定源码为 `db5e399` / Web 1.21.23；后续资源移植分别记录来源。不是整套官网应用的未经修改依赖，也不能由构建成功推断最新版全站一致。
- 固定 Web 1.21.34 的页面、主题、分栏与菜单覆盖见[清单](raft-1.21.34-closeout.zh-CN.md)；升级按[正式工作流](../design/official-ui-upgrade-workflow.zh-CN.md)执行。
- 手机首页/动态/任务/搜索/更多导航及触屏布局有 owner 授权适配。触屏分栏、紧凑输入区和横屏收起顶栏是明确的 Loom 例外，不改变横竖屏字体来换面积。见[自适应](evidence/2026-10-27-adaptive-runtime/README.md)、[折叠屏](evidence/2026-10-27-foldable-touch/README.md)、[横屏面积](evidence/2026-10-27-landscape-chrome/README.md)。虚拟视口不等于所有物理设备验收。
- 本地通知与关闭页面后的 Web Push 是不同路径；浏览器/系统权限、HTTPS 与外部推送网络边界见[通知设计](../design/local-notifications.zh-CN.md)。后端接受请求不等于用户看见横幅，不把历史偶发失败抹去。

## 3. 偏离合同清单

此处保留需继续披露的边界，不自动开启新开发或付费批：

- **效率与质量**：五 CLI 长任务结果并非统一全部通过，Claude 旧批偏高及质量问题、Kimi 旧批公平性缺口、缺失计量均保留。不得把单次比率或成功子集当作总体结论；见[原生波动重分析](evidence/2026-10-11-native-variability/summary.json)、[固定混合批](evidence/2026-10-11-mixed-study-run/summary.json)和[付费台账](paid-runs.zh-CN.md)。
- **AGY**：交互式 `/fork` 可用，但尚无公开且验证可用的无交互复制入口，Loom Fork/Side 不开放；Fast、SEA、自动记忆禁用、长任务成本及完整子代理计量不作通过宣称。[官方文档和探针证据](evidence/2026-10-27-agy-fork-feasibility/README.md)。
- **生命周期与观测**：Kimi 冷进程、预热默认关闭、各 CLI 上下文/压缩观测不齐、Claude/Pi SEA helper 限制继续按对应合同记录；未知不估算。原生子代理允许内部执行，但完整后代用量/生命周期覆盖不是全平台已验收。
- **隔离与兼容**：同 UID/full-access 原生 CLI 并非 OS 级记忆强隔离；用户全局 CLI 配置仍有继承边界。历史 schema、Role 寄存及兼容夹具不能按旧 persona 名称直接删除。
- **长历史与恢复**：新成员有界补读不代表极大历史下的模型质量/成本已验收；记忆有损摘要、删除条目的 Worker 列举、连续会话故障恢复等既有边界不因文档整理关闭。
- **设备与远端**：真机键盘、安全区、后台通知和触屏第三栏按各批证据限定；远端 Computer/账户池基础冻结保留，远端 Role session 绑定缺口不属于本地 MVP 已通过范围。

完整旧偏离、触发条件及未裁定项原文见[原清单 §3](status-history-through-2026-10-27.zh-CN.md#3-偏离合同清单)、[原未决项 §4](status-history-through-2026-10-27.zh-CN.md#4-未决项)。本次未逐项重新运行验证；若恢复某项施工，先按当前代码、目标合同和后继证据核实，不从旧行文推断仍然失败或已经修复。

## 4. 未决项

2026-10-27 实际协作任务未完成：Codex luna/low＋Claude sonnet/low 停在方案阶段。lead开场的流程说明误含审查者完整@，同时唤醒两位；实施者最终方案又未点名，无新的peer请求，不是已接受投递丢失的证据。2 Run、已记录221,102输入/1,787输出保留；未补跑。Markdown工具由lead另行完成，新增发送前canonical mention预检；不改变Kernel路由。见[本次任务与接手边界](evidence/2026-10-27-daily-report/README.md)。

Owner随后授权正确开场复验：7 Run完成设计→实施→审查拒绝→修复→复审→收尾，三次无@自动返回，无Human救援；候选5项独立复跑通过。716,094输入/6,474输出与原生去重计量一致；单次非效率对照、不推断长期成功率。适用报告展示遗漏以TDD补入现有工具，7项通过，无产品重启。见[复验证据与边界](evidence/2026-10-27-daily-report-r2/README.md)。

没有因本次整理新增产品阻断或重新开启历史验收。新的能力改造顺序是[文章/Cindy研究](article-cindy-adoption-review.zh-CN.md)中的：复用完整任务验收汇总 → 离线无效消耗诊断 → 有证据再精简交接输入。第一步已落地[离线报告入口](task-outcome-report.zh-CN.md)：重放旧三对团队批与 AGY 恢复审查，保留失败/人工介入/未知计量，复用已有算术；未重新运行真实模型或补判验收。第二步已增加[原流离线诊断](runtime-diagnostics.zh-CN.md)，旧 Pi 批9份stdout哈希匹配，仅1次压缩且post为估计值，未建立无效压缩/不必要重试根因。没有证据支持继续改prompt或运行时；不新增调度框架、自动换session、静默记忆生成或收益数字。

成功批后续只读诊断确认：Codex三次新回复遗漏final后修正、两次原生wait超时（违反本批指令）；业务交付通过不等于工具首试和指令遵循通过。Claude重读发生在代码修正前后，非无效重读证据。共用MCP参数错误指引已修复并重启部署，13项针对性测试及类型检查通过；非法调用不转发、不回显输入、不默认final。后续共用MCP指引已补频道交接结束本轮、原生等待仅适用于自身子代理的区分，8项测试及类型检查通过并安全重启；修复当时没有新付费复验，不宣称模型行为已根除或节省比例；后继对照见下文。见[修复边界](evidence/2026-10-27-peer-wait-guidance/README.md)；不据此重构上下文或扩大付费实验。见[诊断](evidence/2026-10-27-handoff-diagnostics/README.md)。

Owner 后续授权修复后原生对照：Codex、OpenCode、Claude CLI/Kimi、Pi/Kimi各3组×双臂3轮，输入总和比依次3.611、1.189、1.076、1.042。Codex三组均高、11次缺final参数拒绝，错误指引未根除重试；Kimi第二轮EOF退出失败且有缺usage请求，不给完整倍率；AGY自动记忆禁用仍未证实，不发起不公平对照。四家用量已与原生账本核验，非长任务/质量/全部门禁通过。Pi明确为native-final试验、两臂扩展隔离与cacheWarming关闭，非日常默认配置。测试保护器版本/服务层参数/Claude路由传递缺陷及先前费用保留，本次不改部署。见[重复短任务报告](evidence/2026-10-28-postfix-cost/README.md)。

文档与退役引用整理见[清理记录](../audits/2026-10-27-repository-cleanup.zh-CN.md)；后继报告工具的检查与重放见[证据](evidence/2026-10-27-task-outcome-report/README.md)。

## 5. phase 4 删除清单

旧复刻前端、临时控制台和相关入口已删除；不再列为待办。[原清单](status-history-through-2026-10-27.zh-CN.md#5-phase-4-删除清单)及[退役记录](../audits/2026-10-17-console-retirement.zh-CN.md)保留证据。官方上游负例、来源锁、历史实验与数据库兼容代码不是旧产品前端，不随之删除。
