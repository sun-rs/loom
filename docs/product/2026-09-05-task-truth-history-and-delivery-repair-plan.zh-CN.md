# Task 真相、长历史与交付闭环修复计划

## 目标

在不推翻 Room-first Kernel、不复制参考项目模拟状态机的前提下，恢复“看起来完成”和“业务真正完成”的同一含义；随后让长期 Room、冻结交付与独立审阅形成可持续的单机多 Agent 闭环。凡是与 Raft 具有相同功能的页面，UI、鼠标、键盘、焦点、空态、加载态和错误态仍须按相同前置条件双边核验。

## 来源优先级

1. Raft 官方文档、授权快照、真实页面与 bundle 行为证据：决定产品行为和 UI 合同。
2. 已取得的 Raft Computer / Runtime 代码：只移植能确定 owner 与许可来源的协议或恢复逻辑。
3. Multica：只吸收其对本地持久化、分页或恢复有明确优势的实现，不引入模拟状态机。
4. RAH OS glue：仅补本地 daemon、SQLite、ACL 和 typed SDK 的必要适配。

每项采用都记录来源、版本/哈希、采用层级、RAH 修改和验证证据；不能把重建产物称为官方源码。

## 顺序与退出条件

### A. Task 单一业务真相（当前批次）

- schema 与协议禁止 `Task.state` / `workflowStatus` 分裂。
- Raft 五态 UI 只发送 intent；Kernel 解释 cancel/reopen/complete，认领和提交仍由真实命令产生。
- 运行中无效移动不写事件、不推进 Room sequence，Worker 可继续提交进度。
- 完成依赖任务返回准确 Activation 回执；不同目标复用幂等键返回冲突。
- 真实浏览器点击完成后同时断言 Task 行与 `task.completed` ledger 事件。
- 保留 Raft 五列、菜单顺序、颜色、拖拽和卡片结构；不可执行项使用同一浮层的 disabled 状态。

### B. Room 长历史有界同步

- 新客户端不得从零自动拉取并常驻全部 Room 事件正文。
- daemon 提供冻结游标/快照边界；客户端仅保留可证明上限的热窗口和按需历史页。
- prepend 保持可视锚点，重载、断线、重复页、10 万事件与窄屏均有门禁。
- Task、Review、Submission 列表改为有界查询，消除每 Task N+1 依赖/参与者读取。

### C. 冻结交付证据

- Submission 固定同一交付版本的 repo/workspace identity、base/head、patch digest、附件清单和测试结果摘要。
- Reviewer 只审查该冻结版本；工作区继续变化时必须形成新 revision，而不是静默替换审查对象。
- 不存在 Git 的工作区保留 provider-neutral Artifact 证据路径。

### D. 团队业务闭环

- 方案与验收标准 → 施工前审查 → 主 Agent Task → 必要助手 Task/依赖 → 冻结提交 → 独立 Review → 返工 → Human 验收 → 下游任务启动。
- “必要助手”用有负责人和依赖的 Task 表达；普通 Room 邀请不被误报为必要交付。
- 完成后从 canonical Task、Submission、Review、Room event 与 Activation 独立复验，刷新与重启后仍成立。

### E. 页面族与设备验收

- 继续 Search / Tasks / Message 页面族，再做 Human / ACL、Computer 管理与通知设备验收。
- 组件 fixture 覆盖 hover/focus/disabled/loading、长名称、空数据、权限不足、侧栏、390×844 与断点两侧。
- 同功能 Raft 页面做同视口、同数据前置的 computed-style 与真实点击比较；内部视觉回归只用于防止 RAH 自身退化，不能替代官方比较。

## 当前进度

| 批次            | 状态   | 当前证据                                                                                                                                                                                                                                                                              |
| --------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A Task 单一真相 | 已完成 | schema 48、Kernel/协议/Web TDD、真实 Chrome/Firefox、正式重启与业务断言均已通过；见[审计](../audits/2026-09-05-canonical-task-lifecycle-and-browser-verification.zh-CN.md)                                                                                                            |
| B 长历史        | 已完成 | schema 49、最新 snapshot + 500 条尾部、2,000 event/8 session 客户端上限、可见 receipt 窄查询、10 万事件压力与真实浏览器门禁；见[审计](../audits/2026-09-05-bounded-room-history-verification.zh-CN.md)                                                                                |
| C 冻结交付      | 已完成 | schema 50 固定 RunAttempt/Placement/workspace、Host 观测的 base/head/patch、Artifact manifest 及 producer-declared verification；完整回归、正式重启、双浏览器与来源审计见[验证报告](../audits/2026-09-05-frozen-task-delivery-evidence-verification.zh-CN.md)                         |
| D 团队闭环      | 已完成 | 方案审查、必要助手 Task/依赖、冻结提交、独立 reviewer 首版驳回、数据库重开、同 Task 新 revision、Human 验收及下游唤醒均已通过；见[验证审计](../audits/2026-09-05-canonical-team-workflow-verification.zh-CN.md)                                                                       |
| E 页面与设备    | 进行中 | Search／Tasks／Message 首段已统一空态 owner、筛选身份、消息操作矩阵并通过真实 Chrome/Firefox；见[页面族审计](../audits/2026-09-05-search-tasks-message-page-family.md)。下一段继续非空/失败/权限组合、Human／ACL、Computer 管理与通知设备送达；相同 Raft 页面必须按同前置继续双边对齐 |

当前出口已经转入 E 的页面族与设备验收。C 的实现与来源裁决见
[ADR-0031](../adr/0031-host-observed-frozen-task-delivery-evidence.md)：冻结证据绑定同一
Submission revision 的 workspace/repository identity、base/head、patch digest、附件清单与
分级验证声明；Reviewer 只能对该冻结对象作出 Review。没有 Git 的工作区保留
provider-neutral Artifact 证据，当前可变工作区或主 Agent 摘要不能冒充已经审查的交付。
发布验收与剩余边界见
[冻结交付验证审计](../audits/2026-09-05-frozen-task-delivery-evidence-verification.zh-CN.md)。
D 的完整组合证明见
[团队业务闭环验证审计](../audits/2026-09-05-canonical-team-workflow-verification.zh-CN.md)。它没有把
`producer_declared` 冒充系统测试证明，也没有在缺少 Raft 官方来源时发明第二套 attestation
页面；系统管理验证器是未来可选增强，不是当前 Raft 对齐的阻塞条件。
