# Speed_test 首轮真实双边观察

用户在两边配置四个 Agent 并授权使用新频道测试。RAH 当前提交为
`1e779392926dc1aa640c1bdb593e0dada02de3ab`，本批没有修改生产代码、配置或会话。
原始结构化事实见[试验记录](../evidence/2026-09-21-scheduling-preparation/speed-test-pilot.json)。

## 原先三人回复的原因

RAH 的“大家好”于 2026-09-21 06:13:53.542（Asia/Shanghai）落库。
Kimi 9.94 秒、Claude 20.51 秒、DeepSeek 55.91 秒后发帖；Codex 没有发帖。
Codex 首个 Run 在 0.172 秒后开始，18.696 秒后正常退出。它实际执行了：

1. `message-check --startup`，读到了 Human 的“大家好”。
2. `message-read --after <Human message ID>`，读取随后出现的 Kimi 自我介绍。
3. 在 Provider final 中报告没有需要回复或执行的任务，未调用 `message-post`。

因此不是消息没有投递，也不是前端隐藏了已发回复。此次直接原因是模型读取
后续同伴消息后选择沉默；触发消息与后续消息的处理关系值得修正，但仅一句
泛问候不能证明所有 Agent 都有强制回复义务，也不能据此给所有漏回归同一根因。
后续三轮 Codex 执行同样未发帖；这句问候在整个频道共引发 12 个 RunAttempt。
原问候早于此次推理强度修复部署，不作为新版本严格性能样本。

## S1：明确要求四人各答一次

两边通过正式浏览器发送完全相同的普通聊天，要求四人各回复 `S1 43`，
不要因为别人答过而省略自己的回复；禁止创建任务、修改文件或记忆。
先 Raft、后 RAH，各提交一次，没有重置 Agent 或 Provider 会话。

| Agent    | Raft 约耗时 | RAH 耗时 | 回复结果   |
| -------- | ----------: | -------: | ---------- |
| Claude   |        9 秒 | 16.74 秒 | 两边均回复 |
| Codex    |       14 秒 | 21.74 秒 | 两边均回复 |
| Kimi     |       35 秒 |  7.56 秒 | 两边均回复 |
| DeepSeek |       69 秒 | 33.97 秒 | 两边均回复 |

RAH 从 Human 落库到 Agent 发帖落库计算，页面也确认四条回复可见。
Raft 从浏览器发送点击时间，到本机 Computer 收到该回复的同伴投递信号计算，
日志只有秒精度，包含网络投递；不是中央服务器落库耗时或精确页面绘制耗时。
Raft DeepSeek 的原生工具记录也确认发送成功，消息引用 `5a2b29a9`。

RAH S1 共 12 个 RunAttempt，观察结束时全部退出。不能把其中所有无发帖运行
直接算作无效执行；本轮没有逐一证明后续确认和业务义务是否可安全合并。

Codex 的 S1 在 RAH 连续两次受到 freshness hold（分别遇到 Kimi、Claude 回复），
随后发送已有草稿成功；Raft Codex 也受到一次 hold 后发送成功。
因此 freshness hold 不是 RAH 独有问题，不应为加速而直接移除保护。
首请求输入 token：RAH 179,526，Raft 25,959（均含缓存）；既有会话历史不等，
不能把差值全归因于当前这条消息的调度，也不能视作未缓存费用。

## 仍不满足严格控制变量的地方

- 只有一个明确回复样本；保留各自历史会话，未统一上下文、缓存和其他频道负载。
- Claude 当前 RAH 配置是 Sonnet 5/low；Raft 运行进程参数也为 Sonnet 5/low。
  Codex 两边原生 turn context 为 Luna/low，既有会话元数据均标记 CLI 0.155.1。
- 曾误将浏览器工具的桌面版 Codex 子进程当作 RAH 进程，已撤回版本不一致判断；
  该进程不属于产品执行，不能用作运行时证据。
- DeepSeek 两边模型均为 `aihubmix/deepseek-v4.1-flash`；RAH 原生请求携带
  `model.variant=max`，Raft 原生请求未携带 variant。实际档位是否等价尚待核实。
- Kimi 的 RAH 配置为 runtime 默认，本轮未独立完成 Raft 的实际请求档位核验。
- Raft 当前运行器收据标记 1.0.18；此前分析的 1.0.32 发布源码不能直接称为
  本轮正在运行的版本。

本轮证明了原漏回的具体路径，以及明确指令下四人均可回复。速度结果有快有慢，
不支持“RAH 在所有 CLI 上都比 Raft 慢”或“已经完成同条件性能验收”。下一轮应先
确认 DeepSeek/Kimi 的有效档位，并控制会话规模、串行负载和计时口径，再重复取样。
