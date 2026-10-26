# 官方当前设置、动态工具条与分栏核对

来源：Web 1.21.34，SettingsPanel-Cg0my9Pp.js / ThreadsInbox-CM-EY6gw.js / app-shell-BWgtfY02.js；其包仍为 @botiverse/raft-ui 0.35.1。公开选取源码 db5e399 不变。发布资源的兼容移植不能称为完整新源码依赖。

已接入：

- SettingsPanel `Sl`：ListRowGroup.mb-6 → ListRow plain → Body/Title/Description wrap/Chevron。位于个人外观 mode 卡片之后、字号 SectionHeader 之前；publicSurface 不显示。Loom 使用现有 onTab("theme")，不引入官方 server store。
- ThreadsInbox `yn`：@container 工具条，SegmentedControl iconsOnlyBelow=auto，Inbox/CircleDot/AtSign/Pin，标签由官方组件按实际宽度收起。移除旧版本两个包裹 div，避免干扰原生可用空间测量。
- 全部已读保留 Loom busy/写入围栏；官方 md ghost、30rem 容器阈值、CheckCheck、sr-only 标签与负 margin 原样移植到生成器。
- 原始选取文件未修改，生成文件只通过生成器更新；新主题入口为明确结构移植，不声称字节级复用。

分栏调查纠正：不能将新版交互统称为“第三栏拖小后关闭”。

| 官方调用链                                       | 已证实规则                                                                                                 | Loom当前差异                                                                               |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| n2 → LF(column=list/sidebar, snap.kind=collapse) | 小于 min-40 才折叠；记录原宽度；Enter 切换；双击重置                                                       | 现有 useCurrentListPanel/旧 handle 尚无这个状态                                            |
| I3e → LF(column=thread, snap.kind=focus)         | 大于动态 max+40 切到专注/最大化；同频道且主栏可见、无资料覆盖时允许                                        | ThreadWorkspace/SideWorkspace 仍使用旧 max(400,viewport×0.6)；不是新增一个关闭回调就能等价 |
| LF                                               | 左右键16px、Shift64px、Home/End、pointercancel/blur清理；动态 max 为当前侧栏宽+主栏可让出空间，主栏至少360 | 旧hook只有指针与持久化；缺键盘和专注状态                                                   |
| I3e → fYe/e2/I0                                  | 侧栏堆叠、折叠伴随面板依赖统一布局状态                                                                     | 需要一次成套替换和有草稿/写入中的关闭保护；本批未改                                        |

后续最小完整切片：先锁定 LF 及其依赖和统一布局状态的完整闭包，再以 Loom 路由/草稿保护绑定 thread focus 与 sidebar collapse；同时验证拖回恢复、取消、键盘与窗口缩放。不得把单纯改变 min/max 当作该切片完成。移动滑动行为仍待对应官方调用链核验。
