# Loom 当前主线现状（原 evo）

整理日期：2026-10-27。本页区分当前结论与历史试验，不改变目标合同或补判未通过的验收。文档整理基线为 `fe5d65fc`；后继离线任务报告基于 `937a9ac9`，没有产品部署或新真实模型实验。

完整原文保留在[截至本日的状态快照](status-history-through-2026-10-27.zh-CN.md)。其中过时的 main 冻结、控制台在用、临时监听地址和早期“下一步”均不再作为当前指令；历史失败及限制仍可追溯。第一至六十五节另见[九月日志](log/status-history-2026-09.zh-CN.md)。

## 1. 环境与服务

- `main` 是当前 Loom；`evo` 已晋升并移除；`chatbox` 独立承载 `rah/main` 导入，不参与 Loom 构建。见[分支记录](branch-promotion.zh-CN.md)。
- 唯一产品前端为 `frontends/raft`。旧复刻 UI 和 `apps/console` 已退役，不恢复其路由、构建或测试入口。
- 保留部署标签 `com.loom.evo`、数据目录 `~/.loom/evo`、日志目录及频道主目录 `~/.loom/channel-workspaces/`。这些名称不是旧分支残留任务，不能为整洁搬迁数据。
- 最近正式后端部署为 `9b506aa2`，Web 使用已验收的 `5ce14ec4` 构建（资源哈希 `307adca9…`）；移除全局频道后服务重启、0频道空态和 API 已复查。保留本机 Codex warm / Kimi ACP native-final 与 Claude/OpenCode 既有选择；库默认仍 opt-in。[当前清理记录](../audits/2026-10-28-all-channel-retirement.zh-CN.md)，[此前传输验收](evidence/2026-10-28-native-repair/deployment.json)。
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

## 4. 当前收口与剩余验收

### 文章 / Cindy 吸收

- **任务验收汇总已落地**：离线 JSON 与 Markdown 报告保留失败成本、人工介入、未知计量和来源边界。旧记录重放通过；实际 Codex/Claude 协作复验完成7次执行、三次自动交回，独立复跑候选测试通过。该批非原生成本对照，且工具首试/等待行为有缺陷，不冒称全部通过。见[报告](task-outcome-report.zh-CN.md)、[协作复验](evidence/2026-10-27-daily-report-r2/README.md)。
- **离线消耗诊断已落地**：Codex/Pi/OpenCode 信号解析与保守未知处理；9份历史 Pi 原流已核对哈希重放。没有发现足以证明压缩风暴或无效重试的证据，也没有实现运行时自动熔断。见[诊断](runtime-diagnostics.zh-CN.md)。
- **交接输入精简为条件项**：没有证据就不继续改 prompt、自动换 session 或引入 Cindy 调度器。后继确证问题是回复传输竞争与测试路径混淆，已按缺陷修复，不归因为长历史或子代理架构。不能宣称三项重构及收益全部验收。

### 回复传输缺陷已修复；证明范围有限

Codex warm/Kimi ACP 本机正式服务采用 native-final；最终三对输入总和比分别1.241、1.088，完整原流核账，18轮 Loom 执行成功。Codex 已移除竞争回复 MCP，Kimi 此批无取消请求 usage 缺口。库默认仍 opt-in；多目标/不完整投递及业务操作保留 Worker。见[修复与部署](evidence/2026-10-28-native-repair/README.md)。

2026-10-28 后续清理修复旧长任务/跨频道 runner 的开关继承漏洞，统一清零及恢复键集；不删除可复现历史失败的入口。文章工具与相关实验入口140项定向免费测试通过；无新付费调用、产品修改或服务重启。见[清理记录](../audits/2026-10-28-reply-transport-cleanup.zh-CN.md)。

### 最新复杂连续任务验收

在 `ead15510` 上，Codex gpt-6-luna/low、Kimi k3-256k/low 各三对×每臂十二轮固定源码审查全部完成，144轮、12个连续session核账一致。全部输入总和比1.165/1.061，生成次数原生/Loom为60/62、60/60；没有缺失usage或替换样本。原生也有关键误诊，部分Loom修复建议含糊或中间错误，字数遵循未全通过；因此不发布同质量成本比，不称完整质量/时延门禁通过。无产品改动或重启。见[固定长任务报告](evidence/2026-10-28-long-closeout/README.md)。

### 下一步优先级

1. **新版本多实例协作对照已执行，未通过闭环**：真实 Herdr / Loom 固定三对已结束，第一对启动器失败保留；另外两对 Herdr 完成，原生输入相差2.09倍。两组Loom代码外部40项检查通过，但分别因旧Worker句柄误用/无新@交接，以及未收尾工具后的恢复草稿阻断而缺少独立评审闭环。四个业务样本账本完整，但没有同质量成功配对，不能发布协作成本倍率。后继定向复现已修复工具终态稍晚于turn/completed时过早终止的问题，64项warm/句柄检查通过；真实协作闭环仍待复验，不把免费时序复现当作付费样本通过。[本批报告](evidence/2026-10-28-team-closeout/README.md)。Herdr确实可用，先前环境误判已撤回。
2. **部署选择可移植性**：当前本机显式开关已验证，新的安装环境仍使用库默认；正式推广前须明确支持矩阵和默认选择迁移，不在清理时静默改变所有运行时。
3. **已知平台限制**：AGY自动记忆禁用未证实，不做不公平成本对照；外部 Fork/Side 接口缺失仍明确不支持。子代理总账、极长历史、真机与远端限制保留 §3，不因本轮短任务成功消失。

此前失败、人工接手、修复顺序及全部费用链接见[历史经过](log/2026-10-28-repair-progression.zh-CN.md)与[付费台账](paid-runs.zh-CN.md)。当前没有从这些记录确认的新产品阻断；这不等于所有能力、所有模型和所有门禁全部通过。

## 5. phase 4 删除清单

旧复刻前端、临时控制台和相关入口已删除；不再列为待办。[原清单](status-history-through-2026-10-27.zh-CN.md#5-phase-4-删除清单)及[退役记录](../audits/2026-10-17-console-retirement.zh-CN.md)保留证据。官方上游负例、来源锁、历史实验与数据库兼容代码不是旧产品前端，不随之删除。

## 6. 2026-10-28 测试数据清理

正式部署已清除45个测试频道、79个实例及5个私密会话；活动 Role 为0，50个已删除 Role 的修订按恢复合同保留。只剩空 `#all` 与工作区控制 Room；消息、任务、运行记录均为0，外键和完整性检查通过。频道级联删除经 owner 授权实现，保留可复用 Role，执行退出未确认则拒绝清除；不同删除顺序、幂等、私密/Side、无关实例隔离通过83项定向验证。聊天标题行仅“频道”保留＋，清除空测试分组；正式桌面/手机视口页面已复查。AGENTS 与目标合同已更新，旧控制台命名的在用辅助模块改为产品操作模块。无新付费调用，不改变上文协作与效率验收结论。[清理证据](evidence/2026-10-28-product-cleanup/README.md)。

### 同日纠正：不保留 #all

上节保留系统 `#all` 是错误沿用旧设计。当前合同不设全局/保留频道；移除启动自动创建、旧 Agent 自动加入、生命周期保护及管理页隐藏设置，允许频道列表为空。已有 `all` 只按普通频道处理，删除后重启不重建。此前历史证据不重写。[更正与验证](evidence/2026-10-28-no-system-channel/README.md)。

### 全局频道代码退役与明确剩余项

继续删除未使用的系统频道协议、全局欢迎开关、Workspace 投影及上游表单提取，旧首次运行模块只保留历史回执校验。AGY基础接入及文章/Cindy选定的报告、诊断工具已完成；不把AGY缺失的外部Fork接口或未采纳的自动熔断算成待补功能。真正优先未收口的是最新协作对照的评审闭环及新安装默认回复传输策略；详见[当前判断](../audits/2026-10-28-all-channel-retirement.zh-CN.md)。

### 协作恢复定向修复

核对原生日志发现未闭合工具在原生回合结束18ms后有终态；该记录不足以确定历史因果。假app-server稳定复现真实driver提前终止，现改为最多500ms等待匹配工具真实终态，缺失/外部终态继续失败关闭。旧Worker句柄拒绝和held草稿围栏保留。默认配置矩阵已核对；在协作闭环复验前不扩大新安装默认开关。[证据与限制](evidence/2026-10-28-team-recovery/README.md)。
