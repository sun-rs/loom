# 内部 Worker MCP 回复：源码部署的三家适配

日期：2026-10-04。承接 [四家免费协议验证](evidence/2026-10-04-worker-mcp-four-cli.md)，目标合同不变。当前源码实现接通 Codex warm、Claude 默认 cold 和 Kimi cold；Claude opt-in warm、Codex cold、OpenCode 与 SEA 保留既有 Worker CLI。共享工具与 Worker 业务契约，不声称四家都已产品接线或效率达标。部署与付费状态以状态页和本批证据为准。

## 边界与唯一所有者

- `packages/protocol/worker-mcp.ts` 拥有工具定义与业务参数验证。`loom_reply` 发布本次交付目标的正文，显式选择 final／progress，或修订已有 held draft；附件、跨目标和其他操作保留 CLI。
- AgentHost 拥有每个 Codex warm runtime 或 Claude/Kimi cold Run 的私有 Unix socket、传输认证和原 Run 凭据闭包。MCP 子进程只持有连接本 runtime 的认证值，业务凭据不进入模型参数或 CLI argv。现有同 UID/full-access 限制不变，不宣称操作系统级隔离。
- Worker 应用服务与 Kernel 继续拥有作者、目标、权限、新鲜度、幂等、草稿、事件、Inbox／Activation／Task。MCP 只调用既有 `POST /v1/worker/messages/post`，不另建业务处理器、队列或游标。

Codex 的 MCP 参数 schema 直接暴露（本内部服务 `omit_tools_from=["deferred"]`）。首次与恢复都核验当前 thread 的服务连接及精确工具定义，失败不进入模型轮次。不改用户全局配置；用户 MCP 继续按名关闭。已有用户服务占用内部保留名 `loom_worker` 时，在启动 app-server 前明确拒绝，避免配置合并。原本没有该工具的 session 可在进程重启后按原 ID 恢复并获得工具，不创建替代 session，也不依赖尚未验证的热加载。

## 调用与结束

模型只提供业务字段。Codex warm 的 Host 按 CLI 自动附加的 native thread/session/turn/call ID 查已注册的原 Run；重复身份字段冲突、缺失或过期均拒绝。启动响应到达前的调用只有限等待已有原始 admission，比较精确 ID，不转移到后来登记的 Run。结束／撤销时关闭绑定并中止尚未完成的传输，Kernel 的原执行围栏仍生效。

每个原 Run＋native call ID 导出固定幂等键，同调用同参数共享原结果；不同参数拒绝。网络、无法识别的成功结果和服务端失败保留为未知，不自动重发；该原 Run 的后续 MCP 写入拒绝并要求 Human 核实。这是有界、临时的传输状态，不是第二份业务账本，也不能约束同 UID 程序绕过 MCP 直接使用既有 CLI。

新帖必须明确 `final`；草稿修订只接受正文和 draft ID，保留 Kernel 保存的原意图与目标。工具返回不等于 ACK。held／目标确认仍返回既有业务状态，并明确通过原 CLI 读取／恢复；本切片不签发 MCP 消费 receipt，不以 Host HTTP 返回或内层工具完成证明完整上下文送达。因此不宣称 MCP held 路径有精确取消收益，既有 CLI 的完整输出收据路径保留。

最终结束仍只由 Host 读到 Kernel final 标记触发。Codex 中断还需等待同 thread/turn/call 的外层代码执行返回及全部内层工具完成；新内层调用撤销前一代码单元的完成记录，不能借用旧输出提前结束。缺 raw 帧、未知返回格式、多个内层调用归属不明、yield／无法闭合的代码单元保守自然结束。诊断事件只决定中断时机，不创造业务完成。不能用 `preemptedFollowUp=true` 替代实际模型请求计数。

## P113 后的 final 消费前置检查设计（2026-10-05）

[P113](evidence/2026-10-05-long-session-p113.md) 的默认路径先成功发表final，因模型省略因果序号而未ACK，随后同一Activation重跑并重复发表。修复的唯一业务所有者为 Kernel 的 `RunAttemptFinalReplyService.recordInTransaction`：两条发帖路由以及草稿真正发表时都经过同一事务终点，先沿原有规则尝试ACK，再判断是否能提交新final。

允许条件为同Room/participant/consumer的真实cursor覆盖Activation head；因此合法 `message-check` 后无需重复传seq。另一条件仅保留既有Host发送登记竞态：同Activation/consumer/Run的模型 `pending_ack_seq` 覆盖head、原始冻结presented prefix完整覆盖head，且发送尚未登记。该只读资格复用 `activation-presented-window` 的原prefix算法，不复制游标或投递状态，不把pending提升成真实ACK。Host永不登记发送仍是未确认状态，本刀不宣称排除此故障。

其他新final拒绝整个发布事务，正文、事件、附件消费、marker及其hint均不能部分提交；使用专用 `final_delivery_unconfirmed` 错误区分“确定回滚、纠正后可重新提交”与未知写入。显式seq存在但正文notice降级、遗漏事件或借用其他Run的pending都不足以放行。progress不受此终态条件限制；held仍可保存意图，真正发送或修订发表时才检查，拒绝不能吃掉旧草稿。已有同Run、同event的成功final精确重放保留原结果，不重判历史成功；旧progress升级final不属于该例外。

MCP schema不改为一律必填seq，以免破坏先check后省略seq及只传body/draft ID的合法修订；代码执行规则，恢复指导只在错误中出现。未知网络/5xx/幂等身份冲突的围栏不放宽。实施及免费、真实CLI、付费和部署结果分别以状态页和新批证据为准，不回写P113失败为通过。

## 验证与限制

自动测试覆盖严格参数、重复／冲突调用、原凭据作者、旧 turn 拒绝、提前到达不借用后续绑定、未知结果不重发、held 不合成 ACK、MCP stdio 往返、两轮 warm 自动接线，以及代码模式外层返回保护。

安装版 Codex 0.160.0＋产品 warm driver／MCP entry／Host bridge＋临时真实 Worker／Kernel 的免费探针通过：同一 session 两轮各发一帖，作者与 Room 正确、旧 turn 拒绝；工具定义自然暴露；前批两份完整外层回执与真实 Worker JSON 深度一致。progress 轮有2次本地假模型请求；final 轮由真实 Kernel 标记触发结束，实测1次请求。该探针的 Host scope、ACK 和运行终止由夹具管理，不冒充完整 AgentHost 调度验收；后者另由 fake app-server 的自动接线测试覆盖。

真实 CLI 探针使用已有可信的同版本 Codex 安装副本、隔离实验 home 和 loopback 假 provider，官方自动记忆关闭，没有真实模型费用。第二单元边界修复后免费复验仍为 progress 2 次／final 1 次请求，两份完整回执匹配；本次产品 driver 的全部 3 个实际请求均明确 `parallel_tool_calls:false`。并发 outer 的纯函数反例不符合当前已测请求声明，但不宣称 CLI 强制拒绝异常 provider，未来 provider／模式／配置变化须重验。合成 final 样本证明这条路径可行，不保证真实模型和所有时序均无续生成；该免费探针没有 token 倍率。部署、全量检查和新付费效率验收分别记录于 [状态页](status.zh-CN.md)，P97 失败结论保持。

OpenCode 的免费研究发现可通过本地原生 hook 关联 session/call、唯一 running part 与 Host 输入消息，但当前 `--pure` 不加载 plugin；不能直接放宽到加载用户插件。其现有 final 控制在两份免费样本中保留完整结果，却仍发出第二次模型请求。其产品身份适配和无额外生成路径均未收口，不随本切片接线。

证据：[Codex 产品链免费摘要](evidence/2026-10-04-worker-mcp-product.json)。探针、红绿日志及失败证据归档于 `~/.loom/reviews/2026-10-04-channel-cost-research/worker-mcp-product-fixture/`。

P98 付费进展（2026-10-04）：原生门禁实际使用 Homebrew 安装路径，代码执行宿主超时、未读到源文件；Loom 首轮也遇到相同超时，在质量核验后取消，后两轮未启动。故无有效同任务成本倍率。此前免费成功探针使用另一已有同版本／同哈希安装，不能替代本次实际执行路径的健康验证。预检遗漏、已发生用量与止损证据见[P98报告](evidence/2026-10-04-worker-mcp-cost-p98.md)，没有付费补跑。

后续免费复验：P98实际Homebrew路径的原生文件读取／同session恢复及warm MCP两轮均通过，未再握手超时；没有改动系统安全属性，也没有启动付费模型。Owner观察到macOS辅助程序打开确认，为此前故障提供了新的系统启动线索。该结果只恢复工具健康证据，不改变P98失败与无有效成本倍率的结论。见[同路径健康证据](evidence/2026-10-04-codex-homebrew-health.json)。

## 本批收口：精简回执与固定 Run 冷路径

P99真实对照发现成功回执重复包含刚发表的全部正文。`protocol/worker-mcp-receipt.ts` 现在把已通过 Worker 成功 schema 验证的 `message.posted` 映射为发表回执：保留 Room、序号、消息／事件／作者、线程、去重结果、后续 activation IDs，以及未命中 @ 与替换草稿警告；普通成功不回灌正文。held／目标确认和错误继续原有信息及恢复规则，未知结果不转成成功。HTTP 业务响应和 Kernel 事件没有改变，不生成 ACK 或 Task 完成证明。

发送、同调用缓存和 unknown 围栏由 AgentHost `WorkerMcpExecution` 共用。Codex 保留原生 thread/turn/call 匹配。Claude 与 Kimi 每个冷进程对应一个不可变原 Run，Host 创建独立私有 socket／连接 secret 并持有原 Worker credential；恢复沿用原生 session ID，不沿用旧 Run 权限。共同 cold lease 读取 Host 自己的 owner-private、非符号链接 credential 文件，结束先撤销 bridge，再释放既有 lease。SEA 保持原 CLI 路径。

Claude 使用原生 `claudecode/toolUseId`，不假造 session/turn 元数据。Kimi 没有该元数据，使用 Host 每 Run 固定 namespace 与原生 JSON-RPC 请求 ID：entry 覆盖模型可能夹带的同名字段；entry 重启仍重放原调用，变参拒绝，绝不通过“当前 Run”借权。同 Run 重连后客户端若把同 ID 用于新业务，会保守拒绝。

Claude init 核验内部服务 connected 且准确工具名，不声称 init 含完整 schema。Kimi 在原生声明支持本地 `/mcp` 后，以有界只读查询等内部服务 connected；实测零模型请求、状态文本不进入首轮或恢复后的模型历史。异常不默默告知模型工具可用。

免费真实 CLI＋生产 driver／Host bridge／临时真实 Worker/Kernel 两轮均完成：原生 session 连续，原作者、唯一发表、完整精简工具回执、原 Kernel final 控制通过。Codex final 合成样本 1 次假请求，Claude 和 Kimi 每轮仍 2 次；回执保全后发出的异步取消不能保证赶在下一请求前。不能把 `preemptedFollowUp` 当成 HTTP 请求数。各自完整 Host 调度仍以集成测试与付费门禁分开确认。

[OpenCode 当前边界](worker-mcp-opencode-boundary.zh-CN.md)决定其暂保留已验证的 CLI 路径，不放开用户插件或把 warm 偷换成 cold。P99–P103付费／失败／统计更正分别见[Codex与Claude](evidence/2026-10-04-worker-cost-p99-p100.md)、[Kimi与OpenCode](evidence/2026-10-04-worker-cost-p102-p103.md)。

修正后同题付费对照：[P104 Codex](evidence/2026-10-04-worker-cost-p104.md)两边均2/1/1次已记录生成，总输入1.218倍，数值预算与独立质量通过；[P105 OpenCode](evidence/2026-10-04-worker-cost-p105.md)工作目录纠正后仍每轮多一次收尾，输入2.158倍。后者既有门禁数值通过不代表成本接近原生；三轮单样本也不证明跨CLI或长期、多实例场景收口。

P106 暴露的接线与计量缺口另行修复：冷进程原先只安装工具，未提供 Codex warm 已有的入口指引，真实模型仍选旧 CLI。现在三条路径复用 `worker-mcp-guidance.js` 的同一句每轮指引；Kimi 在本地 readiness 通过后追加，Claude 依据 Host 本 Run 配置追加、继续核验原生 init，不能声称提示写入晚于 init。Claude 只有精确完整 MODEL_INPUT 回放才报告原 wake 的送达摘要，原 ACK 围栏不变。

取消不证明请求未发起。Kimi wire 的已发起 `llm.request` 若无同 agent／同 step 的有效 usage，产品保留已报告值并标缺口；门禁独立核对请求覆盖率，不接受不完整原生分母或不完整产品成本。不同 agent、跨轮或重复 response 不能抵消缺口；没有请求记录的 step.begin 也不能推测一次计费。P106 原始证据与后来缺证判定见[报告](evidence/2026-10-04-worker-cost-p106.md)。

[P107](evidence/2026-10-04-worker-cost-p107.md) 已验证新指引后的真实 Kimi：三轮各一次 MCP 成功发布，完整回执与 Kernel final 标记一致，原生 session 连续。记录的输入比率不代表完整成本：8次原生请求只有4条usage，包含3次发布后取消和1次provider内部错误重试；产品显示partial、门禁缺证且延迟超预算。三家已接通不等于三家经济性相同；当前证据支持优先保留Codex已验证的短任务路径，OpenCode和Kimi的后续请求边界仍是成本限制，不能用成功交付或未报告用量绕过合同。
