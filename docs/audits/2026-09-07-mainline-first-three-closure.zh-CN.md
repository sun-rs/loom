# 第一至第三项：本地闭环验收

范围依据[五项实施方案](../product/mainline-implementation-plan.zh-CN.md)：单 Human、单 Mac、
多 Agent 的配置、Room 协作、Task/Review。此处收口指适用主线的代码及本地确定性验收，
不是全 Raft API 同形、全页面视觉对照或真实付费 Provider 发布认证。后三类仍独立记录，
不因本报告通过而自动通过。

## 第一项：Agent 配置与执行

- 配置不确定回执、重置不确定回执此前已修复。
- Web 配置→旧子进程继续→下一子进程采用新 runtime/model/effort，以及身份/cwd/记忆目录连续性，
  见[贯通证据](./2026-09-07-runtime-configuration-continuity.zh-CN.md)。
- 本批扩展 reset 浏览器矩阵：503/403 响应前模拟 pending，禁止取消与 Escape，失败留在弹层，
  可重试并恢复；Chrome/Firefox × desktop/390×844 通过。这里模拟的是传输/拒绝反馈，
  真实权限和 busy fencing 由下面的后端测试验证，不能混为同一证据。
- Host coordinator / daemon administration 测试验证 active lane 等待 terminal proof、
  restart/session/full 语义、回滚、失败恢复及幂等 receipt。
- 既有业务浏览器旅程增加暂停→恢复→再次暂停，验证实际 canonical 管理入口。

## 第二项：Room 多 Agent 与消息能力

本批实际补齐 `message-search` / `message-react` Worker HTTP + CLI 入口；Human 按钮已有
不能替代 Agent 能力。复用 GlobalDiscovery / MessageSocial，当前 Run 凭据和 toSeq 提供范围，
不新增队列或全 Workspace 访问权限。设计和源码定位见[合同](../design/worker-message-tools.md)。

新增 HTTP/CLI 测试覆盖当前 Room、有界分页、未来消息拒绝、query/cursor 绑定、reaction 原子
计数/回执复用/删除/认证归属、凭据撤销；真实隔离子进程→CLI→daemon→Human 双浏览器 reaction 显示通过。

同时回归 Worker freshness、MultiLaneAgentHost 和 Activation obligations：并发回复中的较旧
上下文被 hold，忙时后续工作持久保留，重启/quarantine 不放行同 Agent 第二条执行 lane，
reviewer 必须提交 Review，owner 必须显式产出 Task outcome，诊断输出或进程退出不能完成业务。
本批未改变这些既有机制。

适用映射：消息读/发、Thread 归属、Task 命令、Reminder、显式 Thread unfollow 已有 owner；
本次补 Agent 搜索/reaction。Raft 的自主 channel join/leave、Agent self-profile、knowledge/wiki
并未因此实现；它们不属于上述当前 Room 工作闭环，仍须在对应权限/页面适用性清单单列。
本报告不把它们写成已完成，也不将 Human 多人项目重新启动。

## 第三项：Task / Review 交付

既有 Kernel team workflow 已覆盖 plan review、helper delivery、依赖约束、首次提交驳回、
重启后返工、修订提交和批准、Human 验收后释放下游。新增完成后的数据库重开检查：
Task 仍 completed，两版 Submission 和两次 Review 内容逐项完全相同。

冻结证据相关 daemon Git tests 一并回归；实际工作区证据由已有 Host collector 采集，
不是模型自报输出替代。既有真实浏览器旅程验证 UI 创建任务、指定 reviewer、两次 Fake Worker
提交、Thread 内驳回/批准记录、Human 确认及 canonical task.completed 事件。
不把 reviewer 发一条文字或 CLI exit0 当作完成，也不重新建设 Task/Review 后端。

## 证据位置与发布边界

本批日志：`/Users/sun/Code/reviews/rah_os/2026-09-07-mainline-three`。
第一项浏览器：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-agent-reset-pI8MoU`。
第二项浏览器：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-worker-tools-browser-Valazz`。

未知官网状态、物理设备通知/PWA、长期 soak、真实 Provider 三项完整旅程仍属于第五项发布证据。
部分 Agent/文件/Computer/Settings 页面及更完整 Raft Agent API 对等仍属于后续工作，
不能从本地核心闭环推导“完整复刻 Raft”。付费 CLI 未运行，无 commit/push。

## 最终门禁与正式交付

`npm run check`、`npm run format:check`、`git diff --check`、正式 Web build 和
`npm run test:web:browser` 全部通过。新增 Worker HTTP/CLI 回归、multi-lane/obligation 回归、
Task/Review 完成后重开以及 Git 冻结证据测试通过。已检查 Worker reaction 移动端截图。

正式 idle 检查、备份验证与精确优雅重启完成，冻结 build：
`a0152ee8834f7c776672a4335d0fe34b16abb754a0b18d02a98eb00095fbb444`。
备份位于 `/Users/sun/.rah/backups/pre-restart-298e4bc1-8480-4860-a2ab-1043e9770674`。
正式地址 <http://127.0.0.1:4173>，交付时监听进程 59336。
正式 Chrome/Firefox 新页面 `test:web:formal-discovery` 通过，已检查桌面任务截图。
正式证据：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-discovery-formal-1Sgkxd`。

前后持久快照完全一致：6 Rooms、43 messages、2 Tasks、378 events、4 Agents、
35 configuration revisions、37 memory files。隔离 fixture 的任务和 reaction 没有写入正式用户状态。

结论：上述第一至第三项的本地确定性闭环收口；下一项是第四项页面/本机管理收尾。
全 Raft 对等、完整 Agent API、真实 Provider 与设备发布门禁仍按前文边界保留，未宣称完成。
