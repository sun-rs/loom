# Raft 行为指南：适用范围与当前实现登记

首次登记：2026-08-31。当前复核：2026-09-02。当前可回退提交基线为
`023aad7`；该基线的 `npm run check`、format 与 diff 核验已通过。本文是
持续补全的**产品登记表**，不是全站验收证书，也不修改旧母版
快照。后续执行顺序由 [Raft-first 剩余收口计划](./2026-09-02-raft-first-remaining-closure-plan.zh-CN.md)
拥有。

## 1. 怎样读这份指南

来源有三层，不混算：

1. 旧母版 `packages/raft-ui-snapshot/reference/protocol/rah-ui-capability-inventory.json` 的 **74 项 intent**：本表逐项迁入，保留名称以便查漏，但不采信其中 2026-08-26 的 backendStatus。
2. 当前官方发布包的 **1,836 个回调候选、23 个 JS、13 个缺失引用 JS**：只是检索入口，不是功能数量。详见 [冻结索引](../evidence/raft-interaction-candidates-20260831-current.json)。
3. 经过人工追踪的语义合同：先前 [C01–C11 详细账目](../audits/2026-08-31-rendering-regression-and-contract-coverage.zh-CN.md)与本轮 [Agent AG00–AG08 合同](./raft-agent-behavior-contract.zh-CN.md)。新合同是拆细，不直接与旧组数相加。具体回调通过 [来源关联表](../evidence/raft-behavior-source-links-20260831.json)回填，而非篡改冻结候选。

以下“前端/后端”是**代码接线状态**：

- `已接`：该行限定功能有当前 owner 和调用；不等于视觉、失败分支、真实 CLI 或双边验收完成。
- `部分`：有相关实现，但不能满足整条意图，或已知语义不同。
- `缺失`：产品入口/对应应用能力没有接通，包含 disabled 和占位。
- `无后端`：纯展示行为，不需要新业务命令；其依赖的列表仍须来自授权数据。
- `排除`：不复制 Raft 的中央收费/账户机制。
- `待裁决`：尚未确定本地替代合同，不计成已完成，也不擅自删除。

从 2026-09-01 起，证据统一分层：`C` 代码存在，`A` 本轮自动化，`L`
本地真实浏览器，`R` 与 Raft 相同前置的双边结果，`D` 当前正式部署。旧表
行内的 `H/N/A` 仅保留为历史注记，不再充当当前结论。任一层都不能自动
推导下一层；特别是 Fake CLI fixture 的 `L` 不能推导真实 Provider 或
正式部署。74/74 只说明旧意图已登记，不能说 74 个功能已实现。

鼠标、键盘和触屏引起的边框、底色、hover、press、focus、selected、disabled
与动画时序统一由 [Raft 前端操作状态合同](./2026-09-02-raft-interaction-state-contract.zh-CN.md)
拥有；当前双边结果见 [操作状态审计](../audits/2026-09-02-raft-interaction-state-verification.zh-CN.md)。
这套控件族合同不替代本表的业务点击语义，也不把相同组件的多个实例重复计成功能。

## 2. 本地 owner 索引

表内简称对应现有文件/应用能力，不是另造模块：

- `APP`：[App](../../apps/web/src/App.tsx)、[导航](../../apps/web/src/components/workspace-navigation.tsx)、[对话组件](../../apps/web/src/components/conversation-panes.tsx)。
- `ROOM`：[创建/成员/设置窗口](../../apps/web/src/components/room-dialogs.tsx)，经 `client-sdk` / `client-core` 到 Kernel collaboration owner。
- `AGENT`：[Agent 详情](../../apps/web/src/components/agent-directory-pane.tsx)、[管理](../../apps/web/src/components/agent-dialogs.tsx)、[模型编辑](../../apps/web/src/components/agent-runtime-dialog.tsx)；Kernel Workspace Agent management/provisioning。
- `COMPUTER`：[Computer 目录](../../apps/web/src/components/workspace-catalog-panes.tsx)，`host.runtime.list` 读取 Host/CLI/Offer，不等于远程管理命令。
- `DISCOVERY`：[搜索/Activity](../../apps/web/src/components/global-discovery.tsx)、[全局 Tasks](../../apps/web/src/components/global-task-board.tsx)、[筛选](../../apps/web/src/components/discovery-filter.tsx)；[typed 操作](../../packages/client-sdk/src/discovery-operations.ts)→ Kernel `global-discovery` / `human-activity`。
- `TASK`：[任务窗口](../../apps/web/src/components/task-dialogs.tsx)、[工具栏](../../apps/web/src/components/task-toolbar.tsx)、Kernel Task/Review owner。
- `FILES`：[附件/文件页](../../apps/web/src/components/room-files.tsx)、[typed 文件传输](../../packages/client-sdk/src/file-operations.ts)→ Kernel `room-files`。与 Agent 私有工作区树不同。
- `INBOX`：[Human Inbox](../../apps/web/src/components/human-inbox.tsx)、APP 的系统通知观测；InputRequest resolve 与系统事项 dismiss 不共用状态。
- `SPACE`：[空间标识](../../apps/web/src/components/workspace-identity.tsx)，`workspace.list/update`。当前是 dialog，不是官网 anchored switcher。
- `SETTINGS`：[设置](../../apps/web/src/components/settings-surface.tsx)，个人/Workspace/资源入口已接共享 Raft 页面协议；managed MCP、LAN device、Web Push、Workspace profile、设备偏好与 Workspace push 静音均有真实 owner。中央账户/邀请/账单/应用商店不伪造。

## 3. 74 项旧意图迁移表

| ID   | 旧 intent                          | 范围   | 前端   | 后端   | 当前映射、缺口与证据级别                                                                                                                                                |
| ---- | ---------------------------------- | ------ | ------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B001 | activity.filter.change             | 适用   | 已接   | 已接   | DISCOVERY；`activity.list`，H；筛选不确认 Inbox                                                                                                                         |
| B002 | activity.item.open                 | 适用   | 已接   | 已接   | APP/DISCOVERY；`message.context` 精确 Thread，H；旧表仅称 presentation 不充分                                                                                           |
| B003 | activity.item.complete             | 改造   | 已接   | 已接   | `activity.mark` 处理 read/done；不是旧表的 `inbox.resolve`，H                                                                                                           |
| B004 | admin.agreement.save               | 待裁决 | 待裁决 | 待裁决 | 社区协议不自动等于本地 Workspace 协议，SETTINGS 无对应入口，N                                                                                                           |
| B005 | admin.invite.create                | 改造   | 缺失   | 部分   | LAN 设备配对不是邀请另一个 Human；需定义本地身份邀请，N                                                                                                                 |
| B006 | admin.member-permissions.save      | 改造   | 部分   | 部分   | P1.1 已接 canonical Room Human `owner/admin/member` 查看、编辑、保存/取消、错误与最后 owner 保护；Agent 不获得 Human 管理角色。完整 Workspace 权限矩阵仍未定义          |
| B007 | admin.onboarding.save              | 待裁决 | 待裁决 | 待裁决 | Workspace onboarding 产品合同待定，N                                                                                                                                    |
| B008 | admin.role.remove                  | 改造   | 缺失   | 部分   | 固定 Room 角色存在，无自定义角色删除合同，N                                                                                                                             |
| B009 | admin.role.update                  | 改造   | 部分   | 已接   | Human Room 固定角色 UI 与 causal command 已接；不伪装成可创建/编辑任意角色定义。Raft 中的 Server role 与本地 Room role 边界仍明确保留                                   |
| B010 | admin.system-channel.save          | 待裁决 | 待裁决 | 待裁决 | managed control Room 不是 Raft 可选系统频道，N                                                                                                                          |
| B011 | admin.translation.save             | 待裁决 | 待裁决 | 待裁决 | 服务器翻译配置是否适用尚待决定，N                                                                                                                                       |
| B012 | billing.checkout.configure         | 排除   | 排除   | 排除   | 不复制收费账户/checkout                                                                                                                                                 |
| B013 | billing.checkout.submit            | 排除   | 排除   | 排除   | 不复制付款链路                                                                                                                                                          |
| B014 | chat.agents.stop                   | 适用   | 缺失   | 部分   | AGENT 可逐个 pause；缺聊天页按当前执行安全停止的产品动作，N                                                                                                             |
| B015 | chat.bookmarks.open                | 适用   | 已接   | 已接   | 私人收藏/取消、全局已保存页、20条分页、查询/Room/排序协议、总数、头像与目标元信息、卡片右键菜单、精确消息/Thread deep link 已接；官网独立页本身不显示筛选控件           |
| B016 | chat.channel.lifecycle             | 适用   | 部分   | 部分   | 可逆归档/取消归档与 actor-owned Human 退出已接；退出守住最后 owner、direct/control 与活动工作。永久删除、公开频道自助重新加入及离开后继续关注公开消息列仍未接，H        |
| B017 | chat.channel.pin                   | 适用   | 已接   | 已接   | Human×Workspace 私人侧栏偏好、设置页置顶、快捷键及拖拽置顶已接；联合频道/自定义分组不在本项                                                                             |
| B018 | chat.channel.update                | 适用   | 已接   | 已接   | ROOM→`room.update` 名称/描述/visibility，H；其余设置不含在本项                                                                                                          |
| B019 | chat.composer.asset.request        | 适用   | 已接   | 已接   | Room/Thread 选文件、prepare/upload/cancel、附件-only Thread 回复与同事务 Files 投影已接；通用拖放仍属交互增量，不再登记 Thread 附件为缺失                               |
| B020 | chat.file.download                 | 适用   | 已接   | 已接   | FILES→授权 content GET；下载是浏览器文件流，不是 Finder reveal，H                                                                                                       |
| B021 | chat.file.menu.open                | 适用   | 部分   | 无后端 | FILES 菜单有下载/定位；不能等同全部官方动作，H                                                                                                                          |
| B022 | chat.file.preview                  | 适用   | 部分   | 已接   | FILES content read；完整类型/大文件/预览交互待补，H                                                                                                                     |
| B023 | chat.file.reveal                   | 改造   | 缺失   | 缺失   | 浏览器不能直接打开本机 Finder；需窄平台桥或明确替代，N                                                                                                                  |
| B024 | chat.member.add                    | 适用   | 已接   | 已接   | ROOM→`room.member.add/remove/list`，H                                                                                                                                   |
| B025 | chat.message.action                | 适用   | 部分   | 部分   | 普通消息 hover/focus 已出现 Thread/回应/收藏三入口；共享回应、私人收藏、已保存回跳和刷新持久化通过浏览器门禁。编辑/删除、完整 picker、回应者浮层与收藏高级菜单仍未齐    |
| B026 | chat.message.expand.toggle         | 适用   | 已接   | 已接   | Chat/Thread 共用实际高度测量，默认折叠并提供“展开全文/收起”；Human×Workspace Room 偏好可关闭且持久化。正文内部代码/图表 disclosure 仍是独立层次                         |
| B027 | chat.message.send                  | 适用   | 已接   | 已接   | APP→`message.post/thread.reply`；C01 Enter，历史真实 CLI，H                                                                                                             |
| B028 | chat.mobile.pane.change            | 适用   | 已接   | 无后端 | APP 共享组件的窄屏 pane；Chrome 持久工作台门禁与 Firefox 均重跑 390×844                                                                                                 |
| B029 | chat.mobile.route.change           | 适用   | 已接   | 无后端 | Room/Thread/AgentDefinitionId/Agent tab 均有 reload-safe typed URL 投影；390×844 复用同一身份合同，不创建移动端真相                                                     |
| B030 | chat.pane.change                   | 适用   | 已接   | 无后端 | APP Chat/Tasks/Files 选择，H；tab内容分别验收                                                                                                                           |
| B031 | chat.room.create                   | 适用   | 已接   | 已接   | ROOM→`room.create`，control Room causal barrier，H                                                                                                                      |
| B032 | chat.room.select                   | 适用   | 已接   | 已接   | APP→Room/Message session与sync，H                                                                                                                                       |
| B033 | chat.room.sort                     | 适用   | 已接   | 已接   | 09-01 手动/最近/A-Z、拖拽置顶/移出/组内排序、设置置顶共享 Human×Workspace CAS；浏览器验证刷新保留。联合频道/自定义分组不含本项                                          |
| B034 | chat.sidebar.resize                | 适用   | 已接   | 无后端 | `room-sidebar-resizer`，pointer/keyboard，H                                                                                                                             |
| B035 | chat.task.column.toggle            | 适用   | 部分   | 无后端 | TASK 列状态/折叠需按本地与全局分别核对，N                                                                                                                               |
| B036 | chat.task.create                   | 适用   | 已接   | 已接   | TASK→`task.create/convert`，唯一Message/Thread，H                                                                                                                       |
| B037 | chat.task.filter.open              | 适用   | 已接   | 无后端 | TASK/DISCOVERY共享筛选popover，H                                                                                                                                        |
| B038 | chat.task.view.change              | 适用   | 已接   | 无后端 | TASK 看板/列表，H                                                                                                                                                       |
| B039 | chat.thread.close                  | 适用   | 部分   | 无后端 | APP可关闭 Thread；本轮双边关闭后焦点都落到 `body`，未还给触发按钮。官网桌面 Thread 的 Escape 与 Task detail 的 Escape 也不是同一合同                                    |
| B040 | chat.thread.open                   | 适用   | 已接   | 已接   | APP→`message.context/thread.list`，并非仅room.sync，H                                                                                                                   |
| B041 | chat.thread.resize                 | 适用   | 已接   | 无后端 | APP既有splitter/消息窗口测量，H                                                                                                                                         |
| B042 | computers.agent.open               | 适用   | 缺失   | 已接   | COMPUTER binding 行为article非跳转；Agent get已有，N                                                                                                                    |
| B043 | computers.command.copy             | 改造   | 缺失   | 无后端 | COMPUTER缺本地恢复命令及复制入口；不直接复制raft重启命令，N                                                                                                             |
| B044 | computers.computer.action          | 适用   | 缺失   | 部分   | Computer infrastructure存在，Human管理/跨机验收未齐，N                                                                                                                  |
| B045 | computers.computer.select          | 适用   | 部分   | 已接   | 本地自动显示第一台 Computer；官网直接进入 `/computers` 不自动选中且出现“选择一个频道”的官方缺陷，点击列表项后才显示详情。不能把官网缺陷复制为本地目标；多 Computer 仍缺 |
| B046 | computers.recovery.toggle          | 改造   | 缺失   | 无后端 | COMPUTER恢复指导展开入口未接，N                                                                                                                                         |
| B047 | computers.runtime.open             | 适用   | 缺失   | 已接   | COMPUTER Runtime chip为span，catalog/Offer有数据，N                                                                                                                     |
| B048 | computers.sidebar.resize           | 适用   | 已接   | 无后端 | COMPUTER复用宽度边界/键盘，H                                                                                                                                            |
| B049 | members.agent.action               | 适用   | 部分   | 已接   | AGENT pause/resume/manage/delete 与 restart/session reset 已走 exclusive fence、terminal proof 与正式重启验收；full reset 仍明确禁用，关系/外部身份动作另列             |
| B050 | members.member.create              | 适用   | 部分   | 部分   | AGENT managed provision已有；external/Human并非同一入口，H                                                                                                              |
| B051 | members.member.invite              | 改造   | 缺失   | 缺失   | Human invite尚未接；不以局域网设备配对代替，N                                                                                                                           |
| B052 | members.participant.select         | 适用   | 部分   | 部分   | AGENT选择已有；Human detail与路由恢复未齐，A                                                                                                                            |
| B053 | members.profile.update             | 适用   | 部分   | 已接   | Agent 名称/描述/官方头像、runtime/model/effort/mode 已经 revision-CAS 持久并有实页验收；剩余是 Human 资料、Room Human 角色 UI 和自定义图片生命周期                      |
| B054 | members.relationship.open          | 适用   | 缺失   | 缺失   | AGENT关系图disabled；不能用Room membership假装关系图，N                                                                                                                 |
| B055 | members.sidebar.resize             | 适用   | 已接   | 无后端 | AGENT splitter，H                                                                                                                                                       |
| B056 | members.tab.change                 | 适用   | 部分   | 部分   | 七tab可选择≠完成；详见AG00–AG08，A                                                                                                                                      |
| B057 | search.filter.change               | 适用   | 已接   | 已接   | DISCOVERY→`search`授权筛选，H                                                                                                                                           |
| B058 | search.filters.clear               | 适用   | 已接   | 已接   | DISCOVERY重置并重新查询，H                                                                                                                                              |
| B059 | search.query.change                | 适用   | 已接   | 已接   | DISCOVERY→Kernel搜索，H；非上游服务端算法复制                                                                                                                           |
| B060 | search.sort.change                 | 适用   | 部分   | 部分   | DISCOVERY本地排序合同已有，Raft相关度质量/全边界未验收，H                                                                                                               |
| B061 | settings.account.connection.change | 排除   | 排除   | 排除   | 不托管CLI账户/登录；本地MCP授权另列，不由本项排除                                                                                                                       |
| B062 | settings.password.update           | 排除   | 排除   | 排除   | 不复制Raft中央账户密码；保留本地认证/撤销安全要求                                                                                                                       |
| B063 | settings.preferences.update        | 适用   | 已接   | 已接   | Web Push enable/disable/test、Room 通知偏好、Workspace push 静音、消息字号、12/24小时制和实时状态动画已接；macOS/iOS 横幅仍是设备证据缺口                               |
| B064 | settings.profile.update            | 改造   | 部分   | 已接   | Workspace profile 复用 `workspace.update` causal mutation；Human 中央账户资料不适用，N                                                                                  |
| B065 | settings.section.open              | 适用   | 已接   | 无后端 | 12个适用/本地扩展 section 可刷新、前进/后退恢复；账单与应用已移除，N                                                                                                    |
| B066 | settings.sessions.revoke           | 改造   | 部分   | 部分   | LAN device revoke已有；不等同Raft中央登录session管理，H                                                                                                                 |
| B067 | shell.navigation.open              | 适用   | 已接   | 无后端 | APP/导航已接主模块；帮助/资源不因此自动完成，H                                                                                                                          |
| B068 | shell.notification.dismiss         | 改造   | 已接   | 已接   | 显式 dismiss 经 Human×Workspace canonical preference 持久化，最多100；open/view 不写，版本化本机事项可再次出现；InputRequest 仍必须显式 resolve                         |
| B069 | shell.notification.enable          | 改造   | 已接   | 已接   | 设备偏好默认开启；首次产品click请求未决权限，已授权时启动/focus自动订阅；设置关闭持久opt-out并unsubscribe，禁止自动复活。macOS/iOS各需用户授权后补一次真机投递证据      |
| B070 | shell.notification.open            | 适用   | 已接   | 已接   | 页内中心/粉点/InputRequest分owner；OS push点击使用same-origin typed target并重验ACL。desktop页内中心hover精确时序仍属鼠标对齐缺口                                       |
| B071 | shell.workspace.switcher.open      | 适用   | 部分   | 已接   | SPACE有目录/身份编辑 dialog；官网事实是**点击**空间标识打开 anchored switcher（不是 hover），Escape 关闭并还焦点，且记忆各空间最近 URL；本地尚未对齐                    |
| B072 | tasks.filter.change                | 适用   | 已接   | 已接   | DISCOVERY→`task.global.list`，H                                                                                                                                         |
| B073 | tasks.filters.clear                | 适用   | 已接   | 已接   | DISCOVERY清理筛选并查询，H                                                                                                                                              |
| B074 | tasks.view.change                  | 适用   | 已接   | 无后端 | DISCOVERY全局看板/列表，H                                                                                                                                               |

### 登记表的统计口径

本轮以脚本验证74个intent与旧清单逐项相等、无遗漏和重复。按上述限定行统计：

| 层次 | 已接 | 部分 | 缺失 | 无独立后端 | 排除 | 待裁决 |
| ---- | ---- | ---- | ---- | ---------- | ---- | ------ |
| 前端 | 32   | 20   | 14   | —          | 4    | 4      |
| 后端 | 30   | 12   | 6    | 18         | 4    | 4      |

范围分类为54项适用、12项需本地改造、4项排除、4项待裁决。**这些是74行旧意图的接线登记，不是全产品能力数，不是27/74完成率，也不是27项浏览器验收通过。** 一行可能包含多个动作，旧表又遗漏下节的关键维度，不能据此得出剩余开发百分比。

### 2026-09-01 独立审计覆盖层（历史快照）

完整结果与截图索引见[全站行为合同与双边差异主审报告](../audits/2026-09-01-full-raft-behavior-parity-audit.zh-CN.md)。下表只保留 2026-09-01 当时裁决；其中“4173 无后端”、消息 social 缺失、侧栏 disabled 等失败已被后续专项批次修复，不得当成当前正式部署结论：

| 产品面                            | C 代码 | A 自动化 | L 本地浏览器                               | R 同前置双边                    | D 正式部署                |
| --------------------------------- | ------ | -------- | ------------------------------------------ | ------------------------------- | ------------------------- |
| Shell / Chat 框架                 | 有     | 有       | 基础几何通过                               | 部分                            | **失败：4173 无可用后端** |
| Channel / DM 侧栏                 | 有     | 有       | **失败：4196 条目与拖拽包装持续 disabled** | 失败                            | 阻塞                      |
| Thread / Task                     | 有     | 有       | 主要结构通过                               | 部分通过                        | 阻塞                      |
| 消息 hover / 回应 / 收藏          | 有     | 有       | **失败：普通消息只显示 Thread**            | 失败                            | 阻塞                      |
| Room 设置 / 成员                  | 有     | 有       | 成员与返回通过，偏好 disabled              | 部分                            | 阻塞                      |
| Agent 身份 / hover / 详情         | 有     | 有       | 头像 hover、点击详情、姓名 `@` 通过        | 结构部分通过                    | 阻塞                      |
| Agent 提醒 / 应用 / MCP / Chat    | 部分   | 部分     | 提醒/应用明确未接，MCP 与 Chat 语义不同    | 失败或未验证                    | 阻塞                      |
| Search / Activity / Notifications | 有     | 有       | Search 与通知业务矩阵通过；Activity仍部分  | Web Push 软件链通过，设备待授权 | 阻塞                      |
| Files / Agent Workspace           | 有     | 有       | 空 Room Files；fixture 私有树通过          | 非空 Workspace 被官网离线阻塞   | 阻塞                      |
| Computer                          | 部分   | 有       | fixture 在线只读详情                       | 状态不同，未形成同前置结果      | 阻塞                      |
| 390×844                           | 有     | 有       | 核心壳/文件树部分通过                      | 未做官网同前置移动审计          | 阻塞                      |

状态点也不能合并成一个 `dotColor`：Raft 至少有 Chat 未读、Activity 个人未读、Computer attention（离线/升级/legacy）和 Computer 列表连通性四套语义。进入 Activity 只隐藏选中态粉点，不等于 read；Computer 列表灰点表示离线，rail 粉点表示 attention。

### 2026-09-02 当前 overlay

- 正式 4173 的 schema 36 状态已重启并恢复，不再是上表的“无可用后端”。
- Chat 消息回应/收藏/原文回跳、Room/Agent 侧栏宽度、Agent 个人资料及 runtime/model/effort、Settings 骨架、动态投影、官方头像和 Web Push 软件链已各有后续专项证据。
- 调度审计证明两个独立 Worker 的 Raft freshness/held-draft/peer-wake 主路径，并已在真实浏览器中完成严格交替 `1…10`。
- P1.1 已接 Human Room 角色查看/修改；P1.2 已接可逆 Room 归档/取消归档、归档只读、侧栏隐藏与同名归档频道恢复。正式 `4173` 已在状态备份和空活动工作检查后重启；真实 Room 仅做非写入的设置/确认/Escape/焦点与 `390×844` 回归。
- P1.3 已接独立 `room.leave`：请求不携带 `principalId`，actor 来自认证上下文；成功后侧栏移除并选择同 Workspace 下一 Room。橙色二级确认、loading、Escape 只关闭顶层、焦点返回及桌面/`390×844` 已在隔离真实浏览器通过。RAH 当前离开后按 Room membership 收紧全部历史/消息列，尚未复制 Raft“继续关注公开消息列”和公开频道自助重新加入。
- 仍未关闭的最高优先项是删除合同与安全停止 Agent；后续顺序见 [Raft-first 剩余收口计划](./2026-09-02-raft-first-remaining-closure-plan.zh-CN.md)。

## 4. 旧意图表漏掉的维度

必须继续增补，不能只追求74行全部打勾：

- 鼠标hover/离开延迟、头像与姓名分工、tooltip/card焦点与关闭、组合键链接行为。
- 每个Agent tab的子行为、数据权限、错误恢复、完整URL恢复、拖动排序偏好。
- navigation未读、Computer在线、managed/external Agent presence、诊断点颜色与motion。
- Files上传/取消/下载/跳原文、Agent读附件与发布Artifact、Task/Thread附件、私有目录与项目挂载。
- 单winner Task、helper/reviewer、Human InputRequest、显式Review、安全改派、暂停/重启/reset。
- 真实Provider工作与恢复、跨Room个人memory、分页锚点/图表稳定性、LAN/PWA生命周期。

源码候选索引仍列出13个未归档引用，但2026-09-02已完成第一轮动态触发分类：

- `AboutFeedbackDialog`与`bug`只在设置“反馈”入口加载，并请求中央
  `/api/product-feedback/tickets`；RAH 不复制此中央反馈域。
- `index-DQuoke3Q`是设置移动端下载二维码编码器；应用下载页不在当前本地产品范围。
- `upload`是多个资料页共用的图标分块，已在账户/Agent资料入口加载；它不是独立上传后端。
- `vendor-react`、`vendor-markdown`、`vendor-socketio`是共享供应商包；
  `message-square-text`是图标；`transform`是成员关系图缩放/拖动依赖。
- `mermaid.core`、`shikiHighlighter`和`runtime`属于按Markdown内容加载的图表/代码高亮链，
  需要在“消息内容类型”专题验证，不按三个业务按钮计数。
- 当前消息的七个快捷回应不会加载`emoji-picker-react`；该文件仍是条件式完整表情选择器，
  必须追到实际触发后再裁决，不能把快捷回应通过外推为完整picker通过。

因此13项中已确认5项当前范围外或无独立业务语义、7项为共享/内容依赖，只有条件式完整
Emoji picker仍需继续追踪实际触发。此分类不等于这些文件已归档，也不把Markdown图表/高亮
的显示正确性标成通过；动态证据见[前端操作状态审计](../audits/2026-09-02-raft-interaction-state-verification.zh-CN.md)。

## 5. 下一批收敛顺序

1. **合同与导航正确性**：补Agent tab/身份 deep link、字段inline编辑与头像/姓名/tooltip的参数；先解释“Agent私信”语义差异，不放宽ACL读取别人私聊。
2. **已有能力映射**：MCP使用服务器/工具视图、Computer→Agent/Runtime导航、文件预览与偏好，优先复用已有owner。
3. **确实缺的后端**：Agent提醒、应用grant、restart/session reset与Files Worker链路分别设计，不以UI占位或通用shell替代。
4. **逐场景验收**：先相同数据前置和桌面尺寸，再390/Firefox；最后真实CLI和正式部署。官方离线的测试单列阻塞，不影响本地独立实现，也不授予双边通过。

## 6. 当前交付校验

- 已提交可回退基线 `023aad7 feat: establish Raft-aligned collaboration baseline`，未 push；后续 P1 改动仍按本计划执行。
- 当前 `npm run check`：package `763` 项中 `761` 通过、`2` 项真实 Provider 按规则跳过；Web `160/160`；真实回调回归 `34/34`；TypeScript、format、diff、production Web build 与依赖审计通过。测试总数不是 Raft 产品覆盖率。
- Firefox 隔离门禁通过 desktop `1440×1000` 与 mobile `390×844`；P1.2 的归档名称恢复专用浏览器合同在 desktop/390 均通过。
- 正式持久状态先通过 SQLite `quick_check` 和 active work 空集合检查，并创建一致性备份；随后优雅停止旧实例、重启 `4173`，`/_rah/health` 返回 online、schema 36。正式 Room 未执行归档写入，只打开确认层并验证 Escape、focus return、父层保留和窄屏无溢出。
- 未调用付费 Provider，未使用 GPT-5.6 Ultra，未对 Raft 官方账号执行配置或业务写入。官网 Server 未形成相同归档数据前置，因此本轮不能宣称归档业务 `R` 双边通过。
