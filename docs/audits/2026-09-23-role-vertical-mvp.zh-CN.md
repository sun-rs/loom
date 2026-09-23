# Role 纵向 MVP：第一条业务路径

日期：2026-09-23。遵循用户最新“纵向 MVP 优先”决定，范围见 [施工清单](../design/role-instance-vertical-mvp.zh-CN.md)。

## 已接通

成员页 → Role 管理 → 创建配置 → 选择已有频道加入实例 → 频道 composer 发言 → 既有 daemon/Worker box 回复 → 刷新后再次发言。

RoleCatalog 拥有模板与实例来源事务，Protocol/应用服务/SDK 暴露 create/list/instantiate。实例复用既有 Principal、AgentDefinition、Inbox/Activation 与 AgentHost；没有新增调度队列。schema 59 增加两张表，旧 Agent 不迁移。

Role 保存不产生执行身份或首轮运行。实例仅加入目标频道，不自动加入 all；同 Role 跨频道获得不同身份。不能追加到其他频道，不能从旧私聊 API 打开全局 DM，不显示在左侧私信候选。实例禁止切换 RuntimeOffer。含实例的频道暂支持归档、不支持永久删除；完整销毁流程延期。

界面沿用既有创建表单与聊天组件，保留旧成员入口。本批不是全部 Agent → Role UI 替换，也没有完成平台记忆、Side、fork 或私聊。新实例仍沿用旧的每身份独立文件记忆，不能宣称共享平台记忆已经上线。

## 验证

- TDD：先复现缺少 Role 聚合/SDK 路由、跨频道追加、旧 DM 入口、来源投影和运行时切换约束的失败，再实现。
- 临时 SQLite + 真实 Human SDK/HTTP + Worker HTTP：Role 不启动执行、两频道独立身份、两轮显式回复及 ACK、来源限制和基本幂等通过。[输出](../evidence/2026-09-23-role-vertical-mvp/kernel-sdk-worker.txt)。
- 隔离真实浏览器 + 临时 daemon + Fake CLI：真实表单保存 Role、加入新频道、composer 发送和两轮回复、中间刷新通过。桌面 1440×900、窄屏 390×844 截图已目视检查。[输出](../evidence/2026-09-23-role-vertical-mvp/browser.txt)、[桌面](../evidence/2026-09-23-role-vertical-mvp/desktop.png)、[窄屏](../evidence/2026-09-23-role-vertical-mvp/mobile.png)、[两轮对话](../evidence/2026-09-23-role-vertical-mvp/two-rounds.png)。
- 完整检查与正式部署状态在下节记录；不能用局部通过代替完整检查。

测试仅使用 Fake CLI，不是付费原生 CLI 或同前提 Raft 双边验收。两轮相同实例不证明 provider 原生 session ID 严格连续；现有 prefer_resume 的正常续聊复用、失效时处理，需要后续原生门禁。没有 token/延迟收益结论。

## 完整检查与正式部署

- `npm run check` 通过：packages 1788 通过、17 项 opt-in 跳过；Web 481 通过，callback 回归 34 通过；其余 UI/协议/发布策略门禁通过。[完整输出](../evidence/2026-09-23-role-vertical-mvp/check.txt)。新增 API 后更新了 Core/SDK 的接口清单断言及 schema 当前版本断言；共用创建表单后，将旧硬编码标题测试改为分别断言 Agent 默认值与 Role 分支。
- `npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。新增页面 CSS 后，重新运行 sidebar-row/sq-btn 浏览器规则采集；只更新 CSS 来源摘要，没有放宽视觉阈值。
- 按既定要求执行受保护重启。备份校验与迁移预检通过，旧 PID 68893 退出，新 PID 87647 监听原 loopback/LAN/Tailnet 地址。schema 58→59，新 Role/实例表均为空；没有迁移或创建正式身份。
- [重启收据](../evidence/2026-09-23-role-vertical-mvp/restart.json)记录备份位置、版本和构建。对备份与重启后的 messages、agent_definitions、agent_definition_revisions 逐表稳定排序摘要核对，完全一致；记忆及其他持久文件由既有在线备份/校验流程保护。
- 正式页面刷新后确认历史消息；通过真实指针打开“成员 → Role 管理 → 创建 Role”，取消返回，目视检查无错误。HTTP 页面构建 ID 与冻结资产 `f0a69018b35329dbcbc56bc8d5c5146e14c7b22bcb81e46a1ca0b7b363c57599` 一致。这是正式页面冒烟，不是正式库付费模型测试。
- [选定源码摘要](../evidence/2026-09-23-role-vertical-mvp/source-snapshot.json)记录本批文件；工作树含前期修改，不表示干净提交或完整发布清单。未提交或推送。

下一条主线先验证新实例的原生 session 连续性，再扩展新业务入口；恢复/fork/Side/共享记忆与历史迁移不抢在主流程之前。
