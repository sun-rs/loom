# Agent Memory：Raft 基线优先与增强准入

状态：默认恢复 Raft 原文件读取；两个 memory prompt builder 已 byte-exact 纳入源码并接入共享 Worker prompt。未完成整个 Raft 记忆功能 100% 移植，未部署到用户在线实例。

后续真实验收：当前版本已通过七次 OpenCode/DeepSeek 与 Kimi 的形成、反向对照、新会话及跨 Provider 召回。本文末尾“未运行付费模型”只描述原收缩变更当时的证据；最新结果见[真实记忆与产品对照报告](../audits/2026-08-30-real-memory-acceptance-and-product-audit.zh-CN.md)。idle 维护、长期质量与全 Provider 强隔离仍未据此完成。

## 不可越过的原则

先建立可独立运行、可对照的 Raft 基线，再考虑增益。一个 Agent 仍只有 `MEMORY.md + notes/`：完整索引先读、正文按需读、Agent 主动整理、Active Context 用于恢复。模型、effort、Room、cwd 不成为新的记忆 owner。

Computer 不切分、筛选、摘要、重排或改写索引。不引入自动碎片库、多层分类和按 cwd 分库。上下文成本首先靠 Raft 原有的索引写作与 cleaner 提醒约束，不用截断事实来假装节省 token。

默认提示词现已撤回 RAH 附加的跨 Room 价值条件、跳过清单、完成后仅留可复用经验、项目标签写作/检索规则。继续使用 Raft 自身的 What to memorize / How to organize memory；保留路径、传输、凭据和业务权限说明。原源码存在不等于最终行为等价，本次只恢复基线，不宣称真实模型质量已经通过。可选项目映射的已有数据/格式保留兼容，不再由默认 prompt 要求模型据此分类。见[收缩审计](../audits/2026-08-30-memory-policy-retraction-audit.zh-CN.md)。

## 代码来源与真实完成边界

固定来源为授权取得的 Raft Computer 1.0.18，bundle SHA-256：`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

| 部分                                          | 当前采用方式                                                                                         | 验收边界                                                                                             |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Workspace & Memory / Compaction safety 提示词 | `raft-memory/upstream-standing-prompt.ts` 原始 4,049 bytes，仅追加 ESM export footer；测试校验源 SHA | 两个纯函数已逐字复用，不代表所有 runtime 自动完成了压缩后重读                                        |
| 种子、稳定 Agent 目录、仅首次创建             | 已有结构化移植                                                                                       | 保留原始索引与正文，切模型/Room 不重建                                                               |
| Runtime cwd 与记忆位置                        | 独立 RAH 适配                                                                                        | 项目 cwd 不变；上游开头的 cwd 段替换为 Agent 私有绝对环境路径，其余 memory/compaction 原文保持       |
| Cleaner 阈值、调度、typed Inbox               | 已有结构化移植，当前 Run 已接 scoped check/ack                                                       | check 只查看、ack 只确认通知；主动源状态 recheck 为独立适配；active notice/idle maintenance 仍未接线 |
| reset                                         | 上游语义加 RAH 安全适配                                                                              | 保留全局 fence、quarantine、回滚、幂等；不倒退为无保护删除                                           |
| Run receipt / Memory Home                     | RAH 承载与安全设施                                                                                   | 非上游直接复制；receipt 只证明 materialization，不证明模型已读                                       |

完整来源、切片和未接线项仍以[源码移植账本](../audits/2026-08-29-raft-memory-source-extraction.zh-CN.md)为准。禁止把其中的 `structured-port`、RAH glue 或未完成项统一标成“100% 原源码”。

## 本次撤回与修复

1. 撤回 M1 的 512-byte Markdown 分块和按 4 KiB 挑选条目。实测发现空行续段会丢失限制条件或项目范围；修复方式是删除切分路径，而不是增加更多解析规则。
2. `RAH_AGENT_MEMORY_BOOTSTRAP_JSON` 改为 v2 transport envelope。默认 `mode=raft_original/status=read_original/text=""`，必须读取完整原始文件；元信息没有替代记忆。
3. `verbatim_inline` 仅为显式测试/内部准备入口，生产 composition 未启用。只有完整序列化 JSON 不超过 4096 bytes 才逐字内联整个索引，包括 BOM/CRLF；否则整份退回原文件读取。没有 partial 结果，也没有 `omittedBlocks`。4 KiB 仅限制传输 envelope，不限制真实模型上下文。
4. 配置存在才启用目录提示；未配置可直接运行 Raft 基线。严格 resolver 仍拒绝非法配置，Activation 将可选目录错误标为 `source.resolution=unavailable`、不提供项目标签并继续运行。真实 cwd 不存在、私有记忆根不安全、记忆内容完整性错误仍失败。
5. 无效配置状态只表示无法解析，不声称冻结了某一份已验证 catalog 内容。恢复合法映射后新 Run 生效；同一 Run 从 unavailable 变为 matched 仍拒绝改写来源。完整 source 仅在 receipt 中按需读取，短错误状态放入启动 envelope；Human 配置错误展示尚未接入。

原始 memory 内容从未由本次代码迁移、切分或重写。源码修改不会热更新已有冻结 RuntimeProfile、常驻进程和旧 provider session。本机 workbench 的正常启动路径已有 import/probe/activate，可导入新 revision；显式配置或自定义 profile 不因此自动升级。发布仍须验证实际 Run 选中正确 revision，不热改旧 revision、不自动重启用户服务。

## 增强准入

每项增强必须写明：上游基线、具体差异、开关/回退方式、预期收益、失败降级以及反例测试。改变信息内容或选取策略的增强，未通过真实模型对照不得成为默认。

- 普通启动已撤除全量 notes digest：新 Run 使用 `schemaVersion=2/coverage=index_only` 收据，只检查索引，不遍历正文。旧 v1 全量收据可读且不改写，旧 Run 不以局部检查冒充重新验证，必须使用新 RunAttempt。显式 Human inspect/read 保留按需检查；不新增缓存系统。实现与当前证据见[启动收缩验收](../audits/2026-08-30-memory-index-only-rollout-audit.zh-CN.md)。
- M4 真实验收前移：同模型、同问题、隔离 provider continuity，对照原索引与候选增强；检查跨 Room 召回、多目录同项目、无关项目误用、修正旧事实、实际读取内容/次数/延迟。模型自述不是证明。
- 最小网页配置可见性、临时对话策略独立交付；后者需控制旧 provider 上下文、自动记忆与读写通道，同 UID/full-access 不能冒称强隔离。
- 跨 Computer 项目注册、逐条全结构化 provenance、共享知识治理后置，不阻塞本机基线验证。

当前没有新分类模型、向量库、自动 observer 或额外 Markdown 解析依赖。没有为了“100%”取消 RAH 的权限边界或复刻 Raft 的账号/中央服务器依赖。

## App Inbox 接入增量

当前 Run 的 Computer-local `agent inbox check/ack` 已接入，复用 Raft 的查看/确认语义以及现有 RAH CLI 凭据、wrapper 和 release。`recheck` 是显式源测量增强，不在默认 check 中偷偷测量或重建通知。通知 version 仅用于防止迟到确认，不进入 `MEMORY.md` 或正文，也不创建第二份记忆。

这不等于 idle Agent 自动整理：本轮未新增 Runtime、未接 active notice，也未引入另一条聊天/任务队列。详细证据和剩余顺序见 [App Inbox 接入与复核报告](../audits/2026-08-30-memory-app-inbox-audit.zh-CN.md)。

剩余项已进一步对照 Raft 的实际 lifecycle、配置和启动代码，见[复用与实施计划](./agent-memory-raft-completion-plan.zh-CN.md)。普通记忆的真实验收先行；idle 维护复用现有执行设施，busy notice 按能力后置，不因本机收口扩建远程迁移或检索引擎。

## 本轮验证（2026-08-30）

- 先确认旧实现无法通过完整原文/限定条件保留、默认原文件读取、无关目录配置不阻断以及上游 prompt 正文一致性测试，再实现修复。
- 13 个定向测试文件共 68 项通过：包含 byte-exact 源码 SHA、原文/BOM/CRLF 不变、整份超预算回退、目录错误降级与安全根拒绝、真实 Node 子进程的跨 Room/RuntimeProfile/目录持续性、本地/远程启动接入。
- `npm run check`：类型检查通过；后端 627 项中 625 通过、2 项付费门禁跳过；Web 单测 25 项通过。`npm run format:check` 与 `git diff --check` 通过。
- 未运行付费模型或真实浏览器召回对照，未改在线配置、未部署/重启/提交。旧冻结 prompt 与 v2 envelope 的配对迁移必须在发布门禁中验证，不能仅升级文件就宣布在线 Agent 已采用新规则。
