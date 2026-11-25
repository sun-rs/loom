# LOOM-CLI-0 交付结果

统一入口提供 `spawn»、`send»、`hist»、`state»、`ls»、`stop»、`handover» 和 `daemon start|stop|status»。`spawn» 要求显式模型和 effort，登记 Git 基线、原生会话 ID、转录指针、父会话和 worker 波次。Codex 人工接手的参数带 `-c check_for_update_on_startup=false»。Claude TUI 解析原生二进制，Claude 无头使用 OAR 并设置 `CLAUDE_CODE_ENTRYPOINT=loom»。 [使用说明](../../README.md)

每个项目由一个 loomd 持有写锁。它从原生事件确认投递与轮末，按派工根轮封存波次，经持久收件箱合并送回结果及证据卡。状态文件保留未确认输入，重启按原生会话 ID、hc 窗格身份和投递标记对账。巡检事件按阻塞边沿记录。根依赖锁定 `@botiverse/oar@0.130.1»，schema 重导出 OAR 类型，索引继续保存 `baseCommit» 与 `transcriptPath»。证据卡和交接简报上限分别为 300 与 1,500 个近似 token，中文每字计一个 token。 [协议 v2](../../docs/PROTOCOL-v2.md) · [归档协议 v1](../../docs/archive/PROTOCOL-v1.md)

## 原生端到端冒烟

实测根目录为 `/Users/sun/Code/exp-relay/loom-cli-0/»，主要复跑位于 `verified/»。使用 hc 0.1.22、Node 25.9.0、Claude Code 2.1.331。 [逐步核对及 SHA‑256](/Users/sun/Code/exp-relay/loom-cli-0/verified-evidence.json)

| 步骤 | 实测证据 |
| --- | --- |
| 1. 启动 loomd | 后台状态返回 PID `77707»。另实测前台启动与正常停止。 [后台状态](/Users/sun/Code/exp-relay/loom-cli-0/verified-01-daemon-status.json) · [前台状态](/Users/sun/Code/exp-relay/loom-cli-0/foreground-status.json) |
| 2. 启动 Leader | Sonnet 5.5 / low 在 `t313» 就绪，使用原生绝对路径，启动参数移除了继承的入口标签。 [spawn 回执](/Users/sun/Code/exp-relay/loom-cli-0/verified-02-spawn-leader.json) · [启动参数](/Users/sun/Code/exp-relay/loom-cli-0/verified-09-native-argv.json) |
| 3. Leader 派同一波 | Leader 通过两次 `loom spawn» 派出 Codex app-server / low 和 agy ACP / xhigh。两条索引均绑定该 Leader、`W-SMOKE»、原生记录及 Git 基线。 [索引](/Users/sun/Code/exp-relay/loom-cli-0/verified-08-session-index.json) · [workers.md](/Users/sun/Code/exp-relay/loom-cli-0/verified/.project/workers.md) |
| 4. 合并并恢复 | Leader 收到一条两成员消息并返回 `LOOM_WAVE_ACK»。强制退出后 PID `88641» 接管，沿用原批次投递 ID。Codex、agy 证据卡分别约 53、60 token。另一次强制退出发生在合并波次投递前，重启后只投了一次。 [合并与恢复](/Users/sun/Code/exp-relay/loom-cli-0/verified-evidence.json) · [首轮崩溃快照](/Users/sun/Code/exp-relay/loom-cli-0/03-before-crash-inbox.json) |
| 5. 普通 shell 问答 | Super 在无代理终端身份的 zsh 运行 `loom send --mode queue --wait»，原终端收到 `LOOM_SUPER_REPLY wave=1 cards=2»。 [shell 回执](/Users/sun/Code/exp-relay/loom-cli-0/verified-06-super-queue.json) |
| 6. 历史与交接 | Leader 有 3 个完成轮，两名 worker 的首轮正文分别是 `DONE SMOKE-CODEX»、`DONE SMOKE-AGY»，简报约 381 token。 [Leader 历史](/Users/sun/Code/exp-relay/loom-cli-0/verified-07-hist-leader.json) · [Codex 历史](/Users/sun/Code/exp-relay/loom-cli-0/verified-07-hist-codex.json) · [agy 历史](/Users/sun/Code/exp-relay/loom-cli-0/verified-07-hist-agy.json) · [简报](/Users/sun/Code/exp-relay/loom-cli-0/verified-08-handover-leader.json) |
| 7. 中断与收尾 | agy 原生第 3 轮被中断，历史保留 `endedAt=2026-11-24T19:21:03Z»，同会话第 4 轮回复 `LOOM_AGY_AFTER_INTERRUPT»。全部 5 个自建窗格确认 `finished»、原因为 `killed»。5 个实验项目的 daemon 均已停止。 [中断回执](/Users/sun/Code/exp-relay/loom-cli-0/verified-agy-interrupt-retry.json) · [中断历史](/Users/sun/Code/exp-relay/loom-cli-0/verified-agy-interrupted-history.json) · [清理核对](/Users/sun/Code/exp-relay/loom-cli-0/verified-evidence.json) |

## 验证与问题

- 根目录 `npm test» 通过 170 项，失败、跳过、取消均为 0。测试覆盖根轮封存、崩溃后原生对账、ACP 中断、agy 时间戳、OpenCode v2 转录和中英文长度预算。 [测试日志](/Users/sun/Code/exp-relay/loom-cli-0/npm-test-final.log)
- 试跑暴露 Claude 长粘贴外层包装、启动时信任框可能漏收按键，以及 agy 忙时收到原生活动却一直等待完轮确认的问题。修复后，主链路和 agy 原会话中断续作均复跑通过。
- Claude 和 OpenCode 无头均获得原生最终回复。OpenCode Mini 的两个补充 TUI 试跑均收到原生输入回执，经各自的免费模型额度限制结束，每个窗格各产生一条限流告警。第二个窗格的多行草稿曾停在输入框，本次用核对过的 Enter 补交。实现随后加入相同草稿的确认逻辑，尚无该路径产出成功原生回复的实测。 [Claude 无头](/Users/sun/Code/exp-relay/loom-cli-0/backends-claude-headless-hist.json) · [OpenCode 无头](/Users/sun/Code/exp-relay/loom-cli-0/backends-opencode-headless-hist.json) · [巡检证据](/Users/sun/Code/exp-relay/loom-cli-0/backends-watch-before-close.jsonl) · [OpenCode Mini 命令](https://opencode.ai/docs/cli/commands/#mini)
- Codex 的本轮测试命令经 Code Mode 包装，证据卡能绑定 Git 与轮末，测试计数仍缺少可归因的原生字段。同一工作目录单独复跑夹具通过一项。 [Codex 证据卡](/Users/sun/Code/exp-relay/loom-cli-0/verified/.project/evidence/SMOKE-CODEX-c9641cf393569e5b99f3.json) · [夹具复跑](/Users/sun/Code/exp-relay/loom-cli-0/verified-host-codex-worker.log)
- `runtimes/claude-tui/» 已移出重复依赖和子锁。任务同时要求 `runtimes/oar/» 只读，该目录内已有的安装副本仍在。统一入口从根目录加载固定版本。原生实验操作范围限于本卡创建的会话和测试目录。Git HEAD 仍为 `af006edd24ad2f634bab0f0b8e6df041387405b2»。

STATUS: done
