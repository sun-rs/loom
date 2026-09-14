# #all 固定成员规则（2026-09-13）

## 来源和范围

用户明确要求 #all 默认包含全部 Agent，不能添加或移除成员。Raft 发布前端冻结证据 `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`（来源 https://app.raft.build/ ，SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`）：`g4({hasManageChannelsCapability:e,isAllChannel:t=false,...n})` 返回 `!t && e && ...`，Ist/Nst 成员视图传入 `name===all && type===channel`，禁止 all 成员管理。`ey` 从成员 API 读取成员，不是客户端拼出成员。没有取得对应 Raft 后端事务源码，以下自动成员事务属于用户指定契约的 RAH 接线，不声称复制上游后端。Multica 的现有 runtime-picker 不承担此规则，不添加其依赖。

## 单一所有者

Kernel `all-channel-membership.ts` 从同 Workspace 的非 tombstoned AgentDefinition 派生成员，包括 disabled Agent。调用者持有原事务；每个新成员写 memberships 并追加 membership.added/既有 Outbox。服务主体使用已有 principal_system。普通频道保持手动成员规则。

调用点：创建 all、创建 AgentDefinition、完整 provisionWorkspaceAgent、Kernel 启动补齐。已存在成员不产生重复事件，不清理历史、游标或记忆。恢复缺失成员的幂等键带当前 Room 序号，避免历史成员记录挡住合法修复。禁止所有公开增删/角色修改入口和旧 addMember 绕过；全局 Agent 删除仍走原 tombstone/执行围栏，不通过频道移除入口。

前端 RoomMembersDialog 统一判断不可变 slug=all：设置页加号、成员页添加按钮与移除按钮均不渲染，回调同样受限；不以 disabled 假装不存在的添加能力。查询成员仍使用真实 canonical membership。

## 验证与边界

失败先行：已有 Agent 未自动加入；右侧仍出现添加按钮；缺失成员修复与已有事件幂等冲突。定向测试验证频道创建纳入已有 Agent、新 Agent 即时加入、持久状态补齐、重复 initialize 无重复事件、增删拒绝、停止保留成员和 tombstone 不复活。浏览器验证真实成员数量、无增删入口和刷新持久性。正式结果如下。

没有扩展多 Human 项目，没有运行付费 Provider，不根据执行退出推断成员身份。已有正式频道保持同一 Room ID。

## 正式交付

`npm run check` 退出 0：核心 1560 通过、17 跳过，Web 407 通过；定向 provision/all 生命周期回归再次通过。最后 typecheck、format:check、diff --check、正式 Web 构建通过。

空闲检查、备份 `~/.rah/backups/pre-restart-687e4432-35a3-438c-8dfa-f9fb39774ba7` 后平滑重启，冻结构建 `c9fc31746bbdc4adbc69d2ccbfd5094fc317ebdd0d2801a823e70427cb4c2031`。loopback/LAN/Tailnet 三个新浏览器均验证原 #all Room ID 中四个正式 Agent、无添加与移除按钮、刷新保留成员；检查桌面及390px截图。未在正式实例创建测试 Agent、停止 Agent 或删除成员。没有提交代码或运行付费 CLI。来源级对比不等于 Raft 在线双边验收。
