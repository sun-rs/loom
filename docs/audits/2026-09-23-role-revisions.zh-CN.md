# Role 修订纵向验收

日期：2026-09-23。范围：保存模板新版本 → 原实例保持配置 → 新实例使用新配置 → UI 区分版本。无付费 CLI 调用，无提交/推送。

## 设计与来源

遵循用户已确认的 [Role UI 合同](../design/role-instance-ui-contract.zh-CN.md) 和 [纵向 MVP](../design/role-instance-vertical-mvp.zh-CN.md)。Raft 的跨频道 Agent 与本次 Role 模板语义不同，不照搬其修改 Agent 即修改执行身份的行为。来源比较沿 [已核查发布源码](./2026-09-22-role-session-capabilities.zh-CN.md)；本地复用既有 AgentDefinition 快照、Room 事务/事件、Client SDK、runRoomMutationAtLatest、AgentCreateDialog 与 ProfileSection。没有复制新的上游代码或引入第三方算法。

Protocol 新增 role.revise；Kernel RoleCatalog 是唯一 owner，HTTP/SDK 只转交。schema 60 新增 role_revisions，回填 schema 59 的原模板；role_templates 保存当前版本。更新按 expectedRoleRevisionId 和控制 Room sequence 双重校验。idempotency key 重放返回原版本快照，不因后续修改漂移。

role.list 返回有效频道实例及 isCurrent；比较的是来源 revision ID，不按名称判断，不产生第二份持久状态。旧实例的 AgentDefinition、执行配置、会话、记忆保持原状。新实例使用模板最新配置。

UI 沿共享表单增加编辑初值和角色指令；可修改名称、描述、指令、运行时、模型、effort 和支持时的快速模式。编辑模板不修改现有实例的 CLI。配置缺少可用运行时/模型时仍沿既有禁用规则，不静默选默认值。Role 目录显示频道、实例标识和“当前版本 / 使用旧版本”；未重排大页。

## 验证与限制

- Kernel/SDK 集成红灯先证明缺少 revise 操作；绿灯覆盖版本更新、请求重放、旧版本冲突、陈旧 Room sequence、旧实例指令不变、新实例采用新指令及版本投影。
- schema 59 回填测试在删除回填实现后因旧 revision 缺失失败；恢复实现后通过，并验证旧 create receipt 不变。
- 浏览器先因没有“编辑 Role”按钮失败；完成实现后通过创建、两轮 Fake CLI 收发、编辑、刷新、旧实例不变、新实例版本与桌面/移动端截图。
- `npm run check` 通过：包测试 1790 通过、17 个 opt-in 跳过；Web 测试 481 通过。`npm run format:check`、`git diff --check`、`npm run build:web:workbench` 与最终 `npm run test:web:role-mvp` 均通过。
- [证据目录](../evidence/2026-09-23-role-revisions/)保留红灯、定向、完整检查、最终浏览器日志及桌面/移动端截图。

真实 CLI 语义连续性仍待验收。版本标识不是模型 context/token 状态，也不证明实例配置没有 override。未做旧实例热升级、模板归档、私聊、Side、fork、平台记忆或旧 Agent 迁移。

## 正式交付记录

重启前验证无阻塞活动执行，备份 `/Users/sun/.rah/backups/pre-restart-db16d036-daf0-40c8-8a5b-025b4a99c65d` 校验通过。旧 PID 97551 已退出，新 PID 10411 提供服务；schema 60，health HTTP 200，冻结 Web build `760510aa2351d31e085968025855c97220873faf3140e79d950023428752c849`。

新鲜正式浏览器显示原 6 个 Agent，Role 管理加载成功，创建表单中的角色指令可见；截图目视检查后取消，未写正式测试数据。正式 Role/revisions 仍为 0；messages、agent_definitions、agent_definition_revisions 与备份按完整排序行摘要比较一致。正式 Role 编辑交互的非空验收来自隔离 fixture，不冒称已有正式模板的在线验收。未提交或推送。
