# CELL-SYNC-1：把 main 5dd8b2d6 合入 pilot-cell（f4a3f006）

工作树 /Users/sun/Code/repos/loom-cell-sync，分支 merge/sync-main-5dd8b2d6-r2，起点 pilot-cell f4a3f006。不要碰 /Users/sun/Code/loom-pilot-cell 的工作树和其中任何终端。

## 要做
1. `git merge --no-ff 5dd8b2d6`。已知冲突：daemon/host-client.mjs、daemon/oar.mjs、daemon/session-host.mjs、daemon/sessions.mjs（可能还有别的）。
2. 解冲突原则：两边功能都要保留。
   - main 侧：AGY-HOST-1（agy ACP 参数、claude host 原生登录命名空间、codex host danger-full-access、授权在真正启动后计次、失败回滚）、ROT-AGY-1（agy 欢迎屏可写识别、换班失败回收继任）、INTEG-3、MERGE-ACCT-1。
   - pilot-cell 侧：CELL-SCHED-1/2（调度模块 lib/cell/、续派、默认关闭）、GATE-PACK-SCOPE-1（证据按 base..candidate、16 KiB 上限）、C6 的续派唤醒父级和旧地址改投。
   - 账号相关以 main 的模块边界为准，调度代码对接 main 的账号接口。
3. 每处冲突在 RESULT.md 写一行：文件、两边各做了什么、怎么合。
4. `npm ci`、`npm run lint`、全量 `npm test` 在本机直接跑（你不在 loom 沙箱里，可以直接跑），要求 0 失败；附统计行。`git diff --check` 通过。
5. 提交合并（显式路径，不 commit -a），RESULT.md 以 STATUS 行收尾。不 push，不改 main，不改 pilot-cell 分支。
所有 CLI 用绝对路径，不改全局配置，不读凭据。
