# 聊天侧栏分组与会话归属

## 来源与范围

Raft 发布包 `index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
本机审阅副本位于 `/Users/sun/Code/reviews/rah_os/2026-09-13-dialog-audit/`。

- pretty 133605：FD 标题 `mt-3 mb-1 h-6`。补回包装层造成失效的 12px 分组间距。
- 133645–133735：Nat/Xx/Jx 使用 sortable、vertical list strategy、transform/transition；行拖动透明度 0.12、分组 0.6，标题是分组拖动手柄。
- 135910–135940：分组顺序独立保存，移动会话清除旧归属。
- 136533：已保存选中态粉底、黑框、固定阴影。
- 136730–136747：自定义分区为空时显示“暂无会话”。
- 133284–133378 / 137412–137431：新建与编辑分区复用 Z8 / pat 表情选择器。沿用已有源代码对齐弹窗。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`，
`packages/views/layout/app-sidebar.tsx:179` 同样使用 dnd-kit sortable；其置顶列表不是完整的混合频道/私信分区模型。
本次为结构移植与 RAH 接线，不是逐字复制。dnd-kit 使用 MIT 包依赖，保留包内许可。

## 单一所有者与行为

HumanSidebar 仍是 Human × Workspace 侧栏偏好的持久所有者；协议新增可选迁移字段
`sectionOrder`，旧数据读取默认空列表，前端补齐系统组与新自定义组。顺序通过原有版本栅栏命令保存。
会话移动同时清除 pinned 与其他 customSections 的归属；channelOrder/dmOrder 仅是排序记录。
频道只能回频道组，私信只能回私信组，两者均可移入置顶与自定义分区。
删除自定义分区只移除分区偏好，会话回到对应系统组；不删除 Room。

分组右键支持新建；自定义分区另有重命名/更换图标与删除。频道、私信、置顶保留系统身份。
按用户要求不提供隐藏空分区。自定义分区保持手动顺序，现有系统组的手动/最近/A–Z 选项保留。
拖动动画使用共享 sortable，写入仍等待已确认偏好；失败保留原确认快照并显示原有错误。

## 验证

`apps/web/test/sidebar-order.test.ts` 先复现自定义移动缺失，再验证单一归属、混合移动、类型边界与无效分区。
协议测试覆盖旧字段迁移、重复分组拒绝和单字段 patch；Kernel 测试覆盖持久化、版本栅栏、鉴权与幂等。
`scripts/test-sidebar-groups-browser.mjs` 用真实鼠标验证跨区移动、组间与组内顺序、刷新、空分区、重命名、删除归位和已保存选中边框；390×844 验证弹窗。
既有 `test-chat-context-browser.mjs` 验证表情、保存失败草稿和右键会话菜单回归。

此证据是源码对照与隔离浏览器验证，不宣称线上 Raft 同条件双边验收。

完成结果：`npm run check`、`npm run format:check`、`git diff --check` 和正式 Web 构建通过。
新增浏览器场景在 Chromium、Firefox 通过，既有聊天右键场景通过。
正式状态已备份后由 guarded restart 重启，冻结资源标识
`1dce8d2c4a8de43cd55943d4d08ce4fe13723c02f0e218cc0edcdc59c750107c`。
重启后在 localhost、LAN、Tailnet 三个正式入口的新浏览器页面验证了资源标识、间距、系统菜单、表情、现有空分区 111 与编辑、已保存边框及窄屏弹窗。
真实拖动写入验证仅使用隔离状态，未改动用户的分区归属。

## 拖动反馈去除额外装饰

后续用户指出行底横线与容器虚线并非 Raft 效果。对照同源 pretty 133645–133735 的 Nat/Xx/Jx，
移除 `.is-over::after` 底线和容器 dashed outline；目标容器只保留 `bg-white/60`。
行保持 transform/transition 与 0.12 透明度，分组使用仅纵向 transform 与 0.6 透明度。
137024–137037 的 DragOverlay 明确 `dropAnimation: null`，会话浮层为 max-width 288px、
白底、2px 黑框、2px 固定阴影、6px/8px padding、14px medium 字体；分组直接显示自身位移，不另造文字浮层。
维护现有 sortable 与持久化所有者，不改会话移动规则。

浏览器拖动测试在 mouseup 前读取计算样式，先复现虚线/横线，再验证无额外线条、行/组透明度、白色会话浮层和无分组文字浮层，并继续验证放下后的正确顺序及刷新保存。

本次拖动反馈修正：Chromium/Firefox 专项验证通过，已检查拖动中截图；本次运行的格式检查和正式构建通过。
全套检查在 Web 单测阶段被同工作区另行进行的 ChoiceRow 迁移阻塞：首次缺失 ui-choice-contract.mjs，随后文件出现但合同断言仍失败；composer-mention.test.ts 仍断言旧 styles.css 中的黄色规则。
这些并非本次拖动文件的失败，未修改或覆盖正在进行的候选行迁移。
因此本次尚未执行正式工作台重启及重启后验收，上文既往批次的重启结论不代表此次修正已部署。

## 实时让位与保存期间稳定性

继续对照同源 135840–135920 的 Pc/mS/Bm/zy：拖动开始冻结容器布局；over 根据被拖条目中心与目标中心决定前后插入；相同布局不更新；释放后才提交。
RAH 先前只有 SortableContext 的同组位移，跨组仍在 mouseup 后等待后端响应，不能称完整对齐。

新增 sidebar-drag-layout 的纯布局运算，由 SidebarDrag 保持短暂的展示快照；HumanSidebar 仍是唯一持久偏好所有者。
跨组时即时移动预览身份，目标列表预留位置，禁止不合法的频道/私信目标；取消恢复已确认布局。
放下后保留预览直到同一版本栅栏写入完成，避免网络等待时回跳；保存失败回到原有已确认投影并显示原有错误。
拖动期间不写后端，完成只有一次 patch；待保存时禁止开启第二次分组拖动。
条目 ref 直接复用 sortable 的稳定 setNodeRef，避免渲染时反复解绑测量节点。
移除“无论手动排序如何都把 all 置前”的额外排序，避免保存后 all 被强行移回顶部。

单测先复现跨组预览缺失，覆盖前后插入、单一归属、类型边界、不修改原快照以及无变化时引用稳定。
浏览器测试在 mouseup 前断言目标分区已有预览、原分区已让出；额外验证延迟保存时位置保持、单次提交、失败恢复和 Escape 取消。

补充边界：确认版本在拖动期间变化时拒绝覆盖，提示重试；移动可见条目时保留隐藏会话的既有归属，不把隐藏当作删除。手动拖动仅在手动排序的容器启用，与 Raft Ea/$a 的条件一致。

本轮结果：全套检查通过；最终类型检查、纯布局单测、Chromium/Firefox 的即时预览/延迟保存/失败/取消场景均通过；最终格式检查、diff 检查与正式构建通过。
正式状态完成备份与安全重启，冻结构建 `bb3222f69d934cd4bfd2dd0507a86962f06d59695b0b3b23e464f1f772c881fd`。
localhost、LAN、Tailnet 新页面在 mouseup 前测得邻项位移，并确认跨组预览已进入目标容器；Escape 后归属完整恢复，正式验证零 sidebar.patch 写入。
此前候选行迁移阻塞已解除；此结果覆盖前述“未重启”状态。未宣称所有设备上的帧率或线上 Raft 双边动画验收通过。

## 消除同组拖动的重复换位

用户实际反馈前轮实时预览卡顿，不以先前“通过”结论代替体验问题。复现时同组鼠标尚未松开，DOM 行已有移除/插入。
核查 `@dnd-kit/sortable@10.0.0` 的 SortableContext（dist/sortable.esm.js 290–329）：itemsHaveChanged 会禁用当前 transforms 并请求重新测量。
先前 RAH 同时由 verticalListSortingStrategy 做位移、又在 onDragOver 改写同组 items，构成重复换位/测量路径。

修正：同组保持 DOM 顺序，交给 useSortable 位移动画；释放时按 active/over 索引提交顺序。
只在真正跨容器时更新预览 items，取消强制 MeasuringStrategy.Always，使用库对列表变化的定向测量。
这属于为消除 RAH 集成回退的有意实现差异，不声称逐字移植 Raft onDragOver 即有相同性能。
保留跨组预览、无横线/虚线、取消恢复与慢保存期间保持位置。

新增 `test-sidebar-drag-stability-browser.mjs`：先复现同组拖动中的 DOM 行换位，修正后往返拖动仍为零；同时测量邻项确实让位，并验证释放和刷新后的顺序正确。
此测试证明重复换位路径已消除，不等同于所有机器的帧率验收。

本轮全套检查、格式、diff 与正式构建通过；Chromium/Firefox 稳定性及完整分组回归通过。
备份重启正式工作台后，localhost、LAN、Tailnet 均验证同组让位期间 DOM 行未换位、跨组预览可用，取消后顺序恢复且无持久写入。
冻结构建为 `7537b00a7cb3fc7677956a3b9b9b1dbb02536376cd2371add91460e55d9a3c5f`。
