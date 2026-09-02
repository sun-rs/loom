# Agent 问题诊断导出 Raft-first 合同

状态：`C/A/L/D` 完成；Raft 中央上传服务不在本地产品范围内

## 1. 上游事实

冻结 Raft 发布物：

- `docs/evidence/raft-web-20260831-current/AgentDetailPanel-DKwoNvgK.js`
- SHA-256：`b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845`
- 精确符号：`Ho`（反馈 bundle）、`Yo`（文件名）、`Jo`（SHA-256）、`Zo`（ReportIssueDialog）

Raft 可见合同不是“点击后发一条普通消息”。`Zo` 显示 Agent、可选问题描述、四类包含项、敏感数据警告与明确同意；提交后依次收集资料、取得 `feedback-report:create` scope attestation、创建 report、上传 JSON bundle、complete，并可异步请求 runtime transcript。loading 时不能关闭，错误按收集／attestation／创建／上传／complete 分阶段显示；成功页显示 report reference。

这套中央上传事务不能在 RAH OS 中照搬：RAH OS 没有 Raft feedback host、中央 Server attestation 或邮件 receipt，伪造 report id / “已上传”会制造错误的安全承诺。

## 2. 本地产品裁决

复用 `Zo` 的弹层结构与状态机，最终动作改为**导出到本机**：

1. 入口仍位于 Agent 资料页橙色操作区，只有有 `agent.manage` 能力的 Human 可用。
2. 弹层显示目标 Agent、可选问题描述、包含项、敏感数据警告、显式同意、取消和导出。
3. 首版唯一可选包含项是“最近活动诊断元数据”，默认开启；读取现有 ACL-safe `agent.trajectory.list` 最新 100 条。
4. bundle 只含 Agent canonical identity/profile 摘要、用户主动输入的问题描述、浏览器基本环境和 `renderAgentActivityDiagnostics` 产生的 correlation metadata。
5. 不含 Room/DM 消息正文、reasoning、tool input/result、provider stdout/stderr、环境变量、Memory/文件内容、账号 token 或 runtime transcript。
6. 浏览器生成 JSON 文件并触发本地下载；成功页只显示“已导出到本机”和文件名。不会向 Raft、RAH 作者或任何第三方发网路请求。
7. 用户需在分享前自行检查文件；未勾选同意不能导出。

## 3. 唯一 owner 与边界

| 层                                | owner                                                              |
| --------------------------------- | ------------------------------------------------------------------ |
| 活动读取                          | 既有 `agent.trajectory.list` protocol / Kernel ACL-safe read model |
| 安全活动文本                      | 既有 `apps/web/src/agent-activity-diagnostics.ts`                  |
| bundle schema/文件名/序列化       | 新增单一 Web owner `agent-issue-report.ts`                         |
| 弹层、loading/error/success/focus | 新增 `AgentIssueReportDialog`，复用 `useDialogProtocol`            |
| 下载                              | 浏览器 Blob/Object URL；不新增 daemon 文件或上传 API               |

不增加第二份 runtime log parser，不让 Web 解析 Provider 原生日志，不在 daemon 保存重复 report 文件。将来若用户明确配置自己的 issue endpoint，必须另立 credential、目的地、redaction、重试和 receipt 合同；不得把本地导出悄悄升级成上传。

## 4. 交互合同

- 打开：初始焦点落到描述输入；Escape、背景和关闭按钮均关闭并把焦点还给橙色入口。
- 导出中：关闭、Escape、字段和重复提交均阻断。
- 读取失败：弹层保留、内联错误、没有下载；允许重试。
- 成功：显示文件名、包含范围与“完成”；关闭后焦点回入口。
- desktop 与 `390×844` 不横向溢出，弹层内容超高时内部滚动。

## 5. TDD、验收与证据等级

先写失败用例：

1. bundle schema/version、文件名清洗和描述空值；
2. 活动关闭时不读取／不包含；活动开启时只包含安全 correlation metadata；
3. 下载失败不显示成功，成功后 URL 必须 revoke；
4. UI 入口不再 disabled，未同意不能提交，Escape/focus 与 pending fence；
5. Chrome、Firefox desktop / `390×844` 实际导出并解析 JSON，确认不含消息正文、命令、tool result 和 secret 样本。

证据口径：冻结 bundle和官网 UI 为 `R`；本地 builder/dialog 为 `C`；自动化为 `A`；隔离真实浏览器为 `L`；正式 4173 重启后只读打开/关闭和无 console error 为 `D`。本地下载不能被写成 Raft 中央上传等价。

## 6. 施工与验收记录

- `C`：新增单一 `agent-issue-report.ts` builder/downloader 与 `AgentIssueReportDialog`；资料页橙色入口按 `agent.manage` 门控。导出只读取现有 ACL-safe `agent.trajectory.list`，不新增 report/upload API，也不解析 Provider 原生日志。
- `A`：全量 package 测试 790 项，其中 788 通过、2 个真实付费 Provider 用例按规则跳过；Web `178/178`，真实回调回归 `34/34`。typecheck、Prettier、产品构建、`git diff --check` 和 `npm audit --omit=dev` 全部通过，依赖漏洞为 0。
- `L`：真实 Google Chrome 与 Firefox 150 的 desktop / `390×844` 门禁均实际下载并解析 JSON，确认 schema、描述、活动范围和本地 transport；同时拒绝 `toolInput`、消息正文、runtime transcript 与 secret 样本。Escape、焦点返回、同意门控和手机无横向溢出通过。
- `D`：正式状态在重启前有 28 个 completed Activation、28 个 terminated RuntimeProcess、28 个 exited RunAttempt；仅 1 个 submitted Task 待 Human，没有 active work。停机一致性备份位于 `/Users/sun/.rah/backups/pre-p45-agent-issue-report-20260902T101154Z`，两个 SQLite 均 `quick_check=ok` 且无外键异常。新 PID `49449` 在 `127.0.0.1:4173` online；正式 Agent 资料页只读验证了入口、默认安全活动范围、未同意禁用、Escape 关闭与焦点返回，没有在正式数据上执行导出。

`R` 只证明 Raft 的可见弹层结构、状态机和中央上传事务形状；RAH 的结果明确是本地诊断文件，不能宣称具备 Raft 的 scope attestation、report receipt、邮件或中央支持后台。
