# Worker 合同二次核验：ACK、Task 与帮助文本

日期：2026-09-11。仅核对本机当前 RAH OS 与已提取 Raft Computer 1.0.18；没有运行付费模型，也没有将服务器未知行为写成事实。

上游：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。下列行号指该冻结提取物；结构对照不是字节复制。

## 1. ACK：差异成立，丢消息断言不成立

Raft `messageCheckCommand`（729502）声明返回前确认已投递序列。其 `drainInbox`（677012–677039）实际循环调用 `events.get({ since: "latest" })`，上限 50 轮，收集消息并返回；该函数没有独立 ACK 请求。源码证明 Agent 不必手填序号，不能证明不可见服务器的读取与确认事务，尤其不能据此宣布另一个设计是“唯一会丢消息”的差异。

RAH `worker-cli.ts:1912–1913` 暴露 `sync` 与 `acknowledge --through-seq` 两步。`worker-application-service.ts:736–758` 记录实际投递游标，1043–1063 验证已投递且不超出 Activation，再调用内核确认。独立确认增加模型操作负担；缺少确认通常意味着工作不能完成/重复恢复，不能直接等同消息丢失。

建议下一批增加工具侧有界 drain/check 门面，复用既有 sync/ACK 和凭据围栏，模型无需构造游标；保留底层独立动作供兼容和诊断。需先决定并测试输出/ACK 失败与进程崩溃窗口，不能把任意 room-read 当作 Inbox ACK，更不能移除 Activation 完成围栏。本批未改 ACK 语义。

## 2. Task：命令形状不一致，但不能以拆分数量推导八项功能全缺

Raft `taskUpdateCommand`（730415–730443）接受 target、number、status，调用 `tasks.updateStatus`；本地帮助公开 start/release/progress/block/request-input/submit/review 等专门命令（`worker-cli.ts:1958` 起）。这是模型输入合同差异。一个统一门面可以映射现有应用服务；无需仅为 URL 形状把内核状态机合并，更不能编造缺失的审查证据、批准或 summary 来跨越现有权限。

Raft claim（730159–730240）把所有 task_numbers/message_ids 一次交给 API，成功渲染 results，freshness hold 分支明确称本次 claim 未应用。RAH `worker-cli.ts:455–518` 逐条发请求；普通业务 conflict 记录逐项失败后继续，其余 transport/authority 错误或 freshness hold 停止，已落账结果与未尝试数量单独输出。差异成立；“先前成功被隐藏”已不是当前代码事实。上游客户端的整批 hold 文案支持将批次作为 freshness 判定单位，但不足以证明服务器所有失败类型都数据库事务全有或全无。

建议独立实现批量应用服务：同一读取基准做整批 freshness 预检；区分整批 hold、逐项业务失败及成功结果；为部分失败/重试/重复编号加真实账本测试。不得仅改文案声称原子。本批未改 Task 语义。

## 3. 帮助文本：确认并已最小修复

旧帮助称所有命令无需 causal cursor 或 idempotency key，却明确列出 `acknowledge --through-seq`、`artifact-publish ... --idempotency-key KEY`。这是真矛盾。选项可选接受不等于模型必填，因此仅用可选选项命中数不能证明所有常规命令仍强迫模型管理 key。

本批将绝对声明改为常规 Room/Task 操作自动管理，明确 ACK 序号和 Artifact key 例外及同次发布重试复用 key。未删除幂等保护、兼容选项或 Artifact 的既有合同。

TDD：新增帮助例外测试，修复前断言失败（`/tmp/worker-help-red.log`）；修复后整个 `worker-cli.test.ts` 46 项通过（`/tmp/worker-help-green.log`）。父任务负责全量集成检查。

## 4. mute attention：可选响应面缺口成立

Raft schema（17204–17218）有可选 attention 对象，含 state、ordinaryActivity、unmuteCommand、unmuteApi、muteCommand、muteApi、stillArrives、threadBoundary、catchUp 九个可选字段。其 formatter（675385–675401）条件输出其中八项；state 不是必打印字段。RAH `worker-channel-attention.ts:31–43` 只含 activityMuted/muteFromSeq 加本地回执，`worker-read-render.ts:1179–1189` 只输出三行。

因此存在结构和说明输出差异；“上游每次恒返九字段”不能从 optional schema 推出。建议按本地已实现投递语义生成准确说明，归属 kernel/app-service 投影，再移植条件渲染结构。实际 muted 状态下 mention、thread、catch-up 行为须逐项测试，不能先填上游文案假装实现。本批未新增字段。

## 施工优先级与边界

本批只完成帮助文本修正。后续顺序：工具侧 drain/check 恢复闭环 → 批量 claim 的同基准 freshness/逐项结果 → status 门面逐状态映射 → mute attention 说明与行为对照。四者可分不同 owner 并行设计，但不可同时改同一个大 CLI 文件或共用 Kernel 事务入口。所有 ACK、Task 状态与幂等不变量保持有效。
