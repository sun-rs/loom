# AGY-HOST-1 验收

- 分支 `infra/agy-host`，基线 `5937c1b77ae8288e94f718ac36cb3f7c89dc328c`。仓库版 `worker-check` 返回 `not-ready`，该工作树未运行 loomd。分支、基线和初始工作树用 Git 核对，任务范围按 Super 派发的卡面确认。
- 实际 `agy` 为 1.5.18。只运行 `--version` 和 `acp --help`。夹具与实际帮助输出逐字节一致。[ACP 参数表](../../adapters/agy/fixtures/agy-1.5.18-acp-help.txt)
- RED 运行 `node --test --test-name-pattern='headless agy tiers|invariant idempotency agy preflight' daemon/hardening.test.mjs`，退出 1。严格参数夹具报告 `flags provided but not defined: --settings`，ACP 进程退出 2。[RED 原始输出](/tmp/loom-agy-host-red.pOrGE2)
- ACP 使用 `--add-dir` 加载暂存的项目钩子配置。三档共用参数预检，报错会指出已安装的 `agy acp` 缺少哪些所需参数。
- 追加 RED 运行 `node --test --test-name-pattern='failed native host startup' daemon/hardening.test.mjs`，退出 1。ACP 夹具在 `session/new` 退出时，账本仍残留一条扣次。[追加 RED 原始输出](/tmp/loom-agy-host-append-red.ApQJei)
- 预检通过后只预留本次显式 `spawn` 绑定的授权。原生会话就绪后，loomd 将预留转为正式扣次，并记录使用通知。启动失败释放预留。恢复时直接收尾已记录启动错误的 host 会话。重放同一会话地址沿用原扣次。
- GREEN 夹具覆盖三档启动 argv、缺少 `--sandbox` 时保留原授权、ACP 启动退出时释放预留，以及 loomd 重启时回收残留错误记录。替换授权由新的显式 `spawn` 使用。
- `npm test` 全量 876 项通过。最终命名的 4 项回归、`npm run lint` 和 `git diff --check` 均通过。[全量测试输出](/tmp/loom-agy-host-final-test.RRFOqF) · [回归输出](/tmp/loom-agy-host-invariants.ABaqZz)

## Claude headless 登录

- 两条 pilot-cell 失败记录都是未绑账号的订阅 host 会话。`812270f0` 已包含 `18c20e50`，该提交仅在绑定账号时移除 `CLAUDE_SECURESTORAGE_CONFIG_DIR`。未绑定的 host 启动路径会把缺省的 `CLAUDE_CONFIG_DIR` 补成 `~/.claude`。OAR 0.130.1 的 `runtimes/claude/credentials.js` 记录了 macOS 上显式设置该变量会切换钥匙串命名空间。
- RED 运行 `node --test --test-name-pattern='Claude headless host keeps' daemon/adopt-launch.test.mjs`，退出 1。原生启动夹具看到多出来的配置目录，`HOME` 和 headless 参数符合预期。[Claude RED 原始输出](/tmp/loom-claude-host-red.a8PyiY)
- 修复保留原生启动环境中的配置目录缺省状态及显式覆盖，写入边界继续使用解析后的目录。启动回归使用真实 OAR 与本地 Claude 夹具，仅检查启动参数和环境变量，实机登录未复验。
- `npm test` 全量 877 项通过，`npm run lint` 和 `git diff --check` 通过。[全量测试输出](/tmp/loom-claude-host-test.RSl7eV)

## Codex host Seatbelt

- RED 运行 `node --test --test-name-pattern='Codex host launches' daemon/hardening.test.mjs`，退出 1。夹具捕获的 app-server 配置已经是 `sandbox_mode="danger-full-access"`，但实际启动经过 Loom 生成的 `host-native` Seatbelt 包装。夹具模拟的子级 `sandbox-exec` 与 PTY 均返回 `EPERM`。[Codex RED 原始输出](/tmp/loom-codex-host-red.PrEAw7) · [Codex 0.172.0 配置解析](https://github.com/openai/codex/blob/rust-v0.172.0/codex-rs/config/src/permission_config.rs)
- Codex host 直接启动。夹具确认两项模拟探针可用，grant 启动成功后扣次，工具钩子启用。integration 和 sandbox 仍选各自的 `loom-worker-*` 权限配置。Codex host 的 `--write` 作为授权范围记录，内核写入隔离已移除，工具钩子尽力执行。探针只用夹具验证。

## 三家 CLI 的 host 启动

| CLI | 沙箱状态 | 登录态来源 | 启动关键 argv |
| --- | --- | --- | --- |
| Codex | 直接启动，Codex 沙箱关闭。grant 控制计次、到期和审计 | 原生 `CODEX_HOME`，缺省 `~/.codex` | `app-server`、`-c sandbox_mode="danger-full-access"`、`-c approval_policy="never"`、`-c features.hooks=true` |
| Claude | macOS 使用 Loom Seatbelt 写入边界。OAR 跳过原生审批提示 | 原生 `HOME` 和登录命名空间，保留 `CLAUDE_CONFIG_DIR` 与 `CLAUDE_SECURESTORAGE_CONFIG_DIR` 的启动环境语义 | `-p`、`--input-format stream-json`、`--output-format stream-json`、`--dangerously-skip-permissions`、`--settings` 注入工具钩子 |
| agy | macOS 使用 Loom Seatbelt 写入边界，agy 自带沙箱关闭 | 原生 `HOME` 和 `ANTIGRAVITY_APP_DATA_DIR`，`GEMINI_HOME` 设定时由 OAR 传 `--gemini-dir` | `acp`、`--process-per-session`、`--sandbox=false`、`--log-file`、`--add-dir` 加载暂存钩子 |

统一验收的 `npm test` 全量 878 项通过。`npm run lint` 和 `git diff --check` 通过。[统一验收输出](/tmp/loom-codex-host-test.NP0KcB)

STATUS: done
