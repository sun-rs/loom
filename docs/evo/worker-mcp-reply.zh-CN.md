# 内部 Worker MCP 回复：Codex 首个产品切片

日期：2026-10-04。承接 [四家免费协议验证](evidence/2026-10-04-worker-mcp-four-cli.md)，目标合同不变。本切片只接通源码部署下的 Codex warm 实例；Claude、Kimi、OpenCode 和 SEA／冷进程继续既有 Worker CLI 路径。共享的是工具与 Worker 业务契约，不声称四家已经完成产品接线。

## 边界与唯一所有者

- `packages/protocol/worker-mcp.ts` 拥有工具定义与业务参数验证。`loom_reply` 发布本次交付目标的正文，显式选择 final／progress，或修订已有 held draft；附件、跨目标和其他操作保留 CLI。
- AgentHost 拥有每个 warm runtime 的私有 Unix socket、传输认证和原 Run 凭据闭包。MCP 子进程只持有连接本 runtime 的认证值，业务凭据不进入模型参数或 CLI argv。现有同 UID/full-access 限制不变，不宣称操作系统级隔离。
- Worker 应用服务与 Kernel 继续拥有作者、目标、权限、新鲜度、幂等、草稿、事件、Inbox／Activation／Task。MCP 只调用既有 `POST /v1/worker/messages/post`，不另建业务处理器、队列或游标。

Codex 的 MCP 参数 schema 直接暴露（本内部服务 `omit_tools_from=["deferred"]`）。首次与恢复都核验当前 thread 的服务连接及精确工具定义，失败不进入模型轮次。不改用户全局配置；用户 MCP 继续按名关闭。已有用户服务占用内部保留名 `loom_worker` 时，在启动 app-server 前明确拒绝，避免配置合并。原本没有该工具的 session 可在进程重启后按原 ID 恢复并获得工具，不创建替代 session，也不依赖尚未验证的热加载。

## 调用与结束

模型只提供业务字段。Host 按 CLI 自动附加的 native thread/session/turn/call ID 查已注册的原 Run；重复身份字段冲突、缺失或过期均拒绝。启动响应到达前的调用只有限等待已有原始 admission，比较精确 ID，不转移到后来登记的 Run。结束／撤销时关闭绑定并中止尚未完成的传输，Kernel 的原执行围栏仍生效。

每个原 Run＋native call ID 导出固定幂等键，同调用同参数共享原结果；不同参数拒绝。网络、无法识别的成功结果和服务端失败保留为未知，不自动重发；该原 Run 的后续 MCP 写入拒绝并要求 Human 核实。这是有界、临时的传输状态，不是第二份业务账本，也不能约束同 UID 程序绕过 MCP 直接使用既有 CLI。

新帖必须明确 `final`；草稿修订只接受正文和 draft ID，保留 Kernel 保存的原意图与目标。工具返回不等于 ACK。held／目标确认仍返回既有业务状态，并明确通过原 CLI 读取／恢复；本切片不签发 MCP 消费 receipt，不以 Host HTTP 返回或内层工具完成证明完整上下文送达。因此不宣称 MCP held 路径有精确取消收益，既有 CLI 的完整输出收据路径保留。

最终结束仍只由 Host 读到 Kernel final 标记触发。Codex 中断还需等待同 thread/turn/call 的外层代码执行返回及全部内层工具完成；新内层调用撤销前一代码单元的完成记录，不能借用旧输出提前结束。缺 raw 帧、未知返回格式、多个内层调用归属不明、yield／无法闭合的代码单元保守自然结束。诊断事件只决定中断时机，不创造业务完成。不能用 `preemptedFollowUp=true` 替代实际模型请求计数。

## 验证与限制

自动测试覆盖严格参数、重复／冲突调用、原凭据作者、旧 turn 拒绝、提前到达不借用后续绑定、未知结果不重发、held 不合成 ACK、MCP stdio 往返、两轮 warm 自动接线，以及代码模式外层返回保护。

安装版 Codex 0.160.0＋产品 warm driver／MCP entry／Host bridge＋临时真实 Worker／Kernel 的免费探针通过：同一 session 两轮各发一帖，作者与 Room 正确、旧 turn 拒绝；工具定义自然暴露；两份完整外层回执与真实 Worker JSON 深度一致。progress 轮有2次本地假模型请求；final 轮由真实 Kernel 标记触发结束，实测1次请求。该探针的 Host scope、ACK 和运行终止由夹具管理，不冒充完整 AgentHost 调度验收；后者另由 fake app-server 的自动接线测试覆盖。

真实 CLI 探针使用已有可信的同版本 Codex 安装副本、隔离实验 home 和 loopback 假 provider，官方自动记忆关闭，没有真实模型费用。第二单元边界修复后免费复验仍为 progress 2 次／final 1 次请求，两份完整回执匹配；本次产品 driver 的全部 3 个实际请求均明确 `parallel_tool_calls:false`。并发 outer 的纯函数反例不符合当前已测请求声明，但不宣称 CLI 强制拒绝异常 provider，未来 provider／模式／配置变化须重验。合成 final 样本证明这条路径可行，不保证真实模型和所有时序均无续生成；没有可用 token 倍率。部署、全量检查和新付费效率验收分别记录于 [状态页](status.zh-CN.md)，P97 失败结论保持。

OpenCode 的免费研究发现可通过本地原生 hook 关联 session/call、唯一 running part 与 Host 输入消息，但当前 `--pure` 不加载 plugin；不能直接放宽到加载用户插件。其现有 final 控制在两份免费样本中保留完整结果，却仍发出第二次模型请求。其产品身份适配和无额外生成路径均未收口，不随本切片接线。

证据：[Codex 产品链免费摘要](evidence/2026-10-04-worker-mcp-product.json)。探针、红绿日志及失败证据归档于 `~/.loom/reviews/2026-10-04-channel-cost-research/worker-mcp-product-fixture/`。

P98 付费进展（2026-10-04）：原生门禁实际使用 Homebrew 安装路径，代码执行宿主超时、未读到源文件；Loom 首轮也遇到相同超时，在质量核验后取消，后两轮未启动。故无有效同任务成本倍率。此前免费成功探针使用另一已有同版本／同哈希安装，不能替代本次实际执行路径的健康验证。预检遗漏、已发生用量与止损证据见[P98报告](evidence/2026-10-04-worker-mcp-cost-p98.md)，没有付费补跑。
