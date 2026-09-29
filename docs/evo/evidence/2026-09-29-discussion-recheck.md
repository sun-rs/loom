# 重复唤醒修复后的真实三实例验收

日期：2026-09-29。用户明确授权沿用此前 Claude 验收的 CLI/模型/effort。源码：`94c2dd7` 加已部署未提交批次，schema 79。运行 `node scripts/acceptance/real-discussion.mjs --paid --max-runs 15`，没有修改账号、模型配置或产品代码。

## 结论

**重复通知取消在本次真实样本成立；三实例端到端验收被 Claude 账号策略阻塞，未通过。UI 点击验收仍被浏览器管理策略校验阻塞。** 脚本正常退出且标记 `quiet` 只说明没有继续调度，不代表业务成功；本次有隔离 Activation，不能报告“讨论收敛通过”。

- 频道 `room_01ec382e-6bdb-4b30-8a8c-58f171b48bb4`，Human 开场 #8。
- OpenCode `deepseek/deepseek-flash / low`；Codex `gpt-6-luna / low`；Claude `haiku / 无 effort`。Host 目录与每次 Placement 的模型记录均吻合，不替换。
- OpenCode 发言 #24 点名 Codex。Codex 在开场运行中读到 #24，并在 #28 回复，指出启动时间验证不能消除 TOCTOU（该纠正与读取后的讨论相关）。
- Codex 的 #24 后续 Activation 被 #36 `activation.cancelled` 取消，reason=`covered_by_successful_run`，记录源运行 `run_deafc144-e188-4195-9bb3-df61d20f430b` 和精确确认序号 [24]。Codex 总计只执行 1 次；本样本没有旧 P45 的重复回复。
- Claude 三次运行均得到：`Your organization has disabled Claude subscription access for Claude Code`。Kernel 第三次以 retry fence 隔离；沒有 Claude 回复。停止后没有排队/运行中的工作，保留隔离状态与账本供诊断，不擅自放弃或重建 session。

## 用量与耗时（非原生对照）

| CLI      | 实际运行次数 | 用量生成记录 | 累计输入 | 缓存输入 | 未缓存输入 |  输出 | Human 开场至回复 |
| -------- | -----------: | -----------: | -------: | -------: | ---------: | ----: | ---------------: |
| OpenCode |            1 |            3 |   33,410 |   21,120 |     12,290 | 1,237 |          42.3 秒 |
| Codex    |            1 |            5 |   58,315 |   44,032 |     14,283 |   475 |          69.9 秒 |
| Claude   |            3 |     无用量帧 |     未知 |     未知 |       未知 |  未知 |           未回复 |

OpenCode 运行开始至回复约 12.1 秒，Codex 约 39.6 秒；三家首次启动都在 Human 开场约 30.3 秒后，因此**首轮约 30 秒等待仍能复现**，不能称已解决。OpenCode CLI 报告费用合计约 $0.00264906；Codex 无费用帧；Claude 报告累计 0 但无 token 帧，不把缺失用量当作 0。此轮未跑同题原生对照，不能判效率达标。

## 暴露的验收缺口

1. Claude 订阅访问被组织策略拒绝，需要用户在 CLI 账户侧处理；本验收不代改认证。
2. 明确的账号禁用被标为 recoverable，经历三次自动尝试才隔离；这是可改进的失败分类，不能将这两次重试说成重复消息唤醒。
3. 脚本的 quiet/退出码不能代表验收成功；报告必须核对隔离与缺失回复。原脚本把 Human 标作 system 的已知展示问题也未修。
4. 首轮 30 秒启动等待仍在。私聊、记忆、重启续聊与原生效率对照本轮尚未重跑；未启动依赖 Claude 的完整脚本以免重复失败。

## 证据

- 原始（本机私有）：`~/.loom/acceptance/runs/discuss-20260929T015708Z/evidence.json` 与 `report.md`。
- 执行日志：`/tmp/loom-20260929-discussion.log`。
- 判定依据：正式库只读查询的 Room 事件 #8/#24/#28/#36/#46、RunAttempt、Placement、worker_run_read_receipts、run_attempt_usage 与 run_attempt_cli_costs。
- 本报告修正原脚本的 Human 标签和 quiet 语义，不把原始脚本报告直接当最终 PASS。
