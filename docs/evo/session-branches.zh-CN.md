# Fork / Side：当前实施边界

负责人于 2026-10-13 授权开始，语义见[目标合同 §3](target-contract.zh-CN.md#3-调度与交流)。
本页区分原生能力探针、统一 Loom 分支接口、Claude／Codex／OpenCode／Pi Fork／Side 纵向实现与尚未接通的其他 CLI；不是 S4/S5 全部完成声明。

## 产品语义

- Fork 是同频道的正式新成员：同 Role ID、源实例冻结 Revision 与当前执行配置（含原生 model/effort 调整），新 Instance ID、名称后缀、原生 session 和权限。已有上下文不等于继承 Task 负责人、收件义务、旧凭据或私聊访问权。Role 后来修改不自动进入分叉。
- Side 是 Human 打开的临时额外对话，不是频道成员。它继承分叉时的原生上下文；可以按授权只读源频道 box 和记忆，只回复自己的对话，不能向频道或主 session 发帖、派送、修改 Task/成员/记忆。它不推动源实例的任何消费位置或 ACK。
- 丢弃 Side 只关闭 Side 的执行与访问资格，不重启源实例、不改变源配置，不承诺清除原生历史、备份或 SQLite 残留。
- 第一版在源实例空闲、原生会话已建立时分叉；不复制运行中的半轮，不加入定时、讨论、实现／审计等场景工作流。

## 单一 owner 和实施顺序

Kernel 拥有新成员、Side 权限、生命周期和源状态校验；AgentHost 只负责本机原生复制及新 session 绑定。Application Service 组合二者，控制台消费同一认证 API。继续使用现有 Room/Inbox/Activation/RunAttempt，不增加模型等待循环或第二个调度队列。

1. **已实现：原生复制与 Host 绑定。** 复制不调用模型；对不同 CLI 使用各自原生入口。Host 为目标 principal 保留私有复制回执；并发／重试／重启不能重复执行原生复制。已知成功但绑定写入失败可以恢复绑定；原生结果未知必须显式处理，不能自动重试。新绑定不继承源的协议、记忆投递或压缩确认回执。
2. **已接通首家：OpenCode Fork 成员。** 在调用 Host 前确认 Human 管理权限、源实例仍在频道、空闲且 generation/configuration 不变；原生复制后再校验源状态，并原子创建普通成员。持久化重试身份与已知回执，失败不留下可运行的半成品成员。控制台提供一个 Fork 操作，完成后能在同一频道正常对话。身份说明帮助模型理解，但身份／凭据检查必须由代码执行。
3. **已接通首家：OpenCode Side 对话。** 复用复制基础，建立独立执行身份与对话记录，服务端只读访问源 box，不借用源实例的 Worker 凭据。读取不能成为源实例的消费证明。Kernel 默认拒绝 Side 的业务变更能力，直接构造写请求也被拒绝；现有工具目录尚未裁剪。首版只允许排空后丢弃，忙时明确拒绝，未实现运行中自动取消；丢弃不改变源频道事件和调度状态。

复制时的空闲和配置检查必须覆盖异步 I/O 前后，不能只在点击时检查。
历史里的旧工具名称、凭据路径和自然语言身份不是授权；新凭据绑定新执行身份。
现有 CLI full-access／同 UID 的文件系统边界仍按合同，不把 API 只读宣称为 OS 强隔离。

## 2026-10-13 已核实的原生能力

| CLI         | 本机版本                        | 实际使用的入口                                | 本批证据                                                                        |
| ----------- | ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------- |
| Codex       | 0.162.1                         | app-server `thread/fork`，未发送 `turn/start` | 合成历史保留，新 ID，源文件不变；网络禁止                                       |
| Claude Code | 2.1.293；官方 Agent SDK 0.2.114 | SDK `forkSession`                             | 两条合成历史内容相同，新 session/message UUID，源文件不变；网络禁止、复制零生成 |
| OpenCode    | 1.18.35                         | 本机 server `POST /session/:id/fork`          | `noReply` 写入的合成消息保留，子会话追加不改源消息；无生成请求                  |
| Kimi        | 2.1.1                           | 本机 server session fork action               | 空会话新 ID、源元数据不变；非空历史和正式 ACP 续聊尚未验证                      |
| Pi          | 1.1.0                           | 安装包 `SessionManager.forkFrom`              | 合成上下文相同，新 ID，父子后续追加互不影响                                     |

五个探针均经过新增 `ProviderSessionStore.forkInstance` 并重放相同请求，第二次不调用原生复制。它们是实际安装包／CLI 加合成数据，不是模型质量、正式 daemon/API、Side 权限或成本门禁。

Claude 的 `--fork-session` 在实际合成回复中也通过；但只发送控制初始化、未发用户输入时，本批未产生持久目标文件，不能用控制响应冒充复制完成。官方 SDK 的磁盘函数已经单独通过，是更适合独立复制操作的候选。该 SDK 当前来自本机安装供探查，尚未成为 Loom 的可分发依赖；不能让产品依赖该本机绝对路径。

Kimi 2.1.1 源码显式拒绝活动／排队中的原生 loop，fork 时使用 quiescence hold；ACP fork 对 `mcpServers` 的重绑定有限制，正式接入还必须证明旧 Worker 配置未复用。既有 0.39.1 的运行验收不外推至本版本。

[本批证据](evidence/2026-10-13-session-branches/summary.json)。官方 Claude 说明：[session browser 的离线 fork](https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser)。本批未复制或结构移植厂商代码；探针调用安装包原生接口。

## OpenCode Fork 纵向切片（2026-10-13）

认证 Human API `POST /v3/client/instances/fork`／SDK `instance.fork` 接到 Kernel 与本机 Host；控制台成员卡提供 Fork 预览和确认。当前只开放本机 OpenCode、共享 Channel home、已在当前 runtime revision 建立的空闲原生 session；旧私有 cwd、远端 Host、动态 credential slot 以及其他 CLI 明确拒绝，不切换 CLI 或新建空白 session 冒充 Fork。

Kernel 在异步复制前后重新核实 Human 管理权限、Host 凭据与代际、源成员资格、运行／租约／清理状态、session generation、实际配置和历史运行计数。源 Role 的后续修订不进入分叉；复制使用源冻结 Revision 和实际 model/effort。请求确定独立目标 principal，Host 私有回执再绑定源快照指纹；未知结果不自动重试。新 principal／成员只在复制成功且二次校验通过后原子创建，使用普通 `instance.created` 事件附带来源，保留现有订阅起点和 prewarm Outbox；记录真实复制绑定，不伪造 RunAttempt 或源消费 ACK。

复制期间发生源变化或新的 Channel 事件时，本次成员创建被拒绝。已复制但未发布的原生文件可能保留为不可调度的孤立副本；不自动再次复制、不将其变成成员、不承诺抹除厂商历史。控制台未知结果沿用核实／放弃操作。不会复制 Task 负责人、源私聊成员资格和源投递／协议／记忆确认回执。

实际 OpenCode 1.18.35、正式 Daemon/API、隔离 HOME 和仅 loopback 的本地合成模型已经跑通：源会话建立 → API Fork → 相同请求重放 → 新成员继承源历史后以新身份回复 → 源成员续用原 session。共三次本地合成模型请求，复制阶段零生成、零付费；所有 Activation 终态，测试 Daemon 和记录的原生进程退出。独立复制探针还证明子会话追加不改变源原生消息。此证据不代表模型自主遵循、效率门禁或五家正式接入。[本批证据](evidence/2026-10-13-fork-vertical/summary.json)。

## 验收边界

Host 单测覆盖源绑定保留、独立目标、新身份不继承投递回执、并发、重启重放、未知结果、绑定写入失败恢复及损坏回执。
OpenCode Fork 的 Kernel/API/控制台入口已实现；检查与部署以本批证据和状态页为准。该首家 Fork 批次未验证 Side；Side 与 Codex 后继接入见下文。Kimi 正式适配、忙时丢弃与真实付费模型的有界接入验收尚未完成。
不能将首家 Fork 接入登记为五家 Fork 或 Side 已完成。

## OpenCode Side 纵向切片（2026-10-13）

`POST /v3/client/sides/create`／SDK `side.create` 复用同一原生复制与源状态双重校验；`sides/discard`／`side.discard` 为 Human 操作。控制台成员卡提供 Side，打开独立私有对话页；正式产品第三栏尚未接入。

Kernel 的 `side_sessions`（schema88）只记录来源、所属私有 Room、owner 和丢弃状态；执行仍复用 Role 配置快照、原生绑定及普通 Room/Inbox/Activation/RunAttempt。内部执行身份的 `role_instances.channel_id` 指向它自己的私有 Room，普通 Role 实例列表明确排除 Side；它不加入源频道，也不接收源频道派送。源频道不记录 Side 创建、回复或丢弃事件。公开响应使用 `side.roomId`，不把它伪装成频道成员。

Worker 身份从认证执行推导。Side 的业务能力默认拒绝，只有自身对话、有限读取和自身投递确认开放；源频道 `message-history` 单独经过实时只读授权，不使用源凭据，也不产生源或 Side 的源频道消费回执。源实例或 Human 失去源频道成员资格后撤销源读取，自己的历史仍可读；源私聊不授予访问权。源记忆读取遵从源成员开关，Side 无写权限；删除源记忆时同时清除 Side 在线投递快照中的描述，不能撤回已送进原生上下文的内容。

首版丢弃要求无排队／租约／运行／隔离待处理工作，并通过已有进程清理围栏。成功后禁用该执行身份、归档自身 Room，后续消息和 Worker 访问被拒绝；重放不重复变更；响应丢失时，即便状态轮询已显示丢弃，仍保留原操作的核实／放弃入口，绝不换键自动重发。**忙时一键取消尚未实现，因此不是“可随时丢弃”的完整 S5 验收。** 未增加停止队列或假装信号已证明进程退出。历史、源会话和共享目录不删除；同 UID 的 full-access CLI 不构成文件系统只读沙箱。

实际 OpenCode＋本地合成模型已跑通父会话→浏览器创建 Side→新 session 继承上下文并调用真实 Worker 历史读取→私有回复→父会话续原 session 且不含 Side 文本→浏览器丢弃及精确重放。完整链4次合成请求，复制阶段0次。桌面和手机显示真实合成回复与独立名称。无新增付费，不作多 CLI、模型自主遵循或成本结论。[本批证据](evidence/2026-10-13-side-vertical/summary.json)。

## 统一 Loom API 与原生适配（2026-10-13）

上层保持三项厂商无关操作：`instance.fork`（`POST /v3/client/instances/fork`）、`side.create`（`POST /v3/client/sides/create`）、`side.discard`（`POST /v3/client/sides/discard`）。调用者只提交 Instance ID、因果位置与幂等键，不传 CLI 类型、原生 session ID 或凭据。Kernel 共用源状态双重校验、Role 配置快照、成员／Side 身份和执行围栏；Side 不成为普通频道成员。

AgentHost 的 `nativeSessionCopyAdapter` 按受信 runtime manifest 的 adapter kind 选择原生实现。统一输入是源原生 ID、可执行文件、冻结环境和 cwd，返回独立的新原生 ID；`ProviderSessionStore.forkInstance` 继续单独拥有复制回执与绑定恢复。daemon 只组合 Kernel 与 Host，不按 CLI 显示名分叉业务规则。未知 adapter 直接拒绝，没有空白会话回退。

`host.runtime.list` 的可选 `sessionBranches` 返回该配置支持的 `fork`／`side`。旧响应缺该字段时，界面视为不可用；发现可执行文件不等于支持复制。仅配置了复制适配器、且无待解析动态凭据的 manifest 宣告能力。控制台按此能力显示预览，不维护厂商名单。它是运行时能力，不证明某个实例空闲、已有 session 或其当前 placement/configuration 满足条件；真正执行仍以 Kernel／Host 的检查为准。

当前正式实现为 `opencode-server/v1` 与 `codex-app-server/v1`。Codex 使用 CLI 自带 app-server 的 `initialize → thread/fork`，不调用 `turn/start`；沿现有启动策略禁用自动记忆、个人 MCP 和自动触发机制，复制后确认进程退出。相同 provider key 使后续 Fork／Side 进入既有 Codex 启动／续聊链。该批次未开放 Claude、Pi、Kimi；Claude／Pi 的后继接入见下文，Kimi 仍不宣告能力。

实际 Codex／隔离 HOME／禁止外网／本地合成模型验证了正式 Fork、Side、父子独立续聊与零生成复制。Side 另外验证正式默认 Worker 回帖路径，不依赖启用生产的实验性 final-output 开关；本批不修改正式服务开关。测试曾漏传 turn、使用不存在的 `message-history` 命令，旧断言误把命令回显当作成功；修正为 `message-read --turn ... --target ...` 并检查工具输出中的源消息。旧证据的历史读取声明据此降级，保留失败与重测记录，不据此声称模型自主用对工具或效率验收。完整检查、浏览器与部署状态见[本批证据](evidence/2026-10-13-unified-branches/summary.json)。

## Claude 离线复制适配（2026-10-13）

`claude-stream-json/v1` 接入同一个 Host 注册表，SDK／HTTP／Kernel／控制台无 Claude 专用业务分支。正式 Node 部署的能力投影自动包含 Fork 与 Side；独立 SEA 可执行文件尚未包含该磁盘 helper，因此该形态不宣告 Claude 复制能力，远端 Computer 机制未改。

AgentHost 固定依赖官方 `@anthropic-ai/claude-agent-sdk@0.3.296`，仅调用 `getSessionMessages`／`forkSession` 的磁盘 API，不调用 `query` 或 SDK 的 CLI runner。它在短生命周期 Node 子进程中运行，使用源 runtime 的 cwd 和环境，避免 SDK 的配置缓存与进程全局环境在多实例间交叉。用户安装的 Claude CLI 仍承担后续启动／续聊；本地 CLI 可执行文件、版本和账户配置不被更改。依赖自带的可选 runner 不作为 Loom CLI 使用。

复制前后比较源／子的有效消息内容，拒绝空历史、非独立 ID 或上下文不一致；异常不把副本发布为成员。相同请求仍由既有 Host 回执保证不重复复制；可能已复制但验证失败的文件属于不可调度的孤立副本，未知结果不自动重试。源文件和源绑定不被改写，SDK 不管理 Room 状态、收件义务或记忆。

版本选择依据：官方 [forkSession 压缩历史问题 #472](https://github.com/anthropics/claude-agent-sdk-typescript/issues/472) 记录了保留片段引用未重映射的问题，并报告 0.3.284 起修复、0.3.296 复验。Loom 自建合成测试覆盖普通历史、摘要后接续和保留片段后接续两种压缩形态，检查新 UUID、嵌套引用有效、源文件不变，以及同一源 ID 在三个隔离配置目录并发复制不串上下文。行为依据是安装包的实际回归与原生续聊，不仅是上游声明。

复用分类：官方 npm 包作为未修改依赖，完整版本／integrity 由 lockfile 固定，保留上游包的 notices；license 元数据为 `SEE LICENSE IN README.md`。本地新增的是进程隔离、结果验证及注册表接线，未复制或结构移植 SDK 源码。磁盘接口参考 [官方会话浏览器示例](https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser)。[本批证据](evidence/2026-10-13-claude-branches/summary.json)。

Pi 后续入口复核（同日，仅隔离探针）：RPC 先 resume 再 `clone` 会在合成源会话追加 `thinking_level_change`，不满足源文件不变；CLI `--fork` 在启动前复制，实际 1.1.0 进程已证明新 ID、有效消息相同、源字节不变且零模型请求。该探针时尚未接入 Loom：现有 Pi runtime 使用 Host 管理的确定性 session 文件路径，需在同一文件位置所有者下接好目标文件，不能仅返回一个新 UUID 就宣告可续聊。两次探针均禁止外网并已退出，失败保留于本批证据。

## Pi 原生文件复制与续聊（2026-10-13）

`pi-print-json/v1` 接入同一注册表，继续使用 `instance.fork`／`side.create`／`side.discard`，无 Pi 专用业务端点。唯一位置所有者为 AgentHost 的 `pi-session-files.ts`：新会话沿用原有按配置计算的路径，已绑定会话按原生 ID 在 Host 私有 `pi-sessions` 目录中读取文件头并定位。原生 ID 仍来自既有 ProviderSessionStore 绑定，文件查找不重建 Room 事实，不迁移或重命名已有文件，不按最新文件或提示词变更创建替代 session。找不到或重复 ID 拒绝；未写完的其他会话头不阻塞已绑定会话，链接／非普通文件拒绝。

复制调用用户已安装 Pi 的 `--offline --mode rpc --fork <源文件> --session-dir <Host目录>`，只发 `get_state`，不 resume 源、不发送 prompt；扩展、MCP、skills 和 context files 在复制进程关闭。先证明复制进程退出，再核对新 ID、目标目录与文件头、完整原生条目保留以及源字节不变，才交给既有幂等回执发布绑定。目标使用原生文件名，后续普通 print runtime 按绑定 ID 定位，无须再复制一次。没有新增 npm 依赖，也没有安装或修改用户 CLI／账户。代码为本地胶水，未移植 Pi 源码；原生入口与安装版本哈希见证据。

实际 Pi1.1.0 经正式 daemon/API 的 Fork、Side、桌面／手机私聊、默认 Worker 回帖通过，复制均零生成；测试均为隔离配置与仅 loopback 的合成回复，非付费效率或模型自主质量验收。默认 Worker 脚本首次漏读当前消息，被新鲜度围栏拒绝；补上 `message-check` 后通过，失败保留，产品权限未放宽。连续两个 Host runtime 的同 ID 续聊、中文路径在管道中分段的 UTF-8 解码均有自动化回归。SEA 仍不可用，Kimi、忙时丢弃和产品第三栏仍未完成。[本批证据](evidence/2026-10-13-pi-branches/summary.json)。
