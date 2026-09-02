# Raft Agent 页面：源码合同与本地映射

日期：2026-08-31。本地源码基线：`f9b271c`。这是主审的首批语义追踪和只读双边核对，不是第三方审计、全分支验收或新的产品发布。

## 1. 范围与证据口径

沿用 [前端行为合同](./raft-frontend-local-contract.zh-CN.md)，细化 [74项意图登记](./raft-behavior-inventory.zh-CN.md)里的 Agent 行为。**七个标签可点击，不等于七个模块已实现。** AG00–AG08 是9组合同，包含标签容器及生命周期，不与既有 C01–C11 简单相加计算覆盖率。

来源均为 [当前冻结官方发布包](../evidence/raft-web-20260831-current/README.md)，不是旧版母版或根据截图猜测：

| 简称        | 文件                           | SHA-256                                                            |
| ----------- | ------------------------------ | ------------------------------------------------------------------ |
| AgentDetail | `AgentDetailPanel-DKwoNvgK.js` | `b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845` |
| index       | `index-BoAC7nSE.js`            | `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a` |
| McpPanel    | `webAppVersion-CfNNzAIv.js`    | `8f5154529799b7b1ca3d755deb4e71541ed84b30dd1011339620cba9f8ad9b19` |

下文位置是 **UTF-16 偏移**，不是字节或源码行号。短函数名只在上述哈希版本有效。[机器可读来源关联](../evidence/raft-behavior-source-links-20260831.json)将所列23个事件候选与合同关联；它不表示整个函数、依赖组件、权限分支或后台语义都已审完。原1,836候选索引保持冻结 `untraced`，关联表是增量说明层。

本轮浏览器前置：官方登录后的 hakasemac / Alice，本地正式4173 / Codex。新建双边页面实际均为 **1049×1172 CSS px，DPR 2**；尝试1440×900设置失败，因此不报告1440验收。两边角色、历史、运行时与数据不同，仅比较本次可达的结构和操作，不声称像素差分通过。官方 Computer 离线，本地显示等待唤醒。

## 2. 六列行为合同

2026-09-01 AG00/AG01/AG07 更新：Agent 身份与 tab 已进入稳定 URL，目录水合期间不会误改深链；名称/描述已改为 `AgentProfileFieldEditor` 就地编辑，
`agent.manage/update_profile` 仅更新资料 revision；字段现包含名称、描述与 allowlisted 官方头像 key。模型/effort 的现有配置 owner 保留并增加芯片入口。MCP 已从既有 managed server/assignment/usage read model 汇总为 server→tool 使用页，不另建调用真相。
隔离真实目录已完成 GPT-5.6-Sol + Low 保存、刷新和服务重启后回显，未发起付费执行。
详情见 [资料编辑合同](./2026-09-01-agent-profile-edit-contract.zh-CN.md)。
下表是 08-31 基线；AG01 的“未保存”状态由此更新替代，其他缺口并未自动完成。

| 官方触发位置                                      | 源码组件及参数                                                                                                                            | 显示内容／数据来源                                                                                                    | 关闭和键盘行为                                                                                                     | 本地对应实现                                                                                                                                                    | 双边实测结果                                                                                                                 |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **AG00** Agent 主页面／侧栏的七个标签             | AgentDetail `qc` 128483–144890；tab描述62650–63558；`onValueChange:Ve` 136664；URL `agentTab`，兼容旧`tab`，默认profile                   | 权限与创建者决定可见标签；顺序来自sidebarOrder.agentPanelTabOrder；选择写URL并滚动选中项                              | 共享tabs组件；完整焦点/方向键/拖序行为尚需沿依赖追踪，不能由onValueChange推断全键盘合同                            | `AgentDirectoryPane`：主页面默认profile，头像侧栏默认activity；固定七tab、内部state；`AgentTabList`已有方向键/Home/End                                          | 双边七tab均实际点击。官方MCP刷新仍为MCP；本地Agent主页面MCP刷新回此前Codex DM聊天。URL恢复不一致                             |
| **AG01** 资料字段、头像、运行时、Computer和创建者 | AgentDetail `hc` 73882–105139；头像切换137580、选择138961、保存134119；字段/runtime修改经index store的PATCH `/agents/:id`                 | 名称、描述、头像、角色权限、Computer、创建者、runtime/model/config/effort是不同字段；不可合成人设文本                 | 名称Enter保存/Escape取消；描述Escape取消、Enter保留编辑；头像preset即时保存；runtime弹层有取消/保存/错误；详见下节 | `AgentProfilePane`就地字段/头像编辑，`AgentRuntimeDialog`编辑模型；均复用`agent.manage`。头像上传因缺 canonical 存储 owner 明确禁用                             | 名称/描述/model/effort 已有隔离保存与重启证据；头像 preset 的新增自动化、真实浏览器与正式重启证据见资料编辑验收补充          |
| **AG02** 动态tab、活动诊断复制                    | AgentDetail `Do` 37858、`Oo` 38731、`ko` 30728；index `loadTrajectoryLog` 1807328，GET `/agents/:id/activity-log` 默认limit50；复制143297 | Agent跨对话的trajectory，不是Room消息正文。thinking/tool/text/action/system/compaction/status分型；历史读取加实时通知 | 复制使用共享反馈；官方新记录滚到底部；完整复制格式/失败焦点本轮未复验                                              | `AgentActivityPane` → `agent.trajectory.list`；有界窗口/分页；仅用户在底部时跟随；诊断导出为受限元数据                                                          | 双边均可读已有历史；命令/状态同列排版存在。未新跑真实CLI，不证明新事件连续到达、全部类型或Host恢复                           |
| **AG03** 聊天tab的频道与Agent私信                 | AgentDetail `xc` 64062–68520、`ec` 61377–62145；GET `/agents/:id/channels` 和 `/agents/:id/agent-dms`                                     | 非归档频道，初始最多5项；Agent私信是peer、最近时间、预览和activityOnly摘要，不是Human DM入口                          | 频道按钮导航；查看更多切换；Agent私信摘要调用的卡片没有绑定频道式onClick；无弹层可关闭                             | `AgentChatPane` / `AgentChatRoomGroup` → `agent.room.list`：Human可见且该Agent参与的Room/DM；含发私信入口                                                       | 官方实际显示频道和空的“Agent间私信”活动说明；本地显示Human共同Room及可点击DM。语义不同，不能以两个空态或“都能私聊”判等       |
| **AG04** 提醒tab、失败重试、提醒原文链接          | AgentDetail `qc`请求 `/reminders?ownerAgentId=:id&status=scheduled`；`Vo` 43254–44875、`Go` 44875–46263                                   | 标题、fireAt、重复说明、消息引用；socket scheduled/fired/cancelled与重连读取共同维护列表                              | 普通左键交给内部导航；修饰键保留链接行为；请求代次及Agent切换防旧结果；本轮未创建提醒                              | schema 36 `ReminderService` + daemon reconciler + Worker HTTP/CLI + Human scheduled read model；源锚点、`targetRoomId`、Thread/root 身份与 typed permalink 分离 | Kernel/HTTP/CLI/迁移、跨 Room owner-only 投递、Thread receipt 与修饰键单测已覆盖；非空官方双边与正式浏览器结果以最新审计为准 |
| **AG05** 工作区tab、树、预览及工具栏              | AgentDetail `No` 20829–30728；list/read参数及树256/160–600规格沿用C06–C10                                                                 | 官方运行目录引用/回退Agent目录；本地仅授权Agent私有home，不能伪称任意项目cwd                                          | 刷新、隐藏、分割线、复制及异步竞态沿用既有逐项裁决；不复制已知晚返回缺陷                                           | `AgentWorkspaceBrowser` → `agent.workspace.list/read` → AgentHost受限文件owner                                                                                  | 本地再次看到MEMORY.md/notes；官方读取失败。**非空树双边仍阻塞**；不据本地成功扩大为官方成功态通过                            |
| **AG06** 应用tab、授权卡片撤销                    | AgentDetail `fc` 68520–71192；GET `/integrations/agents/:id`，POST `/integrations/grants/:grantId/revoke`                                 | 只显示active grant：应用名、时间、描述、manifest、scopes/homepage；manageServer控制撤销                               | 请求loading/error，撤销后重新加载；完整确认/焦点和切Agent竞态未闭合                                                | 本地apps静态占位；不是Agent CLI安装页；没有对应grant产品API                                                                                                     | 官方返回暂无应用，本地明确尚无canonical API；非空、撤销和授权失败均未测                                                      |
| **AG07** MCPtab、服务器工具展开                   | McpPanel `Ye` 2735–19044；Agent scope GET `/mcp/agents/:id`；focus/BroadcastChannel更新后重读                                             | 仅显示usage非null的服务器：使用计数/最后调用、连接诊断、工具目录。Server scope才提供管理动作                          | 工具折叠集合、description tooltip；focus/listener需卸载；完整tooltip/错误关闭未实测                                | `AgentMcpUsagePane`为逐条调用元数据列表，Room/Run/终态；已有managed MCP owner，但缺服务器分组/工具目录的视图映射                                                | 双边空态已看，布局/图标位置明显不同；非空数据结构从源码确认不同。不能声称本地MCP完全没做，也不能说已对齐                     |
| **AG08** 更多／资料操作里的重启、重置、删除       | AgentDetail `qc` 141641、142480打开dialog；index `wJe` 2671193–2672787；POST `/agents/:id/reset` `{mode}`                                 | restart/session/full是三种不同破坏范围；delete是另一动作。UI文案和客户端log清理不证明服务端文件操作                   | restart默认；取消/关闭不执行；full需明显破坏提示；本地失败保留弹窗、成功返回触发按钮                               | `restart/session` 已接 `AgentHost` terminal proof、全局 `execution_restart` fence、Provider continuity store 与 canonical `agent.manage`；`full` 明确禁用       | 官方三档弹窗只读验证；本地正式4173已实际执行restart/session并留下receipt。full未开放，不能宣称三档执行完全一致               |

### 2026-09-01 AG00／AG07 补充裁决

- AG00 本地映射现为 `agent-route.ts` + `AgentDirectoryPane`：使用稳定 AgentDefinitionId/tab URL，目录水合期间保留目标；本地真实 Chromium 已验证 MCP 刷新保留 Agent 与 tab。上表旧“URL恢复不一致”由此关闭；tab 拖序和所有权限可见性分支仍未完成同前置双边验证。
- AG07 本地映射现为 `agent-mcp-projection.ts`：从 managed server/assignment/usage 汇总已使用服务器与允许工具，使用 `details` 展开且不暴露参数、凭据或结果正文。纯投影与本地空态/刷新浏览器通过；没有双方同前置非空 usage，不能扩大为完整非空 `R-pass`。

实现和验收见[Agent 导航与 MCP 使用页合同](./2026-09-01-agent-navigation-mcp-contract.zh-CN.md)与[验收报告](../audits/2026-09-01-agent-navigation-mcp-verification.zh-CN.md)。

## 3. 需要精确保留的子合同

### AG00：标签可见性与URL

官方 `fs` 合法值为profile/activity/chat/reminders/workspace/integrations/mcp。旧channels/dms顺序项归一为chat。`qc`中非跨服务器且拥有manageAgents时可管理；index的`Ctt`（2864746–2864825，导入别名gr）还允许当前Human为Agent创建者。profile始终显示，MCP依manageAgents，其余标签依上述访问资格。不能误读为“所有人总能看全部七页”。

本地应复用现有导航owner表达Agent身份、主页面/侧栏、tab和返回位置，使用稳定ID。恢复时重新授权；不靠localStorage恢复未经授权的Agent资料。标签拖序属于展示偏好，不新建业务事件。是否复用官方整套排序暂不作为首个修复条件，先完成刷新/后退/侧栏共存。

### AG01：字段与模型修改不是同一动作

- 名称：87761打开，88288键盘，88460保存，88655取消。`Mn`约79634将trim结果写displayName，空值为null；输入去除换行，失败保留错误。
- 描述：89548打开，90133键盘，90262保存，90457取消。`ci`约79828 trim、最多3000字符，空值为null；不是提交Room消息。
- Computer：97150关闭profile/thread后`toMachine(id)`；创建者98123按human/agent类型打开对应资料。
- 头像：137580仅在可管理时把资料头像变为按钮；138961展开官方 preset；134119选择后立即 PATCH 并关闭。Chat 私信顶部头像在 index 3191440，Message 头像在2935728的`Xrt`；本地两入口必须共用同一个 Activity inspector。图片上传需要独立存储与授权合同，不能降格成浏览器临时 URL。
- 运行时：99106调用`Si`，从当前runtime/model/runtimeConfig/reasoningEffort创建编辑草稿；`da`约84511保存这些配置，必要时带restartMode。index `updateAgent`约1804357发PATCH。不得将模型切换变成更换Agent身份、清空memory或无条件重启。

本地已有模型/effort发现与真实调用历史证据，本轮没有发现必须另换发现库的依据。缺口在配置的展示、入口语义、导航及保存/运行生效验收，不在CLI安装。按不可变Run配置规则，当前Run与next-run配置应明确分开；若要立即重启须走独立安全操作合同。

角色权限和人设仍分开。官方管理员角色编辑不直接映射为任意Human提升权限；本地固定角色策略的有意差异见既有C05。不为视觉复制开放新的权限提升路径。

### AG02：动态采集与显示

官方初始历史默认50条，`loadTrajectoryLog`有hydrateGeneration校验，错误保留既有日志，socket重连再读取。`Oo`在记录长度变化时滚到底部。本地采用有界记录窗口与“用户在底部才跟随”，是为避免抢走正在查看的历史位置而保留的明确差异，不是对Raft后台实现的断言。

动态中状态点、动作点、文本输出分型继续使用[颜色审查](../audits/2026-08-31-status-dot-audit.zh-CN.md)与[presence设计](./2026-08-31-agent-presence-closure.zh-CN.md)。导航粉点、Computer灰点、头像状态、诊断事件不是同一枚举。Provider事件在Host归一化，Web不解析CLI日志，也不把诊断文本写成Room业务回复。

### AG03：不能用Agent私信摘要绕过Human权限

两个官方请求各自维护loading/error，卸载后不采用旧响应；频道过滤archivedAt，5项以上才显示查看更多。`ec`在Agent私信摘要卡片上没有接`xc`频道行的导航回调，这比“它也是一个可点击聊天室列表”的推断更窄。

本地现有`agent.room.list`故意限制为Human可见的共同Room。下一步需裁决是否增加**授权范围内的Agent间最近活动摘要**，并定义不暴露私密正文的read model；不能为了与官方卡片外观相同就去掉Room ACL。源合同不证明官方服务端允许任意Human看所有Agent间消息。

### AG04／AG06：空态必须来自能力，而非掩盖缺失

提醒使用scheduled筛选，事件fired会更新下一次触发时间或移除条目，scheduled去重插入并排序，cancelled移除，重连重读；应用列表只展示active grants并在撤销后重载。已有InputRequest、Agent Inbox、MCP grant不能在没有语义裁决时随意充当这些对象。

2026-09-02 更新：提醒主合同由 schema 34 接入；schema 36 进一步把来源 `roomId/messageId`、目标 `targetRoomId` 与 `threadId/rootMessageId` 分开。`rah reminder schedule --channel #room` 只解析当前 active Workspace 内且 owner 有 membership 的目标；触发事实写入目标 Room 并只唤醒 owner。Agent 卡片、目标 Room receipt 和同 Room Thread receipt 都使用 reload-safe typed permalink；普通左键走内部导航，Cmd/Ctrl/Shift/Alt/中键保留浏览器原生链接行为。schedule/cancel/snooze/update 仍只写独立 Reminder 审计，只有 fire 推进目标 Room ledger。本地 permalink 是受 ACL 解析的内部导航，不是 Raft 中央服务的公开分享 URL；DM target 语法与非空官方双边仍不据此宣称完成。

应用仍是占位，验收必须标“未接入”，不能将其统计为官方相同的“当前无数据”。应用 grant 需要授权范围、撤销时效与审计，应单独设计，而不是只加一张卡片。

### AG07：Agent MCP使用页不等于服务器管理页

同一上游`Ye`支持Agent与Server两种scope。Agent scope过滤usage非null；Server scope读取`/mcp/servers`，且只有Server scope加manageServer才开放增删改、OAuth和连接测试等管理动作。**不把Server管理按钮误列为Agent tab必备。** 本地下一步优先从现有managed MCP数据汇总服务器/工具视图，不另建调用真相，不将参数、凭据和结果正文暴露到浏览器。

### AG08：重启／重置的三档边界

官方实际弹窗说明与源码mode对应：

| mode    | 官方可见合同                               | 本地实施约束                                                           |
| ------- | ------------------------------------------ | ---------------------------------------------------------------------- |
| restart | 停止再启动进程，保留运行时会话和工作区文件 | 保留Agent身份/记忆；先cancel/reap旧Run并确保lease失效                  |
| session | 清除运行时会话后重启，保留MEMORY.md和notes | 仅重置Provider会话；不能清Room ledger或伪造Task完成                    |
| full    | 清会话、删除工作区文件，从零重启           | 必须确认准确目录与损失范围，备份/恢复策略先审计；不允许波及用户项目cwd |

客户端`resetAgent`约1805999会按mode处理本地trajectory/session引用并标starting；这是前端事实，不是官方daemon实现证明。本地复用[全局Agent独占操作fence](../adr/0024-global-agent-exclusive-operation-fence.md)，与memory reset和改派协调，没有新增页面shell命令绕开owner。2026-09-01 首批实现严格按 [Raft产品合同→Multica Provider经验→RAH OS最小映射](./2026-09-01-agent-execution-reset-contract.zh-CN.md)施工：`restart` 保留Provider continuity，`session`以可回滚隔离清除continuity，两者都先通过AgentHost取得旧Run终态证明，再在同一fence内恢复canonical调度并持久化不可变receipt。`full`仍因缺准确Workspace所有权、备份和恢复合同禁用。

## 4. 本轮真实浏览器记录与限制

| 操作                                                  | 观察                                                           | 证据等级                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------- |
| 双边逐个选择动态、资料、聊天、提醒、工作区、应用、MCP | 均能进入；当前内容分别与第2节所列一致                          | 当前只读DOM与截图观察，不是所有数据分支通过                          |
| 官方MCP当前URL刷新；本地Agent MCP当前URL刷新          | 官方恢复MCP；本地回原有Codex DM聊天                            | 可复现导航缺口，无业务写入                                           |
| 双边资料→编辑运行时→Escape                            | 均关闭；本地焦点回编辑运行时配置；官方关闭后未确认相同焦点目标 | 只通过取消，不通过保存/切换/恢复                                     |
| 官方资料→重启/重置→取消                               | 显示三档；取消后dialog消失                                     | 08-31基线无重启、无文件删除；当时本地disabled，已由下方09-01证据替代 |
| 官方工作区与本地工作区                                | 官方Computer离线读取失败；本地根树非空                         | 官方成功态无证据；本地本次没有逐文件打开                             |

### 2026-09-01 AG08 正式补充证据

| 操作                   | 观察                                                                                                    | 证据等级                                                                    |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 正式4173资料→重启/重置 | 三档文案与Raft发布包一致；restart默认，session可选，full可见但disabled                                  | 真实生产构建DOM与桌面截图                                                   |
| Escape关闭             | 弹窗消失，焦点返回“重启 / 重置”触发按钮                                                                 | 真实浏览器焦点检查                                                          |
| restart确认            | receipt持久化；control Room产生`agent.disabled`→`agent.enabled`；Agent最终enabled                       | 浏览器写入 + SQLite/文件系统复核                                            |
| session确认            | 第二张session receipt持久化；同样以canonical disable/enable完成；该Agent当时没有Provider continuity记录 | 浏览器写入 + SQLite/文件系统复核；非空continuity隔离由AgentHost隔离测试覆盖 |
| 390×844                | 弹窗宽390、高784，body scrollWidth 390；full仍disabled，无横向溢出                                      | 真实浏览器尺寸与截图                                                        |
| 数据保持               | Agent Memory与重启前备份逐文件一致；现有Provider session文件数不变                                      | 文件系统差异检查                                                            |

完整证据和限制见[Agent execution restart / session reset验收](../audits/2026-09-01-agent-execution-reset-verification.zh-CN.md)。上表关闭的是本地`restart/session`的“按钮占位”缺口，不把官方服务端内部实现、`full`删除语义或全Agent页其余模块推定为完成。

上述08-31基线未发送消息、创建Task、修改Agent或MCP配置、撤销授权、安装CLI、调用付费模型、重启服务或删除数据。09-01 AG08补充没有调用付费模型，但已按本节明确记录的安全前置重启正式4173，并实际执行本地restart/session；没有给无数据的提醒/MCP/应用制造假数据后冒充官方记录。

## 5. 可实施的下一批顺序

1. **P1 导航与资料子交互**：统一Agent/Computer/Human稳定链接、tab恢复与返回；字段inline编辑复用`agent.manage`。先加刷新/后退/切Agent晚返回、Escape/焦点和保存失败测试。
2. **P1 已有数据呈现**：明确AG03语义后修正名称/列表；MCP服务器分组/工具展开；Computer→Agent/Runtime导航。没有服务端差异证据时不另换实现库。
3. **P1 Files与长聊天**：继续C06–C10及Room Files合同，补Worker附件/产物、Task/Thread附件、预览/滚动/大历史锚点的现有来源移植与验收，不由本次七tab观察推断完成。
4. **P2 新业务能力**：提醒、应用grant和`full` reset分别设计/二审；restart/session已完成首批正式闭环。scope/权限/目录破坏边界确定前不开放full。
5. **放行**：同尺寸、同前置、成功/失败/取消/禁用/权限变化分别双边；真实CLI只验证涉及运行的链路；任何修复后按用户要求安全重启正式实例再交付。本文为文档补全，不触发不必要的服务中断。

所有优先级都是后续方案，不表示本轮已经实现。全站指南仍缺部分源码归档与大量细分状态；本轮只把Agent页面最容易误判的“空态相同”“有tab就是完成”转成可追溯的差异账目。
