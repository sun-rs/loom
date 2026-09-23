# Role/Session 第一批技术验证

日期：2026-09-22。范围：现行代码特征实验、既有假运行器回归、固定上游源码。未调用真实模型，未创建或修改真实 CLI session，未改正式产品代码或重启服务。

## 执行结果

48 项既有确定性测试通过，0 失败。前一组 35 项为 provider-session-store、runtime-implementation-registry、runtime-busy-input、runtime-delivery-mode、codex-busy-boundary、claude-busy-input；后一组 13 项为 runtime-tool-access、worker-restart-busy-integration、runtime-busy-notices。前组输出在本任务工具记录中，后组保存为 [existing-gates.txt](../evidence/2026-09-22-role-session-validation/existing-gates.txt)。这验证现行行为，不等于新设计验收。

新增可重复运行的 [probe.mjs](../evidence/2026-09-22-role-session-validation/probe.mjs) 只使用临时合成数据；[结果](../evidence/2026-09-22-role-session-validation/probe-result.json) 如下。脚本断言的是观察到的现行边界，不将缺口包装成新功能通过。

| 验证                                | 结果                                             | 不能推导的结论                                                                 |
| ----------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| SessionStore 重新打开相同 key       | 原 native ID 保留                                | 未证明 CLI 真正保留模型上下文                                                  |
| 只换 runtimeProfileRevisionId       | 查找返回 null                                    | 未证明每次 UI model/effort 修改都会改变此版本；那条端到端路径还要测            |
| 不同 participantId                  | 隔离存储，不覆盖原 ID                            | 尚未实现 Role→多频道实例模型                                                   |
| 四家当前 Runtime read_only 请求     | 均被标准 full_access 政策拒绝                    | 不能推导原生 CLI 不支持沙箱                                                    |
| 同 UID 子进程访问 chmod 0400 记忆   | 可 chmod 回 0600 并写入                          | 这是 chmod-only 反例，不是绕过某个已实现 Side 沙箱                             |
| macOS sandbox-exec 限制临时记忆目录 | 可读；直接写、chmod、通过符号链接写/改权限均拒绝 | 只验证 Node 子进程，未覆盖真实 CLI、原生后台自动记忆、网络代理或预存文件描述符 |

复现：在仓库根目录执行 `node docs/evidence/2026-09-22-role-session-validation/probe.mjs`。临时状态在 finally 中删除，不读取用户记忆。

## 四家 fork 的新证据

固定上游 checkout 位于 `/Users/sun/Code/reviews/rah_os/2026-09-11-runtime-capabilities/upstream/`。版本基线沿 [能力表](2026-09-22-role-session-capabilities.zh-CN.md)，逐文件摘要见 [source-manifest.json](../evidence/2026-09-22-role-session-validation/source-manifest.json)。只读研究，未复制上游实现进入产品，未运行上游测试。

### Kimi：存在原生 fork，而且存在 Side 相近功能

- `packages/node-sdk/src/sdk-rpc-client-v2.ts:1335`：forkSession 经 session 队列调用 ISessionManager.fork，可指定 target ID、metadata、turnIndex。
- `packages/agent-core-v2/src/workspace/sessionLifecycle/sessionLifecycleService.ts:465`：源 session 存在性/工作区检查；任何已加载 agent 的 turn 仍活动时拒绝 fork。不能承诺它与 Codex 一样在主任务运行中随时复制。
- 同目录 `internal/forkTurnSlice.ts:24`：按用户可见轮次截取，包含所选轮，越界错误；还处理 steer 输入与子 agent 时间截止，不能自行用文本行数近似。
- SDK `:2034` 的 startBtw 走 ISessionBtwService，说明继承 profile/context、工具调用禁止；同时明确 v2 子 agent 是持久化记录，与旧版内存临时 child 不同。因此不能把 btw 直接包装成“关闭后无持久记录”的 Side。

当前 RAH 使用 ACP，这些能力需要接入其本地服务/原生 SDK 控制面并补生命周期验证；不是已有 RAH 功能。

### OpenCode：存在 fork，但截止点语义不同

- `packages/opencode/src/server/routes/instance/httpapi/groups/session.ts:90,248` 暴露 session fork 路由；handler `:211` 调用 session.fork。
- `packages/opencode/src/session/session.ts:691`：创建新 session、复制 metadata，按消息顺序复制并重新映射消息/part ID 和 assistant parentID；涉及 compaction tail 引用。
- `messageID` 表示不包含该消息的前缀；找不到该 ID 时，此函数回退复制全部消息。`test/session/session.test.ts:241` 的测试明确期望截止消息之前的序列。
- 本段函数没有展示 active-turn 拒绝/原子快照合同，不能声称运行中安全 fork 已验证。RAH 应先停止对源绑定的新派发，确认安全截止点，并核对分叉结果。找不到截止点必须由 RAH 报错，不能接受上游“复制全部”的回退。

### Codex / Claude

沿上一批官方依据：Codex thread/fork 可指定已完成 turn 和 ephemeral；Claude resume + fork-session 创建新 ID。尚未对本机安装版本做真实 fork、上下文连续性及工具凭据继承的联合实验。这次的新结论是四家都有持久 fork 的源码/文档依据，不是四家都已接通。

## 私聊排队：仍有一个必须施工的读取边界

当前 `packages/kernel/src/worker-task-scope.ts:131` 的 requireWorkerRoomVisibility 按成员资格、enabled 和 system_hidden 检查，并不以本轮调度目标决定可读范围。现行跨 Room 读取是既有能力；不能直接复用它来保证“已加入但尚未调度的私有 box 不可提前读”。

当前重启测试通过证明一个 Agent 跨 Room 不会产生第二 lane、待交付不会丢失，但没有覆盖新私聊 box 的 target 权限。后续必须为私聊读权限加入本次执行目标约束，同时保留普通公共历史访问；不能为了私聊把所有跨 Room 历史查询一起破坏。

## 下一阶段裁决

设计可继续推进；实施前优先完成 RuntimeBinding 身份合同、Side 权限执行合同和私聊目标授权合同。不能直接套现行 Agent ID/profile key 就开始迁移。具体变更与工作分包见 [v0.2 增补](../design/role-instance-session-v0.2.zh-CN.md)。
