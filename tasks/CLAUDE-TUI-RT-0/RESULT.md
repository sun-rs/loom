# CLAUDE-TUI-RT-0 交付结果

`claude-tui` 通过 `createRuntimeRegistry` 与 OAR 内置 runtime 一起注册。会话由 hc 托管独立 PTY，复用 Claude 适配器的启动、屏幕识别、输入计划和 transcript 解析。Hook 通过当次 `--settings` 注入。OAR 内核生成可按游标重放的记录，轮次正文优先取 Stop，缺失时读取同一轮 transcript。 [用法与能力声明](../../runtimes/claude-tui/README.md)

## Sonnet 实测

使用原生 Claude Code 2.1.322、`claude-sonnet-5-5`、hc 0.1.22 和 OAR 0.130.1。实测目录为 `/Users/sun/Code/exp-relay/claude-tui-rt-0/`，配置与记录写入该目录。Claude 自行使用既有登录态。

| 场景 | 观测结果 |
| --- | --- |
| 新目录启动 | `t30p` 通过目录信任框。SessionStart 确认原生会话 ID 为 `5280d77a-8960-4c04-bf13-7099c8fe1395`。 |
| 连续两轮 | 两轮均为 `completed`。第一轮 Stop 返回 `LOOM_TURN_ONE_OK`，第二轮 Stop 返回上轮要求记住的 `LOOM_CONTEXT_VIOLET`。 |
| 中断后同窗格续作 | Bash 运行中 Esc 得到 `aborted`，seq 26 来自 transcript 的中断记录。随后在 `t30p` 续作并收到 `LOOM_SAME_PANE_OK`，会话 ID 一致。 |
| 工具期间 steer | Bash 的 PreToolUse、steer 请求、PostToolUse 分别为 seq 38、39、44。seq 47 的 `queued_command` 关联同一输入 ID，当前轮 Stop 返回 `LOOM_TOOL_OK LOOM_STEER_OK`。 |
| 记录回放和重开 | 核对了 49 条连续 record 及从 seq 38 续订的结果。关闭后以原生 ID 在 `t30q` 重开，读取同一 transcript，新记录流从 seq 0 开始。 |

本卡创建的 8 个 hc 窗格均已确认 `finished`。其中 `t30h` 在启动阶段自行退出，其余 7 个经 `hc kill` 结束。 [实测日志](/Users/sun/Code/exp-relay/claude-tui-rt-0/final-live.log)

## 测试与问题

- 在 `runtimes/claude-tui/` 运行 `node --test`，7 项全部通过。模拟信号覆盖 `quota` 与 `rate_limited`、旧屏幕错误去重、队列降级、取消和游标回放。各 ESM 文件也通过 `node --check`。
- 复跑验证了两处实测修复。信任框移动光标后等待屏幕确认再按 Enter，Stop 到达后等待输入框恢复再发送下一轮。
- 前置的 `claude --version` 和 `claude --help` 经 PATH 命中了 CCP 包装器。后续 CLI 检查和所有 hc 实测均显式指定原生 Claude 二进制。

STATUS: done
