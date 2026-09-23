# 实例私聊纵向 MVP

2026-09-23。范围：频道实例 → 右侧私聊 → 排队 → Worker box 回复 → 重开续聊。未运行付费模型、未提交或推送。

## 设计与来源

落实已批准的 [私聊访问合同](../design/role-instance-session-v0.2.zh-CN.md) 和 [纵向 MVP](../design/role-instance-vertical-mvp.zh-CN.md)。沿此前 [Raft / Multica 能力核查](./2026-09-22-role-session-capabilities.zh-CN.md) 的来源证据；本批复用 RAH 已有 direct_room_pairs、Room/Inbox/Activation、Worker target 与原生 session store。实例私聊按执行目标隔离是 RAH 的产品适配，不宣称为 Raft 字节复制，也不新增第三方代码。

canonical direct Room 是唯一私有 box。创建沿既有原子事务、幂等与 authenticated API；只放开 Human 到来源频道现存实例的入口。实例不能自行创建 DM，其他 Agent 也不能向该实例创建私聊。

Kernel 的实例目标谓词过滤 Worker 目录、读取和搜索；私有目标只在该实例执行此 Room 时开放。公开频道历史仍按 membership 可读。target post 拒绝跨目标发帖。运行期通知仅保留当前 Room 的 Human 新消息，其他消息保持持久待处理。既有 participant lane 保证频道与私聊串行，不新建队列。session key 不包含 Room，私聊与频道的 standing prompt digest 相同。

UI 使用现有第三段详情容器、ChatPane、RoomSession、MessageSession；不新增布局断点，不把私聊插入左侧 DM 列表。普通文本消息可发送、等待回复和重开读取；附件、Task、Side、fork、平台记忆均不在本批范围。

## 验证记录

红灯先确认旧 API 拒绝实例私聊，另一个 UI 单测证明已创建的私有 Room 会漏进左侧 DM；实现后定向检查通过。Kernel 集成覆盖私有 box 幂等打开、频道运行时禁止读取/目录/搜索私聊、私聊排队而不 steer、不同时 lease 同一实例、私聊执行后读取与定向回复。公开历史仍可读取，跨目标回复被拒绝。Daemon 单测确认 channel/private Room 变更不改变实例 standing prompt 的 session key。

最终隔离浏览器通过频道两轮和私聊两轮 Fake CLI 回复、私聊历史重开、原频道保留、左侧 DM 不出现实例、1440×900 与 390×844 响应式返回；截图已目视检查。回复断言按私有 Room 中的 actorId 核对，而不是按头像 DOM 数量猜测。证据见 [本批目录](../evidence/2026-09-23-instance-private-box/)。

完整检查曾发现 reused-account-target 的手写最小 SQLite fixture 缺少 role_instances/run_attempts 两张表，已补齐 fixture 结构，原寻址断言保持不变；正式数据库本来已有这两张表。本批无 schema 迁移。

隔离测试证明权限、串行和 Fake CLI 收发，不证明真实模型语义连续性或供应商性能。没有开启真实付费 CLI 门禁。

## 后续入口收口

本批验收入口是“频道消息头像 → 实例右侧详情 → 消息动作”。搜索/动态中命中私聊后的统一第三段路由、刷新自动恢复已打开私聊面板，留在后续 UI 入口收口；本批验证的是刷新后重开同一 box 恢复历史。未为这些次要入口另建路由状态机。实例私聊暂复用详情页“聊天”区域，Role 管理全量替换旧 Agent 页面仍属后续迁移。

## 最终检查与正式工作台

`npm run check` 的类型检查、全量包测试（1791 通过，17 个 opt-in 跳过）和 Web 单测（482 通过）通过。随后源回调夹具因未注入新增 agentDirectory 依赖失败；补齐夹具并新增“私聊返回 box、不替换频道/侧栏”断言后，单独续跑 check 的尾部：回调 35、formal-browser-policy 15、bilateral-captures 3 全部通过。没有将前一次 check 非零退出记录改写成成功。

最终 `npm run format:check`、`git diff --check`、`npm run build:web:workbench`、Web typecheck 和 `npm run test:web:role-mvp` 通过。未改 CSS 规格或放宽源码行数门槛。

正式工作台经 restart guard 确认空闲，备份校验通过：`/Users/sun/.rah/backups/pre-restart-e1a1e5e3-84b1-40f6-81d2-fdda9f619d0e`。旧 PID 10411 退出，新 PID 34256；冻结 Web build 为 `4b678b105d3113ea36795e42428b4b182da1c8a9f1868beadcb660dfcbaa376c`，health HTTP 200。新鲜正式浏览器 Role 页面和频道选择器正常，已目视核对；未在正式库创建测试 Role 或发送消息。

重启前后按完整排序行摘要比较：messages（238）、agent_definitions（15，包含历史身份）、agent_definition_revisions（95）、role_templates（0）与 role_instances（0）均一致。私聊非空交互证据来自隔离 Fake CLI 环境；正式环境当前没有 Role 实例，不能宣称真实 CLI 私聊验收已完成。
