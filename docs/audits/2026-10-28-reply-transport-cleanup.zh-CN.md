# 回复传输与文章吸收收口核查

2026-10-28；基线 c6cdc884。本批只修改实验工具与文档，无付费调用、产品运行时改动或服务重启。

## 已发现并修复

旧 `test-cli-long-session.mjs` 的 longArmEnvironment 只覆盖两个 JSON final-output 开关；新 native-final 开关可能从父环境继承。跨频道 runner 复用该函数，因此也受影响。保存/恢复环境时同样只有旧键集。

新增回归先失败：传入 LOOM_CODEX_NATIVE_FINAL_TRIAL=1，default 臂仍为1。修复后复用 gateReplyTransport 的完整清零集合，只让明确 final-output 臂打开其原有开关；两入口保存/恢复键集都从覆盖集合取得。账号环境保留，异常 finally 恢复逻辑保留。

计划的 arms 包含完整开关集合，因此4个固定 identity 哈希有意变化，已核对变化来源并更新测试，不修改历史证据哈希。不能将这些新计划与旧批当作同一 baseline。

## 保留项与原因

- Worker 不是全废弃路径：nativeFinalSequence 明确拒绝不完整投递、notice、任务/审查事件和非单一回复目标；显式业务操作也不能以普通最终正文替代。删除 Worker 会损坏这些能力。
- JSON final-output、旧模式和原失败记录仍是可复现的受控实验，不是可直接删除的垃圾；本机正式 native-final 不再暴露竞争回复 MCP。
- 库默认和本机部署开关不同仍是明确限制；本次没有顺手改变其他安装的运行方式。
- 已有文档清理、旧前端退役结论保持；不删除数据库兼容、证据、备份或用户会话。

## 文章 / Cindy 判定

任务报告和离线诊断两个切片已实现并有针对性验证；实际协作复验业务交付通过，但其原工具重试/等待不当不能改写为首试通过。第三项输入精简原本以证据为前提，当前没有继续修改上下文的依据。没有整合 Cindy 主循环、自动滚动 session 或静默记忆写入，也不把未做的部分叫已完成。

本次重新运行 long-session runner、reply-transport、multi-channel 系列、task-outcome 系列及 runtime-diagnostics 测试：140项通过。包含免费计划探针，不执行模型。此前故障测试红灯后转绿；未跑无关全套。

## 剩余工作

最新 Codex/Kimi 为3对×3轮短任务，不能替代复杂长任务、协作质量与全部时延门禁。下一步应针对这一纵向验收缺口设计固定批，而非继续删除必要工具或根据单次比率优化。AGY Fork/Side、自动记忆禁用及原生子代理覆盖等限制仍按当前状态页披露。
