# 消息列、资料页与搜索对齐

来源：Raft Web `index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，
授权 `2026-09-13-dialog-audit` 归档。格式化源码 163432：关注 Agent 的内容按钮
`rounded px-1 py-1 hover:bg-black/5`；165035–165104：搜索输入框 border-2、
14px 字体，28px 按钮与14px chevron/X；147319：选中消息 cyan/25、黑边及固定阴影；
171100：共享 thread-layout-container。沿用已有来源许可记录，本批为结构移植与 RAH
接线，没有把分析 bundle 引入产品。Multica 未提供更完整的同款 Room/Thread/资料页契约。

布局 owner 仍为 App + useConversationLayout：资料页占用真实宽度后，剩余聊天区域
继续按680px边界决定 Room/Thread 并排或只显示 Thread。删除原先“打开资料页隐藏
Thread”的规则；收起的是 Room 正文，不是资料页。保留组件、草稿与消息状态，不改
业务协议。桌面关闭 Thread 恢复 Room；关闭资料页释放共享区域。移动端资料页独占
内容区，关闭后恢复原对话，不叠加可交互聊天内容。

关注行取消负边距，内缩4px圆角，保留独立移除按钮；与上游一样仅显示名称。
搜索复用现有后端查询和全文命中标黄，输入框/按钮使用维护中的 token 和图标，
当前消息使用蓝底黑框及固定阴影。既有 Enter/Shift+Enter 和 Escape 行为保留。

浏览器回归覆盖：先复现0px圆角和资料页占用消息列的失败，再验证宽屏并排、缩窄
隐藏正文、关闭两类面板的恢复、键盘打开资料、移除独立、搜索2个命中逐项切换、
蓝底边框阴影以及390px布局。正式部署与完整检查结果在交付时另行说明。

## 交付验证

完整 `npm run check`、`npm run format:check`、`git diff --check` 和
`npm run build:web:workbench` 通过；隔离真实浏览器回归通过。正式实例空闲后完成
状态备份及安全重启，新进程使用冻结构建
`423b10bc7a73193297e5c22cb847abbf4cdce8fa64d61cce5b7a99b5d7a722e0`。
本机、LAN、Tailnet 三入口的新页面验证搜索框黑边及1200px下消息列与资料页并列。
正式页面使用已有消息深链检查，未发送测试消息/启动付费执行。
上一批系统频道字号与即时目录刷新代码亦随本构建上线，正式三入口按钮规格复核通过。
未声称官方在线同条件双边验收。

## 搜索框聚焦描边续修

Raft 同包格式化源码 165059 的 thread-search-input 使用 `outline-none` 与
`focus:shadow-brutal-sm`；同包 CSS 定义后者为右下 2px、无模糊/扩散硬阴影。
本地 `.rah-thread-search input` 的 outline:0 被全局 `:is(...):focus-visible`
更高优先级覆盖，浏览器复现 outline=solid，叠加原 2px border 形成四周厚框。
在现有搜索框 :focus owner 明确 outline:none，保留原 2px 边框与已正确的
shadow-s；不修改其他控件聚焦规则，键盘焦点仍以硬阴影可见。
浏览器测试先复现四周 outline，再验证点击及 Tab 返回时无 outline、保留边框
与右下阴影，并沿用搜索高亮和跳转回归。此处为源码参数对齐与本地 CSS 修复。

续修验收：Chromium/Firefox 专项、完整检查、格式及 diff 检查、正式构建通过。
完整检查首次被并行修改中的附件发送按钮规格阻挡，相关规格同步后复跑通过；
本批没有修改附件按钮。正式实例经空闲检查、持久数据备份、安全重启，三入口
新浏览器页面均验证搜索框点击和键盘聚焦，已检查聚焦截图，未修改正式消息。

## 顶部关闭与返回的响应式续修

用户最新合同取代此前“窄屏也保留 X”的要求。Raft 已归档授权 bundle
`index-MqTUR4Ez.js`（SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`）
格式化 164954、164981–165027：关闭入口按面板模式决定，返回入口交给共享
PanelHeader；结合本次宽/窄截图，将该条件映射到既有 conversationLayout。
这是本地条件适配，不是逐字复制。来源与授权边界沿用本文前述记录。

单一布局 owner 仍为 conversation-layout/use-conversation-layout 与现有 Shell
CSS：split 显示 X、隐藏返回；replace/fullscreen 隐藏 X、显示返回。
关注入口仍仅在非零人数（或首次尚未读到结果）时出现。资料页占用的实测宽度
继续从正文/消息列可用宽度扣除，手机继续仅展示最上层，关闭后恢复原面板。
不新增导航状态或 DM Task 独立页面。

header 浏览器用例先复现900px下 X 未隐藏；修正后通过。profile 浏览器用例
覆盖并排、1200px挤占正文、390×844资料页独占、关闭回消息列保留草稿、返回
正文，以及原有指针、键盘、关注确认和搜索路径。正式验收记录见本节后续。

续修验收：Chromium/Firefox 专项通过，另补验 DM 桌面资料页并排与390×844
独占/关闭恢复；完整 npm run check、格式检查、diff检查及正式构建通过。
正式工作台经过空闲检查、验证持久状态备份和安全重启，新浏览器在本机、LAN、
Tailnet 三入口验证 split/replace/fullscreen 与逐层返回，并检查桌面/手机截图。
首次正式脚本直接深链未完成初始化，改为先进入根页面建立已有认证上下文、
读取当前 Room 列表后全部通过；没有修改正式消息或调用付费 CLI。
390×844 为浏览器视口验收，不声称已在物理 iOS PWA 或官方 Raft 在线双边验收。

## 窄屏返回按钮间距续修

同一授权 Raft bundle 的 pf（98147–98233）使用 px-5、gap-3，即左右20px、
返回按钮至标题12px；actions内部单独gap-1.5保持6px。Thread传入的Ao只控制
position/z-index/shrink，不覆盖这两个距离。本地共享PanelHeader基础规格正确，
但thread专用gap:6px覆盖导致标题过近，现移除此覆盖。左侧20px原已匹配，保留。
浏览器先复现900px时left=20、gap=6，修正后验证left=20、gap=12。

间距续修验收：完整检查、格式/diff检查、正式构建与消息列浏览器专项通过。
正式工作台经空闲检查、备份、安全重启后，三个入口新页面验证390px的左20px/
标题间距12px及逐层返回；已检查正式截图。未更改正式业务数据或运行付费CLI。
