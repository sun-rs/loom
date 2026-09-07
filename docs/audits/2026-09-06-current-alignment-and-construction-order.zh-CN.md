# 当前前后端对齐缺口与施工顺序

日期：2026-09-06。范围：独立 `rah_os` 仓库；单 Mac、单 Human 优先的 Room-first 产品。

本次是当前工作区的源码、登记和证据交叉审查，没有重新运行产品测试、真实 CLI 或官方浏览器对照。
最近的执行证据来自[接手批次](./2026-09-06-notification-popover-takeover.zh-CN.md)。
源码存在、局部回归通过、官方双边一致和正式部署分别陈述。下述顺序是当前施工基线，旧计划中的
“约 11 turn”不再作为承诺；也不从当前登记推算产品完成率。

## 结论

后端已经具有 Room → Inbox → Activation → AgentHost → RunAttempt → 显式行动的主链，
并有 Agent 私有文件记忆、Task/Review、冻结交付、Search、消息社交动作、附件和权限 owner。
当前主要工作是剩余用户操作的接线、已有能力的完整页面验收和运行/设备证据。
不重建 AgentHost、Task 状态机、搜索引擎或记忆体系。

不能证明“内部逻辑完美复制 Raft 未公开的 Server”。验收目标是固定官方版本下可观察的
对象语义、UI、交互和结果一致；本地事务、执行围栏和权限由 RAH OS 自己负责。

## 先修正会误导施工的登记

当前机器登记有 84 项：29 verified、30 needs-verification、12 needs-feature、7 needs-decision、
6 not-applicable。这些是登记标签的计数，不是本次确认的缺口数量。旧 B 项往往只有粗粒度 intent，
缺少当前 owner 和分状态证据；例如 B056 同时囊括多个 Agent tab，不能代表它们的完整合同。

| 旧说法                                       | 当前源码证据                                                                                                                                      | 本次裁决                                                                 |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| B014 频道停止所有 Agent 尚缺                 | `apps/web/src/App.tsx::stopCurrentRoomAgents` → `room.sos.stop`；`packages/kernel/src/room-agent-sos-service.ts`；HTTP 会等待 Host terminal proof | 已有生产接线，改查停止范围、busy/重启/响应丢失和恢复结果，不重写停止服务 |
| B042 Computer Agent 行不能打开资料           | `components/workspace-catalog-panes.tsx` 将 `onOpenAgent` 传给 `AgentEntityCard`，App 已接路由                                                    | 已有入口，剩余是页面族与官方同条件验证                                   |
| B047 Runtime chip 没有详情                   | 同一页面已使用 `ComputerRuntimeInspector`，具有可用性判断和详情交互                                                                               | 已有入口，不能列为从零开发                                               |
| B043 没有命令复制                            | 同一页面已有 `doctor:local-core` 诊断命令和剪贴板失败反馈                                                                                         | 诊断复制已实现；完整恢复指引/执行管理仍是另一项未闭环能力                |
| B054 关系图仍等架构裁决                      | `packages/kernel/src/workspace-member-graph.ts` 与 Web graph 已按可读 Channel membership 建图                                                     | 现有语义已裁决；Human 拥有 Computer、外部身份等未知关系不能擅自补边      |
| docs/README 仍说 full reset 仅设计、正式禁用 | full-reset 合同后半部已有实现/部署证据；daemon 发布 `agentExecutionFullReset`，App 按 capability 解锁                                             | 实现存在；只补适用回归，不对用户 Agent 做破坏性验收                      |
| Human 目录尚未建立                           | `HumanProfiles.list` → Human port → discovery route → SDK/App；control Room ACL、501 条读取/500 条输出与 truncated                                | 目录和固定角色基础已接；完整多角色/拒绝/刷新页面矩阵仍需收口             |

以上只纠正“没有实现”的判断，不自动把相应项升级为 verified。第一施工段必须在原登记中
补当前 owner、真实缺口和证据范围，并整理 docs/README 互相冲突的“当前”语句；不新建另一份状态库。

## 已有主干及其验收边界

- Task 单 owner、协作者/审阅者、依赖、返工和 Human 完成已有实现与组合用例。
  [团队闭环](./2026-09-05-canonical-team-workflow-verification.zh-CN.md)证明代表性路径，
  不是全部 Provider 和团队组合。下一批保留它为回归基线，不重新制造一套团队编排平台。
- Submission 固定 RunAttempt、workspace、Git base/head/patch 和 Artifact，Review 绑定明确 revision/digest。
  [冻结证据](./2026-09-05-frozen-task-delivery-evidence-verification.zh-CN.md)区分 Host 观测与
  producer 声明；“Agent 说测试通过”仍不是系统执行证明。自动测试执行器是可选增强。
- Search、Tasks、消息菜单、转发、关系图、Agent/Computer 绑定都已有真实 owner。
  同尺寸截图和交互状态的官方对照尚未全产品覆盖，不能仅依据内部截图矩阵宣布一致。
- Agent `MEMORY.md + notes/`、index-only 注入和跨 Provider 记忆已有实现与历史真实实验。
  不恢复默认切分、额外记忆策略或自定义空闲维护；当前版本的真实模型组合验收另列发布门禁。

## 当前缺口：分开功能、接线和证据

| 页面/流程                    | 前端剩余                                                                                          | 后端或接线剩余                                                                                                               | 不能误算成缺功能的证据项                                                                     |
| ---------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Human / 成员 / 权限          | 完整目录、本人/他人、角色编辑、DM、长名称和跨入口状态组合                                         | 现有固定角色复用 control Room；本地邀请、跨 Room 移除和凭据撤销尚无完整 Human 生命周期                                       | owner/admin/member、最后 owner 保护、失权后旧页面/迟到请求；不能把 LAN 设备配对当 Human 邀请 |
| Room / 日常导航              | 公开频道发现/重新加入与离开后的关注行为；其余归档、收藏、排序、草稿、移动返回集中验收             | 尚未找到公开频道自助重新加入的 typed 命令；应在现有 membership/ACL owner 补最小合同                                          | SOS 已存在；Search/Activity/Saved 的精确跳转与新到达竞态需要逐入口证明                       |
| Files / Workspace / Artifact | composer 拖放未接；文件菜单适用动作全集、特殊类型/大文件预览仍未完整                              | 复用 FileUploadStore、RoomFiles、AgentHost root scope；需要媒体能力时先设计授权读取，不能暴露任意路径                        | 已有文件选择、上传、附件转发、文本/图片等预览与 Range 协议；官网离线非空文件树属于双边阻塞   |
| Agent Activity / Reminder    | Activity 筛选与持续打开预览的更新覆盖；Reminder/Workspace 完整非空/错误/权限页面族                | presence 的 activityAt 不是每条 diagnostic 记录的新鲜度；仅在重现漏更新后补现有观测 owner                                    | Reminder 调度及列表已有；是否还需编辑/取消入口以官方合同决定，不能因“还能加按钮”扩建         |
| Computer                     | 本机恢复指引、操作进度/失败/恢复结果；统一剩余 splitter 和详情交互                                | 居民服务/重启升级基础设施已有，但正式本机 Human 管理入口未形成完整闭环；先确认当前 local Core 实例对应的管理 owner           | Agent 跳转、Runtime inspector、诊断复制均已接；不引入远程 Computer 注册/调度工程             |
| Settings / MCP / 资源        | Administration 仍主要是本人权限摘要；Docs/Feedback/Release Notes 需有效入口；语言时区仅部分可编辑 | MCP 可管理已配置 executor、工具与 Agent allowlist，但首次 executor/secret 配置仍需 daemon 侧人工准备；完整产品配置入口未闭环 | 12 个区可导航不是 12 个完整产品模块；自动翻译、onboarding 等需明确适用范围                   |
| Notifications / PWA          | 页内 hover/focus 已修；非空消息、InputRequest、dismiss、新版本再现和点击回跳需完整对照            | 现有持久通知、订阅、typed target 复用；只有真机验收失败证明新问题时再改投递链                                                | 当前证据不覆盖 macOS/iOS 全部系统横幅与点击；HTTP delivered 不证明设备显示                   |
| 长期运行 / 发布              | 长历史、切页、断线、跨版本恢复时不丢草稿/锚点                                                     | 已有分页/GC/lease；仍缺当前候选 1h/24h soak、真实重登录/开机恢复等发布证据                                                   | 本次没有建立新的性能缺陷结论；按内存/磁盘增长、子进程和队列结果触发修复                      |

前端不是全面推倒重做：保持内部 tokens/primitives，迁移到哪一个页面族，就删除该处已替代的
重复规则。`workspace-catalog-panes.tsx` 仍有页内 pointer/keyboard splitter 处理，是可明确定位的
共享层收口项；它不应阻塞 Room 功能，也不应借此做全仓拆文件工程。

## 施工顺序与每段出口

每次只保持一个产品批次在施工。以下是依赖顺序，不是机械 turn 数；发现真实阻断再调整并记录原因。

| 顺序 | 批次                               | 具体产出与出口                                                                                                                                                                                                |
| ---- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | 纠正当前队列，短批次               | 修正上述矛盾；粗项拆为可验收子行为并保留原 ID；分别关联代码、自动化、本地浏览器、官方对照、部署证据。固定官方版本，避免追着多个版本的截图改来改去。整理后立即进入产品施工                                     |
| 1    | Human / Agent 成员与权限完整页面族 | 延续已接 Human 目录和角色编辑，补缺失状态/入口；证明同一身份从成员、头像、Task、关系图打开一致；拒绝权限的 API 和按钮一致，跨 Workspace 迟到响应不串页。Task 团队闭环只作回归，不从零重做                     |
| 2    | Room 生命周期与工作流导航          | 补公开频道重新加入的 membership 合同及 UI；集中验收 leave/archive/restore、SOS stop/resume、Search/Activity/Saved、Task/Thread 返回、草稿/未读/排序。新消息和旧请求交错后仍落在正确实体；停止不伪造 Task 完成 |
| 3    | 文件交付完整页面族                 | 先补拖放共享上传入口，再核清文件菜单和必要预览类型；Room/DM/Thread/Workspace/Submission 中相同文件行为一致。上传失败可重试、刷新可恢复、失权拒绝、冻结 Artifact 与用户看到的交付一致                          |
| 4    | Agent 详情 + 本机 Computer 管理    | 先验现有 Activity/Reminder/Memory/Runtime/reset，再补实证缺口与安全管理入口。停止/重启有精确对象、进度与最终回执；CLI 切换保留 Agent 身份/角色/记忆。Computer UI 不直接拥有进程、不创建第二个 daemon          |
| 5    | Settings / MCP / 帮助资源          | 补本地适用设置正文和真实资源入口；MCP 以“配置 → 发现 → 授权 → 调用记录 → 撤销”验收，秘密留在服务端。邀请/翻译/外部 Apps 等未决定功能明确列出，不伪造开关成功                                                  |
| 6    | 通知与发布验收                     | 完成页内非空双边、真实设备通知点击/关闭、LAN/PWA、长期运行和恢复。设备可用时提前做；1h/24h 采样应在稳定候选上尽早启动，跨构建记录边界，不能把末尾变成漫长等待                                                 |

每批均按“官方合同/本地差异 → 失败测试 → 最小实现 → 双浏览器真实指针和业务事实 →
必要正式安全重启”交付。官方同条件比较贯穿各批；不是最后另做一次像素修补。
本计划文档自身不改变 runtime，不需要重启正式实例。

## 明确后置与完成口径

当前后置：中央账号/账单/市场、互联网 relay、多 Computer 执行和文件迁移、外部 Agent OAuth
grant、新记忆算法、默认自治维护、自动验证签名系统。Human 本地邀请、翻译与 Finder reveal
属于待裁决能力；不能以“单机”自动宣称永不需要，也不能为复刻标签立即扩建。

第一阶段完成须同时满足：单机适用行为没有未解释的缺口；普通任务、团队协作、审阅返工、
附件交付及恢复在同一 canonical 链中成立；官方可比较页面具有同条件结果；真实设备/运行
证据如实列出阻塞。任何明确排除或有意差异应在适用清单可见。

当前单一工作 agent 的自测不称为独立审计。真实付费 Provider 门禁仍需单独授权，未运行时
只报告自动化/fake-provider 与历史真实实验的各自范围。没有全部适用条件的证据，不承诺
“完美复刻”“100%”或精确剩余轮次。
