# 直接呈现 MCP 工具：免费能力探针

日期：2026-10-07。[脱敏证据](2026-10-07-mcp-direct-surface-free.json)。本批只修改私有隔离进程的一项参数，不改生产源码、正式配置或服务；不能称生产门禁验收。

## 配置依据与实验边界

安装版导出 `ToolExposureSurface.ts` 包含code_mode/deferred/direct；[官方固定版本配置schema](https://raw.githubusercontent.com/openai/codex/rust-v0.160.0/codex-rs/core/config.schema.json)允许MCP server设置omit_tools_from。生产值只排除deferred，私有wrapper在正式model/effort/memory guard之后、binary之前精确替换唯一该项为code_mode+deferred，并记录前后argv及单项差异。该配置是有依据的实验覆盖，不是原生产配置；账号不继承，只有localhost合成模型，原生自动记忆关闭，无付费回退，原Host完成屏障保持。

首个样本实际收到namespace目录，但探针尚未核实响应编码而拒绝；平台失败重试使该样本共2HTTP，未发表。失败保留。随后安装版 `ResponseItem.ts` 证实function_call支持namespace字段，按实际观察的namespace `mcp__loom_worker` 和函数 `loom_reply` 发出合成调用，不猜名称。第二样本同一原生session/runtime两轮，共4HTTP；总预算6HTTP耗尽后停止。

## 结果与限制

两次直接MCP调用均通过真实Worker/Kernel发表，回执关联正确、消费者ACK成立。实际目录不再包含Shared MCP Types，functions.exec仍服务其他CLI工具。工具目录JSON为20,257字节，既有生产包装探针为21,779字节，其他目录字段逐项一致，差1,522字节；这只是目录比较，不是整个输入、新旧业务配对、token或费用收益。直接function_call_output也不再使用代码执行层的嵌套MCP包装。

**每轮仍是2HTTP。** 发表后合成模型继续生成一次FAKE_DONE；Host未请求或发送中断，preempted follow-up为unknown。原expectOuterOutput屏障未放松。现证据只证明直接暴露、发表与ACK能力，尚未建立缺少提前结束的完整因果诊断，也未证明净成本更低，不能立即切生产。

下一步应核实直接工具的可信完成事件及其与Kernel final标记的关联；不得跳过未知输出、删除外层完成围栏，或用成功回执假造消费/任务完成。真实质量、缓存和价格均未测。私有原始请求、轨迹、数据库、argv及schema/SHA清单位于 `~/.loom/reviews/2026-10-07-mcp-direct-surface-free/`。
