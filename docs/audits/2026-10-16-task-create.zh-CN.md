# 官方频道任务入口与多行创建

## 官方实际

锚点为 v1.21.16 `app-shell-L7litFx-.js` 的 createTasks、多行创建对话框与频道标签组合；发布URL/hash见[顶栏来源证据](../evo/evidence/2026-10-16-native-topbar/upstream.json)。冻结源码 revision `a98ae003246a0360872a77d76dec2fccd0347ef7`：`packages/web/src/components/message/ChatPanel.tsx`、`task/{TasksPanel,CreateTaskDialog,TaskTitleRow}.tsx`、`store/taskStore.ts`。保留原始 FSL-1.1-ALv2 通知和 owner 授权，原文件未修改。

官方 New Task 入口仅在频道模式显示；全局任务页没有隐含频道，不显示创建按钮。批量创建是多标题提交，不是通用批量改状态。

## 复用与本地衔接

- **直接复用** CreateTaskDialog 的呈现、TaskTitleRow、DialogCard／Modal、按钮与翻译。严格标记检查的构建适配只替换官方store／提交控制器，增加提交中fieldset锁定和未知结果核实按钮，不调用上游任务API。
- **结构移植** ChatPanel 的 ConversationPanelTabs／Tabs／SortableTabsList／SortableTabsTab／TabsLabel／TabsIndicator 组合、图标、h-7参数和chatTab URL；仅保留聊天／任务，未接Files不展示。复用既有TasksPage作为频道内容，不重复标题，不显示频道筛选，传入频道模式参数避免卡片重复频道名。全局页面保持无创建按钮。
- **唯一写入者**仍是频道原有 `ChannelTaskClient`、`RoomSession`与`WriteIntentSlot`。表单按标题顺序逐项提交，下一项须等前一项被证明成功；每项有独立幂等键和最新因果基线。它是一次表单提交进度，不是新的后端队列／事务／Task状态。
- 成功项从待提交标题中移除；明确拒绝立即停在未完成项，保留剩余标题，可编辑后重新提交。未知结果保持原slot、键、载荷与基线，冻结编辑／关闭／站内导航，显式核实后才继续；不会用新请求重建整批。部分成功不是原子回滚，不宣称全有或全无。
- 频道聊天视图在任务标签打开期间保留挂载，隐藏而不销毁composer，以保留未发送草稿和既有写入所有者。切换标签用replace，沿用URL选择，不增加多余返回历史。

## 验证与边界

新增专项先复现缺少频道任务入口；纯提交测试先复现无批量控制器。另复现频道卡片误用全局参数导致重复频道标签，再修复为官方参数。1440×1000、390×844，DPR1：三行创建；第二项已提交但响应丢失，第三项暂停；Escape／站内导航不能丢弃未知请求；原请求精确核实后仅三条持久Task。第二批首项成功、次项403拒绝，表单仅保留失败标题，修正后成功，已接受项不重发。还检查全局无创建按钮、频道卡片不重复名称、往返草稿保留。两项纯提交测试覆盖拒绝停止与未知等待；来源测试85项、类型／产品构建、格式／diff。未跑完整后端／完整浏览器或付费CLI。

- tabs拖动采用官方原生控件，排序仅当前挂载频道内有效，尚无后端偏好字段，未宣称跨刷新持久化；默认仍进入聊天。
- 本批不是任务看板拖动／批量改状态／高级设置验收；这些保持原有缺口。
- 浏览器硬刷新会丢失内存表单及核实句柄，沿用现有离页警告，不会自动重发；如已创建部分任务，记录留在频道中。
- 真实页面仅验证已有频道的任务标签、原生表单增加行／取消／聊天返回，不往用户频道创建测试Task；持久写入证据来自隔离Core。

[验证与部署证据](../evo/evidence/2026-10-16-task-create/summary.json)。
