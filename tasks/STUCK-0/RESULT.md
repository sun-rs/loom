# STUCK-0 交付结果

`watch/` 提供 Node ESM 巡检模块和 CLI。它读取索引中的活跃 TUI 会话，使用 `hc get/read`、适配器屏幕分类及根轮 hook 时间判断状态。目录信任按显式工作目录白名单处理。其余阻塞每次只写一条 `needs-you`，确认恢复后写 `recovered`。可解析的限额重置时间会触发一次 `loom send --mode queue` 投递 `继续`。默认只写事件文件，传入 `--super` 后才通过 hc 发送告警与恢复通知。 [接口及用法](../../watch/README.md)

## 实测

使用 hc 0.1.22 和 Codex CLI 0.171.0。实验目录为 `/Users/sun/Code/exp-relay/stuck-0/`。Codex 使用独立 HOME 和配置目录，轮次响应由本地回环服务直接生成。

| 场景 | 结果 |
| --- | --- |
| 原生目录信任框，`t2zw` | 指定精确白名单后只提交一次 Enter。日志记录一次尝试、一次提交和一次恢复。首次采样至恢复为 506 ms。 |
| `idle-without-stop`，`t305` | 将真实 `UserPromptSubmit` 交给 watcher，暂缓转交同轮 Stop。空闲帧在 30.547 s 后触发一条告警，重复采样没有追加告警。补交 Stop 后 24 ms 写出同一事件的恢复。 |
| 429 到点续作 | 用模拟 hc 帧和实际 SQLite 索引、`bin/loom send` 验证，重启后仍只有一条正文为 `继续` 的 `queue` 收件箱请求，事件记录与实际投递 ID 一致。 |

保留了实测事件、两项计时、最终实现回放和收件箱证据。测试窗格 `t2zw` 和 `t305` 已用 `hc kill` 结束并核对为 `finished`，watcher 和回环服务已退出。 [实测事件](/Users/sun/Code/exp-relay/stuck-0/events.jsonl) · [计时](/Users/sun/Code/exp-relay/stuck-0/evidence.json) · [最终实现回放](/Users/sun/Code/exp-relay/stuck-0/replay-evidence.json) · [收件箱证据](/Users/sun/Code/exp-relay/stuck-0/queue-check/evidence.json)

## 验证与问题

- `node --test watch/watch.test.mjs` 通过 15 项。覆盖三家适配器屏幕样本、信任框重读、单边沿和重启、hook 归属、忙碌计时、重置时间及单次排队。
- 最后一次全量 `node --test` 通过 153 项。中途一次全量运行遇到并行开发中的 Claude TUI `stopFailure` 未定义，后续全量复测通过。 [全量日志](/Users/sun/Code/exp-relay/stuck-0/node-test.log)
- 第一次回环轮次遇到 macOS 系统代理返回 503。给隔离进程设置 `NO_PROXY` 并将出站连接限制到本次回环服务端口后，复测通过。
- 重置时间由屏幕给出。日期格式无法解析时保留人工处理状态。已经落盘的续作尝试在进程重启后沿用原记录，队列接管与送达状态以 inbox 回执为准。

STATUS: done
