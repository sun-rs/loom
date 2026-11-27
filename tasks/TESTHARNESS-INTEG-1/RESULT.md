# TESTHARNESS-INTEG-1 结果

基线为 `af3eaedb`（分支 `infra/testharness-integ`，工作树 `/Users/sun/Code/repos/loom-testharness`）。全部改动仅限测试支撑、测试夹具与测试文件，未修改产品代码路径。

## 改动摘要

1. **短测试根与 Unix socket ≤ 103 字节断言**
   - 新增 `test-support/integration-bin.mjs`（共享 `UNIX_SOCKET_PATH_LIMIT = 103`、`assertSocketPathLimit` 与 `integration-bin` 严格校验）。
   - `test-support/run.mjs`：在检测到 `LOOM_TEST_PS` 或 `LOOM_WORKER_TMP`（worker 私有 `$TMPDIR`）时，以 1 字符私有目录（`0`–`z`，`0o700`）替代 `lt-XXXXXX`，将 `/private/tmp/lw-<uuid>/t`（54 字节）下的测试根压到 56 字节；启动时即校验 `hostSocket`（96 字节）、`cli/accounts` `socketPath`（97 字节）和 `integrationPs` `socketPath`（102 字节）均 ≤ 103 字节。
   - `test-support/spawn-guard.mjs`：拦截 `net.Server.prototype.listen` 与 `net.Socket.prototype.connect`，在运行时强制所有测试 Unix socket 路径 ≤ 103 字节（超限写入 `spawn-violations` 并抛 `loom-test-socket-path`）。
   - `daemon/worker-environment.test.mjs`：`integration permits limited worktree process listings...` 将 `fixtureWorkerEnvironment` 父目录改为短基准目录而非嵌套在 `loom-integration-XXXXXX` 内，并通过 `registerIntegrationDirectory` 显式登记其测试内生成的 `integration-bin` 目录。

2. **`--integration` 固定 `integration-bin` 目录显式登记与 `upgrade.test.mjs` 适配**
   - `test-support/run.mjs`、`test-support/spawn-guard.mjs`、`fixtures/test-process.mjs` 共享同一套严格校验：仅登记位于 worker 临时父目录下、名为 `integration-bin`、canonical realpath、属主为当前 UID 且权限 `0o700` 的目录；不放宽为任意路径，且符号链接逃逸仍按 `realpathSync` 拒绝。修复 `daemon/hardening.test.mjs:48` 被 `fixtures/test-process.mjs` 拒绝 `$TMPDIR/integration-bin/ps` 的问题（`daemon/hardening.test.mjs` 同步透传 `LOOM_TEST_INTEGRATION_BIN`）。
   - `daemon/upgrade.test.mjs`：原 `ps` 包装脚本硬编码 `execFileSync('/bin/ps', ...)` 在 macOS Seatbelt 下报 `EPERM`，且 `loom daemon start` 托管出的孤儿 `loomd`/`loom-holder` 脱离进程树而不可见于树内 `integration-bin/ps`；改为通过 `processCommand()`（清 `LOOM_TEST_PS` 后解析，Seatbelt 下沿用产品既有的本地临时签名 `ps` 副本）配合 `spawnSync` 转发退出码。

3. **`daemon/socket-auth.test.mjs:45` 透传 `LOOM_WORKER_TMP` 与短根回退**
   - 透传 `LOOM_WORKER_TMP`（以及 `LOOM_TEST_PS` / `LOOM_TEST_PS_BACKEND` / `LOOM_TEST_INTEGRATION_BIN`）；在未设 `LOOM_WORKER_TMP` 的直接单测回退场景下使用短根（宿主机 `/private/tmp/lsa-XXXXXX`），避免回退到 `/tmp/loom-host-501` 被沙箱 `EPERM` 或超出 103 字节。

4. **回归测试**
   - `test-support/spawn-guard.test.mjs` 新增 3 组回归：103/104 字节边界及 `net.createServer().listen` 运行时守卫、54 字节 worker `$TMPDIR` 下 `createTestRoot` 路径预算与超限拒绝、`integration-bin` 显式登记与非私有/任意目录/符号链接逃逸拒绝。

## 验证

- **RED 复现（真实 `--integration` Seatbelt 沙箱，使用 `workerEnvironment` + `integrationPs` + `sandboxNativeWorker`）**：定向跑受影响 5 文件中的 7 项用例，精确复现全部 6 项失败（`cli/accounts.test.mjs` 2 项 `EINVAL`/退出 1、`daemon/worker-environment.test.mjs` 1 项 `EINVAL`、`daemon/hardening.test.mjs:48` 1 项 `integration-bin/ps` 拒绝、`daemon/socket-auth.test.mjs:45` 1 项 `/tmp/loom-host-501` `EPERM`、`daemon/upgrade.test.mjs:81` 1 项 `process-enumeration-failed`）。
- **静态检查**：`/opt/homebrew/bin/npm run lint` 通过（`Loom lint passed (331 files)`）；`/usr/bin/git diff --check` 通过。
- **直接单测回退（宿主机，不经 `test-support/run.mjs`）**：`daemon/socket-auth.test.mjs`、`daemon/worker-environment.test.mjs`、`test-support/spawn-guard.test.mjs` 共 10 过 / 0 败 / 1 跳过（预期：未走 `npm test` 时跳过 guard 专项）。
- **宿主机全量 `/opt/homebrew/bin/npm test`**：退出码 `0`，875 过 / 0 败 / 0 取消 / 1 跳过（`daemon/socket-auth.test.mjs` 并发下 `peer --self-check` 单次 2000ms 超时跳过；直接单测与沙箱全量均通过）。日志：`/tmp/testharness-integ-1-host.log`。
- **真实 `--integration` worker Seatbelt 沙箱全量 `/opt/homebrew/bin/npm test`**（生产 `workerEnvironment` + `integrationPs` + `sandboxNativeWorker`）：退出码 `0`，872 过 / 0 败 / 0 取消 / 4 跳过（全部 4 项为 `# sandbox-limited: macOS rejects a nested Seatbelt profile`），0 `spawn-violations`。日志：`/tmp/testharness-integ-1-sandbox.log`。

STATUS: done
