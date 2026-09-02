# RAH OS Raft-first 剩余收口重构与补强计划

状态：执行中

首次落盘：2026-09-02

可回退基线：`023aad7 feat: establish Raft-aligned collaboration baseline`

本文是后续收口的执行真相，避免对话上下文缩减后重新猜测优先级、重复发明产品合同，或将历史审计当成当前完成清单。若代码、当日最新审计与本文冲突，必须先写明新证据和变更裁决，再修改本文，不得默默改口径。

## 1. 产品边界与已验证基线

RAH OS 是本地优先、Room-first 的多 Agent 协作工作台。唯一持久业务链仍是：

```text
Room event -> Inbox item -> Activation -> AgentHost lease
           -> RunAttempt -> explicit Room / Task action
```

基线提交 `023aad7` 已通过 `npm run check`：package tests 760 项，758 通过、2 项真实 Provider 用例按规则跳过；Web 159/159；真实回调回归 34/34；typecheck、format 与 `git diff --check` 通过。当日调度审计还证明了以下不再重做的基建：

- Room / DM / Thread / mention 的 canonical delivery、freshness、ack 与幂等；
- 单一 Agent lane、busy follow-up、Raft 形 held draft 四结局与 peer wake；
- Task claim/review/reopen/reassign 的 typed completion obligation 和 terminal proof；
- 结构化 Runtime `actionRequired / sticky / recoverable`、正向 jitter 和重复故障隔离；
- 跨 Room Reminder target、Thread receipt 与 reload-safe typed permalink；
- Human Inbox、Search/FTS、Activity、Files/Artifact P0、Web Push 软件链、Agent Memory Raft 基线。

## 2. 永久排除与明确延后

不复制 Raft 的中央账号、套餐、计费、中央应用商店、社区邀请和公开分享 URL。用户自行安装并登录 Codex / Claude / Kimi / OpenCode CLI；RAH OS 只发现、调用和管理已存在的本机能力。

多 Computer 业务、跨机文件传输与中央 relay 当前延后。本机 Computer/runtime 的显示、状态和安全调用仍在范围内。这个取舍不取消 ACL、causal barrier、operation fence 或并发安全要求。

## 3. 源码复用顺序和证据等级

每一批施工必须先完成下列映射，未完成时不得写产品代码：

```text
Raft 官方触发位置
  -> 已授权发布 bundle 的组件/参数/请求/状态分支
  -> 同前置的官网 DOM、computed style、pointer/键盘结果
  -> RAH OS 唯一 protocol/kernel/host/client/UI owner
  -> 失败的合同测试
  -> 最小结构化移植 + 明示的本地安全 glue
  -> 双边或明示标注单边的真实浏览器验收
```

复用优先级：

1. **Raft 已授权源码/冻结发布产物**：优先复制对象语义、组件结构、请求 shape、异步分支、键盘与焦点合同。发布 bundle 不能证明未取得的 Raft Server 事务实现。
2. **Multica**：仅当 Raft 没有可复用的服务端代码，且 Multica 某一独立模块在完整性、故障恢复或移植成本上有可证明优势时采用。必须在复用台账中记录 commit、文件、采用点和拒绝点。
3. **RAH OS glue**：只实现本地 daemon、SQLite 事务、ACL、idempotency、terminal proof、路径安全和非中央部署必需的适配，不发明第二套产品行为。

证据分层固定为：`C` 代码已接线，`A` 自动化门禁，`L` 本地真实浏览器，`R` Raft 同前置双边，`D` 正式 4173 部署重启后实页。任一层不能自动代替下一层。

## 4. 按顺序施工的批次

### P0. 重算行为指南，先恢复真实完成口径

目标：把 `raft-behavior-inventory.zh-CN.md` 从 2026-09-01 历史截图修正为可导航的当前索引。

- 不删除历史审计；对旧矩阵标注“当时快照”，另加 2026-09-02 overlay。
- 更正已被后续代码关闭的行：Thread 附件、restart/session、Workspace push mute、model/effort 等。
- 为每个仍存缺口连接 owner、测试、审计和下一批次，不再用“七个 tab 存在”代替功能完成。

验收：文档链接有效，状态可由当前代码/测试定位，无一条同时声称“已接”和“未完成主链”。

### P1. Room 生命周期与成员权限

先复刻 Raft channel settings 的产品合同，再映射到本地 canonical Room：

| 子批 | Raft 合同                                        | RAH OS 唯一 owner                                                                 | 安全裁决                                                                            |
| ---- | ------------------------------------------------ | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| P1.1 | 成员角色查看/修改，owner/admin/member 徽标与确认 | protocol `room.member.role` + Kernel collaboration service + 成员页               | Agent 不能获得 Human 管理角色；至少保留一名 Human owner；stale Room seq fail closed |
| P1.2 | 归档后历史可读、不可发布、侧栏隐藏、可取消归档   | 新 typed Room lifecycle command + Kernel transaction/query gate + settings drawer | 归档是可逆操作；不删除 Message/File/Task；活跃工作要么终止证明，要么拒绝归档        |
| P1.3 | Human 退出频道                                   | membership remove command + navigation/sidebar projection                         | 不得让最后 Human owner 退出；不得对 direct/control Room 应用频道逻辑                |
| P1.4 | 删除频道的二次确认与 loading/error               | 独立的破坏性 operation，不复用 archive                                            | 先定义保留/导出/恢复合同；未定义前 UI 禁用，不物理删库/删 blob                      |
| P1.5 | Room “停止 Agent” SOS                            | Room-scoped execution hold + terminal proof + guidance resume                     | 不是全局 per-Agent pause；只停止/阻止该 Room 的 Agent work，不误伤其他 Room         |

执行裁决：P1.4 必须先完成源码合同与本地删除图设计闸；设计审计若证明物理删除仍缺事务/GC 闭环，则保持入口不接线，先施工非破坏但更核心的 P1.5 SOS，再回到 P1.4 的 eraser 实现。这不是跳过 P1.4，而是防止一个表面“对标”的按钮破坏 canonical state。

严格 TDD 顺序：protocol schema 红测 -> Kernel 事务/重启恢复红测 -> HTTP/SDK 合同 -> UI focus/Escape/outside/disabled/loading 红测 -> desktop/390 真实 pointer 门禁。正式 4173 不执行删除或退出；只用隔离状态验收破坏性分支。

### P2. Agent 工作区与真实项目 cwd

目标：把当前 Agent-owned workspace/Memory browser 和用户真实项目目录分开表达，再安全挂载项目文件树。

施工 owner、typed root、安全/回滚与浏览器状态机已经固定在 [P2 Agent workspace / 本地项目文件合同](./2026-09-02-agent-workspace-and-project-files-contract.zh-CN.md)。源码复核确认 Raft 的 workspace 本身就是 Agent 持久目录（含 `MEMORY.md`/`notes/` 和 Agent 自己的文件），因此 RAH 不再把 Memory 伪装成另一个平级 root；第二 root 只映射 daemon 冻结的本机 `workspace.cwd`。

- Raft 提供 tab/空态/文件树/文件读取的前端合同；RAH OS Kernel/AgentHost 拥有本地 root scope、symlink 拒绝、路径隐藏、大小/页数边界。
- project identity 使用明示 catalog + aliases/relations，cwd 只是 run provenance，不拆分 Agent Memory owner。
- UI 要明确区分“Agent 私有 Memory”、“Agent 工作区”和“本次运行项目”，不把读文件说成发布 Artifact。

验收：本地非空文件树在 desktop/390 可展开、读取、切换和重载；越界/symlink/过大/旧请求均 fail closed。Raft Computer 离线时明确记录双边“阻塞”，不把本地成功写成双边成功。

### P3. InputRequest 完整生命周期

经冻结 Raft bundle 与 Multica 源码复核，Raft 只公开 NotificationCenter/card/dialog 的前端行为，Multica 没有可直接复用的 typed Human InputRequest 状态机。先关闭有 canonical 反例的最小 P0：Task 取消必须在同一事务中把 pending InputRequest 终止为 cancelled，旧 request 不在重开 Task 时复活。详细合同见 [InputRequest 生命周期收口合同](./2026-09-02-input-request-lifecycle-contract.zh-CN.md)。

自动 expire、Human dismiss 即取消、requester 隐藏旁路和结构化表单没有成熟源码依据，也不是当前安全闭环的必要条件，延期到真实 Provider/产品需求能够证明时另立设计。Kernel 继续是生命周期唯一 owner；Raft 只复用通知/弹层合同，Multica 只保留一致计数、幂等和隔离的监督原则。

### P4. Agent 页面剩余真实模块

每个模块独立立项，禁止以“七个 tab 都能点”一次性宣称完成：

1. Relationship graph 的数据语义、筛选、空态和 deep link；
2. created Agents / external Agent 身份与权限边界；
3. Apps 授权投影（不包含 Raft 中央应用商店）；
4. 自定义图片头像的安全存储/缩放/删除；
5. issue report 的本地诊断导出替代，禁止伪装上传到 Raft；
6. full reset 仅在精确所有权、备份、恢复和 terminal proof 合同齐备后解锁。

模型、effort、runtime、名称、描述、官方头像、pause/resume、restart/session、Activity、Chat、Reminder、Workspace 和 MCP 已有 owner；新模块必须复用它们，不重建 Agent store。

P4.1 关系图已经完成源码裁决、施工、正式重启与真实浏览器验收，详见
[Workspace 成员关系图 Raft-first 合同](./2026-09-02-member-relationship-graph-contract.zh-CN.md)。
它复用冻结 Raft `MemberGraphSection` 的共享 Channel 边语义、布局、pan/zoom、hover 与摘要；
本地后端只增加 ACL-safe read model，不使用消息内容或模型推断关系。`C/A/L/D` 完成；
`R` 覆盖冻结发布物可证明的 projector/组件/交互，不宣称复制未公开 Server ACL。

P4.2 已拆成两个安全边界，详见
[Agent 创建者、已创建 Agent 与外部 Agent 合同](./2026-09-02-agent-creator-and-external-identity-contract.zh-CN.md)：
P4.2a 先修正“创建者被最后编辑者覆盖”的 canonical 反例，并接通 created Agents 只读投影与 Raft 形资料区；
P4.2b External Agent 需要独立 device authorization、可撤销凭据、purpose 服务端门禁和 content-free wake，
在未取得 Raft Server/CLI 可靠来源前维持设计闸，不把 managed 本机 CLI 改名冒充完成。

P4.3 Apps 已完成 Raft-first 设计审计，详见
[Agent 应用授权投影合同](./2026-09-02-agent-app-grant-contract.zh-CN.md)。Raft 的 Apps tab 是 durable OAuth client grant 投影/撤销，不是 CLI、MCP、Skill 或应用商店。当前 RAH 没有安全的 client/grant owner；Multica Composio 是反方向的 per-run 工具能力，不能直接移植。P4.3 保持 `R/design`，与 P4.2b 共用 credential/grant owner 后再解锁，不用空 API 或 MCP 重命名冒充完成。

P4.4 自定义图片头像已经完成 Raft bundle 映射、施工、双浏览器与正式重启，详见
[Agent 自定义图片头像合同](./2026-09-02-agent-custom-avatar-contract.zh-CN.md)。它复用 Human/Workspace 已有的认证、5 MiB、内容嗅探、内容寻址和原子写入存储，只扩展 Agent profile schema、统一渲染器和 picker 状态机；`C/A/L/D` 完成。物理 blob 删除在没有引用安全 GC 前明确不做。

P4.5 已完成 Raft `ReportIssueDialog` 的中央上传事务反推并冻结本地裁决，详见
[Agent 问题诊断导出合同](./2026-09-02-agent-issue-report-contract.zh-CN.md)。RAH 结构化复用描述、包含项、敏感数据同意、pending/error/success/focus 状态机，但最终只导出经过裁剪的本地 JSON；不伪造 Raft scope attestation、report id、邮件 receipt 或上传成功。

P4.5 已施工并完成 `C/A/L/D`：复用现有 ACL-safe trajectory read model 和安全诊断 renderer，不新增第二日志 owner 或上传 API；package `788 pass + 2 opt-in skip`、Web `178/178`、parity `34/34`。Chrome 与 Firefox 150 在 desktop / `390×844` 实际下载并解析裁剪 JSON；正式 active work 为零后，备份 `/Users/sun/.rah/backups/pre-p45-agent-issue-report-20260902T101154Z` 的两个 SQLite 均通过完整性/外键检查，新 PID `49449` 在 4173 online，正式页同意门控、Escape/focus 只读复核通过。Raft 中央 feedback host 仍是产品边界差异，不伪装等价。

P4.6 已完成 Raft-first 设计、施工与二次审计，详见
[Agent 完全重置合同](./2026-09-02-agent-full-reset-contract.zh-CN.md)。Raft 发布物证明三档 dialog、
`POST /agents/:id/reset {mode}` 与 full 的不可撤销 workspace 语义，但不证明 Server 删除事务。
本地审计确认不得串联现有 execution reset 和 memory reset：两次独占 lease 之间会产生新 Activation
竞态。已在一次 `execution_restart` fence 内复用既有 Provider continuity quarantine 与
Agent workspace 原子 quarantine；`runtime-project/workspace.cwd`、canonical Room/Task/Message/
trajectory 永不进入删除范围。Provider continuity 的同 operation 崩溃重放和旧 Host generation
显式接管均已经先红后绿；定向自动化、Chrome 与 Firefox desktop/mobile 隔离门禁完成，当前
`C/A/L/D`；正式 `4173` 在 active work 审计、完整状态备份和精确重启后只读复核通过，未提交
destructive full。全库门禁仍被非本批 Thread panel 的进行中类型/格式
改动阻塞，不能把定向通过写成整个共享 worktree 已绿。

### P5. 设备级通知验收（软件与 Firefox 正式实例已收口，设备横幅证据受阻）

详细施工与证据口径见 [P5 设备通知 Raft-first 收口计划](./2026-09-02-device-notification-closure-plan.zh-CN.md)。2026-09-02 已按 Raft `getRegistration -> ensure only on enable` 合同移植 registration helper，并关闭正式 Firefox 中 test API 已 `200`、页面却因并发 refresh 显示 `NetworkError` 的反例。定向事件矩阵 `261/261`、parity `34/34`、Firefox `1440x1000`/`390x844` gate、正式 `4173` 重启后真实指针复测均通过。macOS 当前“屏幕镜像或共享时关闭通知”，所以横幅/点击仍是独立设备证据，不能由录屏期间的无横幅替代。

软件链已接：默认期望开启、用户手势请求权限、Room/DM/mention/Task/InputRequest/Review 的 typed target、Workspace mute、显式 opt-out、失效 subscription 清理。剩余不再添加第二份通知状态，而是完成真机：

- macOS Chrome 和 Firefox 后台横幅、文案、图标与点击回跳；
- PWA/iOS 在实际授权、屏幕关闭/后台和订阅失效下的结果；
- 每个事件类别的“应通知/应抑制”矩阵，含 DM、明确 mention、Room opt-in、Task done/review/input、Workspace mute 和 self-authored suppression。

### P6. 低于业务完整性的 UI 收口

- P6.1 空间标识 anchored switcher 已完成 `C/A/L/D`；详细源码、owner、差异与浏览器证据见
  [空间切换浮层 Raft-first 合同](./2026-09-02-workspace-switcher-contract.zh-CN.md)；
- P6.2 回应者浮层已经完成 Raft 源码裁决、failure-first 施工、隔离浏览器与正式部署验收，详见
  [消息回应者浮层 Raft-first 合同](./2026-09-02-reaction-reactors-popover-contract.zh-CN.md)。消息回应只使用官方
  固定七项；动态完整 emoji picker 属于侧栏分区图标，不作为消息缺口。当前 `C/A/L/D`；随后按官方触发重审
  Message context menu；
- P6.3 消息上下文菜单已完成 `C/A/L/D`，详见
  [消息上下文菜单 Raft-first 合同](./2026-09-02-message-context-menu-contract.zh-CN.md)。Raft 顺序的回应、typed link、
  Markdown、Thread、收藏和转 Task 已接 canonical owner，右键与 500 ms 长按共用一个 floating owner；翻译、
  多选转发、Thread follow read model 与 stale-safe Task 状态动作保持显式后续，不用无状态按钮冒充；
- 收藏独立页当前官方页面没有搜索/Room/排序控件，不自行暴露“高级筛选”；卡片细节已按 SavedPanel 合同施工，
  后续只处理有新官方触发证据的差异；
- P6.4 Thread 关闭与焦点返回已完成 `C/A/L/D`；Raft Escape 分层、浮层消费、显式关闭与本地可访问性
  焦点归还已通过正式 desktop/`390x844` 验收，详见
  [P6.4 Thread 关闭与焦点归还合同](./2026-09-02-thread-focus-return-contract.zh-CN.md)；
- P6.5 Search relevance 与空白过滤边界已完成 `C/A/L/D`；空关键词筛选、recent 锁定、多词
  OR、全词优先、逐词高亮、冻结游标与 ACL 均已通过正式和隔离 Firefox 验收，详见
  [P6.5 Search 多词相关度与空关键词筛选合同](./2026-09-02-search-relevance-and-blank-filter-contract.zh-CN.md)；
- P6.6 本地 Computer 详情已完成 `C/A/L/D`：独立 `320 / 240..520` 侧栏、真实 pointer/keyboard
  resize、Runtime inspector、裁剪诊断、共享 Agent 头像和 typed profile 往返已通过 Chrome 与 Firefox desktop /
  `390×844`；正式 active-work 审计、852 MiB 离线备份、不可变发布物恢复与 Firefox 新标签只读复验完成。随后出现的
  并发缺文件／缺导出已经通过完整 typed MessageReference owner 收口；整库 `npm run check`、format、Web build
  与 Markdown 真实浏览器 gate 已重新通过，源码可重建。最终又从当前源码执行标准启动链，三库一致性备份为
  `/Users/sun/.rah/backups/pre-rich-reference-final-20260902-3RfArz`，PID `22529` 在 4173 online；Chrome
  `390×844`、Firefox 150 桌面/移动以及正式新标签均通过。详见
  [P6.6 本机 Computer 详情 Raft-first 合同](./2026-09-02-computer-local-detail-contract.zh-CN.md)。
- P6.7 durable Computer 显示名称／描述已完成 Raft 前端源码裁决与本地 single-owner 设计，详见
  [P6.7 本机 Computer 持久资料 Raft-first 合同](./2026-09-02-computer-durable-profile-contract.zh-CN.md)。施工只允许
  daemon owner-private profile、revision/idempotency 与 Raft 名称/描述编辑状态机；创建时间、创建者和浏览器内
  restart/status/doctor 不得从 heartbeat 或假命令推断。

## 5. 每批必填的施工记录

| 字段              | 必填内容                                                                                   |
| ----------------- | ------------------------------------------------------------------------------------------ |
| upstream          | 版本/commit/hash、文件或 bundle chunk 和精确符号/偏移                                      |
| observed contract | 触发、参数、loading/success/empty/error/disabled、关闭、键盘、focus、stale response        |
| reuse class       | byte-exact / structural port / RAH glue / intentionally excluded                           |
| single owner      | protocol、Kernel、Host、application service、SDK、client reconciliation、UI 各自的唯一责任 |
| failure-first     | 先失败的测试和它证明的反例                                                                 |
| migration         | schema 版本、历史数据映射、新版本 fail closed                                              |
| rollback          | 中断/失败/重启如何恢复，哪些操作需要备份或 terminal proof                                  |
| evidence          | C/A/L/R/D 分层结果与截图/日志/审计链接                                                     |

## 6. 共通发布门禁

每个代码批次必须：

1. 先运行定向红测，再最小实现；
2. `npm run check`、`npm run format:check`、`git diff --check`；
3. Web 变更运行 `npm run build:web:workbench` 和相关 Chrome/Firefox 门禁；
4. desktop 与 390×844 的真实 pointer、hover、keyboard、focus、reload 和 error recovery；
5. 不使用付费 Provider，不使用 GPT-5.6 Ultra；
6. 完成批次后先检查 active work，备份正式持久状态，优雅停止精确实例，重启 4173 并用新浏览器页验收。

破坏性 Room 命令、full reset 和真实设备通知不在正式用户状态上做演示性写入。必须使用隔离 state/workspace/browser profile，并将“隔离验收”与“正式部署不回归”分开报告。

## 7. 执行台账（2026-09-02）

### 当前执行队列（上下文恢复入口）

1. **P4.6 full reset**：`C/A/L/D` 已完成；共享 Thread panel 改动收口后重跑全库门禁，不再扩写本批。
2. **P5 设备通知**：软件与 Firefox 正式实例 `C/A/L/R/D` 已完成；macOS 横幅/点击因“共享屏幕时关闭通知”
   阻塞，Chrome 新订阅和 iOS PWA 是后续显式设备动作，不阻塞软件队列继续。
3. **P6 高价值交互收口**：P6.1–P6.7 已完成 `C/A/L/D`，并发缺文件／缺导出已关闭，整库重新可构建。
   P6.7 以 daemon 的 `LocalComputerProfileStore` 单独拥有显示名称／描述，heartbeat 仍只拥有 hostname、OS、
   版本与在线观测；详细证据见
   [P6.7 验收审计](../audits/2026-09-03-computer-durable-profile-verification.zh-CN.md)。
4. **P1.4 永久删除**：`C/A/L/D` 已完成；schema 40 的显式 FK eraser、blob GC receipt、
   SQL 回滚故障注入和启动恢复均已红转绿。正式持久 Workspace 只做确认层取消验收，实际删除只在隔离状态执行。
5. **P4.2b/P4.3 外部 Agent/OAuth Apps**：共享 credential/grant owner 有可靠上游来源前保持禁用；
   不拿 CLI/MCP/Skill 重命名冒充。

每完成一批即在本节写入 upstream hash、owner、failure-first、`C/A/L/R/D` 和正式重启证据，
后续对话不得跳过尚未关闭的前序安全闸。

### P6.7 本机 Computer 持久名称／描述（`C/A/L/D` 完成）

- upstream：冻结 Raft `MachineDetailPanel-CIacRrGS.js` 与 `index-BoAC7nSE.js`；名称、描述、权限、键盘、
  pending/error、字符限制和 PATCH 请求合同均来自发布物，不按截图猜测。
- reuse：Raft 前端状态机 structural port。Raft Server 未发布，本地后端使用 daemon-owned owner-private JSON、
  revision/idempotency、候选状态先落盘再发布内存结果；没有让 heartbeat、localStorage 或 UI 取得资料所有权，
  也没有采用语义更弱的 Multica Computer 实现。
- failure-first：strict protocol、重启恢复、幂等冲突、stale revision、未来 schema、损坏／符号链接／宽权限、
  原子写入和“持久失败不得污染内存读模型”均先有失败反例再修复。
- evidence：定向 `18/18`；整库 packages `808`（`806 pass / 2 opt-in skip`）、Web `220/220`、回调审计
  `34/34`；Chrome 与 Firefox desktop + `390×844` 修改、刷新、Enter/Cmd/Ctrl+Enter、Escape、focus 均通过；
  依赖漏洞 `0`。正式状态无 active work，离线完整备份为
  `/Users/sun/.rah/backups/pre-p67-computer-profile-20260903-ktjnMv`；正式页面只读打开编辑态并 Escape，未替用户
  改名，页面无错误。`C/A/L/D` 完成；`R` 只覆盖可证明前端合同，不宣称未知 Raft Server 存储逐行一致。

### P0 行为指南重算

- 状态：`C/A` 完成。`raft-behavior-inventory.zh-CN.md` 已区分 2026-09-01 历史快照与 2026-09-02 当前 overlay，并修正 Thread 附件、restart/session、Workspace push mute、model/effort 等已关闭项。
- 基线：`023aad7 feat: establish Raft-aligned collaboration baseline` 已提交，未 push。
- 剩余证据：本轮 P1 完成正式重启后补 `D`；不能把文档重算写成 Raft 双边 `R`。

### P1.1 Human Room 角色

- upstream：冻结 Raft `HumanDetailPanel-DvWNsDz9.js` 的 `onClick:()=>{I(a.role??"member")...}`、`await ve(a.userId,x)`，以及 `RolePermissionHelpDialog-Ca2yhS_h.js` 的 Human `owner/admin/member` 与 Agent `admin/member` 说明。
- observed contract：有权限的 Human 可打开角色选择、保存/取消、看 loading/error；最后一名 owner 不得被降级。RAH OS 没有中央 Server 角色，因此只结构化移植到 canonical Room Human role。
- reuse class：structural port；Agent 不获得 Human Room 管理角色是本地安全收紧，不是发明第二套成员页。
- owner：`room.member.role` protocol → Kernel collaboration service → SDK/application service → `room-member-pages.tsx`。
- failure-first：`room-member-role-contract.test.ts` 与 Kernel 既有 owner 不变量。
- evidence：`C/A/L/D` 完成；桌面与 `390×844` 的编辑、返回、焦点、部分失败重试通过，正式 `4173` 重启后成员摘要与设置入口正常。`R` 仅覆盖前端触发/角色集合。

### P1.2 Room 归档、取消归档与名称恢复

- upstream：冻结 Raft `index-BoAC7nSE.js:128` 的 `POST /channels/${id}/archive|unarchive`；同文件 `:213` 的 `archived_name_collision`、`archivedChannelId`、`archivedChannelName`、取消归档后导航原频道分支；Raft 设置页的橙色归档按钮、确认文案与直接取消归档入口。
- observed contract：归档保留历史并从侧栏隐藏；归档后只读；可取消归档；创建同 slug 频道时不得复制历史，而应选择恢复旧频道或修改名称；确认层的 Escape 只关闭顶层确认并还焦点给触发按钮。
- reuse class：前端 structural port；typed lifecycle、SQLite transaction、活动工作拒绝与 `RoomEventWriter` 只读总闸是 RAH local-first glue。未宣称复制未知的 Raft Server 事务代码。
- owner：`room.archive` / `room.unarchive` protocol → Kernel collaboration service → application service/SDK → Room settings/create dialog；`selectProductRooms` 与 sidebar 只投影未归档 channel。
- failure-first：protocol strict schema、Kernel manager/idempotency/reversible/read-only、HTTP/SDK roundtrip、UI projection 与隔离浏览器合同。
- rollback：归档前拒绝 active Task/InputRequest/Activation/Run/Runtime/MCP；先写 canonical 归档事件再设置 `archived_at`，取消归档在同一事务中清字段并写事件；失败回滚整笔事务。
- evidence：定向自动化 `37/37`；隔离浏览器桌面和 `390×844` 的名称冲突、修改名称、取消归档、焦点与无横向溢出均 `PASS`。正式 `4173` 重启后只读打开真实 Room 设置与归档确认，Escape 只关闭顶层确认、父设置保留、焦点返回归档按钮，console 无 error/warn；`390×844` 无横向溢出。`C/A/L/D` 完成；官网 Server 状态未满足同前置，故 `R` 只记录可见前端合同。

### P1.3 Human 退出频道

- upstream：冻结 Raft `index-BoAC7nSE.js` 的 store `leaveChannel: POST /channels/${id}/leave`，以及 Channel Settings 的 `channel-overflow-leave`、橙色 ConfirmDialog、`onConfirm: async()=>{await onLeaveChannel(); onClose()}`；中文文案来自同 bundle 的 `channel.edit.confirmLeave/leaveAction/leaving`。
- observed contract：只有已加入的普通 Channel 显示退出入口；点击先开橙色二级确认；提交期间禁用并显示“正在退出…”；成功后关闭设置并导航离开。Escape 只关闭顶层确认并把焦点还给“退出频道”；官方背景点击不关闭 ConfirmDialog。
- reuse class：前端 structural port。服务端新增 actor-owned typed `room.leave` 是 RAH local-first glue：请求不接受 `principalId`，因此不能被客户端改成移除别人；没有复用管理员 `room.member.remove`。
- owner：`ClientRoomLeaveRequestSchema` → `CollaborationService.leaveRoom`/Kernel transaction → Human application service/SDK → `RoomMembersDialog` 与 App sidebar/navigation projection。
- failure-first：protocol strict schema 拒绝 `principalId`；Kernel 先失败于缺失 `leaveRoom`，随后覆盖 Human-only、idempotency、最后 owner、direct/control 与列表移除；HTTP/SDK 路由覆盖；UI policy 与隔离浏览器合同覆盖二级确认、Escape/focus、单次提交和无横向溢出。
- rollback：Room event 与 membership DELETE 在同一 SQLite transaction；stale seq、最后 owner、活跃 Task/InputRequest/Activation/Runtime、非 Channel 或非 Human 均在写入前 fail closed。成功后的重复请求由原 `membership.removed` event 去重，即使 membership 行已删除仍可返回同一结果。
- intentional difference：Raft 允许离开后既有公开 Thread follow 继续通知；RAH 当前把 Room membership 作为历史与 Thread 的统一 ACL，离开后全部从导航移除。确认文案如实说明该收紧。若以后增加 Workspace-Human/public-thread ACL 与自助 `room.join`，必须另立安全设计，不能在通知层绕过 `requireRoomMember`。
- evidence：定向自动化 `26/26`；隔离真实浏览器 desktop 与 `390×844` 均 `PASS`，390 页面 `scrollWidth=390`，确认层焦点在“离开”。全量 `npm run check`、产品构建、Firefox 150 桌面/移动门禁和依赖审计通过；正式 `4173` 在活动工作审计与一致性备份后重启，最后一名 Human owner 的退出动作正确禁用并显示原因，归档确认 Escape 仅关闭顶层且焦点返回，`390×844` 的 Room 与设置弹层均无横向溢出，console 无 error/warn。`C/A/L/D` 完成。`R` 覆盖可见触发、请求 shape、颜色、文案、loading 与关闭顺序，不宣称未知 Raft Server 事务等同。

### P1.4 频道永久删除（`C/A/L/D` 完成）

- upstream：冻结 Raft `index-BoAC7nSE.js` 的 store `deleteChannel: DELETE /channels/${id}`；Channel Settings 的红色 `channel-settings-delete-action`；二级 ConfirmDialog 使用 `channel.edit.confirmDelete/deleteAction/deleting`，成功后关闭设置并导航下一 Channel，否则回 Server Settings。中文确认文案为“「{name}」及其中的所有消息都会被永久删除，且无法撤销。”
- observed contract：删除不是归档的别名，也没有产品内撤销；触发、确认、loading、error 与成功导航必须沿用共享 ConfirmDialog。仅普通 Channel 的有管理权限 Human 可见；direct/control/系统 Room 不走这条命令。Raft 发布前端没有公开 Server 删除事务，所以这里不能声称后端源码移植。
- 本地引用图审计：schema 40 有 `32` 条直接 `NO ACTION -> rooms` 外键，沿反向外键图共有 `52` 张表可达。简单 `DELETE FROM rooms` 必然失败，改成级联迁移又会把未知数据面静默纳入破坏范围。动态 `PRAGMA foreign_key_list` 棘轮现在要求每张可达表显式进入 eraser 或 kind invariant；提交前 `PRAGMA foreign_key_check` 必须为空。
- retention/export/recovery 裁决：对用户可见语义严格跟 Raft——提交成功后立即不可读、不可搜索、不可导航、不可恢复；不增加伪装成撤销的软删除。导出是删除前独立显式动作，不由删除按钮暗中执行；产品内无恢复，只有操作员在停机状态从完整 RAH state 备份恢复整个状态集。正式 `4173` 永不用于删除验收。
- single owner：actor-free `room.delete` 请求与 `room_deletion_receipts`（仅引用 Workspace/actor，`room_id` 为已删除身份文本而非外键）负责幂等回执；`RoomDeletionService` 在一笔 `BEGIN IMMEDIATE` 中校验 manager、freshness、普通 Channel、无 active work，冻结删除清单，按显式拓扑清除 canonical 行并写回执。`RoomKernel` 只薄转发。`RoomFiles` 持有 per-blob GC receipt 和 exact UUID blob/.part reaper；启动及同请求重放会继续 pending/failed 回收。
- failure-first：schema/FK 覆盖测试、权限/kind/freshness/active-work、重复请求/同 key 异目标、Message/Thread/Search/Activity/Saved/Reaction/File 二级引用、事务中断回滚、提交后 GC 失败及重启续收均已红转绿。Web 入口只在 manager + caught-up + 普通 Channel 条件下解锁，错误停留在确认层且不会投影删除成功。
- rollback：SQL 提交前任何失败回滚全部 canonical 行；提交后没有业务回滚，只从 durable GC receipt 继续物理字节回收。删除回执不能持有指向被删 Room 的外键，且必须阻止相同 idempotency key 删除另一个 Room。
- evidence：定向 protocol/kernel/SDK/application `16/16`，故障注入/GC/跨 Room Reminder target/可达图 `6/6`；Chrome 完整真实浏览器门禁通过 desktop 与 `390×844`；Firefox 150 在隔离真实 Workbench 中创建并实际永久删除临时 Channel，验证二次确认逐字文案、Escape/focus、390px 无溢出、成功导航和 Room list 不可再发现。Raft bundle SHA-256、Multica 显式删除图来源、前后端映射和剩余风险见[产品合同](./2026-09-03-room-permanent-deletion-contract.zh-CN.md)及[验证审计](../audits/2026-09-03-room-permanent-deletion-verification.zh-CN.md)。`R` 只覆盖公开前端合同；后端是 Raft 语义 + Multica 可靠性模式 + RAH local-first SQLite glue，不声称复制未公开 Raft Server。

### P1.5 Room Agent SOS（已完成）

- upstream：冻结 Raft `index-BoAC7nSE.js` 的 `Fet`：`POST /channels/${id}/stop-all-agents`；停止成功后对话框从 `confirm` 转为 `stopped` 并把焦点放进 guidance textarea；“保持停止”只关闭弹层，“全部恢复”要求非空 guidance，并 `POST /channels/${id}/resume-all-agents`。Room 设置通过 `channel-overflow-stop-agents` 注入该入口。中文文案来自 `message.sos.*`。
- observed contract：第一层橙色确认明确“#{channel} 中所有正在运行的 Agent 都会立即停止”；loading 为“停止中…”；成功显示绿色状态“所有 Agent 均已停止”，允许保持停止或提供纠正后恢复；恢复 loading 为“正在恢复…”。这是 Room 级 SOS，不是逐 Agent 的全局启用/停用，也不是删除 membership。
- scope 裁决：RAH 已有 Agent 全局 pause/restart/reset，不能拿它冒充 SOS。Room SOS 只终止 `activation.room_id = targetRoom` 的正在执行工作并阻止该 Room 后续 Agent Activation；同一 Agent 在另一个 Room 的工作不应被暂停。若单 Agent lane 正在目标 Room，必须先取得 runtime terminal proof；若正忙于其他 Room，只建立该 Room hold，不取消异地运行。
- durable model：已新增 Room 范围 hold、operation receipt 与 activation-attempt target。stop 命令由认证 Human 发起，只快照目标 Room 当前已租约的 Activation；复用现有 Host cancellation 与 terminal-proof resolution，全部 target 有终止证明后才进入 stopped。中断/重启可从 operation receipt 继续，不能仅凭 HTTP 返回或进程消失宣称停止。resume 必须携带 bounded guidance，在一笔 canonical transaction 中解除 hold，并写入所有当前 enabled Agent 成员都可读取的 Room guidance event/Inbox/Activation；没有把隐藏 UI prompt 直接塞给 Provider 绕过 Room ledger。
- failure-first：protocol 严格 schema、目标 Room leased Activation 的 cancellation/terminal proof、停止后 lease hold、resume canonical guidance、同一 Agent 在其他 Room 工作不被取消均先红后绿；HTTP/SDK 路由和能力投影已纳入固定 operation 清单。UI 覆盖两阶段 dialog、焦点、Escape、loading/error、保持停止和非空 guidance 恢复。尚未虚构“部分 Host offline 自动成功”：HTTP 最多等待 30 秒，缺终止证明时 hold 保留并 fail closed，重试继续同一 durable operation。
- reuse class：Raft 前端流程和文案 structural port；RAH 复用现有 activation cancellation、RuntimeProcess terminal proof、Inbox/freshness 和 Room event writer，只新增 Room-scoped durable hold/operation glue。Multica 仅在找到更完整的多目标 saga/恢复实现时再采用，当前无采用证据。
- evidence：定向 protocol/kernel/SDK/application `13/13`；全量 Kernel/Host/Protocol 等 `769` 项中 `767` 通过、`2` 个真实付费 Provider 用例按规则跳过；Web `166/166`、真实回调 `34/34`。Chrome 完整门禁和 Firefox 150 门禁均通过 desktop 与 `390×844`；隔离 Room fixture 实际执行 stop/resume，证明 guidance、父设置保留、焦点和无横向溢出。正式 `4173` 在 active-work 为零、schema 37 一致性备份后优雅重启；正式页只打开/关闭 SOS 确认，入口 enabled、焦点与 Escape 返回正确、console 无 error/warn，未对真实 Agent 执行 stop。`C/A/L/D` 完成；`R` 覆盖 Raft 可见状态机、请求 shape、文案与 focus，不宣称复制未公开 Server 事务。

### P2 Agent 工作区与本机项目（`C/A/L/D` 完成）

- upstream：冻结 Raft `AgentDetailPanel-DKwoNvgK.js` 的 workspace roots/list/read、`includeHidden`、`dirPath`、文件 preview、Markdown source/preview、`256 / 160..600` 树宽、刷新与手机树↔预览合同。
- reuse class：Raft 前端 structural port；RAH 复用既有 AgentHost 安全文件读取 owner。本机 `runtime-project` 是 local-first typed extension，只取 daemon 冻结的 `workspace.cwd`，没有采用 Multica，也没有把未知 Raft Server 实现冒充已移植。
- single owner：protocol typed root → AgentHost realpath/lstat/bounded reader → daemon composition → application ACL 前后复核 → SDK typed operation → `AgentWorkspaceBrowser`。
- safety：Agent workspace/Memory 与本机项目严格分根；浏览器永不提交绝对 host path；secret/`.git`/symlink/hardlink/special/越界/过大 fail closed；Memory 控件不出现在项目根。
- failure-first、自动化和 Chrome/Firefox 非空树证据见 [P2 合同第 8 节](./2026-09-02-agent-workspace-and-project-files-contract.zh-CN.md#8-施工与验收记录2026-09-02)。`npm run check` 为 package `773`（`771` 通过、`2` skip）、Web `167/167`、回调 `34/34`；依赖漏洞 `0`。
- 当前证据：`C/A/L/D` 完成。正式状态 active work 为零且数据库 `quick_check`/外键检查通过；729 MB 一致性备份位于 `pre-agent-workspace-project-20260902T142912`。PID `49255` 在 `4173` 重启后，正式页面实际读取非空 Agent workspace 与本机项目 README；`390×844` 无横向溢出，console error/warn 为零。Raft Computer 离线，官方非空树同前提 `R` 仍阻塞，不能宣称双边非空树完成。

### P3 InputRequest 生命周期（`C/A/L/D` 完成）

- upstream：冻结 Raft `index-BoAC7nSE.js` 只证明 NotificationCenter/card/dialog、查看不等于 dismiss、typed target 点击时重验存在性/ACL；没有公开 `InputRequest` Server 状态机。Multica 没有可复用的 `pending/resolved/cancelled` + Task suspend/resume 合同。
- reuse class：Raft 前端 structural port；Kernel cancellation transaction 是针对已证明 ghost request 的最小 RAH local-first glue。未增加任意 TTL、dismiss-as-cancel、隐藏 requester 旁路或自制结构化表单。
- single owner：`InputRequest` protocol → schema 38 → `TaskLifecycleService.cancelTask` 同事务派生 terminal request → application/SDK 读取 pending projection → Human Inbox reconciliation。
- failure-first / migration / rollback：完整记录见 [InputRequest 生命周期收口合同第 8 节](./2026-09-02-input-request-lifecycle-contract.zh-CN.md#8-施工与验收记录2026-09-02)。Task 取消失败会回滚 Task、request 与 Room event；Task 重开不会复活旧 request。
- evidence：`npm run check`、format、diff、产品构建、Chrome/Firefox desktop + `390×844`、隔离真实取消/刷新闭环和依赖审计均通过。正式迁移前 732 MB 一致性备份为 `pre-input-request-v38-20260902T151550`；旧 PID `49255` 优雅退出，新 PID `59686` 在 `4173` 运行 schema 38，正式历史/DM/Runtime 保留且 console 为空。`C/A/L/D` 完成；`R` 仅覆盖可见前端合同。

### P4.1 Workspace 成员关系图（`C/A/L/D` 完成）

- upstream / reuse：冻结 Raft `MemberGraphSection-C1stxx0a.js`（SHA-256
  `0913095ac9ca8b0c0b95fee0df026674f852c9daf61669bd6347ef616121059e`），结构化移植
  shared-Channel edge projector、`920×560`、zoom `1..4`、hover `200/120 ms`、刷新保旧图与摘要。
- owner：strict protocol/projector → ACL-safe Kernel read model → Human application/HTTP/SDK →
  reload-safe Agent relationship surface。Direct/control/archived/不可读 Room 在服务端排除，浏览器不跨 Room 拼图。
- evidence：完整 `npm run check`、format、diff、trusted build、0 dependency vulnerability、Chrome/
  Firefox desktop + `390×844` 均通过；Web `169/169`、parity `34/34`。正式 active work 为零，
  787,615,744-byte 一致性备份为 `pre-member-graph-20260902T082518Z`；旧 PID `59686`
  优雅退出，新 PID `9820` 在 4173 online。
- formal browser：正式 ACL 数据为 `1 Human + 2 Agent / 3 edges`；viewBox、200 ms hover、
  Escape、wheel zoom、pointer pan、reload、Agent detail 返回与 mobile 返回均实测；390 页
  `scrollWidth=390`，console error/warn 为 0。
- evidence level：`C/A/L/D` 完成；`R` 仅覆盖可证明的 Raft 发布物合同。

### P4.2 Agent 创建者与外部身份（P4.2a `C/A/L/D`；P4.2b 设计闸）

- upstream：冻结 Raft `AgentDetailPanel-DKwoNvgK.js`、`HumanDetailPanel-DvWNsDz9.js`与 `index-BoAC7nSE.js`；完整 hash、组件分支和官方 External Agent 合同见 [P4.2 合同](./2026-09-02-agent-creator-and-external-identity-contract.zh-CN.md)。
- 已关闭的 canonical 反例：资料页不再从 current revision 把最后修改者当创建者，而是从 revision 1 读不可变 creator；created Agents 是 Kernel ACL-safe read model，不由浏览器扫全目录猜测。
- reuse class：Raft 资料区/row/click/empty 的 structural port；typed identity 和 revision-1 query 是 RAH local-first glue。Multica owner/invoke 权限没有与 creator 身份混合，避免引入第二套 ACL 真相。
- evidence：package `782` 项（`780` pass / `2` opt-in skip）、Web `171/171`、回调 `34/34`、Chrome 真实门禁、Firefox 150 desktop + `390×844`、format/build/audit 通过，依赖漏洞 `0`。移动入口 refinement 的 route 定向 `7/7` 与 Web typecheck 通过。`C/A/L` 完成。
- deployment：原有 Runtime terminal proof 后 active work 为零；761 MB 一致性备份位于 `pre-p42-creator-20260902T091600Z`，旧 PID `9820` 优雅退出，新 PID `21710` 在 `4173` online。正式桌面与 `390×844` profile deep link 重载、creator、created Agents 空态、无横向溢出和空 console 均通过，`C/A/L/D` 完成。P4.2b 继续禁用，直到 device authorization、可撤销凭据、purpose 门禁、content-free wake 和 external-status 有可靠 Raft Server/CLI 来源。

### P4.3 Agent Apps 授权投影（`R/design`，未解锁施工）

- upstream：冻结 Raft `AgentDetailPanel-DKwoNvgK.js::fc` 的 list/filter/loading/error/empty/card/revoke/reload 合同。
- single-owner audit：RAH 现有 Human/Host/Worker token、managed MCP、CLI login、Skill、Agent App Inbox 均不是 Agent OAuth client grant。
- Multica：Composio 的 allowlist intersection、account pinning、secret/non-secret 分离可供未来工具授权监督，但语义是 Agent 使用外部工具，不是 client 使用 Agent 身份；本批拒绝移植。
- gate：P4.2b 与 P4.3 必须共享 durable client、scope enforcement、generation/revoke、审计 owner；前置未满足时 Apps tab 保持真实 unavailable。证据仅 `R/design`，没有 `C/A/L/D`。

### P4.4 Agent 自定义图片头像（`C/A/L/D` 完成）

- upstream：冻结 Raft `AgentDetailPanel-DKwoNvgK.js` 的 `Mt`、`Me`、`sa` 和 profile avatar picker；上传前 5 MiB 门禁、multipart、成功 reconcile、失败内联、input reset、默认/官方头像与 Escape/focus 合同均有精确发布物证据。
- reuse：没有新建 Agent 文件服务。直接复用既有 `ProfileImageStore` 的认证、MIME/内容一致性验证、5 MiB、内容寻址、0600/0700 权限和原子 rename；Agent profile schema 只新增合法 upload key，继续拒绝 URL 和本机路径。
- owner：profile image transport/store 只拥有不可变 bytes；`agent.manage/update_profile` 拥有 ACL/revision/idempotency；统一 `AgentAvatar` 拥有所有 Agent 图片/pixel/status 渲染；picker 只编排上传后 profile save。
- failure-first：protocol、上传顺序/失败、组件 input/占位和 Kernel 重启持久化均先有失败用例；独立审计夹具暴露的 extracted-function 新依赖也被回归收口。
- evidence：packages `787 pass + 2 opt-in skip`，Web `174/174`，parity `34/34`；Chrome 和 Firefox 均真实选择 PNG、保存与刷新恢复，正式 4173 双浏览器只读验证 desktop/390、Escape/focus 和零 console error。773 MiB 迁移前备份两个 DB 均 `quick_check=ok`，最终监听 PID `41805` online；`C/A/L/D` 完成。
- deliberate defer：切回官方头像已经删除 canonical 引用，但不物理删除可能被 revision/其他主体共享的内容寻址 blob；引用安全保留期与 GC 没有完整合同前保持延期。
