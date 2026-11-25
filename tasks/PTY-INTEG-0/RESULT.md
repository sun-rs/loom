# PTY-INTEG-0 结果

`loom spawn --mode tui` 默认由 hc 启动 `tui/loom-pty`，内层命令使用原生 CLI 的绝对路径。Claude Code、Codex 和 agy 共用 `runtimes/tui/` 的 OAR 运行时与传输实现。loomd 使用同一控制套接字管理收件箱，依靠持久化的窗格身份恢复连接。根依赖固定为 `node-pty@1.1.0` 和 `@xterm/headless@5.5.0`。macOS 安装脚本修复 npm 预构建 spawn-helper 的执行权限。 [运行时说明](../../runtimes/tui/README.md) · [PTY 说明](../../tui/README.md)

## 投递和恢复

- loomd 在调用套接字前保存投递意图。wrapper 在粘贴前保存请求 ID 和正文哈希，按帧世代检查空输入框，粘贴后回读整份草稿，核对无人工键入才按 Enter。原生确认到达后落盘。同 ID 重查旧回执，改正文返回冲突。人工键入推进帧世代并暂停自动输入 800 毫秒。
- Claude 和 OpenCode 要求启动原生证据。Codex 0.171 和 agy 的首个根 hook 在首轮内触发，初始写入由本次 wrapper、已稳定的空输入框和粘贴回读保护。后续写入要求原生空闲证据及空输入框。hc 的忙碌和阻塞状态仍能否决自动写入。 [Codex 0.171 首轮调用顺序](https://github.com/openai/codex/blob/rust-v0.171.0/codex-rs/core/src/session/turn.rs#L385-L398)
- 中断绑定当前原生轮和帧世代。实测 Claude 与 Codex 以原生转录确认取消。agy 在未发取消 hook 的情况下，由同一轮新增的原生取消提示、两帧空输入框以及期间无人工键入共同确认；续作投递另外取得原生确认。
- wrapper 在原生进程启动前退出时可以回退至人工操作的 plain hc 窗格。spawn、投递回执和 `loom state` 报告 `plain-hc` 与 `loom-pty-start-failed`。已经开始可能写入的请求在窗格退出后保持 `uncertain-target-exited` 并按投递协议升级，纯排队请求标记 `target-exited`。
- 真实 hc 故障注入用本卡测试程序模拟内层 CLI。首条消息完成，第二条在 wrapper 粘贴后、确认前强杀 loomd 与 wrapper。重启后 `loom state` 显示 `exited`，首条仍为 `answered`，后条仍为 `uncertain`。项目只收到一次对应的升级通知，同 ID 重交返回原状态。同项目的无关窗格只保有自己的启动投递。两窗格均核实为 `finished`。 [故障注入日志](/Users/sun/Code/exp-relay/pty-integ-0/recovery-verified.log)

## 真实账号烟测

使用 Claude Code 2.1.331（Sonnet、low）、Codex 0.171.0（GPT-6.2-Sol、low）及 agy 1.5.16（默认 Gemini 3.8 Flash、low）。三个 CLI 都在本卡目录冷启动，用 `hc ls` 核对同一窗格的原生身份及 `idle → working → done` 状态。每批五条不同 ID 的排队消息逐条取得一次原生接管和最终回复。另用 `hc keys` 输入草稿，再排入自动消息，三个客户端的草稿均保留，自动消息的原生确认数均为 0。

| CLI | hc 原生身份 | 排队原生确认 | 指定轮中断后续投 | 人工草稿 | 证据 |
| --- | --- | ---: | --- | --- | --- |
| Claude | `claude-code` | 5/5，每条有 hook 和转录 | 转录确认取消，续作有原生确认 | 保留，0 次误发 | [日志](/Users/sun/Code/exp-relay/pty-integ-0/verified-claude-f82ea5/results.jsonl) |
| Codex | `codex` | 5/5，每条有 hook | 转录确认取消，续作有原生确认 | 独立实测窗格保留，0 次误发 | [投递与中断](/Users/sun/Code/exp-relay/pty-integ-0/retry-codex-912c2d/results.jsonl) · [草稿](/Users/sun/Code/exp-relay/pty-integ-0/draft-codex-a25640/results.jsonl) |
| agy | `antigravity` | 5/5，每条有 hook 和转录 | 原生界面确认取消，续作有原生确认 | 保留，0 次误发 | [日志](/Users/sun/Code/exp-relay/pty-integ-0/verified-agy-e8f38b/results.jsonl) |

真实账号的三次新 Git 目录启动均显示原生信任框。接受信任会写入 CLI 配置，所以另用本卡隔离配置和回环模型设置验证了同一接受流程。三个对话框均经套接字推进至可写界面。实测窗格均已退出，日志含各自的清理记录。 [Claude 真实账号](/Users/sun/Code/exp-relay/pty-integ-0/trust-claude-real.log) · [Claude 隔离确认](/Users/sun/Code/exp-relay/pty-integ-0/trust-claude-isolated.log) · [Codex 真实账号](/Users/sun/Code/exp-relay/pty-integ-0/trust-codex-real.log) · [Codex 隔离确认](/Users/sun/Code/exp-relay/pty-integ-0/trust-codex-isolated.log) · [agy 真实账号](/Users/sun/Code/exp-relay/pty-integ-0/trust-agy-real.log) · [agy 隔离确认](/Users/sun/Code/exp-relay/pty-integ-0/trust-agy-isolated.log)

Codex 一次运行的第三条模型请求长时间忙碌，后续两条留在队列。重跑完成五条，续作取得原生接管后在观察窗口内仍忙，草稿在另一真实账号窗格核实。早期版本探测经 PATH 调用过一次 CCP 的 Claude 启动器执行 `--version`。烟测与故障注入使用显式原生入口或本卡测试程序，未用该启动器启动会话。

## 回归和物理行数

`npm test` 通过 235 项，0 失败、0 跳过、0 取消。新增套接字测试覆盖人工先键入、粘贴后抢占、重启后按 ID 对账。原有协议硬化测试保持通过。 [全量日志](/Users/sun/Code/exp-relay/pty-integ-0/npm-test-verified.log)

统计 TUI 专用生产文件的物理行，含空行和注释。范围为 `tui/` 的可执行入口及生产模块，`runtimes/claude-tui/` 或 `runtimes/tui/` 的生产模块，启动接线的 `daemon/tui.mjs` 与原 `daemon/codex-start.mjs`，以及 `inbox/tui.mjs`。测试、夹具和说明文档不计入。

| 代码 | 改动前 | 改动后 |
| --- | ---: | ---: |
| PTY、控制套接字及提供方插件 | 895 | 1057 |
| TUI 运行时 | 1045 | 956 |
| loomd TUI 启动接线 | 118 | 62 |
| 收件箱 TUI 传输和对账 | 272 | 351 |
| 总计 | 2330 | 2426 |

STATUS: done
