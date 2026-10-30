# Loom 当前主线现状（原 evo）

更新日期：2026-10-30。本页区分当前结论与历史试验，不改变目标合同或补判未通过的验收。文档整理基线为 `fe5d65fc`；当前部署及真实模型验收以下文和对应的 dated evidence 为准。

完整原文保留在[截至本日的状态快照](status-history-through-2026-10-27.zh-CN.md)。其中过时的 main 冻结、控制台在用、临时监听地址和早期“下一步”均不再作为当前指令；历史失败及限制仍可追溯。第一至六十五节另见[九月日志](log/status-history-2026-09.zh-CN.md)。

## 1. 环境与服务

- `main` 是当前 Loom；`evo` 已晋升并移除；`chatbox` 独立承载 `rah/main` 导入，不参与 Loom 构建。见[分支记录](branch-promotion.zh-CN.md)。
- 唯一产品前端为 `frontends/raft`。旧复刻 UI 和 `apps/console` 已退役，不恢复其路由、构建或测试入口。
- 保留部署标签 `com.loom.evo`、数据目录 `~/.loom/evo`、日志目录及频道主目录 `~/.loom/channel-workspaces/`。这些名称不是旧分支残留任务，不能为整洁搬迁数据。
- 正式服务已在`b9854006`推送后备份并平滑重启，schema91；[部署收据](evidence/2026-10-30-avatar-consistency/deployment.json)确认14个保护表及通知／记忆文件保持，LAN/Tailnet原CA验证通过。[正式Firefox页面](evidence/2026-10-30-avatar-consistency/formal-page.json)在1440与390宽度打开既有Role并连续随机5次：零新增请求、几何稳定、图库保持启用；未保存草稿、无业务写入。保存后消息／成员一致性及冻结执行修订由隔离Core的三引擎流程证明。此前[工作动态／计算机概览](evidence/2026-10-30-working-surfaces140/README.md)、[空置顶／实际拖动](evidence/2026-10-30-sidebar-drag-repair/README.md)、[弹窗尺寸](evidence/2026-10-30-avatar-window/README.md)和[PWA真机限制](evidence/2026-10-30-pwa-member-repair/README.md)保留。
- HTTP 4176、LAN HTTPS 4178 与 Tailnet HTTPS 4178 在既有明确地址监听；同一 Core、原本地 CA、无配对、保留 Host/Origin 校验。本轮两个 HTTPS 首页经原 CA 校验，三个 HTTP 入口均200；页面/API/Service Worker及负向校验见此前[Tailnet入口证据](evidence/2026-10-28-tailnet-https/README.md)。远端实体手机与关闭页面后的推送未在本批重验；部署前仍须读取实际配置。

## 2. 当前状态

### 后端与运行时

本地单 Human 后端 MVP 已冻结；维护现有 Room-first、独立实例执行 lane、连续原生 session、权限、幂等和因果围栏。冻结证据见[2026-10-14记录](evidence/2026-10-14-backend-freeze/summary.json)。冻结不等于所有 CLI、真实模型、故障时序和效率门禁全部通过。

- Owner2026-10-30的[头像接线](evidence/2026-10-30-sidebar-avatar-closeout/README.md)完成未占用随机分配、手选重复、上传／保存及历史图片保留。该批静态侧栏报告漏验空置顶和实际拖动，不能证明完整侧栏对齐；已在[后续修复](evidence/2026-10-30-sidebar-drag-repair/README.md)明确纠正，改用完整锁定发布中的原生拖动声明／算法和真实鼠标验收。整版Web业务迁移仍不能据此宣称完成。

- Role 配置修订、实例、频道、独立单聊/频道私密消息、任务、记忆及文件能力沿既有合同运行；模型回复不自动证明 Task 完成。
- UI兼容修复将Human手动未读注意标记与精确消息数量分离，Kernel schema90→91；刷新/重启保持，旧viewport确认不能覆盖后来的手动标记，不改实例投递或任务状态。[迁移与收尾证据](evidence/2026-10-29-ui-closeout/README.md)。
- 唯一已送达顶层 peer 请求的单跳 final 可由 Kernel 自动交回，不要求回复者额外 @；自动返回不能继续产生自动返回。Claude/OpenCode 既有自主协作与运行维护证据见[业务](evidence/2026-10-13-backend-finish/team-v8.json)、[运行边界](evidence/2026-10-13-backend-finish/operational-mvp.json)。
- Codex、Claude、OpenCode、Kimi、Pi 的 Fork/Side 统一接口和各家限制见[实施记录](session-branches.zh-CN.md)。不将其覆盖外推给新增运行时或 SEA。
- Antigravity 1.4.8 已接入原有运行时体系：13 个精确模型/effort 绑定、连续会话、Host 最终回复和逐步骤用量。真实生成只验收 Gemini 3.8 Flash Low，含重启续接；启停/错误分支的假 CLI 测试不冒称全模型实测。[接入](evidence/2026-10-27-agy-runtime/README.md)、[日常页面](evidence/2026-10-27-agy-daily/README.md)。
- AGY→Codex→AGY 原 session 协作已在显式人工恢复后完成；AGY 使用 native-final，Codex 使用既有 `loom_reply(final=true)`。原中止保留，不能称无人救援或成本通过。[收尾证据](evidence/2026-10-27-agy-closeout/README.md)。

### 前端与通知

- 完整Web1.21.23候选的[双边交互门禁](evidence/2026-10-30-native123-interactions/README.md)已闭合公共频道置顶、分区增改删／排序／菜单移动、鼠标DnD、取消拖动及刷新保存；21组无遮罩像素一致，聊天分栏默认240、范围180–320及持久化同原版。真实临时Core验证版本冲突拒绝、已保存但响应丢失后同请求核实不重复写入；原14组桌面／手机页面对照与基础Core流程保留通过。官方源码未改、无付费调用，正式构建未替换。静音／未读／归档等菜单动作、单聊／线程／实例生命周期及其余能力仍按迁移矩阵待接，不宣布全站或正式部署验收。

- [头像一致性修复](evidence/2026-10-30-avatar-consistency/README.md)：随机头像改为打开时读取占用、点击时本地预览，移除整图库禁用和状态行造成的闪动；消息与频道成员不再丢弃头像，统一按稳定Role ID显示当前头像，冻结执行修订不变。隔离Core的桌面／手机浏览器和正式服务验证分别记录；不是整版Web迁移验收。

- Owner本批指定的[工作状态／计算机概览修复](evidence/2026-10-30-working-surfaces140/README.md)接入整版Web1.21.40的工作弹窗、频道摘要、概览列表／卡片和陈旧提示；成员角标由实际Host观测驱动，记忆正文恢复canvas底色，旧底部动态横幅停用。这是明确范围的兼容修复，整版Web迁移仍待完成；构建、浏览器和正式部署证据分列于记录。

- **下一前端基线最终锁定完整Web1.21.23**：Owner选择已发布完整原始源码的`db5e399`及其原始锁（UI0.7.0），取代同日更早的Web1.21.40＋UI0.52.2目标。完整Web与所需官方workspace共2463原始文件已锁定，原版独立构建；候选直接运行原始main/App/MainLayout，以SDK薄适配连接Role/Instance/Channel，拒绝旧UI模块混入。原生消息发送／55条历史翻页／Role备注及头像／原生创建频道与实例／只创建Role不创建实例已通过隔离Core桌面和手机流程。模拟像素结果与来源、业务、正式切换分开记录；**新候选尚未接齐全部既有功能，正式服务保持上一稳定构建，未切换／未重启为候选**。未接项和复跑入口见[整版候选记录](evidence/2026-10-30-native123-intake/README.md)及[基线合同](../design/full-official-frontend-baseline.zh-CN.md)。此前316资源／219JS模块的1.21.40发布图和UI0.52.2 Git树仅作历史／候选来源保留。

- PWA后续修复：直接采用Web1.21.40已有的官方hex取色，补稳定安全区绘制；搜索网页标题此前已黄，系统状态栏另行验收。全局Tasks保留隐藏/inert投影，返回时重验而不重新清空正文，共享原生加载组件。频道添加角色补齐avatarUrl，头像网格/按钮接当前官方选段；基础包升0.52.2。91项定向检查、Chromium/WebKit与移动点击点通过，**鸿蒙/iOS实体PWA系统状态栏仍未确认**。[根因、版本差异与验证范围](evidence/2026-10-30-pwa-member-repair/README.md)。公开TSX仍为db5e399/1.21.23，不能宣称全站最新依赖化。

- Owner随后要求头像库恢复完整官方版本：当前源码采用Web1.21.40的9组72款原始图案、配色、中文标题和顺序，选择器移除宝可梦搜索／分页，新Role从官方池随机并持久保存。539张PNG与旧32×32头像仅保留既有配置／冻结实例／历史读取，不批量改写修订。[切换与验证](evidence/2026-10-30-official-avatars/README.md)；此前[素材导入证据](evidence/2026-10-30-pokemon-avatars/README.md)保留。

- 修复PWA顶部frame/canvas竞争及安全区底色、Tasks冷加载标题消失、Role保存后残留dirty三项缺陷。共享原生任务标题叶子，保留按需加载和拒绝保存的草稿保护；57项定向检查、Chromium/WebKit及桌面／手机运行时回环通过。非实体PWA系统栏验收。[复现、修复与边界](evidence/2026-10-30-ui-state-repair/README.md)。

- 已对齐固定Web1.21.39的Role／频道／Computer侧栏，接回原生Section/List/Item，移除旧几何覆盖和重复包裹；设置列表绑定原始Q4e声明，任务入口统一ListTodo。Chromium／Firefox实测内容左距20px、hover左距8px、行间2px及标题到首行8px；手机保留既有紧凑例外。Kimi K3.1 Pro展示为模型＋effort＋快速开关，精确映射标准/Highspeed binding而不伪造serviceTier。83项定向检查、类型、构建与桌面／手机浏览器回归通过；不是全站最新或真机验收。[实现、像素与验证边界](evidence/2026-10-30-sidebar139-alignment/README.md)。

- 角色／已删除可独立折叠并保持；Agy模型与effort分开选择，保存解析到精确原生binding。Kimi重登后原生目录已出现K3.1 Pro及Highspeed；旧1.21.38水平几何已被上述1.21.39组合替代。[源码、根因和定向验收](evidence/2026-10-30-runtime-sidebar/README.md)。

- 全系统弹窗操作顺序核查：角色资料编辑、记忆编辑两处改为官方取消在左／保存在右；窄空间原生堆叠、手机Sheet左关闭／右提交均保留。加入递归源码防回归检查，桌面／手机定向浏览器通过；行内编辑保持官方自身顺序。[核查及头像来源调查](evidence/2026-10-29-dialog-actions/README.md)。产品可选图库现已由上述owner素材替换。

- Role描述／提示词各有铅笔，共用单修订弹窗并原生聚焦对应输入框；运行时增加官方结构的状态方块和悬浮／手机底部信息卡，接Host已有检测、版本、路径、目录数量及时间。绿色只表示CLI检测成功，**真实账户剩余额度未接入**，卡片明确显示未提供，不推算。[接线与定向验收](evidence/2026-10-29-role-profile-affordances/README.md)。

- Role备注与提示词分离、新Role持久随机头像已实现；提示词允许为空，创建／修订／实例化与原生表单回环通过。旧原生16款和58款Loom32×32图仅保留读取兼容，稳定ID及冻结实例规则不变。频道创建采用官方名称／描述／可选成员表单和文件树选目录，未知成员写入核实后不重复创建；移除Role筛选框和频道公开／私密标签。固定effort不再重复提供选择，模型标签隐藏内部传输前缀。Kimi本机目录刷新授权问题已由重新登录及重扫解决，原失败记录保留，不伪造模型绑定。[原批证据](evidence/2026-10-29-channel-role-usability/README.md)；此前[头像及提示边界](evidence/2026-10-29-role-identity/README.md)保留。

- `@botiverse/raft-ui@0.52.2` 提供组件；不可变选定源码为 `db5e399` / Web 1.21.23；后续资源移植分别记录来源。不是整套官网应用的未经修改依赖，也不能由构建成功推断最新版全站一致。
- 固定 Web 1.21.34 的页面、主题、分栏与菜单覆盖见[清单](raft-1.21.34-closeout.zh-CN.md)；升级按[正式工作流](../design/official-ui-upgrade-workflow.zh-CN.md)执行。
- 前端组件已升级 `@botiverse/raft-ui@0.52.0`，迁入Web1.21.38聊天/私聊/关注图标、手机选择文本与局部引用、任务滚动摘要和下拉头；保留1.21.35设置/动态/分组切片及db5e399原始TSX闭包。[首批范围](evidence/2026-10-29-ui-refresh138/README.md)之后已补窄列cover-tabs、按Host事实分组的运行时菜单、滑动取消关注撤销、持久手动未读，以及消息/收藏复制菜单和消息列引用目标修正。[收尾与全部菜单分类清单](evidence/2026-10-29-ui-closeout/README.md)。原生宿主字段和未提供事实的认证/远程能力不引入，不宣称全站最新一致或实体手机验收。
- 手机首页/动态/任务/搜索/更多导航及触屏布局有 owner 授权适配。触屏分栏、紧凑输入区和横屏收起顶栏是明确的 Loom 例外，不改变横竖屏字体来换面积。见[自适应](evidence/2026-10-27-adaptive-runtime/README.md)、[折叠屏](evidence/2026-10-27-foldable-touch/README.md)、[横屏面积](evidence/2026-10-27-landscape-chrome/README.md)。虚拟视口不等于所有物理设备验收。
- 手机／宽屏触控设备采用有界页面代码预热，保留官方页面、尺寸、交互和即时业务读取。最终三对390×844／每响应200ms模拟延迟对照：任务页面呈现中位数244→21ms、空态数据就绪472→250ms；不是实际手机Tailnet或大历史验收。44项定向检查、类型与构建通过；既有全站action审计失败单列保留。[设计、结果与限制](evidence/2026-10-28-mobile-tailnet/README.md)。
- 整页空态沿用官方 EmptyState；修正手机频道／成员列表的剩余高度布局，移除桌面空正文多余标题。分区内紧凑说明保留原位置，展开已删除 Role 后正常显示列表。47项定向检查、类型与构建通过，已在正式服务桌面／手机尺寸页面核对位置、菜单与滚动；不宣称实体手机验收或最新版全站一致。[布局规则与证据](evidence/2026-10-28-empty-layout/README.md)。
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

Codex warm/Kimi ACP 本机正式服务采用 native-final；最终三对输入总和比分别1.241、1.088，完整原流核账，18轮 Loom 执行成功。Codex 已移除竞争回复 MCP，Kimi 此批无取消请求 usage 缺口。该批当时为本机显式选择；后继源码 daemon 默认已提升，底层构造器仍显式传入能力。多目标/不完整投递及业务操作保留 Worker。见[修复与部署](evidence/2026-10-28-native-repair/README.md)、[当前默认矩阵](native-final-defaults.zh-CN.md)。

2026-10-28 后续清理修复旧长任务/跨频道 runner 的开关继承漏洞，统一清零及恢复键集；不删除可复现历史失败的入口。文章工具与相关实验入口140项定向免费测试通过；无新付费调用、产品修改或服务重启。见[清理记录](../audits/2026-10-28-reply-transport-cleanup.zh-CN.md)。

### 最新复杂连续任务验收

在 `ead15510` 上，Codex gpt-6-luna/low、Kimi k3-256k/low 各三对×每臂十二轮固定源码审查全部完成，144轮、12个连续session核账一致。全部输入总和比1.165/1.061，生成次数原生/Loom为60/62、60/60；没有缺失usage或替换样本。原生也有关键误诊，部分Loom修复建议含糊或中间错误，字数遵循未全通过；因此不发布同质量成本比，不称完整质量/时延门禁通过。无产品改动或重启。见[固定长任务报告](evidence/2026-10-28-long-closeout/README.md)。

### 协作与推广状态

1. **三方协作已取得一次无需人工恢复的完整回归**：OpenCode／Claude CLI（实际 Kimi）／AGY 新 session 自行完成设计、实现、独立评审与交付，外部40/40、三家原流用量对齐；此前同组停顿和一次恢复仍完整保留。[最终三方报告](evidence/2026-10-28-three-cli-team/README.md)。AGY目录5秒截断修正为15秒，多人回复及状态点名规则已补入native-final说明；Kernel自动返回范围不扩大。此前[Herdr/Loom失败对照](evidence/2026-10-28-team-closeout/README.md)、[四运行时复验](evidence/2026-10-28-tool-preflight-team/README.md)不补判通过。此三方组合尚无同质量重复原生/Herdr成本倍率；后继Codex/Kimi双人重复对照见下，不外推为全场景稳定性或效率门禁通过。
2. **源码部署默认选择已收口**：daemon 集中选择 warm Codex/Claude/OpenCode 与 cold Kimi/Pi 原生回复；AGY 保持原协议。未设变量的新安装、显式关闭/冷配置、旧结构化试验、基准隔离及会话围栏定向135项通过，类型检查通过。本机移除四个冗余 `=1` 后安全重启，账本与前端快照未变；无新付费调用。冷 Codex exec、底层适配器、SEA 与远端不扩展。[矩阵、升级和回滚](native-final-defaults.zh-CN.md)、[测试与部署](evidence/2026-10-28-native-final-defaults/README.md)。
3. **已知平台限制**：AGY自动记忆禁用未证实，不做不公平成本对照；外部 Fork/Side 接口缺失仍明确不支持。子代理总账、极长历史、真机与远端限制保留 §3，不因本轮短任务成功消失。

最新固定三对实际 Herdr/Loom 复验在 `a425f76c` 上完成：Codex0.164.0/Luna low＋固定 Kimi2.1.1/k3-256k low，六支团队全部完成设计、实现、独立审查与交付，外部40/40、原生用量完整且与Loom产品账一致。Loom总输入1,729,612、Herdr3,469,935，均值之比0.498457；含输出比0.500902，生成73/136。组内输入范围分别37.8–68.8万、62.9–157.5万，不以单次原生或最优样本代表总体。7次无重复@自动交回、10次Kimi真实exit0；12项分析/会计/启动规则检查通过。本批无产品修改、正式重启、样本替换或中途Human接力，正式测试数据仍为0。此固定任务/组合的成本与协作证明通过，n=3不外推长期分布、全CLI或逐回复时延；[完整结果与限制](evidence/2026-10-28-team-cost-repeat-v2/README.md)。

此前三对的 EOF 超时、模型漏新请求@、Herdr预算截断及未知计量保留，原失败不补判通过。Kimi清理15→30秒的修复已有免费19秒复现、17项定向检查及部署证据；新批10轮均在旧15秒内完成，不能把新批改善全部归因为延长期限，旧寻址随机风险也未被修改规则消除。[前批与兼容修复](evidence/2026-10-28-team-cost-repeat/README.md)。

此前失败、人工接手、修复顺序及全部费用链接见[历史经过](log/2026-10-28-repair-progression.zh-CN.md)与[付费台账](paid-runs.zh-CN.md)。当前回复路径按已验收范围冻结维护；其他CLI/模型、全部效率指标与模型寻址永不遗漏不作通过宣称，不为正常随机波动继续重写编排。

## 5. phase 4 删除清单

旧复刻前端、临时控制台和相关入口已删除；不再列为待办。[原清单](status-history-through-2026-10-27.zh-CN.md#5-phase-4-删除清单)及[退役记录](../audits/2026-10-17-console-retirement.zh-CN.md)保留证据。官方上游负例、来源锁、历史实验与数据库兼容代码不是旧产品前端，不随之删除。

## 6. 2026-10-28 测试数据清理

正式部署已清除45个测试频道、79个实例及5个私密会话；活动 Role 为0，50个已删除 Role 的修订按恢复合同保留。只剩空 `#all` 与工作区控制 Room；消息、任务、运行记录均为0，外键和完整性检查通过。频道级联删除经 owner 授权实现，保留可复用 Role，执行退出未确认则拒绝清除；不同删除顺序、幂等、私密/Side、无关实例隔离通过83项定向验证。聊天标题行仅“频道”保留＋，清除空测试分组；正式桌面/手机视口页面已复查。AGENTS 与目标合同已更新，旧控制台命名的在用辅助模块改为产品操作模块。无新付费调用，不改变上文协作与效率验收结论。[清理证据](evidence/2026-10-28-product-cleanup/README.md)。

### 同日纠正：不保留 #all

上节保留系统 `#all` 是错误沿用旧设计。当前合同不设全局/保留频道；移除启动自动创建、旧 Agent 自动加入、生命周期保护及管理页隐藏设置，允许频道列表为空。已有 `all` 只按普通频道处理，删除后重启不重建。此前历史证据不重写。[更正与验证](evidence/2026-10-28-no-system-channel/README.md)。

### 全局频道代码退役与明确剩余项

继续删除未使用的系统频道协议、全局欢迎开关、Workspace 投影及上游表单提取，旧首次运行模块只保留历史回执校验。AGY基础接入及文章/Cindy选定的报告、诊断工具已完成；不把AGY缺失的外部Fork接口或未采纳的自动熔断算成待补功能。该记录当时留下的协作闭环和新安装默认选择，已有上文的三方实测及源码默认化后继证据；重复同质量协作成本与平台限制仍保留。见[当时判断](../audits/2026-10-28-all-channel-retirement.zh-CN.md)，不把历史“剩余”重复当作新待办。

### 协作恢复定向修复

核对原生日志发现未闭合工具在原生回合结束18ms后有终态；该记录不足以确定历史因果。假app-server稳定复现真实driver提前终止，现改为最多500ms等待匹配工具真实终态，缺失/外部终态继续失败关闭。旧Worker句柄拒绝和held草稿围栏保留。该批默认配置矩阵已核对，当时未扩大默认开关；后继协作及本页默认化证据分别记录，历史失败不补判。[证据与限制](evidence/2026-10-28-team-recovery/README.md)。
