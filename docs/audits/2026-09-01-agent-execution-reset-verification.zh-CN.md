# Agent execution restart / session reset 验收

日期：2026-09-01。

## 结论

本批关闭的是本机单Computer正式产品中的两项Agent执行管理能力：

- `restart`：终止或等待旧Activation取得terminal proof，保留Provider会话、Agent Memory、Room、Task和工作区文件，再恢复该Agent调度。
- `session`：执行同一终态/fence流程，并隔离该Agent的Provider continuity；保留Agent Memory、Room、Task和工作区文件。

`full`仍只显示Raft三档合同和破坏范围，按钮禁用。原因不是前端没做，而是当前没有能证明“哪些目录属于可删Agent工作区”、备份和恢复的安全合同。不能把本批称为Raft三档重置完全一致，也不能扩大为Agent页面或全站收口。

## 来源顺序与复用裁决

1. **Raft 1.0.18发布包**：采用三档mode、默认restart、卡片层级、中文标题/说明、pending文案和full破坏提示。冻结bundle `vendor/raft/index-WTraJnrd.js` 的SHA-256为 `fdba93dedef323ded9aba6f87cc211a25885230cbc0ade677b81b209bc881725`。
2. **Multica**：采用provider-native cancellation/interrupt、resume与fresh-session分离的成熟经验。审计基线commit为 `11861145abc59a0d39c8c8f24ad837d4584e664f`；RAH OS现有Codex/ACP/OpenCode/Claude adapter已覆盖其关键结构，不另建第二套CLI日志解析器。
3. **RAH OS最小glue**：只补Raft中央服务端源码无法直接复用的本机owner映射：AgentHost terminal proof、ADR-0024全局per-Agent fence、ProviderSessionStore、canonical `agent.manage`、HTTP/SDK和能力门控。Web不直接kill进程、不删文件、不解析provider日志。

详细映射见[施工合同](../product/2026-09-01-agent-execution-reset-contract.zh-CN.md)。

## 前后端闭环

请求使用稳定`agentDefinitionId`、Room sequence、浏览器生成的idempotency key和`restart|session` mode。daemon先用canonical `agent.manage`停止新调度；AgentHost取消/等待当前运行并取得终态证明；随后取得全局`execution_restart` fence。session在fence内隔离Provider continuity，restart保持它不变；Agent仍在同一fence内恢复enabled，receipt落盘后才释放fence。失败路径回滚Provider continuity并恢复enabled，幂等重放返回同一receipt，改变相同operation identity的输入会拒绝。

RAH OS是Activation驱动，不伪造一个常驻LLM进程。空闲Agent的restart仍执行canonical disable/enable和receipt；有运行的Agent才会走provider-native cancel/terminal proof。

## 自动化门禁

- TypeScript：通过。
- protocol、AgentHost coordinator、application-service、SDK、daemon administration/application专项：29项通过。
- 全仓测试：709项，707通过，2个需付费真实CLI的opt-in gate跳过，0失败。
- Web unit：123/123通过。
- parity regression：34/34通过。
- trusted `build:web:workbench`：通过。
- 隔离 `test:web:workbench`：真实Chrome、390×844、production build、Agent reply、Provider session resume与persistent restart全部通过。
- Prettier与`git diff --check`：通过。

没有使用付费CLI或GPT-5.6 Ultra。Provider cancellation与非空continuity隔离用隔离fake/owner测试验证，正式浏览器没有为了测试而启动付费模型。

## 正式实例与持久状态

重启前，正式数据库只有1个completed Activation、1个exited RunAttempt和1个terminated RuntimeProcess，没有活动运行。状态目录备份到：

`/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-restart-20260901-132228/state`

备份约378 MB，SQLite `quick_check`为`ok`。旧进程收到SIGTERM后退出；可信production bundle重新构建，正式工作台继续监听 `http://127.0.0.1:4173`，复用原状态目录和Workspace。

正式浏览器对空闲Claude Agent分别执行了restart与session：

- 两张owner-private receipt分别记录`restart`、`session`、同一Agent/Computer、完成时间与不可变operationId。
- control Room sequence 35–38依次记录两组`agent.disabled`→`agent.enabled`，Agent最终为enabled。
- 该Agent当时没有Provider continuity记录，所以正式session证明的是请求、fence、canonical状态与receipt闭环；非空continuity的隔离、回滚与幂等由AgentHost专项测试覆盖。
- Agent Memory与重启前备份逐文件一致；现有Provider session文件数仍为1。

## 真实浏览器行为

桌面1920×1080：

- 资料页按钮由health capability门控，正式重启后可用。
- 弹窗标题为“重新启动 {Agent}”，restart默认选中；session可选择；full可见但disabled并解释本机安全限制。
- Escape关闭后焦点回到“重启 / 重置”触发按钮。
- 两次确认成功后弹窗关闭，按钮恢复可用；数据库/receipt复核与界面结果一致。

390×844：

- 弹窗rect为left 0、right 390、width 390、height 784；`body.scrollWidth=390`，无横向溢出。
- 三档、取消、确认与关闭在首屏内可达，full保持disabled。
- 取消后恢复浏览器默认viewport，正式Agent资料页留给用户继续审查。

## 未完成和风险

1. `full`删除必须先有准确Workspace归属、预览损失清单、备份、恢复和禁止删除用户项目cwd的合同。
2. 进程恰好在Provider continuity已隔离、receipt尚未落盘的崩溃中点，目前会fail closed并要求运维处理；尚未实现自动恢复quarantine transaction。
3. 全局fence当前按短操作租期设计，尚无超长重置续租证据；本批只处理小型本地continuity store。
4. 正式浏览器使用的是空闲Agent；运行中provider-native cancel由专项测试覆盖，未为验收发起付费Run。
5. Raft官方仅验证了前端可见三档合同与取消行为；官方中央服务端内部实现不可见，因此本地证明的是结果与安全不变量，不是后台逐行同构。

据此可以宣称：**本机正式版的Agent restart与session reset已形成可用、可审计的前后端闭环。** 不可以宣称full reset、Agent全部标签、提醒/应用、Artifact或全站与Raft完全一致。
