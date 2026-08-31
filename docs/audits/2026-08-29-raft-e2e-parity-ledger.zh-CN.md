# Raft ↔ RAH OS 端到端对照审计账本

日期：2026-08-29\
状态：Active / parity run `parity-20260829-a`

> 2026-08-29 `parity-20260829-live-c` 已在官方与本地执行写入、真实 OpenCode、Task 和刷新实验；最新逐项事实与结论见[双边真实浏览器逐功能验收报告](./2026-08-29-raft-bilateral-browser-verification.zh-CN.md)。本账本中标注为“官方只读/待写入”的早期阶段记录只保留为历史，不代表当前状态。

## 1. 收口声明边界

只有同时满足以下三层门禁，才能把对应产品切片标记为“Raft 等价收口”：

1. **E3 体验对照**：在已登录 Raft 官方 Web 与 RAH OS production Web 中执行同一操作，获得相同的信息结构、可见反馈和业务结果；
2. **E2 真实系统证据**：RAH OS 使用真实 daemon、持久数据库和至少一个真实 Agent CLI，刷新与 daemon 重启后结果仍成立；
3. **E1 业务不变量**：幂等、权限、Room membership、Direct Room、Activation、RunAttempt 和 Task 状态由 canonical owner 证明，不能只从页面外观推断。

“页面看起来相近”、静态 fixture、DOM 单测或一次 CLI exit `0` 均不能单独获得完成状态。

## 2. 固定测试数据

| 对象            | 固定值                                                                 |
| --------------- | ---------------------------------------------------------------------- |
| 审计 run        | `parity-20260829-a`                                                    |
| Channel 名称    | `Parity Lab 20260829 A`                                                |
| Channel slug    | `parity-lab-20260829-a`                                                |
| 新 Agent 名称   | `Parity Auditor A`                                                     |
| Agent handle    | `ParityAuditorA`                                                       |
| Human Message 1 | `Parity check A: summarize this Room's purpose in one short sentence.` |
| Human Message 2 | `Parity check B: reply in this Thread with one concrete next step.`    |
| Task title      | `Parity task A: produce one verified next step`                        |

官方 Raft 侧只使用上述明确命名的审计对象；不修改既有 Agent、Room、Task 或历史消息。创建、发送、删除等外部副作用必须遵守浏览器操作确认规则。

## 3. 证据记录格式

每一步至少记录：

- 操作前 URL、页面和选中对象；
- 操作入口、enabled/disabled/loading/error 状态；
- 操作后的可见文案、URL、成员数、回复数和状态；
- 固定 viewport 截图与可访问 DOM；
- RAH OS 对应 Room event、Message、Inbox、Activation、Placement 和 RunAttempt；
- 刷新与 daemon 重启后的恢复结果；
- 差异分类：`visual`、`interaction`、`business`、`durability`、`security`、`allowed-architecture`。

### 3.1 大屏同尺寸优先协议

- 核心页面首先在 Raft 官方 Web 与 RAH OS production Web 使用完全相同的桌面 viewport、浏览器缩放和 DPR 验收；`core-b` 固定为同一标签顺序访问的 `1280×720 / DPR 1`，早先抽屉几何基线使用 `1280×720 / DPR 2`，两组证据不得交叉比图；
- 先记录 outer rect、content/client width、滚动槽、分区边界、字体、行高、padding、border 和 focus owner，再比较截图；内容数据不同不作为几何漂移的借口；
- 频道设置抽屉本轮实测基线为 `x=736 / width=544 / height=720`，内部滚动区 `clientWidth=527`，名称输入 `495×44`，描述输入 `495×68`，操作按钮分别为 `48×28` 与 `72×28`；
- 桌面 E3 通过后再执行 390×844 PWA 回归。移动端不能形成第二套组件、命令或状态语义。

## 4. 主链矩阵

| ID  | 用户旅程                               | Raft 官方结果                                                                                                                                              | RAH OS 结果                                                                                                                                                                                                                                                                                                             | 后台不变量                                                                     | 状态        |
| --- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------- |
| P01 | Agent 目录与资料                       | 已只读确认 Workspace 级 Agent/Human 目录、Computer 分组、七标签资料页、role/runtime/model/effort/mode/env 与生命周期操作                                   | 已确认 Workspace Agent/Human 目录、七标签骨架、role/runtime/model/effort；role permissions、env 和多数生命周期操作尚缺                                                                                                                                                                                                  | Definition/Policy/Runtime binding                                              | partial     |
| P02 | Agent 动态                             | 已只读确认 Cindy 动态包含时间、状态、tool/file/command 轨迹与安全诊断复制                                                                                  | `Parity Auditor A` 的三次真实 Codex RunAttempt 可见启动、模型请求、公开 reasoning summary、命令、命令终态、消息写入、ack 与完成；支持展开长命令和复制诊断。缺官方的活动筛选/状态命名与部分文件、工具语义映射                                                                                                            | trajectory 与 Room truth 分离                                                  | partial     |
| P03 | 创建 Agent                             | 已确认创建入口分 managed Agent 与 external Agent；managed 表单包含 Computer、名称、描述、runtime、model、环境变量，external 区分交互式与仅通知；提交待确认 | 已在 production Web 创建 `Parity Auditor A`，持久化 Codex / GPT-5.6-Sol / low、描述、角色和 instructions；Offer 漂移 P0 修复后重启仍在线并可真实执行；Computer/env/external Agent 表单仍缺                                                                                                                              | 原子 provision、版本化配置、Host scope                                         | partial     |
| P04 | 创建 Channel                           | 已确认表单含名称、描述、公开/私密和创建时 Agent 多选；提交待确认                                                                                           | 1280×720 同尺寸已对齐 448px 表单、字段次序、搜索和多选；本地真实创建 `Parity UI Channel 20260829`，描述/私密可见性持久化且 `Parity Auditor A` 在同一事务加入，刷新后 URL/成员恢复。后续又通过精确 544px 右侧抽屉真实改名、改描述及私密→公开，刷新与数据库均恢复；尚未在官方侧提交写入                                   | control Room causal create；schema v14 Room metadata；原子 initial membership  | partial     |
| P05 | Channel 成员管理                       | 已只读确认设置抽屉、Human/Agent 分组、角色、搜索、批量添加与未加入 Agent 选择器                                                                            | 1280×720 / DPR 2 下设置抽屉已精确对齐官方 `x=736 / 544×720`、15px 桌面滚动槽、527px 内容宽、字段/按钮尺寸与主体边界；成员摘要整行可点击，初始焦点落在无可见 outline 的 drawer owner。现有单 Agent 加入/移出仍走真实 membership。批量添加、Human 角色管理和个人偏好持久化协议尚缺，其中偏好开关明确 disabled、不伪造保存 | membership 决定投递范围；room.update 幂等、权限与 stale-context 约束           | partial     |
| P06 | Human 普通消息与多 Agent 回复          | 待确认后执行                                                                                                                                               | 固定 Message 1 已真实发送；Kimi、OpenCode、Codex 各自产生真实 RunAttempt、trajectory 与 canonical 回复；Codex Offer 漂移修复后补跑成功                                                                                                                                                                                  | 每个 Room Agent 恰好一个 Activation/回复                                       | in_progress |
| P07 | Thread 首次回复与摘要                  | 已只读确认频道和 DM 共用 Thread 入口、右侧消息列、回复计数与摘要                                                                                           | 首次实测发现 Agent 回复错误进入 Room 根流；失败测试复现并修正因果路由。Direct Room 复测中 Human 回复后，真实 Codex 回复 `thread received` 只写入同一 Thread，根流无重复消息，回复数 1→2                                                                                                                                 | root/reply、Activation 因果 Thread、渐进披露                                   | partial     |
| P08 | Message 转 Task / Task lifecycle       | 已只读确认频道 Task 看板、筛选、看板/列表、五状态列、Task 详情、负责人/创建者、独立回复列；创建和状态写入待确认                                            | production Web 创建固定 Task，Room 三个 Agent 均可见；Kimi 原子 claim、progress、submit，Task 从 todo→in_progress→submitted，产生两条 dedicated Thread reply；Human “确认完成”后进入 completed                                                                                                                          | Message/Task/Thread 单一身份、Human Review                                     | in_progress |
| P09 | Human ↔ Agent 私聊                     | 已只读确认既存 Human↔Agent DM：与频道共用聊天/任务/文件标签、消息动作、线程和 composer；Agent 顶部菜单的“私信”是创建/进入入口                              | 从 Agent Chat 创建 `Parity Auditor A` Direct Room；成员固定为一 Human + 一 Agent，增删控件禁用；真实 Codex 回复，刷新/重启后消息和成员仍在；同一 DM 已通过 Thread 复测                                                                                                                                                  | immutable two-party Direct Room                                                | partial     |
| P10 | 刷新与 daemon 重启恢复                 | Raft 只验证刷新                                                                                                                                            | 固定 Channel、Direct Room、成员、Agent Definition、普通消息、Task 状态和 Thread 在 production daemon 重启后恢复；仍缺大历史分页与中断 RunAttempt 的浏览器恢复验收                                                                                                                                                       | durable ledger/cursor/provider session                                         | partial     |
| P11 | 390×844 响应式主链                     | 待执行                                                                                                                                                     | `npm run test:web:browser` 已验证 390×844 无横向溢出、Rooms 抽屉、Agents list-first/详情/返回、七标签复用及设置页；仍缺官方 iOS/PWA 同尺寸逐屏基线                                                                                                                                                                      | 同一组件和 command path                                                        | partial     |
| P12 | hover/focus/menu/dialog/disabled/error | 已记录 Agent 更多菜单、创建 Agent/Channel、频道设置/成员/添加成员、Computer 创建等真实 overlay 层级与 disabled 状态                                        | Channel 创建弹窗与设置抽屉已做 1280×720 / DPR 2 同尺寸 overlay/disabled/error 对照；修正了全局按钮规格泄漏、错误的 10px 滚动槽、抽屉主体层级、成员行点击面积、初始焦点 owner 与蓝色默认 focus ring。浏览器实测曾捕获未注册 `/rooms/update` 的真实 404，补应用服务回归后重试成功。其余全局菜单和页面仍待逐项同屏对照     | 启用控件必须有真实 handler                                                     | in_progress |
| P13 | 全局 Search / Activity / Notifications | Search 已只读实测 `Cindy` 返回 21 条结果并支持发送者、范围、频道、时间、排序；Activity 是 Human Inbox；通知中心有独立空态/滚动层                           | RAH OS 三个全局 rail 入口当前均明确 disabled；后台已有 Inbox/trajectory 局部投影，但尚无对应 Human 全局 application service 与页面                                                                                                                                                                                      | Search index、Human Inbox 与 notification projection 不得混为 Agent trajectory | fail        |
| P14 | Computer 管理与远程 Host               | 已只读确认 Computer 列表、在线/离线、OS/版本、探测 runtime、创建者、绑定 Agent、恢复/诊断/重装命令、添加与删除前置条件                                     | 1280×720 已改为 Raft 同构 Host-first 列表/空态/选中详情，240px 边栏与 180–400px pointer/keyboard resizer 已实测，详情展示真实 Runtime Offer 与绑定 Agent。后端尚未投影主机名、OS/Computer 版本/创建者；远程添加、恢复、升级和生命周期操作仍缺 typed Web API                                                             | Computer 身份与 Runtime Offer 分离，远程 Host 有受认证 generation/attachment   | partial     |

## 5. 本轮已取得的官方只读基线

已登录 Raft `hakasemac` 的 Cindy → 动态页面当前可见：

- 全局 rail：搜索、聊天、动态、任务、成员、计算机、通知中心、帮助、设置；
- Members 第二列：关系图、Agent/Human 分组、Computer 分组、添加 Agent 与邀请成员；
- Agent 详情固定七标签：动态、资料、聊天、提醒、工作区、应用、MCP；
- 动态页显示 `活动诊断` 与 `复制诊断信息`；
- 条目具有时间、状态和内容，当前样本包含 `Message received`、`Thinking finished`、`Tool finished`、`Running command`、`Editing file`、`Checking messages`、`Idle` 与 `Computer stopped`；
- 这些诊断与 Room Chat 消息正文分离。

该基线来自真实登录页面的 DOM 与可见状态，不来自 RAH fixture 或静态截图。

### 5.1 Agent 目录、资料和运行配置

- Agent 是 Workspace 级长期成员，按所属 Computer 分组；Human 独立分组；
- Agent 固定七标签：动态、资料、聊天、提醒、工作区、应用、MCP；
- Cindy 资料真实显示：显示名、描述、角色、角色权限、Computer、创建时间/创建者、runtime、model、effort、mode 和遮罩后的环境变量；
- 操作包括启动、重启/重置、复制诊断、报告问题和删除；Computer 离线时，Workspace 文件加载与生命周期操作显示真实错误/恢复状态，而不是伪造成功；
- Agent 聊天标签只列其已加入频道和既存 Agent 间私信；新建 Human↔Agent DM 的入口在 Agent 顶部“更多操作 → 私信”。

### 5.2 managed Agent 与 external Agent

- “添加 Agent”菜单区分“创建 Agent”和“创建外部 Agent”；
- managed Agent 表单包含 Computer、名称、描述、runtime、model 和额外环境变量；model catalog 依赖在线 Computer 的实时探测；
- external Agent 分“交互式 Agent”和“通知发送者”：前者可读取上下文、参与对话并执行 freshness 检查；后者只能发送通知，不能读取上下文，也不使用 freshness 草稿；
- 因当前官方 Computer 离线，managed Agent 的 Computer/runtime/model/effort 完整联动尚未提交验证。

### 5.3 Channel、DM、Thread 与 Task

- Chat 侧栏分联合频道、频道和私信，支持展开、排序和置顶；
- 创建 Channel 时一次性配置名称、描述、公开/私密和初始 Agent 成员；
- Channel 设置为右侧抽屉，包含成员、名称/描述、置顶、静音、折叠长消息、公开化、归档、退出、停止 Agent 和删除；成员页按 Human/Agent 分组并展示 owner/admin/member；
- Channel 与 Human↔Agent DM 都使用聊天/任务/文件三标签和同一套消息动作、Markdown、Thread、收藏、回应、附件与“作为任务”composer；
- Task 不是独立聊天 Room：Task 详情锚定原 Channel，具有编号、状态、负责人、创建者和独立回复列；频道任务板有待办、进行中、待确认、完成、已关闭五类；
- 全局 Task 页有意排除 DM 和 Agent task board，因此“全局任务为 0”不代表具体 Channel/DM 没有任务。

### 5.4 Activity、Search 与 Computer

- 全局 Activity 是用户收件箱投影，支持全部/未读/提及和“标记为完成”，聚合频道、DM、Thread 与 Task 更新；它不同于单个 Agent 的 runtime trajectory；
- 全局 Search 可检索 Agent、频道、私信与消息历史，并提供发送者、范围、频道、时间与排序筛选；实测 `Cindy` 返回 21 条真实结果；
- Computer 详情包含在线状态、OS/版本、运行时发现、创建者、Agent 清单、恢复命令、诊断命令、重装指南和删除前置条件；
- “添加 Computer”区分自己的 Computer 与尚未推出的云端 Computer；继续到注册/凭据阶段可能生成真实服务器状态，本轮未继续。

### 5.5 本轮尚未执行的官方写入

以下动作尚未执行，不能据只读 UI 宣称业务收口：

- 创建 `Parity Auditor A`；
- 创建 `Parity Lab 20260829 A` 并加入 Agent；
- 发送两条固定消息、等待真实 Agent 回复；
- 创建/认领/流转 `Parity task A`；
- 新建审计 DM、验证刷新后的路由与历史。

这些动作会写入官方 Raft `hakasemac` 工作区，必须在动作发生前获得明确确认。

## 6. RAH OS 首轮真实主链证据与 P0 修复

隔离 production workbench 使用 `/tmp/rah-os-parity-20260829-a.Z24AbY`，不是静态 fixture。固定 Room 已创建，owner、Codex、Kimi、OpenCode 四个成员均由 canonical membership 读取。发送 Message 1 后：

- Kimi RunAttempt 正常退出并写入 294 条 trajectory，产生 canonical 回复；
- OpenCode RunAttempt 正常退出并写入 356 条 trajectory，产生 canonical 回复；
- Codex Activation 保持 `queued`、attempt count 为 0，没有 Placement 或 RunAttempt，因此不能把“未回复”误判为等待时间不足。

根因是 Codex CLI 同一二进制先返回 bundled catalog（含 GPT-5.2），随后刷新在线 catalog（含 GPT-5.4/5.4-mini）。旧实现把 model binding 列表变化当成 executable contract 被替换，错误发布 `unavailable`；Agent 创建和 Room 投递因此同时失败，而成员 UI 又读取启动期 discovery 快照显示“Runtime 可用”。已完成所有权级修复：

1. catalog refresh 生成新的可用 Offer observation；只有 executable identity、profile lifecycle 或 probe availability 变化才下线 Runtime；
2. config v4 Placement 在 launch 时读取自身冻结 observation 对应的精确 immutable probe，不读取启动期 probe；
3. Web runtime availability 改读当前 canonical Offer 的 lease、Host generation、state 与 trusted evidence；
4. targeted tests 38 项通过，TypeScript 全仓通过；重启隔离 workbench 后，旧 Codex Activation 获得 Placement/RunAttempt 并正常回复，`Parity Auditor A` 也能以 GPT-5.6-Sol / low 在 Direct Room 真实回复，因此 Offer 漂移 P0 已完成 E1/E2/E3 复验。

随后 Thread 主链暴露第二个 P0：Human 在 Thread 内回复会正确创建 `thread_subscription` Activation，但 Worker `message-post` 只会调用根消息写入，导致 OpenCode/Codex/Kimi 的回复显示在 Room 根流而不在右侧 Thread。这不是 CSS 问题，而是 canonical routing 错误。修复遵循以下 owner 规则：

1. Worker 仍不能提交 actor、Room、recipient 或 `threadId`，避免 Agent CLI 猜测业务路由；
2. RoomKernel 从已认证 Activation 的 `toSeq` 因果事件读取该 Agent 的实际 recipient reason；只有 `thread_subscription` 才提取 `threadId`。因此先到达的根消息与后到达的 Thread 消息即使合并进同一 queued Activation，也按最新因果事件正确路由；
3. CollaborationService 在同一事务写入 `messages.thread_id`、更新 `threads.reply_count/last_reply_at` 并把 `threadId` 写进 `message.posted`；
4. 新增失败优先测试，并额外覆盖“根消息 Activation 尚未领取，Thread 消息合并进同一 Activation”的竞态后，Worker/Kernel 相关 53 项回归、全仓 TypeScript 与 `git diff --check` 通过；
5. production Web 的新 Direct Room 实测：根消息得到根回复 `root received`；Thread Human 回复得到真实 Codex 回复 `thread received`，仅出现在原 Thread，摘要回复数从 1 增到 2，数据库记录同一 `thread_id`，RunAttempt exit `0`。

## 7. 核心四模块复验（`parity-20260829-core-b`）

本轮不以代码存在为完成条件，使用同一 Raft 官方登录会话、隔离 RAH OS daemon、真实浏览器和两层 Runtime 证据复验。

### 7.1 Raft 官方只读交互基线

- Channel 与 Human↔Agent DM 共用聊天/任务/文件标签、消息 hover 动作和右侧消息列；DM 使用 Agent 头像、名称、状态以及 `@Agent` composer 目标，Channel 使用 `#Channel`、描述、成员数和设置入口。
- Agent 目录按 Computer 分组并显示 Human；详情固定为动态、资料、聊天、提醒、工作区、应用、MCP 七标签。
- Agent 顶部“更多操作”菜单实测为“私信 / 启动 Agent / 重启 / 重置”；聊天标签显示可参与频道与 Agent 私信。
- Agent 动态标题为“活动诊断”，时间线展示结构化状态、思考摘要、command/file/tool 和回复，不把 stdout/ANSI 当消息正文。

官方当前 Computer 离线，因此本轮没有伪造“官方 Agent 已执行”证据，也没有为了截图创建污染官方 Workspace 的对象；官方业务写入仍保持 `not-tested`，不计入 RAH OS 的 E2 证明。

### 7.2 RAH OS 真实浏览器业务结果

隔离 fixture：`http://127.0.0.1:4183`，Room `room_1a43db75-d226-4d9e-a9c4-afb7610de0a7`。固定大屏截图通过同一浏览器标签在 `1280×720 / DPR 1` 依次访问官方与本地页面，避免 origin zoom 与窗口尺寸污染。

| 模块       | 实际操作                                              | 可见与持久结果                                                                                                | 判定 |
| ---------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ---- |
| Channel    | Agent Council 加入 Kimi，Human 发送一次消息           | 标题人数 2→3；Alice、Kimi 各产生一次 canonical 回复；刷新后成员数、Human 消息和两条回复仍在                   | pass |
| Thread     | hover Human 消息 → 在消息列中回复                     | hover 才出现回复按钮；首次回复懒创建 Thread；根消息出现“1 条回复”摘要；刷新后摘要存在，重新打开消息列可见回复 | pass |
| DM         | 从 Agent 聊天页创建 Identity Bot Direct Room 并发消息 | 侧栏/标题使用官方头像与角色，composer 为 `@Identity Bot`；Human 与 Agent 回复刷新后均在                       | pass |
| Agent 管理 | 创建、改描述、暂停、恢复、创建一次性 Agent 后安全删除 | 配置刷新后恢复；暂停期间新 DM 不创建 Agent 回复；恢复后的新消息重新回复；删除经过二次确认并从目录收敛         | pass |
| Agent 动态 | Identity Bot 完成 DM turn 后打开动态                  | 依次显示“工作中 / 思考 / 回复”三条结构化记录，回复身份和 Chat canonical body 一致                             | pass |

### 7.3 本轮发现并修复的 P0

新建 Agent 绑定已有 Runtime Offer 后，canonical 消息作者正确但 Fake CLI 回复正文错误自称 Kimi。根因是 fixture 把 `RAH_FAKE_AGENT_NAME` 写进 RuntimeProfile 静态环境，错误地让“运行时能力”拥有了“Agent 身份”。修复后：

1. Kernel 从 AgentDefinition 对应 principal 读取 handle，并把它冻结进每次 `AgentRuntimeContext`；
2. 本机/远程 Host 继续通过既有 launch envelope 注入该 context；RuntimeProfile 不再保存 Agent 名称；
3. Fake CLI 从 activation-scoped Agent context 读取 handle；
4. 新建 `Identity Bot` 的可见作者为 `identity-bot`，正文也自称 `identity-bot`，刷新后保持一致；
5. Kernel、Computer protocol、process runtime 定向回归 67/67 通过。

### 7.4 真实 CLI 独立门禁

`npm run test:real:multi-cli` 于本轮重新执行通过（95.3 秒）：Codex `gpt-5.6-sol/low`、Kimi `kimi-code/k3`、OpenCode `deepseek/deepseek-v4-flash/max` 在同一 canonical Room 中各获得精确 model/effort/full-access Placement、各一个 RunAttempt、各一条 canonical 回复并正常 exit `0`。这证明上述浏览器 fixture 不是替代真实 CLI 的唯一证据。

### 7.5 仍不得宣称 Raft 全功能等价的差异

- Agent：官方顶部菜单的 start/restart/reset、role permissions、mode/env、external Agent、Workspace/Apps/MCP 完整管理仍未收口；当前本地 restart/reset 明确 disabled。
- 消息：官方 reaction、bookmark、附件和 Files 尚未有完整 protocol/handler；本地只开放真实 Thread 动作。
- 全局：Search、Human Activity/Inbox 和 Notification rail 仍 disabled；它们不能由 Agent trajectory 冒充。
- Channel 管理：批量成员、Human 角色、个人置顶/静音/折叠偏好，以及归档/退出/删除等危险操作仍缺 typed owner。

因此本轮的准确结论是：**核心四模块的本地业务主链和比较实验已经闭环，Raft 全产品等价尚未闭环。**

### 7.6 自动化真实浏览器总门禁

本轮最终再次执行 `npm run test:web:browser`，Chrome 真实页面门禁通过，浏览器 console error 为零。门禁覆盖的不是静态 DOM，而是下列连续业务结果：

- 创建 Workspace Agent、修改身份、暂停、删除，以及创建用于 Task owner routing 的第二个 Agent；
- 创建 Channel，加入 Alice、Kimi 和 owner-router，发送一次 Human Message 后 Alice/Kimi 各回复一次；
- 移出 Alice 后再发送消息，仅 Kimi 回复，投递范围立即收敛；
- hover 后打开 Thread、回复、转 Task、Task claim/progress/submit/Human complete；
- 刷新后以 URL 恢复所选 Room、消息、成员和 Task；
- 390×844 下复用同一 Rooms、Agents、七标签和设置命令路径且无横向溢出。

门禁同时清除了四个会让“自动化绿灯”失真的旧假设：Agent 边栏旧宽度、旧 Agent 创建按钮路径、旧 Room slug 可见输入框和旧成员弹窗选择器；并修复 Computer Runtime 列表重复 React key 与只读 Computer 选择框 warning。现在该门禁操作的是用户当前真正可见的控件协议。

## 8. 下一批最高优先级

### P0：Human Activity / Inbox、全局 Search、Notifications

这是下一批最高优先级，而不是继续扩充 Agent CLI 参数。原因是 Raft 左侧主导航中这三条日常闭环当前在 RAH OS 仍是 disabled，造成“Agent 已回复或提及 Human，但 Human 无法从全局入口发现、检索、处理”的产品断点。

实施顺序：

1. Kernel 分别建立 Human Inbox、Search query 和 Notification projection 的单一 owner；禁止复用 Agent trajectory 冒充 Human Activity。
2. Application service 暴露版本化 command/query：全部/未读/提及、mark handled、范围/发送者/Room/时间/排序筛选，以及 opaque cursor 分页。
3. daemon 为消息与 Task 事件维护增量索引和 revision-keyed 热缓存；浏览器只保留有界内存页，不把历史写入 localStorage/IndexedDB。
4. Web 按官方页面实现 Search、Activity 和通知中心的 loading/empty/result/error/分页/键盘状态，并接回真实 rail 控件。
5. 新增固定 1280×720 的官方/本地同标签对照，以及 390×844 同组件门禁；必须从结果点击回到正确 Channel、DM、Thread 或 Task。

### P1：Agent 生命周期与配置闭环

紧接 P0 完成官方顶部菜单的“私信 / 启动 / 重启 / 重置”真实 command contract，并补 role permissions、mode/env、external Agent。每个按钮必须有后端 receipt、错误态和刷新恢复；重置必须显式区分 Agent Definition、provider session 与历史，不允许前端猜测或静默删除。

### P1：Message actions 与 Files

补 reaction、bookmark、附件上传/下载和 Files 页的 canonical protocol/handler，再做 Channel/DM 共用组件的浏览器门禁。这批直接影响聊天室日常可用性，但优先级低于“Human 看不到待处理事项”。

### P2：Channel 管理与远程 Computer

先完成批量成员、Human role、置顶/静音/折叠偏好和归档/退出/删除，再接远程 Computer 注册、认证 attachment、runtime inventory、Agent placement 与恢复/升级。远程 Host 是产品扩展主线，但不应抢在本机 Human 工作闭环之前。

## 9. 收口判定

- `pass`：同一主链的 E3、E2、E1 全部成立，且不存在 P0 差异；
- `partial`：主结果成立，但存在缺失状态、交互、真实 CLI、恢复或视觉证据；
- `fail`：控件无真实 handler、业务结果不同、状态不可恢复、错误投递、重复副作用或明显页面结构漂移；
- `not-applicable`：RAH OS 架构有意不同且不改变人类可见结果或业务不变量，并有文档说明。

最终报告必须列出逐项证据，不以总分掩盖 P0 failure。
