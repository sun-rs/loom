# Role 主从页面与频道点击已读修复

来源仍为 `botiverse/raft-source@a98ae003246a0360872a77d76dec2fccd0347ef7`；授权、许可证及原始文件摘要见 [adoption.json](../../frontends/raft/adoption.json)。官方 `packages/**` 没有修改。以下是直接复用、结构移植和 Loom 接线的区分，不声称整个 Agent 页面字节级复制。

## 根因与行为

正式环境只读诊断确认：`all` 的消息数为 0，未读数为 4，对应四条 `membership.added` Room event。Kernel `human-activity.ts` 有意将成员加入等系统通知加入导航 attention；当前正文只渲染消息。原侧栏只接了右键“标记已读”，未接普通点击，因此既有数字不会随频道点击消失。

参考官方 `Sidebar.tsx:markUnreadSidebarItemRead`，显式点击有未读的频道行时调用已有 `activity.mark`，`source=channel-list`。事务内由 Kernel 取当前频道 head，包括系统通知；不由前端猜测序号，不改变线程 frontier，也不写模型消费游标。确认后重新获取 summary。失败只显示未确认并读取投影，不自动重发这个无幂等键的写入。发送结果未知导致导航被拒绝时，不标记目标频道；浏览器先复现了错误标记，再验证导航结果门控。URL 初始选中、搜索／动态上下文查看和后台轮询仍不产生自动已读；这不是 viewport ACK。系统通知正文展示仍未接入，不把它们伪造为聊天消息。

## Agent 页面

Owner 指定的结构是左侧 Role 列表、右侧 Role 配置，实例是选中 Role 的一个标签页。取消原先全页“角色／实例”两个总列表及编辑角色弹窗。创建、删除、添加实例与重启确认仍使用原有对话框。

| 官方链路                                                                  | 本地采用                                                                          | 业务 owner／边界                                                                            |
| ------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| MainLayout → Sidebar member rail → MemberAgentRow                         | 直接复用 sidebar frame、SidebarItem、AvatarSlot；结构移植选中类名及头像／文字层级 | Role ID 选中；未创建新的身份或业务状态。Role 无执行在线状态，不展示虚构 activity dot。      |
| MainLayout splitter → useResizablePanel / panelBounds / PanelResizeHandle | 原组件和 180/240/320 参数直接复用；Role 页独立持久化宽度                          | 仅呈现设置，桌面主从布局；手机列表→详情→返回，不压缩字号来硬塞双栏。                        |
| AgentDetailPanel → profile PanelHeader → underline Tabs                   | 原组件、profile header surface、tab 高度与样式复用；配置／实例替换内容            | RoleEditor 继续调用 role.revise，实例严格按 roleId 过滤；未接的官方标签不显示。             |
| Role 删除与存活实例                                                       | 角色定义删除后显示只读的“已删除角色（实例名）”归属项                              | 来自现有 catalog.instances，保留原 Role ID 归属，不能编辑或复活定义；重启仍可保留冻结配置。 |

新建 Role、不可变修订、实例冻结配置、重启时显式采用新修订、私聊未知结果核实及删除 Role 后保留实例继续走现有 SDK／RoomSession／WriteIntentSlot。没有新增后端端点、队列或工作流。历史 Role 的 runtime/model 绑定若已不在 Host 当前目录中，沿用既有编辑器要求显式重新选择的边界，不自动替换 CLI／模型；本批没有迁移这些历史配置。

## 验证

先用浏览器复现：点击有未读的频道后徽标不消失；Agent 页没有 Role 侧栏。修复后双尺寸隔离 Core 回归覆盖点击已读持久化、丢失响应不重发、Role 创建未知结果原请求核实、内联保存修订、选中 Role 的实例范围、重启保持／采用配置、删除定义保留实例、实例移除和已有聊天／搜索流程。原生源码摘要检查保持有效。

正式服务部署与页面结果以 [本批证据](../evo/evidence/2026-10-14-role-workspace/summary.json) 为准；页面可用不等于后端新增验收或成本门禁。未运行付费模型。
