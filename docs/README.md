# RAH OS 文档

这里仅保存能约束代码和验收的长期文档。阶段性讨论、旧 RAH 的 Session/UI 细节和 provider transcript 适配经验不迁入本仓库。

Raft 产品行为的首要监督基线：[Raft 官方教程监督基线](./product/raft-official-tutorial-supervision.zh-CN.md)。

最新正式发布：[修复后正式重启验收](./audits/2026-08-31-formal-restart-after-rendering-fix.zh-CN.md)。按用户常驻要求，每批修复后安全重启并检查正式新页；本次图表稳定性与managed presence已部署4173，额外修复重启后历史已结束Run误报unknown。数据/配置/私有文件与备份一致；不宣称全站收口。

用户反馈后的最新纠正：[消息图表闪动、测试环境误交付与行为合同覆盖账目](./audits/2026-08-31-rendering-regression-and-contract-coverage.zh-CN.md)。图表/图片因renderer身份变化反复重挂载，已按失败浏览器回归修复；4198的探针、图表样本和回复来自Fake CLI隔离环境，不是正常产品工作记录。旧74项母版意图与当前1836个源码候选不能作为产品完成率；近期去重11组详细合同逐项列出前端、后端及双边限制。其部署状态由上方重启报告更新。

Agent头像presence：[先行设计](./product/2026-08-31-agent-presence-closure.zh-CN.md)与[第一批施工复核](./audits/2026-08-31-agent-presence-closure-review.zh-CN.md)。接通无内容当前状态、运行/Host事实优先级与共享头像；隔离桌面已观察思考/工作/异常/在线/退出及头像hover/click。现已正式部署，但真实模型全状态、有效390px证据及external仍未收口；不能用部署扩大局部验收结论。

最新状态点审查与发布：[七种颜色、分型合同与正式重启核验](./audits/2026-08-31-status-dot-audit.zh-CN.md)。区分导航未读、Computer 连通性、Agent presence 与动态诊断；修正输出/动作/错误/压缩完成颜色及呼吸动画。备份后重启持久 4173，真实桌面/390px、私聊、头像交互、资料弹层与动态核验通过所列用例；最终802项测试800通过2跳过。头像实时 thinking/error/external 仍未实现，不宣称全状态一致。

最新修复与独立裁决：[前后端补强交付与主审复核](./audits/2026-08-31-parity-reinforcement-final-review.zh-CN.md)。按[前次第三方问题基线](./audits/2026-08-31-third-party-parity-final-review.zh-CN.md)完成A–F及浏览器追加反例修复，三路独立源码/真实回调/1440×900与390×844浏览器复验。发布隔离、Host观测、未读/系统通知、InputRequest异步到达、Activity消息列导航及文件树细节已获所列证据；官方非空树、真实Host停机/Provider仍未覆盖。该报告当时的旧4173阻塞及未部署状态，已由上方状态点发布核验更新；不据此次发布扩大为全站一致。

当前施工准则：[Raft 前端行为合同 → 本地能力映射](./product/raft-frontend-local-contract.zh-CN.md)。以官方请求/显示/交互为合同，不复制中央服务器拓扑；已冻结当前23个发布文件，源码语义追踪尚未全站完成。纠正旧动态链接“只解析 metadata”的表述；Enter 已修正为 Room/DM/Thread 共享发送规则。实测见[本轮核验](./audits/2026-08-31-frontend-local-contract-verification.zh-CN.md)。

Agent 触发点最新验收：[六列施工合同](./product/2026-08-31-agent-trigger-contract.zh-CN.md)、[源码与双边浏览器审计](./audits/2026-08-31-agent-trigger-browser-audit.zh-CN.md)。本轮补资料语义、统一头像预览、动态对话链接和只读私有目录；官方 Computer 离线，非空文件树与精确 Task/Thread target 尚未收口。CLI 安装和账号配置由用户负责，不属 RAH OS 待开发功能。

Files 首批与空间 / Computer 最新结论：[施工方案](./product/2026-08-31-files-and-computer-contract.zh-CN.md)、[实现与真实浏览器审计](./audits/2026-08-31-files-first-slice-and-computer-review.zh-CN.md)。Human Channel/DM 附件主链已验证；Agent 文件读写、Task/Thread 附件、空间切换和完整 Computer read model 尚未完成。本轮实际双边视口为 1280×720，不宣称移动端或全产品 1:1。

核心交互的最新结论：[核心交互收口复审](./audits/2026-08-31-core-interaction-closure-review.zh-CN.md)、[设计与 owner](./product/identity-and-agent-interactions.zh-CN.md)。本轮补了 OpenCode 角色/会话过滤、重复 busy、导航草稿、搜索初始态和侧栏鼠标/键盘行为；双边1440px实页、真实OpenCode两轮与390px回归通过所列用例，但仍不能宣称全部核心页面/鼠标行为等同Raft。前一批证据：[Workspace / Agent 交互对照审计](./audits/2026-08-31-workspace-and-agent-interactions.zh-CN.md)。

Chat / Agent 当前验收结论优先阅读：[基础链路修复、真实 CLI 与 Raft 对照审计](./audits/2026-08-31-chat-agent-repair-and-parity.zh-CN.md)。包含 DM 入口、刷新闪烁、模型编辑、跨 Room 动态、五次真实 CLI 与跨模块浏览器证据，并解释 Raft 动态的独立采集通道；明确保留动态聚合、资料控制、Files 等缺口，不宣称全产品 1:1 或正式进程已经升级。

本轮缺口修复：[分批方案](./product/raft-gap-repair-plan.zh-CN.md) → [施工前二次审查](./audits/2026-08-30-raft-gap-plan-second-review.zh-CN.md)。第一批是 Cleaner 独立配置闭环，不是重新设计记忆算法；其余产品缺口分批放行。

第一批落地与真实浏览器证据：[Cleaner 配置闭环验收](./audits/2026-08-30-cleaner-config-closure.zh-CN.md)。含持久条件更新、Run 私有 CLI、重置回滚竞态、双页面冲突和移动端保存；未开启自治维护，未部署正式服务。

第二批基础证据：[全局 Tasks / Search / Human Activity 验收](./audits/2026-08-30-global-discovery-closure.zh-CN.md)、[范围与复用设计](./product/global-discovery-design.zh-CN.md)。后续交付以 [弹层、搜索排序、全局拖拽与正式启动审计](./audits/2026-08-30-discovery-interactions-delivery.zh-CN.md) 为准：1440 双边与 390 浏览器验证、655+37 测试通过、持久 4173 已启动；保留任务安全限制，不宣称取得 Raft 服务端相关度算法或全产品 100% 复刻。

当前实测结论优先阅读：[真实 Agent 记忆验收与 Raft / Multica 产品对照审计](./audits/2026-08-30-real-memory-acceptance-and-product-audit.zh-CN.md)。七次真实 OpenCode/DeepSeek 与 Kimi 调用、文件可见/不可见反向对照、同尺寸页面审查；纠正旧 Multica 记忆结论，并明确全局 Tasks/Search/Activity 等仍未收口。此前阶段报告不能代替本次证据，也不能反向覆盖已经撤回的默认策略。

Raft MCP 配置、Agent 使用页与 RAH canonical owner 的当前监督基线：[Raft Managed MCP 产品监督基线](./product/raft-managed-mcp-supervision.zh-CN.md)。

Raft 源码吸收、多 Computer 与模块裁决的当前实施政策：[Raft 源码收敛与多 Computer 架构审计](./audits/2026-08-27-raft-source-convergence-and-multi-computer-audit.zh-CN.md)。

各家 CLI 模型名、effort 发现能力及 Raft/Multica/旧 RAH 的来源裁决：[Provider 模型与 effort 目录审计](./audits/2026-08-28-provider-model-effort-catalog-audit.zh-CN.md)。

各家 CLI 的 ACP/app-server/SDK 执行路径、权限版本漂移与真实 mixed-Runtime 门禁：[Provider CLI 执行传输与权限审计](./audits/2026-08-28-provider-execution-transport-audit.zh-CN.md)。

Raft Agents 桌面/PWA 截图、官方 bundle 合同与 RAH_OS 差距：[Raft Agent surface 桌面/PWA 证据审计](./audits/2026-08-28-raft-agent-surface-snapshot-audit.zh-CN.md)。

Raft/Multica 成熟实现的逐模块采用、结构化移植、自有 glue 与禁止误报边界：[Raft / Multica 成熟实现吸收台账](./audits/2026-08-29-raft-multica-reuse-ledger.zh-CN.md)。

Agent Memory 的首要工程原则：先复用 Raft 原始框架，再做可选、无损、可回退的增强；撤回文字切分与默认项目依赖：[Raft 基线优先与增强准入](./product/agent-memory-raft-baseline.zh-CN.md)。

当前 Run 的 Computer-local App Inbox check/ack/recheck、确认/整理证据区分、版本与测量竞态、真实子进程接入审计：[Memory App Inbox 接入与复核](./audits/2026-08-30-memory-app-inbox-audit.zh-CN.md)。

剩余 Memory 能力在 Raft 中的实际实现、必要性排序、最小适配、版本发布与真实验收顺序：[Raft 剩余能力复用与实施计划](./product/agent-memory-raft-completion-plan.zh-CN.md)。该计划未宣称新增能力已经实现，busy notice 与跨 Computer 扩展不再混作本机基础门禁。

撤回默认记忆筛选/项目写作规则、全量哈希消费者与必要性、暂停自定义空闲维护、未来整体引入成熟体系的边界：[Memory 策略收缩审计](./audits/2026-08-30-memory-policy-retraction-audit.zh-CN.md)。

普通启动 index-only 收据、旧版只读兼容、零笔记读取反例、实际 Runtime prompt/revision 与隔离浏览器链路：[Memory 启动收缩落地验收](./audits/2026-08-30-memory-index-only-rollout-audit.zh-CN.md)。

Raft Computer 1.0.18 的 `MEMORY.md`、`notes/`、启动注入、cleaner 与 workspace reset 的 byte-exact 源码证据和首轮 production port：[Raft 记忆系统源码冻结与 RAH OS 移植账本](./audits/2026-08-29-raft-memory-source-extraction.zh-CN.md)。

Memory maintenance、reset、restart 与安全强制改派共用的全局 per-Agent 管理操作 fence：[ADR-0024](./adr/0024-global-agent-exclusive-operation-fence.md)。

Memory 索引/正文如何形成、Raft 与 Claude-Mem/Claude auto memory 的区别、Computer home 安全栅栏与本轮 P0 证据：[ADR-0025](./adr/0025-agent-memory-home-and-index-formation.md)、[P0 修复与记忆形成机制审计](./audits/2026-08-30-memory-p0-and-formation-audit.zh-CN.md)。

精简索引总预算、cwd/项目身份的区别、同项目多目录与相关项目的分阶段方案：[索引与项目身份研究](./audits/2026-08-30-memory-index-project-research.zh-CN.md)、[ADR-0026](./adr/0026-compact-agent-memory-and-project-hints.md)。

Computer 本地显式目录提示、短索引项目标签和不可变运行来源（M2a）：[配置、边界与验收方法](./product/agent-memory-project-bindings.zh-CN.md)。

Agent 私有 Memory、typed App Inbox、独立 maintenance lane、restart/reset 语义和安全栅栏的最终 owner 决策：[ADR-0023](./adr/0023-agent-private-memory-app-inbox-and-maintenance.md)；当前 E2 证据与未收口问题：[Agent 记忆体系收口审计](./audits/2026-08-30-agent-memory-closure-audit.zh-CN.md)。

真实 OpenCode/Kimi 浏览器跨 Channel/DM 形成、召回、不同 Agent 隔离、刷新恢复及最终产品裁决：[Agent Memory 最终代码与真实浏览器审查报告](./audits/2026-08-30-agent-memory-final-browser-audit.zh-CN.md)。

RunAttempt receipt、本机 Human Memory UI、安全幂等 reset、桌面/PWA 门禁，以及 Raft 源码与 Multica 当前/提案能力的最终 PK：[Agent Memory 收口、Raft 源码对齐与 Multica PK 审计](./audits/2026-08-30-agent-memory-closure-and-multica-pk.zh-CN.md)。

Human Inbox 将真实 Worker InputRequest 投影到 desktop/PWA 并恢复同一 Task 的浏览器证据：[Human Inbox + InputRequest 浏览器收口证据](./audits/2026-08-30-human-inbox-browser-gate.zh-CN.md)。

最后一段产品开发的复用裁决、依赖顺序与验收门禁：[RAH OS 最后一段产品收口设计](./product/final-closure-plan.zh-CN.md)。

Raft busy inbox、Codex `turn/steer` 与 RAH OS Activation/Worker cursor 的所有权裁决：[Runtime live input / steer 所有权审计](./audits/2026-08-29-runtime-live-input-ownership-audit.zh-CN.md)。

Raft 官方 Web 与 RAH OS production Web 的同操作、同结果、真实 CLI 和持久化收口账本：[Raft ↔ RAH OS 端到端对照审计账本](./audits/2026-08-29-raft-e2e-parity-ledger.zh-CN.md)。

Raft 官方与 RAH OS 在同一桌面尺寸下完成 Channel、DM、Thread、Task、Agent、Activity、Search 与 Computer 的双边真实浏览器逐功能结果：[Raft ↔ RAH OS 双边真实浏览器逐功能验收报告](./audits/2026-08-29-raft-bilateral-browser-verification.zh-CN.md)。

不采信上述结论、重新启动真实 OpenCode fixture 并独立复核官方 Raft live DOM、Channel、DM、Thread、Task、Agent、Computer 与移动端结果的反证审计：[Raft ↔ RAH OS 独立第三方双边审计](./audits/2026-08-29-independent-third-party-bilateral-audit.zh-CN.md)。

阅读顺序：

1. [v0.1 收口与竞争性独立审计](./audits/2026-08-26-v01-closure-competitive-audit.zh-CN.md)
2. [Runtime Placement 与下一阶段独立审计](./audits/2026-08-26-runtime-placement-independent-audit.zh-CN.md)
3. [独立架构审计](./audits/2026-08-25-independent-architecture-audit.zh-CN.md)
4. [进程监督器独立复审](./audits/2026-08-25-process-supervisor-follow-up-audit.zh-CN.md)
5. [Host 认证与 Daemon 生命周期独立审计](./audits/2026-08-25-host-daemon-lifecycle-audit.zh-CN.md)
6. [Core SDK 边界](./architecture/core-sdk-boundary.zh-CN.md)
7. [Room-first 核心架构](./architecture/room-first-core.zh-CN.md)
8. [Inbox、Activation 与 AgentHost](./architecture/delivery-and-activation.zh-CN.md)
9. [Daemon Core 运行架构](./architecture/daemon-core.zh-CN.md)
10. [Client、Daemon 与部署边界](./architecture/client-daemon-and-deployment.zh-CN.md)
11. [前端平台架构](./architecture/frontend-platform.zh-CN.md)
12. [Raft UI 产品集成边界](./architecture/raft-ui-product-integration.zh-CN.md)
13. [Runtime Adapter 与观察平面](./architecture/runtime-adapter-and-observation.zh-CN.md)
14. [Worker Application Service](./architecture/worker-application-service.zh-CN.md)
15. [Runtime Registry 与多 Lane 调度架构](./architecture/runtime-registry-and-multi-lane-scheduling.zh-CN.md)
16. [Memory 与 Context Fabric](./architecture/memory-and-context.zh-CN.md)
17. [Core 模块边界与源码规模 Ratchet](./architecture/core-module-boundaries.zh-CN.md)
18. [架构优势对照基准](./experiments/competitive-benchmark.zh-CN.md)
19. [ADR-0001：建立独立 Room-first 仓库](./adr/0001-room-first-repository.md)
20. [ADR-0002：Daemon-first、多客户端单一协议](./adr/0002-daemon-first-multi-client.md)
21. [ADR-0003：身份安全的 POSIX 进程监督器](./adr/0003-identity-safe-process-supervisor.md)
22. [ADR-0004：认证 Host 与本机 Daemon 生命周期](./adr/0004-authenticated-host-and-daemon-lifecycle.md)
23. [ADR-0005：Daemon composition、Worker delegation 与 durable wake](./adr/0005-daemon-composition-worker-delegation-and-wake.md)
24. [ADR-0006：Task 业务协议与 causal Worker command](./adr/0006-task-business-protocol-and-causal-worker-commands.md)
25. [ADR-0007：Durable InputRequest 与无 listening 等待](./adr/0007-durable-input-request-and-no-listen-waiting.md)
26. [ADR-0008：版本化 Human Client Application Service](./adr/0008-versioned-human-client-application-service.md)
27. [ADR-0009：不可变 Runtime Placement 与 Multi-Lane AgentHost](./adr/0009-immutable-runtime-placement-and-multi-lane-host.md)
28. [ADR-0010：Web/PWA 共享 UI、可移植 Client Core 与薄原生壳](./adr/0010-web-pwa-shared-ui-and-native-shell.md)
29. [ADR-0011：Task Coordination v1](./adr/0011-task-coordination-v1.md)
30. [ADR-0012：Workspace、Room Role 与 Thread 最小边界](./adr/0012-workspace-room-role-and-thread-boundary.md)
31. [ADR-0013：Human Application Port 与 Transport 边界](./adr/0013-human-application-port-and-transport-boundary.md)
32. [ADR-0014：Activation-scoped Agent Room reply](./adr/0014-activation-scoped-agent-room-reply.md)
33. [ADR-0015：Room membership 投递与 Agent activity](./adr/0015-room-membership-delivery-and-agent-activity.md)
34. [ADR-0016：Workspace Agent 原子创建与冻结运行上下文](./adr/0016-workspace-agent-provisioning-and-runtime-context.md)
35. [ADR-0017：持久化 loopback 本地工作台](./adr/0017-persistent-loopback-local-workbench.md)
36. [ADR-0018：launchd Computer supervisor 与 K slots](./adr/0018-launchd-computer-supervisor-and-k-slots.md)
37. [ADR-0019：本机 Core、正式 LAN Edge 与直连 Computer](./adr/0019-local-core-secure-lan-edge-and-direct-computers.md)
38. [ADR-0020：Task 意图、单一负责人和次级角色](./adr/0020-task-intent-single-owner-and-secondary-roles.md)
39. [ADR-0021：冻结 Task 提交与 canonical Review](./adr/0021-frozen-task-submission-and-canonical-review.md)
40. [ADR-0022：可逆 Closed 与 Runtime cancellation fence](./adr/0022-reversible-closed-and-runtime-cancellation-fence.md)
41. [ADR-0023：Agent 私有 Memory、App Inbox、维护执行与安全 Reset](./adr/0023-agent-private-memory-app-inbox-and-maintenance.md)
42. [Phase 1 实验证据](./experiments/phase-1-evidence.zh-CN.md)
43. [Daemon config v2 兼容示例](./examples/daemon.config.example.json)
44. [Daemon config v4 多 Agent 示例](./examples/daemon.config.v4.example.json)
45. [实施路线与门禁](./roadmap.zh-CN.md)

维护规则：

- ADR 记录已作出的不可逆或高成本决策。
- Architecture 记录长期 owner、不变量和对象关系。
- Experiments 记录可复现证据，不把一次成功伪装成生产保证。
- Audits 独立区分 E0 设计、E1 Kernel、E2 系统和 E3 对照证据。
- Roadmap 只列当前阶段和退出条件，不保存易过期的日期承诺。
- 删除已被新文档完全取代的内容；不要维护两个相互竞争的架构真相。
