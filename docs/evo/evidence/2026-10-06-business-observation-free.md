# 业务观察 profile：免费真实 CLI 链路证据

使用已安装 Codex 0.160.0、隔离 HOME 与临时数据库，模型端仅连接本地 loopback 假服务。模型答案及用量均为合成数据，未调用付费 provider。产品先运行六阶段，原生再运行六阶段；每臂三个独立 session，各连续两轮，原生自动记忆关闭。此记录验证[业务观察设计](../stochastic-cli-evaluation-design.zh-CN.md)的部分程序路径，不构成真实模型质量、效率或稳定性结论。

## 结果与独立核验

[脱敏审计 JSON](2026-10-06-business-observation-free.json)记录 159 项独立核验，依据六份实际 rollout、工具输出和只读 SQLite 一致快照，而非仅信任 probe 的成功断言。

- 共收到 14 次 loopback HTTP 请求；原生和产品各有七条已报告生成记录。请求数和生成数分别核对，本样本数值相同不意味着两者一般等价。产品数据库七条 usage、无 gap，与 rollout 和阶段用量一致，未重复相加。
- 产品首阶段实际 MCP 参数被拒，随后通过带当前 `--turn` 的 Worker CLI 成功发表。保留两次生成及错误成本；CLI 回执对应当前规范消息。
- 产品第四阶段故意发表错误答案。第五、第六阶段的真实输入保留该消息原文与原 Room sequence，继续执行并正确回答，没有回填标准答案或擦除错误历史。
- 原生首阶段实际执行一次无害的 `pwd`，保留工具输出及第二次生成，不因路径不同而取消观察。
- 产品六阶段均有唯一消息、对应 final marker、已完成 Activation 与指定 consumer 的 ACK 证据。最后一阶段也已核验；六个 session 的身份、模型/effort、连续性及材料首次完整投递得到检查。

产品答案为五正确、一错误，原生六正确，因此等质量效率比较资格为否。传输成功不抵消质量失败。

## 当前 validator 离线重验

另以 `createRoundValidationFence` 和当前业务 validator 读取六份归档 rollout，重新处理两臂全部阶段；新 validation 与 summary 保存在独立私有文件，原始结果没有改写。两臂 processed prefix 均为六，质量裁决保持不变，合同为 `not-assessed`、稳定性为 `not-established`。

当前自动诊断对 exec/CLI wrapper 的拒绝与幂等计数返回 `unknown`，没有把无法完整提取的计数填成零。本次“一次 MCP 拒绝、一次 CLI 成功”由实际输出人工交叉核实，与自动诊断能力分开报告。

## 限制与失败保留

前一个私有 probe 的失败源于 fixture 恢复命令漏掉 `--turn`，已另行保留，不归因于产品故障。本次没有覆盖“安全结束但无规范回复后继续”的分支，也没有证明未知副作用可以放行。合成 token 不用于报告成本改善、合同通过或真实模型成功率；其用途仅是验证完整计量及错误历史保留。

原始结果、六份 rollout、DB 快照、离线新判定及逐文件 SHA 在私有归档保留。公开 JSON 不含本地路径、Worker turn token 或原始凭据。
