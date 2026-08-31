# Chat / Agent 基础链路修复与重新验收

本轮不以既往 Tasks/Search 门禁代替 Chat/Agent 验收。先补失败测试，再施工，再做同尺寸双边浏览器对照。

## 单一 owner 与边界

- Kernel 的 `direct_room_pairs` 已拥有不可变双方身份。Room 查询追加这两个 ID；不按显示名称猜配对，不新增 DM owner。聊天侧栏列 Workspace Agent，点击复用 `room.direct.open`。已有 Human DM 仍保留。
- 资料查询以 Agent ID、AgentDefinition revision、ExecutionPolicy revision 和 lifecycle state 为刷新依据，不以每轮新建的 view object 为依据。同一身份后台刷新保留已读内容；切换身份必须隐藏旧响应并拒绝迟到结果。目录复用已有刷新节奏，携带 definition revision，确保其他页面的配置变更可以触发刷新。
- 运行时编辑复用 `agent.manage`、现有模型/effort 目录和因果写入，不建立浏览器侧配置。独立入口只编辑执行配置，保留人格、指令、头像与记忆引用；已开始的 Run 保留冻结配置，新 Run 使用新配置。
- 动态仍是 Provider 结构化执行轨迹，不是 Room 消息真相。跨 Room 查询继续由 Kernel 按身份和 ACL 限制。检查分页、切人竞态、空态可见性、文件操作与刷新持久化。不得伪造其他 Agent 的历史，也不把未上报的 OS 操作说成可观察。
- 颜色从已导入的 Raft tokens 取值，修复未定义引用。尚无安全合同的 restart/report 操作仍明确禁用，不能为视觉相似假装可用。

## 验收矩阵

1. 大屏 1440×1000：双边记录入口、编辑弹层、关闭/取消、hover、主框线；本地资料静置至少 30 秒不抖动。
2. 空目录/已有 DM/同名或改名 Agent：侧栏入口不丢失、不重复创建，刷新恢复。
3. Room 创建、成员加入/移出、普通消息、线程、Task、Search、全局 Activity、通知、Computer、Memory/MCP 可用与降级状态。
4. 隔离真实 CLI：先浏览器配置已获批准的模型，再跨 Channel/DM 发起有限读写与回复；核对 durable Run/trajectory/消息和配置保存，不使用生产人格或记忆做实验。
5. 390×844 响应式、键盘焦点与 Escape、资料滚动、长记录分页；这些不代替 iOS 真机或 Firefox 证据。
6. `npm run check`、生产构建、format、diff 检查。报告逐项区分真实 Provider、Fake Worker、只读 Raft 对照和阻塞项。

正式环境本轮不写测试消息、不替换用户配置。构建会生成新的静态资源，但不能将静态文件更新等同于前后端配套交付；服务重启需单独授权、确认没有运行中的用户工作并备份状态。

本轮结果及剩余项见 [修复与真实验收报告](../audits/2026-08-31-chat-agent-repair-and-parity.zh-CN.md)。其中发现的碎片聚合差距单独列为下一批，先复用 Raft Computer 的既有边界设计，不在本轮临时引入新的自制合并算法。
