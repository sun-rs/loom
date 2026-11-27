# Codex 一键切号：cc-switch 与 Magpie 实现调研（2026-11-27）

方法：只读网页/GitHub issue/源码片段，未运行工具、未读本地凭据。版本：cc-switch v3.20.x（release notes v3.20.1），Magpie v0.1.2136~v0.1.3681（issue 提及）。WebFetch 为摘要，细节需对照源码 [unverified]。

## cc-switch (farion1231/cc-switch, Tauri)
1. 存储：Provider 存 SQLite `~/.cc-switch/cc-switch.db`；托管 ChatGPT OAuth 账号存 `~/.cc-switch/codex_oauth_auth.json`；官方登录暂存 `~/.cc-switch/codex-login-stash.json`；`live-state.json`、backups/。写入 auth.json 的内容为原生形态 `auth_mode:"chatgpt"`, `tokens{access_token,refresh_token,account_id,id_token}`, `last_refresh`，明文 JSON（未见加密/钥匙串）。所有权标记文件 `codex_managed_oauth_live_auth.json` 只含账号 id/workspace/sub，不含 token。结论：持有 OAuth token（含 refresh_token）。
2. 切换：覆盖写 `<codex dir>/auth.json` + `config.toml`（`src-tauri/src/codex_config.rs::write_codex_live_atomic`，先 auth 后 config，config 失败则回滚 auth；仅两文件回滚，非事务）。codex dir 可由设置覆盖（默认 ~/.codex）。不调用 codex login，也不走 app-server。第三方 provider 自 v3.20.1 起仅改 config，auth.json 回归纯官方登录文件。
3. 运行中会话：文档称 Codex 需重启才生效；Claude Code 无需重启。刷新 token 重复风险已实锤：issue #4474（codex_oauth_auth.json 与 provider DB 内 auth 副本刷新后分叉，旧副本触发 `refresh_token_reused`，被误标 session expired）；issue #2538（切回时恢复陈旧 auth.json 快照）；v3.20.1 为此加“可证明所有权”才采纳 CLI 轮换的 refresh token / 删除 auth.json，旧账号需重新登录。
4. Claude Code：文档说明改配置（endpoint/key/model），无需重启，保留插件/hooks/MCP；配置目录可设（默认 ~/.claude [unverified]）。只见 settings env 类（ANTHROPIC_BASE_URL/KEY）切换，未见动 keychain/.credentials.json [unverified，未读源码]。

## Magpie (yetone/magpie, 本地网关)
1. 存储：README 称通过读取 Claude Code 和 Codex 的登录文件与钥匙串发现订阅账号；自己存账号 token 的位置/加密方式文档未说明 [unverified]。支持多账号、远程 magpie（远程额度可见，#6258 称路由未获得远程额度）。
2. 切换：`magpie accounts switch codex next|<email>`；额度到 98%/100% 自动把 `~/.codex/auth.json` 换到下一个有余量账号，<90% 切回（#1907）。`switch-only codex on` 不写网关 `openai_base_url` 到 config.toml，仅切登录。未见 CODEX_HOME 方案；未见调用 app-server account/login API（#5476 仅见其读 account/read 作观察）。
3. 运行中会话：Codex Desktop / 运行中的 app-server 只在启动时读登录，已开会话保持原账号；新 CLI 会话立即用新账号（#1907）。Desktop：Magpie 等空闲（10s 无请求、无 open turn）后 SIGTERM 干净退出 app-server，App 自动拉起新 app-server 并保留窗口/线程（#5476）；已知竞态：重连后 "Hosted AppServerManager identity is not ready" 或无法 resume 会话，Magpie 在 60s 内读日志，必要时退出重开 App 一次（补丁未合并）。“切一次连接后继续”即此机制。Magpie 读额度用“Codex 保管的 token，从不刷新或写回”，避免自身刷新；但多副本 refresh_token 轮换风险文档未讨论 [unverified]。
4. Claude 侧：同样 `accounts switch claude`，机制未查明 [unverified]。
5. 结论：Magpie 至少读并改写 auth.json（经手 token），自有账号库是否持久保存 token 未证实 [unverified]。

## 结论
- cc-switch：持有（明文，自有文件+DB 多副本，已出现 refresh_token_reused）。Magpie：经手并写入 auth.json，自存与否未证实。
- 无需工具持 token 的替代：每账号一个 CODEX_HOME（如 ~/.loom/codex/<acct>），用户各自 `codex login` 一次，切换=启动 codex/app-server 时设 CODEX_HOME；每目录只有一份 refresh token 由 codex 自己轮换，无多副本竞态。代价：已运行进程不会热切换，需重启 app-server 并 resume 线程（thread 历史在 CODEX_HOME 下，跨账号需共享/迁移 sessions 或用 symlink [unverified]）。官方说明：https://developers.openai.com/codex/auth/ci-cd-auth（auth.json 视同密码，勿多处共享刷新）。CODEX_HOME 行为为 Codex 通用约定 [unverified 于本次源码]。

## 来源
- https://github.com/farion1231/cc-switch
- https://github.com/farion1231/cc-switch/blob/main/src-tauri/src/codex_config.rs
- https://github.com/farion1231/cc-switch/issues/4474 ; /issues/2538 ; /issues/6668 ; /pull/6689
- https://github.com/farion1231/cc-switch/blob/main/docs/release-notes/v3.20.1-en.md
- https://github.com/yetone/magpie ; /issues/1907 ; /issues/5476 ; /issues/5132 ; /issues/6258 ; /issues/3644
- https://github.com/yetone/magpie/blob/main/README.zh-CN.md
- https://developers.openai.com/codex/auth/ci-cd-auth
