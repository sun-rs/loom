# Raft UI 产品集成边界

2026-10-14 owner 决策：后续正式前端以公开的官方 Raft 前端源码为母版，停止以旧复刻版本为迁移基础。尽量保留官方界面、组件组合和交互，通过替换数据来源及改名表达 Loom 语义，不大幅新增选项或按钮。下方“内部维护”的复刻来源策略是历史记录；Loom SDK/client-core、鉴权、幂等、恢复与后端领域 owner 仍保留。

官方源码已进入 `frontends/raft` 独立迁移目录，来源清单逐文件记录原样复制摘要及 package manifest 改动；其中原始上游入口仅作隔离基线验证，产品构建使用本地 `loom` 入口。完整上游 Web 构建及桌面／窄屏未登录启动检查通过，原始构建的官方账号页不是 Loom 产品入口；独立频道切片另行接入和验收，见下文。迁移期间仅维护这一套官方前端母版；负责人随后明确要求立即清退旧复刻源码，现已移除旧产品 UI、专属组件包与门禁；控制台继续保留。已部署的不可变资源不随源码删除，产品构建现已接通首条频道切片，保留上游原始账号页与 Loom 产品入口的隔离。版本、依赖、改造边界和首条纵向切片见[源码获取与分析记录](../evo/evidence/2026-10-14-official-frontend-intake/summary.json)。

构建基线复核：`npm ci --ignore-scripts --prefix frontends/raft`，然后运行
`npm run build:official-web`、`npm run test:official-web:source` 和
`npm run test:official-web:browser`。浏览器检查只启动临时静态服务器，阻断外部请求，
不连接 Raft 服务、Loom 正式服务或付费 CLI。导入保留上游字体版权与 LICENSE；
上游原始空白由逐文件摘要核验，不批量格式化。频道接入后必须另外验收业务流程。

2026-10-14 首条官方频道切片：`frontends/raft/loom` 作为本地组合与数据适配层，原样导入官方侧栏、PanelHeader、MessageTimeline、MessageItem、MessageInput 与 AppProviders；列组合参考官方 PublicServerPage，区别于完整 MainLayout 接入。输入框采用官方已有 compact / onSendOverride 接口，尚未开放附件与任务按钮。现有 `MessageSession` / `RoomSession` 仍是分页、恢复和因果位置的唯一 owner。console 的 `WriteIntentSlot` 原样提升到 `packages/client-core/src/write-intent.ts`，console 仅 re-export，不另建第二套未知结果重试机制。请求未知时保留同一个提交，显式核实使用相同请求内容、位置和幂等键；历史导航保留未决请求。上游 API 在此构建中明确拒绝，业务只走同源可信 gateway，浏览器不持有 Human PAT。负责人随后批准按阶段上线以进行实际视觉检查：`build:web:workbench` 使用这条已验收的频道切片，`build:official-web:channel` / `test:official-web:channel` 保留隔离验收用途；console 在全部能力有产品替代前继续保留。具体能力与缺口见[频道切片证据](../evo/evidence/2026-10-14-official-channel-slice/summary.json)。

分阶段发布顺序：第一阶段为现有频道文本切片；随后接入频道实例与执行状态、私聊，再迁入 Role／实例管理及其余已验证能力。每阶段先通过对应流程与双尺寸浏览器验证，再部署至本地正式入口进行实际视觉检查；不以第一阶段上线宣称完整 MainLayout 或全部业务对等。后端冻结边界保持。第一阶段现已上线，正式服务双尺寸真实页面及数据保留核验通过，见[部署证据](../evo/evidence/2026-10-14-official-web-rollout/summary.json)。

2026-10-14 第二阶段成员切片：频道页头复用官方按钮与 `raft-ui` Dialog，在只读弹层中原样复用 `ChannelMemberListShell` / `ChannelMemberRow`。成员身份来自现有 `RoomSession`，状态来自认证的 `room.agent.activity.list`；本地仅拼接名称与标签，不维护第二套成员、队列或运行状态。实例 ID 用于关联，界面显示实例名称；不向官方 Agent store 注入 Loom 状态，也不把执行空闲解释为在线。队列只标示本频道是否有排队工作，缺值显示未知，阻塞单列为需处理。仅弹层打开期间轮询，读失败清除旧状态，关闭时取消读取；官方 Dialog 负责焦点、Escape 与外部点击。尚未接入成员管理、私聊跳转或执行详情；继续保留 console。本阶段已部署，真实3实例状态与API、双尺寸页面及数据保留核验通过，见[成员切片证据](../evo/evidence/2026-10-14-official-web-members/summary.json)。

2026-10-14 第三阶段私聊切片：成员行使用官方 trailing action 打开实例私聊，复用同一套 MessageTimeline / MessageItem / compact MessageInput。`room.direct.open` 通过 control RoomSession 与共享 WriteIntentSlot 发送；响应未知时保留 peer、因果位置与幂等键，仅显式核实原请求。私聊使用独立 roomId 的 MessageSession，URL 刷新恢复同一个 box；频道目录不混入私聊消息，Side 暂不接入。历史快照不含私聊 active 标记，当前可用性从认证 room.list 读取，失联时禁止发送，停用时历史只读。界面说明私聊沿用实例会话、忙时排队，以及显式记忆写入仍属频道共享。没有新后端处理器、会话或投递队列；完整私聊侧栏、附件、执行详情与管理操作仍留 console。本阶段已部署，真实私聊历史／刷新及双尺寸页面核验通过，见[私聊切片证据](../evo/evidence/2026-10-14-official-web-private/summary.json)。

2026-10-14 历史布局修正：负责人反馈短历史贴在输入框上方；本地组合层将官方 MessageTimeline 的现有 `sparseAnchor` 参数从 `bottom` 改为 `top`，频道与私聊共用，消息仍按旧到新向下排列。官方源码不变，长历史仍定位最新内容并支持向上分页；不改后端顺序、分页或会话。双尺寸几何回归先复现779px顶部空白，再验证贴顶；真实私聊页面检查通过，见[修复证据](../evo/evidence/2026-10-14-official-web-history-alignment/summary.json)。

2026-09-08：用户明确[退役 RAH 托管 MCP](../product/managed-mcp-retirement.zh-CN.md)。Settings 与 Agent 详情不再提供该模块；历史截图、测试通过记录不构成重新接入理由。

状态：**Phase 4B implemented / anchored Task tutorial slice**（2026-08-27）。下方早期能力清单不作为当前完成率；最新证据按 docs/README 的日期索引读取。

2026-09-01 Chat 补充：官方 bct/$_ 与 1440×1000 DOM 证实普通聊天侧栏默认240px、180–320px约束并保存布局宽度（仅数字，不存业务状态）。此前“默认320px”不是当前官方事实。行字体以computed style为准；头像预览使用独立的活动状态色，不套用完整日志的分类色。参见[聊天差异合同](../product/2026-09-01-chat-surface-parity-contract.zh-CN.md)。

2026-09-01 导航补充：Search/Activity/Tasks/Saved/Notifications 不再各自拼接页面状态，而是共享 protocol `NavigationTarget`。Web URL 只是 reload-safe projection；每次打开目标必须先经 Kernel Human ACL/存在性解析。Raft NotificationCenter 的 open/view/dismiss 交互被结构化移植，但中央套餐/账号条件不进入本机架构。详见[Notifications 与 typed navigation 合同](../product/2026-09-01-notifications-typed-navigation-contract.zh-CN.md)。

## 1. 当前决策：内部维护，参考证据只读

2026-09-04 起以 [ADR 0028](../adr/0028-owned-neo-brutalist-ui-library.md) 和
[英文内部标准](../design/neo-brutalist-ui.md) 为准。外部 raft-ui 是临时重建成果，
不是官方 React 源码，也不是不可修改的长期母版。

- ui-tokens/src/neo-brutalist：已吸收的 CSS、字体、图标、头像与共享交互样式。
- ui-web/src/neo-brutalist：Icon、PanelHeader、PanelHeaderAction、PanelTabs、PanelResizer。
- apps/web：生产模板组合、路由、既有 typed SDK/client-core 接线及待迁移的页面样式。
- raft-ui-snapshot：只读历史证据；不再是产品生成输入。

旧 sibling 导入器和覆盖生成器已移除。维护内部源码不需要外部目录，也不编辑历史
快照。原样资源保留摘要；采用后的 CSS 允许有来源、有测试的修正。模板复用生产
组件，不导入参考项目模拟状态机。未来比较以内部 catalog 指向的真实 owner 为对象。

## 2. 来源与验收

初始来源、快照摘要、资产原始摘要与后续改动说明由
packages/ui-tokens/adoption.json 保存；当前组件和模板由
packages/ui-tokens/neo-brutalist-library.json 关联既有行为登记与浏览器场景。
来源完整性、生产回归、官方双边一致性是不同证据，不得相互代替。

## 3. 产品 owner

现有 SDK、client-core、Kernel 权限和持久状态 owner 不变。内部库只处理展示和
受控交互；页面不新建第二套颜色、拖拽、Tabs 或数据状态机。未迁移页面仍按家族
逐步收口，不因本次统一入口宣称全站完成。

手工连接模式的 Human PAT 只存在于页面内存。Vite development server 用 `RAH_DAEMON_URL` 做 same-origin proxy；真实浏览器 gate 可额外设置只由测试代理读取的 `RAH_DEV_ACCESS_TOKEN`，代理覆盖浏览器的无权限占位 header，PAT 不进入页面、URL、Local Storage 或测试输出。默认 gate 仍绑定 loopback；显式 `dev:web:multi-agent-fixture:lan` 只为可信局域网的 iOS 实机测试临时绑定 `0.0.0.0`，daemon 继续绑定 loopback，并明确把测试期间的 Human authority 暴露风险归给临时 Web origin。ADR-0017 的 production local workbench 则使用正式 build 与 loopback static gateway：PAT 只在 server side，浏览器持有随机 HttpOnly Strict session，mutation 还受 exact Origin 约束。该 gateway 刻意不支持 LAN；远端入口必须另做 pairing/TLS，而不是放宽 CORS。

`RoomSession.snapshot` 是冷启动基线，不是独立维护的 mutable membership projection。Room 成员窗口必须用 `room.member.list` 判断当前成员；Workspace Agent 目录、旧浏览器内存或 Computer/CLI inventory 都不能单独证明“已加入”。`principal.me` 提供 server-owned 当前 Human 身份，UI 再把它与 Room/control Room 的 canonical membership role 结合：只有 owner/admin 才显示可用的成员管理或 Room 创建动作，capability 本身不等于 authority。加入/移除使用 `client-core` ensure command：mutation 冲突后重新读取 canonical membership，只有目标状态已成立才收敛为成功，否则保留原错误。所有 Room/control Room 写操作通过 `runRoomMutationAtLatest` 先追平 `RoomSession`，并只对结构化 `409 stale_context` 做有界重试；permission/validation 错误不重试，后端始终是并发裁决者。

## 4. 首条切片

2026-08-31消息渲染稳定性补充：`MessageMarkdown`拥有固定的React renderer组件身份，文件打开回调通过Context更新；状态对账或虚拟列表重新测量不得卸载不变消息的图片、代码或Mermaid iframe，不得重置图表/源码选择。动态高度仍由既有`MessageTimeline`测量，不增加第二套滚动校准。`test:web:message-timeline`包含20次父组件刷新、媒体身份/选择、正文更新与最新回调的浏览器回归；不能仅以某一帧出现SVG/iframe验收稳定性。

已接入：

- Human PAT 内存连接；
- Workspace 和 channel Room discovery；
- channel Room 创建，并通过 Workspace control Room 的最新 sequence 保持 causal freshness；
- durable Room sync、validated projection、receipt ack；
- 同一 tab 重载稳定的非 secret consumer ID，以及 durable cursor 领先时从零分页 bootstrap；
- Message/Thread 使用独立可续页 `MessageSession`；Raft-compatible 冷启动只取最新 50 条，`beforeSeq` 每次向上追加 50 条，`afterSeq` 从已验证 cursor 追新。获授权官方 Chat bundle 的实测协议是稳定 Message ID、50 条 before/after 分页、top/bottom sentinel、ResizeObserver、可见 Message 上报和约 1.2 秒 prepend settle window；它会渲染当前已加载页，并未把 Chat 自身实现成虚拟列表。RAH OS 的 product-owned `MessageTimeline` 保留这些锚点与分页语义，同时采用 Raft Tasks 已使用的 TanStack Virtual 技术族，以动态测量、稳定 key、6 行 overscan 和 direct-DOM position mode 保持已加载历史的有界 DOM。Chat 只负责选择首个可见 Message 并发出保存锚点意图，时间线组件是布局校准的唯一 owner；只有无法取得稳定 Message ID 时才使用 `scrollHeight` 差值 fallback。超过 5,000/2,000 条的 catch-up 不会每轮退回 sequence 0；
- `RahClient` 覆盖现有 Human API v3 operation，包括 Room Agent transient state 与 Workspace Agent 跨 Room canonical activity history；
- canonical Message list/post；
- canonical Thread list/create/reply，并把 reply 从主消息流投影中分离到右侧 Thread；
- canonical Task list/create；每个新 Task 同事务获得 Room 内连续编号、顶层 Message anchor 和唯一 Thread；schema v9 会为旧 Task 补齐 anchor，并为缺失 creation event 的旧记录生成可审计迁移事件；
- Channel 创建由 schema v14 Room owner 持久化名称、描述与 public/private 可见性，并在同一事务写入初始 Agent membership；Web 只显示 Raft 的名称/描述/可见性/成员表单，slug 由单一 mapper 派生。旧 client 未提供 visibility 时仍按原私密语义处理，公开频道才把 control Room 中的 Human 纳入可见 membership；
- Channel 后续设置由 typed `room.update` 命令和 RoomKernel 单一 owner 处理：Human owner/admin 必须携带最新 `basedOnRoomSeq`，名称、描述和可见性在同一事务更新并追加 `room.updated`；私密转公开会原子补入 control Room 中尚未加入的 Human，转回私密不隐式踢出现有成员。Web 的 544px 右侧抽屉只投影该结果；其桌面基线固定为 1280×720 / DPR 2，同尺寸测量 drawer rect、15px 滚动槽、字段和按钮几何，个人置顶/静音/折叠偏好在专属协议出现前保持 disabled；
- canonical `task.convert`；Chat 顶层 Message 通过官方形态右键/长按菜单原地获得 Task metadata，既有 Thread 被复用，Thread reply 在 Kernel fail closed；
- Tasks 工具栏“新建任务”复用 canonical `task.create`；Raft dialog 只收集 title、可选 description/assignee，提交后看板卡片、Chat Message 和 Thread 始终是同一 Task anchor；
- 当前 Workspace 的 Agent 长期身份目录与 daemon-owned Computer/CLI Runtime inventory 分离；Agent list 必须带该 Workspace 的 control Room scope，跨 Workspace onboard 在 Kernel fail closed；RuntimeProfile/Offer/AgentDefinition binding 只读展示，不从 Computer 页修改 Room；
- Workspace owner/admin 可从 Raft 形态创建窗口提交显示名称、handle、头像 key、角色、描述、指令、RuntimeOffer、推理强度与 session policy；单个 `agent.provision` command 在 Kernel 原子创建长期身份、Definition/Policy 与 Host grant，重载和 daemon restart 后仍存在；
- 同一 Agent 设置窗口读取 canonical current Definition/Policy，并用 `agent.manage` 原子保存新 revision；暂停会先阻断新 Placement，再由 AgentHost cancel 当前 lane 并保存 terminal proof，恢复后继续 durable queue；删除会清理 memberships 和 Host scope，非安全终态工作存在时 fail closed；
- Placement launch claim 固化 AgentDefinition revision，AgentHost 把它注入实际 child process 的 `RAH_AGENT_CONTEXT_JSON`；页面表单不是运行时真相，Runtime credential 也不会进入该变量；
- Runtime Profile v3 从 Claude/Codex/Kimi/OpenCode 的机器可读目录生成 probe-backed model bindings；Agent 模型下拉只展示当前 Offer 的 redacted descriptors，推理档位只展示所选 binding 明确支持的值，Placement 最终把选择转换成 native adapter 的 shell-free launch controls。无证据选项不显示；
- 从 Room 标题栏/聊天区成员窗口把 Workspace Agent 加入或移出当前 Room；当前状态来自 canonical membership list，重复/并发操作会重新对账；
- 与 Raft channel 一致，Room membership 同时定义普通 Message 的默认投递范围；composer 不提供逐消息收件人复选框，`@Handle` 只把对应成员的 activation reason 提升为 mention，不过滤其他 Room Agent；
- 普通 Chat 不常驻 Room Agent 名单或投递规则面板；只有 Agent 处于唤醒、工作或异常时，消息流底部才显示紧凑状态行，状态完全由 canonical Activation/RunAttempt 推导，不读取 CLI stdout/JSONL，回到 idle 后自动消失；
- Task v1 目标保持真实协议边界：选择一个 Agent 时定向指派，选择全部 Room Agents 时创建开放任务；不伪造任意 Agent 子集竞争；
- Agent progress 与 submission summary 作为 Task Thread reply 持久化；Chat 显示 Task 编号，看板可打开同一讨论 Thread；submitted Task 显示 Agent winner 并允许 creator 在 Review 后显式 complete；
- 从看板打开 Task Thread 后，布局收窄必须把来源 Task 卡保持在看板的可见横向窗口内；enabled mutation 的真实 pointer hit target 必须仍是该控件，不能只让 DOM `element.click()` 绕过消息列遮挡。1280×720 浏览器门禁在 Thread 保持打开时完成 Human review；
- 当前 Room 进入 `?room=<roomId>` reload-safe URL projection；重载恢复同一 Room，而不是回退到列表首项；
- Raft 形态 dialog 共用 Escape、Tab/Shift+Tab focus trap、提交期间禁止关闭和关闭后焦点返回协议，不复制第二套视觉样式；普通 modal 可聚焦首个字段，右侧 drawer 按 Raft 实测聚焦自身无可见 outline 的容器，再由 Tab 进入首个控件；
- 请求完成后才调度下一轮的有界 reconciliation：未追平 250ms、正常前台 5s、后台 15s，失败指数退避到 30s；页面重新可见时立即恢复；
- required recovery capability fail-closed，Message/Task/Thread 等可选 capability 独立降级；错误保留当前 projection，并提供显式重新连接；
- Raft `64px rail + 240px default sidebar (180–320px) + fluid channel`；
- Chat/Task/Files tabs、composer 的“作为任务”；
- 390px 无横向溢出的响应式壳、底部主导航、可关闭的 Room 抽屉，以及占满可用 viewport 的移动端 Thread；
- Files capability 缺失时明确不可用，不加载 fixture。
- Agents surface 由单一 `AgentDirectoryPane` owner 组成：桌面使用官方 `64px rail + 320px members sidebar + fluid detail`，边栏支持 pointer capture、键盘步进与 240–520px 约束；详情固定复用“动态/资料/聊天/提醒/工作区/应用”六标签协议；
- Agents → 聊天通过 typed `agent.room.list` 读取 Kernel canonical membership：只返回当前 Human 与所选 Agent 都能访问的非 control Room，频道/私信分组与空态复用 Raft 官方信息架构，每一行都跳转到真实 Room；Agent-only 私信活动、私信创建与非共同可见 Room 不由浏览器推断；
- Agents → 动态通过 typed `agent.trajectory.list` 读取独立的 Kernel runtime trajectory：Provider driver 只把 Codex app-server 与 Kimi ACP 的结构化 thinking/tool/text/status/compaction 事件写入专用 fd3，GenericProcessAdapter 严格校验后绑定 RunAttempt/RuntimeRun 持久化；stdout/stderr/ANSI 仍只是有界 diagnostics。Codex 只允许公开 reasoning summary，原始 reasoning content/textDelta 不跨越归一化边界；
- 动态首屏取最新 50 条，按 server sequence 正序显示，2 秒可靠性轮询合并去重，活跃窗口最多 500 条；只有用户仍位于底部时才跟随最新，超过 200 字的条目可展开，hover/时间/状态点沿用 Raft 行协议。游标每页重新验证 Human 对实际 Room 的 ACL；
- 动态页“复制诊断信息”只从轨迹 discriminated typed record 逐字段生成最多 200 条、64 KiB 的关联摘要，不复制 thinking/text/tool input/result，也不 `JSON.stringify` React state；浏览器拒绝剪贴板时保留页面并显示局部错误。原 `agent.activity.list` 业务审计继续保留为独立 API，但不再冒充 Raft 的 Agent 动态；
- Agent 像素头像直接消费 allowlisted 官方 avatar preset/palette 与稳定 random recipe；新身份由 Kernel 分配不重复 seed。旧 provider 占位 key 以明示映射采用四个官方预设，不重写 canonical revision；显式预设/random key 保持身份。未知 key 稳定回退，不在每次渲染随机重画；
- 资料页通过 `agent.get` 读取 canonical Definition/Policy，明确区分在线、不可用、已暂停和已删除；390×844 使用同一组件树的 list-first → focused detail → back 协议，详情打开时底部主导航让位，七标签在局部横向滚动而不制造 document overflow；
- Chat 私信顶部头像和 Message Agent 头像共用 App-owned 右侧 `AgentDirectoryPane` 入口，默认进入 Activity；资料头像的官方 preset 修改复用 `agent.manage/update_profile` 的 revision CAS、Room freshness 与幂等事务。Web 只投影 canonical `avatarKey`，不另存头像草稿真相；图片上传在形成授权存储 owner 前保持明确不可用；
- Room sidebar 只属于 Room surface；Agent、Computer、Settings 各自拥有第二列，避免出现四列叠加和全局分隔线漂移；

尚未接入：

- Task unblock 的 Human UI、列折叠细节及完整 Closed/恢复双边验收；
- 独立 Artifact publication、Thread/Task 附件、Finder reveal、完整大文件/类型预览；
- 关系图、提醒、应用目录、显式 execution restart/session reset、Computer control/placement、Admin 的其余适用页面；Billing 与中央账户明确排除；
- 通用 hint/push subscription 与原生 desktop/iOS packaging。已有安装型 PWA shell、正式 loopback/LAN gateway 和 LAN device pairing，不能再登记为整体缺失。

已经接入但仍需继续双边验收：Human Inbox/InputRequest、Activity、Search、Task Review、Room Files、Agent 工作区/记忆、Provider 结构化 tool/file 动态、共同可见 Room/DM、消息回应/收藏、侧栏排序/置顶和 Room 个人静音/长消息折叠。不能把“有 typed owner”外推成视觉和所有失败分支均与官网一致。

这些缺口按 capability 逐个打开，不以“让按钮看起来能点”为理由在 UI adapter 中发明后端语义。

## 5. 验收

- snapshot integrity：80 个文件逐一 SHA-256 校验；
- ui-tokens generation：十一项 allowlisted CSS/font/icon/avatar 输出逐一与 snapshot digest 对照，包含官方 Tasks、Members、Computers computed-style token 与 avatar pack，产品 source/bundle 不含 raw snapshot 路径；
- client SDK：Fake/HTTP 共用 typed schemas，GET/auth/path/error 有 contract test；
- client core：cold reload、backward paginated replay、stable consumer、bounded catch-up、no-progress fence、gap、divergence、apply-before-ack 有确定性测试；
- view model：Message canonical order 与 Task 五列映射有确定性测试；
- browser：`npm run test:web:browser` 自动启动隔离 daemon、两个 Fake CLI runtime、same-origin Vite proxy 与系统 Chrome/Chromium，通过原生 CDP 验证 Workspace Agent 创建、配置 revision、停用、删除与重载持久化、当前六标签、320px 键盘可调 Members sidebar、Agent canonical Room 目录与真实跳转、390×844 Agent list/detail/back、Computer inventory、Room 创建、dialog focus/Escape、成员加入/移除、双 Agent reply、membership-driven delivery、Thread create/reply/count、Task 顶层 Message/连续编号/Thread anchor、claim/start/progress/submit/Human Review/complete、reload-safe URL，以及 390×844 无横向 overflow 和 Room 抽屉；同一 fixture 预置 130 条 canonical 历史并证明首屏只载最新 50 条、一次加载更早增加 50 条、Mounted Message DOM 不超过 80 行，且原可见 Message 的 viewport offset 误差不超过 2px；Human PAT 不进入浏览器，且不启动付费 Provider；
- large-history browser：`npm run test:web:message-timeline` 在真实 `ChatPane` 中投影 10,000 条变高 Message，再 prepend 50 条；固定 1440×1000 Chrome 门禁要求逻辑历史可完整滚动、Mounted Message DOM 不超过 80 行、原可见 Message 锚点误差不超过 2px，并拒绝任何 console/page error。该门禁只启动 Vite 和浏览器，不接 daemon 或 Provider；当前参考运行实测为 10,050 条逻辑 Message、26 个 Mounted Message DOM、0px 锚点偏差；
- CI：pull request 和 `main` push 必须执行同一 `npm run test:web:browser`，不能只用 typed/Fake 测试代替真实 Chrome 业务门禁；
- no-token browser regression：`apps/web/test/room-agent-membership.html` 通过注入 typed `FakeRahClient`，覆盖互斥移动导航、drawer、Message post/render、成员 Agent 自动回复、Thread create/reply、Task create、mention attention、stale snapshot、正常 join/remove/rejoin、并发 join 409、Room sequence catch-up 与 reload recovery；fixture 不读取 PAT、不启动 CLI，也不进入 production Vite bundle；完整控件—反馈矩阵见 `apps/web/test/README.md`，新启用的控件没有 typed handler 和浏览器断言时不得交付；
- exploratory multi-Agent sequence：`npm run dev:web:multi-agent-fixture` 仍只负责启动真实 daemon config v4、测试代理和两个 Fake CLI，供人工检查与浏览器 DevTools 使用；自动验收使用独立的 `npm run test:web:browser`。浏览器无须接触 PAT；`dev:web:multi-agent-fixture:lan` 另提供明确、临时的 iOS 实机入口；
- installed local CLI sequence：`npm run dev:web:local-cli-fixture` 把探测到的 Codex/Kimi/OpenCode/Claude AgentDefinition 建在产品 Workspace 的 control Room，并同时启动 same-origin Web 入口；fixture 输出、页面、URL 与 Local Storage 都不含 Human PAT。`:lan` 变体只用于可信局域网，启动只做 executable probe，真正给 Agent 投递工作才可能消耗 provider 额度；
- real Codex exploratory browser sequence（2026-08-27）：config v4 local CLI fixture 中将 Codex 加入 Room，普通 Human Message 触发真实 Codex CLI；页面依次显示 `waking -> working`，Codex 通过 activation-scoped Worker API 回写基于 Room history 的正文并 ack，随后状态回到 idle。该记录证明本机真实聊天路径可用，但仍是人工 opt-in 证据，不替代自动化付费 Provider certification；
- production build：Vite build 必须独立通过，且不需要 sibling `raft-ui`。
- persistent production workbench：`npm run test:web:workbench` 使用 owner-private 临时 state、production bundle、loopback gateway、带 model catalog 的 fake Codex 与真实 Chrome，证明 Agent 模型/推理 Policy 被实际转换成 child argv、canonical Agent reply、进程重启后的同一 Workspace/Room/Agent/Policy/Message 恢复、无 token 输入页，以及 390×844 无横向 overflow。

## 2026-09-08 附件评论区域与移动折叠

`AttachmentComments` 继续消费 canonical `file.comments`／评论写入接口；本批没有第二套评论存储或分页 owner。移动端保留 40px 评论标题条，展开为 45dvh，高度过渡 300ms，折叠保留草稿；点击已支持位置后收起移动面板。沿用现有预览的 767px 移动断点，未声称与官网所有中间宽度逐点相同。

HTML 区域由 `HtmlFilePreview` 和专用静态 `html-preview-bridge.js` 拥有；区域元数据与其他附件锚点复用原评论合同。它们是 Raft `TYe/vYe` 行为的本地适配，不是原样复制。来源和实操条件见[四项核实](../audits/2026-09-08-raft-remaining-live-confirmation.zh-CN.md)。

隔离边界：iframe 仍是 opaque origin，不开放 allow-same-origin。附件中的 script/meta/base/嵌套 frame/object 被移除；CSP 仅允许产品打包的桥接脚本，禁止附件脚本、任意网络、表单和对象。桥接 URL 使用独立静态资源，不内联为 data URL，因此兼容正式 gateway 的 `script-src 'self'`。接收消息同时检查窗口来源、每个预览的随机 channel、消息类型及有界数值；未 ready 的预览不能报告可定位。应用不将 iframe 消息直接写入账本，必须经 Human 的显式评论发送。

桌面点击／拖框记录文档坐标、大小、视口和文档尺寸及引用；回跳优先匹配引用文字，找不到时回退保存坐标，滚动并短暂高亮。触摸设备不显示桌面区域选择层。取文沿用已核实官网 iframe 的矩形相交文本片段、空白归一化、去重及 200 字符拼接上限；回跳按最小包含元素匹配，重复引用按原选框中心选最近项，失败回退原坐标。桌面回跳保留区域选择层，使用官方 `#ffd440`／1.6s 高亮动画。桥接 DOM 扫描排除产品选择层、高亮及 script/style，保留本地安全隔离；这是结构移植及 RAH glue，不是原样复制。来源见 [HTML 官网核实](../audits/2026-09-08-html-region-official-verification.zh-CN.md)。

本地按 Room sequence 有界翻页、每页再按锚点排序；官网组件对返回集合整体排序。保留此显式差异，不为表面一致改成无界读取。用量观察是独立工程，见[运行器用量接线方案](../product/runtime-account-usage-wiring.zh-CN.md)，不在 Worker 资料读取中隐式发起模型或账户调用。

2026-09-14 Task 弹窗补充：历史状态前后值由 Kernel 的冻结历史投影提供，UI 只展示操作时间线；负责人候选使用频道 activeMemberIds，历史身份解析继续使用已知身份集合。见[验收记录](../audits/2026-09-14-task-detail-operation-history.zh-CN.md)。
