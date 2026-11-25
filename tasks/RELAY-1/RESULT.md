# RELAY-1 交付结果

## 波次与唤醒

- Leader 在 `.project/workers.md` 一次登记整波，行尾使用同一个 `wave=<波次号>`。relay 首次读到登记时记录波次成员和截止时间。整波停止后向 Leader 投递一条合并消息，单 worker 有结果就投递。
- `--window` 默认 900 秒，从整波登记被 relay 读到开始计时。到期发送截至期限的结果和未完成名单，整波只有这一次投递。晚到的完成仍归档并更新登记。重启沿用已保存的波次和投递状态。
- relay 仅给 Auditor 抄送含 `FAILED` 结果的波次，每波抄送一次。skill 要求 Auditor 收到后只做一次只读核查。Leader 醒来后更新判断、派下一波，按需做一次针对性验证，集成完成后统一跑一次全量验证。
- H1 启动器改用 900 秒兜底，提示 T1–T4 同属 W1、T5 使用 W2。Auditor 的起始提示带上 relay 终端名和失败抄送规则，省去单独的地址通知。

## Hook 启动方式

- Codex 的 Stop 使用当次 `-c 'hooks.Stop=…'` 注入。CLI `--help` 确认 `-c` 接受 TOML 覆盖及 `--dangerously-bypass-hook-trust` 的当次作用域。实际启动从注入的 Stop 读取 `last_assistant_message`，项目目录里没有生成 `.codex/hooks.json`。[Codex Hooks](https://developers.openai.com/codex/hooks)
- agy 使用 `.agents/hooks.json`，通过会话级 `--settings` 传入该 worker 的 `trustedWorkspaces`。实际捕获 `fullyIdle` Stop，relay 读取该会话 transcript 的最终正文。[Antigravity Hooks](https://antigravity.google/docs/hooks?tab=ide) · [Antigravity 设置 schema](https://antigravity.google/schemas/v1/settings.json)
- Claude 将 Stop 和 StopFailure 作为当次 `--settings` 的 JSON 参数。独立冒烟用 Claude Code 原生二进制启动，Stop 和 transcript 提取均得到 `DONE SMOKE-CLAUDE`。[Claude Code Hooks](https://code.claude.com/docs/en/hooks)

## 验证

- `node --test relay/relay.test.mjs` 通过 12 项。覆盖超过 60 秒的同波合并、重启、超时和晚到归档、独立单 worker 波、失败抄送以及旧状态恢复。
- relay 的各个 `.mjs` 文件通过 `node --check`。实验启动器 `/Users/sun/Code/exp-relay/launch.sh` 通过 `zsh -n`。实跑限于独立冒烟。
- 全新目录 `/Users/sun/Code/exp-relay/relay-smoke2/` 使用普通 Bash 扮演 Leader。同波 Codex 和 agy 终端同时启动，刻意推迟 agy 的任务输入以检验旧 60 秒窗口。Codex 先回报，登记后 147.164 秒时 Leader 仍收到 0 条。Codex 与 agy 的 Stop 相差 **286.198 秒**。agy 完成后 Leader 实收 **1 条**消息，含两份原生最终回复，relay 队列和发件箱均为空。[中途检查](</Users/sun/Code/exp-relay/relay-smoke2/before-agy.json>) · [Leader 收件](</Users/sun/Code/exp-relay/relay-smoke2/messages/1.txt>)
- Codex 0.171.0、agy 1.5.16 和 Claude Code 2.1.322 的首轮均未因目录信任暂停。另在新子目录用 skill 的 Codex `workspace-write` 启动参数验证了 `DONE CODEX-RECIPE` 的 Stop。测试进程保护了全局配置文件，指定全局配置的元数据前后相同。
- 所有冒烟终端均经 `hc kill` 并确认 `finished`。本波 Leader `t2xg`、relay `t2xm`、Codex `t2xh`、agy `t2xk`，另有 Claude `t2xj` 和 Codex 命令复验 `t2xn`。

## 验证范围与遗留问题

真实冒烟验证了成功波的单次投递。失败抄送和超时由单元测试覆盖。若 `hc send` 返回的送达结果不明确，relay 保留发件状态和归档供核对，自动重试只用于明确拒收。

STATUS: done
