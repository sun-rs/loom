# WORKER-TIER-1 验收记录

基于 `integ/main-1` 的 `2d43eac2` 实现 `sandbox`、`integration`、`host` 三档。`sandbox` 是默认值。`--integration` 仍可用。启动回执、`loom status` 和 Status TUI 显示档位。

## 授权与到期

- `loom grant <task|wave> host --reason … [--uses N] [--ttl 30m] [--write PATH]…` 使用 SOCK-AUTH-1 验证调用者。Super 可签发。当前 Leader 可加 `--request` 给 Super 发送待决通知。预授权只来自 `roles.worker.tiers` 中精确的波次名，默认一次，且没有额外写入路径。
- 每次启动 host 会话前，loomd 把一次用量与会话地址一起写入持久化记录。`--uses` 默认 1。额度用尽时拒绝启动并记录通知。启动失败时该次尝试仍计入。已运行的会话恢复连接沿用原记录，重新启动原生会话需要新的一次授权额度。
- 授权默认 30 分钟，卡片给出结论后关闭该卡片的 host 会话。单卡授权随卡结束，波次授权的其它卡片仍按同一波次额度和 TTL 处理。授权、使用、拒绝和过期进入 Super 通知。host 会话使用 headless 模式。

## 原生权限与证据

host 是 Super 明确授予的信任档。**Not fail-closed for Codex tool paths.** 该限制也出现在授权通知中。工具钩子尽力拦截已知凭据路径、受保护位置和未经批准的外联。macOS 另外限制写入到工作树、临时目录、原生运行状态和 `--write` 明确允许的路径。Codex 上的会话日志、SQLite 和线程锁属于原生运行状态。 [Codex 钩子覆盖](https://learn.chatgpt.com/docs/hooks#tool-coverage)

| CLI | 核对版本 | host 会话设置 |
| --- | --- | --- |
| Codex | 0.172.0 | `danger-full-access`、审批 `never`、PreToolUse 钩子及 macOS 写入边界 |
| Antigravity | 1.5.18 | ACP 使用 `--sandbox=false`、原生 hook 和 macOS 写入边界 |
| Claude Code | 2.1.331 | OAR 无审批启动、PreToolUse 钩子及 macOS 写入边界 |
| OpenCode | 2.3.0 | 原生登录环境、权限插件及 macOS 写入边界 |

CLI 路径先转成绝对 `realpath`，含 `/ccp/` 或 `claude-protected` 的路径会被拒绝。Loom 记录探测、启动、导出和钩子观察到的原生 CLI 路径。host 证据卡保留运行时报告的完整命令、退出状态和 CLI 路径。命令日志覆盖取决于原生运行时事件和钩子。工具输出和登录凭据不进入该命令日志。

## 验证

- 在指定工作树运行 `npm ci`。对最终基线运行 `npm test -- --test-concurrency=4`，776 项通过，0 失败，0 跳过。`git diff --check` 通过。夹具覆盖四个 CLI 的三档会话选择、SOCK-AUTH-1 的 Super 和 Leader 权限、伪造身份拒绝、二次启动拒绝、持久化额度、TTL、路径解析、CCP 拒绝和 macOS 授权及未授权写入。
- 在一次性项目里实际启动 Codex 0.172.0 的 host Worker。Worker 执行 `/opt/homebrew/Caskroom/codex/0.172.0/bin/codex login status`，退出 0，返回 `AUTH_OK`。第二次启动返回 `host-grant-exhausted`。修复空闲 inbox 的结案处理后，重启该项目的 loomd 验证已完成卡片的回放。授权记录显示 `card-ended`，并生成完整命令和解析路径证据卡。 [一次性项目证据](/private/tmp/lh-probe.GXfHPB/p/.project/evidence/LIVE-HOST-PROBE-host-oar-20a5a2d1-3e13-4330-96f1-3d073e0560b2.json)

STATUS: done
