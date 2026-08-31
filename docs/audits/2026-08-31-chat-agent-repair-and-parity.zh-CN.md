# Chat / Agent 修复、真实 CLI 验证与 Raft 对照审计

审计时间：2026-08-30 晚至 2026-08-31 凌晨，Asia/Shanghai。

## 结论与证据边界

本轮修复了 DM 入口缺失、资料刷新闪烁、运行时配置入口缺失，以及动态分页和 OpenCode 工具参数丢失等具体缺陷。真实 CLI 已从浏览器完成普通私聊、跨 Room 文件操作、显式回复和动态查看。**不据此宣布全产品收口，也不宣布所有控件或交互已 1:1。**

Raft 官方侧和本地侧均使用内置真实浏览器，桌面对照为 **1440×1000 CSS px**；另检查本地 **390×844**。官方当前 Computer 显示离线，运行时弹层报告无法从 Computer 加载模型；因此本轮官方侧是页面/交互结构对照，不能证明双边实时执行结果一致。没有向官方账号发送测试消息、保存配置或删除对象。

证据分级：

- **真实 CLI**：隔离的临时 Workspace/Agent/状态目录，通过浏览器发起操作，核对 canonical 消息、冻结的 Runtime Placement、RunAttempt 和动态记录。
- **Fake Worker**：真实浏览器 + 真实 Kernel/daemon + 可控 Worker，用于成员、Task、InputRequest 等业务协议，不能充当真实模型执行证明。
- **官方只读对照**：登录后的 Raft 页面、DOM/computed style、弹层与导航、同尺寸截图。
- **未验收**：Firefox、iOS 真机、长时间断网/恢复、正式持久环境本轮升级后使用、所有菜单组合及每个像素状态。

全部截图和数据位于 [证据目录](./evidence/2026-08-30-chat-agent-repair/)。下表的“通过”均仅限明确写出的用例。

## 一、四项投诉与额外发现

| 问题                       | 根因/边界                                                                                | 本轮修改                                                                                                                           | 验证结果                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 资料操作区域周期闪烁       | 查询依赖每轮重新创建的 Agent view object，背景刷新反复清空资料；还缺少跨页面配置版本刷新 | 按身份、definition revision、policy revision、lifecycle 刷新；同一身份保留数据；旧请求取消；复用现有 catalog 刷新节奏              | 最后一次连续 31 秒、32 次 DOM 采样，管理按钮 Y 坐标均为 870.2734375，无 loading/disabled 翻转；另一页面修改资料后当前页更新 |
| 颜色不符                   | 使用未定义 `--red`；同时把未实现功能的 disabled 外观误当普通状态                         | 改用已导入 `--coral`；补有效按钮 hover/press                                                                                       | CSS/交互状态修复；**被禁用的 restart/report 仍比官方可用按钮浅，属于能力缺口，不能靠去掉 disabled 粉饰**                    |
| 私聊入口为空               | 侧栏只列已创建的 direct Room，没有列全部 Workspace Agent                                 | 以 Workspace Agent 目录产生入口；首次点击调用已有 `room.direct.open`；已有 Room 直接进入；公开 canonical 双方 ID，禁止按名字猜配对 | 未创建 DM 的 Agent 可见；点击、返回、刷新不重复；保留 Human DM；同名/改名与 tombstone 单测通过                              |
| 动态空白/历史难查          | 空态滚动容器布局、分页窗口保留方向错误；没有真实执行的身份当然没有轨迹                   | 修正空态布局、按 Agent 隔离请求；历史模式暂停实时覆盖；保留用户请求的较早 500 条窗口                                               | 三家真实 CLI 均有轨迹；同一 OpenCode Agent 能回看 DM 和另一频道的记录；不能据此声称所有生产 Agent 都测试过                  |
| 资料不能编辑模型           | 只有泛化管理弹层，资料页没有运行时编辑入口                                               | 新增资料页运行时编辑，复用 `agent.manage` 与已有模型/effort 目录，保留身份、人设、记忆引用                                         | UI 保存后下一 Run 的 Placement 与选项一致；取消无写入；跨页面冲突被拒绝，未覆盖其他人的修改                                 |
| OpenCode 读文件只显示 `{}` | pending 工具事件空 input 抢先被记录，running 的实际参数随后被去重丢弃                    | pending 不作为 tool-start；等 running 参数到达后记录                                                                               | 先失败的回归测试转绿；第五次真实运行显示 `read` 的 `filePath` 和 shell command；历史空参数不会凭空补造                      |
| 历史页加载后又消失         | 旧实现合并后保留最新边缘，超过上限就丢掉刚请求的旧记录                                   | 单独的 bounded history window，去重后保留较早边缘；显式“返回最新动态”                                                              | 浏览器连续加载 27 页，跨越 500 条边界，仍能看到前后两个 Room 的执行时间；对应失败测试转绿                                   |

资料稳定性证据：[profile-stability.json](./evidence/2026-08-30-chat-agent-repair/profile-stability.json)。冲突证据：[双页面条件写入](./evidence/2026-08-30-chat-agent-repair/runtime-conflict-1440.jpg)。

### 单一 owner 与复用范围

- 配对、幂等、权限、因果写入继续由 Kernel/application service 负责；未引入客户端 DM 真相、第二套 Agent 管理服务或 provider transcript 聊天。
- Runtime 编辑是 RAH 协议适配胶水，**不是 Raft React 源码逐字复制**。弹层宽 448、padding 24、border 2、shadow 4、标题 18、字段高 40 来自官方当前 DOM/computed style，沿用本仓库导入的 Raft tokens。
- DM 入口和生命周期遵循 Raft 产品行为，但使用 RAH 已有 Room/Agent owner；没有复制旧 `rah` 的 session-first 模型。
- OpenCode 修复按真实结构化协议保留 finalized 参数。没有通过解析终端画面、猜文字或伪造聊天记录补动态。

## 二、真实 CLI 证据：不是只有退出码

所有调用使用专门临时身份和 `/tmp/rah-chat-agent-real-NIypOp`，没有把生产 Agent 的人格、记忆或项目当试验品。Claude 没有执行，未使用 Ultra。

| 调用       | 实际模型/effort                  | 浏览器发起的行为                   | canonical 结果                         | trajectory 条数 |
| ---------- | -------------------------------- | ---------------------------------- | -------------------------------------- | --------------: |
| OpenCode 1 | deepseek/deepseek-v4-flash / max | 私聊创建并读取唯一测试文件         | 原 DM 收到 `PARITY-830-ALPHA`          |             667 |
| OpenCode 2 | 同上，同一 Agent                 | 新频道读取同一文件、追加一行并复读 | 新频道收到 ALPHA/BETA；未错误回复原 DM |             692 |
| Codex      | gpt-5.6-sol / low                | 私聊只读文件                       | 两行文件内容与 `CODEX-READ-OK`         |              19 |
| Kimi       | kimi-code/k3                     | 私聊只读文件                       | 两行文件内容与 `KIMI-READ-OK`          |             826 |
| OpenCode 3 | deepseek/deepseek-v4-flash / max | 修复后明确使用 read 工具           | `OPENCODE-PATH-OK`，轨迹含实际路径     |             386 |

五个 RunAttempt 均 exited/0；数据库中是 **5 条 Human 消息 + 5 条 Agent 显式回复，0 个 Task**。这些短对话使用了工具，但没有因使用工具自动升级成 Task。这是本组有明确普通对话指令的实验结果，不是对任意模型自主分类的保证。

数据：[真实运行/冻结配置](./evidence/2026-08-30-chat-agent-repair/real-runs.json)、[canonical 消息](./evidence/2026-08-30-chat-agent-repair/real-messages.json)。截图：[Codex 私聊](./evidence/2026-08-30-chat-agent-repair/codex-real-dm-1440.jpg)、[Kimi 私聊](./evidence/2026-08-30-chat-agent-repair/kimi-real-dm-1440.jpg)、[真实工具路径](./evidence/2026-08-30-chat-agent-repair/opencode-activity-paths-1440.jpg)、[跨 Room 历史](./evidence/2026-08-30-chat-agent-repair/opencode-cross-room-history-1440.jpg)。

## 三、扩展回归与全面对照矩阵

| 模块                   | 本轮实际检查                                                                               | 结论/剩余差距                                                                                                                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Room/成员              | 浏览器创建双 Agent Room；两者回复；移出 Alice 后下一条仅 Kimi 收到并回复；人数含 Human     | Fake Worker 业务链通过；真实 CLI 的跨 Room 定向回复另有上述证据                                                                                                                   |
| 私聊                   | 全 Agent 入口、首次创建、复用、刷新、真实三 CLI 回复                                       | 通过已列用例；正式进程仍需协调升级                                                                                                                                                |
| Task/Thread            | Human 勾选 Task、单人 claim、提交、展开回复列、Human 线程回复、确认完成                    | Fake Worker 通过；普通回复仍留主 Room；未重跑所有竞争/强制改派场景                                                                                                                |
| 全局 Tasks             | 从任务定位原 Room/Thread；键盘拖动；非法从 completed 回 review 被 Kernel 拒绝，Escape 取消 | 通过受测范围；不是所有拖拽状态全排列验收                                                                                                                                          |
| Search/deep link       | 搜索 THREAD-830；打开命中消息的 Room/Thread；检查相关度/最新排序菜单                       | 通过本地用例；官方排序算法并未取得，不能宣称排序结果逐条一致                                                                                                                      |
| 全局 Activity          | Channel、DM、Thread 产生卡片；处理一条；Unread 筛选                                        | Fake Worker/真实浏览器通过；与 Agent 执行轨迹是不同数据面                                                                                                                         |
| Human Inbox/通知       | Task 请求人工输入 → 通知 1 → 回答 → 新 activation → 同 Task submitted；计数消退            | 可控 Worker 合同通过；[恢复截图](./evidence/2026-08-30-chat-agent-repair/input-request-resumed-1440.jpg)                                                                          |
| Agent 创建/管理        | 创建 AuditNew、目录可见、暂停/恢复、侧栏发起 DM                                            | Fake Worker 通过；未执行删除、未把尚禁用的 profile restart/report 算通过                                                                                                          |
| 模型/effort            | 资料入口、菜单、保存、取消、实际执行配置、双页面写冲突、后台刷新                           | 通过已列用例；Raft 的 fast mode/更多环境变量尚未等量接入此弹层                                                                                                                    |
| Agent 动态             | 真工具、跨 Room、当前/历史切换、超窗口分页                                                 | 数据链通过，但摘要、标签、流式聚合还有 P1 差距，详见下一节                                                                                                                        |
| Agent Workspace/Memory | 浏览器查看临时 Codex 身份的 MEMORY.md                                                      | 只证明只读展示可用；不是重新完成记忆隔离/维护/reset 的全部验收                                                                                                                    |
| Reminders/Apps/MCP     | 页面入口与未配置状态                                                                       | Reminders/Apps 仍有占位；MCP 未绑定时为空合理，但本轮没有配置新 MCP 并实跑                                                                                                        |
| Files/Artifact         | 打开聊天 Files tab，检查 composer 附件                                                     | 尚未接入完整上传/预览/下载/Review UI；不能称文件产品能力已完成                                                                                                                    |
| Computer               | 双边打开信息和 runtime 区域                                                                | 本地当前主要只读；与 Raft 完整管理仍不同；远程 Computer 不在本轮完成范围                                                                                                          |
| 390 页面               | DM、目录、资料、运行时弹层、取消                                                           | 文档宽 390，无横向溢出；[DM](./evidence/2026-08-30-chat-agent-repair/rah-mobile-dm-390.jpg)、[编辑弹层](./evidence/2026-08-30-chat-agent-repair/rah-runtime-390.jpg)；非 iOS 真机 |
| 全局设置/所有细微样式  | 未逐项穷举                                                                                 | 不放行 100% 菜单/hover/focus/像素一致声明                                                                                                                                         |

同尺寸证据：

| 页面          | Raft 官方                                                                     | RAH OS                                                                       |
| ------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 资料          | [1440](./evidence/2026-08-30-chat-agent-repair/raft-profile-1440.jpg)         | [1440](./evidence/2026-08-30-chat-agent-repair/rah-profile-1440.jpg)         |
| 运行时编辑    | [1440](./evidence/2026-08-30-chat-agent-repair/raft-runtime-1440.jpg)         | [1440](./evidence/2026-08-30-chat-agent-repair/rah-runtime-1440.jpg)         |
| Search        | [1440](./evidence/2026-08-30-chat-agent-repair/raft-search-1440.jpg)          | [1440](./evidence/2026-08-30-chat-agent-repair/rah-search-1440.jpg)          |
| 全局 Activity | [1440](./evidence/2026-08-30-chat-agent-repair/raft-global-activity-1440.jpg) | [1440](./evidence/2026-08-30-chat-agent-repair/rah-global-activity-1440.jpg) |
| Tasks         | [1440](./evidence/2026-08-30-chat-agent-repair/raft-tasks-1440.jpg)           | [1440](./evidence/2026-08-30-chat-agent-repair/rah-tasks-1440.jpg)           |
| Computer      | [1440](./evidence/2026-08-30-chat-agent-repair/raft-computer-1440.jpg)        | [1440](./evidence/2026-08-30-chat-agent-repair/rah-computer-1440.jpg)        |

这些截图的内容/身份不是同一份 fixture，不能用整图差分比例来冒充像素一致率。目视仍可见 profile 的角色 badge、部分图标、字段密度/控件字重和按钮差异。尤其 Raft 的“角色”是管理员/成员，而当前 RAH 位置展示的是 persona role 文本；这仍是语义/布局差距，不是数据名字不同就能解释。

## 四、Raft 为什么不用写入聊天 box 也有动态？

用户的理解正确：**聊天与执行轨迹是两条通道**。思考/工具事件不需要逐条发到 Room；也不能因为 CLI 输出了文本，就把它冒充 Agent 正式回复。

```text
Agent 显式 send_message / 消息工具
  └─ Room 的用户可见消息

CLI 结构化事件：reasoning summary / tool call / tool output / lifecycle
  └─ Computer runtime adapter
      └─ 统一事件、工具别名/参数摘要、文本合并
          └─ agent:activity → Agent 动态页
```

证据来自本机已提取的 **Raft Computer 1.0.18**，不是凭截图推断。源码文件为：

`raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/packages/daemon/dist/chunk-ZHWD6VKE.js`（仓库同级路径）。

| 位置                              | 可直接确认的行为                                                                                                   | 对应截图                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| 1897 `buildDaemonActivityMessage` | 构建独立 `type: "agent:activity"`，带 agentId、entries、detailKind、launchId、producer sequence 等                 | Agent 级动态，而非聊天消息写入              |
| 25468 Codex adapter               | `item/reasoning/summaryTextDelta` 转 `thinking`；邻近的 raw reasoning text delta 仅记录 progress 字节信息          | 思考摘要与进度；不是获取模型全部隐含推理    |
| 25522 起                          | commandExecution 等 item 的开始/完成转成 tool_call/tool_output                                                     | 执行 shell、文件操作等可观察过程            |
| 20891 `TOOL_DISPLAY_METADATA`     | bash → Running command；read_file → Reading file；check_messages → Checking messages；claim_tasks → Claiming tasks | 人类可读标签不是 LLM 每次自己写的聊天文案   |
| 1130 起、20929 起                 | CLI task claim/update 和不同供应商工具名归一化                                                                     | Raft 工具/普通 shell 调用可以用同一显示协议 |
| 30615、34645、34657               | `TRAJECTORY_COALESCE_MS=350`，pending 文本按类别/子 Agent 来源合并，flush 文本超过 2000 字符截断                   | 控制流式碎片与动态日志体积；不是记忆切分    |
| 35741                             | thinking 结束边界产生 `Thinking finished`                                                                          | 该状态不等于保存了完整思考正文              |
| 35776                             | tool_call 先归一化、取工具标签与参数摘要，再广播 tool_start                                                        | Running command 后面的命令来自实际工具参数  |
| 35800                             | tool_output 产生 `Tool finished`                                                                                   | 工具完成无需向 Room 额外发一条消息          |

截图中的 `Claimed 1 task` / `Updated task #1 to in_review` 是结果类显示。本轮确认了 claim/update 调用和 activity 协议的源头，**未在该切片定位这两条结果文案的最终格式化分支**，因此不把其服务器端实现写成“已全部提取”。

观察范围也有边界：结构化工具报告“执行了 shell 命令”不等于 Computer 监听了每个文件系统 syscall；CLI 未上报、CLI 外部发生的操作不能保证出现在这里。管理员编辑模型/暂停 Agent 则属于管理事件，若要求在同一页出现，需要接入相应的明确审计事件，不能假装都是 provider tool call。

### RAH 当前与该设计的关系

RAH 已是同样的通道分离：`provider-trajectory-normalizer.js` / runtime driver → `run_trajectory_entries` → `agent.trajectory.list`。Kernel 按 Agent 身份聚合跨 Room 记录并检查访问权限；Room 消息仍必须显式发布。浏览器不解析 CLI 日志重建聊天真相。

但采集和展示还不等量：本组 5 次运行留下 **2590 条原始 trajectory**（1918 thinking、545 text、90 status、37 tool_start）。目前网页只合并已取到的相邻文本，底层分页仍按碎片计数；一页 50 条可能只能拼出一段文字的尾部。Raft 在 Computer 端已经有 350ms 合并和摘要路径；**这一成熟实现值得下一批直接移植/适配，不应再发明新的自定义聚合规则**。

下一批应由 AgentHost 的观察通道统一 owner，保留 run/agent/room/tool/subagent 身份和顺序，在工具/turn/error/退出边界 flush；禁止借聚合改写 canonical Room/Task。须补碎片重放、跨 Run 不合并、退出前 flush、超长文本预算和真实浏览器分页门禁，再实施。现有丢失的参数不回填猜测值。

## 五、尚未收口的优先级

1. **P1：Agent 动态产品化**。移植 Raft 合并/工具显示映射，减少碎片分页；接入明确的配置/暂停等管理审计事件；不能承诺“所有 OS 操作都可见”。
2. **P1：Agent 资料与控制完整性**。统一角色语义与 Raft 布局，接上有安全合同的 start/restart/reset/诊断/报告入口；补模式、更多配置。不要以禁用按钮占位宣布能力齐全。
3. **P1：Files/Artifact UI**。上传、关联消息/任务、预览、下载、审阅与权限闭环，目前仍缺可用入口。
4. **P2：细节与性能**。全部图标/字重/关闭控件/hover/focus 状态继续按 live 数据核对；主 mount bundle 约 1049kB（gzip 304.75kB）有 Vite 体积警告，需拆分与大历史压力测试。130 条种子消息测试不代表超大历史验收。
5. **P2/独立阶段：Reminder/Apps/Computer 管理及跨设备验证**。当前占位/只读项、Firefox、iOS 真机、LAN/PWA 离线恢复不在这轮通过范围。

## 六、门禁、失败记录与交付状态

- 最新 `npm run check` 通过：package tests **657 中 655 通过、2 个 opt-in 真实付费 gate 跳过**；web tests **42/42**；TypeScript 通过。上述五次手工浏览器发起的真实 CLI 实验是独立证据，不把 skipped gate 改称通过。
- `npm run build:web:workbench` 通过，保留大 chunk 警告。
- 最终 `npm run format:check`、`git diff --check` 均通过。
- `npm audit --omit=dev`：0 vulnerabilities。
- OpenCode pending 和跨页面 revision 用例先观察到预期失败，再修改实现。一次完整门禁发现标题与既有 owner 测试不符，恢复正确标题后重跑全部通过，未放宽测试。
- InputRequest 首次手工回答没有满足 fake Worker 写死的 `Yes, remain loopback-only` 合同，得到预期之外的失败；在新隔离 Room 按测试合同重跑后通过。这不是任意真实 Agent 人工问答的验收证据。
- 正式 4173 没有在本轮被重启或灌入测试数据。只读检查发现正式库仅有 **1 个已退出 Run 和 20 条轨迹**，不能将其他临时环境的历史冒充正式环境里每个 Agent 都有执行过。
- 前端生产 build 已生成；正式后端仍是原进程。已有 server 若按请求读 dist，刷新可能拿到新静态资源，但这不等于完成前后端配套升级。**正式可用交付仍待确认无运行中工作、备份并授权重启后重新验收。**
- 没有 commit/push；工作树含大量此前改动，本报告不声明整个仓库干净或全部改动由本轮产生。
- 证据导出后已停止本轮 4189/4191/4192 临时环境并关闭对应审计标签。fixture 按自己的退出合同清理临时状态，完整临时数据库不保留；真实消息/Run 摘要和截图已归档。原 4173 进程与用户的两个原始标签页保留。测试文件目录不作为生产 workspace 使用。

本报告覆盖当前 Chat/Agent 基础链路的最新证据，不能用旧阶段“收口”标题反向覆盖此处明确记录的缺口。
