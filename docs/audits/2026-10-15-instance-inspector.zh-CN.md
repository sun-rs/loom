# 消息头像 → 实例动态侧栏

来源：[raft-source a98ae003246a0360872a77d76dec2fccd0347ef7](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，FSL-1.1-ALv2，owner 已授权。磁盘上的官方 `packages/**` 保持原样。

## 采用与数据归属

对照 `ProfilePanel.tsx`、`AgentDetailPanel.tsx` 的 header／tab／activity 分支、`AgentActivityLog.tsx` 行结构和 `MainLayout.tsx` 的容器组合。直接使用 raft-ui ProfilePanel／Body／Tabs／Button 以及官方 PanelHeader、AvatarSlot、CloseButton、SectionEyebrow、useResizablePanel、useTimeFormatter。布局结构移植后沿用原生容器 CSS：380px 默认宽、300–600px 拖动范围，1024px 起侧栏并排，窄容器折叠聊天、手机覆盖聊天。聊天节点保持挂载，草稿和消息位置不因详情打开而重建。

`MessageItem` 原来的 `readOnlyProjection` 同时拦截头像导航。不能为头像关闭整组只读保护。`message-profile-navigation.ts` 在构建期仅改写 SenderAvatar 的 `onNavigateAgent`，有受控 `onOpenProfile` 时交给 Loom；原生头像依然先关闭悬停卡，再调用回调。适配对唯一源码片段做严格匹配，上游边界变化会失败；测试验证其余源码和只读限制完全未变。**这是一处显式构建期结构适配，不能把最终执行的 MessageItem 宣称为字节完全复用。** 初次匹配发现同名属性还用于另外两个分支，已缩小到 SenderAvatar 的唯一片段，不将这些分支一并开放。

Channel 的既有 RoomSession 是成员来源和授权显示依据。只允许当前 agent 成员打开。`role.list` 解析稳定 Instance ID 对应的 Agent ID，并核对所属频道／私聊盒；不会把 Principal ID 猜成 Agent ID。`room.agent.activity.list` 提供本对话执行／排队状态，`agent.activity.list` 每页最多 20 条。展示再次按当前成员、Room 和 run_attempt 聚合类型过滤，页内按 Room sequence 从旧到新排列，沿用原生日志在条数变化时滚至底部的行为，不把其他频道、私聊、工具输出或平台配置记录混入。

Kernel 仍拥有业务身份、执行状态和记录；UI 不新建队列、消息游标或业务状态。这里的分页 cursor 仅是当前侧栏的短期展示位置。运行结束只显示“运行结束”，不代表 Task 完成，也不推导在线状态。旧数据没有对应 Role instance 时明确不可用，不用另一身份补齐。

## 交互与失败

| 触发                   | 本地接线与验证                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------- |
| 点击头像或聚焦后 Enter | 原生头像回调打开受控侧栏，默认“动态”；原姓名点击仍插入 `@`。                                |
| 桌面拖边框             | 官方 useResizablePanel；原生宽度范围和容器分栏，真实指针命中验证。                          |
| Escape／关闭／手机返回 | 退出侧栏，恢复原头像焦点，草稿保持；不重新挂载聊天。                                        |
| 加载／空页             | 原生 Spinner；明确当前页没有本对话运行记录，若存在下一页仍可继续查。                        |
| 更早／最新             | 有界替换一页，使用后端 cursor，不全量抓取历史。分页按钮是本地接线，不冒称原版无限日志行为。 |
| 请求失败               | 清空已展示记录，提示失败并重试，不显示旧记录冒充当前状态。                                  |
| 成员失效／频道同步失败 | 不再提供 profileMember，卸载侧栏；请求通过 AbortController 终止，迟到响应不重开侧栏。       |
| 切换成员／频道／卸载   | 由 Room/Instance key 重新绑定，旧请求清理；不保存日志到浏览器存储。                         |

测试先复现旧页面无法打开侧栏，再实现。单测覆盖身份映射、频道／私聊隔离、分页界限和原生只读 guard；浏览器覆盖桌面／手机的点击、Enter、默认标签、Escape、关闭／返回、草稿／焦点、真实指针拖动、失败清空恢复和过滤分页。运行事件分页使用明确标注的 HTTP 展示夹具，不伪造 Worker 或模型运行；正式服务另用已有真实历史与鉴权 API 对账。

首轮完整浏览器通过；追加分页等检查后的整套回归曾在旧私聊入口等待超时，当时正式构建同时替换了测试服务读取的静态目录。该批不得算通过；固定产物后重新运行，结果保留在本批证据。未因此修改产品私聊逻辑或放宽断言。

## 边界

这一刀完成只读“动态”入口。运行 usage 下钻、原生工具／思考轨迹、其他详情标签、运行控制和 profile URL 深链未接入；不显示未绑定按钮，不宣称完整 AgentDetailPanel 已迁入。无后端、模型上下文、调度或付费测试变更。完整结果见[证据](../evo/evidence/2026-10-15-instance-inspector/summary.json)。
