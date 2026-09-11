# Agent 私有默认 cwd：源码对照与最小实施方案

状态：历史施工前设计；本地 slice 已获批准并实施，当前结果见[实施记录](./2026-09-11-agent-private-cwd-implementation.zh-CN.md)。以下源码缺口描述是施工前基线，不代表当前完成度。

## 结论与证据边界

应对齐 Raft 的 **新 Agent 默认私有工作目录**。不能把默认共享全局 cwd 称为 Raft 等价，也不能用全局 exclusive 代替私有目录。私有 cwd 防止默认相对路径互相覆盖，不是 OS 沙箱，不能保证拥有同一用户权限的 CLI 无法读取其他目录。

本地基线为 HEAD `ac0f48636b2d45815d373d1cca4df64ef8bef099` 加 2026-09-11 当前在途工作树。行号是本次读取定位，施工前须按符号复核；不以 HEAD 代表未提交实现。主任务正在修改投递与 prompt，本文不负责该域。

Raft 参考：Computer 1.0.18，发布物提取文件 `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。这是已有授权发布物的只读参考；不复制整包入生产。以下是可核实的本地 Computer 行为，不推断未知中央服务端权限或最新线上全部情况。

| Raft exact 位置       | 源码事实                                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| main.js:765082        | `agentDataDir = path.join(this.dataDir, agentId)`；按 Agent ID 决定目录。                                                                                               |
| main.js:765083 起     | `withLocalRuntimeContext` 后调用 `initializeAgentWorkspace(agentDataDir, buildInitialMemoryMd(...), ..., config3.envVars)`，工作区准备发生在启动前。                    |
| main.js:765146        | 版本启动检查收到 `workingDirectory: agentDataDir`。                                                                                                                     |
| main.js:765316–765337 | 构造 `runtimeContext`，其中 `workingDirectory: agentDataDir`，交给 `driver.createSession` 或 `createChildProcessRuntimeSession`。这是实际 driver 输入，不只是展示路径。 |

Multica 二次核对：现有 `server/pkg/agent/codex.go:1825,1883` 向 Codex thread 请求传入 `opts.Cwd`，可支持“所选 cwd 必须到达实际 provider 请求”的验证方法；本次不据此推断 Multica 的默认目录策略。既有复用登记固定的 Multica revision 见 `2026-08-29-raft-multica-reuse-ledger.zh-CN.md`；本文没有将当前 checkout 冒充该冻结 revision。选 Raft 的 Agent 默认目录语义，具体接线是 RAH glue，不声称逐字移植。

## 本地完整链：创建并没有选择 Agent cwd

1. Web `apps/web/src/App.tsx:2636` 的 `createAgent` → `client.request("agent.provision", ...)`（2654）。
2. `packages/protocol/src/index.ts:752` 的 `ClientAgentProvisionRequestSchema` 包含身份、runtimeOfferId、modelIntent 等，没有 cwd。`AgentDefinitionRevisionSchema`（`agent-definition.ts:47`）同样没有 cwd/binding。
3. `packages/application-service/src/client-application-service.ts:1133` 的 `/agents/provision` → Human facade `provisionWorkspaceAgent`。
4. `packages/kernel/src/room-kernel.ts:3158` → `provisionWorkspaceAgentTransaction`；`workspace-agent-provisioning.ts:57` 持久化身份/定义/策略与事件。约 185 行构造策略，只要求 `workspaceMode: "in_place"`。现有 configure 路径 `workspace-agent-management.ts:296` 更新配置，不提供 per-Agent cwd。
5. `packages/daemon/src/local-workbench-bootstrap.ts:83–99` 接收并固定全局 workspaceCwd，已有 metadata 与传入值不同会拒绝；`buildConfig` 约 411 行将它写入 v4 `workspace.cwd` 和全局 mount identity。首次 bootstrap 直接 `createAgentDefinition`（226），是必须同时覆盖的另一个创建入口。
6. `packages/daemon/src/daemon-application.ts:413` 发布全局 mount descriptor；`packages/kernel/src/placement-planner.ts:543` 按 Workspace ID、mode、busy 状态从 Offer descriptor 中挑选 mount。`room-kernel.ts:3362` 附近持久化计划，`claimNextPlacement`（3505）认领。**当前 planner 不按 Agent 选择私有 mount。**
7. `packages/agent-host/src/agent-host.ts:379–387` 认领 Placement 后调用 `placementRuntimeResolver(claim.placement)`。
8. `daemon-application.ts:480` 的 `createRuntimeForPlacement` 绑定实际 model/offer，但约 522 行仍把 `v4Config.workspace.cwd` 传给 `createConfiguredRuntime`。
9. `packages/daemon/src/runtime-profile-composition.ts:35` 的 `createConfiguredRuntime` 将同一 cwd 用于 standing prompt（67）、memory preparation 的 executionCwd（83/92）、Worker 凭据 workspaceRoot（102）和 adapter options（142）。**修 cwd 必须同步这些消费者，不能只改 spawn。**
10. `packages/agent-host/src/generic-process-adapter.ts:640` 保存 `#cwd`；直接 spawn（758）、supervisor config（1052）和 supervisor spawn（1069）使用它；`process-supervisor.mjs:279–280` 再以 config.cwd 启动子进程。Codex driver（26/130）、Claude driver（153）继承 `process.cwd()`，因此目录最终到达 provider。

另一条正式服务接线不可漏：`node-k-carrier-computer-service-entry.ts:358` 发布 workspace descriptor，`remote-runtime-profile-composition.ts:137/291` 使用 profile.cwd，148/325 的 recovery 明确要求 shared cwd。这里虽名为 remote，也是 Computer 接线，不能只修本地 daemon 后宣称所有部署已完成。无需开发远程计算机产品，但新 binding 不能静默在这条路径退回全局目录。

## 最小方案：新建显式标记，旧记录保持旧语义

以下是拟议字段/模块名，尚未实现。单一所有权：Kernel 保存 Agent 执行目录意图及 Placement 引用；AgentHost 负责 Host 本地路径解析、准备与验证。Web 不拼路径，adapter 不自行另选 cwd。

### 1. 区分三种来源，不靠时间或目录内容猜测

- **已有记录无新字段**：解释为 `legacy_inherit`，继续使用现有全局 workspace.cwd。绝不把 optional 字段的 schema default 设为 private，否则读旧数据就是隐式迁移。
- **升级后新建默认 Agent**：provision 与 fresh bootstrap 显式写入 `executionWorkspace: { kind: "agent_private" }` 到 Agent 定义 revision。身份和意图在同一现有事务内创建，幂等重放仍返回同一 Agent，不再创建第二目录身份。
- **显式项目路径**：现有全局 cwd 配置无论当初是否默认，都按既有选择保留。本次没有证据证明已存在 per-Agent 路径 UI，不能伪称能从旧行区分“默认”与“用户显式”。如需新 Agent 继续指向现有项目，提供明确的 existing-mount 选择，引用已认证 Host mount ID，不接受 Agent 工具任意绝对路径。新建“任意项目路径编辑器”不是本次前提。

configure、runtime/model/effort 切换保留该字段；历史 Agent configure 不趁机迁移。只对首次新建落下 private 意图。现有有意共享项目的 Agent 继续共享；本补丁不消除那种显式共享风险。

### 2. 执行目录必须进入现有 mount/Placement 链

建议 Host 根目录使用独立的 `stateDirectory/agent-workspaces/<opaque participant ID>`，与已有 `supervisors/agent-memory` 分离。稳定身份取 participantId，不取 handle、Room ID、runtime 或模型。目录名采用安全不透明编码，禁止未经验证的字符串直接拼接。

复用现有 mount descriptors/revision/digest，不另建执行队列。Host 为私有 Agent 物化并发布相应 descriptor；descriptor 增加可选 participant 归属约束，planner 对 private 意图只选择该 Agent 的 descriptor，对 legacy 仍选择原共享 descriptor。当前 planner 对同 Workspace 的 descriptors 仅按 revision 排序，所以 **只新增 descriptors、不增加归属过滤，会让 Agent 选中别人的目录**，不能这样实施。

Host 本地 resolver 由冻结 mount revision 查实际 cwd，校验 participant/Host/digest 一致后传入 `createConfiguredRuntime`；不得忽略 Placement、每次临时重算一个不同 cwd。沿用现有 mount 身份和 Provider session key：`provider-session-store.ts:31/506` 已将 workspaceMountRevisionId 纳入恢复身份，目录变化不能复用旧 mount 的 session。

Host 在新 Agent 创建事件/启动恢复后枚举 private 意图，幂等准备目录并刷新 Offer；目录未准备或 Offer 尚未发布时保持不可调度，不能回落 global cwd。复用已有控制事件/刷新机制，不要求模型创建目录。目录准备拒绝 symlink/越界/非目录；失败不得启动 CLI。

这一步涉及 descriptor 更新与 planner，不是“一行 cwd 默认值”。如主任务需要缩小批次，可先完成 binding 与默认仍 legacy 的兼容接线，再以新建 private 的失败测试开启；不能先上线无法执行的新意图。

### 3. 历史、记忆、恢复

- 不移动、复制、删除任何既有 Agent 工作目录或文件；不重写已有 Agent revision、mount revision、Provider session、RunAttempt。
- `agent-memory-workspace.ts:123` 按 rootDirectory + participantId 定位记忆。root 与 participant 不变；MEMORY.md/notes 不移动、不重新播种。Raft 的目录共置不必在本次照搬：RAH 已有独立 memory owner，这是明确本地适配。
- Prompt 路径、Worker 附件 root、workspace 指令发现均使用同一解析 cwd；私有记忆环境仍由原 owner 提供。与主任务 prompt 编辑交接时只传解析路径，不改投递段落。
- 已运行 Attempt 保持冻结目录。重启恢复按原 descriptor 核对，不能把恢复进程指向新默认。旧 v2/v3 和缺字段 v4 继续原行为。
- full reset/文件浏览/交付证据也必须消费所选 mount，不能因 global cwd 残留而浏览或清理另一目录。未打通这些消费者前，不得宣布 private workspace 收口。
- 这是向前兼容功能，不把关闭新建 private 开关当成新 Agent 降级到 legacy 的理由。回滚时已创建 private binding 仍须可读可执行；旧二进制不支持新 schema 则明确阻止降级。

## 施工文件与先失败测试

| 层           | 预计改动位置                                                                                                                                     | 必须先失败的外部不变量                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 定义/创建    | protocol `agent-definition.ts`、`index.ts`；kernel `workspace-agent-provisioning.ts`、`workspace-agent-management.ts`、相关 types；bootstrap     | 新建标记 private；旧 JSON 不被默认改写；configure/幂等重放保留 binding。                                               |
| 路径与发布   | agent-host 新小型 workspace resolver/materializer；daemon Offer 发布接线                                                                         | 两个 Agent cwd 不同且重启稳定；恶意路径/symlink 拒绝；准备失败不 spawn；Agent 创建后无需重启 daemon 即可发布新 mount。 |
| 调度         | protocol mount descriptor、kernel `placement-planner.ts`、Placement 验证                                                                         | 同 Workspace 多 private descriptors 只能选本人；旧 shared/exclusive 行为不变；伪造 participant/mount 拒绝。            |
| 启动与消费者 | daemon `daemon-application.ts`、`runtime-profile-composition.ts`、文件/证据支持；Computer `remote-runtime-profile-composition.ts`、service entry | fake provider 真正写同名相对文件，各自内容不覆盖；prompt/Worker root/浏览/证据与实际 cwd 一致。                        |
| 恢复与记忆   | 复用 provider-session-store、现有 memory coordinator；只补必要接线                                                                               | Room/DM、runtime/model 切换 cwd 和 memory 不变；已有 Agent 目录/内存文件逐字不变；重启恢复旧 session 不换 cwd。        |
| 文档         | config 与 workspace-lease 错误 Raft 等价注释、相关 owner 文档                                                                                    | 删除“Raft 无隔离所以共享 checkout 等价”的不实依据，不改全局 sharing 默认。                                             |

优先在现有 `workspace-management` / `agent-avatar-provisioning`、`placement-planner` / `durable-placement`、daemon composition/bootstrap、provider session/memory 测试中增加行为断言；目录准备器用临时目录，运行端用 fake CLI。不要只测字符串 path 是否不同，必须检查子进程相对写入、重启后的路径身份和旧数据不变。

实施后按仓库要求运行 check/format/diff；浏览器确认新建 Agent 与 Workspace 页结果，真实 CLI/双边验证单独声明。本文仅设计，未运行这些测试、不宣称修复完成。正式服务重启、付费测试、commit/push 由主任务另行协调。
