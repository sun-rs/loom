# Role 实例跨配置续聊：后端修复

本批优先 AgentHost/daemon，不扩展前端或 fork。沿[原生会话能力证据](2026-09-22-role-session-capabilities.zh-CN.md)、[续聊保护](2026-09-23-role-session-continuity-guard.zh-CN.md)和用户已批准的每实例持续 session 语义实施。

## 根因和实现

此前查找键包含 runtime profile revision、workspace revision 和 standing prompt digest。即使是同一个实例，配置变化也会 miss，进而不传 resume 参数。驱动的“恢复失败禁止新建”管不到这一情形，因为根本没有尝试恢复。

唯一 owner 仍是 `ProviderSessionStore`。实例 load/record 使用 participant/provider 稳定键，四家驱动的启动环境和 evidence 保存均已接入；冻结 Placement/身份校验保留。旧 Agent 精确配置键不变。

已有实例旧记录进行一次确定性接入：必须只有一个原生 ID 且 provider 一致，不按最近时间猜；多个记录的 memory receipt 不一致则不沿用 receipt，让现有工具回退补足记忆。后续记录不同 ID 被拒绝，不能用新 evidence 悄悄覆盖既有绑定。现有 quarantine/reset 仍识别这些普通私有 session 记录，没有引入独立存储 owner。

这是 RAH 胶合实现，并非复制 Raft 源码。Raft 的每 Agent 跨 Room 延续会话是既有参考（固定包/源码位置见能力证据）；本地用用户批准的 instance 身份替代跨频道 Agent 身份，不引入 Multica 的第二套调度层。

## 验证

- 先添加存储回归并运行：配置变化得到 null、歧义历史未拒绝，两项按预期失败。
- 实现后，存储 8 项通过：重启恢复、不同配置同 session、拒绝替换/CLI 改变、拒绝歧义、参与者隔离、旧 Agent 兼容及既有私有文件/quarantine 行为。
- Codex Fake CLI 完整 runtime 测试通过：实例首次 thread/start；改变 prompt digest 后 thread/resume，未再 thread/start。其余旧恢复、取消、失败分类断言保留。
- 不调用付费模型；Fake CLI 不代表模型真的保持语义理解或正确执行模型切换。

## 未闭合边界

稳定记录本身被外部删除、首次启动在保存 ID 前中断，以及与 Kernel 的持久 binding/恢复接替事务尚未闭合。本批不保证这些场景自动恢复，也不将此修复报告为全部 session 生命周期完成。跨模型连续性只验证查找/调度不换 session，原生 CLI 实际切换模型与回复质量仍要单独验收。

## 完整检查与正式验收

`npm run check`、`npm run format:check`、`git diff --check`、`npm run build:web:workbench` 均退出 0。未提交或推送。

重启前通过既有空闲门禁，使用正式脚本验证备份 `/Users/sun/.rah/backups/pre-restart-434d86d9-9ab7-44c2-9e52-604d8aefc1fe` 后平滑停止原 PID 34256，新 PID 50246 持有 4173 端口，健康状态 online。Web 冻结资产为 `b958bd5f132667f431c5443e423ddecf3712bc6c295a9482b023220637f69456`。

实际 IAB 正式 URL 刷新后显示 6 个现有 Agent，再打开 Role 管理可读到频道列表与空目录。重启前后逐行排序哈希一致：messages 238、agent_definitions 15、agent_definition_revisions 95、role_templates 0、role_instances 0。备份保留原状态及记忆；没有在正式频道发送验收消息。正式尚无新 Role 实例，因此此页面/数据验收不代替新实例的真实模型续聊验收。
