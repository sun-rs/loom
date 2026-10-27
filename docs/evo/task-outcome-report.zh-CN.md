# 完整任务验收汇总：离线入口

2026-10-27，基线 `937a9ac9`。本切片落实文章/Cindy研究的第一步：把已有任务结果、交接证据、人工介入与消耗放在同一份可重放报告中。只支持明确登记的两种历史格式，不是新调度器、通用评测框架或自动验收裁判。

## 使用

在仓库根目录运行，结果写到标准输出：

```sh
node scripts/cli-efficiency/task-outcome-report.mjs docs/evo/evidence/2026-10-13-backend-finish/team-v8.json
node scripts/cli-efficiency/task-outcome-report.mjs docs/evo/evidence/2026-10-27-agy-closeout/summary.json
```

它不读取正式数据库、不调用网络或 CLI、不修改 Task、不自动重试，不要求登录。不要把输出重定向覆盖输入文件。未知格式会拒绝，不能根据任意 JSON 的 `pass` 或进程 exit0 猜成功。

报告附输入路径及 SHA-256。共享算术复用 `paired-usage-summary.mjs`；没有导入带正式服务/付费入口的 `loom-advantage-discussion.mjs`。其 Run、Activation、投递与原生核账口径继续保留，旧 runner 不被重新执行或改写。

## 判定与计量边界

- **任务结果**：六组协作批沿原独立审计的质量/功能判定；进程已结束不等于任务成功。报告不是新的独立产物审查。
- **固定计划**：以原 `order` 为分母，缺样本仍保留 unknown。重复、计划外、错臂、非法数值和加总溢出拒绝。
- **失败成本**：输入/输出保留全部样本；失败组及结果未知组单列。成员 usage 不与已经聚合的团队 usage 再相加；这不意味着后代覆盖已被证明。
- **未知计量**：`known` 是已观察量，`complete` 是来源的覆盖声明，`total:null` 表示不能确立总量。缺 cache 不抹掉完整主量；AGY 阶段汇总没有原生完整对账证明，全部保持 partial。缓存包含于输入，不擅自从总输入扣除。AGY generations 不冒充 HTTP requests。token 不是账单。
- **交接证据**：旧批只有 Activation/replyReturn 次数，标 `aggregate-only`。AGY 检查 event/seq 顺序、replyReturn 源、收件人、Activation/Run 对应及呈现窗口；标 `linked-summary-without-inbox`，因为输入没有完整原始 Room event/Inbox/消费回执。这不是完整因果链重新审计。关键链接不匹配，有限审查退为 unknown。
- **人工介入**：AGY 显式保留 Human 恢复及其阶段用量。旧批“无救援”保留原文声明，不凭声明合成逐次人工事件日志。两者都不假定没有子代理；后代覆盖未知。
- **比较**：仅在原批内部、同一团队模型组合中复算描述性算术，不混入 AGY 或其他 CLI 批次。任务质量不齐或对等政策未建立时，`equalQualityRatio` 为 null。算术倍率不能自行放行发布。
- **边界**：没有自动补齐旧记录缺失的 case/run/产物/完整人工事件链。AGY 只算当前恢复审查窗口，不含此前失败批，不能展示为整个任务累计成本或未中断任务完成。

## 本次重放

[生成报告与结果](evidence/2026-10-27-task-outcome-report/README.md)。两份旧记录保持不变，未新增模型生成、部署或重启。

新增测试纳入已有 `test:cli:efficiency:unit` 的文件匹配，定向运行：

```sh
node --test scripts/cli-efficiency/task-outcome-report.test.mjs scripts/cli-efficiency/paired-usage-summary.test.mjs
```

后续先使用这份报告暴露证据不足，再针对实际采用的 runner 补采集。不要为了报告字段另造业务状态；更不能补写虚假的历史 Inbox 或推定未知费用为零。后继[离线诊断入口](runtime-diagnostics.zh-CN.md)已提供原流观察，仍不自动判断浪费或改动运行时。
