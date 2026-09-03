# RAH OS 文档

本地长期运行最新收口：[事件唤醒、30 秒 reconciliation fallback、probe history cursor 与 Web
generation lease/保留合同](./product/2026-09-03-local-runtime-retention-and-wake-contract.zh-CN.md)；来源裁决、
短时 CPU/RSS/physical-footprint 对照、磁盘清理与正式发布状态见
[验证审计](./audits/2026-09-03-local-runtime-retention-and-idle-audit.zh-CN.md)。

Web 正式发布的跨代际自愈：[Raft 式刷新/继续合同、内容确定 build ID、gateway response fence、
Service Worker/cache 边界](./product/2026-09-03-web-build-recovery-contract.zh-CN.md)；两次正式
generation 切换、desktop/390×844 真实 Chrome、typed Notifications deep link、状态备份与
剩余 release GC/RSS 风险见
[验证审计](./audits/2026-09-03-web-build-recovery-verification.zh-CN.md)。

RuntimeOffer、模型目录发现与探测历史的长期运行收口合同：[lease heartbeat 不启动 Provider
CLI、能力变化才追加快照、Runtime Registry 内容寻址去重、Room 旧 heartbeat 安全压缩及目录
新鲜度语义](./product/2026-09-03-runtime-offer-catalog-retention-contract.zh-CN.md)；正式迁移、96.04%
磁盘回收、零 heartbeat child、Firefox/Chrome 与保留 RSS 风险见
[验证审计](./audits/2026-09-03-runtime-offer-catalog-retention-verification.zh-CN.md)。

安装、改名与用户数据的当前合同：[稳定 `~/.rah` 根、旧 Application Support 无覆盖迁移、LaunchAgent 卸载永不删除数据](./product/2026-09-02-install-data-lifecycle-contract.zh-CN.md)。`RAH_DATA_HOME` 是规范覆盖，`RAH_OS_HOME` 仅为兼容别名；共享根下禁止通过服务卸载 purge 整棵数据树。

InputRequest 当前收口边界：[Raft 只提供通知/弹层合同、Multica 无直接 typed 生命周期、schema 38 的 Task-cancel 原子终止设计](./product/2026-09-02-input-request-lifecycle-contract.zh-CN.md)。本批只修复 pending request 在 Task 取消后的幽灵动作；自动 TTL、dismiss 即取消和结构化表单没有成熟源码依据，明确延期。

P4.1 成员关系图当前施工合同：[冻结 Raft MemberGraphSection、共享 Channel 边语义、ACL-safe 本地 read model、pan/zoom/hover 与内部 deep link](./product/2026-09-02-member-relationship-graph-contract.zh-CN.md)。关系只来自 canonical Channel membership，不分析消息正文、不让模型推断，也不占 Agent 上下文。

P4.2 Agent 创建者、已创建 Agent 与 External Agent 的身份/权限边界：[Raft 冻结发布物、revision-1 creator、ACL-safe createdAgents 和 External Agent 设计闸](./product/2026-09-02-agent-creator-and-external-identity-contract.zh-CN.md)。

P4.3 Agent Apps：[Raft OAuth client grant 投影/撤销合同、Multica Composio 语义差异和施工解锁条件](./product/2026-09-02-agent-app-grant-contract.zh-CN.md)。

P4.4 Agent 自定义图片头像：[Raft picker/上传行为、既有 ProfileImageStore 复用、revision 竞态、安全 GC 边界与双浏览器正式验收](./product/2026-09-02-agent-custom-avatar-contract.zh-CN.md)。

Profile Image 上传后未保存、替换后孤儿文件与崩溃恢复的最终闭环：
[上传意图与引用安全 GC 合同](./product/2026-09-03-profile-image-intent-and-gc-contract.zh-CN.md)、
[Raft/Multica 来源、10 万行压力、Chrome/Firefox 与正式发布审计](./audits/2026-09-03-profile-image-intent-gc-verification.zh-CN.md)。

P4.5 Agent 问题报告：[Raft 中央 feedback bundle/attestation/upload 合同与 RAH 本地安全诊断导出裁决](./product/2026-09-02-agent-issue-report-contract.zh-CN.md)。

P4.6 Agent 完全重置：[Raft 三档 reset 合同、单 fence workspace/continuity saga 与破坏边界设计](./product/2026-09-02-agent-full-reset-contract.zh-CN.md)。当前仅 `R/design`，正式 full 仍禁用。

后续收口的当前执行真相：[Raft-first 剩余收口重构与补强计划](./product/2026-09-02-raft-first-remaining-closure-plan.zh-CN.md)。它固定了源码复用顺序、证据分层、P0–P6 施工顺序、单一 owner、迁移/回滚和浏览器验收。旧的完成列表是历史快照，不得用来覆盖该计划和当日审计。

Task 状态的长期边界：[Raft 五态工作流、RAH OS 执行阶段与人类注意事项的正交投影](./adr/0027-task-workflow-execution-and-attention-projection.md)。schema 44 通过 typed `task.workflow.update` 复刻 owner/admin 全五态与普通成员转移图；频道 Task Tab 和全局 Tasks 复用同一 Raft 看板。认领、运行、等待输入、阻塞原因和取消中的证据保留在独立维度，不得重新变成额外看板列、第二套卡片按钮或反向禁用 Raft 菜单。

Task 页面与业务流的当前交付证据：[Raft Task 工作流对齐与正式浏览器审计](./audits/2026-09-03-raft-task-workflow-parity-verification.zh-CN.md)。该报告冻结官方 bundle/DOM/computed-style、五态迁移图、Pencil/hover 尺寸、105.25px 单行盒模型、看板 12px/列表 10px 列头间距、`columns-3/layout-list` 最终14px 图标、28px 标题栏操作、Room 工具栏整件换行、Room/全局编号头 scope、左对齐空分组、列内 `overflow:visible`、共享 brutal 交互协议、Room/全局共用看板、typed 写入不唤醒 Agent、terminal 状态释放协作占用、真实指针 Chrome 桌面/390×844 与正式 4173 重启结果；强上浮族七处源码清单见 [Raft brutal lift 来源证据](./evidence/raft-brutal-lift-inventory-20260903.json)。不把内部执行证据重新包装成第二套公开流程。

本机 Computer 详情当前合同：[P6.6 Computer 侧栏、Runtime inspector、裁剪诊断与 Agent 跳转](./product/2026-09-02-computer-local-detail-contract.zh-CN.md)。当前证据为 `C/A/L/D`；Raft Computer 离线导致同前置非空数据 `R` 不可宣称。正式实例已从本轮验证过的不可变发布物恢复，但并发出现的非本批缺文件／缺导出仍阻塞当前源码整库重建，二者不得混为“全部通过”。

P2 Agent workspace / 本地项目文件当前 owner 合同：[Raft workspace 请求、root 区分、AgentHost 路径安全、前端状态机与双边证据限制](./product/2026-09-02-agent-workspace-and-project-files-contract.zh-CN.md)。Raft 的 workspace 是 Agent 持久目录；RAH 的 `runtime-project` 是 daemon 冻结 cwd 的只读本地扩展，绝不能把客户端路径、cwd 或 Memory owner 混成同一身份。

前端鼠标、键盘和触屏状态的当前统一基线：[Raft 前端操作状态合同](./product/2026-09-02-raft-interaction-state-contract.zh-CN.md)、[双边 computed-style 与真实浏览器审计](./audits/2026-09-02-raft-interaction-state-verification.zh-CN.md)。该批把 rail、导航行、平面按钮、brutal 按钮、segmented、消息工具条和输入 focus 收敛为共享协议；条件弹层、逐实例拖拽和缺失发布 chunk 仍须继续追踪，不能据此宣称全站交互 1:1。

核心调度当前最高优先级审计与同日修复复核：[Raft 业务合同、四条 P0 completion-proof 反例、typed obligation、双 Agent 浏览器报数、Thread subscription、Held Draft、Runtime error fingerprint fence、Reminder 与 restart/busy 组合证据](./audits/2026-09-02-core-scheduling-raft-parity-audit.zh-CN.md)。Room / Inbox / Activation 主骨架成立；schema 30–34 依次关闭 typed completion proof、Thread follow、Held Draft、poison retry 主合同和 Reminder authoritative schedule；真实 Worker gate又覆盖报数中途重启及单 Agent busy 跨 Room。schema 35/36 现补齐结构化 Runtime `actionRequired/sticky/recoverable`、正向 jitter、跨 Room Reminder target、Thread receipt 与 reload-safe typed permalink。它关闭本轮列出的精细缺口，但不等于所有 Provider 都能发出结构化错误，也不把本地内部链接、`#room` target 扩大为 Raft 中央公开 URL 或未验证的 DM target。

普通 Channel 永久删除的 Raft 可见合同、schema 40 显式引用图、文件 GC 回执和崩溃恢复边界：[产品合同](./product/2026-09-03-room-permanent-deletion-contract.zh-CN.md)；实现与 Chrome/Firefox 隔离真删除证据：[验证审计](./audits/2026-09-03-room-permanent-deletion-verification.zh-CN.md)。正式用户 Room 不用于破坏性验收。

Room 删除后文件回收的长期运行状态机、Multica 结构性移植、周期 worker、lease/backoff/tombstone 与 schema 42 验收范围：[Reconciler 合同](./product/2026-09-03-room-file-gc-reconciler-contract.zh-CN.md)；实现、迁移、失败注入和浏览器证据：[验证审计](./audits/2026-09-03-room-file-gc-reconciler-verification.zh-CN.md)；10 万回执 CPU/内存/磁盘压力与剩余缺口裁决：[性能审计](./audits/2026-09-03-room-file-gc-performance-and-remaining-gaps.zh-CN.md)。

Files 与 Artifact 预览的 Raft/Multica 分层合同、安全白名单和浏览器验收范围：[Files 与 Artifact 预览收口合同](./product/2026-09-03-file-preview-parity-contract.zh-CN.md)。

Files / Artifact 预览的来源、ACL、安全 renderer、真实 Chrome 与正式发布证据：[Files / Artifact 预览对齐审计](./audits/2026-09-03-file-preview-parity-verification.zh-CN.md)。

消息多选与转发的 Raft 选择状态机、逐目标幂等、快照/ACL 与 RAH 本地附件闸门：[消息多选与转发 Raft-first 合同](./product/2026-09-03-message-selection-forwarding-contract.zh-CN.md)。

转发附件的 Raft `projected` 行为、本地 hard-link 身份、Room ACL、GC 与崩溃孤儿恢复边界：[转发附件 projected identity 与本地 blob 合同](./product/2026-09-04-forwarded-attachment-projection-contract.zh-CN.md)。

本轮十二项 Chat / Settings / Presence 缺口的当前裁决：[逐项源码 owner、双边实页、Firefox 桌面/390、正式重启与保留边界](./audits/2026-09-02-chat-settings-presence-closure.zh-CN.md)。本报告关闭的只是用户列出的十二项合同，不扩大为全站或所有权限/异常态 100% 等同。

Settings 当前线上源码/真实 DOM 合同：[Raft Settings → RAH OS 行为合同审计](./audits/2026-09-01-raft-settings-behavior-contract.zh-CN.md)。统一 64/240/62 顶层骨架、粉色选中态、36/18px 页头图标和共享卡片；已移除套餐账单/中央应用商店，保留标明为本地扩展的 LAN 设备。按 Workspace 静音已有 daemon 持久化和 Web Push 投递边界过滤。

Search、Notifications 与 typed deep link：[Raft/Multica 来源、FTS/Push owner、URL/ACL/lifecycle 不变量](./product/2026-09-01-notifications-typed-navigation-contract.zh-CN.md)、[schema 27 正式重启、desktop/390×844、HTTPS LAN/PWA、Firefox transport 与重启消息错误验收](./audits/2026-09-01-notifications-typed-navigation-verification.zh-CN.md)。Search 的 Raft 前端合同及本机 FTS 已接通；Web Push 软件链和 Firefox 正式订阅/transport 已通过，macOS 横幅/点击、Chrome 受控 profile 订阅和 iOS 仍须设备级验收。账号、套餐和资源计费明确不属于 RAH OS。

安全强制改派：[Raft 产品行为、Multica 取舍与本机协议合同](./product/2026-09-01-safe-task-reassignment-contract.zh-CN.md)、[实现缺陷修复与真实 Chromium 验收](./audits/2026-09-01-safe-task-reassignment-verification.zh-CN.md)。运行中 Task 先 fence/终止旧 Runtime，取得 terminal proof 后才唤醒新负责人；浏览器门禁发现并修复跨负责人幂等键碰撞。跨 Computer、真实付费 Provider 服从性与未决 operation 独立恢复 UI 不在本批完成范围。

- [Agent Artifact 来源复用审计](./audits/2026-09-01-agent-artifact-source-reuse-audit.zh-CN.md)
- [Agent Artifact → TaskSubmission → Room Files 合同](./product/2026-09-01-agent-artifact-task-submission-contract.zh-CN.md)

Thread 附件与长历史：[产品合同](./product/2026-09-01-thread-files-contract.zh-CN.md)、[真实 Chromium 验收](./audits/2026-09-01-thread-files-and-long-history-verification.zh-CN.md)。附件-only Thread 回复、Room/Thread 草稿隔离、同事务 Files 投影已接入；10,050 条虚拟历史锚点复验通过。Worker/Agent Artifact 与 Task submission 仍不据此算完成。

Agent 稳定导航与 MCP 使用页：[源码/产品合同](./product/2026-09-01-agent-navigation-mcp-contract.zh-CN.md)、[真实 Chromium 验收与生命周期二审](./audits/2026-09-01-agent-navigation-mcp-verification.zh-CN.md)。AgentDefinitionId/tab 现在可刷新恢复，目录水合不再误改深链；MCP 复用既有 server/assignment/usage canonical 数据汇总服务器与工具。非空 MCP 双边同前置、提醒和应用仍未据此完成；restart/session已由后续专门合同关闭，full仍禁用。

当前 Agent execution restart / session reset 施工合同：[Raft 产品合同、Multica Provider 经验与 RAH OS 安全底座映射](./product/2026-09-01-agent-execution-reset-contract.zh-CN.md)。首批只开放 `restart` 与 `session`；`full` 在缺少准确 Workspace 所有权、备份和恢复合同前保持禁用。

Agent execution restart / session reset正式验收：[实现、门禁、持久4173重启与桌面/390×844浏览器证据](./audits/2026-09-01-agent-execution-reset-verification.zh-CN.md)。两种模式均走terminal proof、全局Agent fence、canonical disable/enable和不可变receipt；正式浏览器已执行两种模式，Memory逐文件保持。`full`、进程崩溃中点自动恢复和Raft官方服务端内部同构仍不是完成项。

聊天边栏与右侧 Agent 资料页宽度：[Raft 源码、官方实页、真实鼠标拖动、持久化与移动端验收](./audits/2026-09-01-panel-width-parity-verification.zh-CN.md)。聊天列表固定为默认240px、180–320px；资料侧栏为默认380px、300–600px并从左边缘拖动。Firefox已实际拖到两端、刷新验证持久化并在390×844确认满宽；该结论只关闭两个分栏合同，不扩大为Agent全页面一致。

当前最优先的全站裁决：[Raft ↔ RAH OS 全站行为合同与双边差异主审报告](./audits/2026-09-01-full-raft-behavior-parity-audit.zh-CN.md)。三路独立审计加主审复核曾确认正式 `4173` 不在线，因此当时不能宣称正式可用或全站收口；该运行时缺口已在后续首批修复中以持久状态备份、production bundle 启动、`/_rah/health=online` 和正式浏览器重验关闭。报告其余逐项 UI、hover、点击、键盘、状态点、功能语义和前后端缺口仍然有效，不因重新上线自动算完成。

行为登记同步更新：[74项旧意图与 C/A/L/R/D 证据层](./product/raft-behavior-inventory.zh-CN.md)。已纠正空间菜单实际为点击触发、四类状态点独立 owner、Notification 与 InputRequest 分离；消息回应/收藏三按钮、Room 静音和长消息折叠已补真实浏览器与正式部署证据。74项登记不是功能完成率，也不是全站源码覆盖率。

消息回应、收藏和侧栏偏好最新批次：[源码合同](./product/2026-09-01-message-social-sidebar-contract.zh-CN.md)、[浏览器与交付审查](./audits/2026-09-01-message-social-sidebar-verification.zh-CN.md)。回应是共享注解，收藏和排序是当前 Human 的私人数据；新增持久化接口与真实按钮，不触发 Agent 工作。头像改为官方固定预设，不再程序生成图案。下方旧报告的“未接入”及随机图案分配状态被本批对应项替代，其余缺口不自动算完成。

“已保存”聚合页的 Raft 源码映射、协议/Kernel 扩展、桌面与 390×844 浏览器复核及服务端来源边界：[Saved 聚合页对齐与双边证据报告](./audits/2026-09-02-saved-messages-parity-verification.zh-CN.md)。

聊天截图差异最新复审：[源码合同与方案](./product/2026-09-01-chat-surface-parity-contract.zh-CN.md)、[逐项修复与真实浏览器核验](./audits/2026-09-01-chat-surface-parity-verification.zh-CN.md)。修正列表文字层级、频道编辑入口、分栏宽度保存、私信状态、空态和头像预览；排序/置顶、回应、收藏及 Room 个人静音/长消息折叠已有持久 owner 和浏览器门禁。消息编辑/删除、高级回应者浮层等剩余项仍使 Chat 不能宣称全量一致。

Agent 字段、头像与模型配置：[设计与边界](./product/2026-09-01-agent-profile-edit-contract.zh-CN.md)、[真实浏览器/持久化/正式重启验收](./audits/2026-09-01-agent-profile-edit-verification.zh-CN.md)。名称/描述新增离线可写、revision 防覆盖的就地编辑；Chat 顶部/Message 头像共用右侧 inspector，资料头像可原子选择官方 preset；模型与 effort 复用已有运行时配置 owner。该旧报告中的“图片上传不可用”已由上方 P4.4 合同和正式验收替代；Agent 管理员权限仍受 ADR-0012 限制，不能据此宣称所有红框与 Raft 一致。

Agent 自定义图片头像当前施工合同：[Raft picker/上传行为、既有 ProfileImageStore 复用、revision 竞态与安全 GC 边界](./product/2026-09-02-agent-custom-avatar-contract.zh-CN.md)。本合同以既有认证、内容寻址图片 owner 扩展 Agent 消费方，不新建第二套文件服务；其完成状态以合同内最新 `C/A/L/D` 证据为准。

这里仅保存能约束代码和验收的长期文档。阶段性讨论、旧 RAH 的 Session/UI 细节和 provider transcript 适配经验不迁入本仓库。

核心调度最新审计与修复状态：[Raft 业务合同一致性审计](./audits/2026-09-02-core-scheduling-raft-parity-audit.zh-CN.md)。completion-proof P0、双 Agent 报数、Thread follow、Held Draft、poison retry、Reminder 主合同、restart/busy 跨 Room，以及本轮 structured Runtime 分支、跨 Room `#channel` target 和 Thread receipt/permalink 已进入工作树并有定向回归；正式全门禁、重启与浏览器结果以审计末尾最新复核为准。未声明 DM Reminder target、公开分享 URL 或所有 Provider 结构化错误覆盖。

Raft 产品行为的首要监督基线：[Raft 官方教程监督基线](./product/raft-official-tutorial-supervision.zh-CN.md)。

工程执行约束：[项目 AGENTS.md](../AGENTS.md)，以本仓库 Room-first、单机核心和用户自管 CLI 为准。2026-08-31 已将既有修复与该约束提交为 `f9b271c`；不是一次新的部署。

Agent 资料最新修复：[源合同与方案](./product/2026-09-01-agent-profile-layout-contract.zh-CN.md)、[颜色/密度/滚动、浏览器与正式重启验收](./audits/2026-09-01-agent-profile-layout-verification.zh-CN.md)。修正无效紫色变量、操作额外间距、图标和窄屏增高；官方按钮同样随资料滚动。安全 restart/session 与本地问题诊断导出已由上方 P4.5 验收关闭；full reset 仍保持禁用，不宣称 Agent 页全量一致。

Room成员界面最新修复：[设计合同](./product/2026-08-31-room-members-and-avatar-contract.zh-CN.md)与[浏览器、SQLite及正式重启验收](./audits/2026-08-31-room-members-avatar-verification.zh-CN.md)。统一头像尺寸、Raft随机头像持久分配、独立添加/成员页、来源感知返回及手机设置入口已部署4173；保留频道偏好/生命周期操作等缺口，不声明设置页全量一致。

行为指南最新登记：[74项旧意图迁移与当前前后端接线](./product/raft-behavior-inventory.zh-CN.md)、[Agent AG00–AG08 六列合同](./product/raft-agent-behavior-contract.zh-CN.md)、[源码位置关联](./evidence/raft-behavior-source-links-20260831.json)。本轮同尺寸1049×1172只读双边核对，发现Agent标签URL恢复、聊天tab语义、MCP分组与布局等差异，提醒/应用仍占位；官方非空树依旧缺证。74项登记、23个回调关联均不是功能完成率；不声称全站行为指南已齐。本批仅补文档，未修改生产行为或重启服务。

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

消息列的宽度、根消息/回复结构、Agent 与 Human 关注所有权和标题栏操作协议：[消息列（Thread）Raft 对齐合同](./product/2026-09-02-thread-column-parity-contract.zh-CN.md)。

消息右键选择、Room/Thread 多选工具栏、纯文本 canonical 多目标转发、部分失败重试、请求级快照冻结、
来源 typed deep link 与附件安全闸门：[设计合同](./product/2026-09-03-message-selection-forwarding-contract.zh-CN.md)、
[专项实现与浏览器审计](./audits/2026-09-04-message-selection-forwarding-verification.zh-CN.md)。

附件转发不复用源 Room Attachment ID，也不复制数据块；每个目标使用独立确定性 ID 与同 inode
hard link，并继续复用 Files ACL/预览/下载及 Room 删除 GC：[附件 projected 合同](./product/2026-09-04-forwarded-attachment-projection-contract.zh-CN.md)。
目标身份/ACL、回滚与孤儿恢复、Chrome/Firefox 门禁和移动空间入口回归的最终记录：
[附件投影与移动回归审计](./audits/2026-09-04-forwarded-attachment-projection-verification.zh-CN.md)。

Task 紧凑标识与消息列回复头像的精确来源、computed-style、共享头像身份及正式浏览器验收：
[Task 标识与 Thread 回复头像对齐审计](./audits/2026-09-03-task-marker-and-thread-avatar-verification.zh-CN.md)。

聊天正文中的 Agent/Human/Room/DM/Task/Thread/Computer/App/Message typed 引用、共享 mention delivery
语法、canonical read receipt、Thread 搜索片段、公式/代码/Mermaid 单一渲染 owner 与
Raft/Multica 来源边界：[消息富文本引用、公式与图表合同](./product/2026-09-02-message-rich-reference-contract.zh-CN.md)。

上述合同的 Raft bundle/正式页证据、Multica 交叉依据、RAH OS 实施映射、正式 4173 Chrome 实测与
独立审计、computed-style/浏览器证据与剩余非阻断边界：[消息富文本引用与消息列搜索验证报告](./audits/2026-09-02-message-rich-reference-verification.zh-CN.md)。

频道黄色 `@`、普通/静音频道未读、私信粉色未读与 Workspace 全局 90 秒 Agent 工作条的来源裁决、
单一 owner、桌面/390px Chrome computed-style 及正式 4173 重启验收：
[频道提及、私信未读与 Agent 工作条验证](./audits/2026-09-03-sidebar-attention-and-direct-activity-verification.zh-CN.md)。

Raft 767px 移动断点、短窗口 50px/36px rail、四项移动根导航、Room/Agent
详情显隐，以及 800/768/767/760/701/700px 指针命中扫描：
[响应式 Shell 对齐审计](./audits/2026-09-04-raft-responsive-shell-verification.zh-CN.md)。

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
