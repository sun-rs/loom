# Agent Council 持续暂停与执行隔离

## 根因与范围

Agent Council 的旧 OpenCode 执行及 task #5 已被显式取消，三个 RuntimeProcess
均已终止。随后 `task.cancelled` 合法地产生一条 task_updated attention，进入
queued Activation，但 Room SOS hold 阻止其运行。它不是第四次执行。
旧重启检查把这条静止队列当作活动工作，阻塞其他修复部署。

进一步发现 RoomAgentSosService.requestStop 对任意已有停止操作直接返回，
导致原先 `resumeOnMessage=true` 无法升级为明确的持续暂停。仅再次点击/调用
默认 Stop 并不能保证之后的 Human 消息不恢复执行。

本批 Kernel 是停止策略的唯一 owner；不修改 Composer 文件，不恢复误发工作，
不删除消息、配置、记忆、Inbox 或 Task 历史。重启检查由并行的工作台修复任务
维护，本批复核其只豁免无租约、具有 stopped SOS hold 的 queued Activation，
并保留 RunAttempt、RuntimeProcess、Placement 和 exclusive-operation 围栏。

## Raft 依据与本地实现

来源为 [Raft Computer 1.0.32](https://cdn.raft.build/computer/1.0.32/raft-computer-darwin-arm64)，
提取 main.js SHA-256 为
`531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`。
许可及分析限制沿用[制品清单](../evidence/raft-release-20260916/manifest.json)。
`845146` 起的 stopAgent 先记录 stop epoch，取消 queued start、pending rebind、
restart snapshot 和 runtime-error restart，再停止进程。对应原则是：显式停止
必须约束后台启动和重试，不能只改变画面。原始 bundle 只读分析，未执行或复制。

RAH 的 Room SOS、持久 attention 和 SQLite 事务属于本地 glue，不声称逐字复刻
不可见的 Raft Server。现有停止可单向升级为手动恢复；操作 ID、hold、终止目标
不变，新请求追加 Room event，旧事件保持不可变。幂等校验从原请求事件读取，
因此旧 Composer 请求重放不会把新暂停政策改回自动恢复。

## 验证

新增 stopped/stopping 两种时序回归，先在旧实现确认失败，再验证修复后通过：
新鲜度检查、停止升级、请求重放、不同载荷幂等冲突、迟到 Composer Stop、新消息、
Task 创建/取消、正常关闭并重开数据库，均不能意外解除暂停；其他 Room 可继续
调度，显式 Resume 仍可恢复。现有 SOS 与隔离撤销回归一并通过。

定向回归 72 项通过；`npm run check`、`npm run format:check`、
`git diff --check` 与 `npm run build:web:workbench` 全部通过。
正式实例经状态备份、备份核验和 graceful restart 后运行构建
`d928c229f8075c7d`，原 loopback、Tailnet、LAN 三个入口保持不变。
通过 Human Stop API 将 Agent Council 的既有停止升级为
`resumeOnMessage=false`，Room seq 584 记录该操作。
随后实际查询确认零未结束 RunAttempt，取消通知的 queued Activation
仍为零次启动，误认领 Task 保持 cancelled，频道 69 条消息保持完整。

正式服务 Chromium 浏览器检查覆盖 1440×900 与 390×844、重新加载及
现有 Composer 文件浏览流程，均通过并人工检查截图；浏览器检查没有发送
消息或唤醒 Agent。证据保存在本机临时目录 `rah-composer-formal-W1D109`。
数据库重开后的暂停持久性由回归测试覆盖；没有声称已做 iPhone 实机验收。

没有运行付费 Provider，
没有以测试消息触发正式 Agent，也没有承诺自然语言撤回已等同于后台停止。
本批解决持久停止围栏，不把 Provider 消息交付和跨工具会话隔离的剩余工作宣称完成。
