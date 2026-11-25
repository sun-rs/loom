# INBOX-0 执行结果

`bin/loom` 动态加载 `inbox/cli.mjs`。默认 `queue` 在返回收据前把请求和 ID 持久化到项目目录。relay 持有项目锁，按目标维护 FIFO，在派发前和确认收件后落盘。忙时的队列等待所绑定的原生轮结束且原窗格可写。

Codex 忙时按原生输入计划执行 `steer`。Claude 按其 TUI 队列计划入手，并用 transcript 绑定实际消费该输入的轮次。agy 的计划把 `steer` 降级为 `queue`，回执含 `requestedMode: "steer"`、`mode: "queue"`、`downgraded: true`。`interrupt` 绑定请求时的活动轮，确认中断后在原窗格续作。已更替的轮次会拒绝中断。

relay 每轮根据原生 hook 中的投递 ID 和轮次归属确认收件。有 `--from` 时，确认的最终正文通过同一队列送回对应窗格。路由按来源事件与收件窗格去重，波次继续使用原有结算和存档。无头后端可通过 `inbox(project, transport)` 提供事件与输入实现。

## 使用

```sh
node relay/relay.mjs --project "$project" --leader "$leader"
bin/loom send "$target" --project "$project" --from "$sender" "请复核这个结果"
bin/loom send "$target" --project "$project" --mode interrupt "请改查日志"
```

目标和 `--from` 使用同项目的 TUI 窗格地址。项目可通过 `--project`、`LOOM_PROJECT` 或当前目录的祖先 `.project` 定位。Codex 的 `relay/hooks.mjs setup-inbox codex <project> <cwd>` 输出可追加到启动参数的 JSON argv，含 `UserPromptSubmit`、`Stop`、`Interrupt`。agy 和 Claude 继续通过 `setup` 注入。

初次回执含 `id`、`status`、`at`，后续结果保存在 `.project/inbox/state.json`。明确拒收可沿用原 ID 重试。投递结果悬而未决时保留正文和尝试记录，等待原生证据，暂停自动重投。hc 提供状态级写入条件，收件后再以原生轮号核对。

## 实测与测试

hc 0.1.22。Codex 0.171.0 使用本卡目录内的回环 Responses 测试后端，TUI、按键和 hook 均为原生。agy 1.5.16 使用已登录的原生会话，本次测试的短回复由绑定的 `Stop` 与同轮 hc `done` 正文核对。

| 目标 | 忙时 queue | 忙时 steer | 忙时 interrupt | 回执与回复 |
| --- | --- | --- | --- | --- |
| Codex `t30f` | 原轮结束后开新轮 | 原生轮号不变 | 原轮产生 `Interrupt`，同窗格续作 | 3 条各一次，均回到 agy `t2zz` |
| agy `t2zz` | 原轮结束后开新轮 | 回执明确降级，原轮结束后投递 | hc 轮号推进，同窗格续作 | 3 条各一次，均回到 Codex `t30f` |

另外在 agy 忙时用默认模式提交一条消息，等 relay 持久接管后重启 relay。替换进程沿用 ID `e8d9a7b8-7a74-45a0-bdf0-119f97a68b3c`，原生收件和回到 Codex 的回复均各一次。[实测证据](/Users/sun/Code/exp-relay/inbox-0/native/verification.jsonl)

- `node --test inbox/inbox.test.mjs relay/relay.test.mjs` 通过 23 项，覆盖 FIFO、拒收重试、未知回执对账、原窗格中断恢复、Claude 回复绑定和波次去重。
- 三个 relay 进程在旧 PID 锁、强制终止和正常退出后的三轮竞争中，每轮各有一个进程取得写权。[锁验证记录](/Users/sun/Code/exp-relay/inbox-0/lock-race.json)
- `node --test` 通过 164 项，退出码 0。对 `inbox/*.mjs`、`relay/*.mjs` 和 `bin/loom` 运行 `node --check`，退出码均为 0。[全量测试日志](/Users/sun/Code/exp-relay/inbox-0/full-tests.log)
- 本卡实验位于 `/Users/sun/Code/exp-relay/inbox-0/`。7 个自建 hc 窗格均确认 `finished`，回环服务已停止。实测使用本卡会话和原生事件，启动配置按会话注入。Git 提交记录维持原样。[清理记录](/Users/sun/Code/exp-relay/inbox-0/native/cleanup.json)

STATUS: done
