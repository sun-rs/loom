# Raft ↔ RAH OS 独立第三方双边审计

日期：2026-08-29\
审计角色：独立第三方审计员（未采信主 Agent 结论，原报告仅作为待证伪 claim matrix）\
官方环境：`https://app.raft.build/s/hakasemac`（已登录、只读复核既有审计对象）\
本地环境：RAH OS real local CLI fixture，Web `http://127.0.0.1:4187`\
主要桌面视口：`1280×720 / DPR 1`；补充移动视口：`390×844`

## A. 独立结论

### A.1 是否形成核心闭环

**形成了一个真实但仍偏窄的核心闭环。** 本轮独立启动 real local CLI fixture，并在真实浏览器中完成：

1. 新建 Channel、填写描述、加入 OpenCode；
2. Human 发频道消息，真实 OpenCode canonical 回复 `CHANNEL`；
3. 普通消息创建 Thread，真实 OpenCode 在 Thread 回复 `THREAD`，deep link 与刷新恢复成立；
4. Human↔OpenCode Direct Room 创建，真实 OpenCode 回复 `DIRECT`，刷新恢复成立；
5. Human 创建 Task，真实 OpenCode 认领、开始、读取仓库 `package.json`、写 progress、submit `rah-os`；
6. Human 最终成功确认完成；刷新后 Chat 根消息和 Task board 均保持 `completed`；
7. 将 OpenCode 移出 Channel 后发送新消息，等待 15 秒仅保留 Human 消息，没有 Agent 回复；重新加入成功；
8. OpenCode 暂停、恢复的 canonical UI 状态均收敛。

以上结果不是静态 HTML，也不是 Fake CLI。执行者是本机 `OpenCode · native local server 1.18.22`。不过该 Agent 配置显示为 `Runtime 默认 / default`，因此本轮只能证明“真实 OpenCode 调用链”，**不能把它提升为已独立证明 `DeepSeek V4 Flash` 的门禁**。

### A.2 是否可宣布整产品收口

**不能。** 与 Raft 官方真实页面逐项对照后，RAH OS 仍缺少或明确禁用了 Human Activity/Inbox、全局 Search、Notifications、Files/attachment/reaction/bookmark，Agent 创建后的 onboarding/inbox 自治、完整 Computer 操作和远程 Host 管理也未在本轮浏览器中成立。Agent 页面虽有 Runtime/Model 配置和暂停/恢复，但重启/重置、诊断、报告、删除等大量控件仍 disabled。

此外，本轮发现一个直接影响 Human Task 验收可信度的静默交互故障：在 Task Thread pane 打开时，`确认完成`按钮显示为 enabled/visible，点击返回成功但不产生任何 UI 状态、错误或 canonical 变更；关闭 Thread pane 后同一操作才立即成功。核心协议最终正确，但 Human 无法判断第一次点击为何无效。

独立评级：

- Room/Direct/Thread/真实单 Agent CLI/Task 最小链：**pass**；
- 多 Agent 真实并发、Agent 自治、Human 工作台、完整资源/Computer 产品面：**partial/fail**；
- “高度等效 Raft 的本机正式产品”：**尚未收口**。

## B. 逐模块证据矩阵

| 模块                                     | Raft 官方浏览器证据                                                                                                  | RAH OS 浏览器/后端真实性                                                                                                                                                          | 判定                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| Channel 创建/描述                        | 既有 `parity-core-20260829`，ID `ca806598-6298-4b05-bf26-3ec882689449`；设置抽屉显示描述、公开性、1 Human + 3 Agents | 本轮新建 `independent-audit-20260829`，Room `room_c3cc080c-3111-4b3e-ab07-18a417b4b305`，描述 `Independent bilateral core audit`；reload 保留                                     | pass                                |
| 频道真实回复                             | 官方既有 Human 消息有 Alice/Kimi/ParityAuditorA 多 Agent 回复                                                        | Human `...reply exactly CHANNEL.` → real OpenCode `CHANNEL`，约 10 秒                                                                                                             | pass（本轮仅独立证明一个 real CLI） |
| 成员投递范围                             | 官方设置可查看和管理 Agents                                                                                          | 本地移出 OpenCode 后标题人数 `2→1`；发送 `Independent removed-member scope check...`，15 秒 article 数始终为 4，无 Agent 新回复；重新加入后 `1 Human + 1 Agent`                   | pass                                |
| Direct Room / 私聊                       | 官方 Agent 更多菜单进入 DM；既有真实 Agent 回复                                                                      | 本地 Agent Chat → `给 OpenCode 发消息`，Direct Room `room_dbc3e1d2-169b-4653-9fc5-6ade8abdeab9`；Human 请求 → `DIRECT`；reload 保留 2 articles                                    | pass；入口与官方不同                |
| 普通 Thread                              | 官方普通消息 hover/“在消息列中回复”；URL 带 thread，回复摘要回投主线                                                 | 本地 Human Thread 消息 → OpenCode `THREAD`；URL `?room=...&thread=room_c3...%3Amessage_e4c494a3-6c30-4138-8134-3f6843dadf39`；reload 恢复 Thread pane 和两条回复                  | pass                                |
| 浏览器历史                               | 官方有可恢复 thread deep link                                                                                        | 本地 forward 可恢复 Thread；但 back 从 deep link 返回此前旧 `127.0.0.1:4175/`，并非“关闭 Thread 留在当前 Room”，说明 openThread 可能没有形成用户期望的独立 history entry          | partial                             |
| Task 创建                                | 官方 Task #1/#2 均绑定 source message 与专属消息列                                                                   | 本地新建 Task #1 `Independent audit task: report package name`，source message `message_1228d9dd-214c-49f0-a9b3-8f39876e92dc`，真实 OpenCode 被分配                               | pass；表单协议不完全一致            |
| Task Agent 生命周期                      | 官方 #1/#2 可见 claim/执行/提交/完成和 Thread 回复                                                                   | OpenCode 真实写 progress `Inspected package.json at repo root; name field is rah-os.`、submit `rah-os`；Task Thread 恰有 2 replies                                                | pass                                |
| Human Task 完成                          | 官方 Human review 后看板进入完成                                                                                     | 本地最终完成并 reload 一致；但第一次在 Thread pane 打开时 enabled 点击静默 no-op，详见 C.1                                                                                        | partial / P0 UX                     |
| Chat Task anchor                         | 官方根消息显示 `#n @Agent`，消息列承载任务过程                                                                       | 本地完成后 reload，Chat root 显示 `Task #1 / completed`，Board `complete=1, submitted=0`；它来自 canonical Task projection，不是独立 UI 假标签                                    | pass                                |
| Agent 目录/资料                          | 官方 5 Agents、Human、七个详情 tab，资料含 Role/Computer/Runtime/Model/Skills/操作                                   | 本地 4 个真实本机 CLI 定义，七个 tab；OpenCode 显示 Runtime/版本/模型/effort；父子 Agent 和 Skill 明确未接入                                                                      | partial                             |
| Agent 模型/effort 配置                   | 官方 Agent 是 OpenCode / DeepSeek V4 Flash                                                                           | 本地设置列出 OpenCode 模型目录（含 DeepSeek V4 Flash 等），但当前为 Runtime 默认；当前模型没有发布可执行 reasoning 档位，只显示 default                                           | partial                             |
| Agent 创建/onboarding                    | 官方既有审计 Agent 启动后读 inbox、onboarding、自我介绍并处理待办                                                    | 本轮本地 Agent 是 fixture 预置；没有独立创建新 Agent 并观察 onboarding/inbox 自治                                                                                                 | insufficient                        |
| Agent 暂停/恢复                          | 官方支持停止、恢复、重启、重置                                                                                       | 本地 `暂停 Agent` 后目录显示 `已暂停`，`恢复 Agent` 后消失；重启/重置在资料页 disabled                                                                                            | partial                             |
| Agent Activity                           | 官方活动包含 received/thinking/tool/output/freshness/draft/idle 等丰富结构                                           | 本地真实 OpenCode 活动来自结构化 Provider 事件，能看到 thinking/bash/reply/run complete；但仍有连续重复“模型请求已开始”和 `bash {}` 噪音                                          | partial                             |
| 全局 Search                              | 官方搜索 `parity-core-20260829` 得到 6 条结果，含频道、主消息和消息列，并有发送者/范围/频道/时间/相关度筛选          | 主 rail `搜索（待接入）` disabled；频道 search 也 disabled                                                                                                                        | fail                                |
| Human Activity / Inbox                   | 官方 14 active、2 unread，含 Channel/DM/Thread/Task，支持全部/未读/提及和处理                                        | 主 rail `动态（待 Inbox）` disabled；Agent trajectory 不能替代 Human Inbox                                                                                                        | fail                                |
| Notifications                            | 官方通知 overlay 可打开，空态为“暂无通知”                                                                            | 本地主 rail `通知（待接入）` disabled                                                                                                                                             | fail                                |
| Files / attachment / reaction / bookmark | 官方 Channel/DM 均有 Files、附件、回应、收藏等入口                                                                   | 本地 Files/附件明确 unavailable/disabled，消息无同等动作                                                                                                                          | fail                                |
| Computer                                 | 官方自动选择 Mac-Studio，显示 OS/版本/Runtime/Agent/诊断/恢复/升级/删除前置条件                                      | 本地须手动选 Host；显示 Host ID、4 Runtime、Offer、Executable、Profile 与 4 Agents；`添加计算机` disabled，无 OS/产品版本/远程注册/操作                                           | partial                             |
| 桌面 UI                                  | 官方与本地均在 1280×720 检查；官方 splitter 是 `cursor-col-resize` 的非语义 div                                      | 本地结构、导航和卡片已接近 Raft；本地 splitter 反而有 `separator` 语义；仍存在抽屉关闭语义/历史导航等差异                                                                         | partial                             |
| 390×844 PWA                              | 本轮未对官方移动端重复全部流程                                                                                       | 本地 Channel 页面 `clientWidth=scrollWidth=390`，无页面级横溢出；移动 rail 和 Agent list/detail 可操作，Agent tab strip 被压缩/横向裁切但页面整体不溢出                           | partial                             |
| canonical 恢复                           | 官方既有对象可刷新回查                                                                                               | 本地 Channel/DM/Thread/Task 均经 browser reload 恢复；未在本轮杀死 daemon 后用同一 state dir 重启复测，故只能证明 daemon session 内 canonical 恢复，不能单凭此证明 crash recovery | partial                             |

## C. 问题清单（P0/P1/P2）

### C.1 P0：Task `确认完成`在打开 Task Thread 时静默 no-op

可复现对象：本地 Task #1，source message `message_1228d9dd-214c-49f0-a9b3-8f39876e92dc`。

步骤与 DOM/canonical 证据：

1. Task 已由 OpenCode submit；Task board DOM 为 `待确认 1`、card state `submitted`、按钮 `确认完成`，按钮 enabled/visible。
2. 保持 Task Thread pane 打开，点击 `确认完成`。浏览器驱动返回成功。
3. 等待 1.2 秒：DOM 仍是 `待确认 1 / submitted / 确认完成`；没有 inline error，console 结果为空。
4. reload：Task board 仍是 `submitted`；Chat source message 仍按 canonical Task projection 显示 submitted。说明第一次操作没有产生持久化命令结果，不是 UI 先乐观完成后回滚。
5. 关闭 Thread pane，重新进入 Tasks，点击同一按钮：t=0 DOM 即变为 `待确认 0 / 完成 1 / completed`；250ms、2.25s、6.25s 采样均稳定。
6. reload：Chat root 为 `Task #1 / completed`，Board `complete=1, submitted=0`。

判断：这是**上下文相关的 enabled action 静默 no-op**，不是 durable projection 最终不一致，也不是普通 reconciliation 延迟。若是延迟，第一次点击应最终出现 receipt/state/error；实际 reload 仍 submitted。代码上 card 直接显示 `task.state`，完成命令成功后只 `setReload`，所以第一次状态不变对应“命令未生效或交互未到 handler”，不能解释为另一个 local UI payload 覆盖 canonical 状态。

建议门禁：新增真实浏览器回归——Task Thread 打开时从 Board 点击确认，必须观察 pending 文案、typed receipt 或可见 error，并在 reload 后完成；任何 enabled 控件不得无声返回。

### C.2 P0：Human 工作台三条日常导航主链缺失

- Search disabled；
- Human Activity/Inbox disabled；
- Notifications disabled。

这不是装饰功能。Raft 中它们把跨 Channel/DM/Thread/Task 的工作重新聚合，并提供精确 deep link。没有它们，真实 Agent 工作越多，Human 越难发现和验收结果。

### C.3 P0：Agent 创建后的自治启动未独立成立

本地已经能创建/配置 Definition，也能被消息唤醒；但本轮没有看到 Raft 等价的“创建后启动 → inbox check → onboarding → freshness check → 主动处理”的浏览器业务结果。Agent Host 真正执行前，不能以表单可提交代替自治闭环。

### C.4 P1：Task/Thread 浏览器 history 不完整

Thread deep link 和 reload 恢复已通过，但 back 会离开当前 Room 回到此前旧页面，而非仅关闭 Thread。应明确协议：open 是 pushState 还是 replaceState；若是用户可见子页面，应让 back 关闭 pane、forward 重开。

### C.5 P1：Agent Activity 信息密度仍低于官方

真实事件存在，但重复“模型请求已开始”和 `bash {}` 降低可读性。应在不破坏 trajectory 原始证据的前提下，为 Human projection 合并重复 status，并为 tool 显示有意义的摘要/结果；不能读取或暴露私密思维链。

### C.6 P1：Computer 仍主要是只读目录

Host/RuntimeProfile/Offer/Executable/Agent binding 均是真实数据，但 remote Computer、添加、诊断、恢复、升级、重启及 typed receipt 没有在浏览器形成产品链。

### C.7 P1：Agent 操作与资源动作缺口

Agent restart/reset/diagnostics/report/delete disabled；Files、attachment、reaction、bookmark 未接入。对 Raft 体验等价而言均是明确缺口。

### C.8 P2：频道设置抽屉的关闭命名/行为不直观

DOM 中 `关闭频道详情与设置`是背景按钮；Playwright 对该语义按钮执行普通 click 时，点击中心落在 panel 区域，抽屉不关闭且无错误；按 Escape 可关闭。官方抽屉有明确 X。应给可见 close button 独立语义，背景只承担 backdrop click。

### C.9 P2：移动 Agent tab strip 压缩

390×844 页面没有整体横向溢出，但七个 Agent tab 超过可视宽度，截图右侧被裁切。若设计为横向滚动，应提供可发现性；若不是，则需响应式压缩。

## D. 对原报告 claim matrix 的独立判定

待证伪报告：`docs/audits/2026-08-29-raft-bilateral-browser-verification.zh-CN.md`。

| 原 claim                                    | 独立判定                           | 说明                                                                                                                 |
| ------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| 核心聊天室、私聊、Thread、Task 执行主链成立 | **confirm**                        | 本轮用新的 4187 fixture 和真实 OpenCode 再次完成 Channel/DM/Thread/Task                                              |
| 创建 Channel、描述、成员范围 pass           | **confirm**                        | 本轮创建新 Room，并独立做移出、无投递、重新加入                                                                      |
| 多 Agent 频道 pass                          | **insufficient**                   | 官方 DOM 有多个真实 Agent；本轮 RAH OS 只独立调用一个 real OpenCode，未把旧 Fake 双 Agent 提升为 real multi-CLI 证据 |
| Direct Room partial，仅入口不同             | **confirm，评级可提升为结果 pass** | 本轮 Human↔OpenCode 创建、真实回复、reload 均成立；产品入口仍不同                                                    |
| Thread deep link/reload 已修复              | **confirm**                        | 精确 URL 与 reload pane/replies 复验通过；但 back/forward history 仍 partial                                         |
| Task Agent 生命周期 pass                    | **confirm**                        | 实际读取 package.json、progress、submit，非固定 Fake 输出                                                            |
| Human 审核 pass                             | **contradict（干净 pass 不成立）** | 最终 canonical complete 成立，但 Thread pane 打开时 enabled 点击静默 no-op                                           |
| Task 讨论只产生一个绑定 Thread              | **confirm**                        | 本地 Task #1 只有一个 anchor/thread 和两条任务回复                                                                   |
| Agent 创建 partial                          | **insufficient**                   | 本轮未独立创建新 Agent；只检查现有 fixture 定义和设置 surface                                                        |
| Agent 停止/恢复 partial                     | **confirm**                        | 暂停/恢复实际操作成功；restart/reset 仍缺失                                                                          |
| Agent Activity chunk 已收敛                 | **partial confirm**                | 没有单字符刷屏，但仍有重复 status 和空 tool 参数噪音                                                                 |
| Search / Human Inbox / Notifications fail   | **confirm**                        | 三个 rail 入口仍 disabled                                                                                            |
| Computer partial                            | **confirm**                        | 数据真实但须手选，操作和远程管理缺失                                                                                 |
| Files/reaction/bookmark/attachment fail     | **confirm**                        | 本轮 DOM 仍 disabled/unavailable                                                                                     |
| RAH OS 全产品尚未收口                       | **confirm**                        | P0 产品导航与 Agent 自治仍缺                                                                                         |

## E. 对 Task/Thread 涌现行为的独立判断

Raft 截图中的 `#1/#2 @Agent` 与多个“消息列”不是 CSS 随机触发。本轮官方 DOM 复核显示：

1. 普通消息只有用户/Agent 显式“在消息列中回复”才形成普通 Thread；
2. Task 根消息带任务编号/负责人，Task progress/submit/review 进入绑定消息列；
3. 既有 Parity Task #1 执行后，Agent 又显式创建 Task #2 并指派 Alice，同时 Agents 还显式开普通 Thread 协调，因此视觉上会连续涌现多个编号和消息列；
4. 官方 Task board 最终显示 complete=2，说明 #2 是业务对象，不是 hover/渲染伪影。

因此，触发“缺乏规律”的根因是**Agent 可调用业务命令带来的自主级联**，而不是浏览器随机行为。Raft 的结果可复现其能力，但不应照抄其噪音：一个 Task 诱发新 Task、多个 Thread 和跨 Agent闲聊，可能淹没主 Channel。

RAH OS 当前更安全的部分是 `taskId + sourceMessageId + threadId` 唯一绑定、普通 Thread 显式创建、Inbox 不推断 Task。不过 Worker Application Service 当前只公开 task get/claim/start/progress/release/block/request-input/submit，不包含 Agent `task.create`。这避免了不可控级联，也造成 Raft parity 缺口。

建议不是自然语言推断，而是新增**policy-gated explicit `worker task create`**：要求 actor/Room/parentTaskId/idempotencyKey/basedOnRoomSeq/title/assignee，原子建立新 source message + Task + Task Thread；Workspace policy 可关闭、限额或要求 Human review。没有显式 command 就绝不创建。

## F. 下一阶段最小收口范围与拒绝照抄点

### F.1 最小收口范围（按顺序）

1. 修复 Task Thread 打开时 Human complete 静默 no-op；所有 mutation 统一 pending/receipt/error/reload 门禁。
2. 完成 Human Activity/Inbox、Search、Notifications，共用 canonical projection 和精确 Room/Thread/Task deep link。
3. 完成 Agent 创建后的 activation/onboarding/inbox 自治，并在真实 OpenCode 与至少另一个真实 CLI 上做浏览器验收；模型/effort 必须在 UI 和 RunAttempt 证据中冻结，不得用 Runtime 默认代替具体模型声明。
4. 完成 Agent restart/reset 与 Computer direct/remote/doctor/recovery/upgrade typed commands；enabled 控件必须有 receipt/error/refresh recovery。
5. 完成 Files/attachment/reaction/bookmark，并保证 Channel/Direct/Thread 共用同一协议。
6. 固化 desktop 1280×720 与 PWA 390×844 双边浏览器回归，补 Thread history 和移动 tab 可发现性。

### F.2 明确拒绝照抄 Raft 的地方

- 不把 Provider session/stdout/thinking 当业务真相；
- 不从自然语言、Notification 或 Inbox 推断 Task/Thread；
- 不复制 Task→Task→多个 Thread 的无界自主级联，必须显式命令、policy、幂等和因果游标；
- 不牺牲 canonical participant identity、input acceptance、Room membership delivery、Task/RunAttempt 分离和 crash recovery；
- 不复制官方 splitter 缺少语义角色等无障碍缺陷；
- 不因 UI 像 Raft 就伪造未接入 handler，disabled/unavailable 比假动作正确，但正式收口前必须补齐核心入口。

## G. 审计对象、命令与未清理说明

### G.1 官方对象（本轮只读复核，未新增、未删除）

- Workspace：`hakasemac`
- Channel：`parity-core-20260829`
- Channel ID：`ca806598-6298-4b05-bf26-3ec882689449`
- Agent：`ParityAuditorA`
- Agent ID：`c0af3b25-898c-433a-858c-1c9887d7f04c`
- DM ID：`eeeb5b7d-a7df-4f40-b273-bcbf8c4ee1bf`
- Task #1：`Parity task A: produce one verified next step`
- Task #2：`Parity task B: thread-scoping check`

这些对象由此前授权审计保留；本轮不执行删除，也未写入账号凭据、cookie 或 token。

### G.2 本地对象（临时 real CLI fixture）

- Workspace：`workspace_c714aee6-3d92-4fd5-80c3-3f5ecfc61146`
- 初始 Room：`room_5e6905ae-dec9-4642-be75-b25cbe418839`
- 审计 Channel：`room_c3cc080c-3111-4b3e-ab07-18a417b4b305`
- Direct Room：`room_dbc3e1d2-169b-4653-9fc5-6ade8abdeab9`
- Thread root message：`message_e4c494a3-6c30-4138-8134-3f6843dadf39`
- Task #1 source message：`message_1228d9dd-214c-49f0-a9b3-8f39876e92dc`
- Agent：fixture 预置 `OpenCode`（native local server 1.18.22，Runtime 默认）

本地对象属于隔离 fixture state；没有删除产品或用户正式数据。审计结束时 fixture 进程已关闭。

### G.3 运行过的主要命令

```bash
cd /Users/sun/Code/repos/rah_os
RAH_WEB_PORT=4187 npm run dev:web:local-cli-fixture
```

此外仅运行 `sed`/`rg`/`git status --short` 读取文档、源码和工作树状态；未运行破坏性命令，未修改产品代码，未用 GPT-5.6 Ultra，未把绿色测试当作浏览器证据。

## H. 证据等级说明

- **官方 Raft：** 登录会话中的 live DOM、可见页面和既有真实业务对象；本轮未重新创建官方对象，因此其“命令发出时刻”是只读历史证据。
- **RAH OS real CLI：** 本轮新启动本机 OpenCode、实际发送消息并等待业务回复；Channel/DM/Thread/Task 都是新产生结果。
- **Fake fixture：** 本轮未用 Fake CLI 作为任何 pass 依据。
- **后端 canonical：** 通过 mutation 后状态、reload 恢复和成员投递范围观察；未独立做 daemon kill/restart 同目录恢复，因此 crash recovery 标为 insufficient/partial。
- **代码阅读：** 仅用于解释协议 owner 和能力边界，不替代浏览器 pass。

最终结论仍为：**RAH OS 已有真实 Room-first 单机协作核心，但距离可宣布“Raft 等价正式产品收口”仍有明确 P0；下一轮应停止扩大静态页面，先修 Human Task 操作可靠性并闭合 Human 工作台与 Agent 自治。**
