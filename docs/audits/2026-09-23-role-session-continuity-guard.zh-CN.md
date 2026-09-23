# Role 实例续聊保护：第二个纵向批次

## 目标与设计

继续第一条 Role → 频道实例 → box 回复路径。发现四家旧驱动都包含恢复失败后创建新会话的分支；这会把新实例的上下文丢失伪装成正常续聊。本批只禁止这类静默替换，不建设 fork、Side 或恢复状态机。

单一 owner：Kernel 的 role_instances 确定实例来源，并通过 AgentRuntimeContext.instanceChannelId 传给 Host；本机 daemon 的 standingPromptLease 下发 RAH_REQUIRE_SESSION_CONTINUITY。驱动共享 assertSessionReplacementAllowed 检查。失败保留既有 provider store 记录，沿 RuntimeFailure 的 sticky_terminal 分支停止自动重试。错误显示“原生会话无法继续，已停止；未创建替代会话”。

新实例首次未绑定时仍可创建原生会话；成功后按现有 participant/runtime/prompt/workspace key 恢复。旧 Agent 不启用新策略。没有 schema 升级、历史转换或记忆修改。

## 上游对照与有意差异

沿用 [能力核查](./2026-09-22-role-session-capabilities.zh-CN.md) 的 Raft Computer 1.0.32 官方发布包、SHA256 与来源信息。本次重新读取 slices/packages/daemon/dist/chunk-TEGPBMW7.js:25748–25769：Codex thread/resume 收到可恢复错误时调用 thread/start，并在初始消息附恢复说明。RAH 旧实现也保留这种行为。

新 Role 产品要求一个实例延续同一 native session，因此这里有意不复制自动新建。Multica 的既有 Kimi ACP 结构移植仍保留，当前变更只是 RAH 本地恢复策略；没有复制新的上游代码或改变许可证。源代码与声明范围参见 [既有生命周期核查](./2026-09-17-provider-session-lifecycle-parity.zh-CN.md)。

## 验证

- 四家 fake native 协议测试先复现：恢复失败后仍成功退出并创建新 session。修复后断言失败、sticky_terminal，且没有新建请求/第二个 Claude 子进程；旧正常恢复与兼容降级断言继续通过。
- Kernel 测试验证两个频道实例的启动上下文保留各自来源；去掉投影时断言失败。daemon 测试验证仅新实例启用严格策略。
- 现有 ProviderSessionStore 持久读写/隔离测试继续覆盖磁盘重新加载；不将它称作真实 CLI 或完整进程重启后的语义验收。
- 定向原生协议 + Kernel 测试 7 项通过；存储/分类/daemon/Kernel 定向 17 项通过。`npm run check` 通过（包测试 1789 通过、17 个 opt-in 跳过；Web 481 通过），`npm run format:check`、`git diff --check` 通过。
- `npm run test:web:role-mvp` 通过：隔离 UI 创建 Role、频道实例、两轮 Fake CLI 回复、刷新、桌面/移动端；已检查两轮截图。没有修改 Web 代码，正式重启复用上一批已验证的冻结 bundle。
- [证据目录](../evidence/2026-09-23-role-session-continuity/)保留红灯、定向、完整检查、浏览器与备份重启记录。

## 正式交付

重启前确认没有阻塞的活动执行，备份通过校验。旧进程 87647 已退出，新进程 97551 提供服务，health HTTP 200；新鲜真实浏览器加载成员页（原 6 个 Agent）并进入 Role 管理成功，页面截图已目视检查。正式 Role 仍为空，没有建立测试成员或付费调用。使用冻结 Web build `f0a69018b35329dbcbc56bc8d5c5146e14c7b22bcb81e46a1ca0b7b363c57599`；无数据库迁移、无提交/推送。

备份路径 `/Users/sun/.rah/backups/pre-restart-20017987-beae-4a58-b051-0f23bfc431f1`。首次重启命令的 build 参数输入错误被 guard 在停止前拒绝，修正为读取到的真实 build ID 后完成重启。

## 明确未完成

这不是“所有情况下永不丢失上下文”的承诺。Host 记录被外部删除、配置 key 改变、首次 turn 未留下可恢复凭据，以及 native API 成功却返回其他 ID 的统一严格校验，仍是后续 session 绑定工作的边界。远程 Computer 不在本机 MVP 验收范围。没有付费 CLI 运行，没有当前 Raft 双边实测，没有自动 fork 或从 box 重建；下一步优先做一条真实 CLI 的两轮连续性验收，再推进下一条用户可用路径。
