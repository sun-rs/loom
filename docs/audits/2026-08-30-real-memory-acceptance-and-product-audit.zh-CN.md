# 真实 Agent 记忆验收与 Raft / Multica 产品对照审计

日期：2026-08-30。对象：`rah_os` 当前工作树，基准 HEAD `72c75938ebeb2e552b34b654cfb763271b224b41`。工作树已有大量未提交改动，HEAD 不能代表本次全部运行代码。本轮未修改生产实现、未提交、未部署或重启用户在线服务。

## 1. 最终裁决

**普通 Agent 文件记忆的形成、跨新会话召回、反向对照和跨 Provider 延续，本轮真实验收通过；整个 Raft 等效产品尚未收口。**

- 本轮由浏览器触发 7 轮真实 Agent 执行：OpenCode 1.18.22 / `deepseek/deepseek-v4-flash` / `max` 六轮；Kimi 0.38.0 / `kimi-code/k3` / runtime 默认 effort 一轮。一轮含多次模型/工具往返，不是总共只调用了七次底层模型 API。没有 Ultra、Claude 或 Codex 付费请求，没有失败后换题重试。
- 每次都取得 canonical Room 回复和 terminal RunAttempt；总计 7 次成功退出，0 个误建 Task。退出本身不作为记忆正确的判据，答案、文件与反向对照另外核实。
- Raft 官方已登录 Web 与本地 Web 使用同一 Chromium、1440×1000 CSS px、DPR 1 核对。另做本地 390×844 交互和刷新恢复；不是 iPhone 真机或 Firefox 验收。
- Raft 官方 Computer 本轮离线，能核对历史内容、页面和菜单，不能证明其本轮真实 Agent 执行。Multica 为固定源码审计，没有启动其服务或执行其测试。不能把三方证据等级混为一谈。
- **纠正旧结论：Multica 最新核对源码已有 Hermes 的 Agent 级跨任务记忆实现，不能再称为“只有提案、没有记忆”。**

可持久复核的本轮证据：[`result.json`](./evidence/2026-08-30-memory-real/result.json)、[实验方案](./evidence/2026-08-30-memory-real/experiment-plan.md)、[最终索引](./evidence/2026-08-30-memory-real/agent-a-memory/MEMORY.md)、[最终笔记](./evidence/2026-08-30-memory-real/agent-a-memory/notes/heron-lamp-project.md)。更多双边截图与运行快照保留在 `/tmp/rah-memory-real-4W9u3d/evidence/`，该临时目录不是永久归档承诺。

## 2. “自制维护”与 Raft 自治维护

此前的“自制维护”具体指 RAH 曾计划另设独立维护上下文、固定五分钟窗口和新的管理执行路径。该方案已暂停，不能描述为已经采用或已经有效。

Raft 的已提取路径是：检查索引大小 → 产生 `memory_size_hint` → 能力允许时通知当前进程；对于可信的 idle Agent，以 restart snapshot 复用普通启动流程，让原 Agent 整理自己的索引和笔记。不是由一个旁观模型定时总结全部聊天，也不是每次 idle 都调用模型。Human stopped 不等于 idle。[官方生命周期说明](https://docs.raft.build/features/agents/lifecycle/)

RAH 现在已经有普通 Run 中的 App Inbox check/ack/recheck；**本机与 remote composition 的 wake 仍返回 false**。因此本次成功不包括空闲自动整理。实验的五分钟观察上限只是限制测试调用，不是重新引入五分钟维护产品设计。

源码定位：`packages/daemon/src/daemon-application-support.ts:58`、`packages/agent-host/src/remote-runtime-profile-composition.ts:95`；详细上游映射见[剩余能力计划](../product/agent-memory-raft-completion-plan.zh-CN.md)。

## 3. 实验如何排除“假记忆”

### 隔离与控制变量

- 使用新建 fixture，Web 4189、独立 daemon、临时 SQLite、空项目目录和全新 Agent memory；未使用生产 Room 或生产记忆。
- Agent A 的 identity 始终为 `principal_4796de1b-9fb6-4192-9750-28ce39ba1a06`。从 OpenCode 切换 Kimi 时只变更 Runtime/model/effort，名字、人设、记忆 owner 不变。测试名仍为 OpenCode，不代表最后一次仍运行 OpenCode。
- Agent B 经真实网页创建，使用与 A 相同的 OpenCode/model/effort/角色，不加入训练 Room，不取得 A 的记忆目录。
- Harness 不代写记忆正文。训练、更正、提问、创建频道/私聊、创建 Agent、切 Runtime 都由网页执行；后台只读取证据，或在全部 Run terminal 后对隔离测试 A 执行受控 continuity invalidation 和可恢复的记忆目录移走/恢复。
- 新 DM/Channel 不含训练历史。召回问题只问项目名及所需字段，不携带暗号、颜色、限制条件；Provider 原生会话 ID 另外记录。
- 普通 Provider 账号用于获准的真实调用，未把共享 OS 用户/full-access 当成安全沙箱，也未证明 Provider 自有全局记忆被隔离。

训练的是虚构“鹭灯计划”：初始暗号 `LUMEN-6724`、海盐绿、仅室内演示/禁止户外。更正后暗号为 `LUMEN-9047`，其余事实不变。完整提问和 canonical 答复在 result.json，项目目录验收后仍为空。

### 实际结果

| 实验          | 关键控制                                | 浏览器与后台结果                           | Run 全程耗时 |
| ------------- | --------------------------------------- | ------------------------------------------ | ------------ |
| 1 形成        | 全新 A，模型亲自写文件                  | 短索引及 notes 均形成，Room 确认三事实     | 25.910s      |
| 2 新 DM 召回  | A；清除 continuity；新 Provider session | 三事实正确，含禁止户外；实际读取索引及正文 | 15.414s      |
| 3 不同 Agent  | B；同模型/effort；空记忆                | 明确不知道，不猜测                         | 23.824s      |
| 4 同 A 无文件 | 新 Channel/session；可恢复移走 A 原记忆 | 三项均不知道                               | 18.892s      |
| 5 恢复原文件  | 原文件恢复；再换新 Channel/session      | 三事实重新答对                             | 22.307s      |
| 6 修正        | 明确更改暗号，其他不变                  | 索引及正文更新，旧值标为作废               | 22.978s      |
| 7 切 Kimi     | 同 A；Kimi 新 session；新 Channel       | 答对新值、颜色、限制，旧值不冒充当前事实   | 64.462s      |

这里是各一次的有界验收，不是“准确率 100%”或模型性能排名。耗时包含启动、工具调用、记忆写回和 terminal 收尾，不等于首字延迟。

最重要的因果证据是 **有文件答对 → 同 A 无文件不知道 → 恢复文件又答对**，而非 Agent 自称“我记得”。第二组原生 session `ses_fadd667b9ffebo7E4zn07A6PH6` 只有一个 user prompt，未含答案；工具记录确认完整小索引和 `notes/heron-lamp-project.md` 均被读取。无文件组原生 session `ses_fadd2f2b3ffebelRNRUHbz5Fa5` 读取的是无暗号的空种子。

第七组实际 Placement 选中 `local-cli-offer-kimi`、`kimi-code/k3`，原生 session 为 `session_e0910d9d-0653-4d40-ad7a-7a412397a088`，不是网页只改了标签。两个 RuntimeProfile 的固定 prompt 都包含当前 `buildAgentMemoryInstructions()` 完整产物。

边界：fixture 的 instruction/memory policy artifact 引用仍含测试占位 digest，不是正式 Artifact 内容解析证明。本轮验证的是实际 Runtime prompt、Agent 文件与 canonical 执行链；不能据此宣布所有 ContextManifest 引用均已实现内容寻址/分发。

两份较大的 OpenCode CLI export 在本轮管道输出中得到恰好 65,536 bytes 的非法 JSON，已在 result.json 标明 `invalid_json_from_cli`，未把它们算作完整读取轨迹；也未因此重跑付费模型。相应 canonical 回复、session 记录和阶段文件快照仍保留。Kimi 的证据为新 Placement/session、canonical 回复与文件更新，不冒称取得了与 OpenCode 相同格式的完整 export。

### 网页复核

- [1440×1000 Kimi 召回结果](./evidence/2026-08-30-memory-real/07-kimi-transfer-1440.png)：实际 Room 消息已到达。
- [390×844 刷新恢复](./evidence/2026-08-30-memory-real/local-memory-reload-390.png)：重新加载仍恢复正确 Room 和两条消息。
- [390×844 Memory 文件页](./evidence/2026-08-30-memory-real/local-memory-workspace-390.png)：可进入同一 Agent、查看索引和笔记；文档 scrollWidth=390，无页面横向溢出。
- 前五张原始本地截图使用自然视口 1049×1172/DPR2，仅作功能证据。发现后已统一双边 1440×1000/DPR1；所有文件名含 1440 的对照图和官方对照图才用于同尺寸判断。

## 4. 当前记忆体系的优点、限制与缺口

Agent 之间独立是产品原则，不将其包装成竞争优点。

### 已得到真实支持的价值

1. 身份不随模型更换：从 OpenCode/DeepSeek 换为 Kimi 后仍能使用同一套个人文件；不要求 Provider session 充当长期记忆。
2. 文件足够简单且可检查：最终 MEMORY.md **575 bytes**，正文 **1,261 bytes**；正文保存当前事实、旧值、来源、限制条件，而非原始聊天逐字存档。
3. 宿主不切碎或截断索引：本轮七份 receipt 均为 v2 / index_only，仅记录索引。receipt 的 scope 明示“materialized，不证明模型读取”；本轮另取工具证据补足读取验证。
4. 数据修正有效：旧暗号被明确标为作废，新 Provider 使用新值。用户可以从网页只读查看实际文件，避免完全不可见的黑盒。

### 本轮实际暴露的限制

- **索引并非严格只留路径。** A 的短索引也复制了暗号和事实摘要。它仍很小且符合 Raft 示例的宽松组织方式，但“索引=零正文”不是代码保证。本轮模型仍实际读取了 notes。
- **低价值内容可能被记住。** B 将一次“不知道”的问答写入 work-log，并在 Active Context 留痕；A 也记录了验收 Room/更正历史。不能据此立刻再加自创跳过清单，应先保持 Raft 基线、积累长期实例，确定是否真的影响检索和上下文。
- **575 bytes 不是总上下文成本。** 常驻 memory 指令、Worker 协议、业务同步和工具结果另外计入上下文。result.json 记录了固定 prompt 的字节数，未把字节当 token，也未宣称长对话压缩后必定重读。
- **整理质量依赖模型。** 本轮是单项目、少量事实。大量笔记、多项目同 cwd/多 cwd 同项目、相互矛盾来源、删除事实、长时间维护和压缩恢复均未做真实统计性验证。

### P1：Provider 原生记忆尚无统一受控策略

`generic-process-adapter.ts:1017` 继承宿主环境；`codex-app-server-driver.mjs:26` 启动子进程沿用环境。当前 agent-host/daemon 源码未找到统一的 Provider-native auto-memory 禁用/隔离配置。

因此“RAH 为不同 Agent 分目录”不等于“各 CLI 不会读取自己的全局记忆”，更不等于临时对话 hard memory-off。本轮没有重现跨 Agent 泄露，结论是**控制缺口与风险**，不是已证实泄露事件。不能靠再加一句 prompt 宣称解决。

建议复用 Multica 的 per-run/provider home 管理和原生记忆显式关闭经验，先按已安装 CLI 版本验证作用，再纳入默认策略；不修改用户全局 CLI 配置。不需为此另造记忆库。

### P1：配置与 idle 生命周期未闭合

- Cleaner 默认 64 KiB / 一小时；目前由 AgentDefinition 派生配置，缺少独立持久化 override 和可用的配置动作。`agent-memory-coordinator.ts:383` 附近可查。
- check/ack/recheck 不等于 idle wake；后者仍不可用。
- 个人 Memory 的 reset 与“重启 / 重置 Agent 执行会话”是两个动作。前者已有既有测试/浏览器证据，本轮只查看入口未执行破坏性 reset；后者当前资料页仍禁用。
- 临时无记忆会话尚未实现。关闭 cleaner 不会关掉文件读取、旧 Provider 上下文或原生自动记忆。

## 5. Raft 功能与界面的逐模块对照

“本轮实测”指这次实际页面操作；“既有证据/门禁”不等于这次重新完成所有业务流程。

| 模块                        | RAH 本轮真实结果                                                                 | Raft 本轮可见结果                                    | 审计结论                                                                                 |
| --------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 创建 Channel、增选成员      | 创建 3 个测试 Channel、设置 A 为成员、实际响应                                   | 创建入口、成员/频道设置均可见；未向官方写入测试 Room | RAH 主链可用；不是双边新建业务全等证明                                                   |
| 私聊                        | 创建 A/B 两个 DM，真实收发；刷新恢复                                             | 独立 DM 及 Chat/Task/Files、历史消息、线程入口       | 两人 Direct Room 主链成立；官方菜单更多                                                  |
| Chat / Thread / Task 边界   | 7 次记忆讨论均在 Room 回复，0 Task                                               | 历史普通回复、Task badge、线程预览可查看             | 支持简单讨论不误建任务；本轮未跑多 Agent 抢占/线程并发实验                               |
| 全局任务                    | 点击左侧任务仍显示当前 Room 名和 Room 任务 Tab                                   | 独立全局任务页，跨频道筛选、board/list               | **P1 实质差异**：App.tsx:1735、2063 只是 setTab("tasks")                                 |
| Room 任务                   | 筛选/看板/列表入口，测试 Room 为空                                               | 独立状态列、已认领/审阅任务                          | 原子 claim、Review/Closed 等以已有 Kernel 门禁为证，不将空态算业务全验收                 |
| Agent 身份/配置             | 网页创建 B；给 A 换 Runtime/model/effort，真实生效                               | 长期身份、内联编辑、Runtime/model/effort/mode/env    | 核心配置有效；完整管理操作和配置范围未等效                                               |
| Agent 资料视觉              | 外壳、分隔、Tab 基本同型                                                         | 当前官方页面作为同尺寸参照                           | 角色栏错误混入长人设文本，Computer/Runtime 混排；创建者对齐、状态排布、多个 Tab 图标不同 |
| Agent 动态                  | 能看到真实运行、公开输出及加载更早记录                                           | 完整历史工具动态、状态/折叠交互                      | 已接真实诊断，未做所有 Provider 全种类状态/分页端到端对齐                                |
| 全局动态                    | 按钮“动态（待 Inbox）”禁用                                                       | all/unread/mention、thread 预览、标记已读            | **P1 未接入**；不能用 Agent 动态替代                                                     |
| Agent 工作区/记忆           | 真实文件列表、大小、只读内容、reset 入口                                         | Agent 文件浏览器；离线时加载失败                     | RAH 记忆可视有效；不是通用工作区文件操作 1:1                                             |
| Search                      | 全局/频道搜索禁用                                                                | 完整页面、发送者/范围/时间等筛选，输入后出现结果     | **P1 未接入**，不属于静态样式差                                                          |
| Human Inbox / Notifications | 可打开真实空态；InputRequest 有此前浏览器闭环和当前单测                          | NotificationCenter、已处理状态；本轮为空             | Human InputRequest 已有功能，不等于通用通知/已读/所有 deep link 完成                     |
| Files / 附件                | Files 明示未接入，composer 附件禁用                                              | 上传/拖入提示、Files Tab                             | **P1 未接入**；不能把已有 Task Review 协议误报为 Files 已完成                            |
| MCP / Apps / Skills         | MCP 目录页可见，本 fixture 无预配置 executor，所以新增禁用；Apps/Skills 更不完整 | 配置目录/添加入口、Agent Apps/MCP 页                 | 已有 typed MCP transport 与配置前提；尚不能由 Web 完成全部连接开户/secret/OAuth          |
| 提醒、自治、restart/reset   | 提醒合同待接入；执行重启/重置、删除等禁用                                        | Reminders 与启动、重启/重置、诊断、删除操作可见      | 长任务工作站管理体验未闭合；本轮未点击官方破坏性操作                                     |
| Computer                    | 真实发现 4 个 CLI/Offer、5 个 Agent；已验证切 Kimi 后绑定显示改变                | 计算机名称/描述、运行时、Agent、安装/管理操作        | RAH 仍主要是技术库存详情；新增 Computer 禁用，多机产品链未完                             |
| Settings / Admin            | 多数条目 disabled；LAN 和 MCP 为已有独立 slice                                   | 语言/外观/通知/服务资料/管理/应用等页面              | 本机版不需要收费账户，但必要设置与管理不能由占位页代替                                   |
| LAN / PWA / 交付            | 当前 fixture 是 loopback；LAN 页正确提示需正式 HTTPS edge；移动 CSS 与刷新通过   | 官方响应式 Web 可访问                                | 既有 HTTPS pairing/SEA 门禁不等于本轮真机、重启、证书信任或签名交付验收                  |

### 视觉裁决

在同尺寸的 Agent 资料截图中，黄色 rail、约 62px 顶栏、约 304px 主内容起点和 Tab 横线已基本同型，不能再说“只是任意 mock 布局”。但仍明确看到：RAH 资料/应用/MCP 使用代码括号式图标，官方分别是不同语义图标；角色、人设、Computer 的信息归属不同；创建者和在线状态位置不同；本次新 Agent 使用相同 fallback 头像；多项操作只有灰色禁用按钮。

证据：临时目录中的 `local-agent-profile-1440.png` / `raft-agent-profile.png`、`local-tasks-1440.png` / `raft-tasks.png`、`local-computer-1440.png` / `raft-computer.png` 等，已打开图片检查，不仅检查 DOM。

**没有进行全组件 hover/focus/press 矩阵或像素差分；不能宣布 1:1、100% 或给出虚假的高分。** 本轮优先确认行为、信息归属与实际结果。相同 CSS 令牌只能约束规格，不能自动保证 React 结构、状态和对象语义相同。

## 6. Multica 当前源码 PK 与复用裁决

固定版本：`multica-ai/multica@15280617bc264e367ca9c5e5e5cefdb0988246b7`，本地克隆 `/tmp/rah-memory-real-4W9u3d/multica`。不是将旧 issue/proposal 当最新实现。

| 项目                         | 当前源码证据                                                                                                                                | 对 RAH 的裁决                                                                                                |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Hermes 跨任务记忆            | `execenv/hermes_memory.go` 将 memories 挂到 profile/Agent 持久目录，迁移先复制再原子发布、失败不丢数据                                      | 已有真实实现，应更正旧否定结论；其作用域仍受 Hermes profile 影响，不等于本次验证的跨 Provider 同身份文件体系 |
| Hermes 边界                  | 源码明确留有 skill-less host-home 路径；同 Agent 并行任务写同文件存在 last-writer-wins                                                      | 不应整段照搬并据此删除 RAH 单 Agent 串行 lane；迁移/回退可借鉴，不能把注释中的 isolation 当沙箱证明          |
| Codex 原生记忆               | `execenv/codex_memory.go` 默认在任务私有配置中关闭 memories 功能及 generate/use；显式环境开关允许 opt-in                                    | **优先借鉴的安全策略**：限制第二个不可控记忆源；按 CLI 版本实测，不改用户全局配置                            |
| Chat / 历史                  | `server/pkg/db/queries/chat.sql`、`handler/chat_history.go` 有持久 ChatSession、自己的消息历史、(created_at,id) 分页，IM history scope 校验 | 可复用分页/缺失 resume 后恢复/已读设计；不要把 ChatSession 升为 RAH Room 业务真相                            |
| Inbox                        | `server/pkg/db/queries/inbox.sql` 有持久已读/归档、分组、anchor；归档分组有界                                                               | 适合补全 RAH 通用 Notifications 的对象/分页/目标定位；仍需接 RAH 的 ACL 与 causal owner                      |
| 搜索                         | `handler/search.go` 使用数据库只读事务和 3 秒 statement timeout，超时明确返回                                                               | 采用有界查询和明确失败体验；数据库为 Postgres，不能原样复制到 SQLite 就算完成                                |
| Runtime/model/effort         | Provider 目录、原生 effort 词汇、带版本缓存、静态 fallback 标识                                                                             | 继续结构化移植已有 adapter 经验；本次真实 OpenCode/Kimi 已可用，不再重复造目录系统                           |
| Issue/Review/自动化/执行信息 | 当前官方 README 及源码提供 issue、chat、projects、squads、autopilots、execution logs、inbox、review 等                                      | Multica 产品范围明显更广；这些是可用参考，不应为追求数量改掉 RAH 的 Room-first 和本机核心                    |

一手源码链接：[Hermes memory](https://github.com/multica-ai/multica/blob/15280617bc264e367ca9c5e5e5cefdb0988246b7/server/internal/daemon/execenv/hermes_memory.go)、[Codex memory](https://github.com/multica-ai/multica/blob/15280617bc264e367ca9c5e5e5cefdb0988246b7/server/internal/daemon/execenv/codex_memory.go)、[Chat history](https://github.com/multica-ai/multica/blob/15280617bc264e367ca9c5e5e5cefdb0988246b7/server/internal/handler/chat_history.go)、[Inbox queries](https://github.com/multica-ai/multica/blob/15280617bc264e367ca9c5e5e5cefdb0988246b7/server/pkg/db/queries/inbox.sql)、[Search](https://github.com/multica-ai/multica/blob/15280617bc264e367ca9c5e5e5cefdb0988246b7/server/internal/handler/search.go)。

结论不是“RAH 全面胜过 Multica”。本轮 RAH 对跨 Provider 个人文件记忆有直接实证；Multica 在 Provider 原生记忆控制和更广的产品流程上提供成熟实现。两者证据不同，未进行模型质量、吞吐或真实并发的同条件竞赛。

## 7. 后端与工程审查

### 可保留的架构边界

- Room ledger / Inbox / Activation / RunAttempt / explicit Worker action 仍是主链，模型输出不会自动变成 canonical 回复或 Task 完成。
- Agent identity 和实际 Placement/Profile 分开冻结；本轮换 Kimi 的记录佐证了这层区分。
- Memory 是稳定 owner 的文件，Run receipt 不充当文件备份或模型理解证明。
- 同 Agent 单 lane、管理 fence、terminal proof、reset quarantine/回滚与 Task claim 单 owner 是已有保护，不为“照搬”而移除。
- UI 与 Provider 诊断分层保留；本轮动态页展示结构化诊断，聊天展示实际 Room action。

### 仍需证据而非口头保证的部分

本次全套门禁重新运行，但没有重新做真实多机、SIGKILL/断电、恶意文件/权限攻击、几十分钟复杂任务、几万条真实历史或真实重启后的模型召回。既有 fake/child-process 回归有价值，却不能替代相应生产场景。本轮仅确认普通刷新恢复，不把它写成 daemon 崩溃恢复实验。

另外，旧 `final-closure-plan`、README 长段与旧 memory PK 审计互相矛盾：例如仍说 Human Inbox/实际 memory injection 未完成，或把已经撤回的形成清单和独立维护上下文当现行设计。本轮添加当前裁决并更正入口；历史阶段结果保留且注明已被替代。

### 本轮门禁

- `npm run check`：退出 0；后端 638 项，636 通过、2 项付费 gate 默认跳过；Web 单测 25/25。跳过不代表真实测试通过，本轮真实调用由上面的独立实验补足有限范围。
- `npm run build:web:workbench`：通过。主 mount-app chunk 963.74 kB、gzip 277.54 kB，构建提示大 chunk；这是体积警告，不是已经实测的卡顿或首次加载指标。
- `npm audit --omit=dev`：0 vulnerabilities；不等于完整安全审计。
- 格式检查首次指出新生成的 JSON 与 Agent 原文格式差异：JSON 已格式化，原始 Agent memory 目录以精确路径排除 formatter，保持记录的 SHA-256，不豁免生产代码。最终 `npm run format:check` 通过，`git diff --check` 无输出；归档索引和正文的大小/SHA 再核对一致。

实验收尾：仅终止本轮隔离 fixture；确认 4189 listener、该父/子进程和 fixture 状态目录均已消失。测试凭据副本已清理，文档中的脱敏证据保留；Provider 原生测试会话未主动删除。官方浏览器恢复原页面及正常视口，本轮本地测试标签已关闭。没有重启、重配或清理用户生产服务。

## 8. 下一批建议：必要性、来源与退出条件

1. **先补最小记忆控制缺口**：参考 Multica 隔离/关闭 Provider 原生自动记忆；参考 Raft 接 cleaner 条件更新配置。只补明确 owner 与受控调用，不加分类、切片、向量库、observer 或新“重要性”规则。退出：用户全局配置不变、各 Provider 实测、冲突/重启不覆盖设置。
2. **审议后接 Raft idle 唤醒**：复用原 Agent 与已有 Host，不另起旁观模型；解决 Room-scoped Activation 与 App-local maintenance 的权限差异。退出：Human stop 不自启动、busy 不双 lane、通知确认不冒充整理、整理后限制条件仍可召回。
3. **收口日常导航主链**：Raft 全局 Tasks / Activity / Notifications / typed deep link，随后 Search。先解决“按钮到了错误范围”再做像素对齐；Human InputRequest 不重新实现。
4. **长任务可托管能力**：安全强制改派、显式 restart/session reset、Files/Artifact。沿用已有 cancellation/terminal fence；不能先开放按钮再补协议。
5. **UI 对照与交付门禁**：按同数据、同尺寸逐页修正角色/Computer/头像/图标/表单/hover/点击状态；真实 LAN iPhone 和 Mac 重启/安装证据独立验收。多机产品管理、收费账户/套餐、通用 App 市场不挤入这轮最小本机收口。

本次最合适的状态是：**可工作的本机 Room-first 候选产品，真实个人记忆主链已证明；完整 Raft 功能/交互等效和正式交付认证仍有明确缺项。**
