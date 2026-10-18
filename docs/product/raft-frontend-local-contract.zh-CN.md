# Raft 前端行为合同 → RAH 本地能力映射

当前发布范围以[单 Human 主线与多人备选项目](./single-human-mainline-and-multi-human-backlog.zh-CN.md)为准。
多 Human 加入、协作及差异化浏览/加入限制延期，不作为首版 Raft 对齐的阻塞项；
保留本地认证、Agent 参与/执行权限和私有记忆隔离。下方历史计划不改变此范围。

## evo 频道工作区（2026-10-18）

负责人授权新增频道工作区浏览。使用官方 `AgentDetailPanel → AgentWorkspace → TreeNode / useResizablePanel` 的展示结构与原生 Markdown 切换；本地为结构移植，不称完整组件原样复用。入口在频道标签，不通过伪造 Agent 或发布 Artifact 来浏览文件。`channel.workspace.read` 由应用层按频道成员身份解析固定主目录／附加目录，读取前后复核权限；AgentHost 复用已有有界文件浏览器并提供只读 Git 查询。UI 只保留可取消的读取状态，不写文件、Git、消息或实例状态。

当前 Git 视图为 HEAD 到工作区的合并差异，不是某次模型运行的改动记录；只在选择后读取单个 diff。Markdown、文本、图片支持工作区预览，HTML 只显示源码；PDF 等已发布附件预览保持原有独立链路。根目录必须是普通 Git 仓库，linked worktree、嵌套仓库发现及 Git 写操作不在本批。来源、限制与验证见[证据](../evo/evidence/2026-10-18-channel-workspace/summary.json)。下方旧 Agent 工作区合同为 main 历史，不代表 evo 的新入口。

## 决策

2026-09-14：自定义侧栏分区通过既有sidebar.patch原子保存可选emoji，旧记录兼容；
其唯一owner仍是Human × Workspace侧栏偏好，非Room配置。
[新建分区弹窗及协议证据](../audits/2026-09-14-section-create-dialog-parity.zh-CN.md)。

2026-09-08 本批修复：全局 Task 在保留看板与筛选的居中 Thread 弹窗内打开；
Task 生命周期历史由既有 Kernel 投影提供，Human `task.history` 仅增加认证读取入口，
与 Worker 共用冻结分页和字段脱敏，不扫描整间 Room、不新建历史存储。
Search 计数沿当前官方 `Jr.length + ne.length`：可见实体加已加载消息；
后端用于分页的消息总数不改义。Rail 沿当前官方 `pb-2`、三项 `h-11`，
Help 只链接真实本机指南；Computer runtime chip 沿 `h-6 px-2.5 py-1 text-sm`。
来源、验收边界见[本批修复记录](../audits/2026-09-08-frontend-parity-repair.zh-CN.md)。

Raft 的前端发布源码是**可见产品行为**的首要证据：触发入口、前置条件、请求参数、响应字段、加载/空态/错误、导航、鼠标和键盘。RAH OS 不需要复刻其中央服务器部署、账号收费或跨服务器代理链，才能实现这些行为。

实现顺序固定为：源码追踪 → 合同与差异裁决 → 映射现有 owner → 缺失能力的最小补充 → 真实浏览器验收。不能用截图猜参数，也不能将“发现 onClick”算作“完成一个功能”。不新建第二套 Room、Task、Inbox、Run 或文件真相。

本机文件访问路径是 Web/PWA → 同源入口／RahClient → 授权应用层 → 本地 AgentHost 文件 owner → 文件系统。将来远程 Computer 只替换该 owner 的传输，不改变页面合同。LAN 浏览器仍不能任意读取主机文件；“本地”不意味着移除目录范围和 Human 权限。CLI 安装和账号配置始终由用户负责。

## 证据冻结与覆盖口径

2026-08-31 从已登录官方页面的 DOM 获取当前入口 `https://app.raft.build/assets/index-BoAC7nSE.js`，再按发布源码中的静态依赖路径下载。归档位于 [本轮源码目录](../evidence/raft-web-20260831-current/README.md)。入口 SHA-256：`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。

[候选索引](../evidence/raft-interaction-candidates-20260831-current.json)记录 23 个文件、1,836 个事件注册/回调候选位置，其中 892 个 `onClick`。**不是 1,836 个业务功能，也不是通过率**：包含组件库回调；所有候选默认 `untraced`。索引同时列出 13 个尚未归档的引用 JS。动态注册、权限/版本条件分支和未加载模块还需继续追踪，当前不能称全部前端逻辑已整理完。

索引由 `scripts/inspect-raft-interactions.mjs` 使用 TypeScript AST 生成；记录文件哈希、UTF-16 起止偏移、owner、表达式和截断标记，不执行官方代码。正式 Web/daemon 不导入这些产物。脚本拒绝覆盖已有冻结证据。

后续增量：[74项行为登记](./raft-behavior-inventory.zh-CN.md)与[Agent九组详细合同](./raft-agent-behavior-contract.zh-CN.md)已补入。另用[来源关联表](../evidence/raft-behavior-source-links-20260831.json)关联23个已限定语义的事件候选，不修改冻结索引的原始标记，也不把函数范围内其他回调一并算作已审。双边只读核对已发现若干实际差异；13个缺失引用和全站追踪仍未完成。

旧冻结入口 `index-WTraJnrd.js` 的 Agent/Computer 分块 URL 已返回 404；旧版证据仍可用于历史审计，不与新版调用点混算同版本验收。

每条正式合同必须有：来源版本/文件/位置、触发和前置条件、输入和返回、可见各状态、关闭/键盘/焦点、异步取消与导航竞态、本地 owner、明确差异、源码/本地/双边分别验收的状态。权限拒绝、无数据和请求失败都属于功能结果。

## 首批已追踪合同及本地映射

第三方复审已收紧以下表格的异步含义：官方根/子目录仅部分成功响应检查Agent身份，不保证同Agent请求代次、错误/finally及文件选择晚返回安全；文件读取保留旧预览，仅在loading时隐藏，不能说真正清空。具体源码位置和其他默认tab/权限/Computer导航更正见[官方独立合同审计](../audits/2026-08-31-third-party-official-contract.zh-CN.md)及[主审裁决](../audits/2026-08-31-third-party-parity-final-review.zh-CN.md)。本地可保留更严格的取消、generation和键盘保护，不为复刻引入已知竞态。

以下偏移均为当前冻结文件的 UTF-16 偏移；短名 AgentDetail、RefText、index 对应源码目录中的唯一同名前缀文件。

| 触发位置               | 官方源码与参数                                                                       | 显示内容／数据来源                                                                                     | 关闭、键盘与异步行为                                                        | 本地映射／差异                                                                                                                                                              | 验收状态                                                                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 消息输入框 Enter       | index，`ra`，约 2238000；先检查 IME、候选菜单，再调用已有 `Gn` 提交                  | 同一消息提交过程，含附件/发送状态                                                                      | 桌面 Enter 发送、Shift+Enter 换行；确认 IME 不发送                          | `handleComposerKeyDown` → 已有 Room/DM/Thread form；不另发 API                                                                                                              | 本轮三个 composer 实页 Enter 通过；Shift+Enter 保留草稿；IME 仅单测                                                              |
| 私信/Message Agent头像 | index 3191440；`Xrt` 2935728；AgentDetail 137580/138961/134119                       | 两个 Chat 头像打开同一 Agent inspector；资料头像展开 preset 并保存                                     | inspector 默认Activity；关闭回触发；picker Escape关闭；保存失败留在原选择区 | App `openAgentPeek` + `AgentDirectoryPane`；头像走`agent.manage/update_profile` revision CAS；上传因无存储owner禁用                                                         | 代码与自动化已接入；隔离浏览器及正式重启证据见资料编辑验收补充                                                                   |
| 工作区初次打开         | AgentDetail `No`，20829；GET `/agents/:id/workspace-files`，`includeHidden`          | `{files}`，一级根目录；路径标签取 runtimeProfile.current.workspacePathRef，缺省 `~/.slock/agents/:id/` | loading、失败、空目录分开；响应检查 Agent 身份                              | `agent.workspace.list` → AgentHost 只读目录；当前 RAH 暴露私有 home，不能伪称运行项目 cwd                                                                                   | 上批本地非空树通过；官方成功态未实测                                                                                             |
| 点击文件夹             | 同 `No`，21535 起；同 GET 加 `dirPath`                                               | 按目录缓存 children，expanded set；一级延迟加载                                                        | 展开中显示目录 loading；Agent 切换后的旧响应丢弃                            | 已有 Directory 逐级加载；键盘树行为本地实现                                                                                                                                 | 上批本地展开/键盘通过；官方在线态待补                                                                                            |
| 点击文件               | 同 `No`；GET `/agents/:id/workspace-files/read`，`path`                              | 选中路径、文本或图片/二进制预览、错误信息                                                              | loading遮住旧预览，未清空旧内容；文件响应缺完整选择代次校验；compact返回树  | `agent.workspace.read`；AgentHost 限定根目录，前端 AbortController；已有桌面文本/图片分支                                                                                   | 本地文本/HTML 字面预览已验；完整类型和移动返回未双边验收                                                                         |
| 刷新／显示隐藏文件     | 同 `No`，根/children 缓存、expanded set                                              | 刷新根目录并重载已展开目录；隐藏切换重置选择和展开                                                     | 请求失败可重试；官方显示选项按 Agent 记忆                                   | 本地刷新保留 expanded/selection；失败保留旧树；隐藏切换重置；持久偏好仍未移植                                                                                               | 独立桌面/390 文件预览通过；官方成功树仍未实测                                                                                    |
| 文件树分割线／复制路径 | 同 `No`，23199；width256、min160、max600；copy成功1500ms                             | 宽度偏好、路径复制提示，不是后端状态                                                                   | pointer down/move/up/cancel，8px命中区，compact树/预览                      | 本地同尺寸边界、键盘步长16、复制反馈复位；失败不覆盖文件读取状态                                                                                                            | 独立真实鼠标256→356、Home/End/方向键、复制反馈消失通过；不称官方在线态双边通过                                                   |
| 动态文本中的目标链接   | RefText `M/D/T/F`；频道/DM/消息短号；GET context + channelId                         | 候选→可见目录→唯一context→稳定消息/Thread                                                              | 异步导航epoch，旧结果不得抢新目标                                           | `diagnosticReferenceParts` + 可选roomId的`message.context` + App共享导航gate；拒绝未知/歧义，根消息也恢复已有Thread；本地短号至少8字符                                      | 独立真实Kernel ACL/root与跨回调竞态通过；任意task编号、所有Human DM handle和全语法未覆盖                                         |
| 消息右键选择/工具栏    | index 约 2855000、2983000、3016000、3187200；scope、selectedIds、resolved/unresolved | 当前 Room/Thread 已载入消息；选择数、全选、转发、复制链接/Markdown                                     | composer 被替换；切换对话清理；顶层 modal 先消费 Escape                     | `useMessageSelection` + `MessageSelectionToolbar`；纯内存、未解析 fail closed，不持久化第二份消息缓存                                                                       | 单元测试及 Chrome desktop/390×844 通过；完整更多菜单仍未齐                                                                       |
| 多目标消息转发         | index 约 3204100、3207500、3225000；目标最多10，搜索20，stable requestId             | server canonical `forwarded-bundle`；逐目标成功/失败；失败目标重试；附件 projected identity            | Dialog focus trap/Escape；成功退出选择；失败保留状态                        | typed SDK → Human App Service → Kernel `MessageForwardingService`；同 Workspace ACL、请求级快照冻结、目标级事务；`RoomFiles` 独立目标身份/hard link；不产生 Agent attention | 纯文本、附件预览、部分成功、重试、刷新、390px 和来源 deep link 已过本地门禁；嵌套/system/action 仍 fail closed；非同前置官方实测 |

### 对前次“目标只能来自 metadata”的纠正

新版 `RefText` 确实会解析 `#频道`、`#频道:消息短号`、`dm:@成员`、`dm:@成员:消息短号`，再解析到已知对象；不能继续声称 Raft 完全不解析文本。**提取引用候选，不等于把日志变成 canonical truth。** RAH 可以复用其“候选 → 可见目录/context → 稳定 ID → 导航 + 过期校验”做法，不必为了每个链接扩张诊断事件协议。仅有 Run 来源 Room 时仍须标“对话”，不能冒充实际工具目标。不能拿任意文本 URL/路径直接获得文件或 Room 访问权。

文件树现已按官方 pink/20、右边2px pink、hover black/5 改造，并经本地真实浏览器取值。仍保留宽度/隐藏偏好仅内存、Markdown以安全文本预览为主的差异；源数据/离线前置不同，不能宣称整页1:1。

### 2026-08-31 补强后的状态与导航 owner

- Computer 连接来自已认证本机 Host 记录及心跳时效，CLI清单独立；配置/重绑/删除Agent不得刷新心跳。未知与离线分开，不能用PATH或绿色静态样式伪报在线。Avatar、资料、DM、Member Host与Computer统一投影观测。
- `HumanActivity` 的summary复用列表同一ACL/follow/read/done资格，但取最新frontier；旧cursor分页仍冻结内容。Room/DM入口数顶层消息与恢复频道通知，Thread未读进入全局Activity。粉点隐藏不是read。归档事件保留正文历史但不计入侧栏未读，避免频道恢复时把此前归档动作算成新消息；其他原有未读消息不受影响。恢复通知即使操作者本人也计入未读；自动跳转/刷新不清除，聊天侧栏点击该频道才持久确认。`activity.mark` 的 `source=viewport` 不跨未确认恢复通知，`source=channel-list` 确认到最新恢复事件；现有显式 read/done/unread 保留。详见[当前系统通知合同](../audits/2026-09-19-system-notices-and-restore-read.zh-CN.md)。
- 系统Computer notice与Human InputRequest并列展示，不共用业务状态。dismiss只记当前故障版本偏好；恢复后再次离线形成新事项。通知展开仍保留待处理点，手机/桌面共用同一来源。
- Inbox以5s可见/15s后台间隔单飞读取；15s请求超时中止旧信号再重试，旧响应与卸载不得写回。列表读取不resolve；只有用户明确回答才执行canonical resolve。
- Activity打开Thread保留Activity中栏、筛选及精确room/root/message；URL恢复/关闭/筛选由现有导航owner协调。latest ticket的`current`保护导航/错误/刷新，`owns`仅释放本次pending，避免自身导航作废后按钮永久禁用，也避免旧action清新pending。
- Markdown 裸 ASCII URL 紧邻中日韩正文时，链接必须在首个 CJK 字符前结束；中文保持正文，`href` 不得把中文百分号编码后吞入路径。显式 Markdown 链接仍按作者写法保留。链接使用连续下划线（`text-decoration-skip-ink: none`），避免长 URL 在字母下伸部位出现视觉断裂。

最新证据：[补强主审报告](../audits/2026-08-31-parity-reinforcement-final-review.zh-CN.md)。每一项明确区分源码合同、隔离后端、真实浏览器和正式部署。

### 2026-08-31 头像实时观察补充

前文“Avatar与Computer统一投影观测”不表示两者状态相同。新`agent.presence.list`将managed Agent的运行状态与Host连通性分离：目录ACL限定可见身份；当前运行/序号/fencing/终止事实限定时效；只返回无内容枚举。官方`Uze/fp/mne`复用、差异与验收见[设计](./2026-08-31-agent-presence-closure.zh-CN.md)及[复核](../audits/2026-08-31-agent-presence-closure-review.zh-CN.md)。本轮仅隔离桌面局部验收，真实Provider全序列、有效390px门禁和external仍未完成；候选总表没有因此变成全站已追踪。

### Enter 的产品裁决

按用户明确要求，RAH 的 Room/DM/Thread 统一 Enter 发送、Shift+Enter 换行；按钮禁用时键盘不能绕过权限、上传、pending 或 Task 校验；长按重复 Enter 不重复发送。IME 确认键保持输入，不提交。

源码另有 Ctrl/Meta+Shift+Enter 强制作为 Task，以及粗指针竖屏 Enter 换行的分支。本轮没有复制这两条，也不宣称快捷键完全等同。以后补候选菜单时，候选确认必须先消费 Enter，不能误发消息。普通表单输入框和 Agent 人设编辑器不套用消息发送规则。

## 后续施工顺序与放行条件

1. 本批文件树与受约束resolver已实施；剩余持久偏好、Markdown切换、所有目标语法须继续按合同准入，不由本批通过自动推导完成。
2. 沿 Agent 已归档模块整理其余 tab 的请求、状态和可见权限；形成逐项合同后再改页面，不能把所有 tab “存在”算作功能完成。
3. 补剩余 lazy chunk，按 Chat/DM/Thread、Tasks、Search/Activity、Files、Computer 顺序去重候选，逐条映射现有应用服务。错误/取消/重复点击/权限变化/跨页面晚返回须有反例。
4. 双边同尺寸、同前置状态验收。Raft Computer 离线只意味着**官方非空文件结果无法现场对照**，不代表 RAH 需要 Raft 服务、不代表本地文件功能不能开发/交付。该项可以先以冻结源码合同 + 隔离本地文件系统 + 真实浏览器验证，但必须标明不是双边通过。

本轮不改文件根目录协议、不启动官方 Computer、不重启用户正式进程、不新增 CLI 安装或账号配置功能。完整源码语义追踪仍在进行；本文件是首批合同，不是全站完成声明。

PDF 附件的本地 canvas 阅读补充：支持页码跳转、10%–2500% 相对适合宽度缩放，单页画布至多 400 万像素。
沿用认证下载、关闭取消与 URL 回收；工具栏为本地适配，原生 PDF 完整能力及官方双边仍未验收。
见[阅读操作证据](../audits/2026-09-07-pdf-reading-closure.zh-CN.md)。

## #all 固定成员（2026-09-13）

常驻 #all 使用不可变 slug 标识，同 Workspace 的全部未删除 Agent 自动成为成员；停用不退出，删除身份遵守原执行围栏。Kernel 在频道/Agent 创建和启动时维护 canonical membership，前端无手动添加或移除入口，后端拒绝绕过调用。普通频道保持原行为。详见[来源、事务与验收](../audits/2026-09-13-all-channel-membership.zh-CN.md)。

## #all 隐藏与覆盖式成员资料（2026-09-13）

系统频道隐藏是独立于 public/private 的 Kernel 工作空间策略：频道设置确认后隐藏，
设置→管理→系统频道可恢复。隐藏禁止 Human/Agent 读取与发送，保留成员和历史，
服务重启不恢复。活动工作仍受现有执行围栏保护。覆盖式频道抽屉使用 Raft 的
240/180ms 动画，成员资料在同尺寸容器中显示；并排聊天 inspector 不使用此动画。
来源、规则、测试与差异见[频道设置与系统可见性审计](../audits/2026-09-13-channel-settings-and-system-visibility.zh-CN.md)。

## 外观模型显示（2026-09-14）

本设备偏好控制预览和 Room/DM/Thread 的 Agent 名旁模型标签；Web/PWA 默认关闭，
有明确保存的模型绑定才显示。Agent 目录以现有 ACL 投影当前策略的可选 `modelBindingId`，
不按消息读取完整策略，不推断历史 Run 的模型。详见[来源和验证记录](../audits/2026-09-14-agent-model-appearance.zh-CN.md)。

2026-09-20 用户补充：所有 Agent 悬浮资料卡、资料模型字段与对话模型后缀统一显示
CLI 原生模型 ID，仅移除 RAH `local:…/v1:` 内部绑定前缀，保留原生 provider/model。
目录可用、自定义模型、目录缺失均适用，不因删除、停止或重启状态改变规则。
模型选择器的友好显示名规则不变。共享 owner 为 `runtimeProfilePresentation` 与
`chatModelIdentifier`，详见[补充验证](../audits/2026-09-20-deleted-agent-preview-model.zh-CN.md)。

## 消息列菜单裁剪（2026-09-20）

按用户要求移除消息列右上角菜单的“在新标签页中打开”及其 window.open 处理，
保留搜索、在频道中查看与关注操作。这是明确的本地产品差异；不影响其他位置链接。
浏览器菜单断言先复现多余项，再确认移除后回归通过；类型检查和正式构建通过。
全仓库仍有此前接口登记和 5 个格式文件阻断。

## 系统消息时间补齐（2026-09-20）

按用户提供的 Raft 对照截图，系统消息正文前显示事件时间。原本仅归档变更使用
`ChatMessageTime`，成员加入和提醒遗漏；现在 `ChatSystemNotice` 的每条消息及
Thread 提醒均复用已有时间组件，遵循设备时间格式。折叠摘要不代表独立事件，
展开后逐条显示各自的 `createdAt`；不新增时间字段或改写事件。
Raft 发布源码的 `message.system.summary.*` 分组语义已核查；本次是本地组件复用，
不声称复制上游 CSS。归档浏览器 gate 新增逐条时间断言，先复现缺少 time 元素，
修复后桌面和 390px 截图检查通过。类型检查、正式构建、时间线单元测试通过。
正式备份重启后，#all 成员加入消息时间及刷新验证通过；全仓库仍受既有接口登记
及 5 个格式文件阻断。

## 文件评论计数（2026-09-14）

附件卡片评论数来自 AttachmentCommentsService 的持久附件关联，不使用线程回复数或当前评论分页长度。
Attachment.commentCount 是可重建显示投影；挂载的旧消息通过已有 MessageSocial 批量读模型的
attachmentCommentCounts 更新，保持有界窗口及权限检查。整文件引用使用 Raft file-text 图标。
详见[源码、数据与验证证据](../audits/2026-09-14-file-comment-count-and-glyph.zh-CN.md)。

### 新 Agent 报到设置

服务器资料复用现有配置保存与开关组件，提供 `agentAllChannelGreetingEnabled`，
默认开启，仅影响之后创建的身份。现有 Agent 不补发；关闭时仍可首次初始化。
首次消息必须由 Agent 经 Worker 接口发出，前端不得模拟介绍或把创建响应视为已报到。
准确的上游证据、本地调度与验收边界见
[首次报到审计](../audits/2026-09-20-agent-first-run-greeting.zh-CN.md)。

## 消息列成员头像组（2026-09-20）

按 Raft 发布 Web 的 `thread-followers-${placement}-trigger` 实现参数适配：
header 头像 18px，白色 1px 边框，相邻头像重叠 4px；头像组与人数间隔 4px。
按钮维持 28px 高、左右 6px 内边距、白底。最多显示 3 个头像，人数仍为全部关注者数。
源码分析副本和 SHA-256 同[添加成员审计](../audits/2026-09-20-channel-add-members.zh-CN.md)。
这是参数与结构适配，不是发布 bundle 的字节级复制。
浏览器 gate 使用 5 名关注者确认 3 个头像/人数 5、-4px 几何，并继续验证刷新不跳动、
零人数隐藏、菜单和关注操作。测试先确认旧 3px 正间距失败，再修复并通过。
正式备份重启后在 Solars 消息列验证：总人数保留、仅 3 个头像、实际重叠 4px。
正式构建 `9e328e2c9b9152c212750bd40856f61c5c4630ffe0ef36f6b986ef3499ef7632`。
类型检查、正式构建及 CSS 门禁通过；完整 check/format 仍受上述既有阻断项影响。

## 消息列关注菜单层级与移除提示（2026-09-20）

层级由共享 panel-layout 管理：消息列头部建立 z-index 2 的定位层，正文建立
z-index 0 的独立 stacking context，正文内定位元素不能越过头部菜单。
默认正式页面未直接复现截图中的穿透；浏览器回归给正文消息添加较高定位层级后，
菜单命中测试先失败，隔离后通过。保留既有菜单关闭、焦点和关注者数据路径。

Raft 发布 Web 源码版本及哈希同上述头像组证据：移除调用 `To.success`，
使用 `thread-follower-removal-toast` 和撤销 action；solid success 映射
`bg-brutal-lime`。本地使用对应 `--green`、确认图标、黑底白字撤销按钮及
“已将 NAME 移出此消息列的关注者。”文案。属于结构与参数适配，不是 bundle 复制；
保留服务端 undoToken 与到期边界，不用前端模拟恢复成功。

`test-thread-header-menu-browser.mjs` 覆盖层级命中、绿色提示、撤销与既有失败处理。
绿色样式断言先失败再通过。类型检查、正式构建及相关 CSS 门禁通过。
备份并重启正式构建 `4f4160a1f1bb52ac08ffce0f1463688c0fe82549543782bc11b20e5da7049942` 后，
真实 Solars 消息列在 1440、900、390px 宽度下菜单命中与截图检查通过，刷新、Escape
通过；成功移除/撤销只在隔离 fixture 验证，没有修改正式关注者。完整 check 仍被
既有 `/v1/worker/message-present` 登记项阻断，format 仍有既有 5 个文件问题。
