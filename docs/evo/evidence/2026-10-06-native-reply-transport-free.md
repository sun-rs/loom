# Codex 原生工具免费对照：固定声明可减少，冷恢复边界未通过

**原生 dynamicTools 在隔离新 session 的首请求中比 MCP 少 3434 JSON 字节；两者新建和同进程续轮均保全完整内外层结果后结束。冷恢复中，两者都未观察到所需的外层通知，保守不打断，各出现第二次假模型请求。本轮不接入生产，也不判效率通过。**

这是 owner“注意保存里程碑，继续”后的免费能力研究。此前已保存请求分账及工具两个里程碑，后者为 `milestone-evo-request-accounting-tool-2026-10-06` → `5cf6a8066e878c934f85b72cdcd3b07dbeff0a59`。本批基于该干净源码，未改产品 packages；本机实际 Codex 0.160.0 二进制、相关协议/driver 源码、十二份请求和探针脚本的 SHA 均见[机器证据与独立审计](2026-10-06-native-reply-transport-free.json)。原始材料归档在私有 review `2026-10-06-dynamic-transport-free`。

## 范围与可信度

每臂一个新 HOME/CODEX_HOME，一个原生 session，使用相同工作目录、业务工具 description/inputSchema、题面、模型绑定和 effort。绑定为 `gpt-6-luna/low`，实际模型服务仅为本机 loopback 假服务；没有继承账号凭据、没有其他 MCP 服务。官方自动记忆配置关闭，原生 session 记录也为 disabled。

每臂最多六个假 HTTP 请求：initial、warm、cold resume 以及一次冷恢复参数补检，共四个 turn。实际 dynamic 六个、MCP 六个，达到上限即停止。没有新建 session 掩盖冷恢复问题，失败和补检均保留。

工具仅返回明确的 `FAKE_RECEIPT` marker，**没有 Worker 凭据、application service、Kernel 业务写入或消费者 ACK**。复用生产的 final interrupt/outer barrier 代码，只验证原生 thread/turn/call 标识、工具参数和内外层结果；不能将这个探针等同于产品交付测试。假服务主动选择已声明工具，不证明真实模型选择工具的可靠性。

148 项独立事实核验通过，表示记录与原始轨迹吻合，不表示所有阶段验收通过。未由审计者启动第二套探针。

## 实际观察

| 阶段         | dynamic 假请求 | MCP 假请求 | 结果                                                                                       |
| ------------ | -------------: | ---------: | ------------------------------------------------------------------------------------------ |
| 新建         |              1 |          1 | 原生身份与参数匹配；完整 inner/outer marker 后才 interrupt                                 |
| 同进程续轮   |              1 |          1 | 同 session；相同结束边界成立                                                               |
| 首次冷恢复   |              2 |          2 | dynamic 回调成功但无 raw outer；MCP 夹具漏显式 sandbox，原生要求批准而拒绝；均未 interrupt |
| 补齐恢复参数 |              2 |          2 | 双方回调成功，下一假请求含本轮完整结果，但仍无 raw outer；均未 interrupt，自然完成         |

第二个请求看到完整结果，证明该结果进入后续模型输入；它不证明在第二请求发出前已有可供 Host 安全打断的外层通知。不能以 callback 回答或 inner completed 代替完整 outer 执行结束，否则仍可能截断同一 code-mode cell 中的后续操作。

## 字节差与适用范围

| 首请求                             | dynamic |   MCP | MCP 减 dynamic |
| ---------------------------------- | ------: | ----: | -------------: |
| 完整 JSON body 字节                |   43554 | 46988 |           3434 |
| `exec` description 原始 UTF-8 字节 |    8184 | 11481 |           3297 |

仅 MCP 有的 Shared MCP Types 为 1573 字节，三个资源 helper 说明分别 669、571、438 字节，合计 3251。其余 description 差来自工具限定名称、返回类型和分隔符。除工具声明及临时 ID 外，首请求其他 input 内容相同；完整请求还存在 cache key/CLI metadata 的临时标识差异，不能把 body 当成 tokenizer 输入。

warm 请求中的先前调用/结果/中断项，dynamic 为 229/264/352 JSON 字节，MCP 为 247/331/352，合计差 85。这只是短假回执及函数名前缀差，未测真实发表回执，更不能据此预测 P122 的长期增长斜率。

这些均不是 token、缓存或费用。若用户本来启用了其他 provider-owned MCP，通用说明可能继续存在，固定收益可能缩小或消失。本批没有尝试卸载或禁止用户工具以制造收益，也没有证明其他 CLI 能使用同一原生接口。

## 恢复与升级边界

本机重新导出的 experimental schema 中，`dynamicTools` 只在 `ThreadStartParams` 注册；`ThreadResumeParams` 和 `TurnStartParams` 无注册字段。先前归档探针向 resume 增加工具没有生效。本轮只确认原已注册工具随同 session 恢复，不能宣称可给存量 MCP session 补挂、替换工具 schema 或无损迁移。不能用自动重建 session 绕过这些限制。

同一份导出协议中，`experimentalRawEvents` 也只在 `ThreadStartParams`，不在 `ThreadResumeParams`。生产 warm driver 会把包含该字段的启动参数展开到 resume，但这不是已启用的证据。`initialize.experimentalApi` 是实验接口开关；通知 opt-out 只能抑制通知。生成的公开方法中未找到其他 raw 事件启用入口；任意 config 键仍有未知，不能扩大为“绝无其他办法”的断言。关键 schema 文件已归档并记录 SHA，未依赖未来版本的在线文档推断本机能力。

冷恢复现象在两臂共同出现。当前还缺实际产品 Run/Worker/Kernel 的冷恢复复现，因此不直接宣布生产回归或归因动态工具；也不通过放松 outer barrier 令探针变绿。

## 后续裁决与交付

保留原生工具为实验候选，停止小幅提示压缩。下一项应先用免费、隔离的实际产品链核查冷恢复后的回执可见性、额外生成及用量完整性；确认现有服务的真实影响后再设计修复。原生工具若继续接线，仍须共用原 Run 绑定的 Worker application service、幂等和 unknown 围栏，不建立第二业务 handler，且必须先解决存量/新 session 选择及长期 schema 兼容。

本批零付费、无生产改动/部署。已有工具里程碑的完整检查保持；本次新增实验文档/台账只执行链接、格式和 diff 检查。[P122](2026-10-06-business-long-p122.md) 的质量失败及效率未验收不变。
