# Raft / RAH 组件样式源码审计（2026-09-20）

本次只审计，不修改产品 CSS、组件或正式运行实例。目标是识别可源代码对齐的差异，
不以截图相似度或组件数量宣布「90%」。同一组件的尺寸、颜色和各交互状态须分别验证。

## 证据与边界

- R1：本地分析副本 `/tmp/raft-20260916-audit/web-index.js`，SHA256
  `7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
  下列位置为 JavaScript 字符偏移，非字节行号。主要入口：Button `S9e/C9e` 2179579–2180184，
  Tooltip `Fj` 979650 附近，Dialog `eo/Td` 2316554/2317578，
  Agent preview `B5/OQe` 2502158 附近，Thread followers 2903274–2905700。
- R2：同目录 `AgentDetailPanel-CW_VMZT6.js`，SHA256
  `918921bbb932ed020285d2f3639c0a5511249f4bca1d2468628da995078a37e3`；
  运行时配置底部按钮 114300–114750，明确 `px-4 py-2 text-sm`。
- R3：授权冻结 CSS `raft-ui/vendor/raft/index-EQxYM8hQ.css`，SHA256
  `36d9e3d1cb74dd7638c87f7544042c77da547302a0e98112d95ad702be91d3d6`。
  仅供分析，不是生产依赖。
- R4：`packages/ui-tokens/src/neo-brutalist/extracted/raft-official-*.css`，
  文件声明 Raft build `666bab60d8658d9e382e2c286ce1e423231e8f31` 的源码/实测提取。
  属历史规格，不能独自证明 R1 同版本或者当前线上也完全相同。
- RAH：当前工作区源代码；另在正式 Chromium 1440×1000 下只读测量关注菜单、运行时编辑窗口。
  [计算样式记录](2026-09-20-ui-style-source-audit.measurements.json)。未提交配置、移除成员或启动 CLI。
  首次编辑窗口测量在 React 提交前抓到 missing，已等待窗口挂载后重测，最终文件只保留有效结果。
- 已检查样式入口、后置规则及专用覆盖。例如创建 Agent 的旧 704px 高度规则被后置规则改为 auto，
  离线灰点的估读 fallback 被 product.css 覆盖；两者不能当作当前正式缺陷。
- 没有逐页逐状态进行 Raft 当前线上双边截图验收；下表「历史匹配」不等于完整验收。
  未对全部 lazy chunks 的每个组件宣称完成。源码证据不足的项目明确列为待补。

## 明确差异与整改优先级

| ID  | 组件/维度                 | Raft 源码                                                      | RAH 当前值/位置                                                                   | 裁决                                                                                |
| --- | ------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| D01 | 运行时编辑底部按钮字号    | R2 `text-sm`：14px/20px                                        | `.rah-runtime-edit-dialog footer .btn` 正式测得 13px，未明确 line-height；38px 高 | 明确差异，应改组件变体，不全局替换所有 13px                                         |
| D02 | 同一按钮水平内边距        | R2 `px-4`：16px                                                | `styles.css .btn`：14px，正式相同                                                 | 明确差异；文字宽度、点击面积均变小                                                  |
| D03 | 运行时编辑标题行高        | `Td`：18px/28px、700                                           | `agent-directory.css` 只设18px/700；正式标题高度25px、line-height normal          | 明确差异，字号对齐但行高漏了                                                        |
| D04 | 关注菜单标题              | R1 `px-3 py-2 text-sm`：12px/8px、14px/20px                    | `product.css`：12px/10px、14px、未设行高；正式42px高                              | 明确差异；Raft此结构推导38px高，须双边实测复核总高度                                |
| D05 | 关注菜单成员姓名          | R1 `text-sm font-bold`：14px/20px、700                         | `.rah-thread-follower-row b`：13px；正式13px/normal                               | 明确差异                                                                            |
| D06 | 关注菜单行结构            | R1列表p-2；行px-1 py-1.5 gap-2；内部按钮px-1 py-1、头像28      | RAH无相同列表padding包装，行8px 12px、gap9、min-height52，内部gap9                | 明确结构差异，不能仅改一个行高；应按盒模型一起校正                                  |
| D07 | 关注菜单行分隔线          | R1映射行中没有 border-top                                      | RAH相邻行1px black/10                                                             | 明确额外装饰，整体观感比上游更像表格                                                |
| D08 | 关注菜单距触发器距离      | R1 GU `sideOffset:6`                                           | RAH absolute top=100%+8px                                                         | 明确差异，偏离2px；定位机制本身不是必须字节照抄                                     |
| D09 | Agent资料浮窗字段标签颜色 | R1 B5 `text-black/45`                                          | `preview.css .rah-agent-preview dt` 使用 black/40                                 | 明确差异，RAH更淡                                                                   |
| D10 | 通用文本按钮规格体系      | R1 S9e：24/28/32/40px档位，对应11/12/14/14px，明确leading-none | RAH `.btn` 通用13px、8px 14px、继承行高；仅部分页面覆盖                           | 架构性视觉债；不是所有 .btn 都能套同一 Raft size，需要逐调用点指定                  |
| D11 | 通用弹窗外框              | R1 Td默认448px、p24、card shadow4，调用方可指定宽度            | RAH `.rah-dialog`默认520px、shadow6、header14px16px、form18px，且max-height720px  | 公共默认规格不对应；专用创建/编辑/确认窗口已覆盖的不能重复报错                      |
| D12 | 通用弹窗字体              | R1 Td标题18/28/700；o0字段标签14/20/700                        | RAH默认标题17px/800、label12px、普通input12px mono                                | 明确默认体系不同；后续调用审计确认旧任务关闭/改派组件未被引用，不能算作当前页面缺陷 |
| D13 | 缺少完整状态规格          | R1各按钮/菜单有各自disabled、hover、pressed、focus参数         | RAH全局disabled .45与专用 .4/.3/.5共存；--muted单色与black/40/45/50/60并存        | 不是数值多就错误；未绑定组件变体的通用回退属于风险，不能全局统一透明度              |

D01–D08 的问题与最近修复不冲突：头像组、透明穿透、绿色提示已修复，
不意味着整个关注弹层的字体、密度、距离全部对齐。

## 逐组件核对矩阵

标记：**差异**=本轮源码可直接指出；**匹配**=所列属性一致，不包含其他属性；
**历史匹配**=与R4/既有证据一致，尚未对同版R1所有状态重验；**待补**=不猜尺寸。
所有尺寸默认 CSS px；rem 按16px根字号换算。中文实际字形由系统fallback决定。

| 组件族                     | Raft规格/来源                                             | RAH对应 owner                                | 结果与要挑的问题                                                                     |
| -------------------------- | --------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------ |
| 结构边框                   | R3/R4主要2px实线黑；细分隔线1px加透明度                   | tokens/styles/panel-layout                   | 基础匹配；不能让父子两侧各画2px叠成4px，是否叠加须按页面测量                         |
| 主色板                     | R4黄#ffd440、粉#fe7da8、青#27ccf3、奶油#fffaef、绿#a9d877 | extracted/raft-official-tokens.css           | 历史匹配；不要把截图色偏判成token差异                                                |
| 正文/边框墨色              | #141111正文；黑色结构边                                   | 同上                                         | 基础匹配；不同文字角色仍有D09/D13                                                    |
| 硬阴影                     | 1/2/4/6px，按组件档位                                     | 同上                                         | 档位存在且匹配；弹层错误选档仍可能发生，不能以token存在证明调用正确                  |
| 字体族                     | display / mono角色分开                                    | official-fonts、tokens                       | 基础导入匹配；运行时picker使用system-ui，需针对上游字段角色复核，不能统一改成Grotesk |
| 字号/字重                  | 12/14/16/18/20/24；500/600/700                            | tokens、页面CSS                              | 基础档位匹配；13、17、800散落通用组件，D01/D03/D12须处理                             |
| 主导航栏                   | 64px；普通40px方钮、18px图标                              | styles/panel-layout                          | 历史匹配，正式宽64px；短高度变体另有36px，不应一律40                                 |
| 页面头部                   | 62px；左右20px；gap12                                     | panel-layout                                 | 历史匹配；正式消息列头部62px/20px/gap12                                              |
| 页面标题徽标               | 36px徽标、18px图标                                        | panel-layout                                 | 历史匹配                                                                             |
| 聊天目录分组/行            | 12px分组，14px会话名；头像与按钮分档                      | styles、identity-interactions                | 历史匹配；移动端更紧凑是已记录本地差异，不纳入桌面缺陷                               |
| 普通方形按钮               | R1 size 24/28/32/40；图标依具体调用                       | styles .sq-btn                               | 主用档位已适配；sm图标13px缺对应上游变体证据，不能认定全对                           |
| 文本按钮                   | R1 S9e/C9e                                                | styles .btn                                  | 差异D01/D02/D10；颜色正确不代表尺寸正确                                              |
| 发送按钮                   | 独立disabled opacity .3                                   | interaction-state                            | 历史匹配；不能套普通按钮 .4                                                          |
| 按钮交互                   | hover上移1px/阴影4；按下1px/阴影1                         | interaction-state                            | 源码有对应映射；全调用点状态验收未完成                                               |
| 通用Tooltip                | R1 Fj padding4px10px、13px/18px、max320px、2px边          | tooltip.css                                  | 几何/文字匹配；bg-primary语义映射、kbd特殊padding需同版主题证据，不宣布完全匹配      |
| Agent/Human浮窗外框        | 既有证据宽280、边2、影4                                   | preview.css/identity-interactions            | 历史匹配；字段颜色D09仍有差异                                                        |
| Agent浮窗身份/参数         | R1 B5 gap12/p12，14px姓名、12px账号、11px参数             | preview.css                                  | 大部分对应；标签45%/40%差异，身份垂直对齐细节待测                                    |
| Agent浮窗最近动态          | R1 OQe标题10px、内容12px、时间10px、行间6px               | preview.css                                  | 源码结构已对应；不代表所有截断和长文本情况已验                                       |
| 状态圆点/头像              | 尺寸因surface/mention/header不同                          | identity.css、Avatar组件                     | 已有角色变体；离线色最终product.css覆盖fallback，不能误报为估读色                    |
| 关注者头像组               | R1 18px、白边1px、重叠4px、最多3、gap4、按钮28            | product.css                                  | 本轮正式测量匹配                                                                     |
| 关注菜单外框               | R1 w72=288，GU包装                                        | product.css                                  | 宽/白底/边2匹配；shadow6是否正确须继续解析GU主题，未猜成缺陷                         |
| 关注菜单标题/成员行        | R1 2903274后                                              | product.css                                  | 差异D04–D08，详见上表                                                                |
| 关注者移除按钮             | R1 size7=28                                               | product.css                                  | 正式28×28、白底、边2；交互状态需独立核对                                             |
| 移除成功通知               | R1 To.success/solid success/lime                          | product.css                                  | 绿色、确认图标、黑色撤销已适配；完整toast尺寸/堆叠不因此宣布逐像素一致               |
| 省略号/右键菜单            | R1共享菜单另有variant与调用override                       | action-menu、product/context-actions.css     | 待补全菜单variant映射；本地多套min-width/padding不应强行归成同一个尺寸               |
| 任务大页头部/过滤器        | R4头62/toolbar58/filter32、12px/16px                      | extracted/tasks、global-discovery            | 历史匹配，页面覆盖和R1新版需继续逐状态验                                             |
| 任务空态                   | R4 padding48px24px，icon36，标题18/28，正文14/22.75       | body-primitives                              | 历史匹配；空态高度不能推广为非空看板规格                                             |
| 任务下拉筛选               | R4宽220、header32、search30、row36、avatar20              | discovery-controls/任务样式                  | 历史规格已接线；不同筛选器内容高度是数据相关，不应固定照抄                           |
| 任务看板/任务列表行        | R1专用板/卡片/行组件                                      | global-discovery等                           | 待补当前同版全部状态；需要标题换行、owner/计数、选中/hover分别比较                   |
| 任务审批窗口               | 既有TaskModalHead与thread modal证据                       | task-detail.css                              | 已有独立尺寸/完整讨论呈现；任务窗口不是通用448px表单，不应一刀切                     |
| 任务状态/负责人属性        | 同行成组，窄屏整组换行                                    | task-detail.css后置覆盖                      | 已有专门修复，不能用前面的dt margin规则判定最终仍上下排列                            |
| 任务关闭/改派表单          | 同业务Raft入口尚未完整定位                                | task-dialogs.tsx→通用rah-dialog              | 受D11/D12默认体系影响；确切业务对标尺寸待补                                          |
| 动态页过滤条/卡片          | R4 toolbar54/filter32；卡片p12、gap8、边2 black/30        | activity.css、global-discovery               | 历史匹配；标题/摘要/时间分别14/12/12，不应统一字号                                   |
| 搜索框/筛选                | 已有源合同input14/20、filter32                            | search.css、discovery-controls               | 历史匹配；搜索框、模型下拉、普通表单不是相同密度                                     |
| 创建Agent弹窗              | 448宽、p24、标题18/28/700                                 | product.css后置create覆盖                    | 已有专用对齐；旧固定704px规则已被覆盖，不报当前问题                                  |
| 编辑运行时弹窗             | R2/Td 448/p24/影4；按钮14px、px16                         | agent-directory.css、agent-runtime-dialog    | 框架正式匹配，标题行高与按钮D01–D03不匹配                                            |
| 创建频道弹窗               | 448/p24专用表单                                           | product.css room-create                      | 专用覆盖已存在；成员选择区与错误态仍须逐状态比较                                     |
| 创建分组弹窗               | Z8 max-w-sm=384/p20；label12/16                           | section-create-dialog.css                    | 源码参数有明确对应；并非所有弹窗都p24                                                |
| Agent重启/停止确认         | 专用确认与reset结构                                       | product.css专用规则                          | 已有448等变体；字体含system-ui是有来源的局部裁决，不能当作全局字体错误               |
| 频道添加成员               | 紧凑行、黑勾选、蓝色已选chip、复用创建                    | room-member-pages.css                        | 近期专项源合同覆盖；本轮未再进行全部交互双边验收                                     |
| 设置/Computer页面          | R4提取＋后续专用组件                                      | settings/profile/computer-directory          | 可用历史证据；不以页面标题对齐推断开关、表格、错误条全对                             |
| 文件/附件/评论/预览        | 专用预览和评论sheet；不同媒体不同布局                     | room-files/media-preview/attachment-comments | 待独立同版组件审计，不伪称有统一弹窗尺寸                                             |
| 本地连接页/诊断/运行时管理 | Raft无完全相同本地部署页面                                | product/runtime-settings                     | 无一一业务对应；应用同一视觉基础，但不计入官方对应完成率                             |

## 为什么目前不能给出「90%以上」

可以高比例复用的是同一主题的基础属性与重复组件；不能直接把四种按钮、几十个
弹窗都折成一个参数。当前存在旧提取值、现代组件variant、RAH通用默认值、后置修补
四层来源。样式正确需要命中的最终规则一致，而非源文件中出现过正确数字。

要统计比例，先固定同一Raft版本与brutal主题，再按「组件×实际使用变体×状态×尺寸」
列分母，逐项标记已验证/差异/有意差异/待证。未验证项不能算通过，历史证据不能混充
同版证据，本地独有组件应单列。当前报告不提供虚假的精确完成率。

## 建议修复次序（尚未实施）

1. 先处理D01–D09：有明确来源、影响可见、范围小；每项先加真实外观/几何断言。
2. 建立文本按钮size与表单弹窗variant，逐调用点替换D10–D12；不要直接全局替换
   所有13px/800或者把所有弹窗改448px，那会破坏Tooltip、局部标题和大型审批窗口。
3. 把关注菜单、运行时编辑等完整组件加入规格登记；不仅登记sq-btn、sidebar-row、message-row。
4. 按任务→动态→成员/设置→文件附件顺序补同版非空/长文本/hover/focus/disabled矩阵。
   同尺寸、DPR、缩放和数据前提下作双边验收，区分源码对应与视觉实际结果。

本次仅新增审计与计算样式证据，不构建、不重启未变更的产品。文档执行格式与diff检查。

## 修复记录（2026-09-20）

D01–D09 已修复：运行时编辑动作14px/20px、8px16px内边距，标题18px/28px；
关注菜单增加padding8/max-height288的滚动列表，行padding6px4px、gap8、
头像28px、姓名14px/20px；去掉额外行分隔线，标题padding8px12px，弹出距离6px。
Agent浮窗字段标签使用black/45。既有消息身份、移除授权、撤销、焦点与关闭路径保持原owner。

D13 的运行时编辑按钮禁用态实际测得opacity1；新增测试复现后按R2明确的
`disabled:opacity-50` 修为0.5。不统一覆盖其他组件的0.3/0.4等有证据变体。

D10–D12 为通用默认样式与调用迁移债，不能一次全局换值。进一步全仓调用搜索确认
TaskReassignDialog、TaskCloseDialog 只有定义、没有引用；此前将它们表述为当前入口
受影响不准确，予以撤回。创建Agent/频道、任务审批、运行时编辑、分组、确认框均有
自己的适配规格；本批未为不存在的实际入口新增变体或修改这些已适配框架。
其余缺少同业务来源的弹窗不宣称完成视觉一致性验收。

三个真实浏览器回归先红后绿：thread-header-menu捕获标题内边距、行结构/字号/头像；
runtime-edit-hover捕获标题行高、按钮尺寸和禁用透明度，并检查390px无横向溢出；
agent-hover-navigation捕获标签40%与45%的差异，继续检查悬浮资料跳转。
已人工查看390px编辑窗和桌面关注菜单截图。类型检查、正式构建、相关CSS门禁及diff检查通过。
完整check仍停在已有worker/message-present登记项；全仓格式仍有原来的5个文件问题。

正式状态经安全守卫备份并重启，冻结构建
`401c56dc6b31d9ffbb5f355821a834a86271b8bfabcd67ecd4200f2d09f110f6`。
新浏览器真实Solars关注菜单测得：标题38px、行48px、姓名14px/20px；
运行时编辑标题28px、动作按钮40px高/14px字号/左右16px内边距。
1440与390宽度截图已检查，无横向溢出；本轮未提交正式配置或移除正式成员。

## 创建 Agent 快速模式补修

用户报告创建窗口出现巨大原生勾选。回归测得复选框宽396px而非16px：
创建入口使用裸input，编辑入口的Raft sL/iL选项卡样式只限定runtime-edit-dialog。
现在两处复用RuntimeFastMode组件与同一限定表单样式，16px框、12px勾选图标，
label点击和键盘Space保留原生checkbox语义；创建label不再生成普通字段的辅助占位。
RuntimePicker自定义模型菜单项按用户要求缩写为「自定义」，文本框标签及原生ID绑定不变。

新增创建入口1440/390几何与交互回归，先396≠16失败后通过；自定义菜单用例先因
旧名称失败后Claude/Codex均通过；原编辑入口选项卡及成员页面回归通过。
类型检查、正式构建与diff检查通过；全仓库仍受既有登记和5个格式文件阻断。

首次正式重启被在途Activation守卫拒绝，未停止进程；等待执行结束后再次安全备份重启成功。
构建`a77ea15513a3afaf94ffac36c6d2f25bcf1b6acc3ce8773aff00dfa4df141c83`的真实创建窗口
已检查Codex模型菜单「自定义」、选中快速模式的16×16几何，以及1440/390截图。
只操作未提交表单，取消退出，没有新建Agent或启动付费CLI。

### 快速模式卡片：选择与黑色勾选

用户要求快速模式卡片禁止双击选中文字，并采用黑底白勾。复核 Raft
`web-index.js` 的 `HFe`：black fill 选中态使用
`bg-line-strong text-foreground-inverse`，md 图形为 16px、12px SVG、stroke-4。
发布包 SHA256 为
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
Multica `packages/ui/components/ui/checkbox.tsx` 使用主题 primary 色和圆角，
不适用于本次 Raft 黑色方形目标。RAH 保留共享 RuntimeFastMode 的原生 checkbox
键盘行为，样式结构移植黑底白勾，并按用户要求在整行设置 user-select:none
及 WebKit 对应属性；创建、编辑使用同一组件。

`test-member-ui-details-browser.mjs` 原黄色断言已改为黑底白勾及真实双击无
文字选区断言，修改前颜色断言失败。保留整行点击、Space 切换及保存 priority
的检查；创建入口由 `test-create-agent-fast-mode-browser.mjs` 覆盖。

### 模型选择器下方原生 ID

按用户最新截图要求，移除共享 RuntimePicker 下方的 provider/model ID 独立说明行。
创建 Agent 与编辑运行时配置共同生效。菜单项的原生 ID title/searchText、
自定义 ID 输入和实际保存值保持原有语义。此为用户指定的局部显示调整，
不是修改模型发现或匹配规则。

创建、编辑浏览器门禁均增加“模型字段没有独立原生 ID 说明行”的断言；
编辑门禁在修改前以实际 1 行、预期 0 行失败。

### 快速模式字段间距与显示条件复核

创建表单此前直接放置 RuntimeFastMode，遗漏 `.rah-runtime-edit-field` 的字段
间距，浏览器实测到“更多”仅 4px。现复用编辑运行时窗口的“模式”字段结构，
创建／编辑浏览器测试均要求至少 16px，创建覆盖 1440px 与 390px。
沿用本页既有 Raft option-card 来源与本地表单字段布局，不另建样式 owner。
Multica 未提供可直接复用的同名快速模式字段。

显示条件仍由 `agent-runtime-capabilities.runtimeFastTier` 单独决定：所选模型
必须存在经 probe 验证的 supportedServiceTiers，包含 priority 或 fast；未选择、
未知自定义模型与缺少能力证据的模型均不展示，不能把无证据解释为绝对不支持。
Codex catalog probe 从每个模型的 service_tiers 读取，不根据名称硬编码。
本次仅修复布局，没有扩大模型能力或更改服务档位提交规则。

验证：能力单测 6 项、创建与编辑浏览器回归、typecheck、正式 bundle 构建通过。
全仓 check 和 format:check 仍为既有接口登记／五个无关文件格式阻断。
活动工作结束后完成持久状态备份与安全重启；正式页面桌面／390px 验证快速
模式样式及至少 16px 间距通过，取消未保存表单，没有调用真实模型。

### 自定义模型双控件状态

按用户明确指定的 UI 规则，复用创建／编辑共同的 RuntimePicker：Codex 与 Claude
选中自定义后，trigger 文案与菜单选中项均保持“自定义”，不再从空 binding 值
退回“请选择”；填写原生 ID 后也不将该 ID 替换进 trigger。切回目录模型隐藏
输入框。移除输入框上方重复的可见 label，保留 aria-label，并以灰色 placeholder
显示“自定义模型 ID”。不改原生模型 ID 编码、校验或运行时提交规则。

新增浏览器断言先在“模型：自定义”不可见处失败，修复后覆盖 Codex／Claude
自定义、空输入、填写后文案、菜单选中态及切回普通模型隐藏输入；编辑运行时
入口亦检查相同行为。沿用既有共享控件与样式，本项是用户指定的呈现修正。

本批完成 typecheck、正式构建、隔离浏览器与本批格式／diff 检查；全仓仍受
既有接口登记及五个无关文件格式问题阻断。完成持久状态备份与安全重启，
正式页面 Codex／Claude、桌面／390px 自定义选择与切回目录模型验证通过，
全部取消未保存表单，无 Agent 创建或付费模型执行。

### 自定义模型输入置于下拉框上方

后续用户截图覆盖上一节的上下顺序：现在为模型标题、原生 ID 输入、自定义下拉。
共同 RuntimePicker 将输入框置于 DiscoveryFilter 之前，保留 placeholder 与
aria-label，移除原额外说明行；两控件之间使用 8px 间距，本值为用户要求的
紧凑间距本地取值，不声称从截图抽取的 Raft 尺寸。保留现有聚焦／悬停边框和
阴影，未全局修改输入或下拉控件。

浏览器先复现输入框在下方（相对间距 -89px），再要求桌面／390px 中输入框
位于上方且聚焦输入、悬停下拉时净几何间距 6–12px、两框同宽；覆盖 Codex 与
Claude 选择模式及切回目录模型，编辑入口复用同一组件。

本批隔离 Codex／Claude 与编辑入口回归、类型检查、正式构建通过；排除创建表单
空说明伪元素后间距回归通过。全仓仍有既有登记和五个无关格式阻断。
已备份并安全重启正式实例，正式桌面／390px 的 Codex／Claude 输入顺序、
聚焦／悬停间距、切换目录模型验证通过，取消表单未保存，未触发真实模型执行。

## 自定义模型输入框高度与字号

编辑运行时窗口的自定义 model_id 输入框继承了通用弹窗的 12px 字号，实际高度 39px；同组下拉框为 16px/24px、44px 高。共享 RuntimePicker 的 input 现与下拉框使用同一条尺寸、字体及内边距规则（44px 最低高度、16px/24px、8px 12px padding），保留已有 8px 间距。未改变模型绑定或保存校验。

`test-member-ui-details-browser.mjs` 新增桌面/390 高度及字号相等断言，先以 39/44、12/16 复现失败，修复后通过；创建入口 `test-create-agent-fast-mode-browser.mjs` 同样验证高度、字号、宽度和聚焦间距，通过。
