# rc.1 审计复核与最新 Raft 差异

日期：2026-09-16。RAH 对象：`98dc095` / `v1.0.0-rc.1`。
本次是源码审查与修复设计，没有实施产品修复、升级 Raft、修改用户数据或运行付费 Provider。

## 结论

Raft 的确在继续改进服务端与 Computer，但不能把 Web `1.16.0` 与 Computer `1.0.18` 直接相减，更不能由版本跨度推导出 RAH 全面落后。当前公开交付物应分三层读取：

| 层          | 这次取得的实际证据                                                                                                        | 能证明什么                                                               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Web         | `release/v1.16.0`，commit `ba2a1dbac175595f28dfe1c09e4df2556d59ac0c`，构建时间 `2026-09-16T05:28:44Z`；更新日志日期 09-15 | 当前发布的浏览器实现、客户端合同、官方发布声明                           |
| Computer    | Hands main 稳定版 `1.0.32`，发布时间 `2026-09-13T14:20:59.460Z`；CDN 不可变 manifest 与 Hands 的二进制 SHA-256/长度一致   | 本机执行服务实际交付代码，可以与 `1.0.18` 做实现级比较                   |
| 中央 Server | 未取得完整实现源码、数据库 schema 或部署仓库                                                                              | 更新日志能证明官方声称修复了什么，不能证明内部 SQL、迁移、事务或竞态实现 |

Web `1.15.0` 宣布 Computer/daemon 统一版本，同时明确没有在用户 Computer 上部署该变化。当前下载的 `1.0.32` 包中 `packages/computer/src/version.ts` 仍烘焙 daemon `1.0.26`、CLI `0.0.24`；旧 `1.0.18` 则烘焙 daemon `1.0.19`、CLI `0.0.18`。不能把发布目标当成已经到达所有终端的状态。npm 的 `@botiverse/raft-computer` 仍是 `0.0.70`，也不是当前 SEA 稳定版入口。

RAH 的运行时早期证据基线确实是 Computer `1.0.18`，但 UI 并未整体冻结在那里：仓库已有 08-31、09-08 以及 09-14/15 的后续 Web 源码对照。因此这次应升级的是分层证据基线和差异清单，而不是机械替换整套实现。

Fable 报告中，CI 失败、事件查询热点、版本展示、迁移保护和删除阻塞诊断值得修复；“无私有 cwd”“PWA 审批必须增加讨论”“恢复旧 Human Task 限制”等不应照单实施。Tailnet 零浏览器 token 是用户明确选择，普通 LAN 自动继承这种信任则是需要单独处理的暴露范围问题。

## 证据与方法

上游入口：

- [Web 正式入口](https://app.raft.build/)，主资源 `assets/index-CKeqacxz.js`。
- [官方更新日志组件](https://app.raft.build/assets/ReleaseNotesPanel-CFTnPuA0.js)，通过 TypeScript AST 读取静态条目，没有执行第三方模块。
- [Computer 稳定版发布源](https://hands.build/public/v2/apps/raft-computer-cli/latest?channel=main&product_type=cli-binary)。
- [1.0.32 不可变 manifest](https://cdn.raft.build/computer/1.0.32/manifest.json) 与 [官方安装器](https://cdn.raft.build/computer/install.sh)。只读取安装器，没有执行。
- [Computer 官方文档](https://docs.raft.build/zh-cn/features/server/computers/)，用于核对 Server/Computer 的产品边界。

新旧 Computer 均按 Node SEA 格式提取 JavaScript，再按保留的源码边界拆分；这些是编译后的实现，不是恢复出的完整 TypeScript 仓库。新构件 SEA 解析剩余字节为 0。比较时排除 bundler 改名噪声，重点检查具体函数与条件，不能以文件增量或函数数量衡量能力。

源版本、URL、摘要和重要位置记录于[证据清单](../evidence/raft-release-20260916/manifest.json)。原始发布包、提取代码和差异片段仅保留在本机分析目录 `/private/tmp/raft-20260916-audit`，未加入产品依赖或提交范围。旧证据来自独立 `raft-runtime-forensics` 分析工作区。本次未取得新的第三方再分发授权；公开可下载不等于允许把整包纳入 RAH 发布物。

审计输入是用户指定的 `rah-os-rc1-release-audit-2026-09-16.md`；其结论按事实、产品决定、风险和验收空缺分别复核。上一轮详细只读复核位于 `/private/tmp/rah-os-rc1-audit-review-2026-09-16.md`，本文固化关键裁决并增加最新上游证据。

## Computer 实现变化

以下上游路径均相对于提取的 source slices；行号是切片内位置，可按清单中的版本/hash 重新生成。

| 领域           | 1.0.18 到 1.0.32 的实际差异                                                                                                                                                    | 对 RAH 的意义                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 升级来源       | `computer/src/kReleaseSource.ts` 原来读取 CDN；现在默认通过 Hands 解析渠道/目标，核对版本、平台、发行身份、hash/size，拒绝两次解析间同版身份漂移；旧 CDN 路径仍可显式选用      | 借鉴“不变制品身份”和失败闭合，不能把 RAH 升级源接到 Raft 的 Hands 服务。RAH 已有固定 Ed25519 公钥验证和 hash/size 校验，应补差异测试而非重写                      |
| 升级受理       | 新 `serviceUpgradeStart.ts` 区分 local/remote、requestId、originServerId、trigger；等待 coordinator 接受回执，精确重复可重放，身份冲突拒绝                                     | 检查现有 AgentHost 升级 owner 的受理/执行/完成语义，不能把 spawn 成功当升级完成；RAH 已有 generation/HMAC 控制路径                                                |
| 升级恢复       | 新 `kOperationAcknowledgement.ts` 在确认终态前核对 stable slot 字节、版本、两次活服务读回、前驱进程退出以及 coordinator/lock；新增 installer convergence                       | 对“阻塞后如何恢复”很有参考价值。补精确 operation 的诊断和恢复，而不是超时清围栏。它是制品升级恢复，不能据此宣称 Raft 已解决 RAH 的 SQLite schema 迁移备份         |
| macOS 生命周期 | 新 `macosLoginCarrier.ts` 创建用户 LaunchAgent，使用稳定 dispatcher、状态根关联身份、持久 replacement/recovery 记录；不是只加一条开机命令                                      | Raft 登录后恢复有实质增强。RAH 已有 LaunchAgent，需按稳定路径、升级后恢复与失败回滚逐项比较，不需再造第二个服务 owner                                             |
| 安装交付       | 当前 manifest 带 Developer ID、hardened runtime、公证 Accepted 元数据；读取构件签名确认 Botiverse Team ID 与 CDHash 一致                                                       | RAH 对外分发的签名/公证属于真实差距。仅验证了本机签名元数据，未作 Gatekeeper 安装验收；不能把 manifest 声明当完整实机证明                                         |
| 启动期间消息   | `daemon/dist/chunk-TEGPBMW7.js:18466,41203` 新 `selectWakeDeliveryIndex` 排除 `transient` 和 `mentionDelivery`；旧实现只排除 transient。启动后 ACK 也增加 mentionDelivery 排除 | 明确区分普通唤醒与跟踪提及，防止混用确认通道。RAH 用 durable Inbox/Activation，不复制 daemon 临时队列；补“启动中普通消息+提及，失败/重连后无漏读且不伪 ACK”的场景 |
| 故障定位       | `daemon/dist/dist-CI7CMKZV.js:5810` 新网络错误 cause-chain 提取，最多 8 层、防环，分 TLS/DNS/代理/连接/超时，诊断 URL 脱敏；doctor 增加登录载体和升级回执阻塞说明              | 可采用有界 cause-chain 和精确错误码思路改进删除/升级诊断。这里直接看到的是 CLI 网络错误分类，不能把它冒称中央 Server 的 SQLSTATE 实现                             |
| 外部消息合同   | 新 `shared/src/agentApiMessageContract.ts` 将消息发送/提及/任务当前投影合同集中，并拒绝外部投影伪造 task/mention 等权威字段                                                    | 支持 RAH 已有“传输不拥有业务状态”的方向。Slack/外部桥接代码出现不等于本次应扩建集成或恢复已退役的托管 MCP                                                         |

K carrier 从旧包内 `0.1.6` 到新包内带 patch hash 的 `0.1.8`。不能仅修改 npm 版本宣称复用最新版：Raft 交付物还包含其补丁。RAH 已有内部维护的 K owner，后续只能针对具体差异和失败测试做有界移植。

### 不是新版才有的能力

- `recordSpawnFailure` 新旧抽取函数逐字一致；运行时退避计算仍是指数退避、封顶、正向 jitter。因此官方“防崩溃循环”发布说明不能解释为 Computer 原本没有退避。修复可能在调用条件或中央 Server 自动启动路径；后者本次没有源码，不下结论。
- `reportAgentStartFailure` 仍对失败分类、保留 reason/detail 并发送 activity；主要差异只是编译变量后缀。新日志所述“保留具体失败原因”不能据此定位到此函数的新修改。
- `prepareCliTransport` 两版仍继承 `process.env`，再清除平台凭据和外部 profile 变量，并使用 per-Agent working directory。没有发现其改为“隔离所有 HOME/环境”的依据。RAH 的私有 cwd 已存在，不隔离 HOME 是用户决定；真正待做的是宿主服务秘密的定向隔离测试。
- RAH `runtime-error-policy.ts` 已有 action-required/sticky/recoverable 分类、5 分钟封顶和正向 jitter；release source 已校验签名和大小。不能把 Raft 出现同类更新自动记作 RAH 缺失。

## Web 与中央服务变化

下表主要来自官方更新日志，属于“官方声明”，不是本次获得服务端实现后的复现结论。Web 交付代码与日志已实际取得，中央 Server 源码没有取得。

| 发布区间                   | 与本次审查有关的变化                                                                                      | RAH 对应处理                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 1.10 / 08-30               | claim 未成功时 CLI 返回失败；任务时间线；活动分页、身份与请求参数校验                                     | 检查 CLI 退出语义、幂等、越权反例；任务时间线在 RAH 后续批次已有实现                                   |
| 1.11–1.12 / 08-31 至 09-05 | 搜索时间偏移、任务分页、消息 freshness 下的线程发送、旧 Computer 的 Kimi 兼容                             | 将“系统母消息/普通母消息+线程发送+stale retry”加入适用矩阵，不从 UI 分页推断后端索引                   |
| 1.13 / 09-10               | 升级目标不再依赖陈旧清单；附件预览/上传与侧栏模型信息改进                                                 | 升级解析与发布物配套相关；模型展示等已有后续 RAH 对照，不能重复算旧基线缺口                            |
| 1.14 / 09-13               | 活动精确计数、线程实时更新、任务/消息分页可见性修复；私聊摘要、空分组可隐藏                               | 优先验证边界条件下的分页 ACL、重连与计数。多 Human 扩建仍延期，但不能放宽已有 Agent/Room 隔离          |
| 1.15–1.16 / 09-15          | 消息发送修复；成员被移除/降权后，已发起的 Agent/Computer 操作不得迟到落地；启动失败可观测性及自动启动退避 | 提取“异步步骤后、提交前重验权限/版本”的回归要求。消息发送缺陷的具体根因未公开，不能宣称 RAH 有同一 bug |

这些变化说明 Raft 后端的可靠性和权限边界在持续增强，但无法证明其在所有维度都比 RAH 更强。尤其 RAH 的 SQLite、Room ledger、Activation fencing 和本地 LAN 入口与 Raft 中央服务拓扑不同，不能用 Computer 包推断数据库层实现，更不应迁入中央账号、计费、relay 或已排除的多 Human 项目。

## 对原审计的裁决

| 原项目                  | 裁决                                                         | 修复或保留原则                                                                                                                     |
| ----------------------- | ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| B1 版本不一致           | 成立                                                         | 建立产品 release identity；Settings/health/安装物来自同一构建输入，schema/protocol 独立。Raft 当前包自身也说明各层版本不能混为一谈 |
| B2/B3 许可、发布物      | 对外发行配套缺口成立                                         | 作者决定许可；核对第三方条款；产物/hash/release notes/支持平台明确。内部里程碑不等于正式可下载安装版                               |
| B4 CI                   | 确实失败，但原报告根因不准确                                 | 实际失败在 `npm run check` 内的 Playwright Chromium 缺失；浏览器安装排在 check 后。仅设置 Firefox 环境变量不够                     |
| B5 迁移保护             | 部分成立                                                     | 正式工作台重启已有 `backupState` 与完整性核验；通用迁移链仍缺统一失败保护。制品回滚不能代替数据兼容性处理                          |
| B6 真实 CLI             | 验收空缺，非已证实代码缺陷                                   | 依当前授权矩阵选择适用发布门禁，不能因 UI 变动盲跑全部付费测试。本批未执行                                                         |
| B7 CSS/来源             | 混合了维护政策与分发风险                                     | 内部维护源不再依赖旧生成器是 ADR 决定；应修陈旧来源头并核对分发许可，不恢复外部工作树构建依赖                                      |
| B8 网络                 | LAN 暴露风险真实；Tailnet 无 token 本身是明确产品决定        | 分开声明 Tailnet 与 LAN 信任，禁止未来配置悄悄扩大入口；现用 PWA 需有迁移方案，不能审计后直接切断                                  |
| H1 删除阻塞             | 终止证明缺失会长期阻塞；“无 UI/无超时”过度概括               | 前台已有 30 秒等待及错误展示，后台缺持久阻塞原因/恢复入口。参考新版 Raft 的精确回执恢复，不加入盲目强删                            |
| H2 PWA 审批             | 误报                                                         | metadata-only 中央弹窗是用户要求；保留，不补回重复聊天正文                                                                         |
| H3 键盘                 | 有价值的未复现风险                                           | 需要 iPhone 实机验证；缺 visualViewport/某个 meta 不足以证明必然遮挡                                                               |
| H4 旧 dist              | 检查目标错误                                                 | 正式工作台使用 `dist-workbench` 和冻结资产，不使用旧 `apps/web/dist`；发布附件不足归 B3                                            |
| H5 旧 all               | 条件性成立                                                   | 旧库 archived/private/改名 all 会启动失败；应预检与可恢复处理，不能自动公开私有频道                                                |
| Top-12 查询热点         | 成立                                                         | 已做只读 EXPLAIN；删除扫描与 Worker 授权查询缺符合条件顺序的索引，需要按查询计划修复                                               |
| Top-12 HOME/cwd         | “无私有 cwd”不成立                                           | 有 Agent workspace/catalog；HOME 不隔离是用户选择。宿主环境秘密另立明确威胁测试                                                    |
| Top-12 Task/ADR         | 业务放宽是 Human 已批准语义，ADR 过时成立                    | 更新 ADR-0029，保留 Worker claim/终止证明围栏；不能把旧 Human 限制恢复回去                                                         |
| Top-12 Outbox           | 缺保留策略/自适应退避，但不是完全无延迟或 GC                 | 现有 available_at_ms 与固定延迟、Room 删除清理存在；后续只清已交付且满足保留期的数据，不丢未确认消息                               |
| Top-12 前端/门禁        | ErrorBoundary、门禁编排值得补；没有 memo/ESLint 不自动是缺陷 | 现有真实浏览器测试不能抹去；按风险接 CI，不用脚本数量冒充覆盖                                                                      |
| Top-12 parity/范围/历史 | 文档与证据治理问题，不是所有功能都待扩建                     | PASS 是登记/ratchet 合法，不是 100% parity；保留已存在安全兼容，停止多 Human 扩建；不改写推送历史                                  |

中低项仍按上一轮裁决：附件评论启动回填需要规模测试；VAPID/推送租约需要区分故障注入与正常重启；审批轮询可增加退避，但已有分页上界；分享图片 effect 应先确定快照语义；`100vh` 需逐个看容器；SW 固定 cache 名不能单独证明陈旧资源。纯图标底栏和子页隐藏底栏是用户要求。

## 可执行修复顺序

本表是修复设计，不表示已经实现。每项先补失败测试，再修改单一 owner；不能用最新上游引用代替 RAH 自身验证。

| 顺序 | 范围与 owner                                 | 最小实现方向                                                                                                                   | 必须先复现/验证的反例                                                                 |
| ---- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 1    | CI：`.github/workflows/ci.yml`               | 在 check 前安装其实际启动的 Chromium/Firefox；按依赖列出移动关键门禁                                                           | 全新 Linux runner 无浏览器缓存也能完成；之后看真实远端 run，不只本机绿灯              |
| 1    | 网络：launcher / gateway                     | Tailnet、LAN 地址及信任模式显式分开；现用入口先盘点再迁移，保留用户选择的 Tailnet HTTP                                         | 新增普通网卡不得隐式得到全权入口；既有手机地址迁移后仍可用；拒绝错误 Host/Origin/身份 |
| 2    | 查询：Kernel schema/index owner              | 先分别评估 `(type, created_at, aggregate_id)` 与 `(type, aggregate_id)` 等候选，以两条真实 query plan 决定最少索引，不照单全加 | 大量无关事件下无每秒全表扫描；授权查询不扫整个事件覆盖索引；测写入成本与旧库迁移      |
| 2    | 版本：构建输入/daemon/Web                    | 单一产品版本+commit/build ID 注入；保留 schema/protocol 版本                                                                   | 包、health、UI、制品一致，开发构建不伪装正式版，旧客户端能识别构建代际                |
| 2    | 删除：Kernel projection + AgentHost recovery | 持久化阻塞 reason、run/host/recovery driver、首次/最近观察和可执行恢复路径；状态变化才追加事件                                 | Host 不回来时诊断明确；重启不丢原因；重复协调无事件风暴；无终止证明不能新执行或假删除 |
| 3    | 迁移：部署升级入口 + Kernel                  | 复用 online backup；只在 schema 变化前建立校验过的快照；DB 内可事务迁移，文件变化有恢复记录                                    | 中途进程终止/磁盘满/坏迁移后可恢复；WAL 与主库一致；不让旧二进制读取不兼容的新 schema |
| 3    | all：daemon bootstrap                        | 迁移前识别非法遗留状态，给具体阻塞原因；设计保留隐私与历史的显式恢复                                                           | public 正常库幂等；private/archived/改名不被静默公开、删历史或生成重复 canonical all  |
| 3    | 环境：AgentHost launch                       | 定向删除宿主服务凭据，保留 Provider 合法登录/代理配置；不另设 HOME owner                                                       | canary 宿主秘密不进入子进程；Codex/Claude/Kimi/OpenCode 原有登录发现与私有 cwd 保持   |
| 3    | Web 错误边界与 iOS                           | 共享错误回退；用实际键盘现象决定 viewport 修复，避免全局滚动重写                                                               | Room/DM/Thread 搜索与 composer，旋转/键盘关闭恢复；错误回退不重启 daemon/丢历史       |
| 4    | Outbox/诊断/发布                             | 共用 retry 分类与持久延迟；有界 cause-chain 脱敏；正式制品和许可清单                                                           | 重启保留重试时间、无丢投递；环形 cause 不死循环；日志无 token；下载制品可验证         |

升级版 Raft 还提示三类补充回归：提交前权限重验、分页越权边界、启动期间提及和普通消息混合投递。它们先进入适用性核查，只有 RAH 出现失败反例才算新缺陷；不借此重开已延期的多 Human 产品范围。

## 这次验证与限制

- 下载 gzip、解压二进制与 Hands/CDN manifest 的 SHA-256/长度均一致；未运行下载的 Computer。
- 读取 Developer ID 签名的 Team ID/CDHash 与 manifest 一致；公证 Accepted 为发布元数据，未做新的 Gatekeeper 或 Raft 安装测试。
- 检查了上述新旧源码函数、官方日志及 RAH 相关 owner。中央 Server SQL/事务源码、完整每版本 commit diff、真实 iPhone 键盘行为仍未取得，不能标为已验收。
- 本轮定向测试：`runtime-error-policy`、`computer-release-source`、`computer-service-upgrade-control`、`human-task-edit` 共 18 项通过，无付费 CLI。
- 上一轮复核已取得 [失败 CI run 35007939637](https://github.com/sun-rs/rah_os/actions/runs/35007939637) 与两条 SQL 的只读 EXPLAIN，并跑过私有 workspace/Human Task 的 30 项测试；这不是本轮重新运行全仓门禁的声明。
- 本次仅新增证据元数据与审计文档，执行文档格式和 diff 检查；未做产品修复、构建、正式重启、commit 或 push。
