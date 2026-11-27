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

STATUS: done
