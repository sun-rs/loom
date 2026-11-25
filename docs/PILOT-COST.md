# 项目策略与试运行用量

在项目根的 `.project/policy.json` 使用 [示例策略](../examples/policy.json)。`roles.leader.maxActiveWorkers` 接受 1–5 的整数，省略时为 3。仅在任务可独立验收且文件所有权互斥时提高上限。`loom spawn worker` 统计同项目同父地址且索引中尚未退出的 Worker，跨波次合计。空闲但仍可续作的会话占用席位，`loom stop` 确认退出后释放。达到上限时返回 `worker-capacity`。

`preferred` 决定启动默认值，`guidance` 给 Super 和 Leader 提供选型依据。Leader 用强模型配 `medium` 或 `high`，Auditor 用与 Worker 不同厂商家族的强模型。常规卡用 `low` 或 `medium`，高难卡用 `high` 或 `xhigh`，可用 `--effort` 选择。高级角色优先考虑经实际路由验证的长提示缓存 TTL。保持 `keepAlive: false`，当前运行时没有提示缓存保活机制。

```sh
loom cost --project "$PROJECT"
```

- `byRole` 含角色的会话数、已观察轮数、有原生用量的轮数、模型调用次数和 token 汇总。原始 token 为总输入加输出，输入分为 fresh、缓存读和缓存写。推理输出作为单列观测值。相同原生 transcript 路径只汇总一次，`missing` 列出不可读或未绑定的历史。
- `workerShare` 为 Worker 占项目全部已观测原始 token 的比例，取值为 0–1。分母包含所有角色、未归角色和所有已记录尝试，分母为 0 时返回 `null`。
- `leaderWakes` 以每个 Leader 会话首轮之后观察到的根轮启动数为代理。角色的 `turns` 包含首轮。合并投递和手动输入都可产生一次唤醒。
- `workerTurns` 按地址和轮次列出最后一项通过的可识别验证命令完成时间，以及原生用量时间戳严格晚于该时间的模型调用次数。读取最终验收结果并生成结论的调用也计入。缺少可识别验收、可配对结果时间或原生调用记录时返回 `null`。验收识别沿用 Loom 证据卡的命令和退出码规则。

试运行的模型支出目标为 **Worker 80%、Leader 15%、Auditor 5%**。单列 Super 用量。用供应商实际价格分别计入 fresh、缓存读写和输出，再计算三类角色的支出比例。订阅用量单列，记录数据覆盖率、每项通过验收的成本、首次通过率、复开率和交付时延，用于比较试运行结果。
