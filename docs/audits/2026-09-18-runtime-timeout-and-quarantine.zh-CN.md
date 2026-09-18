# 运行超时与隔离执行撤销

日期：2026-09-18。Owner 为 AgentHost 运行监督与 Kernel Room SOS。

## 根因与上游

Agent Council 的 OpenCode 在 08:17 将误发请求认领成 task #5；Human 于 08:18
在消息列说明“输入错误，不需要认领”。该自然语言纠正没有成为显式任务取消，
模型后续仍调用工具修改代码。Host 每次经过固定 1,800,000 ms 终止进程并重试，
连续三次相同错误后隔离。三个 Run 均有终止证明，隔离不是活进程，也不是新的任务。
不能据此删除 Room 历史或把整项工作假报为完成。

上游：[Raft Computer 1.0.32](https://cdn.raft.build/computer/1.0.32/raft-computer-darwin-arm64)，
提取 `main.js` SHA-256 `531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`。
许可与分析边界沿用[制品清单](../evidence/raft-release-20260916/manifest.json)。
`847501` 附近 `markRuntimeProgressStaleIfNeeded` 在确认进程仍活着时压制
stalled 判定；`recoverStaleProcessForQueuedMessageIfNeeded` 则要求额外恢复条件。
本次结构移植的是“不能仅以运行累计时长杀死存活进程”，不是复制全部 watchdog。
不执行发布 bundle，不把 Computer 源码误称为中央 Server 源码。

## 实施与合同

- AgentHost 周期存活检查取代无条件总时长终止。GenericProcessAdapter 通过
  自有 ChildProcess 或认证 supervisor 查询 target leader；探测不产生业务 ACK。
- 保留启动、停止、drain、lease、process-group 回收及缺失终止证明隔离机制。
  存活本身不证明模型推进；长期存活但无输出仍可由 Human 显式停止。
- Human Room SOS 可撤销该 Room 已终止的 quarantined Activation，并记录
  `activation.cancelled` 及因果来源。存在未终止/孤立 Run、RuntimeProcess、
  未释放 Placement 时事务拒绝；不能用按钮绕过执行围栏。
- retry fence 保留错误历史，置 resolved，`resolution_kind = NULL`，由取消事件
  记录人工撤销原因；不伪报 progress/restart，不修改 Inbox、cursor 或 Task 状态。
- Task #5 只通过 Human 的标准取消接口关闭。聊天中的自然语言不由 Kernel
  关键词解析成停止命令。Room 继续输入后仍可处理新请求，不复活已撤销的 Activation。

## 验证

先失败后通过：存活运行被旧 watchdog 误杀、隔离执行无法撤销，以及无终止证明
的 Room SOS 错报停止。新增 direct/supervised 真子进程探测、连续多个复查周期、
探测失败/缺失/迟到/取消及 retry fence、交付未被伪造、后续请求不复活旧执行测试。
定向 58 项通过。`npm run check`、`npm run format:check`、`git diff --check`
与 `npm run build:web:workbench` 均通过。完整默认门禁中 17 项付费检查按原规则
跳过；本批没有新增真实 Provider 调用，也没有进行 Raft 同条件计时。

## 正式处理结果

已按正式 restart guard 完成备份、校验、正常停止与冻结资产重启。
备份标识：`pre-restart-9dedf312-3045-407e-b77f-729de0a38128`。
新进程 `41217`，build identity `5542d9b0e3cbaae0`，保留 loopback、Tailnet、
LAN 三个原地址的 4173 入口。PID 是本次核验事实，不是长期配置。

通过 Human HTTP API 依次执行 Room SOS 与 task #5 取消，记录 seq 580–583 的
`room.agent_sos_requested`、`activation.cancelled`、`room.agent_sos_stopped`、
`task.cancelled`。原 Activation 与 Task 均为 `cancelled`，全库隔离数 0、
活跃/孤立 Run 数 0，Room 的 69 条消息保持原样。停止使用
`resumeOnMessage=true`，下一条 Human 消息可解除停止状态；没有为验收自动发帖。

正式入口新开 Chromium，1440x900 与 390x844 均通过现有只读浏览器门禁，
覆盖 Agent Council 打开、输入框可用、文件浏览器、关闭与重新加载，页面无脚本错误。
检查了实际截图与请求清单；不等于真实 iPhone 或真实 Provider 验收。
本批未提交、未推送。

该修复不声称已完成跨 Activation 常驻、已消费 follow-up 消除、Kimi 原生 SDK
切换或 Raft 双边等速验收；这些边界见[调度对齐记录](./2026-09-18-runtime-scheduling-alignment.zh-CN.md)。
