# MERGE-ACCT-1 验收记录

从 `pilot-cell` 的 `880b0110` 提取账户功能，在 `/Users/sun/Code/repos/loom-acct-merge` 的 `merge/accounts` 分支提交合入候选。采集、会话绑定、快照存储、主动刷新、通知和显示各自通过明确接口衔接。文件和接口清单见 [ACCOUNTS.md](../../docs/ACCOUNTS.md)。

- `loom accounts --json`、`loom status` 与 Status TUI 的 Cost 页共享公开快照。TUI 使用现有 `board.accounts` 合约，离线时读取项目快照。账户标签在写入前掩码处理，夹具使用合成地址。 [JSON 合约](../../docs/ACCOUNTS-SCHEMA.md)
- 已验证版本继续正常显示。未列入白名单的版本通过结构校验后保留用量并标记 `unverified version`。loomd 按提供方和版本去重通知 Super。结构不匹配的回复产生诊断，之前有效的快照保留原时间和过期规则。
- 主动刷新沿用 SOCK-AUTH。已认证的 Super 和持有效 host 授权的 Worker 可发起刷新。loomd 合并并发请求，并在结束时取消本次探测进程。测试中的原生命令通过绝对路径绑定夹具。
- 可执行文件解析单独提交。账户探测复用 main 的 `realpath` 校验，对 Codex、Claude、Antigravity 和 OpenCode 拒绝 CCP 路径。Claude 优先选择原生版本。`daemon/host-client.mjs` 沿用 main 已有的私有 socket 验证和恢复逻辑。

## 验证

- `npm ci` 与 `npm run lint` 通过。专项验证覆盖掩码、四种提供方的 CCP 拒绝、有效未验证版本、错误结构拒绝、Super 通知和 CLI 与 TUI 数据一致性。
- 在同一账户实现上运行两轮 `npm test -- --test-concurrency=4`。每轮 859 项通过，0 失败，0 取消，0 跳过。运行后变基到 `main` 的 `d71d1041`，核对追加的上游改动只有研究文档，并复跑 lint。`git diff --check` 通过。
- 解析提交为 `e3f6dea1`，账户模块提交为 `c18edf3b`。两者在本地 `merge/accounts` 分支，供审核后合入。

STATUS: done
