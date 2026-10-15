# 频道创建／转换任务：原生入口接线

本批从频道完成“写成任务／已有消息转任务 → 原消息下任务徽标 → 任务详情与讨论”的纵向路径。不增加顶部创建按钮，不新增协作工作流，不改变后端调度或模型上下文。

来源：[Raft 官方源码](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，版本 `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2；沿用 Owner 授权，原始 notices 与磁盘源码摘要保持。

- **直接复用** `packages/web/src/components/message/MessageInput.tsx` 的 `showTaskButton`／`alsoCreateTask` 选项、CheckMarker、composer布局；`MessageItem.tsx` 的右键／触屏长按、触屏点击屏蔽、菜单定位／背板、TaskChip／Tooltip 与任务徽标点击区域。
- **结构移植** 消息菜单只组合已有 MenuItem／ThreadIcon／ClipboardCheck：打开消息列、转为任务（已转换则打开任务）。不显示未接的 reaction、收藏、分享、快捷完成等操作。不更改菜单宽度、内边距、颜色、字形及 hover recipe。
- **构建适配** `channel-task-adaptation.ts` 对每个上游边界要求恰好匹配一次；将 `submitAsTask` 传给既有 `onSendOverride`，成功后才清除任务选项；只为所选频道顶层消息接通原生菜单处理器和任务徽标目标。线程回复、系统通知、私聊与搜索预览不因此获得转换操作。磁盘中的官方文件保持逐字一致。
- **唯一所有者** `ChannelTaskClient` 复用 `LoomChannelClient.writes` 和 `room`；不存在第二个发送队列或任务状态机。`task.create` 由 Kernel 原子建立任务及来源消息／讨论；`task.convert` 保留既有来源消息身份。状态与指派仍由后端授权验证。未提供任务负责人时不在前端猜测指派。

| 行为 ID                   | 原生触发／参数                               | 数据和状态                                                          | 关闭／异步／验收                                                                                                           |
| ------------------------- | -------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| channel-task-compose      | MessageInput 的任务选项与原提交按钮／Enter   | `task.create`，完整正文作标题；普通模式仍 `message.post`            | 与聊天共用 WriteIntentSlot；未知结果保留原请求及页面所有者，明确核实同一 key；成功才重置选项。拒绝沿原 composer 恢复文本。 |
| channel-task-convert      | MessageItem 右键／500ms 长按 → 原生 MenuItem | `task.convert`，固定 roomId／messageId／因果基准；不另发消息        | 已提交后丢响应重放原请求，证明仅一个 Task 且来源 Message 未换 ID；触屏菜单沿原生点击屏蔽和外部链接例外。                   |
| channel-task-chip         | MessageItem 的原生 TaskChip                  | `task.global.list` 的频道投影；原生 TaskModalHead／ThreadPanel 详情 | task／taskChannel URL，刷新保持目标；关闭返回原频道，手机整页返回；隐藏的频道不挂全局任务页的第二个 modal。                |
| channel-task-read-failure | task.global.list 失败／权限拒绝              | 清掉徽标投影，转换不可用；普通消息发送不受这次读取失败影响          | 请求可中止，过期响应不得重新显示；恢复读取后重新展示徽标。                                                                 |
| channel-task-menu-dismiss | 菜单外部点击、Escape                         | 原生 DismissBackdrop；本地补捕获 Escape 关闭受控菜单                | 首轮真实浏览器暴露 Escape 未关闭，修复后原断言通过。未声称完整方向键菜单导航或自动焦点返回已独立验收。                     |

## MVP 边界

频道内任务徽标投影每次最多100项，5秒轮询；不扫描全部历史。若频道超过100项，已返回的任务仍可打开，无法判定是否已有任务的消息暂禁转换，并提示从任务页查看；输入框创建不受影响。全局任务页保留原有分页。归档频道不开放本批写入口，可从全局任务页读取已有任务。该限制保留为后续按可见消息精确查询的接线项，不能声称长历史徽标已完备。

负责人修改、任务历史／审核、描述修改、批量创建和看板拖动仍未接。本批没有把消息菜单的“完成任务”接到模型回复或运行退出；任务完成依然是显式操作。

## 验证与失败记录

先运行新增 facade／适配测试，缺实现时失败；旧正式构建的浏览器用例在缺少原生任务选项处失败。随后真实临时 Core 在1440×1000、390×844（DPR1，真实触屏模式）验证创建／转换分别丢响应后的同键核实、无重复来源消息、任务徽标与详情刷新、手机长按、普通发送以及读取拒绝／恢复。首轮 unit fixture 的 Room sync 重复快照元数据已纠正；原生默认英文菜单文案选择器改为中英精确匹配；Escape 和隐藏频道重复弹层均保留失败记录，修复原断言而非放宽断言。完整回归还发现任务导航保护误覆盖普通聊天写入；改为仅在共享 slot 的 `task-create` 操作期间保护任务页面，保留已验收的普通聊天跨大页往返。

最终检查、正式只读页面核验与部署状态见[本批证据](../evo/evidence/2026-10-15-channel-task-entry/summary.json)。不运行付费 CLI，不新增成本或真实模型验收声明。
