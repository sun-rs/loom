# DRV-CODEX-0 完成记录

## 完成内容

- 在 `drivers/codex-appserver/generated/` 运行官方命令 `codex app-server generate-ts --out drivers/codex-appserver/generated`，生成类型对应 `codex-cli 0.171.0`。
- 在 `drivers/codex-appserver/src/` 实现 JSON-RPC 行协议、daemon control socket 连接、stdio 回退、initialize、thread start/resume/list、turn start/steer/interrupt、服务端请求响应和原生通知异步迭代器。
- `events()` 保留 `ServerNotificationEnvelope` 原始 payload，覆盖 turn 生命周期、item 生命周期、command execution 输出、file change、错误和 token usage。`readThread`、`listTurns`、`readTurns` 提供历史补读。
- 断线时记录已知 thread 和 active turn，发出 `disconnected` 事件。`reconnect()` 重新 initialize 并按 thread ID resume，发出 `reconnected` 和可能漏掉事件的快照。
- `clientInfo` 默认使用 `loom_new`。没有读取或输出 Codex 凭据，也没有实现 loom 协议或业务重试策略。
- README 记录了用法、持久化 thread ID 的恢复方式、服务端请求回调和实测边界。

## 手写代码量

`src/client.ts` 499 行，`src/index.ts` 1 行，合计 500 行。generated 和 test 不计入限制。

## 测试结果

执行 `node --test drivers/codex-appserver/test/client.test.ts`，3 个测试全部通过。

覆盖内容包括 fixture 回放的正常 turn、command execution、命令输出、exit code、file change、token usage、error、steer、interrupt，以及断线检测、可能漏事件快照、重连、thread/resume 和分页 turn 补读。

## 实机探针

- 已执行 `codex --version`，结果为 `codex-cli 0.171.0`。
- 已执行 app-server、daemon、proxy help 和 `generate-ts`。
- 临时 `CODEX_HOME` 下通过本驱动的 stdio 传输实测 initialize、thread/list、thread/start，返回正常，未发送 `turn/start`。
- 在不发送 turn 的条件下尝试关闭一个 stdio app-server 后用第二个 app-server `thread/resume`，Codex 返回 `-32600 no rollout found for thread id`。因此 thread ID 持久化和 resume 的驱动路径已实现，未能用无模型 thread/start 探针证明 Codex 会留下可恢复 rollout。
- 曾用临时 `CODEX_HOME` 执行 `codex app-server daemon start`。daemon 子进程曾成功 spawn，但 CLI 因当前环境禁止调用 `ps` 无法记录受管 PID，命令返回失败。随后执行 `codex app-server daemon stop`，结果为 `notRunning`。因此本轮没有把 daemon 成功启动标为实测通过。

## 未决问题

- app-server daemon 成功启动后的 control socket attach、daemon 重启期间 active turn 的恢复边界仍需具备相应系统权限的环境验证。
- `thread/start` 在未运行 turn 时没有留下可供第二个 stdio app-server `thread/resume` 读取的 rollout，持久化恢复需要带有历史的 thread 或 daemon 运行态验证。
- app-server 没有为实时通知提供断线补发保证。驱动只能报告断线时已知的 thread/turn 快照，补齐需要调用 `thread/read` 或 `thread/turns/list`，事件级别的精确重放尚未付费实测。
- 真实 `turn/start`、审批 server request、token usage 的模型返回、自动压缩和 interrupt 在模型运行中的行为没有实测，避免了付费调用。

STATUS: done
