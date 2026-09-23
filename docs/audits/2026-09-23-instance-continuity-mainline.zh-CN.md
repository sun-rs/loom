# 实例续聊与私聊撤销：纵向主线修复

## 范围与设计

本批只闭合审计发现的三个后端断点，不开发 fork、Side、记忆平台或新前端入口。
继续采用[纵向 MVP](../design/role-instance-vertical-mvp.zh-CN.md)与用户批准的严格续聊策略。
上游依据沿用[会话能力核查](2026-09-22-role-session-capabilities.zh-CN.md)和
[稳定 session 键](2026-09-23-instance-stable-session.zh-CN.md)中的版本、来源与差异说明；
这里是 RAH 执行围栏的修复，不是声称直接复制 Raft 或 Multica 的实现。

## 单一 owner 与行为

1. AgentHost 的 session evidence 保存失败属于执行失败，不再当普通 trajectory 噪声忽略。
   Collector 保留独立、不可被后续 activity 清除的连续性错误，并触发既有 cancel/reap，
   覆盖直接进程和 supervisor。即使进程已经以 0 退出，Host 仍按结构化失败隔离 Activation；
   原始退出码保留，不伪造进程退出来源。
2. Kernel 从已有 RunAttempt / RuntimeProcess 持久账本派生 `instanceSessionRequired`。
   有过 prepared 进程就不能再把 Host 记录缺失解释成首次启动；未准备进程的失败不触发这个条件。
   四家适配器消费同一标志，Host store 缺失时在 spawn 前抛出连续性错误。
   原生 ID 的持久 owner 仍是 ProviderSessionStore；不增加第二套队列、session 数据库或恢复状态机。
3. 实例私聊发新消息时重新校验双方的来源频道 membership。旧消息幂等重放和历史读取保留。
   移除频道成员之前，沿用现有 active-work 阻断规则检查相关私聊，覆盖排队、租约、隔离和进程。
   既有错误状态中的私聊 Activation 同时被 legacy lease、Placement 候选和 RunAttempt 创建围栏挡住。
   不自动 ACK、取消或删除历史待办，不静默放弃用户工作。

## 验证方法

先运行新增失败测试，确认：绑定回调失败后进程仍存活；删除记录后没有拒绝；
私聊排队时来源频道移除未受阻。另单独确认零退出码会绕过结构化绑定失败。
实现后使用临时数据库、临时 Host 目录和 Fake CLI 验证：

- 直接和 supervised 进程在绑定失败后终止，错误为 sticky_terminal；零退出码也不能完成 Activation。
- 首次实例可新建；有绑定时恢复；删除绑定后拒绝启动，不向 Fake Codex 发送 thread/start。
- 重建适配器和 Store 后恢复同一原生 ID，改变配置 digest 不会新建 session。
- 两频道实例独立收发；私聊等待频道执行结束，不 steer 频道，不能跨目标发布私聊回复。
- 私聊待办阻止成员移除；空闲移除后拒绝旧私聊发新消息；模拟旧版本遗留队列无法领取。
- 重新打开数据库后仍保留必须续聊的判断。

## 保留边界

这是 fail-closed MVP，不是自动修复 session：prepared 后崩溃且尚无可恢复 ID 时也会阻断，
不会猜测一个新 session 等价于原上下文。自动 fork 接替、人工批准 box 重建、完整 epoch 绑定事务仍延期。
进程错误发生前已经提交的 Room 消息不回滚；停止与隔离不能冒称撤销已发生的模型调用。

Fake CLI 只能验证协议、调度和持久性，不能证明真实模型理解连续、压缩质量或 token 改善。
本批没有调用付费模型，也没有在正式频道发送测试任务。完整检查与正式重启结果在交付时追加。

## 交付检查与正式重启

- `npm run check` 退出 0：包级 1814 项（1797 通过、17 跳过），Web 482 项通过，其他合同门禁通过。
  全仓运行期间，另补到启动前连续性错误重新排队的问题；该最终补丁后重新运行了相关 58 项测试及全仓 typecheck，均通过。
- `npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。
- `scripts/test-role-mvp-browser.mjs` 退出 0：隔离 Fake CLI 的频道两轮、私聊两轮、刷新重开、Role 修订及桌面/390×844 页面通过；检查了生成的私聊截图。
- 正式实例通过 restartable 检查后，由既有重启脚本备份到
  `/Users/sun/.rah/backups/pre-restart-712e8c31-42c7-4971-99e7-38b7d2c2ff36`，平滑停止 PID 50246，继任 PID 58029。
- 冻结 Web 资产 `460ebf4da89840681b1e858cd75f0a1a9debc892776319dd4127c5b5932ecccb`；`/v3/client/health` 为 online，schema 保持 60。
- 真实 IAB 刷新正式工作台后显示原有 6 个 Agent；进入 Role 管理可读取原有 5 个频道与空 Role 目录。
- 重启前后逐行排序哈希一致：messages 238、agent_definitions 15、agent_definition_revisions 95、role_templates 0、role_instances 0。
  没有向正式频道发测试消息，没有运行付费 Provider，没有提交或推送代码。
