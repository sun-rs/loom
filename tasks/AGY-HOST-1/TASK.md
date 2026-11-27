# AGY-HOST-1：host 档 agy worker 启动即退出

现象（pilot-cell @812270f0，2026-11-27）：`--cli agy` 的 host 档 headless worker 启动时 `agy acp` 报 `flags provided but not defined: -settings` 立即退出，host grant 被预扣而零执行。两次复现（CELL-ISO-1-T0、CELL-ISO-1-DENSITY）。

## 要做
1. 先写 RED：用固定版本 agy 的真实 `agy acp --help` 参数表（只读运行 help，不登录、不发请求）建夹具，断言 loom 给 `agy acp` 的 argv 只含该子命令支持的参数。
2. 找出 host 档（及 integration/sandbox 档）给 agy 拼 `--settings` 的位置（参考 daemon/account-wiring-codex-agy.test.mjs:170），改为该版本支持的方式传设置；不支持就不传，并在启动前预检失败时报明确原因。
3. 启动前预检失败不应消耗 host grant 次数（只有真正启动会话才计次）；改动需有测试。
4. 全量 `npm test`、`npm run lint` 通过。分支 infra/agy-host，工作树 /Users/sun/Code/repos/loom-agy-host，显式路径提交，不 commit -a。结果写 RESULT.md，以 STATUS 行收尾。Codex 周额度 <10%，请求保持精简。

## 追加（Super）：失败会话残留预留吞掉新授权
pilot-cell 实况：host worker oar-624e4897 以 host-grant-exhausted 启动失败后，会话记录未清理；Super 对同一 task 新签 grant 后 3 秒内，该失败会话被重新 claim（host-grants.json claims 记录），grant 变为 0 剩余，但会话从未运行（记录仍为 error）。
- RED：失败（任何启动前/启动时错误）的会话不得在之后自动 claim 新 grant；新 grant 只能被新的显式 spawn 使用。
- claim 只在子进程真正启动后计入；启动失败回滚 claim。
- 与上面第 3 条一起交付、一起测。

## 追加 2（Super）：Claude headless 报 Not logged in
pilot-cell @812270f0：`--cli claude --model sonnet --tier host` 的 headless worker（oar-15ed61b4、oar-586dbfcb）0 秒返回 `Not logged in · Please run /login`，0 工具调用。同机 Claude TUI 是已登录的。只读材料：/Users/sun/Code/loom-pilot-cell/.project/notes/decision-host-worker-cli.md 与对应 sessions/*.json。疑点：headless 启动环境里的 HOME / CLAUDE_CONFIG_DIR / 钥匙串可达性（pilot-cell 的 CELL-SCHED-1 提交曾"在所有绑定的 Claude 启动路径上剥掉 CLAUDE_SECURESTORAGE_CONFIG_DIR"，该改动尚未进 main，但请对照）。要求：找根因、写 RED、修复；不读凭据、不读钥匙串内容，只看启动参数与环境变量名。

## 追加 3（Super）：host 档 codex 仍在 Codex 自带 Seatbelt 里
pilot-cell @b0c0b28e：`--cli codex --tier host` 的 worker（oar-b9ebbb5b）内运行 `srt`（sandbox-exec）报 EPERM，PTY 分配也 EPERM（证据 /Users/sun/Code/loom-pilot-cell/tasks/CELL-ISO-1/T0-RESULT.md，只读）。host 档的定义是受信宿主执行，应以 Codex 的无沙箱模式启动（等价 `--sandbox danger-full-access` 或对应 launch-scoped 配置，不改全局配置），由 grant 机制计次与审计兜底。
- RED：host 档 codex 启动 argv/配置里不得带 workspace-write/read-only 沙箱；在 host worker 内 `/usr/bin/sandbox-exec -p '(version 1)(allow default)' /usr/bin/true` 与 PTY 分配可用（夹具或真机二选一，真机需 Super 授权）。
- integration/sandbox 档保持原样不变。
- 三个 CLI（codex、claude、agy）host 档的启动行为在 RESULT.md 列一张表：沙箱状态、登录态来源、argv 关键项。
