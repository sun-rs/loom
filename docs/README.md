[移除操作完成占行提示](./audits/2026-09-21-completed-feedback.zh-CN.md)：取消拖动、设置保存、测试推送和服务重启完成后不再占行；保留失败提示。

[移除任务成功占行提示](./audits/2026-09-21-task-success-notice.zh-CN.md)：保留失败与保存状态，更新成功后不再显示额外文字行。

[聊天／成员列表间距复核](./audits/2026-09-21-list-spacing.zh-CN.md)：Raft CSS 几何对照，修正成员分区及头像、计算机小标题间距。

[分栏宽度与拖拽记忆实施](./audits/2026-09-21-conversation-width-memory.zh-CN.md)：搜索／动态共享宽与紧凑偏好，人物资料独立宽度，压缩不覆盖桌面记忆。

[Raft 默认分栏与压缩边界测试](./audits/2026-09-21-raft-width-render.zh-CN.md)：Firefox／Chromium 源码隔离渲染及已登录官方 Chrome 测量；含真实拖拽记忆与尺寸恢复。

[PWA 加载性能与统一等待状态](./audits/2026-09-21-pwa-loading-performance.zh-CN.md)：慢请求、不可见 Room 读取、静态压缩、启动奶黄色与沿用页面底色的局部加载。

[一级正文按钮与分隔线](./audits/2026-09-21-navigation-chrome-roles.zh-CN.md)：频道/私聊桌面无 X，保留后续详情退出；设置抽屉逐层源码核对。

[模型显示名称统一](./audits/2026-09-21-model-display-names.zh-CN.md)：选择器、资料、预览与聊天共享标签解析，原始 ID 保留在提示与执行配置。

[Claude 具体版本推理强度闭环](./audits/2026-09-21-claude-custom-effort.zh-CN.md)：按文档限定档位，保留配置、Placement 与 CLI 参数，区分提交许可和本机探测。

[移动端根入口列表](./audits/2026-09-21-mobile-root-entry.zh-CN.md)：底部导航先显示列表，明确链接与缩窄继续保留详情。

[移动端会话标题栏与搜索身份修复](./audits/2026-09-21-mobile-conversation-chrome.zh-CN.md)：单页返回、不可用资料图标、身份去重与按下反馈；偶发白屏仍待复现。

[其余可拖动页面测量](./audits/2026-09-21-directory-resize-isolation.zh-CN.md)：任务大页不变，成员、Computer、文件树宽度隔离。

[分栏缩放性能证据](./audits/2026-09-20-resize-render-isolation.zh-CN.md)：UI 里程碑、宽度隔离、观察器和回归验证。

[共享导航与折叠设计](./product/shared-conversation-navigation.zh-CN.md)：搜索、动态、聊天的真实来源、宽度和退出语义。

[频道设置成员资料返回修复](./audits/2026-09-20-settings-profile-back.zh-CN.md)：返回上一层与关闭侧栏分离，保留聊天分栏语义。

- [消息列提及误订阅全部成员修复](audits/2026-09-20-thread-explicit-mention-recipients.zh-CN.md)

- [Composer 与搜索页 @ / # 引用](audits/2026-09-20-composer-search-references.zh-CN.md)

[Raft / RAH 组件样式源码审计](./audits/2026-09-20-ui-style-source-audit.zh-CN.md)：逐组件尺寸、颜色、字体、弹窗差异与证据边界。

[Composer @ / # 匹配对齐](./audits/2026-09-20-composer-suggestion-ranking.zh-CN.md)：字段、拼音、排序、数量限制及身份边界。

[裸符号搜索目录与关注资格](./audits/2026-09-20-search-sigil-directory.zh-CN.md)：裸 @／# 不查正文，频道成员与消息列关注保持独立。

[频道添加成员面板](./audits/2026-09-20-channel-add-members.zh-CN.md)：紧凑选择、蓝色标签、复用创建弹窗与自动加入失败重试。

[Agent 账号与历史身份绑定](./audits/2026-09-20-agent-account-identity.zh-CN.md)：区分大小写的存活账号唯一、删除后复用、显示名可重复、agentId 兼容与历史提及绑定。

[身份显示名称入口核查](./audits/2026-09-20-identity-display-name-coverage.zh-CN.md)：统一展示名，保留寻址账号与历史原文，列明各入口证据边界。

[已删除 Agent 模型预览与重建名称](./audits/2026-09-20-deleted-agent-preview-model.zh-CN.md)：补齐预览前缀清理，区分内部 ID 与全局 handle 约束。

[动态打开延迟](./audits/2026-09-20-activity-open-latency.zh-CN.md)：移除重复目标读取，触屏跳过桌面双击等待，保留权限和身份完整性。

[Claude 目录与自定义模型](./audits/2026-09-20-claude-catalog-custom-models.zh-CN.md)：去除 Default，补充 Raft 别名/版本候选，Claude/Codex 支持显式原生 ID。

[动态卡片身份名称](./audits/2026-09-20-activity-identity-labels.zh-CN.md)：私聊标题与摘要发言人按独立身份显示最新名称，覆盖改名和删除。

[模型选择器名称](./audits/2026-09-20-model-picker-labels.zh-CN.md)：提供方 · 真实模型显示名，保留原生 ID 核对与绑定。

[CLI 产品名称统一](./audits/2026-09-20-runtime-product-names.zh-CN.md)：移除前端 native 传输描述，兼容旧私聊标题。

[Task 属性同行布局](./audits/2026-09-20-task-assignee-status-and-live-badge.zh-CN.md)：状态、负责人、创建人按标签＋值成组横排，窄屏整组换行。

当前任务视图修复：[看板／列表偏好记忆](./audits/2026-09-20-task-view-memory.zh-CN.md)。

[动态响应式分栏修复](./audits/2026-09-20-activity-responsive-navigation-investigation.zh-CN.md)：动态始终留在本页，复用聊天分栏与返回，修复空白列、分隔线和根消息校验冲突。

[聊天主导航恢复修正](./audits/2026-09-20-surface-selection-parity.zh-CN.md)：搜索／动态不再覆盖聊天记忆，保留频道、私聊及已保存的恢复。

[新 Agent 首次初始化与报到](./audits/2026-09-20-agent-first-run-greeting.zh-CN.md)：从 Raft 实际 CLI session 验证系统 Inbox 触发，新建身份同事务排队、设置开关、实际发言完成证明及跨尝试去重。

[恢复频道未读计数修正](./audits/2026-09-20-archive-notice-unread-correction.zh-CN.md)：归档通知保留历史但不计入列表未读，恢复通知正常计数，不清除已有未读消息。

[Task 卡片点击范围](./audits/2026-09-20-task-card-hit-area.zh-CN.md)：卡片内边距、底部空白及文字单击打开，状态菜单独立。

[Task 负责人权限与实时徽标](./audits/2026-09-20-task-assignee-status-and-live-badge.zh-CN.md)：完成禁止更换负责人，重开恢复；Human/Agent 显示名与取消指派立即反映到聊天。

[归档频道卡片尺寸](./audits/2026-09-20-archived-card-sizing.zh-CN.md)：对齐 Raft 卡片内边距和 28px 取消归档按钮，删除说明文字。

[频道与私聊统一未读](./audits/2026-09-20-conversation-unread-rule.zh-CN.md)：普通消息和正文系统通知共用未读数量、字体加粗与列表点击阅读确认。

[系统通知与恢复确认](./audits/2026-09-19-system-notices-and-restore-read.zh-CN.md)：显示名、连续三条起折叠；恢复提醒由侧栏点击确认，自动跳转不确认。

[已删除 Agent 的任务身份与负责人](./audits/2026-09-20-deleted-agent-task-identity.zh-CN.md)：统一显示名和历史头像，删除解除所有状态任务的负责人，保留任务状态并幂等补齐旧库。

[已删除 Agent 历史消息身份](./audits/2026-09-19-deleted-agent-message-ui.zh-CN.md)：保留授权历史身份，灰色头像、禁用名字提及和不可用面板。

[创建 Agent 运行时设置](./audits/2026-09-18-agent-create-runtime-settings.zh-CN.md)：移除高级身份字段，统一模型、推理、Provider 和环境变量，保留失败重试边界。

[Agent 资料编辑样式](./audits/2026-09-18-agent-profile-field-ui.zh-CN.md)：名称、描述输入框与紧凑操作按钮对齐 Raft，描述框自动高度且不可拖拽；头像上传采用 Raft upload 图标，悬停只变边框。

[归档确认弹窗统一](./audits/2026-09-18-archive-dialog-parity.zh-CN.md)：侧栏和频道设置共用 Raft 风格确认框，含桌面和移动尺寸验证。

[Tab 内容留白与正文提及对齐](./audits/2026-09-18-tab-spacing-and-mention-alignment.zh-CN.md)：移除 Agent tab 固定宽度，测量共享 tab 左右留白，核对黄色提及的 Raft 行内规则。

[设置与 Agent 动态修复](./audits/2026-09-18-settings-activity-repair.zh-CN.md)：文件反选、独立外观卡片、开关命中、已归档频道与动态展示规则；区分 Raft 1.16.0 证据及本地历史分页扩展。

[UI 改造提交边界](./audits/2026-09-18-ui-commit-scope.zh-CN.md)：从 rc.1 分离界面改造，文件引用配套纳入，Stop 与后台审计补强保留未提交。

[Agent Council 持续暂停](./audits/2026-09-18-council-persistent-pause.zh-CN.md)：明确暂停可覆盖 Composer 自动恢复，旧请求、新消息和任务通知不能解除持久停止围栏。

[移动附件菜单连续打开](./audits/2026-09-18-native-upload-reopen.zh-CN.md)：以真实触摸替代鼠标式验证，原生 input 直接接收触摸，覆盖连续取消及重新选择。

[文件引用窗口共享样式](./audits/2026-09-18-file-dialog-chrome.zh-CN.md)：标题栏、关闭按钮和确认按钮复用 Task 弹窗及 UI 库规则，覆盖桌面和移动端 portal。

[运行超时与隔离撤销](./audits/2026-09-18-runtime-timeout-and-quarantine.zh-CN.md)：对照 Raft 的存活判定，避免固定总时长反复杀死活进程；人工停止可撤销已确认终止的隔离执行，保留消息与审计事实。

[Kimi K3 跨 CLI 实测](./audits/2026-09-18-k3-transport-benchmark.zh-CN.md)：官方 K3/high 在 OpenCode 与 Kimi CLI 的原生、恢复和 RAH 私聊对照；两条接入路径仍有共同模型往返，不能把功能通过当作性能闭合。

[延迟 P0 第一批修复](./audits/2026-09-18-latency-p0-repair.zh-CN.md)：启动读取聚合、Kimi 恢复去重、Placement 停止围栏与 Codex 原生错误传播；三家真实业务门禁通过，Kimi 长尾、原生生命周期和 Codex 服务阻塞仍明确未闭合。

[侧栏偏好与 Composer 入口](./audits/2026-09-18-sidebar-and-composer-controls.zh-CN.md)：隐藏空分组开关、展开选择、移动动态浮条、文件引用与上传入口；修正隔离执行误拦截重启，已完成正式部署与浏览器验证。

[PWA 顶部背景延伸](./audits/2026-09-17-pwa-status-edge.zh-CN.md)：外壳内背景位于标题控件下层，布局只避让系统安全区；撤销高层覆盖与人为最小留白，真机验收边界单列。

[Composer 引用窗口与菜单定位](./audits/2026-09-17-composer-reference-navigation.zh-CN.md)：菜单脱离加号动画、用户目录起点与向上导航、取消目录根选择、共享配色与工作区隔离。

[Room 成员头像尺寸修复](./audits/2026-09-17-room-member-avatar-size.zh-CN.md)：修正用户头像使用 compact 并嵌套橙色外框的问题，统一为 36px 共享头像。

[Agent 工作区界面收缩](./audits/2026-09-17-agent-workspace-surface.zh-CN.md)：移除运行项目根、说明页脚和独立记忆管理；按 Raft 1.16.0 对齐树、标题及空态样式。

[Composer 文件引用与停止](./design/composer-controls.md)：单加号、本机路径与设备上传、Room/私聊/消息列共享停止状态、终止证明与修正消息恢复；源码依据、边界和验收入口。

[Composer 控件验收](./audits/2026-09-17-composer-controls.zh-CN.md)：连续停止的启动竞态与 Host 恢复收口、桌面／窄屏真实浏览器与上传回归，正式部署证据。

[交付与 OpenCode 长请求修复](./audits/2026-09-17-reply-delivery-and-opencode-timeout-repair.zh-CN.md)：对照 Raft Computer 1.0.32，修复 message-check 已交付消息被重复 hold 与长请求底层五分钟超时；验证及部署状态以文中记录为准。

[正式频道双边短问答验收](./audits/2026-09-17-bilateral-reply-latency-acceptance.zh-CN.md)：三轮真实问答的正式回复、耗时区间与答案；记录 Raft Codex 配额阻塞、现有模型差异和额外激活成本，不等同于同模型性能基准。

[本机 CLI、私聊与双边频道延迟](./audits/2026-09-17-native-cli-dm-and-channel-latency.zh-CN.md)：四个 CLI 对同模型 RAH 私聊，两 Agent 频道对 Raft；记录 Codex 750.748 秒迟到回复、阶段耗时、双边回复人数与采样边界。

[延迟根因与修复顺序](./audits/2026-09-17-latency-root-causes.zh-CN.md)：原生 usage 证实的大上下文、Kimi 逐轮重复长期规则、工具往返、停止后旧激活重跑与频道收尾；更正 Codex D2 的 89.641 秒排队归因，保留供应商长尾的证据边界。

[Provider Session 连续性与 Raft 生命周期](./audits/2026-09-17-provider-session-lifecycle-parity.zh-CN.md)：区分已实现的会话恢复与尚缺失的常驻实例；定位有限 Run/进程终止耦合、首次中断恢复边界及 Kimi/Claude 差异，明确不能用清空有价值上下文或文件记忆替代原生 Session。

[all 频道回复与延迟调查](./audits/2026-09-17-all-channel-reply-latency.zh-CN.md)：修复前正式发帖与暂存草稿时间线、隔离复现、OpenCode 网络与恢复耗时；后续实测见上述双边短问答验收，同条件性能对照仍未完成。

[付费 CLI 与 iPhone 键盘验收](./audits/2026-09-17-paid-cli-and-iphone-acceptance.zh-CN.md)：Claude、Kimi、OpenCode 联合门禁通过；Codex 未登录返回 401，iPhone 尚未连接，分别保留待验收状态。

[批次 A/B 接手收口](./audits/2026-09-17-ab-takeover-closure.zh-CN.md)：终止证明收口 orphaned RunAttempt、限定历史 schema 差异、收紧恢复证明、停机前副本预检；修复验收与部署记录集中在此。

[rc.1 修复与补强施工指南](./product/2026-09-16-rc-repair-and-hardening-guide.zh-CN.md)：分批工作单，包含 owner、失败测试、产品边界、正式重启及验收要求；A/B 已实施并接手复核，C/D 未启动。

[rc.1 审计复核与最新 Raft 差异](./audits/2026-09-16-rc1-audit-and-latest-raft.zh-CN.md)：区分 Web 1.16.0 与 Computer 1.0.32，核对 1.0.18 基线，记录真实缺陷、用户决定及按 owner 划分的修复顺序。

[批次 A / R1：CI 浏览器依赖顺序](./audits/2026-09-16-r1-ci-browser-order.zh-CN.md)：Playwright chromium/firefox/webkit 与 chrome 通道在 `npm run check` 之前安装并按锁文件缓存；新增 workflow 顺序不变量测试并接入 `check`；接入移动导航、消息菜单/选择、任务筛选、滚动所有权、侧栏触摸六个门禁。本机通过，远端 CI 待推送后验证。

[批次 A / R2：Tailnet 与普通 LAN 信任分离](./audits/2026-09-16-r2-tailnet-lan-trust-separation.zh-CN.md)：删除按网卡自动扩大监听的推导，普通 LAN 受信入口改为显式 `RAH_TRUSTED_LAN_HOSTS`；启动收据对已授权入口具权威性，重启回放同一集合，损坏收据 fail-closed。保留 Tailnet HTTP 无 token 的产品决定；LAN 入口信任级别待用户裁决，裁决前保持现状。

[批次 A / R3：事件查询热点](./audits/2026-09-16-r3-event-query-hotspot.zh-CN.md)：为 `agent.deletion_requested` 增加两条部分索引，删除协调每秒查询与 Worker 授权围栏不再全表扫描；200k 事件实测计划前后对比，DB 体积零增长；迁移保护限于本次索引（幂等、旧库补齐、失败可重试）。

[批次 A / R4：产品 release identity 与文档一致性](./audits/2026-09-16-r4-release-identity.zh-CN.md)：单一 release version 输入，构建时固化 commit/build identity，供 Settings、health、`agent_hosts.build_version` 与制品共用；缺版本拒绝正式构建，开发构建明确标 development；ADR-0029 决策 4 标注被 2026-09-14 Human 任务编辑合同取代。下一个版本号未定。

[批次 B / R5：Agent 删除阻塞诊断](./audits/2026-09-16-r5-agent-deletion-diagnostics.zh-CN.md)：阻塞诊断、只读 API/SDK、删除对话框与状态变化上报。原报告所列 orphaned RunAttempt 恢复缺口由 09-17 接手收口修复，不增加强制删除。

[批次 B / R6：升级迁移保护](./audits/2026-09-16-r6-upgrade-migration-protection.zh-CN.md)：只读 `inspectSchemaState` 识别待迁移项;有变化才建独占校验快照,快照失败即拒绝迁移;`initialize()` 重组为命名 unit,可事务 DDL 合并进单个 `BEGIN IMMEDIATE` 并与 `user_version` 同事务提交,external 步骤留 journal;online backup 逻辑移入 daemon 包;`verifyCanonicalState` 不再二次 initialize;恢复只经显式确认且证明无新写入。

[批次 B / R7：旧 all 频道升级预检](./audits/2026-09-16-r7-legacy-all-channel-precheck.zh-CN.md)：按 Workspace 只读读取候选(绕开成员过滤),状态 missing/name_drift 自动恢复,archived/private/ambiguous fail closed 带结构化诊断与恢复选项;Human 成员缺失只报告。

[批次 B / R8：子进程环境定向隔离](./audits/2026-09-16-r8-child-environment-isolation.zh-CN.md)：新增 `launch-environment-policy.ts` 单一 owner,继承层按 `RAH_` 前缀剔除,身份围栏不可覆盖,direct 与 supervised 共用;保留 HOME、PATH、Provider 配置目录、代理与证书变量。这是环境卫生,不是 OS 沙箱。

[批次 B / R9：前端错误边界与 iOS 键盘](./audits/2026-09-16-r9-error-boundary-and-ios-keyboard.zh-CN.md)：`SurfaceErrorBoundary` 包裹整个 App 与九个页面区域,正常时透明,故障时脱敏诊断 + 重试/重载,不持有消息/草稿/选择状态;iOS 键盘只加 `?rahViewportDebug=1` 诊断钩子与实机验收脚本,未改 viewport/scroll owner,待实机验收。

[滚动所有者排查与工具栏覆盖](./audits/2026-09-16-scroll-owner-audit.zh-CN.md)：慢历史请求、搜索重复定位、活动尾随和关闭焦点恢复；三个任务入口的 Web/PWA 留白实测。

[任务触摸滚动与工具栏留白](./audits/2026-09-16-task-scroll-and-toolbar-insets.zh-CN.md)：修复原生滚动与刷新交错时锚点回拉，移动任务工具栏上下留白统一。

[首页与复制文本细化](./audits/2026-09-15-sidebar-copy-home-refinement.zh-CN.md)：当前 Raft 全选图标、按下保留粗阴影、手机条目节距、首页刷新与可局部选择文本区。

[聊天列表默认折叠与移动密度](./audits/2026-09-15-sidebar-defaults-touch-density.zh-CN.md)：空/非空分组默认状态、容器级触摸防选择与移动端间距压缩。

[消息菜单矩阵与 PWA 选择条间距](./audits/2026-09-15-message-menu-matrix.zh-CN.md)：按频道、私聊、母消息、回复和任务状态核对条件，已关闭任务操作对齐与触摸按钮阴影净空。

[聊天列表间距与操作图标](./audits/2026-09-15-sidebar-spacing-and-actions.zh-CN.md)：分组外边距合并、空置顶高度与无文字图标按钮偏移的根因修复，源码字号和间距验收。

[任务多选、共享间距与筛选生命周期](./audits/2026-09-15-task-filter-scope.zh-CN.md)。

[菜单与选择条细化](./audits/2026-09-15-message-selection-refinement.zh-CN.md)：任务操作独立分组、按钮源参数和逐项紧凑、可见消息页选择归属、预览等距留白。

[消息长按、文本选择与本地图片预览](./audits/2026-09-15-message-touch-selection-export.zh-CN.md)：PWA 无消息黑框、菜单和母消息转换、黄色多选条、审批属性换行、已完成任务静默重开。

[PWA 任务筛选间距与关闭边框](./audits/2026-09-15-pwa-task-filter-spacing.zh-CN.md)。

[聊天审批与阅读位置修复](./audits/2026-09-15-chat-approval-reading-position.zh-CN.md)：PWA 精简审批弹窗、人员资料返回与头像反馈。

[PWA 首次点击与列表可见选中态](./audits/2026-09-15-pwa-first-tap-and-visible-selection.zh-CN.md)。

[任务弹窗、创建与消息操作条](./audits/2026-09-15-task-presentation-and-message-actions.zh-CN.md)。

[任务卡片触摸滚动与频道单行工具栏](./audits/2026-09-15-task-touch-and-compact-toolbar.zh-CN.md)。

[PWA 底栏、铃铛、任务空结果与标题尺寸续修](./audits/2026-09-15-pwa-navigation-and-task-stability.zh-CN.md)。

[PWA 网络入口重启恢复](./audits/2026-09-14-pwa-network-restart-recovery.zh-CN.md)：修复正式重启丢失 Tailnet/LAN 模式；启动收据与原网络入口验收。

[移动端 iOS 风格根导航](./audits/2026-09-14-mobile-ios-tab-navigation.zh-CN.md)：按用户最新决定撤回左侧抽屉，改为根页面悬浮四项底栏；首页入口、任务移动布局及聚焦防放大。

- [PWA 标题栏密度与导航状态修正](audits/2026-09-14-mobile-header-density.zh-CN.md)

[Agent候选行共享组件与门禁](./audits/2026-09-14-choice-row-code-contract.zh-CN.md)：四类typed配置、现有调用迁移、局部样式越界检查及双浏览器状态验收。

[移动主页与长按菜单稳定性](./audits/2026-09-14-mobile-home-context-menu-stability.zh-CN.md)：触摸菜单固定与防点击穿透、返回列表逐帧无粉色、共用工作区标题及快捷入口收敛。

[聊天列表触摸与移动导航](./audits/2026-09-14-sidebar-touch-and-mobile-navigation.zh-CN.md)：长按不选字、不误导航，触摸滚动优先、停用手指拖动排序；底栏改抽屉的取舍与设备验收边界。

[移动端主导航抽屉](./audits/2026-09-14-mobile-navigation-drawer.zh-CN.md)：取消底栏占位，所有移动页面保留左上角导航入口，共用桌面导航动作。

[聊天侧栏分组与归属](./audits/2026-09-14-sidebar-groups.zh-CN.md)：分组间距、空分区、编辑图标、拖动顺序与会话单一归属。

[搜索预览分栏与清理](./audits/2026-09-14-search-preview-layout.zh-CN.md)：可拖动分栏、私聊/任务统一预览、关闭返回、离开清空、摘要hover与标签字体。

[Task回复提示字号](./audits/2026-09-14-task-reply-heading-type.zh-CN.md)：回复开头与数量按Raft源码统一12px/16px。

[搜索跳转关键词](./audits/2026-09-14-search-destination-keywords.zh-CN.md)：补齐目标正文黄色关键词，保留点击同时清除蓝黄及滚动保留规则。

[Agent候选行颜色约定](./audits/2026-09-14-agent-choice-hover-contract.zh-CN.md)：反证“弹窗明黄、基础页浅黄”；统一颜色档位、交互状态和四类组件配置，禁止每个窗口自行调色，区分设计约束与代码迁移。

[新建分区弹窗对齐](./audits/2026-09-14-section-create-dialog-parity.zh-CN.md)：紧凑卡片、表情选择与持久化、独立弹窗层和移动布局；原生表情修复正式CSP下外部图源不可用。

[创建频道弹窗对齐](./audits/2026-09-14-channel-create-dialog-parity.zh-CN.md)：统一加号/右键入口的卡片、字段、成员列表及按钮规格。

[各页面当前用户身份](./audits/2026-09-14-current-human-identity-surfaces.zh-CN.md)：正文、回复预览、评论、动态、搜索、收藏和转发使用当前显示名称与头像。

[Room／私聊两页布局](./audits/2026-09-14-two-page-conversation-layout.zh-CN.md)：按点击来源替换消息列和人员页，窄屏优先新页面，设置与Task覆盖层独立。

[文件评论用户提及](./audits/2026-09-14-file-comment-plain-mentions.zh-CN.md)：取消当前用户提及黄底，普通聊天高亮及动态名称不变。

[运行时切换真实实验](./audits/2026-09-14-runtime-switch-real-evidence.zh-CN.md)：同Agent/Room的Opus High→Sonnet Low→Codex Luna Low，原生历史核验。

[文件评论上下文精简](./audits/2026-09-14-file-comment-context-presentation.zh-CN.md)：聊天区分评论/回复，侧栏移除重复文件名和发送成功文字，分析回复关联边界。

[Task 弹窗操作历史](./audits/2026-09-14-task-detail-operation-history.zh-CN.md)：默认最新回复、操作时间线与频道成员负责人候选。

[文件评论输入区精简](./audits/2026-09-14-comment-composer-remove-discussion-link.zh-CN.md)：移除打开讨论，×关闭预览保留原页面。

[全局动态显示名称](./audits/2026-09-14-activity-display-names.zh-CN.md)：卡片作者、摘要和消息列标题中的Human提及随显示名称更新。

[Agent悬浮卡与动态入口](./audits/2026-09-14-agent-hover-activity-entry.zh-CN.md)：移除描述行，最近动态可点击并打开右侧动态页。

[文件评论身份与引用层级](./audits/2026-09-14-file-comment-identity-and-location.zh-CN.md)：动态显示名称、文件标签与章节定位分层。

[文件评论时间顺序](./audits/2026-09-14-file-comment-chronology.zh-CN.md)：取消文件位置分组，改为时间升序及同时间Room序号。

[紧凑聊天模型标识](./audits/2026-09-14-compact-chat-model-identifiers.zh-CN.md)：统一provider/model_id，缺省provider时仅显示模型ID。

[成员整行光标与头像悬停](./audits/2026-09-14-member-pointer-avatar-hover.zh-CN.md)：可点击成员行手型、头像90%亮度及移走恢复。

[聊天与评论输入框自动增高](./audits/2026-09-14-composer-autosize.zh-CN.md)：共用Raft文字区规格，自动增高至128px后内部滚动，取消手工拖拽。

[聊天提及动态显示名称](./audits/2026-09-14-mention-display-names.zh-CN.md)：按当前身份显示名称渲染旧消息提及，保持原文和底层用户名。

[Markdown报告纸张与大纲](./audits/2026-09-14-markdown-paper-and-outline.zh-CN.md)：2px边框、4px硬阴影，以及1280px大纲断点与80px吸顶。

[预览评论按钮图标](./audits/2026-09-14-preview-comment-toggle-icon.zh-CN.md)：从 Raft 提取气泡内三点图标，复用于预览工具栏。

[Human任务自由编辑](./audits/2026-09-14-human-task-edit-parity.zh-CN.md)：后端五状态切换、各状态负责人修改、旧执行隔离与共享前端菜单。

[文件评论数与引用图标](./audits/2026-09-14-file-comment-count-and-glyph.zh-CN.md)：按附件统计、发表评论后更新及Raft file-text图标。

[消息定位蓝色选中态](./audits/2026-09-14-message-location-focus.zh-CN.md)：共享频道、消息列与搜索定位样式，移除成功横幅。

[聊天模型的 Provider 标识](./audits/2026-09-14-chat-model-provider-labels.zh-CN.md)：OpenCode 同名模型区分，正文与运行时配置共用标签。

[聊天日期标识与跨日更新](./audits/2026-09-14-chat-calendar-timestamps.zh-CN.md)：Room/私聊今天仅时间、昨天和历史日期，以及共享午夜更新。

[提及标签与关注控件](./audits/2026-09-14-mention-and-thread-follow-controls.zh-CN.md)：加粗AGENT、隐藏0入口、移除关注确认；关闭/返回按钮遵循最新响应式布局合同。

[消息列与资料页空间分配、搜索对齐](./audits/2026-09-14-thread-inspector-search-parity.zh-CN.md)：内缩圆角关注行、并列布局、搜索框及蓝底选中。

[成员悬停、移除确认与权限差异](./audits/2026-09-14-room-member-removal-parity.zh-CN.md)：修正重复透明度、按钮规格，并验证成员移除后的通知与历史边界。

[系统频道实时显示与操作字号](./audits/2026-09-14-system-channel-live-visibility.zh-CN.md)：隐藏/恢复后刷新目录，核验动态过滤和历史恢复。

[系统频道保存按钮尺寸](./audits/2026-09-14-system-channel-save-size.zh-CN.md)：Raft 12px 字号、32px 按钮高度。

- [消息附件卡片与文件评论（2026-09-14）](audits/2026-09-14-message-artifact-cards-and-comments.zh-CN.md)

[快速模式卡片与配置生效时点](./audits/2026-09-14-runtime-fast-mode-and-apply-timing.zh-CN.md)：整卡切换、黄色勾选及保存/调度/当前执行的源码边界。

[任务标识状态颜色同步](./audits/2026-09-14-task-reference-colors.zh-CN.md)：聊天、正文引用、动态复用当前任务状态配色。

[技能目录分组标签](./audits/2026-09-14-skill-directory-groups.zh-CN.md)：Raft浅黄色目录标识、Codex显示别名与工作区空状态。

[运行时配置编辑图标悬停](./audits/2026-09-14-runtime-edit-hover.zh-CN.md)：仅改变图标颜色，移除灰色底。

[聊天任务标识与任务详情弹窗](./audits/2026-09-14-chat-task-modal.zh-CN.md)：共享状态、负责人、历史和持久回复，保留频道背景。

[外观设置显示 Agent 模型](./audits/2026-09-14-agent-model-appearance.zh-CN.md)：本设备开关、即时预览和聊天目录模型投影。

- [添加环境变量按钮悬停对齐](audits/2026-09-13-runtime-add-variable-hover.zh-CN.md)

[服务日志轮转与 Guide/升级/登录恢复澄清](audits/2026-09-13-service-log-rotation.zh-CN.md)：Raft 启动前 64MiB/跨日轮转，14 天保留及新句柄接线。

[关系图头像与图标](./audits/2026-09-13-member-graph-avatar-icons.zh-CN.md)：移除节点强制蓝底，复用真实头像配色；页头、关系计数和侧栏采用 Raft git-branch 图标。

[Agent 一次确认删除与弹窗规格](./audits/2026-09-13-agent-deletion-cascade.zh-CN.md)：持久停止请求、终止证明后清理、失败恢复及 Raft 确认框动态状态。

[删除 Agent 与服务重启确认](./audits/2026-09-13-agent-delete-and-service-confirmation.zh-CN.md)：384px 确认规格、资料 SVG 关闭按钮、服务确认及灰色右侧状态提示。

[Raft Computer 1.0.18 → 1.0.31 累计差异与复用优先级](audits/2026-09-13-raft-computer-1.0.31-source-review.zh-CN.md)：源码复核及环境变量编辑器字体修正。

[正文引用标识规格与控制语义](./audits/2026-09-13-inline-reference-parity-and-control-semantics.zh-CN.md)：Raft 实际消息 CSS、几何回归与 Agent/频道停止、重启、重置、删除的区别。

[Agent 环境变量与聊天任务开关收口](audits/2026-09-13-agent-environment-only.zh-CN.md)：仅环境变量、统一保存、移除聊天任务负责人区域。

[环境变量与 CLI 参数研究](./audits/2026-09-13-agent-runtime-options-research.zh-CN.md)：Raft envVars、四种 CLI 差异、现有支持边界和分层建议；管理卡片默认展开。

[Agent 目录断网恢复](./audits/2026-09-13-agent-directory-network-recovery.zh-CN.md)：修复短暂网络错误后 Agent 列表清空且不恢复。

[Provider 启动配置只读](./audits/2026-09-13-provider-settings-readonly.zh-CN.md)：撤销全局启动追加配置，保留 Agent 独立配置和忙时投递开关。

[成员资料入口边界](./audits/2026-09-13-member-profile-entry-boundary.zh-CN.md)：聊天头像用右侧面板，成员页 Human/Agent 在主内容区切换，刷新与后退保持。

[动态时间与按钮互换](./audits/2026-09-13-activity-timestamp-action-swap.zh-CN.md)：更新 Raft Web 基线，时间右锚点 14px，悬停/聚焦时与处理按钮互换。

[#all 固定成员规则](./audits/2026-09-13-all-channel-membership.zh-CN.md)：Kernel 自动成员、启动补齐与增删入口关闭。

[文件预览评论入口](./audits/2026-09-13-file-preview-comment-entry.zh-CN.md)：按原消息上下文与文件类型控制评论，保留原权限和评论服务。

[成员右键停止弹窗](./audits/2026-09-13-member-stop-confirmation.zh-CN.md)：核对 Raft zi 入口并修复宽度、X、按钮、标题线和文案。

[Agent 启动配置与频道弹窗对齐](./audits/2026-09-13-agent-launch-channel-dialog-parity.zh-CN.md)：全局/Agent 环境和参数继承、冲突拒绝及 Raft zi 布局证据。

- [Computer 控件与侧栏对齐](audits/2026-09-13-computer-controls-and-sidebar-parity.zh-CN.md)
- [Raft Computer 1.0.31 源码更新核验](audits/2026-09-13-raft-computer-1.0.31-source-review.zh-CN.md)

[Computer 批量重启弹窗](./audits/2026-09-13-computer-batch-restart-dialog.zh-CN.md)：修正文案及误用单Agent小按钮的尺寸。

[动态时间锚点核查与窄屏修复](./audits/2026-09-13-activity-time-anchor.zh-CN.md)：旧构建的56px证据已失效，当前以顶部的新版时间/按钮互换记录为准。

[成员详情与模型目录修复](./audits/2026-09-13-member-runtime-detail-parity.zh-CN.md)：Human 侧栏、排行与列表参数、模型提供商、显式刷新及快速模式。

- [截图 UI 修复与部署边界](audits/2026-09-12-screenshot-ui-closure.zh-CN.md)
  [停用浏览器 token 与 HTTPS 门槛](audits/2026-09-12-trusted-network-access.zh-CN.md)：Tailnet 入口不校验浏览器 token/cookie，错误重连不退回登录表单。

[移动端常驻导航与任务布局](audits/2026-09-12-mobile-navigation-and-task-layout.zh-CN.md)：底栏统一占位、容器宽度决定默认任务视图、引用基线修复。

[Computer 选择栏与分割线收口](audits/2026-09-12-computer-selection-toolbar-refinement.zh-CN.md)：选择模式标题操作、28px批量按钮、持续选中阴影与内缩分割线。

[成员侧栏与运行时表单收口](audits/2026-09-12-member-profile-cleanup.zh-CN.md)：精简入口，Human 页面复用 Agent 侧栏，明确选模与常显推理强度。

- [动态全部已读按钮尺寸](audits/2026-09-12-activity-read-all-size.zh-CN.md)
- [Search 首页与结果卡片修复](audits/2026-09-12-search-home-result-parity.zh-CN.md)

[Room 与消息列响应式](./audits/2026-09-11-conversation-responsive-parity.zh-CN.md)：实景680px容器/768px窄屏切换，消除半遮挡及根消息多余8px留白。

[Tooltip 零延迟与页内操作指南](audits/2026-09-11-tooltip-delay-and-inline-help.zh-CN.md)：核对 Raft 根 Provider 的 0ms 设置；问号直达指南，不再使用资源浮窗。

[Worker 自动确认与重放实施](./audits/2026-09-11-worker-message-check-implementation.zh-CN.md)：工具负责 ACK，原交付窗口支持新 Run 与服务重启恢复；[Task 批次合同](./audits/2026-09-11-task-batch-contract-closure.zh-CN.md)完成批量子项；[Task 状态统一入口](./audits/2026-09-11-task-status-facade.zh-CN.md)已接线五态，明确 Human 对话批准约定及本地 reviewer/本人任务边界；部署结果见该文。

[Agent 私有默认 cwd 方案](./audits/2026-09-11-agent-private-cwd-plan.zh-CN.md)：施工前源码对照与设计；当前见[私有 cwd 实施记录](./audits/2026-09-11-agent-private-cwd-implementation.zh-CN.md)，尚待主任务全量验收与部署。

[Codex 原生忙时投递](./audits/2026-09-11-codex-native-busy-delivery.zh-CN.md)：当前运行内原回复与追加均落账；Claude/Kimi、后续空运行抑制及严格双边组合仍待收口。

[原生忙时投递施工边界](./audits/2026-09-11-native-busy-delivery-construction.zh-CN.md)：核实当前关闭输入的两条路径，按 Kernel→Host→supervisor→Codex 原生 steer 逐层施工，尚未实现。

[Worker 成员角色显示修复](./audits/2026-09-11-worker-roster-role-repair.zh-CN.md)：room-members/server-info 使用同一 canonical Membership 显示 Room 角色，缺字段不猜权限。

[Task 选择的双边根因实验](./audits/2026-09-11-task-choice-bilateral-root-cause.zh-CN.md)：Raft Codex 同样认领并转 Thread；两侧核验 owner 后显式豁免均直接回复，纠正将 Task 路由当作 RAH 独有串线的判断。

[多 Agent 重复寻址验证](./audits/2026-09-11-target-repeated-verification.zh-CN.md)：OpenCode 四轮与 Codex 纯聊天通过，但两个新 Codex 在实际工作时转入 Task Thread，目标阶段尚未签收。

[核心组合验收](./audits/2026-09-11-core-combination-verification.zh-CN.md)：双Thread、新provider会话记忆与配置恢复；明确区分原失败、独立续验和双边条件限制。

[忙时追加延迟根因](./audits/2026-09-11-busy-latency-root-cause.zh-CN.md)：132秒等待旧运行退出，启动不到1秒；收件箱同步后再次hold已复现，但官网有同类反例，撤回直接判缺陷；忙时投递尚未修复。

[同模型双边验证进展](./audits/2026-09-11-bilateral-matched-runtime-progress.zh-CN.md)：记录配置不匹配的无效样本及双提及条件修正，未冒充完整验收。

[Runtime双边源码预检](./audits/2026-09-11-runtime-bilateral-preflight.zh-CN.md)：逐CLI区分常驻、恢复与投递，包含实际模型/effort反证。

[侧栏共享tooltip](./audits/2026-09-11-shared-rail-tooltip.zh-CN.md)：以Raft zi/Bc/JLe参数替换共享RailButton的原生title，保留帮助菜单及既有点击行为。

[返工与忙时追加验收](./audits/2026-09-11-rework-and-busy-dialogue-acceptance.zh-CN.md)：先验证错误交付经独立审计、返工、再审，再在修复中追加消息。

[双边续验与多轮对话](./audits/2026-09-10-bilateral-and-multiround-acceptance.zh-CN.md)：三轮真实执行/审计无Human催促达到目标并停止；区分追加、返工及官网待验边界。

[Human 消息头像尺寸修复](./audits/2026-09-10-human-message-avatar-size.zh-CN.md)：修复字母头像误用侧栏尺寸，消息 Human／Agent 共用 36px；含浏览器回归。

# RAH OS 文档

[Agent 弹窗续批](./audits/2026-09-10-agent-dialog-visual-closure.zh-CN.md)：以正确 Aet/Si 和字段 token 来源修复重置几何与创建字体。

[前端续批修复](./audits/2026-09-10-frontend-second-repair.zh-CN.md)：频道入口、Settings 和 Reminder，明确 Task 与弹窗剩余边界。

[前端首批差异修复](./audits/2026-09-10-frontend-first-repair.zh-CN.md)：关系图、动态、身份展示、Agent 与 Thread；记录尚未签收项。

Task 状态设置器映射：[五个状态逐条对照；`in_review` 唯一可确定并已补齐，其余有反例挡住推断](./audits/2026-09-10-task-status-setter-mapping.zh-CN.md)。

频道能力范围裁决：[上游支持什么、RAH 已有什么、当前范围要什么；并记下本轮被推翻的推论](./audits/2026-09-10-channel-capability-scope-adjudication.zh-CN.md)。

核心链验收第 2 次真实运行：[场景二三四五通过（场景一未重跑、正式实例不在范围）；并发生效，配置切换在账本与进程两层证实](./audits/2026-09-10-core-chain-acceptance-run-2.zh-CN.md)。

多 Agent 运行串行取证：[工作区独占租约，与 Raft 的真实分歧，待裁决](./audits/2026-09-10-agent-run-serialization.zh-CN.md)。

核心链验收第 1 次真实运行：[跨 Room、私聊延续、记忆正反对照通过；配置切换因预算未成立](./audits/2026-09-10-core-chain-acceptance-run-1.zh-CN.md)。

核心链验收协议：[五个场景、59 个观察点与证据来源](./product/core-chain-acceptance-protocol.zh-CN.md)。

Raft 对齐工程：[三份盘点、构建时对齐检查与九批收敛记录](./audits/2026-09-09-raft-parity-alignment-program.zh-CN.md)。

重复唤醒收口：[把"已呈现"事实写进 Worker 投递，真实模型第二次唤醒推理步数 23→2](./audits/2026-09-09-presented-context-duplicate-wake.zh-CN.md)。

发送工具合同结构性移植：[目标寻址、服务端已读位置与按目标草稿恢复，模型不再搬运游标／回执／幂等键／草稿 ID](./audits/2026-09-09-raft-send-facade-structural-port.zh-CN.md)。

最新上游核实：[Raft 当前版本、完整 Agent prompt 与工具合同重新取证](./audits/2026-09-09-raft-upstream-prompt-tool-refresh.zh-CN.md)。稳定版仍为 1.0.18；同版本更新未完成但原服务健康。工具状态管理与 Runtime 通知差异是下一施工依据，不能继续仅补 prompt。

当前修复：[忙时追加消息与原草稿恢复](./audits/2026-09-09-busy-held-send-repair.zh-CN.md)：恢复机制已补齐，明确追加的真实实验通过；原措辞仍漏原回复，整项未签收。

冻结验收：[四类核心验证与忙时原回复阻塞](./audits/2026-09-08-frozen-core-four-class-acceptance.zh-CN.md)。产品 commit `09a244c`；真实模型、记忆、三轮协作、Thread 实时更新及一次执行中恢复通过。忙时 held draft 三次漏原回复，Raft 实景可恢复，尚不能全部签收。

当前修复：[HTML 跨段落引用与回跳](./audits/2026-09-08-html-region-repair.zh-CN.md)。

最新核实：[HTML 跨段落引用与发布后回跳](./audits/2026-09-08-html-region-official-verification.zh-CN.md)。官网有效矩形、刷新与回跳已实证；本地取文、定位和高亮仍有明确差异。

当前纠偏：[移动折叠、HTML 区域、本地分页与用量接线梳理](./audits/2026-09-08-four-corrections-closure.zh-CN.md)。第四项是方案完成，运行器账户用量尚未上线。

- [打开中的 Thread 实时更新修复](audits/2026-09-08-thread-live-repair.zh-CN.md)

最新核实：[HTML 区域、移动评论折叠、分页与运行器用量的官网实操](./audits/2026-09-08-raft-remaining-live-confirmation.zh-CN.md)。修正“拖动手势”和“Raft 分页缺口”的表述；区分运行器用量与中央订阅。

当前修复：[执行中恢复围栏、后台失败传播与真实原现场复验](./audits/2026-09-08-core-recovery-repair.zh-CN.md)。上一轮 R0908 恢复阻塞已修复，其他核心旅程边界仍分项保留。

真实核心旅程：[多 Agent Room、双 Thread、跨 Room／DM 记忆、更正召回与实际 CLI 参数](./audits/2026-09-08-real-multi-agent-core-journey.zh-CN.md)。逐项区分双边通过、本地通过及仍未签收；不是完整高可用发布结论。

当前续批：[跨目标能力与附件评论前端实施和验收](./audits/2026-09-08-remaining-parity-implementation.zh-CN.md)。Task 删除的 Web 入口按用户要求移入未来待实现。资料字段的唯一 owner 与边界见[Worker 公开资料](./architecture/worker-visible-profile.zh-CN.md)。

当前后端批次：[剩余六组差异的实施、独立审查与分层验收](./audits/2026-09-08-backend-six-gap-closure.zh-CN.md)。以该记录区分已实现、已验证与尚未对齐的参数组合。

前端双边验证：[Raft 官网与本地实例同流程实测对比、差异分类与证据](./audits/2026-09-08-raft-frontend-bilateral-verification.zh-CN.md)；只读验证未改产品，中优先真实分歧 2 项（关系图节点覆盖、语言与区域子集），无高优先项。

上一批交付：[Task 修改、完整历史与上传能力查询及正式重启验收](./audits/2026-09-08-task-amend-upload-capabilities.zh-CN.md)。

前端交付：[Task 弹窗、Search 计数、Computer 标签与底栏偏移修复](./audits/2026-09-08-frontend-parity-repair.zh-CN.md)。

后端原始施工顺序：[八组差异的证据、依赖与验收顺序](./product/2026-09-08-backend-eight-gap-plan.zh-CN.md)。最新实现与剩余边界以本页顶部六组批次验收为准，未通过的官方实验不作为已验证行为。

此前交付：[双轨差异审查、MCP 模块退役及正式重启验收](./audits/2026-09-08-two-track-parity-and-mcp-retirement.zh-CN.md)。

后端对标分析：[raft-computer 1.0.18 SEA 源码逐域对照与后端差距](./audits/2026-09-08-raft-computer-backend-gap-analysis.zh-CN.md)；E0 源码级判定，只发现缺口不关闭缺口。

2026-09-08 产品范围更新：[用户明确移除 RAH 托管 MCP 模块](./product/managed-mcp-retirement.zh-CN.md)；旧清单中的 MCP 配置、分配、调用不再作为复刻缺口，Provider 自有工具与 Room Worker 通信保留。实施及验收以本批交付证据为准。

当前交付：[核实后的 A1/A2/A3/A8 修复、集成门禁与正式重启](audits/2026-09-08-evidence-led-repairs.zh-CN.md)。[后续施工顺序](product/2026-09-08-evidence-led-repair-order.zh-CN.md)；A4/A5/A6/A7 仍待语义裁决或补证。

最新裁决：[八项反例的 Raft 源码核实、官网实操和重新分类](audits/2026-09-08-raft-behavior-revalidation.zh-CN.md)。本地内部缺陷与官方复刻差异分开，部分服务端实验仍待验证。

最新反证审计：[交付后 8 类已复现问题、证据边界与修复顺序](audits/2026-09-08-post-delivery-independent-review.zh-CN.md)。本轮只审计未修复，以下“收口”记录须结合这些重新打开的边界阅读。

当前批次总表：[集成审计、分层验证与前后端剩余差异](audits/2026-09-08-parallel-closure-integration.zh-CN.md)。

当前并行收口：[依赖顺序、产品裁决与验证边界](product/2026-09-08-parallel-closure-plan.zh-CN.md)，
[75 条 Agent API 及表外合同映射](product/raft-agent-api-contract-map.zh-CN.md)。
映射是 `672c596` 基线审计，不把并行实现自动当成验收；最终结果沿下面专项证据更新。

协作正确性修复：[多 Thread 明确寻址、幂等回放、Agent 来源 Task 请求 Human 输入、普通成员读冻结交付与附件](audits/2026-09-08-collaboration-core-closure.zh-CN.md)。

服务重启恢复：[首次状态错误可重试、旧页面回执、后继一次恢复与持续失败清理退出](audits/2026-09-08-computer-recovery-closure.zh-CN.md)。

Worker 基础读工具：[历史定位与冻结分页、成员和公开资料、Task 看板与生命周期历史](audits/2026-09-08-worker-read-tools-closure.zh-CN.md)。

Worker 自身资料：[名称、描述、头像与上传中凭据撤销复验](audits/2026-09-08-worker-self-profile-closure.zh-CN.md)。

任务管理：[闲置任务分配、消息转待办及父任务恢复](audits/2026-09-08-worker-task-management-closure.zh-CN.md)。

讨论附件闭环：[无需 Task 的上传、显式发消息、原字节下载、幂等与执行来源围栏](audits/2026-09-08-worker-discussion-attachments-closure.zh-CN.md)。

Agent／Task 页面：[取消新任务预设角色、直接管理操作及 PWA 图标](audits/2026-09-08-agent-task-pwa-ui-closure.zh-CN.md)。

Agent Skills：[真实全局／工作区技能元信息、目录隔离与双浏览器状态验收](audits/2026-09-08-agent-skills-closure.zh-CN.md)。

官网双边取证：[当前来源冻结、Search 筛选／空态修复与共享图标](audits/2026-09-08-bilateral-search-and-icon-closure.zh-CN.md)。

当前官网源码：[2026-09-08 捕获的 v1.12.0 HTML、公开脚本和样式及哈希](evidence/raft-web-20260908-current/manifest.json)。只用于分析，不替换历史证据来源或进入生产依赖。

监督可见性与 Room 任务默认参与者回退：[工具轨迹标签与脱敏、任意 Room Agent 成员读取 owner 轨迹的基础工具、预设角色回退裁决](audits/2026-09-08-room-task-defaults-and-supervision-visibility.zh-CN.md)。

StandingPromptCompiler：[分层 standing prompt、每次启动由 daemon 编译投递、Provider session 按 prompt 摘要失效](audits/2026-09-08-standing-prompt-compiler.zh-CN.md)。

Agent 协作最小闭环：[同伴消息接单、@mention 寻址、worker task-create 与 Raft 礼仪 prompt 移植，含真实三 CLI 出口链](audits/2026-09-07-agent-collaboration-minimal-loop.zh-CN.md)。

当前状态深度审计：[协作正确性反例、当前门禁失败与收口顺序](audits/2026-09-07-deep-current-state-review.zh-CN.md)。
包含未提交 Kernel 增量；上一批通过记录不能外推到该候选。以下各批保留其原始证据范围。

最新：[Computer 页面逐项对齐](audits/2026-09-07-computer-alignment.zh-CN.md)。

最新：[页面服务重启与官网对照进展](audits/2026-09-07-service-restart.zh-CN.md)。

本轮全面验收：[22 组浏览器门禁、LAN 退出修复与最终对齐边界](./audits/2026-09-07-full-acceptance.zh-CN.md)。

Computer 单机首轮验收：[官网实操、恢复指南修复及服务管理缺口](./audits/2026-09-07-computer-acceptance.zh-CN.md)。

当前范围与阶段：[未来扩展延期、验收驱动收口及尚不能宣称对齐的边界](./audits/2026-09-07-acceptance-scope-decision.zh-CN.md)。

PDF 基本阅读操作：[缩放、页码跳转与布局修复验收](./audits/2026-09-07-pdf-reading-closure.zh-CN.md)。

Computer 三模式批量重启／重置：[按单 Agent 原回执恢复的验收](./audits/2026-09-07-computer-bulk-reset-closure.zh-CN.md)。

附件有界 PDF／音视频预览：[本地生产包与真实浏览器验收](./audits/2026-09-07-media-preview-closure.zh-CN.md)。

最新真实模型与 Computer 补缺：[四家 CLI、冻结 Review 与 Computer 收口](./audits/2026-09-07-real-cli-and-computer-closure.zh-CN.md)。

当前产品范围：**单 Human、多 Agent、本机优先**。多 Human 加入/协作、差异化 Room
浏览与加入权限整体延期为未来备选项目，不再阻塞首版。
[用户范围决定、备选项目与主线施工顺序](./product/single-human-mainline-and-multi-human-backlog.zh-CN.md)。

撤销先前“公开频道未完成不得推进其他页面”的施工锁定。第一至第三项的本地确定性闭环已通过，
第四项已补共享文件菜单、本机 MCP 与帮助反馈，并执行第五项本地门禁；剩余边界见本轮审计，不重建已有后端。

当前五项施工与审计：[本批修复、逐项判定和未收口边界](./audits/2026-09-07-five-item-mainline-audit.zh-CN.md)。

当前第四项续修：[文件预览下载失败反馈与重试](./audits/2026-09-07-file-download-recovery.zh-CN.md)。

当前第四项首个修复：[Agent 预览轨迹更新与验收边界](./audits/2026-09-07-agent-preview-trajectory-refresh.zh-CN.md)。

当前第一至第三项：[本地闭环、Worker 消息能力与验收边界](./audits/2026-09-07-mainline-first-three-closure.zh-CN.md)。

当前执行贯通：[Web 配置到实际子进程与记忆目录连续性](./audits/2026-09-07-runtime-configuration-continuity.zh-CN.md)。

当前续修：[Agent 重启操作回执重试](./audits/2026-09-07-agent-reset-retry.zh-CN.md)。

当前实施方案：[五项依赖、技术 owner 与逐项出口](./product/mainline-implementation-plan.zh-CN.md)。

当前主线交付：[Agent 配置回执修复、验证与剩余边界](./audits/2026-09-07-agent-configure-closure.zh-CN.md)。
本批收口不确定保存的安全重试，Agent 配置到运行入口整体仍在验收中。

上一批公开频道修复保留历史证据与安全回归：
[修复与正式恢复记录](./audits/2026-09-07-public-channel-surfaces-verification.zh-CN.md)。
该报告及[旧续修记录](./audits/2026-09-07-pre-settings-continuation.zh-CN.md)中的继续锁定要求已被本次用户决定取代。

当前逐环节收口：[最新代码审查与单项施工顺序](./audits/2026-09-07-current-parity-closure-review.zh-CN.md)。
前一交付：[媒体／文件双入口与多选输入修复](./audits/2026-09-07-composer-pickers-verification.zh-CN.md)。
前一项[文件拖放子链路](./audits/2026-09-07-composer-drop-verification.zh-CN.md)保持回归；官网完整双边、公开频道与 Agent API 对等仍未收口。

当前公开频道增量：[后端发现与本人加入验证](./audits/2026-09-07-public-channel-discovery-and-join-verification.zh-CN.md)。
该历史批次仅补齐元数据与本人加入；本轮公开正文、前端入口与关注增量见顶部续修报告。

当前 Room / Task 施工：[生命周期导航隔离与任务虚拟窗口](./audits/2026-09-07-room-lifecycle-navigation-verification.zh-CN.md)。
已有 leave/delete 沿用原后端，修复旧回执抢占新位置、设置串页与错误反馈；补齐 Raft 任务虚拟窗口和锚点。公开频道阅读与 UI 加入尚待收口；下述新批次补齐后端发现与本人加入。

当前成员权限修复：[2026-09-07 Human 权限刷新、目录错误与浏览器证据](./audits/2026-09-07-human-membership-authority-verification.zh-CN.md)。
删除一次性 Workspace 角色副本，已有有界成员目录同时驱动管理入口与资料刷新；正式状态以该批交付段为准。

当前前后端缺口与后续施工顺序：[2026-09-06 源码、登记与证据交叉审查](./audits/2026-09-06-current-alignment-and-construction-order.zh-CN.md)。
该审查指出旧行为队列中的已实现误报；后续按成员权限、Room 工作流、文件交付、Agent/Computer、Settings 和设备发布收口，不重建已有核心。

当前接手施工：[通知中心 hover/focus 与证据边界](./audits/2026-09-06-notification-popover-takeover.zh-CN.md)。

当前累计候选的冻结身份、Task 精确重试、有界 Task continuation、84 项机器交付队列、Workspace
切换器完整页面族、双浏览器及正式持久实例证据见
[2026-09-06 累计交付审计](./audits/2026-09-06-task-ledger-behavior-queue-workspace-switcher-delivery.zh-CN.md)。
该报告在既定第三方线程返回前保持“待独立复核”，不把 29 项 verified 外推成全产品完成率。

Task 团队闭环 S1 已有实现和累计验收：Raft 多标题主界面保留，RAH 的负责人、协作者、
审阅者和依赖通过提交前第二阶段写入同一 canonical Task，避免开放 Task 的认领竞态。
[Task 页面族设计](./design/task-page-family.md)及
[2026-09-06 候选验收](./audits/2026-09-06-task-collaboration-entry-verification.zh-CN.md)
分别记录来源边界、TDD、双浏览器依赖结果和完整 Review/Human completion 业务断言；
正式实例恢复与后续证据纠正见顶部接手批次，原报告的待复核状态不代表新批次取得独立审计。2026-09-05 的
[页面族审计](./audits/2026-09-05-task-page-family-verification.zh-CN.md)保留为历史证据。
当前行为登记已经为全部 84 项增加机器可校验的适用性与交付状态；这是当前工作队列，不是完成率。
Workspace 切换器已按冻结 Raft 发布物登记为完整页面族，Chrome/Firefox 覆盖桌面/移动、长名称、
点击/外点/Escape/焦点、排序刷新、合法最近 URL 与独立管理弹窗。Firefox 完整生产 App 另以两个
canonical Workspace 验证：移动选择不恢复桌面 Settings，而进入既有 Home owner；URL 使用 replace，
Back/Forward 与 reload 均回到正确 Workspace/Room。
Room Task continuation 现在是有界窗口而非一次性追加：每 Room 最多保留三个已访问早期页、全局最多八个
Room，普通轮询重读所有保留 cursor 并由 generation/abort fence 拒绝旧 Room 迟到结果。1,001 条 active Task、
旧页状态变化以及服务端接受但客户端响应丢失后的精确幂等重试，均已进入双浏览器/production 门禁。
消息菜单与 Search 异步状态的最新来源裁决、TDD、Chrome/Firefox 和 canonical
副作用证据见[设计](./design/conversation-page-family.md)与
[验收审计](./audits/2026-09-05-conversation-page-family-verification.zh-CN.md)。
共享命名空态、任务筛选身份、Search 零结果和普通消息操作已经通过真实 Chrome/Firefox 的
桌面与 390px 组合矩阵；相同 Raft 页面仍以固定官方来源和同前置浏览器比较为准，不把内部
回归当成官网证明。此前第四批为：[canonical 团队业务闭环验证](./audits/2026-09-05-canonical-team-workflow-verification.zh-CN.md)。
方案审查、必要助手 Task/依赖、冻结提交、独立 reviewer 首版驳回、数据库重开、返工新 revision、
Human 验收和下游唤醒已经在同一事实链闭合。上一批的
[Host 观测冻结证据](./adr/0031-host-observed-frozen-task-delivery-evidence.md)与
[验证审计](./audits/2026-09-05-frozen-task-delivery-evidence-verification.zh-CN.md)仍是交付对象的基础。
producer 验证声明没有被冒充为系统证明；没有足够 Raft 官方来源的系统执行 attestation
仅作为未来可选增强，不新增第二套任务页面。
上一批的有界 Room history 与 10 万事件证据见
[ADR-0030](./adr/0030-bounded-room-history-and-visible-receipts.md)和
[验证审计](./audits/2026-09-05-bounded-room-history-verification.zh-CN.md)。所有与 Raft 相同的页面
仍须继续做同条件 UI/鼠标/键盘/功能双边验收。

当前页面族：[设置正文与表单计划](./design/settings-page-family.md)，
[累计修改独立审计、浏览器与发布证据](./audits/2026-09-05-settings-and-cumulative-audit.md)。
账户、语言与区域、外观、通知、工作区资料及当前成员管理摘要共用内部设置样式 owner；
表单草稿、异步回执与 Human 资料新鲜度接入既有 canonical owner。
12 个 RAH 设置区的导航验收不等于管理/MCP/LAN/资源正文全功能已对标；
当前完整页面族为搜索/任务/消息组合，之后是完整 Human 目录/ACL、Computer 管理与剩余资料能力，系统通知保留设备送达专项验收。

前一页面族：[Agent／Computer 资料与浮窗计划](./design/agent-computer-profile-family.md)，
[本批独立复核、浏览器与发布证据](./audits/2026-09-05-agent-computer-profile-family.md)。
资料分区、绑定信息、浮窗尺寸与读取状态共用内部 owner；不等于所有 Agent tab 或 Computer 管理功能完成。

前一页面族：[Human 页面族计划与边界](./design/human-page-family.md)，
[交付审查](./audits/2026-09-04-human-page-family.md)。成员侧栏、消息头像、提及、
Agent 创建者和关系图共用 Human 入口；本人描述/头像及账户名编辑共用原 Principal owner。
角色、加入时间、创建 Agent 仍来自 canonical 事实，历史只读批次见
[Human 资料与可靠创建关系](./audits/2026-09-04-human-profile-entity-network.md)。
该批不代表全 Raft 页面完全对齐；后续以顶部最新页面族及机器登记的明确范围为准。

前一批：[共享实体卡片与上下文空态验收](./audits/2026-09-04-ui-body-primitives.md)。
Computer/已创建 Agent 卡片与 Search/Agent 动态空态已接入内部组件；
删除旧页面覆盖规则，状态不再由 CLI 可用性推断。完整回归、双浏览器和正式重启后检查通过。
官方动态空态仍只有源码核对，未宣称双边全站一致。

前一批：[UI 契约与实体信息网首批验收](./audits/2026-09-04-ui-entity-integrity.md)。
未定义变量门禁、完整状态点、任务身份菜单及 Computer/浮窗绑定统一入口已落地，
双浏览器与完整回归通过，正式项目已安全重启。后续顺序见
[实体信息网收口计划](./design/ui-entity-network-closure.md)。
不推断 Human 的计算机所有权，也不把局部接线称为完整后端身份 API。

前一批：[Saved/Search 标题与通知读取错误态审查](./audits/2026-09-04-secondary-headers-and-push-state.md)。
Saved/Search 消费共享标题、图标和返回/清空按钮；通知读取失败不再误报 iOS
不支持或设备数为 0，补入只读重试与旧响应隔离。14 个双浏览器场景通过并已正式重启。
该历史批次曾发现 Firefox 订阅读取错误；设备通知合同有后续修复记录。旧状态不代替当前设备验收，也不代表通知送达；
正文组件、完整鼠标状态与新增官网双边覆盖仍待收口。

前一批：[跨页面标题轨道统一与验收](./audits/2026-09-04-shell-header-consolidation.md)。
Room/Settings/Computer/成员导航/Tasks/Activity 标题与移动返回按钮已消费内部库，
官方采样回放及双浏览器正式验收均限于报告列出的状态，不能据此宣称全站一致。

上一批：[UI 自动差异工具与安全发布审查](./audits/2026-09-04-ui-evidence-and-safe-release.md)。
已建立小范围官方采样回放、修正 Tabs 焦点/激活差异，并以失败即停止的保护完成正式重启；
不代表全站或所有鼠标状态一致。可复跑工具与边界见[对比与发布合同](./design/ui-evidence-and-release.md)。

内部前端资源和模板统一入口：[RAH Neo-Brutalist UI（英文）](./design/neo-brutalist-ui.md)，
[资源/组件/模板目录](../packages/ui-tokens/neo-brutalist-library.json)，
[采用与维护决策 ADR 0028](./adr/0028-owned-neo-brutalist-ui-library.md)。
外部 raft-ui 不再是构建、运行或维护依赖；历史快照只作证据。
本批的 TDD、浏览器、正式重启和明确剩余项见
[内部库采用验收](./audits/2026-09-04-neo-brutalist-library-adoption.md)。

当前 UI 来源、owner 与迁移状态只由 [机器行为登记](./product/ui-behavior-registry.json)
及其 [生成索引](./product/raft-behavior-inventory.zh-CN.md) 维护。共享层施工顺序、
TDD 和出口条件见 [UI 收口计划](./architecture/ui-consolidation-plan.zh-CN.md)。
旧报告中的“最新”“当前”“已通过”均限于各自记录时点，不能据此宣布当前版本一致。
架构和产品合同仍约束对应 owner；历史测试结论不是当前状态。

A/B1 与 B2 首段的限界、失败记录和可复跑命令见 [UI 收敛验收证据](./audits/2026-09-04-ui-foundation-consolidation.zh-CN.md)。

<details>
<summary>历史批次与证据索引（不作为当前 UI 完成率）</summary>

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

P4.6 Agent 完全重置：[Raft 三档 reset 合同、单 fence workspace/continuity saga 与破坏边界设计](./product/2026-09-02-agent-full-reset-contract.zh-CN.md)。该合同后半部已有 `C/A/L/D` 实现与恢复证据，正式 full 由专属 capability 解锁；不可把文档开头的设计状态当作当前禁用结论。

后续收口的当前执行真相：[Raft-first 剩余收口重构与补强计划](./product/2026-09-02-raft-first-remaining-closure-plan.zh-CN.md)。它固定了源码复用顺序、证据分层、P0–P6 施工顺序、单一 owner、迁移/回滚和浏览器验收。旧的完成列表是历史快照，不得用来覆盖该计划和当日审计。

Task 状态的当前长期边界：[canonical Task 生命周期与 Raft 五态看板](./adr/0029-canonical-task-lifecycle-and-raft-board.md)。schema 48 修复并禁止 `Task.state` / `workflowStatus` 分裂；typed `task.workflow.update` 只是 Raft 五态 UI intent，实际 cancel/reopen/complete、Review gate、依赖唤醒与幂等由 Kernel 单一解释。频道 Task Tab 和全局 Tasks 继续复用同一 Raft 看板、顺序、标签、颜色与浮层；无真实认领/提交证据的迁移明确禁用，不能伪造完成。

上述 Task 单一真相批次的实现、TDD、真实 Chrome/Firefox、canonical 业务断言与正式重启证据：
[2026-09-05 验证审计](./audits/2026-09-05-canonical-task-lifecycle-and-browser-verification.zh-CN.md)。
2026-09-03 的 Task UI 报告仍保留为历史界面证据，但不得覆盖本报告对完成、关闭、重开、
Review gate 与依赖唤醒的当前业务裁决。

第三方架构复核后的施工主线：[Task 真相、长历史与交付闭环修复计划](./product/2026-09-05-task-truth-history-and-delivery-repair-plan.zh-CN.md)。顺序固定为 Task 单一真相、有界 Room 历史、冻结交付证据、完整团队闭环，再继续页面族与通知设备验收；同功能 Raft 页面在每批仍承担独立 UI 双边义务。

Task 页面与业务流的当前交付证据：[Raft Task 工作流对齐与正式浏览器审计](./audits/2026-09-03-raft-task-workflow-parity-verification.zh-CN.md)。该报告冻结官方 bundle/DOM/computed-style、五态迁移图、Pencil/hover 尺寸、105.25px 单行盒模型、看板 12px/列表 10px 列头间距、`columns-3/layout-list` 最终14px 图标、28px 标题栏操作、Room 工具栏整件换行、Room/全局编号头 scope、左对齐空分组、列内 `overflow:visible`、共享 brutal 交互协议、Room/全局共用看板、typed 写入不唤醒 Agent、terminal 状态释放协作占用、真实指针 Chrome 桌面/390×844 与正式 4173 重启结果；强上浮族七处源码清单见 [Raft brutal lift 来源证据](./evidence/raft-brutal-lift-inventory-20260903.json)。不把内部执行证据重新包装成第二套公开流程。

本机 Computer 详情当前合同：[P6.6 Computer 侧栏、Runtime inspector、裁剪诊断与 Agent 跳转](./product/2026-09-02-computer-local-detail-contract.zh-CN.md)。当前证据为 `C/A/L/D`；Raft Computer 离线导致同前置非空数据 `R` 不可宣称。正式实例已从本轮验证过的不可变发布物恢复，但并发出现的非本批缺文件／缺导出仍阻塞当前源码整库重建，二者不得混为“全部通过”。

P2 Agent workspace / 本地项目文件历史 owner 合同：[Raft workspace 请求、AgentHost 路径安全、前端状态机与双边证据限制](./product/2026-09-02-agent-workspace-and-project-files-contract.zh-CN.md)。2026-09-17 用户撤回 `runtime-project` 第二根和独立记忆管理 UI；当前 Agent 工作区仅浏览 Agent 持久目录，主机文件引用由 Composer 的 Computer 文件树独立提供。

前端鼠标、键盘和触屏状态的当前统一基线：[Raft 前端操作状态合同](./product/2026-09-02-raft-interaction-state-contract.zh-CN.md)、[双边 computed-style 与真实浏览器审计](./audits/2026-09-02-raft-interaction-state-verification.zh-CN.md)。该批把 rail、导航行、平面按钮、brutal 按钮、segmented、消息工具条和输入 focus 收敛为共享协议；条件弹层、逐实例拖拽和缺失发布 chunk 仍须继续追踪，不能据此宣称全站交互 1:1。

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

</details>

架构与历史材料阅读索引：

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
15. [Memory 与 Context Fabric](./architecture/memory-and-context.zh-CN.md)
16. [Core 模块边界与源码规模 Ratchet](./architecture/core-module-boundaries.zh-CN.md)
17. [架构优势对照基准](./experiments/competitive-benchmark.zh-CN.md)
18. [ADR-0001：建立独立 Room-first 仓库](./adr/0001-room-first-repository.md)
19. [ADR-0002：Daemon-first、多客户端单一协议](./adr/0002-daemon-first-multi-client.md)
20. [ADR-0003：身份安全的 POSIX 进程监督器](./adr/0003-identity-safe-process-supervisor.md)
21. [ADR-0004：认证 Host 与本机 Daemon 生命周期](./adr/0004-authenticated-host-and-daemon-lifecycle.md)
22. [ADR-0005：Daemon composition、Worker delegation 与 durable wake](./adr/0005-daemon-composition-worker-delegation-and-wake.md)
23. [ADR-0006：Task 业务协议与 causal Worker command](./adr/0006-task-business-protocol-and-causal-worker-commands.md)
24. [ADR-0007：Durable InputRequest 与无 listening 等待](./adr/0007-durable-input-request-and-no-listen-waiting.md)
25. [ADR-0008：版本化 Human Client Application Service](./adr/0008-versioned-human-client-application-service.md)
26. [ADR-0009：不可变 Runtime Placement 与 Multi-Lane AgentHost](./adr/0009-immutable-runtime-placement-and-multi-lane-host.md)
27. [ADR-0010：Web/PWA 共享 UI、可移植 Client Core 与薄原生壳](./adr/0010-web-pwa-shared-ui-and-native-shell.md)
28. [ADR-0011：Task Coordination v1](./adr/0011-task-coordination-v1.md)
29. [ADR-0012：Workspace、Room Role 与 Thread 最小边界](./adr/0012-workspace-room-role-and-thread-boundary.md)
30. [ADR-0013：Human Application Port 与 Transport 边界](./adr/0013-human-application-port-and-transport-boundary.md)
31. [ADR-0014：Activation-scoped Agent Room reply](./adr/0014-activation-scoped-agent-room-reply.md)
32. [ADR-0015：Room membership 投递与 Agent activity](./adr/0015-room-membership-delivery-and-agent-activity.md)
33. [ADR-0016：Workspace Agent 原子创建与冻结运行上下文](./adr/0016-workspace-agent-provisioning-and-runtime-context.md)
34. [ADR-0017：持久化 loopback 本地工作台](./adr/0017-persistent-loopback-local-workbench.md)
35. [ADR-0018：launchd Computer supervisor 与 K slots](./adr/0018-launchd-computer-supervisor-and-k-slots.md)
36. [ADR-0019：本机 Core、正式 LAN Edge 与直连 Computer](./adr/0019-local-core-secure-lan-edge-and-direct-computers.md)
37. [ADR-0020：Task 意图、单一负责人和次级角色](./adr/0020-task-intent-single-owner-and-secondary-roles.md)
38. [ADR-0021：冻结 Task 提交与 canonical Review](./adr/0021-frozen-task-submission-and-canonical-review.md)
39. [ADR-0022：可逆 Closed 与 Runtime cancellation fence](./adr/0022-reversible-closed-and-runtime-cancellation-fence.md)
40. [ADR-0023：Agent 私有 Memory、App Inbox、维护执行与安全 Reset](./adr/0023-agent-private-memory-app-inbox-and-maintenance.md)
41. [ADR-0031：Host 观测的冻结 Task 交付证据](./adr/0031-host-observed-frozen-task-delivery-evidence.md)
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

# Current page-family work

- [Conversation interaction and Search state family](./design/conversation-page-family.md)
- [Conversation / Search 页面族验收](./audits/2026-09-05-conversation-page-family-verification.zh-CN.md)

当前用户优先级（2026-09-08）：[聊天室、私聊、Agent 配置与记忆核心交付基线](./audits/2026-09-08-core-conversation-memory-delivery.zh-CN.md)。其他六组后端差异由独立施工线处理；本报告记录核心专项回归、证据边界与串行验收出口。

当前核心串行收口：[Worker 目标呈现修复与验收边界](./audits/2026-09-11-worker-target-presentation-repair.zh-CN.md)。先验寻址，再推进原生忙时投递，最后严格双边组合复验。

原事故会话的实际续验：[Codex 旧会话跨 Room/DM 寻址复验](./audits/2026-09-11-codex-original-session-target-recheck.zh-CN.md)。四步最终落点通过，DM 首次寻址两次 404 后恢复，未宣布整体收口。

后续修复：[Worker 语义寻址与真实 handle](./audits/2026-09-11-worker-semantic-addressing-repair.zh-CN.md)。按 Raft 源码补齐读取输出的 `#channel` / `dm:@handle`；并纠正旧验收脚本仅缩小配置、未收窄 Host 凭据的隔离误判。

Claude 工具边界追加与 Kimi 原生接口差异：[来源、实施与验证边界](./audits/2026-09-11-claude-gated-busy-delivery.zh-CN.md)。不等同于全 Runtime 常驻会话或严格双边组合验收。

等待发送由 daemon 统一负责、Guide 按 CLI 控制面判定：[安装版本源码能力表与此前结论纠正](./audits/2026-09-11-runtime-wait-guide-source-matrix.zh-CN.md)。包含 Kimi 自带本地服务 steer 与 OpenCode 运行中 prompt 的上游依据；本批仅源码核实，非新功能部署。

[Runtime 级 Guide 开关与等待基线](./audits/2026-09-11-runtime-guide-settings.zh-CN.md)：按 CLI 持久开关，默认等待，未接通的接法禁用；不改变 Room 主动读取可见性。

[投递、会话生命周期与提示词审查（仅建议）](./audits/2026-09-11-delivery-lifecycle-prompt-review.zh-CN.md)：区分陈旧源码注释、实际 prompt 缺口及 Claude fresh/resume 就绪差异；用户要求本批不修改这些后端行为。

[Runtime 设置页重排与默认 Guide](./audits/2026-09-11-runtime-settings-redesign.zh-CN.md)：用户更新为已接通的 Guide 默认开启；修正间距、图标和颜色。生命周期及提示词问题仅审查，未在该批修复。

[六项差异二次核验与分批交付](./audits/2026-09-11-parity-batch-review-and-delivery.zh-CN.md)：纠正旧报告，首批对齐有效投递模式、实际 prompt 与 Claude fresh/resume 就绪，修帮助文本；其余项按证据与 owner 分批。

- [Runtime provider 图标与紧凑卡片](./audits/2026-09-11-runtime-provider-icons-compact.zh-CN.md) — 已通过联合检查并部署，含桌面/手机正式页面验证。

- [受管 Provider 自动记忆关闭](audits/2026-09-11-provider-auto-memory-disable.zh-CN.md)：Claude/Codex 进程级覆盖、无 HOME 隔离及验证边界。

- [管理页 Provider 启动参数](audits/2026-09-11-provider-launch-settings.zh-CN.md)：按 Provider 分组，受管启动参数覆盖、红绿差异与恢复默认。
- [UI 规格试点独立复核](audits/2026-09-11-ui-component-spec-independent-review.zh-CN.md)：来源核实、12 项测试与 42 项本地浏览器验证；静态值自引用、来源检查、预算棘轮尚需补齐。

- [管理卡片与字号悬停修正](audits/2026-09-11-settings-card-and-size-hover.zh-CN.md)

- [刷新等待与 Provider 白色标题](audits/2026-09-11-refresh-timeout-and-provider-heading.zh-CN.md)

- [频道设置开关与操作修复（2026-09-12）](audits/2026-09-12-channel-settings-repair.zh-CN.md)

- [Computer 选择与工作区 UI（2026-09-12）](audits/2026-09-12-computer-selection-and-workspace-ui.zh-CN.md)

- [2026-09-12 非阻塞构建恢复：白屏与已返回数据被扣留](audits/2026-09-12-nonblocking-build-recovery.zh-CN.md)。

- [2026-09-12 通知 Outbox 租约失效导致服务退出](audits/2026-09-12-web-push-lease-crash.zh-CN.md)。

- [Tailnet 模式补回本机入口](audits/2026-09-12-tailnet-loopback-entry.zh-CN.md)

- [侧栏上下文菜单核对](audits/2026-09-12-sidebar-context-menu-parity.zh-CN.md)

- [Human 头像悬浮资料卡尺寸修复](audits/2026-09-13-human-avatar-preview.zh-CN.md)

- [Agent 顶栏响应式操作与 tooltip](audits/2026-09-13-agent-header-responsive-actions.zh-CN.md)

- [运行时配置入口与环境变量摘要](audits/2026-09-13-runtime-summary-and-refresh.zh-CN.md)

- [频道成员管理页对齐](audits/2026-09-13-channel-members-page.zh-CN.md)

- [频道设置抽屉、成员导航与系统频道隐藏](audits/2026-09-13-channel-settings-and-system-visibility.zh-CN.md)：源码规则、持久权限策略与验证范围。

- [消息列 Human 身份与 Agent 更多图标修复](audits/2026-09-14-thread-human-identity.zh-CN.md)

- [点击清除消息定位与搜索高亮](audits/2026-09-14-message-highlight-dismissal.zh-CN.md)

- [任务操作时间线完整性与底部定位续修](audits/2026-09-14-task-timeline-completeness.zh-CN.md)

- [空消息文案与后台同步稳定性](audits/2026-09-14-chat-empty-stability.zh-CN.md)

# 2026-09-16

- [PWA 滚动边界、历史补偿与原生文本选择](audits/2026-09-16-pwa-scroll-and-native-copy.zh-CN.md)

# 暂停通知与正式重启

- [2026-09-18：保留已停止 Room 的通知队列，修复重启误拦截](audits/2026-09-18-held-activation-restart.zh-CN.md)
  [Agent 直接启动](./audits/2026-09-18-agent-direct-start.zh-CN.md)：移除启动确认，保留停止确认、请求保护和失败反馈。
  [Agent 重启语义及弹窗修复](./audits/2026-09-18-agent-reset-parity.zh-CN.md)：停止状态支持三种重启，修复弹窗样式覆盖。
  [移除 Agent 报告问题](./audits/2026-09-18-agent-issue-report-retirement.zh-CN.md)：按用户要求退役入口、弹窗和本地报告导出。
  [创建 Agent 弹窗视觉对齐](./audits/2026-09-18-agent-create-dialog-parity.zh-CN.md)：对齐上游布局参数，修正 WebKit 控件外观与窄屏拉伸。
  [大页选择与窄屏主内容](./audits/2026-09-20-surface-selection-parity.zh-CN.md)：聊天空选择回列表，成员详情随窄屏展示，独立导航记忆、共享字体、未读加粗与双击私信。

- [消息列关注菜单层级与绿色移除提示](product/raft-frontend-local-contract.zh-CN.md#消息列关注菜单层级与移除提示2026-09-20)：源码参数、层级回归与正式页面验证边界。

- [任务审批内头像导航修复](audits/2026-09-21-task-modal-avatar-navigation.zh-CN.md)

- [窄屏搜索筛选单行滚动](audits/2026-09-21-mobile-search-filter-scroll.zh-CN.md)
