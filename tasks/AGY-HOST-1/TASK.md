# AGY-HOST-1：host 档 agy worker 启动即退出

现象（pilot-cell @812270f0，2026-11-27）：`--cli agy` 的 host 档 headless worker 启动时 `agy acp` 报 `flags provided but not defined: -settings` 立即退出，host grant 被预扣而零执行。两次复现（CELL-ISO-1-T0、CELL-ISO-1-DENSITY）。

## 要做
1. 先写 RED：用固定版本 agy 的真实 `agy acp --help` 参数表（只读运行 help，不登录、不发请求）建夹具，断言 loom 给 `agy acp` 的 argv 只含该子命令支持的参数。
2. 找出 host 档（及 integration/sandbox 档）给 agy 拼 `--settings` 的位置（参考 daemon/account-wiring-codex-agy.test.mjs:170），改为该版本支持的方式传设置；不支持就不传，并在启动前预检失败时报明确原因。
3. 启动前预检失败不应消耗 host grant 次数（只有真正启动会话才计次）；改动需有测试。
4. 全量 `npm test`、`npm run lint` 通过。分支 infra/agy-host，工作树 /Users/sun/Code/repos/loom-agy-host，显式路径提交，不 commit -a。结果写 RESULT.md，以 STATUS 行收尾。Codex 周额度 <10%，请求保持精简。
