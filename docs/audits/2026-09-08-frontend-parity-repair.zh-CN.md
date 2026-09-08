# 前端差异修复与正式服务交付

本批只处理前次双轨审查确认的前端差异及用户指出的 Rail 底部偏移。
前次后端差异清单仍需单独收口；不恢复用户排除的托管 MCP、多人、中央账户或远程 Computer。

## 官方依据与实现边界

当前官方入口 `index-BVfbaScj.js` SHA-256
`65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`，
来自 [2026-09-08 冻结目录](../evidence/raft-web-20260908-current/manifest.json)。
Computer `MachineDetailPanel-DkiunI4y.js` SHA-256
`c8f6e31379c5d089d380557094d775696b94c50fce5c0f65ad321817d2dcfdb9`。
公开发布源码只作分析依据，不作为生产依赖；保留现有来源和授权登记。

| 项目             | 官方合同                                               | 本地变更                                                               |
| ---------------- | ------------------------------------------------------ | ---------------------------------------------------------------------- |
| 全局 Task        | 保留全局背景的居中 Thread 弹窗，metadata 与历史        | 复用现有 Thread、Task 状态操作与导航 owner；不是另建讨论               |
| Task 历史        | 可展开的任务生命周期记录                               | 从现有 Worker owner 抽出共享投影，补 Human 认证读取与有界分页          |
| Search           | `ge=Jr.length+ne.length`，实体与已加载消息计数         | 可见实体加累积消息命中；隐藏当前 Human 不计数；服务器消息 total 不变   |
| Rail 底栏        | 8px 底留白，通知/帮助/设置各 44px；短高通知按钮仍 40px | 补底留白与真实帮助入口，修正短高覆盖；帮助链接本机指南属于本地产品适配 |
| Computer Runtime | 24px 高、14px 字体/20px 行高、4px/10px 内边距          | 修正原 11px 字体与 2px/8px 内边距                                      |

以上是源码结构/行为移植及 RAH 接线，不宣称逐字复制。
Search 核过 Multica mobile `search-rows.ts`，其 Issue/Project 模型不适合替换本地既有搜索 owner。
不因为此批补了统计数字，宣称所有实体种类、搜索排序和服务端筛选已完整对齐。

## 验证与交付

本批代码、确定性测试、隔离浏览器和正式服务验收已完成。

- `npm run check` 最终通过：包测试 1,042 项通过、5 项付费门禁跳过；Web 383 项、历史行为回归 34 项，以及权限策略和双边工具测试通过。初次旧回调提取测试缺少新增 Task route 的作用域参数，补入真实 parser 和非 Task 的关闭状态后，原断言保持不变并全部通过。
- 最终类型检查、格式检查、`git diff --check`、正式 Web 构建通过。
- Search：Chrome/Firefox × 1440×900 / 390×844 的实体、无结果和刷新，共 8 组；计数与实际显示项一致。
- Computer/Rail：Chrome/Firefox × 1440×900 / 1280×598 / 390×844，DPR 2，共 6 组；runtime chip、短高底部几何、帮助真实链接、hover/离开、键盘/Escape/焦点与手机换行通过。
- Tasks：Chrome/Firefox × 桌面/手机，共 4 组；真实指派 Alice、刷新保持、取消指派和历史；状态关闭/重开；Thread 回复及刷新；筛选、Back/Forward、Escape、焦点返回；读取失败恢复及晚响应均通过。另捕获并修复弹窗预留 Thread 列导致背景缩窄，以及 Task metadata 继承消息内边距导致分隔线缩进的问题。
- 全局负责人控件复用 `task.assign/unassign` 与现有 `TaskReassignDialog → task.reassign`。不确定回执重试保留原始幂等键和因果序号，更新前拒绝已变化的 Task 快照。运行中安全改派完成证明由既有 daemon 持有；本批验证了 helper 路由及原后端回归，未新增付费 CLI 改派实验。
- Chrome 主业务流程及 Firefox 冻结构建/持久工作台门禁通过。
- Human Task history 经独立复核，另用两项反例验证 actor/Worker/Human cursor 隔离、撤销成员续页拒绝、大 UTF-8 历史完整分页和单条超限拒绝。

正式地址：[http://127.0.0.1:4173](http://127.0.0.1:4173)。
启动前检查发现期间已有另一正式实例恢复监听；操作工具先拒绝重复启动，随后核验准确 PID、空闲状态和工作区，备份后优雅替换该实例，没有强杀或清库。
正式构建 `6bff1b70b31928b81688c526ead6353fe2ce5ddf4183a1f6e32dac8219a544cf`。
备份 `/Users/sun/.rah/backups/pre-restart-daf10429-65ee-4286-befe-86710e4e6d8c`。
重启前后 canonical/config/runtime/memory 快照完全相等：6 个 Room、43 条消息、2 个 Task、4 个 Agent、37 个记忆文件均保留。

重启后新 Firefox 页面在 1440×900、390×844、DPR 2 下读取正式数据，
Computer 标签/底栏、Task 历史与刷新、Search 实体计数均通过；构建 ID 一致、零 page error、零未授权验收请求。
正式截图经主审查看。本轮不是新增官网全站同前置实操验收；官方冻结源码和前次原图用于修复依据，适用范围外及前次未修差异继续保留。未提交 Git、未推送、未运行付费模型测试。

本批证据目录：
[/Users/sun/Code/reviews/rah_os/2026-09-08-frontend-parity-repair](/Users/sun/Code/reviews/rah_os/2026-09-08-frontend-parity-repair)。
前次双边原图和差异仍保留于
[双轨审查](./2026-09-08-two-track-parity-and-mcp-retirement.zh-CN.md)。
源码合同、本地浏览器结果、同条件双边结果和正式服务部署分别报告，互不替代。

专项证据：

- [Task 导航、历史与负责人交互](/Users/sun/Code/reviews/rah_os/2026-09-08-frontend-repair/task-detail/assignee-browser/results.json)
- [Computer/Rail 来源与收口](/Users/sun/Code/reviews/rah_os/2026-09-08-frontend-parity-repairs/computer-rail/closure.zh-CN.md)
- [Task history 独立审查](/Users/sun/Code/reviews/rah_os/2026-09-08-frontend-parity-repairs/task-history-independent/review.zh-CN.md)
- [正式页面验收](/Users/sun/Code/reviews/rah_os/2026-09-08-frontend-parity-repair/formal-browser.json)
- [正式状态一致性](/Users/sun/Code/reviews/rah_os/2026-09-08-frontend-parity-repair/formal-state-integrity.json)
