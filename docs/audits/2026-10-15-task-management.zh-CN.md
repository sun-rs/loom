# 任务指派与历史接线

本批接通原生任务属性中的负责人编辑器及折叠历史；不改后端、不增加协作工作流。全局任务页与频道任务详情使用同一组件和同一 API 路径。

来源：[Raft 官方源码](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，版本 `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2，Owner 已授权复用；上游 notices 和逐文件摘要保持。

- **直接复用** `packages/web/src/components/InlineBadgeEditor.tsx` 的 searchable 模式及 SelectionPopover；`components/task/HistoryTimeline.tsx`、上游 TaskProperties 导出的 TimelineDetail／TimelineText、raft-ui Timeline、原生 AvatarSlot（沿用既有未知在线状态不显示徽标的接线）。没有修改原始组件磁盘源码。
- **结构移植** TaskProperties 的负责人属性参数、搜索、未指派选项；History 按钮／箭头／分隔线和展开内容组合，位置仍在属性行之前。保持原生菜单、列表、时间线尺寸／字形／hover。仅数据来源与回调替换成 Loom。
- **唯一所有者** Task 及授权属于 Kernel；LoomTaskClient 的原有 RoomSession／WriteIntentSlot 负责状态和负责人写入。`task.assign`／`task.unassign` 不新建任务或 CLI 会话，不把 UI 修改当成模型完成工作。Human 修改活跃任务时，仍由既有 Kernel 取消／移交围栏处理。

| 行为 ID              | 原生触发与后端数据                                                                                                        | 交互、错误与验证范围                                                                                                                                                                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| task-assignee-edit   | 原生负责人 InlineBadgeEditor → SelectionPopover；候选来自当前任务 RoomSession 的频道成员，显示名称，值为稳定 Principal ID | Human 与实例均可选，支持按显示名称搜索和未指派；与状态编辑互斥。Escape 关闭当前编辑器并返回触发按钮，不关闭任务详情。任务创建者／频道管理者可操作，最终由 Kernel 验权。任务已完成或频道归档时只读；不为通过前端选择而放宽后端权限。                          |
| task-assignee-write  | 选择新成员走 `task.assign`；清空走 `task.unassign`                                                                        | 冻结 Task ID、目标、房间基准与幂等键；未知结果使用原请求核实，未决时详情不得卸载。拒绝显示错误，不能伪装成成功。测试覆盖指派实例、指派 Human、清空及指派／清空分别丢失响应。                                                                                 |
| task-history-toggle  | 原生折叠按钮；展开时请求 `task.history`                                                                                   | 默认折叠不预读；折叠中止请求。任务变更后重新读最新第一页；读取失败隐藏旧时间线，再次展开可重试。错误不影响负责人写入所有者。                                                                                                                                 |
| task-history-page    | Kernel 的 Task ID、frozenThroughRoomSeq 和 nextCursor                                                                     | 每页50，最多500条；更多历史按原生 outline Button 加载。保持同一冻结查询范围、严格递减 roomSeq，不跨任务、不拼接过期响应。不是全量加载，也不存浏览器持久缓存。                                                                                                |
| task-history-display | 只读取公开的 canonical lifecycle record；沿用原生 HistoryTimeline                                                         | 名称来自成员投影；离开的成员显示准确的缺失名称标签，不显示内部 ID。状态来自记录本身，不用当前状态倒推历史；不展示 provider transcript、工具日志、claim token 或私有 InputRequest 回答。Loom 扩展事件使用本地标题；未识别类型明确显示“其他任务变更”，不推测。 |

## 验收与边界

TDD：新增 facade 和历史读取测试先在缺少实现时失败；旧产品构建在缺少负责人编辑器处失败。历史单测检查跨任务拒绝、分页顺序和原生展示映射；指派／清空分别验证响应未知后的原键重放。真实临时 Core 使用关闭执行的 Fake CLI 实例，避免模型调用；1440×1000 与390×844（DPR1，真实触屏模式）验证搜索、两类成员指派、清空、未知结果关闭保护、已完成只读、超过50条历史分页、读取拒绝／恢复及刷新。

测试夹具首轮混淆 AgentDefinition ID 与 Instance／Principal ID，已按实际契约修正：管理状态使用 agentId，任务指派使用 instanceId。该失败保留，不通过放宽断言接受错误身份。正式服务仅只读查看已有任务、打开候选和历史，不实际改指派，也不向用户频道写验收记录。

本批没有接入独立审核详情、描述编辑、批量任务创建、看板拖动；历史虽展示后端已提供的审核结论，不等于审核操作／完整审核面板已验收。超长历史超过500条停在明确边界。完整检查及正式部署见[验收证据](../evo/evidence/2026-10-15-task-management/summary.json)。无新增真实 CLI、付费模型或效率结论。

正式只读页面首轮发现原生搜索输入拦截 Escape、外层未接关闭；新增桌面／手机复现测试先失败，再在 Loom 属性组合层补 capture 关闭及焦点返回，官方源码未改。定向和完整浏览器回归通过，正式服务重新备份／重启后双尺寸只读页面复核通过。另一并发旧构建门禁在构建输出更新期间导航超时，不能作为产品通过证据，改为构建完成后独立复跑。
