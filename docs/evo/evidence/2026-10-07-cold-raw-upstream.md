# 冷恢复 raw 通知：上游源码定位与成本边界

2026-10-07。承接[实际冷恢复轨迹](2026-10-06-mcp-product-cold-wire-free.md)与[直接MCP正式配置复验](2026-10-07-mcp-direct-barrier.md)。本项只读研究，无模型调用、CLI升级、生产代码或正式服务变更。

## 从观察到源码原因

[官方App Server说明](https://learn.chatgpt.com/docs/app-server#message-schema)要求用运行版本生成schema；在线文档没有给出恢复raw通知的开关。安装版0.160.0的完整875份schema仅在ThreadStartParams声明experimentalRawEvents，resume、thread/turn settings及初始化能力中均未找到相应启用字段。不能把未知字段随start参数spread到resume当成受支持能力。

进一步读取官方仓库release tag `rust-v0.160.0`，peeled commit为 `a956835d020762cb2b570053af06f643a11c0ecc`，得到可复核的因果链：

1. [ThreadState](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/app-server/src/thread_state.rs#L99)通过Default初始化，raw开关初始为false；订阅函数只在调用方传true时开启该字段（L560–580）。这是进程内监听状态。
2. [新建路径](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/app-server/src/request_processors/thread_processor.rs#L1154)接收并传递experimental_raw_events；[冷恢复路径](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/app-server/src/request_processors/thread_processor.rs#L4055)则明确以false挂接监听。
3. [事件监听](https://github.com/openai/codex/blob/a956835d020762cb2b570053af06f643a11c0ecc/codex-rs/app-server/src/request_processors/thread_lifecycle.rs#L323)读取该开关；关闭时过滤RawResponseItem和RawResponseCompleted。结果已进入原生历史但未通知Loom，与两次独立冷恢复抓包一致。
4. 本次读取的[上游main](https://github.com/openai/codex/blob/0b863c69f50335acd92164aab971cb58d298c2fe/codex-rs/app-server/src/request_processors/thread_processor.rs#L4067)仍以false恢复，ThreadResumeParams仍无该开关。固定本次commit，不把它说成所有未来版本均无能力。另有父线程内存开关继承给子线程的路径，但不是现有独立session的恢复开关，不能通过伪造父子关系或替换session绕过。

[来源URL、SHA与边界](2026-10-07-cold-raw-upstream.json)。公开源码、安装版schema与实际wire三者相符，但未进行安装二进制的可复现构建比对，也不以所查文件排除未公开接口。未移植或编译上游代码；下载源码仅用于审查。私有完整输入与树索引在 `~/.loom/reviews/2026-10-07-cold-raw-source/`。

## 处理决定

停止同型冷恢复探针与猜测参数。保留完整输出停止屏障，冷恢复自然结束；不以原生MCP内层完成、成功回执、日志读取或固定等待冒充完整raw结果，也不替换会话或永久禁止空闲回收。后续只有上游提供可验证的恢复订阅接口／修复，或正式提供等价的完整输出确认，才重开这项免费验收。上游问题可沿此前草稿补充源码位置，本批没有发送外部消息。

## 不让局部限制吞掉长期成本工作

P122两臂各36次生成，未缓存输入1.634786倍；冷恢复额外请求不是该样本倍率的原因。此前紧凑回执、wake投影和direct表示均有明确局部收益，但不能代替当前版本的完整长期分账。

下一步固定同内容、三连续session各12轮、原生与产品两臂的免费loopback请求审计，使用当前正式配置且关闭原生自动记忆。记录1/4/8/12轮累计输入、固定说明、工具目录、当轮与历史wake、调用、结果及中断通知；保留全部实际请求与真实ACK。不用合成usage推算token、缓存、价格或真实模型质量；先确定剩余主导成本，再决定是否值得设计下一刀。
