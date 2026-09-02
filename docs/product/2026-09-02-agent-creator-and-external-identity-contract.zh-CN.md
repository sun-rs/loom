# Agent 创建者、已创建 Agent 与外部 Agent 合同

状态：P4.2a `C/A/L/D` 完成；P4.2b 设计闸未解锁

日期：2026-09-02

## 1. 为什么必须拆成两个问题

Raft 的 Agent 资料页把两类信息放在相邻位置，但它们不是同一个后端能力：

1. `creator + createdAgents` 是持久身份关系的只读投影；
2. External Agent 是一种由外部进程持有身份凭据、通过 CLI 拉取并提交业务命令的运行方式。

RAH OS 不能把本机已安装的 Codex / Claude / Kimi / OpenCode CLI 标记成“外部 Agent”来冒充完成第二项。当前这些 CLI 仍由 AgentHost 选择、启动、监督和回收，属于 managed runtime。External Agent 的区别不是 Provider 名称，而是**谁拥有并启动运行进程**。

## 2. Raft 冻结源码和官网合同

### 2.1 冻结发布物

| 文件                                                                   | SHA-256                                                            | 已证明的合同                                                                                                                                                                                                          |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/evidence/raft-web-20260831-current/AgentDetailPanel-DKwoNvgK.js` | `b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845` | Agent 资料页始终读取 `createdAgents`；非空时用统一成员行显示头像、名称、runtime 和动态点，点击打开该 Agent；空时显示“暂无已创建的 Agent”                                                                              |
| `docs/evidence/raft-web-20260831-current/HumanDetailPanel-DvWNsDz9.js` | `83c31367e48dc1ff6fb75c763ae78fafe16070d53e7d4d58ba16303f7c49bceb` | Human 资料页在操作区之前显示同一 created Agents 列表                                                                                                                                                                  |
| `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`            | `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a` | member detail 的 creator union、created-agent summary schema；创建 External Agent 时提交 `external` 与 `externalPurpose`；用途只有 `interactive` 和 `notification_sender`；外部状态读取 `/agents/:id/external-status` |

发布物还证明：

- `interactive` 可以读上下文并按正常 freshness 参与对话；
- `notification_sender` 只能发送通知，不能读上下文，也不使用 freshness draft；
- external 创建流程不选择 Computer/runtime；
- External Setup 只在满足创建者/管理员条件时出现；managed Agent 的 start/restart 控件不能直接套在 external Agent 上。

这些是前端产品合同，不证明未公开的 Raft Server 凭据事务实现。

### 2.2 官方文档

[Raft External Agents](https://docs.raft.build/features/agents/external/) 进一步明确：

- External Agent 由用户自行运行，通过 `raft agent login` 的 device authorization 取得 Agent 身份；
- setup 状态是 `waiting for login -> credential minted -> connected`；
- 登录后的权限仍受成员关系约束；
- wake bridge 只接收不含消息正文的提示，Agent 再用 CLI 拉取消息；
- 创建者和 Server 管理员才能看 External Setup；凭据需要可撤销；
- once connected 的业务能力与 managed Agent 一致，但 activity 精确性仍是已知限制。

## 3. Multica 对照与采用裁决

对照版本：`/Users/sun/Code/repos/multica` commit `11861145abc59a0d39c8c8f24ad837d4584e664f`。

Multica 的 `packages/core/types/agent.ts`、`server/internal/handler/agent_access.go` 提供了较完整的 Agent owner、`private/public_to`、workspace/member target 和 A2A 顶层 Human originator 权限模型；`agent_builder.go` 还实现了 creator-scoped 的隐藏创建会话。

本批不移植这些代码，原因是：

1. Multica 的 owner 表示“谁可以 invoke/管理此 Agent”，Raft 的 creator/createdAgents 表示身份来源，语义不能合并；
2. RAH OS 已有 Room membership、Activation-scoped Worker credential、Host credential 和 Human control-room manager 权限；直接引入 `public_to` 会制造第二套调用授权真相；
3. Multica 没有与 Raft `raft agent login + external-status + content-free bridge` 等价的 External Agent 接入实现。

可保留的监督经验只有：view 和 invoke 必须分权、未知权限 fail closed、A2A 不得借 immediate Agent 绕过顶层 Human authority。这些原则不作为 P4.2a 新功能引入。

## 4. 当前 RAH OS 反例

当前 `AgentDefinitionRevision.createdBy` 表示**该 revision 的写入者**。资料编辑会生成新 revision，因此把 `currentRevision.createdBy` 显示为“创建者”会在管理员修改名称/头像后错误改变创建者。

另外：

- `ClientAgentGetResponse` 没有 canonical creator 和 created Agents 投影；
- Agent 资料页硬编码“暂不支持查看 Agent 创建的成员”；
- 当前所有正式 Agent provisioning 都要求 Human control-room manager，Agent 没有创建 Agent 的 typed authority；
- AgentHost 的外部 Worker 进程和 activation-scoped credential 是受 RAH 调度的执行实现，不是用户持有的 durable External Agent identity；
- 没有 device authorization、external credential lifecycle、revoke、external-status 或 bridge profile。

## 5. P4.2a：安全读取投影（本批施工）

### 5.1 唯一 owner

```text
protocol ClientAgentGetResponse
  -> Kernel workspace-agent-management read model
  -> existing agent.get application service / SDK
  -> Agent profile created-agent section
```

Kernel 必须从 revision 1（或等价不可变创建事实）解析 creator，而不是从 current revision 读取。`createdAgents` 只返回同一 Workspace/control Room 下、revision 1 `created_by` 指向当前 Agent participant、且未 tombstone 的 Agent。客户端不得从全目录自行猜关系。

本批 schema 采用本地 typed mapping：

- `creator`: `human | agent` identity summary，可为空以兼容缺失/已清理的历史来源；
- `createdAgents`: 复用 canonical `AgentCatalogEntry`，保留稳定 AgentDefinition/participant/revision/state，不创造第二套 Agent DTO。

UI 结构化移植 Raft 的 section/count/empty/row/click 行为，复用官方头像、现有动态点和现有 Agent 路由。created Agent row 点击后打开同一右侧 Agent 资料页；不发起聊天、不创建 Task。

### 5.2 失败优先门禁

1. protocol strict schema：接受 creator/createdAgents，拒绝多余字段和 service creator；
2. Kernel：资料编辑后 creator 不变；Agent-created 历史关系可投影；tombstoned child 不返回；无管理权限者不得借关系读取目录；重启后不变；
3. Web：空态、计数、行点击与 Agent 切换；created row 不复用聊天 @ 点击；
4. desktop 与 390×844：section 可见、无横向溢出、点击切换、刷新保留；正式 4173 只做非破坏读取。

### 5.3 明示限制

本批不开放 Agent 创建 Agent。当前列表在正常生产数据中可以为空；若未来引入 Agent-created authority，它必须是独立 typed command、受 Room/Workspace policy 和 quota/fence 约束，不能仅因 Worker credential 能发消息就获得 provisioning 权限。

Human detail 的 created Agents 需要一个正式 Human profile surface/typed read model；当前 RAH OS 成员页不是 Raft Server member profile 的完整等价物。本批先关闭现有 Agent 资料页的错误信息，Human surface 作为 P4.2a 后续项保留。

## 6. P4.2b：External Agent 设计闸（本批不写产品代码）

必须先具备下列 canonical 对象，才允许出现“创建 External Agent”入口：

1. `ExternalAgentConnection`：AgentDefinition、purpose、状态、credential generation、created/revoked/connected timestamps；
2. 一次性 device authorization：短期 code、Human 审批、精确 Agent/Workspace 绑定、重放拒绝、过期；
3. durable external credential：只保存 hash，可轮换/撤销，不等于 Human PAT、Host credential 或 activation-scoped Worker token；
4. external application surface：ACL/freshness/idempotency 与 canonical Room/Task/Reminder/File/Search 共用现有 owner；`notification_sender` 在服务端拒绝 read/sync/search/task claim；
5. content-free wake：可丢可重，pull 才是真相；不把 WebSocket/bridge 当收件确认；
6. status owner：waiting/minted/connected 来自 credential 和最近认证活动，不从 PATH/聊天文本/进程输出推断；
7. revoke/delete/recovery：撤销后所有旧 generation 立即 fail closed；重启不丢状态；
8. UI：External Setup 仅 creator/管理者可见，具备复制、状态、错误、revoke、Escape/focus/stale response 合同。

当前取得的 Raft 发布物和官网文档不足以证明 Server 端 device-login 事务；Multica 也没有等价实现。因此 P4.2b 维持设计闸，不用自制 token flow 冒充“优先复制 Raft”。若后续取得 Raft CLI/Server 授权源码，再以 byte-exact/structural port 重新评估。

## 7. 回滚与证据口径

P4.2a 只增加 read projection 和 UI，不做 schema migration、不改 Agent provisioning authority；回滚不会删除数据。旧客户端忽略新增 response 字段，新客户端对缺失字段需 fail closed 或显示真实空态，不能用 current revision author 回退成 creator。

证据等级分别记录：`C` 接线、`A` 自动化、`L` 本地浏览器、`R` Raft 同前置、`D` 正式 4173。冻结 bundle 可证明结构/交互，但不把它写成 Raft Server 双边事务通过。

## 8. P4.2a 施工与验收记录（2026-09-02）

- protocol 已在 `ClientAgentGetResponse` 中加入 strict `creator: human | agent | null` 与 canonical `createdAgents`；没有引入与 `AgentCatalogEntry` 竞争的第二份 DTO。
- Kernel 只从 revision 1 读取不可变 creator，并仅投影同 control Room、revision 1 `created_by` 指向当前 Agent、未 tombstone 的子 Agent。资料编辑不再把“最后修改者”错当“创建者”；无 manager ACL 者不能通过关系读取目录。
- Web 已结构化移植 Raft 的创建者身份行、“已创建的 Agent”计数/空态/列表行/点击切换，复用现有 Agent 路由、官方头像与动态点。client directory 短暂落后时保留 canonical response fallback，不把空目录误解为关系消失。
- 失败优先证据：protocol 测试先失败于缺少导出，Kernel 测试先失败于缺少 creator/createdAgents，Web 测试先失败于缺少 projector；移动深链红测又证明 profile URL 虽保留但重载后错误回成员列表。最小实现后 Agent route 定向 `7/7` 通过。
- 全量门禁：`npm run check` 的 package 测试 `782` 项（`780` 通过、`2` 个 opt-in 真实 Provider 用例跳过），Web `171/171`，真实回调回归 `34/34`；format、diff check、trusted workbench build 与 dependency audit（`0` 漏洞）通过。移动导航 refinement 后 Web typecheck、定向 route 测试、Chrome 真实门禁与 Firefox 150 desktop + `390×844` 门禁再次通过。
- 正式部署：等待原有 Task 的两个 Runtime 取得 terminal proof 后，active Activation / RunAttempt / RuntimeProcess 均为 `0`；一致性备份位于 `/Users/sun/Library/Application Support/RAH OS/backups/pre-p42-creator-20260902T091600Z`，两份 SQLite `quick_check=ok`。旧 PID `9820` 优雅退出，新 PID `21710` 在正式 `4173` 运行。
- 正式浏览器 `D`：桌面资料页真实显示 creator `owner @owner` 和“已创建的 AGENT 0 / 暂无已创建的 Agent”；canonical profile URL 重载后保持同一 Agent。`390×844` 重载后仍处于详情、返回按钮可见、底部导航隐藏、`scrollWidth=390`，console 为空。移动端从底部 Agent 根入口进入时会显式清除旧详情选择，不会把上次 deep link 误当本次根导航。
- 并发边界：正式部署期间另一个工作流新增了未完成的 `packages/daemon/test/rah-data-home.test.ts`，缺少其实现文件。本批未覆盖该并发改动；上述全量 `npm run check` 完成于该文件出现之前，当前改动另以 Web 定向门禁验收。
- P4.2b 仍未实现：“创建外部 Agent”保持真实禁用态；未取得 Raft Server/CLI 凭据事务源码前，不用自制 token flow 冒充对齐。
