# 官方前端依赖化：现状与验收边界

截至 2026-10-21，全站尚未完成依赖化。导航范围和跨页能力的当前清单见 [dependency-migration.json](../../frontends/raft/loom/dependency-migration.json)。该清单不是所有函数的完成率，也不宣称全部现有行为已重新验收。

## 已建立的依赖边界

| 层次                       | 已落地                                                                                                                                                                                                                                                                          | 边界                                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 基础设计系统               | `@botiverse/raft-ui@0.10.5`，canonical/legacy 导入共享运行时                                                                                                                                                                                                                    | 原生控件、recipe、字体和状态；不能据此认定每个页面组合原生                                                                   |
| 直接源码依赖               | Tooltip、CloseButton、EmptyState、SectionHeader、SectionEyebrow、PanelHeader、AppearanceThemePicker、AvatarEditVeil、SettingsProfileCard、SurfaceListItem、SlugInput、panelBounds、AvatarListRow、KeyValueRow、ShowMoreToggle、VirtualizedTaskStack、searchOverlayAnchor、Modal | 私有本地分发包的原文件保留官方字节，不是官方发布的完整 Web npm 包                                                            |
| 外观区块                   | 从官方 SettingsPanel 精确提取正文与预览声明                                                                                                                                                                                                                                     | 显式接入现有设备偏好和主题hook；消息预览和字号组件仍沿用原模块                                                               |
| 日期与时间                 | 从官方 LanguageRegionSection 原样提取日期/时间 JSX 子树                                                                                                                                                                                                                         | 保存/错误绑定浏览器设备偏好；中文限定语言块仍为本地组合                                                                      |
| 更新日志                   | 原样提取官方内容 JSX、分类与徽标规则                                                                                                                                                                                                                                            | Loom 自有静态发布记录；既有设置外壳负责标题和滚动，旧构建时切片已移除                                                        |
| 账户／通知／关于／系统频道 | 锁定官方展示切片，系统频道 JSX 原样提取；删除四条运行时改写                                                                                                                                                                                                                     | 账户删去云端字段并保留编辑围栏；通知保留未知状态保护与恢复操作；关于只保留产品版本。子组件闭包尚有历史适配，不称整页原封不动 |
| 归档／设置侧栏／表单       | 官方展示声明提取，恢复按钮与Field原声明复用；分栏尺寸直接依赖官方                                                                                                                                                                                                               | 归档频道标签本地化；省去云端反馈；表单兼容旧labelStyle参数但不采用旧样式                                                     |
| Role 资料                  | 官方名称、属性行、样式声明精确提取                                                                                                                                                                                                                                              | 头像/Prompt/信息/运行配置分区是有记录的结构移植；Role语义和实例管理保持本地                                                  |
| 动态时间线                 | 官方 LogItem 与 recipe 精确提取，Role 与实例轨迹共用 TrajectoryRow                                                                                                                                                                                                              | 数据读取/实例名/诊断文本映射在 Loom，历史分页和权限仍由既有 API 负责                                                         |

搜索目标行／常用对象行与任务详情头部已转为锁定原声明生成；动态空状态采用官方 JSX 提取。搜索行仅新增菜单关闭焦点 ref；任务属性显式绑定 Loom，移除 Vite 隐式替换。TaskModalHead 的三行折叠、测量、缩放监听和展开状态保留官方实现。仍非整页依赖化。

公开源码锁定 db5e399 / v1.21.23-source.1；历史生产资源参考 v1.21.26。两者不同，不能标为同一“最新版源码”。

## 剩余范围

- 顶栏、导航、分栏及响应式组合仍有结构移植。
- 聊天、单聊、消息列、composer：原组件与构建时变换混合，须逐步提炼稳定数据/事件接口；保留草稿、IME、虚拟历史、焦点、发送权限与因果屏障。
- 搜索、动态：页面级查询、列表、预览、筛选和跳转组合仍需迁移。SearchOverlay已切换锁定源码完整声明，连同官方Modal/无模糊遮罩和定位函数直接依赖；固定顶栏Web模式，内容绑定Loom。其他弹窗不随本批切换。
- 任务：看板列、分组列表、拖动包装和卡片已提取为显式生成边界，虚拟列表直接依赖；页面工具栏、过滤、创建和详情整体组合仍需收拢。
- Agent：列表、工作区、实例资料/控制仍有本地组合。Role/Instance区别不是等待删除的“偏差”。
- 计算机：手机按官方仅在设置列表中提供二级入口，桌面仍独立导航；手机列表采用官方ListRow/IconTile组合。实例列表和只读属性行直接依赖官方原文件；运行时、编辑和详情组合仍在本地。历史附件卡片行尚未迁移，不能把同名组件一并算作完成。
- 设置：外观、日期时间、更新日志及账户/通知/关于/系统频道展示已迁移；归档、侧栏、表单也已迁入；设置外壳、用量、运行配置和部分子组件仍有本地组合。用量和运行配置与Raft云端计费/分析设置并不等价，不列为等待照抄的业务页面。
- 附件、评论、文件树、diff：展示原模块与本地适配并存，不能绕过文件访问和附件授权。
- 全局记忆、Fork/Side：没有完全对应的官方业务页面，应维持 Loom 语义，以官方场景组件组合；不为“依赖化”引入官方业务 store 或改变后端。

## 怎么保证，以及不能保证什么

1. `source-lock.json` 与 `upstream-package.test.mjs` 校验原文件哈希；`upstream-diff.mjs` 对新官方 checkout 直接比对，独立报告本地漂移。原有 intake/ports 保留历史来源。
2. 各类 generated 文件必须等于生成器从锁定源码得到的声明正文；改 JSX 必须通过更新来源或显式外层适配，不能偷偷编辑生成结果。
3. `ui-version.test.mjs` 验证两种包名解析到同一官方运行时，避免组件上下文/样式重复。
4. `dependency-migration.test.mjs` 要求每个导航目的地都在清单中，所引实现文件必须存在。它保证范围不漏记，**不证明该页面功能完整或视觉一致**。
5. 每个迁移切片先失败复现，再类型/构建/定向行为检查；浏览器验证相关宽度、键盘、焦点、禁用、分页、错误及数据隔离。fixture只证明前端流程，不冒充付费模型或真机验收。
6. 正式部署前检查活跃工作并备份；重启后核对业务数据和真实页面。提交、推送、部署分别记录。

不能保证“换包后绝对不必验收”。官方组件接口没变，也可能改焦点、响应式布局或默认参数。稳定边界能减少手工重写和全站视觉巡检；变更涉及的交互仍须定向验收。

## 后续顺序

1. 设置剩余独立区块：先低耦合展示，逐项撤除重复实现。
2. 计算机详情和 Agent 列表/实例资料：沿用已建立的 Header、Profile 和 Timeline 边界。
3. 搜索/动态/任务的完整展示区块，再收拢顶栏和分栏组合。
4. 最后处理聊天 composer、消息列与附件的深层组合，避免为了迁移破坏已验证的发送、历史与文件权限。

一个切片只有在“原来源可追踪、展示边界可替换、旧重复实现移除、Loom状态仍有唯一owner、针对性行为验证通过”后才能标记完成。全局记忆等本地特有功能另记为官方原语组合，不能伪称官方整页复用。

## 入口行为对齐回归

Role 资料入口以锁定的 `AgentDetailPanel.defaultAgentTab` 表达式为对照：资料存在时优先资料，不由标签排序决定。`role-activity.test.ts` 对官方规则和 Loom 初始/重新选择默认值做差异检查；浏览器用例在1440和390宽度验证首次进入及从动态重新选择Role后的资料选中状态与正文。实例头像打开动态仍是另一个入口，不受此默认规则覆盖。源码一致、入口交互一致分别验证，不能互相替代。

### 搜索消息及动态展示边界（2026-10-22）

MessageHitRow 的官方非导入声明由生成器复用，仅保留 `resultKey` / `data-result-id` 键盘定位补丁；修复消息列图标偏离原源码尺寸的问题。纯函数 `searchGrouping` 改为原文件直接依赖，移除本地重复实现。ThreadsInbox 的过滤栏 JSX 与 ConversationAvatar 声明从同一锁定源码提取，分别使用批量已读动作槽和最小身份类型接入 Loom；过滤栏恢复官方 canvas 背景及国际化文案，会话图标使用官方 IconTile。

动态行本体仍是已采用 v1.21.26 资源的紧凑 InboxItem 结构移植，未回退为公共源码的旧卡片。Loom 的已读持久化、异步结果防护、预览/导航、菜单焦点和移动端紧凑例外保持本地所有权。这不代表完整动态页已依赖化。新增 source equality / bridge guards，受影响路径使用桌面和移动端浏览器验收。

### 搜索首页及结果展示区块（2026-10-22）

锁定完整 `MessageSearchPage.tsx` 原文件与 SHA256；`generate-search-sections.mjs` 通过 AST 唯一定位并提取最近会话、历史、常用对象、消息列分组及分页状态区块。原 JSX 不手工改样式，只给消息列分组补稳定测试标记。生成组件的类型化参数和渲染槽是 Loom 接线，不宣称整个官方页面原样运行。五个原适配文件不再包含样式或重复布局；其持久化作用域、历史同步、排序、选择身份、分页及点击回调继续由现有所有者管理。

TextLink 直接依赖原文件；历史遗留 inline 参数由兼容入口丢弃，不重建样式。官方分页区块支持的 incomplete-search 参数默认关闭，Loom 未提供该后端语义，不能据此宣称已实现。搜索外壳、过滤、总加载/错误/空态仍需迁移。动态新版紧凑行来自较新的生产资源，公开源码仍是旧布局；不得为了依赖化回退界面，也不得标为全部原样依赖。

完成标准是：官方原件不改、展示从锁定来源复用、差异集中且可审查、Loom 只拥有必要数据/权限/交互接线；不是清除所有本地代码。Loom 专属记忆、Role/实例、Fork/Side 明确保留官方组件组合。

### 搜索输入、筛选及状态展示（2026-10-22）

`generate-search-controls.mjs` 从锁定 MessageSearchPage 提取输入框与头部、完整五类筛选控件、两个空态、SearchSkeleton 原声明。适配组件只保留状态与参数映射，不再写控件布局。已选状态恢复为官方 `data-has-value`，删除旧底色/阴影覆盖；范围计数采用原生等宽字体，清除筛选按钮恢复原生 sm 参数，浮层过滤栏移除本地额外 py-2。

显式兼容项：输入框中文可访问名称、300 字上限、浮层自动聚焦、输入法期间 Escape 防护；筛选目录未准备时禁用、目录失败重试槽、内层 Escape 消费；本地既有紧凑手机头部；骨架单一 loading region。未启用官方 incomplete-search 后端语义。查询/消息打开失败仍保留真实 Loom 错误与重试，不错误映射为某一种官方搜索错误。页面整体外壳和错误组合尚未标为纯依赖。

正式截图复核补充：Loom 同时展示频道等对象与消息结果。有对象命中、消息为空时，显式使用官方“没有匹配的消息”文案，避免“没有找到关键词结果”否定上方命中；该展示分支补丁有独立回归守卫。

### 搜索／动态收尾与任务展示接线（2026-10-22）

当前第1–2批：搜索与动态错误采用原件 Banner，保留真实失败原因及重试；动态标题/计数/批量已读采用 ThreadsInbox 原 JSX，刷新为显式动作槽。较新版紧凑 InboxItem 不回退公开源码旧卡片；分页、预览和分栏宿主仍由 Loom 控制，后续聊天迁移覆盖其共同宿主。

任务工具栏/标题/IdentityFilterChip、SelectionPopover、CreateTaskDialog、MainLayout 任务外框/标题栏、TaskProperties 的属性与历史容器均从同一锁定源生成。新增原文件保持字节及 SHA256；DialogCard、Banner、TaskTitleRow 直接依赖。生成器唯一定位源码边界，原件变化时失败；测试比较完整生成结果与桥接入口。删除 task-create-adaptation 与 Vite 特殊分支。

显式差异：筛选禁用和测试标记；创建保持冻结批次、fieldset 禁用及未知结果核实槽；详情加载/错误使用同一原生 PanelHeader/PanelAction；属性编辑器保留 Loom 权限和五状态工作流；历史读取保留中止、分页和500条界限。任务原生 PanelAction 取代旧本地 CloseButton/移动返回例外。可选查看消息列动作未接入，不显示空按钮。没有复制官方 store 或改变后端。

边界不是整页零本地代码：搜索/动态保留路由、真实错误、已读和查询控制器；任务讨论仍使用聊天 ThreadWorkspace；较新动态资源移植、全局记忆和 Role/实例差异继续明确登记。此批完成后，后续约4–6个批次：聊天/消息列深层组合（约2批）、Agent/计算机/设置剩余组合、文件、全站整合验收；不以文件数或一次通过的截图宣称全站完成。

正式截图发现的未知计数补充：官方 ICU plural 不能接收“—”作为数值。现在已知数值仍走原格式化表达式，未知状态使用明确文案槽，防止短暂 NaN；独立回归测试先失败再通过。

### 聊天操作、提及、消息列成员与 composer 展示（2026-10-22）

新增锁定 MessageHoverToolbar、MentionLink、ThreadAgentFollowers、ThreadAgentFollowerRow、MessageInput 原件（同 db5e399、保留许可证）。前四者从完整模块生成，明确改接查看者身份、权限、资料预览和关注成员控制器；删除对应 Vite transform。关注成员不再导入官方 socket/store，不伪造活动状态。旧函数移动到离线生成脚本，原件/生成结果/运行入口分别有守卫，不宣称生成文件与原件字节完全相同。

MessageInput 只提取原 Composer 展示子树：输入属性槽、文件工具槽、任务勾选与发送按钮。保留原 full/compact 分支，恢复 CheckboxIndicator 与原生 focus token；移除旧文件入口 Vite 变换。输入法、同一草稿、提交与未知结果保留既有单一控制器，目录/任务/触屏Enter兼容变换尚未全部迁移。新版 MessageInput 还改变上传恢复控制器，本批不复制其服务端/上传业务状态。

@提及采用新版方形已读像素和组件默认预览宽度，显示名及稳定身份映射仍由 Loom 提供。迁移验证发现旧 ProfilePreviewCardContent 的 importer-sensitive Vite alias 在新位置失效，现改为显式 MessageProfile 导入，并补独立守卫和预览/导航验收。较早浏览器脚本的 bg-primary/bg-accent-soft 与英文 Undo 已与锁定 RUI/中文界面不一致，按原生 bg-brand/bg-attention-soft 与“撤销”更新断言，未更改产品来迎合测试。

本批不是完整聊天页完成。后续聊天主线仍需处理 MessageItem、ThreadPanel、Timeline 和输入控制器的深层组合；附件预览/评论及页面外壳保留在迁移清单，不能以本批五个展示边界替代全站验收。

### 消息列与历史窗口（2026-10-22）

`generate-chat-history.mjs` 从同一 db5e399 原件生成 Timeline 全模块与 ThreadPanel 的 ReadOnlyThreadPanel/接口/展示常量。原件字节及许可证按 source-lock 保留；不复制其 AuthenticatedThreadPanel、socket 或业务 store。

Timeline 的官方键盘滚动意图与 sentinel 再检查随源采用；Loom 的有界双端窗口锚点补丁移到离线生成阶段。消息列保持官方标题/副标题、PanelAction、正文原件，只接入已授权快照、成员提及、前后分页、定位、footer/header 操作槽和任务 parentSlot。权限失败仍不显示父消息；保留 compact mobile 的共享 PanelHeader 参数接线。ThreadWorkspace 不再以类型强制转换掩盖接口，两条 Vite 改写已移除。

验证：chat-history-source、thread-adaptation、timeline-window-adaptation 检查生成一致性、边界漂移和权限/分页接线；history-window、threads、channel-tasks 浏览器切片覆盖实际交互。生成一致性不替代浏览器验收。

尚未完成：MessageItem 的新旧源码约 1,800 行差异涉及 Markdown AST、清洗、提及身份和附件，不当作纯展示直接覆盖。完整输入控制器、附件组合和全站壳层仍以迁移清单为准，不能宣布全站纯依赖完成。

### 消息正文 Markdown（2026-10-22）

`generate-message-markdown.mjs` 从同一 db5e399 `MessageItem.tsx` 提取正文渲染 hook 与八项依赖声明，声明正文原样保留，仅显式绑定 import；消息列搜索高亮从官方 `threadSearch.ts` 提取。原始 MessageItem、threadSearch 与六个解析/安全/源对齐模块以原始字节和 source-lock 固定，保留 FSL-1.1-ALv2 来源。解析模块保持相对依赖闭包，不引入官方业务 store。

旧 MessageItem 的字符串占位符/正则预处理已从产品正文路径删除。新路径采用官方 Markdown AST token 匹配、生成内容修复、raw HTML 文本化和 sanitize allowlist；提及身份依旧经过 Loom boundMessageMentions，导航回调、只读权限和附件由原宿主接线。原生引用标识和搜索高亮使用官方 recipe。

实际回归：旧正文把 `~~~` 围栏内的引文加空行、`**bold **` 改写为 `**bold**`、字面量反斜线 n 改成换行；新增浏览器用例先失败，迁移后桌面/390通过。覆盖围栏/行内代码、转义频道引用、危险 HTML/链接和 checked 清单，并复验显示名/资料预览/频道跳转与任务场景。

范围限制：这是正文解析及渲染声明的依赖化，不是整个 MessageItem 替换。消息外壳/附件/状态/反应仍有已登记接线，MarkdownContent/CodeBlock 等共享展示组件仍来自既有采用版本；全站状态以迁移清单为准。

### 共享内容与附件卡片（2026-10-22）

`generate-shared-content.mjs` 将同一 db5e399 的 MarkdownContent、CodeBlock、CustomProtocolLink、CopyButton、CopyIconButton、AttachmentChip 六个完整模块生成到产品中。只更换 import 路径，函数体/原生参数不改；原件和哈希保留。旧入口仅导出桥接，AttachmentChip 唯一兼容包装忽略已废弃且原本无效果的 variant/icon 参数，不改变布局。共享 parser/sanitize 模块直连上一批锁定依赖。

代码面板、引文、表格、图片、链接、复制焦点/反馈和附件卡片加载行采用官方 recipe，正文与文档预览共用同一实现；Shiki/Mermaid 下游尚未整体迁移，不能把六个模块称为整套渲染依赖完成。新增样式断言在旧构建先失败，迁移后验证代码原样复制、安全过滤和原生样式。附件预览旧断言把桌面与手机都写成44px；上一版正式快照复现桌面32px。核对raft-ui0.10.5的icon-lg/伪元素规则后，测试分开验证官方桌面32/-6px扩展与手机44/0px扩展，以及实际边缘命中，不改产品尺寸去迁就历史测试。

### 剩余施工批次估算

固定当前官方源版本，不追逐新发布，预计本批后还需 **4–6轮**：聊天外壳及输入控制器1–2轮；附件预览/评论与工作区1轮；全站分栏导航和Role/计算机/设置剩余组合1–2轮；清理、升级演练及定向跨页验收1轮。此为按依赖范围的估算，不是承诺或完成率。具体退出条件保存在 dependency-migration.json 的 remainingBatchPlan。Loom业务状态、权限、记忆/Fork/Side等原创语义保留为明确接线；收口不是删掉所有本地代码，也不声称未来任意替换上游包无需验收。

### 消息宿主与附件评论批（2026-10-22）

MessageInput、MessageItem、AttachmentCommentsPanel、attachmentPreviewSurfaces 由
`generate-chat-hosts.mjs` 从 db5e399 原件生成，旧路径仅导出桥接，移除四条 Vite
变换分支。AttachmentMetaText 完整模块仅重绑定 import，composerHost 直接依赖原件。
不是未经修改的官方整页，也未启用官方业务 store。

显式差异：Loom 成员 ID/当前显示名与权限、模型标签、任务/反应/关注操作、
Enter/IME/发送覆盖、评论读写和 PDF 整文评论；composer 文件工具槽使用已有 Loom
授权文件界面。保留既有完整时间提示和语义 time 元素。官方新 followOverrides
没有映射为第二份业务状态，已有宿主关注投影仍为真源；旧结构化提及的名称字段由
认证成员目录补齐。按 owner 范围省略原生音视频展示，正文复用此前生成的 Markdown hook。
生成失败即要求审查边界，不能静默猜测替换。

定向自动化和真实部署证据见本批记录。该批全量源码检查保留了 7 条跨页规格断言失败；后继工作区批按实际来源修复测试接线（见下），不能把该旧记录写成当时已通过。剩余按工作区文件展示、
全站布局/剩余资料设置组合、依赖清单及升级演练三批推进，估计 3–4 轮，
以验收结果为准。

### 工作区展示与跨页守卫收拢（2026-10-22）

新增锁定 AgentWorkspace 原件；文件树/截断提示/Markdown组件映射、树头部隐藏与刷新、
原文及预览 JSX 由 AST 提取，旧 WorkspaceNativeParts 仅桥接。DiffPatchStatsLine
单独生成，避免文件树依赖被附件摘要带入首屏。现有文件访问、取消旧请求、分页、
长文本上限和图片外链抑制保持原 owner。Loom 独有 Git 选择器替换原树标题槽；
文件名的屏幕阅读名称与展开状态是显式无障碍补丁，不改官方样式。
页面根目录选择及外框尚为本地组合，纳入下一批布局核对，不宣称完整官方 AgentWorkspace 页面。

上轮七条失败的根因与处理：动态过滤/全部已读/会话头像检查仍读取旧宿主和卡片；
改为核对实际生成组件、国际化 key、Loom 计数入口及原生行头像。两个手机入口检查
仍要求旧 Web 44px/20px 图标，现按已批准 mobile 6559754 的 32px 行/14px 图标
适配及集中 CSS 验证。顶部标题断言错误依赖 class 排列顺序。频道设置检查使用
旧源码14px按钮和旧OverflowMenu外壳；锁定当前源码22px触发器，另验证已采用
Drawer及未保存/执行中的关闭围栏。这些调整未修改产品行为，也没有删除测试。

桌面/390工作区浏览器验证按需加载、原文/Markdown切换不重复读文件、Git diff、
长文本分段、HTML sandbox、PDF隔离地址；新增树目录aria-expanded及32px控件真实
命中测试。全量来源检查已通过，仍不等于全站视觉或真实设备验收。

### 共用分栏／身份与资料外壳（2026-10-22）

AvatarSlot、PixelAvatar完整原件仅重绑定导入，像素JSON进入不可变依赖；旧场景名称
surface-list/members-row分别映射list-row/compact-row，旧叶子size参数在已有头像框内
丢弃，不恢复第二套尺寸。PanelResizeHandle/useResizablePanel直接依赖完整原件，
不再保留本地重复实现；拖动持久化key和分栏状态仍由各宿主提供。

计算机资料hero、运行时属性容器、Role资料hero/identity、设置Panel与正文滚动容器
从锁定原件提取。计算机在线/排空/离线文案来自Loom，不冒用Raft升级状态；原生
IconTile替换本地51px方块。Role配置/实例关系、CLI状态、设备设置和权限归原owner。

同时修复上批生成器遗漏Separator导入，补源码断言及含横线Markdown的浏览器用例。
上批证据中的typecheck成功误报已纠正，保留修正说明；不能把旧记录当作全通过。
当前尚未宣称全站依赖完成：最后一批核对共享展示闭包、顶栏/导航/列表本地组合的
来源分类，并执行固定版本升级演练。预估1–2轮，以实际发现为准。

### 2026-10-22：展示依赖闭包与升级演练

构建模块图发现三条不必要的父页面依赖：Navigation → LeftRail、SavedNav → Sidebar、ThreadAgentFollowerRow → ChannelMembers → ProfilePanel。现在从同一锁定版本 db5e399 的完整原件中提取具名声明，生成 `OfficialNavigationLeaves.generated.tsx`。声明正文保持原样，只收窄 imports；角色/频道/收藏/未读状态继续来自 Loom。原件、许可证及 SHA-256 均在 source-lock 中。不是整页替换，也不是手写视觉复刻。

另修复 Vite 的 API 边界：原规则按 import 字符串匹配，漏掉 `api/overloadRetry.ts` 中的 `./client`。现在按实际目标路径接到现有拒绝未知端点/写入的 Loom facade。发现的是原网络客户端进入产物，没有证据证明发生过云端请求。

生产构建直接检查 emitted chunk module IDs；原 cloud client、上述三张父页面、ProfilePanel 和 AgentMcpTab 再次被带入时构建失败。升级演练验证声明改名时生成明确失败、上游样式变化时生成差异；这是模拟升级，不是已验证任意新版可无条件替换。

全站完成标志仍为 false。剩余是本地页面组合及其他兼容展示模块的最终来源分类；本批消除了已证实的多余依赖，不将仍保留的本地路由、权限和 Loom 专属业务称为官方原件。

浏览器复验同时修复动态页手机返回按钮的无障碍名称漏接：通过官方 `mobileBackProps` 传入“返回聊天列表”，不修改原组件尺寸。导航测试跟随官方筛选名称“筛选收件箱”，继续验证真实入口、键盘、草稿和历史导航。

### 2026-10-22：顶栏、工作区组合与职责分类

`OfficialTopBar.generated.tsx` 从锁定 `AppTopBar.tsx` 的完整返回子树生成，保留原外框、左右区域、edgeBalance 和 SearchTrigger；工作区身份和通知改为 Loom 插槽，移除组织切换/WorkspaceStrip 业务。已采用的 v1.21.26 自适应宽度和本地快捷键标签通过显式参数传入。单工作区非交互名称仍为有来源的本地组合，不宣称整张顶栏无差异。

`OfficialWorkspace.generated.tsx` 扩展到 AgentWorkspace 的外框、路径栏、分栏、文件树容器、拖动手柄、正文容器、文件标题和图片预览原子树。恢复 canvas/seam 配色、原生文件名排版与手机 32px 返回按钮/18px 图标；原图片容器和透明背景也进入依赖。Loom 保留根目录选择/Git选择槽、按需读取、长内容上限、HTML/PDF安全策略；Markdown模式切换保持在现有正文工具位置，未复制官方远程文件服务。

迁移清单现在区分 `retainedBoundaries`（永久本地职责）和 `openMigrationWork`（实际待收口展示组），测试要求二者分离。剩余三组为：身份主从列表、资源/旧版兼容展示、Loom专属组合。计数表示审查分组，不表示三个控件，也不是完成百分比或承诺三轮。`wholeSiteDependencyComplete` 仍为 false。

### 2026-10-22：身份行、旧版实时状态与本地页面复核

Role 行采用 db5e399 `MemberAgentRow` 的原 JSX，计算机行采用 `Sidebar.ComputerRowBody` 原 JSX。生成器只移除不适用于 Role 的实例运行时/双击私聊/上下文菜单，接入 Loom 名称、冻结身份、聚合状态及点击事件；计算机的升级/磁盘/版本信息槽替换为本地主机的真实连接状态。官方 `sidebarItemClass` 提供 Web 基准；已批准的原生 App 紧凑适配继续覆盖为手机 Role 行 34px，不能把 Web 的 44px 基准误报为最终手机尺寸。单击 Role 默认资料、实例活动以及计算机默认选择逻辑仍由原本的 Loom 路由拥有。

实时活动条不在当前 db5e399 源码包内。其 a98ae003 官方原件从初次 intake 提交恢复，SHA-256 与 `adoption.json` 原记录吻合，单独存于 `upstream/compatibility/live-activity`，避免伪造当前版本来源。生成器保留既有单一设计系统兼容调整，提取纯展示声明；`AppearanceRuntime` 继续提供真实观察值，旧连接组件被生产 bundle 守卫禁止。未复制旧活动 store，也未新增活动生成逻辑。

本地专属页面按已有 scenario registry 复核：记忆/Side 的自定 14px X 改回官方 CloseButton 默认 16px；记忆主从分隔线使用原生 seam。其余保留本地语义：记忆修订及来源、Side 只读权限、实例生命期、Kernel 用量统计。资源型兼容组与本地专属组的审查范围、依据和保留原因写入 `reviewedCompositionGroups`，不将它们称作当前官方整页。

剩余一组：Role/计算机的页面外框、共享侧栏标题及 tabs 组合。身份行本身已迁移；全站完成标志继续为 false，避免用局部审查替代所有前端逻辑验收。

### 2026-10-22：固定版本迁移范围收口

最后一组对照了 db5e399 的 `MainLayout` Sidebar slot/resize/主从容器、`Sidebar` 桌面与手机标题、`AgentDetailPanel` tabs 及 `MachineDetailPanel` 外壳。共享标题和 Role tabs 外壳现在由 `generate-identity-frames.mjs` 从不可变原件生成。保留的显式差异：单工作区手机聊天标题/通知槽；Role 的两个固定业务 tabs，不引入官方 Agent 的多标签排序；本地路由控制的 Role/实例 inspector 和计算机默认选择。侧栏尺寸、拖动与断点沿用已迁入的官方 bounds/resizer 和既有响应式策略，未另造一份状态。

外层 MainLayout 不能整件导入：它拥有官方组织、云账户和 store 路由。Loom 的 AppShell slot 组合因此作为永久适配层保留，而不是继续列为待迁移。`plannedMigrationComplete=true` 表示本次固定版本、已登记范围的迁移及来源分类完成；`wholeSiteDependencyComplete=false` 明确保留“并非所有页面都是未经修改官方原件”的事实。这不是最新官网全站逐像素一致、任意升级可无验收替换的声明。后续升级按 source-lock 差异、生成器差异、构建依赖守卫及受影响场景验证推进，不继续为永久业务 owner 开迁移任务。

### 升级前的一次性差异检查

运行 `npm run audit:official-web:upstream -- /绝对路径/官方源码checkout`。该命令只读文件，不拉取、不替换源码、不改来源锁，也不启动服务。JSON 分别记录：

- `sourceDependency.summary`：当前不可变依赖与候选源码的差异汇总。
- `summary`：初始 intake 与当前适配代码、候选源码的三方分类，不能与不可变依赖混为一谈。
- `candidate`：候选提交、工作区是否有未提交/未跟踪文件；目录快照没有可证明的提交身份时明确记录未知。
- `localIntegrity`：所有已登记路径的本地漂移汇总。原件或未登记适配变化不会被“与候选恰好相同”掩盖。

退出码 0 表示该次比较没有本地漂移或缺失路径，**不代表 UI 验收通过**；退出码 2 表示需先核对本地漂移或缺失路径。上游正常修改仍通过 JSON 分类报告。历史 intake 的缺失路径可能是官方移动/删除，也可能是 checkout 不全；不能直接当作未实现功能。只将确认影响当前保留界面的差异带入生成器、构建及定向浏览器验收。源码升级、资源型兼容端口和 `raft-ui` 包升级仍是不同来源，不用一个 Git 提交号替代三者。

本次对已保存的 db5e399 干净 checkout 实跑：当前依赖 86/86 字节相同，登记路径本地漂移为 0；旧 intake 对比仍有 140 个候选缺失路径，因此命令退出 2，未声称全量历史路径核对完成。该结果不改变已部署产品，也不表示检查过在线官网的最新发布。
