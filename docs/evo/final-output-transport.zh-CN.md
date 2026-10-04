# 显式最终回复输出：OpenCode／Codex 纵向接入

2026-10-04 完成四家免费传输研究；负责人随后要求继续，2026-10-05 接入 OpenCode warm 纵向路径。当前通过真实安装 CLI＋本地假模型的两轮 Worker／Kernel／Host 全链：每轮一次假模型请求、同 session、两个完成的 Activation、两个可信 final-output marker、没有 Worker 发帖工具调用。随后 P108 真实三轮传输和数值预算通过（输入1.140倍，双方生成2/1/1），但实质审查质量失败，**不是整体验收通过**。 当前正式部署见 [status](status.zh-CN.md)，预算和目标合同不变。

## 最小协议及所有者

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

[Codex免费脱敏证据](evidence/2026-10-05-codex-final-output-free.json)。当前付费对照及正式部署待后续记录；上述免费证据不覆盖P108的质量失败，也不能证明Codex真实模型遵从率或长期成本。
