# UPG-PIN-1 结果

## 复现与根因

用 `849161dd/bin/loom upgrade --project <pilot> --to <849161dd> --check --json` 在 `pilot-cell`（`49128825`）和 `pilot-2`（`e97556ae`）均复现退出码 1，错误为 `Release self-check returned an incompatible build`。两边在检查前后分别保持 daemon PID `95586` 和 `12522`，实际 Node 均为 `25.9.0`。真实 pilot 上的操作仅有只读检查和状态查询。

以旧 daemon 的 Node 和调用方式运行 `849161dd/bin/loomd --self-check`，报告 `node=25.9.0`、`nodeRuntime.version=26.13.1`、`daemonProtocol=1`。两边旧 verifier 的 `digest` 均匹配 `950d89b05fb7…`。失败项是 `releaseDigest`。旧代码算出的摘要包含 holder，值为 `d1d3a97e8e99…`。新代码额外覆盖 Loom 角色技能和 `docs/HEADLESS.md`，回报 `4fb7638978e4…`。

## 修复

升级校验 RPC 由当前在线的旧 daemon 执行。新 CLI 仍需让旧 daemon 自己校验候选，故兼容处理落在新 release 的 `loomd --self-check`。旧 Node 调用候选并由候选原地 `execve` 到固定 Node 时，自检按旧覆盖范围回报 `releaseDigest`，同时提供 `fullReleaseDigest` 和真实的固定 Node 身份。旧 daemon 将额外字段保留在交接记录和 release 指针中。新 daemon 在交接、后续升级和回滚计划中使用完整摘要，继续校验技能文件完整性。

## 验证

- 回归先失败于旧摘要比较，修复后通过。夹具验证旧摘要、固定 Node 身份、交接及后续计划，并验证交接时会拒绝自检后被改动的角色技能文件。
- 在临时项目分别用 `49128825` 和 `e97556ae` 的真实发布代码启动 Node 25.9.0 daemon。修复版的 `--check` 均为 `eligible: true`，热升级均为 `committed` 且新 daemon 使用 Node 26.13.1，回滚预检和实走回滚均通过。同样验证了以固定 Node 运行的 `849161dd` 到修复版的升级和回滚。
- 在 `49128825` 的独立临时项目中带一个模拟 Codex 会话实走升级和回滚。会话 host PID 与 session ID 均保持，切换到修复版后的投递得到回执。
- 固定 Node 26.13.1 下 `npm ci`、`npm run lint` 和全量 `npm test` 均通过。全量 1162 项全部通过，0 fail、0 cancelled、0 skipped。

## 交给 Super

两个 pilot 可直接迁移到包含本修复的独立 release。先用 `bin/build-release` 构建该 release，再从该 release 的 CLI 对各 pilot 单独执行 `upgrade --to <修复版绝对路径> --check --json`。确认 `eligible: true`、`attachmentCheck: checked` 和 `target.nodeRuntime.version: 26.13.1` 后，由 Super 决定是否应用升级并用 `upgrade --status` 确认交接。保留各自的旧 release 和 Node 25.9.0 供现有会话及回滚使用。

CLI 收到预检结果后会运行 prompt doctor，可能更新 `prompt-smoke.json`。本次在真实 pilot 上的复现在摘要校验处返回，未走到 prompt doctor。

兼容触发条件是候选发现调用方使用了不同的 Node 可执行文件。这覆盖两个卡面 pilot。若其他旧 daemon 使用同一固定 Node 可执行文件、同时沿用旧摘要协议，则需单独验证迁移路径。
