# 核心链验收第 2 次真实运行：本轮范围内全部通过

日期：2026-09-10。协议：`docs/product/core-chain-acceptance-protocol.zh-CN.md`。
门禁：`packages/daemon/test/real-core-chain-gate.test.ts`。隔离实例，未触碰正式库。
现场 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-core-chain-rrtfHM`。耗时 840 秒，40 次 RunAttempt 全部 exit 0，
40 个 runtime 进程全部 terminated。42 个协议行全部有结论，无"未覆盖"。

与第 1 次的差别：本次跑在并发调度（提交 `33023c0`）之上，且验证器已修正切换步骤的排序（`21c9459`）。

## 并发确实生效

| 指标                      | 第 1 次（串行） | 第 2 次（并发）                |
| ------------------------- | --------------- | ------------------------------ |
| RunAttempt 数             | 24              | 40                             |
| 跨 Agent 时间窗重叠的配对 | **0**           | 6（三个 Agent 两两组合全覆盖） |
| 同时运行的最大 Agent 数   | 1               | **3**                          |

数据直接取自 `run_attempts` 的 `started_at`/`finished_at`，不依赖测试计时。

## 场景四：切换真的落到了底层

这是第 1 次未能成立、用户最想确认的一条。两层独立证据：

**账本层（4.3）**：切换后新产生的 placement，`decision_json.$.resolvedModel` 为

```
{"source":"explicit_binding","modelBindingId":"local:opencode-cli/v1:deepseek/deepseek-v4-flash",
 "provider":"deepseek","modelId":"deepseek/deepseek-v4-flash",...}
```

创建时间 `01:39:17.918Z`，晚于切换事件，且携带切换后的修订号。

**进程层（4.4）**：同一时刻 `01:39:18.264Z` 现场抓到的真实进程命令行里含
`--variant low` 与 `deepseek/deepseek-v4-flash`。

即：**不是前端改了配置而底层没换。** 切换前的 placement 仍是 `kimi-code/k3 / high`（4.5），说明已冻结的决策没有被改写。

其余：切换期间 steady-c 的 5 次运行全部 exit 0 且修订号未变，`S4-audit.txt` 正常写出（4.7）；
被打断的 Activation 重启后以 1 次尝试完成、未重发请求（4.8）；无重复发布（4.11）；
held draft 全部以 `sent_unchanged` 收口，没有丢结论（4.12）。

## 场景二、三、五：与第 1 次一致，再次通过

跨 Room 记忆（模型原话）：

> S5 项目代号是 ORIOLE-1。来自我自己的记忆文件 MEMORY.md / notes/facts.md，是你在 #agent-council 的 [CCG-1] 里让我记下的。

上下文归属未串：steady-c 在 Room B 复述的是 mem-a 在**本房间**说的那句，并转述了其来源。

私聊延续：DM 中既调用了 Room 里形成的记忆，又存下只属于私聊的口令；回到 Room 后能带回并正确标注来源。

记忆反向对照：另一个 Agent 说不知道且不猜，口令只存在于 mem-a 的记忆目录。更正后跨 Room 召回新值。

## 结论

**限定在本轮范围内**：场景二、三、四、五在真实模型上通过；场景一本轮**未重跑**（由三个付费门禁与三条确定性链另行覆盖）；
正式实例不在本门禁范围。并发改造在本轮未引入回归：所有运行 exit 0，held draft 无丢失，无重复发布。

**不能据此宣布核心链已全面高可用。** 并发、模型切换、记忆与草稿恢复各自只有**单次样本**，
草稿恢复尤其如此；忙时追加、多 Thread 与重启恢复需要在最终同一构建上重跑。

## 边界

- 并发之后 Agent 更容易在没看到彼此回复时作答，freshness hold 触发概率上升。本次 42 行中该路径全部以
  `sent_unchanged` 收口，但这是单次样本，长期需在实际使用中观察。
- 没有任何机制阻止两个 CLI 同时写同一个工作目录，仲裁交给 Task 认领与 Room 内分工，与上游一致。
  `workspace.sharing: "exclusive"` 可随时退回串行。
- 场景四、五的"正式实例"部分不在本门禁范围。
