# RAH OS rc.1 修复与补强施工指南

交接对象：Fable。日期：2026-09-16。审查基线：`98dc095` / `v1.0.0-rc.1`。
本文是待执行的施工单，不是完成报告。接手时重新检查 HEAD、工作区与现役部署，不假设它们仍停在基线。

## 1. 目标和执行方式

修复已证实的缺陷，补齐有风险的发布与恢复链路，并将最新 Raft 的可靠性变化转化为适用于 RAH 的回归测试。保留单 Human、多 Agent、本地 Mac 的产品范围和用户已批准的界面行为。

先读仓库 `AGENTS.md`、`README.md`、`docs/README.md`，再读以下材料：

- [审计复核与最新 Raft 差异](../audits/2026-09-16-rc1-audit-and-latest-raft.zh-CN.md)：原报告的事实裁决和源码依据。
- [Raft 证据清单](../evidence/raft-release-20260916/manifest.json)：版本、URL、hash 和证据边界。
- [单 Human 主线](single-human-mainline-and-multi-human-backlog.zh-CN.md)、[安装数据生命周期](2026-09-02-install-data-lifecycle-contract.zh-CN.md)。
- [运行时与观察平面](../architecture/runtime-adapter-and-observation.zh-CN.md)、[客户端与部署](../architecture/client-daemon-and-deployment.zh-CN.md)。
- [正式重启与验收合同](../design/ui-evidence-and-release.md)。

不要重新从 Fable 原报告的严重度标签推导施工顺序。原报告包含已纠正的误报，本文与当前用户决定是施工范围依据。出现新的证据时可以调整裁决，但须写出失败反例与影响，不能只凭 grep 零命中。

每个工作项采用同一流程：定位现有 owner → 写外部可观察的不变量测试 → 记录预期失败 → 最小实现 → 定向回归 → 更新 owner 文档 → 批次验收。纯文档修订不需要人为制造行为测试。现有能力已满足时，记录覆盖证据，缺测试则补测试，不为“完成施工单”而重写。

本文不授权 commit、push、重打标签、对外发布或付费 Provider 测试。修复由用户交办后可按范围执行；上述额外动作仍按届时明确授权处理。已有未提交的复核文档和证据文件须保留，不回滚、不覆盖成原报告结论。

## 2. 不得撤回的产品决定

| 主题       | 必须保留的合同                                                                                                               |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 私有工作区 | RAH 已有 per-Agent cwd。保留 Provider 原有登录与 HOME 行为，不重新引入 per-Agent HOME 或默认文件沙箱                         |
| Human Task | Human 可编辑任务状态和负责人；Worker 的 claim、权限、终止证明和旧执行围栏仍必须严格。修旧 ADR，不恢复用户已撤回的 Human 限制 |
| PWA 审批   | 彩色 Task 标识打开中央审批弹窗，展示任务属性和有界时间线，不补回重复聊天正文/composer                                        |
| 移动导航   | 图标底栏、进入子页隐藏底栏、逐层返回是用户要求，不作为“缺功能”修复                                                           |
| 网络       | 用户选择 Tailnet HTTP、停用浏览器 token 门槛。普通 LAN 暴露要单独显式管理，不能借安全整改偷偷恢复强制登录或切断现用 PWA      |
| 数据与执行 | 不用删除数据库、清空历史、伪造终止证明、强杀活动执行或移除 fencing 消除报错                                                  |
| 范围       | 不扩建多 Human/中央账号/计费/relay，不恢复 RAH 托管第三方 MCP，不改变 Agent 记忆政策                                         |
| 发布       | 不改写已推送历史或 `v1.0.0-rc.1`；下一个版本号未由本指南确定                                                                 |

## 3. 上游参考方法

Web `1.16.0` 与 Computer `1.0.32` 是两条版本线；运行时基线比较为 Computer `1.0.18 → 1.0.32`。RAH UI 已有后续 Web 对照，不能宣称整仓基线都是 `1.0.18`。

原始分析材料目前在 `/private/tmp/raft-20260916-audit`；旧 Computer 提取结果在独立 `raft-runtime-forensics` 工作区。临时文件可能被清理，缺失时按证据清单中的不可变 URL/hash 重取并用既有 SEA 提取工具解析。不要运行下载的安装器、升级用户 Raft 或读取其登录凭据。原始发布包保持分析用途，不加入 RAH 产品依赖。

重点可参考：`kReleaseSource.ts`、`serviceUpgradeStart.ts`、`kOperationAcknowledgement.ts`、`macosLoginCarrier.ts`，以及 daemon 的 `selectWakeDeliveryIndex` 和有界错误 cause-chain。记录采用的具体条件、失败语义和本地差异。当前没有中央 Server 的完整源码；发布日志中的权限/SQLSTATE 修复只能作为补测线索。

不要整体升级内部 K carrier 或接入 Raft 的 Hands 服务。RAH 已有签名制品源、generation/HMAC 控制和单一升级 owner。新版 Raft 的退避并非从无到有，不能另造第二套运行时重试状态机。

## 4. 工作顺序

| 批次            | 工作项                                                     | 批次完成条件                                                                                      |
| --------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| A：确认缺陷     | R1 CI、R2 网络配置、R3 查询热点、R4 版本和文档             | 定向测试与必需检查通过；网络兼容方案能保持现有入口；若新改动涉及 schema，先满足 R6 的该次迁移保护 |
| B：恢复补强     | R5 删除诊断、R6 迁移保护、R7 all 预检、R8 环境、R9 Web/iOS | 故障注入可重现、恢复不丢数据、不削弱执行围栏；实机未验收项明确保留                                |
| C：上游差异补测 | R10 权限/分页/投递、R11 升级与登录恢复、R12 Outbox/诊断    | 每个适用项有“已有覆盖/新增测试通过/发现并修复/阻塞”裁决，不以整体移植代替比较                     |
| D：发行准备     | R13 制品、许可、发布矩阵                                   | 制品身份可核验、范围与未认证项明确；外部条件未满足则不宣称正式分发就绪                            |

按依赖推进，不因一个必须实机或作者决策的项目阻塞其他可执行工作。也不要把整份补强清单都变成无条件的 rc.2 准入门槛：确认缺陷必须闭合；风险补测按结果裁决；外部分发要求与本地里程碑分开记录。

## 5. 确认缺陷施工单

### R1. 修复 CI 浏览器依赖顺序

**事实**：远端 run `35007939637` 在 `npm run check` 内的 ChoiceRow 浏览器测试启动 Chromium 时失败。现有 workflow 在 check 后才安装 Firefox。原报告把直接原因归为 foundations 查找 Chrome，不准确。

**Owner/入口**：`.github/workflows/ci.yml`、`package.json`、既有 browser gate support。

**实现**：列出每个 CI gate 实际启动的引擎；将匹配锁文件版本的 Playwright Chromium/Firefox 与系统依赖安装移到 check 前。保留 foundations 对系统 Chrome 的明确策略，必要时配置其受支持的 executable；不能只设 `RAH_UI_BROWSER=firefox` 掩盖另一测试的 Chromium 依赖。选取本次影响的移动、任务、菜单和滚动门禁接入持续执行，避免重复跑同一 fixture 或只添加无人执行的脚本。

**验收**：干净 Linux 环境、无个人浏览器缓存可以运行相同顺序；构建及门禁失败会令 job 失败；报告区分本机通过与远端 CI 通过。未获 push 授权时完成本地/隔离环境验证，远端验证记为待推送后执行，不声称绿色。

### R2. 分离 Tailnet 与普通 LAN 的信任配置

**事实**：`scripts/workbench-launch-mode.mjs` 配置 Tailnet 时自动把本机所有 RFC1918 网卡加入额外监听；gateway 的 trusted-network 策略也适用于这些入口。Host/Origin 校验不能认证同网其他用户。

**Owner/入口**：现有 launch-mode、launch-receipt、`local-core-workbench.ts`、`local-workbench-gateway.ts`；HTTPS/配对能力复用现有 LAN gateway。

**实现**：Tailnet 地址和 LAN 地址使用分别明确的配置及回读收据；仅配置 Tailnet 不再自动授权新发现的普通网卡。收据必须保留网络入口和信任模式，重启不得静默降回 loopback 或扩大范围。保留用户已选择的 Tailnet HTTP 策略。普通 LAN 如继续采用受信网络模式，必须由已有明确授权和显式配置支撑，不能从 Tailnet 变量推导；若采用 HTTPS/配对，复用已有路径，不增建第二个 Core。

**迁移步骤**：先只读盘点实际监听和现用手机入口 → 准备具体新配置、兼容性测试与回退办法 → 核对已有授权是否覆盖 → 最后才切正式入口。如确需新增用户决定，只在此时提出具体选项并说明原因；此前继续完成代码和隔离测试。不得未经安排把现有 LAN/PWA 地址关闭。

**先测**：单独 Tailnet 配置、显式 LAN、重复/非法地址、网卡新增/消失、收据损坏、空 shell 重启；新网卡不获隐式访问；错误 Host/Origin 拒绝；实际启用认证的 LAN 未认证访问拒绝。验收必须从实际 Tailnet/LAN origin 新开浏览器，不能只测 `127.0.0.1`。

### R3. 修复事件查询热点

**事实**：`RoomKernel.reconcileAgentDeletions` 每秒执行的查询扫描 `room_events` 并额外排序；`#assertWorkerGrantScope` 无 room_id 条件，不能有效利用现有以 room_id 开头的事件索引。

**Owner/入口**：`packages/kernel/src/room-kernel.ts` 与现有 schema/index 初始化 owner。daemon reconciler 只拥有调度节奏，不增加删除队列或第二套业务状态。

**实现**：在临时 DB 装入有代表性的大量无关事件与少量删除事件，对两条原 SQL 做 `EXPLAIN QUERY PLAN`。比较 `(type, aggregate_id)`、`(type, created_at, aggregate_id)` 或等价的最小索引组合，以真实计划和写入成本决定。不要默认添加 `messages(room_id, created_at)`、`agent_definitions(state)`，除非另一条实际查询证明需要。先修索引，不为此整体改成新事件系统。

**先测/验收**：删除协调结果和顺序不变；Worker 在删除请求后立即被围栏阻止；查询不再扫描全部无关事件；旧库升级、重复启动与索引创建失败有确定行为。测试计划约束不锁死 SQLite 的整段输出文本，性能测量不使用不稳定的毫秒门槛作为唯一断言。记录数据量、计划前后差异、索引数量/空间和写入代价。

### R4. 产品版本与文档一致性

**事实**：UI `0.0.0`、daemon `0.1.0`、根包 `0.0.0` 与里程碑标识不一致；ADR-0029 与后续 Human Task 编辑合同冲突。

**Owner/入口**：既有构建身份生成入口、`daemon-health.ts`、`settings-pages.tsx`、产品打包脚本；[ADR-0029](../adr/0029-canonical-task-lifecycle-and-raft-board.md) 与 [Human Task 变更证据](../audits/2026-09-14-human-task-edit-parity.zh-CN.md)。

**实现**：建立单一产品 release version 输入，构建时固化 commit/build identity，供 UI、health、制品与版本命令消费；独立保留 schema/protocol/runtime binding 版本。开发或未提交构建应可识别，不能伪装成已签发正式标签。不要擅自给当前新代码命名 rc.2 或改写 rc.1；可以用明确 development 身份等待下一次版本决定。

**先测/验收**：同一正式构建各入口身份一致，构建不依赖运行时 Git 工作树，缺发布版本拒绝正式发行而非回落 `0.0.0`；开发模式仍可启动。更新 README 当前状态与过时 ADR，保留历史证据并标注被替代关系。parity PASS 明确为登记/ratchet 校验，不等于完整产品通过率。

## 6. 恢复与运行安全

### R5. Agent 删除阻塞的可观测与恢复

**Owner/入口**：Kernel `agent-deletion.ts`、`reconcileAgentDeletions`；AgentHost 现有 runtime recovery；application-service/SDK 暴露投影，Web 仅展示。

**实现**：复用持久删除意图，暴露结构化阻塞原因、关联 Run/Host、首次阻塞时间和可执行恢复说明。优先从已有持久事实派生，只有需要跨重启保留的缺失信息才增加投影；不得每秒追加相同事件或仅为更新时间创建事件风暴。前台已有 30 秒等待错误，改进它的可操作性，不再宣称无超时/无提示。

**恢复**：匹配原 recovery identity 的 AgentHost 证明进程终止后，既有协调器继续删除。Host 永久不可达时明确显示“缺终止证明，不能完成”，提供诊断/恢复步骤；不要增加绕过证明的强制删除。可借鉴新版 Raft operation 的精确身份、前驱退出、终态读回思想，不能把其升级回执直接当 Runtime 终止证明。

**先测**：orphaned/不匹配 driver/迟到旧 Host 回执/重复删除/Host 恢复/重启恢复/并发新 activation。阻塞期间不发新执行，历史和私有记忆不被提前删除；有效终止后能继续完成；诊断不泄漏 token。

### R6. 通用升级迁移保护

**Owner/入口**：Kernel owns schema transitions；部署/安装入口 owns 升级前停写与快照。复用 `scripts/workbench-restart-guard.mjs` 的 SQLite online backup 和校验逻辑；需要共享时移入正确包，避免已安装产品运行依赖源码脚本。

**实现**：梳理所有实际会触发 initialize 的受支持入口。先识别 schema 变化，再在独占且可证明一致的状态下建立快照；失败不得继续迁移。数据库内适合事务的 DDL/数据迁移统一失败语义；跨文件变更使用可恢复记录。无 schema 变化的普通启动不反复复制整个数据目录。不要为了“统一”给所有 helper 强加 SAVEPOINT。

**恢复限制**：制品回滚不等于数据回滚。旧二进制不得读不兼容新 schema；禁止覆盖正在使用的 DB。只有证明迁移后未接收新业务写入、停写与恢复条件满足时，才可恢复备份；否则保留现场并返回明确诊断，不自动丢弃新数据。

**先测**：真实 WAL 临时 DB、迁移中断、磁盘写失败、坏备份、重复启动、版本较新的库、文件阶段失败；失败重开后旧状态或已提交新状态完整，不出现半套 schema。核验历史、Agent 配置、私有记忆与权限均保留。

### R7. 旧 all 频道的升级预检

**Owner/入口**：`packages/daemon/src/ensure-all-channel.ts`，所有修复写入仍走 Kernel。

**实现**：升级前识别 archived/private/改名等冲突，返回具体频道身份、原因及受支持的恢复步骤。正常 canonical all 路径保持幂等。安全可推断且不改变隐私/身份的情况才自动恢复；私有冲突不得静默公开，历史不得删除，不得创建重复 canonical all。遇到无法无歧义恢复的数据，先完成预检、诊断与恢复方案，用户决定只针对该具体冲突。

**先测**：正常、缺失、归档、私有、改名、重试、恢复中断；预检发生在破坏性修改前，其他 Room 历史不受影响。

### R8. 子进程环境的定向隔离

**Owner/入口**：`packages/agent-host/src/generic-process-adapter.ts` 与现有 launch environment owner，direct/supervised 路径一致。

**实现**：列出真实需要隔离的 RAH 服务凭据及传递路径，补显式过滤/不可覆盖规则。保留 Provider 登录目录、HOME、合法代理/证书/PATH 配置及用户显式运行时配置。不要把所有环境改成白名单，也不要因 `CODEX_HOME`/`CLAUDE_CONFIG_DIR` 存在就判越权。环境清理不是同系统用户下的 OS 沙箱，报告中不得夸大。

**先测**：用假 canary secret 验证子进程、参数、日志、失败信息均不含宿主凭据；Worker capability 仍只通过现有受控载体提供；四类 Provider 的参数/目录发现使用 fake adapter 回归，不运行真实模型；用户显式配置不能覆盖平台身份围栏。

### R9. 前端故障回退与 iOS 键盘验证

**Owner/入口**：共享 Web 壳与已有页面边界、viewport/scroll owner。不要逐页叠加 touchmove 阻止器。

**实现**：增加能隔离合适页面范围的错误边界，提供可恢复界面和脱敏诊断；不能在边界内创建第二套消息状态。保留父级 draft/选择/阅读位置 owner。iOS 键盘先复现，依据 visual viewport、focus、safe-area 实测结果才修改；缺某 API 本身不是失败证据。

**先测/验收**：渲染异常不会留下白屏，恢复不重启后台、不修改历史；Room/DM/Thread 与搜索的键盘弹出、输入、关闭、旋转和回到列表；标题/底栏/composer 固定，中间内容可滚；390×844 浏览器验收，加真实 iPhone PWA 键盘。无实机条件时明确该项未验收，不用模拟视口替代结论。

## 7. 从新版 Raft 提取的补强

### R10. 权限、分页与消息投递回归

这三项是上游变化提示的测试任务，不预先认定 RAH 有缺陷。

| 场景                    | 必须保持的不变量                                                                                                                       | 本地 owner                                 |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 异步操作中权限/配置变化 | 认证后等待外部步骤期间若相关授权撤销或 revision 改变，提交前拒绝迟到写入；已接受的合法操作遵守既有定义，不把所有撤销解释成倒销历史     | application-service + Kernel               |
| 分页可见性              | 第一页与后续 cursor 页执行同一权限策略；撤销成员后不能继续用旧 cursor 取新禁止内容；数量、摘要和错误不泄漏隐藏对象                     | Kernel query / typed API                   |
| 启动中混合投递          | 普通消息、提及、重复 hint 与断线/启动失败组合下，durable Inbox/Activation 不漏、不产生并发 lane；传输 ACK 不能冒充 read/Task 完成      | Kernel + AgentHost                         |
| 消息列发送              | 普通母消息/系统母消息、带 Task/不带 Task 的适用场景，stale hold/retry 后不丢消息、不重复发布；不支持的系统母消息场景明确拒绝而非假成功 | application-service + Kernel + client-core |

测试使用已有单 Human/Agent 权限或既有兼容 ACL，不能借此开发邀请、多 Human onboarding。已有测试足够则给具体证据；失败才修 owner。每项记录上游是源码可见还是仅更新日志声明。

### R11. 制品升级与 macOS 登录恢复

先读 RAH `computer-release-source.ts`、`computer-service-upgrade-control.ts`、`k-carrier-computer-upgrade.ts` 和现有 LaunchAgent 实现。K 唯一决定 slots/WAL/回滚结果，RAH receipt 只投递已证明的进度，不能新增竞争 owner。

补查：同版本制品身份漂移、签名/size/hash 不匹配、重复 request 身份冲突、coordinator spawn 后未接受即退出、终态回执未交付、旧进程仍存活、升级后登录入口仍指旧 slot、replacement 中断。参考新版 Raft 精确回执读回与稳定 dispatcher；仅在实际缺口处有界移植，保留既有 Ed25519 和 generation/HMAC 安全性。

验收以临时目录、fake release server、受控真实子进程及故障注入为主；不要拿用户现役 Raft 或 RAH 做破坏性实验。没有完整上游差异覆盖时，不声称 K 0.1.8 整体对齐。

### R12. Outbox 与结构化诊断

**Owner**：Kernel 持久化投递状态和 next-attempt；现有 dispatcher 执行；观察层只输出脱敏诊断。

先量化固定重试、积压、已交付保留量。确需补强时，在现有路径加入有上限的指数退避/jitter 和可观察的长期失败状态。重启保留重试时间；租约过期由既有 owner 重领，旧租约不得回写。不要达到次数就删除未确认消息，不用“死信”自动当交付完成。已交付记录的有界清理须有明确保留合同，不能破坏幂等、审计或仍被引用的状态。

错误链采用有界遍历、防环、明确分类和 URL/凭据脱敏。优先服务删除/升级/网络诊断，避免为此全仓替换异常体系。先测环形 cause、极深 cause、含 token URL、重启退避、重复投递和旧租约迟到写入。

## 8. 发行准备与暂缓项

### R13. 对外发布配套

制作 release notes、支持平台/安装方式/升级回退步骤、已知限制、制品 manifest/hash、实际构建身份、第三方材料来源清单。正式资产应来自 `build:web:workbench` 及既有冻结产品构建，旧 `apps/web/dist` 不作为判断依据。整理陈旧 CSS GENERATED 头，表明源码提取后的内部维护方式，不恢复对 sibling raft-ui 的构建依赖。

根 LICENSE 由作者决定，不替用户擅选；Developer ID、公证和发布凭据不足时列出明确外部条件，不能伪称签名发布。真实 CLI 验收依届时授权，只跑适用链路并严格断言模型绑定/effort；没有授权则保留待验收。不得为了消除 skip 默认运行付费 Provider，也不要将公开源码可读等同于可再分发。

以下项目先做复现或测量，不纳入无条件重写：附件评论启动全量回填、分享图片 props/effect、环境编辑器 index key、SW 固定 cache 名、逐个 `100vh`、VAPID 丢失与推送租约、memo/ESLint/样式档位数量。报告每项证据、风险、是否需要后续工作，不为满足原审计列表机械改动。

## 9. 验收与正式交接

代码批次交付前按仓库合同运行：

```bash
npm run check
npm run format:check
git diff --check
```

Web 变更还要 `npm run build:web:workbench`，并按改动选择现有真实浏览器门禁。入口示例：`test:web:workbench`、`test:web:lan-workbench`、`test:web:build-recovery`、`test:web:firefox`，以及 task/menu/scroll 的定向脚本；先读脚本参数和 fixture 前提，不把示例理解成每批必须运行所有门禁。

数据库、执行和升级变更使用临时 DB、fake clock、fake runtime 做失败/恢复测试，不在正式历史上造故障。UI 变更检查 desktop、390×844、实际 pointer hit target、截图、重复轮询、迟到响应、reload、拒绝/恢复。保持此前已修复的滚动位置、菜单、选择消息及移动导航合同。

每个完成的产品修复批次按用户站立要求重启正式本地工作台：检查活动工作与 exact instance → 备份并核验持久状态 → 正常停止 → 用已验证冻结资产启动 → 核对新进程/build identity → 从实际用户入口新开真实浏览器。复用现有 restart guard，不猜 PID、不复用本文中的历史进程信息。活动执行不能排空则报告部署阻塞，不强杀；health 通过不等于界面验收。仅文档批次无需重启。

每项交付记录以下字段：

| 字段         | 内容                                                            |
| ------------ | --------------------------------------------------------------- |
| 工作项与裁决 | R 编号；确认缺陷/已有覆盖/新增缺陷/待实机/不适用                |
| 证据         | 原行为、源码版本/位置、失败测试及其预期失败                     |
| 改动         | 单一 owner、最终行为、与 Raft 的有意差异                        |
| 验证         | 实际执行命令、退出结果、截图/查询计划/故障恢复记录              |
| 部署         | 未部署或正式重启证据；实际入口验证；备份和回退条件              |
| 剩余项       | frontend/backend/验证缺口分别说明；不得用“全部完成”掩盖外部阻塞 |

在 `docs/README.md` 链接最终批次证据。按闭合修复组织 diff，避免无关重构和 ratchet 放宽。交付时明确代码完成、自动化通过、真实浏览器通过、实机通过、真实 CLI 通过、Raft 同条件双边通过、正式部署通过分别是什么状态；它们互不代替。

## 10. 可直接给 Fable 的开工说明

> 请按照本指南从批次 A 开始，先复核当前工作区和 owner，再按 TDD 修复已经确认的问题；保留用户既有产品决定。不要原样实施旧审计中的 HOME 隔离、强制删除、旧 Human Task 限制或 PWA 审批聊天补全。最新 Raft 证据只用于具体行为比较，不进行整仓升级。每批给出失败反例、实现与测试、正式部署状态和剩余项；需要外部条件的项目先完成所有独立工作，再明确具体阻塞。本次开工不包含自动 commit/push、发布或付费 Provider 测试。
