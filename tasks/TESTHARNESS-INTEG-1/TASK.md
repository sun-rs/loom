# TESTHARNESS-INTEG-1：全量测试在 --integration worker 沙箱内跑通

来源：pilot-cell 合入 main@f10db71d 后，在 `--integration` worker（macOS Seatbelt）内跑全量 `npm test` 得 909 过 / 6 败；宿主机同版本 873/0。详情：/Users/sun/Code/loom-pilot-cell/.project/notes/decision-main-f10db71d-integration-sandbox.md（只读）。

## 要修的三处
1. `test-support/run.mjs`：在 `$TMPDIR`=/private/tmp/lw-<uuid>/t 下再叠 `lt-XXXXXX`，Unix socket 路径超过 macOS 104 字节 → `listen EINVAL`（cli/accounts.test.mjs 2 项，daemon/worker-environment.test.mjs 1 项）。缩短路径或改用短根，并加断言：生成的任何 socket 路径 ≤ 103 字节。
2. `test-support/spawn-guard.mjs`：拒绝 `--integration` 注入的 `$TMPDIR/integration-bin/ps`（hardening.test.mjs:48，upgrade.test.mjs:82）。让 integration 注入的固定目录成为登记过的 fixture 目录（显式登记，不放宽为任意路径）。
3. `daemon/socket-auth.test.mjs:45`：未透传 `LOOM_WORKER_TMP`，回退 /tmp/loom-host-501 被沙箱 EPERM。透传，且回退路径同样走短根。

## 验收
- 宿主机 `npm test` 仍全过；在真实 `--integration` worker 沙箱（loom 起一次性项目或等价方式）内全量 `npm test` 0 失败，附日志。
- `npm run lint`、`git diff --check` 通过。
- 不改产品代码路径的行为，只改测试支撑；若必须动产品代码，先停下报告。
- 分支 infra/testharness-integ，工作树 /Users/sun/Code/repos/loom-testharness，显式路径提交，不 commit -a。结果写 RESULT.md，以 STATUS 行收尾。
- Codex 周额度剩 <10%：保持请求精简，额度不足时如实停下报告。
