# Loom 按钮规格审查（2026-10-19）

结论：官方存在明确分层；Loom 共用了基础组件，但没有把“什么场景必须用哪个组件”完整落到检查中。不能将 import raft-ui 当成规则对齐，也不能把所有按钮统一改成同一种尺寸或黑框。

## 范围与证据

- 静态扫描本地 Loom 的97个TSX文件，195个动作／交互控件调用位置：113个 Button、18个原生 button，其余为关闭、菜单、选择、导航和消息工具封装。这不是可见按钮数量、功能数量或完成率。
- [逐位置记录](inventory.json)可由命令 node scripts/official-web/button-inventory.mjs 再生成。
- 页面基线：frontends/raft/adoption.json 中 botiverse/raft-source@a98ae003246a0360872a77d76dec2fccd0347ef7，FSL-1.1-ALv2；保留授权与声明。基础库实际为 raft-ui@0.5.64，MIT，botiverse/rui；页面和组件包是两个版本边界。
- 核对官方 Button recipe、CloseButton、DialogClose、PickerTriggerButton、PanelHeader、ComposerIconButton，以及 panelHeaderButtonHeights.test.ts、channelHeaderActionButtons.test.ts；检查本地移动CSS与局部风格测试。
- 复制的官方大型组件不逐个展开统计；其输入参数及最终渲染仍需按场景验证。本次不是所有页面、所有主题与鼠标状态的全面视觉验收。

## 官方分层与规格来源

| 场景               | 单一规格来源                                                     | 规则                                                                            |
| ------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 基础动作           | raft-ui Button recipe                                            | size、variant、字体、边框、阴影、hover/disabled/loading；页面不另造基础样式     |
| 详情关闭           | 官方 components/ui/CloseButton.tsx                               | 常见桌面调用 size-7、14px图标；Brutal黑框、白底、阴影；遵循页面可见性及关闭语义 |
| 对话框／抽屉关闭   | DialogClose／DrawerClose                                         | 容器管理焦点和关闭；不能全部改成普通CloseButton                                 |
| 筛选触发器         | PickerTriggerButton搭配Select/Combobox，或具体工具栏的Button参数 | 依所属工具栏；任务／记忆当前32px+sm字号，不能外推到全部搜索与表单               |
| 表单选择           | FieldSelectTrigger / Select chrome=field                         | 与Input配套，不应拿来替代紧凑筛选触发器                                         |
| 消息／composer动作 | MessageItemToolbarButton／ComposerIconButton等                   | hover、触屏可见性、间距、发送状态由各自封装负责                                 |
| 导航／展开         | SidebarItem、SegmentedControlItem、官方disclosure/tree row       | 不是提交按钮；官方也使用原生button，不可一律判违规                              |
| 危险确认           | 容器内action及danger variants                                    | 保留确认与执行状态，不按“删除”文字批量改颜色                                    |

基础recipe的Brutal文本尺寸：xs为24px/11px字号，sm为28px/12px，md为32px/14px，lg为40px/14px；图标xs/sm/md/lg为24/28/32/40px。Elegant的lg另有36px分支。默认variant=default、size=md是有定义的默认值，不是随机尺寸。compound variant、外层约束与用户批准的移动适配可能覆盖基础值；以实际渲染为准。

## 已确认偏离与风险

| 优先级 | 位置                    | 证据与影响                                                                                           | 处理                                                                                                                                             |
| ------ | ----------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 已修复 | MemoryPage详情关闭      | 原ghost边框计算结果为透明，未用CloseButton                                                           | b32e955a直接复用官方组件；桌面／手机黑框与关闭恢复通过                                                                                           |
| P1     | SideWorkspace.tsx:126   | 关闭Side用普通Button ghost/icon-sm，同层任务／实例／记忆使用CloseButton                              | 下一批替换，保留未决写入保护、Escape及关闭语义                                                                                                   |
| P1     | ThreadWorkspace.tsx:332 | 加载／错误分支用ghost和文本字符×，正常内容走官方ThreadPanel                                          | 下一批统一该分支，避免加载前后跳变                                                                                                               |
| P1     | mobile.css:69–86        | 用button直接包含svg且不含span来推断图标按钮；新版原生按钮把SVG包在button-content span内              | 实测390页面：规则不匹配，关闭按钮28px，after伪元素content=none；不能声称已有44px点击区域。改为语义标记或官方slot，并验证外围命中及相邻按钮不重叠 |
| P2     | 页面Button选型          | 113处Button中60处省略size、52处省略variant，使用确定默认值；不能据此认定错误，也不能据此证明层级正确 | 按详情／工具栏／表单／诊断逐组映射，只改有来源依据或明确产品决策的位置                                                                           |
| P2     | 页面参数重复            | 任务／记忆分别声明32px参数，多处分别声明详情28px参数                                                 | 先锁定来源和回归；不另造万能LoomButton覆盖上游。重复语义稳定才提取薄绑定                                                                         |

## 不应误判的正常差异

- TaskDetail手机“关闭任务”实际是返回箭头，桌面才是X，不能强行做同一种呈现。
- 工作区刷新／树节点、搜索历史删除等原生button，在官方AgentWorkspace／搜索历史中有同类实现；不是私造按钮的证据。
- 8处DialogClose应保留，不能因统一关闭按钮而破坏dialog焦点返回、Escape和关闭阻挡。
- 清除筛选中的X不是关闭详情；不能全仓按X图标替换。
- 批量将ghost替换outline会破坏消息操作、菜单触发、次要操作及清除搜索的原生规则。

## 根因与整改顺序

1. 先修同语义的明确偏离：Side／消息列加载态关闭，保持业务不变。
2. 再修移动点击区域：按实际DOM/slot选择控件；验证中心／外围命中、相邻动作及disabled，不只检查CSS文本或视觉宽度。
3. 固化页面级映射：每类记录“功能身份→官方封装/参数→本地接线→允许例外→回归证据”。引用原生recipe，不复制第二份token真相。
4. 最后按组检查其余默认Button：常用频道／详情／表单优先，没有具体偏离证据则不进行美观式重写。

现有activity-chrome、channel-controls-chrome等测试保护了部分参数，但不覆盖全部本地按钮，更不能捕获所有DOM变化。记忆关闭以真实页面复现透明边框后修复并补入窄回归；上述两个关闭偏离和移动命中问题尚未修复，不计为完成。本次没有新增后端能力、付费实验，也没有声称195个调用位置全部视觉一致。
