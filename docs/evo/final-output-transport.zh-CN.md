# 最终回复传输：显式 JSON 与原生正文

2026-10-04 完成四家免费传输研究；负责人随后要求继续，2026-10-05 接入 OpenCode warm 纵向路径。当前通过真实安装 CLI＋本地假模型的两轮 Worker／Kernel／Host 全链：每轮一次假模型请求、同 session、两个完成的 Activation、两个可信 final-output marker、没有 Worker 发帖工具调用。随后 P108 真实三轮传输和数值预算通过（输入1.140倍，双方生成2/1/1），但实质审查质量失败，**不是整体验收通过**。 当前正式部署见 [status](status.zh-CN.md)，预算和目标合同不变。

## 2026-10-09 普通 Codex exec/resume 纵向接入（默认关闭）

新增显式 RuntimeProfile `codex-exec/v1`，使用普通 `codex exec --json` 与
`codex exec resume`。原 `codex-app-server/v1` 配置及已有实例不变；不迁移或
静默替换 session。新配置只有在 `LOOM_CODEX_EXEC_NATIVE_FINAL_TRIAL=1` 时启用
原生正文发表，开关关闭仍使用 Worker 工具。模型与 reasoning 必须显式绑定，
每次初始/续接启动都沿既有策略关闭官方自动记忆。

Host 在发送前绑定原 Worker 凭据与实际渲染窗口，只为完整单目标消息选择原生发表。
Driver 交叉校验完整 exec stdout、本轮独占 last-message 文件、rollout 当前增量：
精确输入 SHA、原 session/turn、明确 final phase、工具结束、正常终态及正文一致。
续接绑定精确路径、文件身份、字节偏移和旧前缀 SHA；首轮排除启动前已有文件。
stdout 最后一段文字、exit0 或旧 final 单独都不能发表。
Session 身份独立于 final 成功，失败后不能重新开始一个新 session。

P158 暴露普通 exec 同 turn 多 final 的兼容边界：原生 last-message 采用最后一条
完成消息。collector 允许更早的同 turn、不同身份、正常 final，仅选择与原生
`task_complete.last_agent_message`、最后 stdout 助手消息和新输出文件一致的末条；
同文也不拼接或重复发表。异 turn、重复身份、异常状态、尾随工具和不一致结束仍拒绝。
该选择不替代原输入/文件前缀/模型/effort/工具闭合证明，也不放宽 app-server 路径。
实际 CLI＋loopback 已复现旧拒绝、不同正文和相同正文的新终态发表及同 session 续轮。
[免费证据](evidence/2026-10-09-fixed-long-batch/codex-multiple-final-free.json)。

本批还确认了计费证据边界：首条 partial final 缺少独立响应用量时，即便最终
正常退出且记录的 generation 用量标记 complete，未报告尝试的费用覆盖仍未知。
本修复只解决回复资格，不补造 token 或修改用量字段；P158 原失败和费用缺口保留，
不因免费修复通过而重写付费结果。

Host 处理完运行证据，随后通过原 Worker 的同一 final-output 事务槽提交正文，再撤销
凭据。取消覆盖进程退出后的 HTTP 待决窗口。缺证据/unknown/held 保持显式待处理；
崩溃恢复只核验持久标记，不重发表或用新模型轮次补偿。
用量只来自原生当前 turn 的唯一 per-response 记录，不累加 exec 的会话累计摘要。
这条路径不需要模型调用发帖工具或读取发表收据。

自动化检查使用真实 Kernel/Worker/Host 与假 CLI，覆盖两轮连续会话、原凭据发表、
撤权、缺 final、错 session、取消、Task 回退、stale、提交前后丢响应、关闭开关及
显式 registry 配置。实际 CLI、完整检查和部署结果记录在
[本批证据](evidence/2026-10-09-codex-exec/summary.json)，不能以假 CLI 通过代替。

本切片限制：普通 exec 的忙时输入继续使用持久后续 Activation；没有原生 steer。
SEA 打包、附加目录续接、service tier 覆盖和旧 app-server argv override 明确未支持，不静默忽略。
试验开启但本轮回退 Worker 时，Host 崩溃恢复仍保守报告 unknown。
当前只有开始/结束 trajectory 与逐响应 token；逐工具/思考 UI、context 占用与
compaction 观察尚未接入，缺失占用显示 unknown，不估算。
每次启动扫描原生 sessions 目录；resume 的前缀 SHA 校验仍读取本地旧字节，
rollout 超过 256 MiB 时拒绝续接而不轮换 session。这是 Host I/O/内存边界，
不会把旧字节再次送给模型；长任务、压缩、五 CLI 和多人付费效率仍未验收。

## 2026-10-09 Claude warm 原生正文纵向接入（默认关闭）

此前实验提交器现在有一条正式运行链路候选：仅 Claude warm 显式设置
`LOOM_CLAUDE_NATIVE_FINAL_TRIAL=1`。Driver 验证原 session、原输入 UUID、完整
`end_turn` 流、同正文的成功 result 及工具结束；Host 用启动前实际渲染的完整单目标
消息窗口绑定因果序号。模型只生成正文，Host 在本地组装现有传输 JSON，复用
`WorkerFinalOutput` 与 Kernel 事务入口；不读取最新 Room head 来冒充模型上下文。

发表发生在诊断/完整性写入结束后、原 Worker 凭据撤销前。丢响应后，只有持久 final
标记与交付 ACK 能恢复成功；没有证明时进入待处理，不重新发表或自动重跑模型。
正文发表不自动完成 Task，也不证明答案实质正确。默认工具路径及其他 CLI 的 JSON
开关保留；没有把普通 Codex exec 切为 app-server。

实际 Host/调度/Worker/Kernel＋假 CLI 已验证连续两轮、撤权、缺失/截断证明、stale、
提交前后丢响应和 HTTP 待决期间取消；真实安装 Claude 2.1.293 配合本地假模型已完成
同 session 两轮（第一轮真实 Write 后回答，第二轮回答，共三个假模型响应）。没有
模型发帖工具或发表后的额外模型请求；这不是付费成本或真实模型质量结论。
[完整证据与部署状态](evidence/2026-10-09-claude-native-final/summary.json)。

后续选择修正：已渲染但不适合原生正文的窗口（如 Task、多目标或截断）在输入前
关闭本轮未使用的原生提交器，保留既有 Worker 流程，不再追加“缺少原生 final”的
错误。缺失或无法验证的交付仍拒绝自动发表。专项验证截断窗口经 Worker check 完成后，
下一轮同 session 恢复原生发表；Task 仍须满足业务义务，ACK 不完成 Task。
真实 Claude 2.1.293 加本地假模型亦通过同进程三轮切换：原生发表→截断窗口实际
Worker check→原生发表。中间一轮的有效 native candidate 经重放确认，却没有发表
或生成 final marker；只确认消息交付，不证明业务答复或 Task 完成。初次沙箱元数据
权限失败保留；无付费或效率倍率结论。[修正证据](evidence/2026-10-09-native-selection/summary.json)。

忙时 Human 插话仍使候选失效。notice 不含正文或阅读证明，且可能来自另一个 Thread；
仅沿用原序号不能保证保存为 held，也可能把混合回答发表到原目标。须先补结构化目标
绑定，不能删除拒绝条件或解析通知文案猜测。长期付费对照与五 CLI 产品矩阵仍待完成。

## 2026-10-09 原生最终文本实验基础（历史切片）

负责人批准成本优先路线后，将此前私有原型的提交边界整理为可重跑的
[实验提交器](../../scripts/final-output-trial/native-text.mjs)及
[专项测试](../../scripts/final-output-trial/native-text.test.mjs)。
这是与下文历史 JSON 命令不同的显式 Run 模式：启动前冻结原 Worker 身份、交付序号和
模式；各 CLI 的适配器独立证明本轮原生 final 后，只将正文提交给已有 Worker。
模型不生成 schema、目标或因果字段；普通诊断文字、进程退出码本身仍不能授权发表。
当前正式 JSON 入口、默认工具入口和实验开关均未改。

实验提交器复用 `WorkerFinalOutput` 和已有 `/v1/worker/messages/final-output` 的
事务发布槽、跨入口 final 冲突与 unknown 处理；Host 在本地构造旧传输所需 JSON，
模型仍只生成正文。首版普通 Worker 入口的 marker 来源为空，新增测试明确失败后
改为专用入口；没有修改 Kernel 或另建发布槽。
没有向模型注册 MCP 回复工具，也不新建 ACK 或业务状态。原身份与交付值在创建时捕获，
调用方之后修改配置不能重绑定；一个 Run 固定一个提交槽。Worker 成功发表仍不等于
Run 结束、Activation 完成或 Task 完成。原生成功结束后，实际发表须在原授权有效窗口内
完成，再记录真实运行结束；不得重开已终止的 Run 来补发。

执行 `node --test scripts/final-output-trial/native-text.test.mjs`：
测试原身份唯一发表、同槽冲突、工具与原生 final 两种先后顺序互斥、
旧/错误/不完整候选拒绝、新 Human 事实触发 held、
提交后丢响应不重发、已确认结果重建同槽去重，以及缺交付/撤权/结束/移除成员拒绝。
unknown-after-commit 必须保留已经提交的 ACK 和消息，同时不能据丢失响应自动完成
Activation；不得将“未补 ACK”误报成“数据库没有 ACK”。
手工测试传入的 `completed` 只是夹具，不替代 CLI 原生终结验证。

Pi/Kimi 两轮真实安装 CLI 加 loopback 假模型已验证普通 final 与各自的身份、续轮边界；
Pi 后续 v2 免费双臂两轮已实际接入仓库实验提交器，产生两个可信 final-output marker；
Kimi 本批仍用原私有桥。Pi 的闭环也不包含正式调度，不能声称生产全链通过。
[本批证据与剩余工作](evidence/2026-10-09-cost-foundation/summary.json)；
[成本优先路线](evidence/2026-10-09-cost-foundation/roadmap.json)。
本批不报告真实模型成本收益，不覆盖完整调度、繁忙插话、压缩或五 CLI 产品效率。

## 显式 JSON 路径的最小协议及所有者（不适用于上述原生正文选择）

产品试验采用完整、单一的 JSON 对象（123仅为示例，模型必须回填本轮 Reply context 的实际序号）：

```json
{
  "kind": "room.reply",
  "version": 1,
  "basedOnRoomSeq": 123,
  "body": "要发表的正文",
  "final": true
}
```

这是显式发布命令，不是自动发布自然语言最终答案。模型不能指定作者、目标、Run、session、凭据或幂等键；目标来自原执行收到的交付，身份来自原 Worker 权限。不包含附件、跨目标、修订或 Task 完成；不新增 ACK 命令。模型显式回传 `basedOnRoomSeq`，只沿既有已呈现／已登记投递的确认规则处理，Host 不替模型填写序号或补 ACK。未知字段、多个对象、重复字段、普通文字、代码围栏、不完整 JSON 均拒绝；实验缓冲限制为64 KiB，不是产品合同的新预算。

原生适配器仅提取本轮明确的最终候选及结束证据。AgentHost 绑定原 Run，应用服务调用既有 Worker 业务路径；Kernel 仍独占新鲜度、事件、草稿、幂等与执行围栏。不能从 stdout 中搜索一段看起来像 JSON 的文本，也不能用“最近一次 Run”补身份。

## 免费实证

安装版 CLI 连接 loopback 假模型；没有真实模型费用。每家正常首轮及同 session 续轮均为一次模型 HTTP 请求；工具工作本来需要的请求仍保留，例如进度＋一次 Read＋最终输出的探针有两次请求，未把它们算成免费。

| CLI                 | 最终候选和身份依据                                                      | 重要负例／限制                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex 0.160.0       | 原 thread/turn；`agentMessage.phase=final_answer`；成功 completed       | 同响应的 commentary 中即使有合法 envelope 也排除；完整 final 已到但 turn 被中断仍拒绝                                                            |
| Claude Code 2.1.287 | result 的原输入 UUID、session、成功 terminal／stop 及正常进程结束       | 完整文本 delta 已到但取消后没有成功 result，拒绝；保留安装2.1.285及当前默认2.1.287均已免费复验                                                   |
| Kimi 0.39.1         | 对应 prompt region 的最终文本＋wire最后 step 的正常结束证据             | 截断时 ACP 也会返回 `end_turn`；必须核对 wire 的 `max_tokens`／`truncated`，缺证拒绝。首组旧实验shape含seq，仅证明原文传输，不作为最终schema验收 |
| OpenCode 1.18.32    | 原请求闭包、assistant `parentID`／message ID、无 error 且 `finish=stop` | HTTP200不证明成功；length、APIError、MessageAbortedError均排除。serve冷重启后原session恢复且历史保留另有免费证据                                 |

[脱敏摘要及原始文件哈希](evidence/2026-10-04-final-output-transport.json)。原始过程、失败、取消、恢复和离线检查在 `~/.loom/reviews/2026-10-04-channel-cost-research/final-output-transport/`。假模型按脚本输出格式，只证明传输能力，**不证明真实模型遵从率、真实token倍率或长期可靠性**。

## 第一阶段临时 Worker／Kernel 实验（历史）

可运行：`node --test scripts/final-output-trial/submission.test.mjs`。该冻结原型没有因果字段，测试明确保持 Activation leased；第二阶段真实全链发现发表成功仍缺 ACK，故产品协议增加模型显式 `basedOnRoomSeq`，没有用平台默认值冒充消费证据。

[实验提交器](../../scripts/final-output-trial/submission.mjs)不被任何生产 runtime 导入，只复用已有 `WorkerMcpExecution` 的原 Run HTTP 权限、幂等和未知写围栏，不另建业务处理器。适配器原生证据提取和这个提交器目前分开验证，没有把手工传入的 `status=completed` 冒充实际 Host 全链证明。

8项测试先复现缺实现及空身份绑定漏洞，再验证：严格显式 schema；原身份／原目标只发表一次；同槽变体冲突；绑定必须含非空原生身份；候选身份错误、失败／取消／非终态／多候选不发送；新Human事实导致已有持久held且零发布／零final marker／游标不前移；提交后丢回执在同提交器内不重发；真正结束的Run即使本地liveness提示陈旧也被Kernel拒绝；重建实验提交器仍复用原业务幂等键。没有从成功退出推导 Task 完成或补 ACK。

## 产品接入的边界

P113后的共享final前置检查也适用于本显式输出入口：新final发布必须已有本消费者的真实delivery ACK，或满足同Run完整presented prefix的既有Host发送登记竞态；仅有显式seq、但正文因notice或事件缺口未完整交付，仍拒绝整个发布事务。专用 `final_delivery_unconfirmed` 表示本次没有新消息或marker提交，不改变未知写入围栏。历史成功精确重放保留；pending始终不是ACK。共同所有者和反例见[Worker final消费设计](worker-mcp-reply.zh-CN.md#p113-后的-final-消费前置检查设计2026-10-05)。

1. **在原 Run 的有效授权内收尾。** Host 的成功 native outcome 后、记录 runtime 终止前，完成有界提交并继续原有监督／续租。当前接入源码部署的 OpenCode 与 Codex warm；SEA 仍走原有 CLI 路径。未来 cold 接入不属本批：现有 cold adapter 在 resolveExit 前释放凭据，不能直接在已撤权的 `finishRunAttempt` 旁补一个发帖回调；届时需要明确调整释放顺序，不能复活旧Run。
2. **最终发布槽必须事务一致。** 第一阶段的既有 final marker 只记录首个 final 事件；当时复核工具 final 后再交 envelope，第二次被新鲜度检查暂存，**未复现双发布**。第二阶段已在 Kernel 同一事务内实现两种最终传输的冲突检查：先有工具 final 时拒绝输出 final，先有可信输出 final 时拒绝不同事件的工具 final，精确成功重放保留，避免为这些冲突创建多余 held 草稿。约束不由 Host“先查再发”实现，也不施加到所有普通多消息运行。可信来源来自专用 Worker 入口及原 Run 权限，不来自模型字段或可伪造的幂等键；普通进度消息不会被当作最终完成。
3. **held／未知结果有明确去向。** 正常成功不为回执额外唤醒模型。held仍由现有草稿owner持久化，Human须能看到未发表原因与正文；不能在模型没有读到新事实时自动确认、原样发送或搬用旧读取凭据。既有同Activation重试可以保留session，但必须新Run／新凭据；无新事实不能空转重试。未知结果先核验或交Human处理，不建第二后台重发队列。

首个产品纵向切片选择 OpenCode warm：P105已经测到收尾生成成本，且其正常、截断、错误与取消的终态区分最直接。统一的是发布协议与Kernel语义，各CLI的结束证据仍分别适配；不要一次扩建四套Host生命周期。一家完整纵向安全路径通过后，再做已有授权范围内的有界真实同题对照；不扩大四家生命周期或改变付费模型矩阵。

## 本纵向切片的验收状态

首个接入仅覆盖具有唯一原回复目标的 OpenCode warm 普通消息；多目标、附件和需要继续工作的进度消息继续使用现有工具。不是根据正文猜测该不该发表：只有完整显式命令、原生正常终态、原请求身份和有效原Run同时成立才提交。

本切片已按先红后绿完成 Host／Kernel 回归：成功结束到提交之间续租不断；提交前取消或撤权零发布；已提交但回执丢失不重发；工具final与输出final相遇返回明确既有结果或冲突；held持久可见且不空转；缺少交付ACK时仍不能完成Activation。真实安装OpenCode＋假模型已贯穿这一条路径，验证同session下一轮仍可工作。P108已完成有界付费同题对照，数值预算通过而实质质量失败；原生记忆按精确版本政策隔离，完成生成与累计/未缓存输入分别核对。本批没有独立provider HTTP请求总数。正式服务已备份迁移到schema83，实验开关保持关闭，部署凭据见status。

第一阶段仅为研究；第二阶段已修改生产源代码，但默认关闭，通过本地 daemon 环境 `LOOM_OPENCODE_FINAL_OUTPUT_TRIAL=1` 选择试验，不读取模型提供的开关。未经单独记录的付费验证和正式重启不得声称部署完成。现有付费失败和缺口不被免费探针覆盖。

第一阶段验证：上述8项实验测试、完整 `npm run check`、`npm run format:check`、`git diff --check` 均通过；文档链接与私人证据哈希已核对。完整检查不包含这个opt-in实验，故实验测试另行运行。

## 第二阶段实现与真实免费证据

原生 driver 只在成功正常终态下提取原 session／parent 的单段最终文本。shared warm adapter 等待已收到的观察帧落地，在原凭据释放之前提交，Host 的租约维护继续覆盖 HTTP 等待；提交前取消拒绝发送；请求在途取消且结果不明时保留未知结果，不重发，已取得的明确发表回执仍予保留。原生终止状态与发表收据分别传给 Host。失败重试入口保留该 Run 的收据；结果不明时使用现有 `action_required`，不新建后台重试队列。

Protocol 定义严格 envelope／请求；application-service 的新 Worker 路由只接收正文和模型显式序号。Kernel 复用原 post 事务、权限、原目标、freshness 和消费证据，派生固定幂等键；schema83 给既有 final marker 增加可信 `submission_kind`，旧 marker 保持 NULL，不从可伪造的 key 推断来源。显式输出与工具 final 在同一事务中互斥，精确成功重放保留，旧普通多帖不受新规则影响。多目标歧义沿既有409拒绝，不猜目标；held仍是可见持久草稿，不合成已读证明。

真实安装 OpenCode 1.18.32＋loopback 假模型的证据在 `~/.loom/reviews/2026-10-05-final-output-product/`：修复后两次请求各回填当轮序号，两个 Run、两个已完成 Activation、同 session／runtime，两个可信 marker；原生库恰两个 assistant、零 tool part，第二请求带第一回复历史。早期“已发表但没有 ACK”的三次诊断保留了两份独立失败 JSON 和原生 drain 记录；第二次诊断的结果 JSON 在调试中被覆盖，未宣称三份原件均完整留存。假模型遵从格式不能证明真实模型遵从率、成本或长期可靠性。

[第二阶段脱敏免费证据](evidence/2026-10-05-opencode-final-output-free.json)。7项Host全链回归覆盖两轮唯一发表、held、缺登记确认、输出前取消、drained后提交前取消、等待续租及提交时运行时死亡；未知写和所有失败重试入口另有专项反例。

## P108 付费结果

[同题三轮报告](evidence/2026-10-05-final-output-p108.md)：原生与Loom各自同session，生成均为2/1/1，输入1.140倍、未缓存1.082倍；产品用量完整，逐轮数值预算通过。模型3/3输出被原凭据路径发表，但答复包含PID证明错误和不成立的测试标准，实质质量不通过。保留原机器needs-quality-review与独立失败判定，不据此宣布整体验收或四家验收通过。

## Codex warm 接入

OpenCode P108 后接入 Codex，复用同一严格envelope、原Run有界提交和Kernel事务；没有新增API或数据库迁移。Codex原生证据提取器只收原thread/turn的 `item/completed`、`agentMessage.phase=final_answer`，接受同一原始项的精确重复，多个不同最终项、缺phase、缺身份、错误、中断、超限或未完成工具均不能产生候选。匹配的正常 `turn/completed` 到达即冻结候选，等待忙时输入回执期间的晚帧不能替换它。`dynamicToolCall` 加入既有在途工具集合，专项反例先红后绿。

使用独立daemon开关 `LOOM_CODEX_FINAL_OUTPUT_TRIAL=1`；OpenCode仍用自身开关，不能交叉启用。默认关闭，SEA与cold路径不变。启用时wake只选择最终输出，不再同时要求 `loom_reply`；通用system指引明确它是message-post/MCP最终回复的例外，其他Worker操作保留。原生MCP bridge及readiness握手仍保留，不以隐藏工具绕过原生能力验证。

7项真实Host/Kernel＋假app-server集成验证两轮同session唯一发表、默认off、commentary排除、中断/取消零发表、缺登记ACK不能完成，以及未知写action_required且不自动重跑；helper/真实driver另有身份、唯一性、终态和在途工具反例。真实安装Codex0.160.0＋隔离loopback假模型已两轮贯穿生产链，每轮恰1HTTP、两个可信marker/两个完成Activation，同thread同runtime；commentary合法命令诱饵未发布。合成usage不作成本证据。模式切换后同session重建沿既有逻辑，本批未独立重测该组合。

[Codex免费脱敏证据](evidence/2026-10-05-codex-final-output-free.json)。P109付费首轮暴露非法JSON，严格拒绝、零发表，整批失败；免费证据不能证明真实模型格式遵从。见[P109报告](evidence/2026-10-05-final-output-p109.md)。正式源码已在本批备份重启，试验开关保持关闭；见[部署凭据](evidence/2026-10-05-codex-final-output-deployment.json)。

## P109 后的原生格式约束修复

Codex0.160.0稳定app-server的 `turn/start.outputSchema` 明确约束本轮最终回复。启用试验时，每次turn/start直接传入 `WorkerFinalOutputEnvelopeSchema.toJSONSchema({target:"draft-7"})`，避免另维护一份发布协议；默认路径不带outputSchema。字段序号仍由模型显式回传，Host不代填，不自动修JSON，也不发纠错轮。格式约束只管结构，原Run/目标/权限/新鲜度/ACK仍由原路径验证，不能据此保证内容正确或吞掉API不支持错误。

缺少原生outputSchema的专项测试先红；接线后driver和7项Host链通过，包括默认路径没有新约束。[安装版CLI免费实证](evidence/2026-10-05-codex-output-schema-free.json)验证同session两轮，首轮真实exec工具后回复、次轮直接回复，共2+1次loopback HTTP；每次实际请求text.format均为json_schema/strict:true且schema一致，两个唯一发布/ACK完成。首次探针误假定可选tools数组存在导致探针失败，修正探针后的成功与失败均保留。假服务收到schema不能证明真实供应商必然强制约束或答案正确；P109原失败保留，后续如有付费验证必须作为新代码批次记录。

P110付费验证在模型生成前被测试护栏阻断：原turn/start白名单未接纳outputSchema，随后连续性保护拒绝替换session，零发表。见[P110失败报告](evidence/2026-10-05-final-output-p110.md)。这不证明真实provider支持或不支持结构化输出；修复必须连同同款paid guard做免费全链验证，只放行精确Protocol schema，不放宽model/effort或其他字段。

P110护栏修复仅放行Protocol生成的精确draft7 schema，保留模型、effort和其他字段限制；相关69项免费测试通过。[同款付费护栏免费闭环](evidence/2026-10-05-codex-output-schema-guarded-free.json)已用真实Codex验证同session两轮、实际HTTP为2+1、工具前后及续轮均携带严格schema、两个发表和ACK完成。它补足测试接线覆盖，不改变P110失败，也不证明真实模型质量或成本。

## P111 Codex付费验证

[P111报告](evidence/2026-10-05-final-output-p111.md)：固定题目、官方自动记忆关闭、本批独立原生分母。两边生成均2/1/1，累计输入1.226倍、未缓存1.194倍，首代差2708，三轮可信发表及ACK、usage完整，数值预算通过。原生输出格式约束修复后的本样本不再出现非法JSON；这不承诺长期零失败。答复核心PID可信性边界正确，实质质量及指令瑕疵单独记录。没有独立HTTP总数，不将token倍率写成账单倍率；P109/P110失败仍保留。正式实验开关保持关闭，其他CLI和长session未由本批验收。

## P112 上下文去重试验（失败，已回撤）

候选bd5c071仅精简现有指引，不新增协议profile或改变提交状态机；P112失败后已整体回撤，不是当前生效说明。编译器是平台说明的唯一组装者：Workspace mode/Tool access保留在runtime context一次；缺消息时的`message-check --startup`动作不变，删除其重复实现细节；startup引用当前回复路径，具体CLI语法仍由Worker段说明，显式最终输出由现有opt-in段说明。每轮wake只选择transport，进度、附件和其他目标的工具回退说明放在站立指引中一次。保留完整JSON示例给没有原生schema的OpenCode，并保留当轮seq显式回填、禁止重复工具发布及完成工作后才final。

Role原始配置和指令、memory、权限、Task、held/unknown、ACK以及Kernel围栏未改。共享说明影响其他CLI的静态prompt；本批真实付费结论只针对Codex，不推断四家都受益。固定编译夹具与实际安装CLI的免费链分别记录字符/请求结构，不能当作token或账单证据。

协议摘要随唯一协议正文更新，旧实例仍按原session ID恢复，不以prompt摘要变化新建session；存活warm进程不会仅因磁盘源码变化自动替换其已载入说明。即使恢复调用携带新说明，也不保证原生历史中的旧文本被抹除。本批免费验证与独立付费配对分别保留，不改判P109/P110，也不复用P111分母。

[本批免费证据](evidence/2026-10-05-context-compaction-free.json)：相同Role/runtime/memory输入，旧24a6ea8与当前正式编译器及最终指引渲染7168→6860字符，wake尾140→40字符。真实Codex+正式guard+fake验证新session两轮2+1请求；另以旧真实接线建session、关pool后用当前接线恢复同ID，三轮2+1+1请求，三个可信发表/ACK完成，协议notice仅第二轮当前wake出现、完成后接受新版本。各请求strict schema，原生memory_mode=disabled。升级夹具组合了正式store/upgrade owner，但不是完整daemon配置迁移验证；三次夹具路径/descriptor设置失败保留，未放宽guard。

[P112真实付费结果](evidence/2026-10-05-context-compaction-p112.md)未通过：首轮误选MCP并把频道填入threadId，scope拒绝后读help并转CLI --final，后续两轮也走CLI。三条marker均无final-output来源；ACK成功但首轮多两次协议生成，累计输入1.921倍、未缓存1.444倍，整批over-budget。outputSchema只约束最终文本，不能限制模型先选工具。已恢复全部产品源码到24a6ea8，未保留任何未经独立验收的精简子集，也未追加付费抽样。P111的成功只证明该路径可工作，不证明稳定采用；本里程碑是保留可复现基线和明确失败边界，不是宣告效率问题解决。

## Kimi cold ACP 原生正文接入（2026-10-09）

本节补充早期“cold 接入未来再做”的边界：Kimi 沿用正式 `kimi-acp/v1`
与原生 session/resume，源码部署由 `LOOM_KIMI_NATIVE_FINAL_TRIAL=1` 显式选择，
默认关闭，SEA 不开放该试验。只有 Host 已完整呈现、无 notice 缺口且只有一个
可回复消息目标的 wake 才选择 `native-final-text`。Task、多目标等仍用 Worker
工具；不从原生退出或自然语言推断 Task 完成。试验路径不启动只负责最终回复的
MCP bridge，其他 Worker CLI 操作保留；默认路径保持原 MCP 与 final interrupt。

所有权不变：`kimi-acp-final-output` / `kimi-acp-final-capture` 只验证本轮原生证据；
`kimi-native-final-lease` 只持有原 Run 的易失传输状态与原 Worker 凭据；
`GenericProcessAdapter` 继续拥有退出、fd3 排空、取消及凭据释放次序；
`WorkerFinalOutput` / Kernel 继续独占一次提交、权限、新鲜度、幂等、held 与消费确认。
没有第二份队列、历史游标或业务完成状态，也没有后台自动重发。

候选必须同时满足原 launch/session/prompt 绑定、ACP 正常 `end_turn`、所有工具结束、
原生进程正常退出，以及本轮 wire 最后 step 的 `end_turn` 和 `turn.ended completed`。
ACP 文本必须与最后 step 正文一致；压缩通知不混入正文。已知工具的无状态终端展示
更新只保留原执行状态，不能证明工具结束；明确非法状态或陌生工具仍拒绝。wire 在 prompt 前记录
inode/device/offset 与前缀 SHA256，收尾流式复核前缀并只解析有界新增区间；
截断、替换、前缀篡改、超限、缺记录、模型或 effort 不符均不能产生候选。
这会读取旧前缀以核验完整性，但不会重新把旧历史发送给模型。

Host 校验私有 proof 文件的 launch/session/turn 与已验证 wake 接受记录，
在原凭据仍有效且尚未记录 Run 结束时提交。取消信号在进程退出后仍有效；
未知回执不重试，较新 Human 事实进入既有 held/action-required 路径。
proof 随租约释放删除，进程恢复不能据它重新发表。standing 文件和首轮 inline
使用相同试验指引，防止压缩后读文件丢失传输说明；这不声称压缩后的真实模型行为已验收。
本批范围是新建试验 session 后原 session 续轮，既有 MCP session 切换模式仍未验收。

实现、自动测试、真实安装 CLI 加本地假模型以及付费效率的结论分开记录于
[当前状态](status.zh-CN.md)和[运行账本](paid-runs.zh-CN.md)。免费运行的合成
usage 只验证请求到 Kernel 的核账完整性，不能替代多 CLI、多模型长任务成本对照。
