# 计量修正：题目v7与原生压缩独立记账

本批没有付费调用。完成新题目的确定性验收、Pi原生压缩计量的源码/假响应验证，以及通用聚合用量协议、Kernel持久记账、Host接线和控制台独立展示；不是新的效率结果，仍不宣称压缩逐响应完整计量。

## 题目明确性

新建独立v7目录，首轮明确返回Python字典及键，初始API增加dict返回注解，README同步。先在未修改副本运行新测试，两个预期断言失败，再作最小修改。全部33项Python测试和2项Node规则测试通过，包括参考实现12轮、沙箱、不可变快照和已有错误实现回归。

40项外部判定用例、参考实现、评估器及第2–12轮原题字节/内容不变；旧v6的17个源文件无漂移，旧付费结论不重判。当前没有执行器自动切换到v7，下一批必须显式冻结新manifest。题目明确化不代表覆盖所有业务错误。[v7差异、哈希与验证](fixture-v7.json)

## Pi原生压缩：确定的部分与未知的部分

直接检查已安装Pi1.1.0源代码，并向原生compact函数提供假响应，未启动CLI或provider进程。6项测试全部通过：单段、双段、无历史前缀、失败后重试、第二段失败、可选reasoning不完整。

默认压缩路径的usage只来自新摘要请求，不是旧assistant/session累计，也不是tokensBefore。正常双段压缩将两个成功响应相加，因此本批原始HTTP与压缩聚合能对上。但是：

- 重试最终成功时，原生聚合只含成功返回，先前失败响应即使报告usage也不会加入。
- 第二段失败时，整个compact抛错，第一段已消费的usage不会作为压缩结果返回。
- 双段中只有一段报告reasoning，聚合仍会给出数值；不能据此称reasoning完整。
- 扩展可自行提供compaction.usage，持久记录带fromHook；默认路径的不重叠结论不适用于扩展或未核实来源。

这些是假响应验证的可能边界，不是在推翻上一批完整HTTP原流核账，也不证明其他CLI有相同问题。[源码位置、封印与测试](native-compaction-audit.json)

## 后端实施边界

本片采用统一用量语义，不做按CLI改提示词：单次生成、原生聚合、完整性是不同事实。Protocol定义聚合诊断，AgentHost验证当前session追加段/entry来源，Kernel按已认证实例/provider/native session/entry幂等记录并绑定Run；session代际仅作来源记录，不进入唯一键，防止跨代重复计费；API和控制台展示“已知压缩聚合”及partial，不能伪造responseId、生成次数或HTTP次数。恢复时旧entry不重新计费；同entry冲突保留缺口，不相加、不覆盖。

即使证实默认原生路径与普通生成不重叠，增加已知聚合也不能自动清除gap。缺失/中止/重试和扩展来源仍要求未知；可选维度单列。实现新增 `rah-provider-usage-aggregate/v1` 与schema85独立表，既有generation数量/总量不改；RunAttempt查询增加可选 `aggregateUsage`，控制台单列“已知压缩聚合用量”。没有generation时仍为unavailable，有generation且有gap时为partial。缺项不填0；同Run精确重放幂等、冲突和跨Run归属拒绝。Pi只接收已验证本轮追加段、fromHook=false且与完成流事件匹配的原生条目；扩展/未知来源、缺少核心计数或歧义记录不补数。旧记录不回填。

driver新增测试先红（没有aggregate帧），再实现转绿；Pi parser/driver/proof专项通过；最终Host/driver/parser/writer联合68项通过。Host和Kernel各自红绿验证，控制台单元和假服务浏览器验证独立摘要且不混generation。整仓check、类型/格式/diff、console构建与假服务浏览器通过；首次既有排队采样失败保留，代表性fixture最终为partial+gap。正式服务已备份并安全重启至schema85，11类业务表哈希不变，真实页面/API及构建资源核对通过。[实现与检查](implementation.json)、[部署凭据](deployment.json)。没有新增真实CLI模型调用或付费效率验收。
