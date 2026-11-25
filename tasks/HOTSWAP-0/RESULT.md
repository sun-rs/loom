# HOTSWAP-0 结果

loomd 重启后，运行中的 TUI Leader 保持原来的 hc 窗格、loom-pty、Codex 进程和原生会话。无头 Worker 则由 loomd 持有。loomd 退出时，正在执行的无头轮次会丢失结果。新 loomd 可以按原生 session ID 续作，但会创建新的 app-server 和 OAR 事件流。第二阶段应先把无头会话的进程所有权移出 loomd。 [设计](DESIGN.md) · [七组实验摘要](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/summary.json)

## hc 和 Orca

- hc 0.1.22 的 `update --help` 说明替换 core 构建时会保留终端。Herdr 的公开文档也说明，桌面应用退出或升级时可以重新接回原程序。实机观察本卡窗格 `t37x` 的进程链为 core PID 82108 → holder PID 88985 → loom-pty PID 79452 → Codex。holder 持有 `/dev/ptmx`，wrapper 的标准流连外层 `ttys018`，wrapper 自己持有内层的 `/dev/ptmx`，内层 Codex 连 `ttys023`。loomd 与这条进程链独立。这里实测的是附着关系与 Loom 重启，hc 更新和 Herdr 应用重启依据公开说明。 [Herdr Core 文档](https://herdr.dev/core/) · [本机帮助](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/hc-help.txt) · [进程及文件描述符](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/control/result.json)
- Orca 的桌面自动更新会断开前端连接，独立终端 daemon 保有 PTY，新应用随后接回。公开设计说明协议换代时会并存 `daemon-vN`，新应用给旧 daemon 使用兼容适配层，待旧会话退役后回收。宿主或机器退出时走持久布局和历史恢复。Orca 的终端会话与结构化聊天是不同路径，公开 issue 记录了后者在更新退出时关闭 provider 子进程的行为。TUI-ORCA-1 固定提交的终端协议是 62，明确保留旧版本路由。该卡用新客户端接回三家 CLI 的旧协议 0 wrapper，原 incarnation 和已确认输入计数均保持。本卡另行实测协议 1、2 并存。 [Orca 会话恢复](https://orca.dev/docs/model/session-restore) · [协议世代与旧宿主](https://github.com/stablyai/orca/issues/9138) · [结构化聊天](https://github.com/stablyai/orca/issues/42611) · [Orca 固定提交的协议清单](https://github.com/stablyai/orca/blob/b7fd7caa357a170f9fac6a49923f3b9ecf5ed0ea/src/main/daemon/protocol/daemon-protocol-version.ts) · [TUI-ORCA-1 结果](../TUI-ORCA-1/RESULT.md#orca-更新时如何保活)

## 隔离实验

在实验目录中使用真实的 hc、loom-pty、Codex 0.171.0、OAR、loom CLI 和 loomd。本地 Responses 服务通过两个可控请求将 Leader 和 Worker 保持在活跃轮次。每组先确认已登记一个在途波次，另有一条带固定 ID 的消息留在 Leader 队列。记录原生进程、启动时间、PID 归属、窗格、套接字 incarnation、原生轮次、inbox、原生 rollout 和波次正文。CLI 用同一 ID 复发一次已完成的排队消息，并检查原生提交次数。

| 实验 | 会话与投递结果 |
| --- | --- |
| 对照组 | Leader 和 Worker 进程保持，Worker 完成，Leader 原生接管一条成功波次。 [证据](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/control/result.json) |
| 正常重启 loomd | Leader 原轮次在 loomd 停机期间完成，排队消息重启后确认一次。Worker PID 80689 退出，重启后 PID 81134 用同一 session ID 打开新事件流并完成后续输入。原 Worker 请求在释放前断开，波次向原 Leader 投递一次 `FAILED`。 [证据](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/restart/result.json) |
| SIGKILL loomd | 原 Worker 刚停机时一度重挂到 PPID 1，仍在的 PID 未保住原请求。随后换用新 PID，相同 session ID 可继续输入。Leader 停机期间完成原轮次，收到一条 `FAILED` 波次。 [证据](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/crash/result.json) |
| 替换 loomd 和 CLI 再启动 | 原子替换实验副本内的两个入口，`HOTSWAP-D2` 和 `HOTSWAP-C2` 验证新版代码实际运行。Leader 原运行与已排队的消息保持，Worker 中断和波次结果与正常重启相同。 [证据](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/daemon-code/result.json) · [构建标记](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/daemon-code/loomd-2.log) |
| 替换 loom-pty 与控制模块 | 在途 Leader 保持旧 wrapper 和协议 1，新 Auditor 加载新版代码和协议 2。两代支持同一组方法，实际完成各自的原生输入。未知方法、错误 incarnation 均被拒绝。Worker 与 Leader 保持原进程，成功波次一次。 [证据](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/pty-code/result.json) |
| 在线更改 SQLite 和 JSONL | 活轮次中加入旁表、写入 `user_version=2`，并追加带版本字段的未知 hook 记录。旧读者继续处理波次，SQLite `integrity_check` 为 `ok`。向 `sessions` 加可空列后，旧读路径正常，但旧 `index.update` 返回 `Unknown session field: hotswap_generation`。撤掉该列后，保留旁表和日志扩展，原进程完成成功波次。 [证据](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/schema/result.json) |
| OAR 0.130.0 → 0.130.1 | 隔离副本安装两版 npm 包，停 loomd 后切换依赖路径，启动日志确认新进程加载 0.130.1。原 Worker 中断，原 session ID 续作后能接受新输入；Leader 照常完成并收到一条 `FAILED` 波次。 [证据](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/oar/result.json) · [旧版启动](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/oar/loomd-1.log) · [新版启动](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/oar/loomd-2.log) |

43 个投递 ID 各有一条 inbox 记录和一次原生用户输入。39 个返回预期正文，另外 4 个均为被 loomd 退出打断的 Worker 首轮。Leader 共确认 7 条波次汇总，每组一条，其中 3 条载有预期的 Worker 结果，4 条载有失败回执。恢复记录显示，正常退出调用 `session.dispose()` 并写入 `suspending`，接任时用持久 session ID 调用 OAR resume。SIGKILL 后短暂保留的原进程也未保住正在等待的请求。 [实验快照和校验和](/Users/sun/Code/exp-relay/hotswap-0/r-9Fzefm/source-sha256.txt) · [会话所有权与退出](../../daemon/sessions.mjs) · [OAR Codex 运行时文档](https://github.com/botiverse/oar/blob/main/docs/runtimes/codex.md)

## 复跑与范围

```sh
/opt/homebrew/bin/node --test tasks/HOTSWAP-0/invariants.test.mjs
/opt/homebrew/bin/node tasks/HOTSWAP-0/harness.mjs --audit
/opt/homebrew/bin/node tasks/HOTSWAP-0/harness.mjs --case restart
```

- `--audit` 运行全部七组并保存证据，已执行完毕的兼容性失败保存在结果中。默认严格模式要求原进程、原轮次和预期投递全部保持。单独复跑 `restart` 验证了当前版本以退出码 1 反映已知的无头中断。可重复使用 `--case` 选择场景，或使用 `--source` 指定兼容源码快照。每组在独立项目运行并核对本组的 hc 窗格身份后清理。 [验收脚本](harness.mjs) · [断言测试](invariants.test.mjs) · [严格重启记录](/Users/sun/Code/exp-relay/hotswap-0/r-t9MxgI/summary.json)
- 预跑时，TUI 可执行文件解析规则刚变为优先取原生绝对路径，实验最初仅配置了 OAR 的绝对覆盖。一组废弃预跑因此把本卡的原生会话日志写到了默认 Codex 会话目录。该测试 pane 已结束，证据排除这组预跑。正式口径显式设置 `LOOM_CODEX_BIN` 和 `OAR_CODEX_BIN`，使用隔离 HOME，并核对 Leader、Worker 的 transcript 归属。 [实验环境](setup.mjs) · [废弃预跑及清理记录](/Users/sun/Code/exp-relay/hotswap-0/r-VUGpFx/control/result.json)
- 本阶段交付审计、设计和实验脚本。生产代码和全局 CLI 配置未修改。真机模型请求由本地端点确定性返回，厂商实机范围为 Codex。实验不发系统通知，通知、handoff 命令和其他厂商的在线升级纳入第二阶段。 [第二阶段验收](DESIGN.md#第二阶段验收)

STATUS: done
