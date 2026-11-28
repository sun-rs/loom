# agy (Antigravity CLI) 多账号 / 凭据存储 外部调研 — 2026-11-27
范围: 纯网页检索, 未运行 agy, 未读任何凭据。版本背景: agy 1.5.18。标注 [未验证] = 仅来自第三方转述。

## 1. 关键事实 (按可信度)
- 1.5.16 起: 去掉了"SSH_CONNECTION 即回落文件存储"的行为; 改由环境变量 AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1 强制文件存储。旧名 AGY_ACP_FORCE_FILE_STORAGE 被忽略。(t3code issue #41973; 1.5.15 日志 "file-based token storage because SSH session detected")
- 不设该变量时: 个人 Google 登录写共享系统 keyring (macOS 登录钥匙串 service=gemini, account=antigravity, 值前缀 go-keyring-base64:), 不写 token 文件。多个 profile 共用这一条目 -> 有人观察到 profile 串号/用错账号 (t3code #41973)。
- 文件模式 token 路径: <GEMINI_HOME 或默认 ~/.gemini>/antigravity-cli/antigravity-oauth-token (0600) [路径细节来自第三方; t3code 用 GEMINI_HOME 隔离 profile]。文件 JSON 须与 keychain 载荷同结构, 含 auth_method (只有 access_token 会报 unknown auth method)。
- 从 keychain 切文件存储需要重新浏览器登录; 无浏览器环境会报 "No browser is available here"。
- 无官方多账号支持; 未检索到官方文档页描述凭据存储 env (官方 changelog 仅提到 OAuth 持久化修复)。
- 用量: /usage 或 /quota; 无 Pro/Ultra 为每周基线额度, Pro/Ultra 5 小时 + 每周 (realpython / gradually.ai 转述)。

## 2. 对本次现象的解释 (推断, 未验证)
后台复用器(无 GUI 会话)里的 agy 很可能: (a) 读不到/读到锁定的登录钥匙串, 回落文件 token(旧账号残留); 或 (b) 读钥匙串但 securityd 会话不同。旧文件 token 仍在 -> /usage 报旧账号。重新登录写入钥匙串(Terminal 会话), 文件 token 不更新。即"两个存储并存"。1.5.16+ 在 SSH 下不再自动回落文件, 但锁定时的回落 (changelog 所述) 仍可能存在 [未验证]。

## 3. 项目/做法表
| 项目 | 机制 | 成熟度 | 许可 | 风险 |
|---|---|---|---|---|
| aklkbqx/agy-swap (另有 pr656d、gaoxiang89 同名) | 每账号 token 备份 vault.json(0600明文) 或 AGY_SWAP_VAULT=keychain; 切换时重写 keyring+文件; 支持隔离 HOME 并行 (AGY_SWAP_SKIP_SYNC=1), --sync-session 防后台刷新写回 | 较活跃 | MIT | README 自称"不能保证零账号风险"; 运行中进程刷新可能写回旧凭据 |
| fikrilal/agy-auth | AES-256-GCM 加密快照, 还原为 live 凭据; list/usage 显示每账号 5h/周额度; rotate 自动换号 | 116 star, 56 commits, 近期更新 | MIT | 用 Antigravity 同一公开 OAuth client; 需重启 agy; 密钥丢失不可恢复; 无并发锁 |
| agyw (0xcreed/agy-switcher) | 每 profile 拷贝 ~/.gemini/antigravity-cli 文件, macOS 同时存取钥匙串项; agy 运行中拒绝切换 | 小 | [未核实] | 同上 |
| KaylaONeal/agy-cli-manager | 保存时抓 keyring, 切换时写回; AGY_CREDENTIAL_BACKEND=auto/keychain/secret-service/none; 额度感知 failover | 小 fork | [未核实] | 同上 |
| shyim/agm, ZhangNy301/agy-switch, fikrilal 等 | 自有存储+切换; agy-switch 另带代理管理 | 小 | [未核实] | 代理路由可能触 ToS |
| mblauberg/provenant #2510 | 每账号独立 HOME + 独立 login.keychain-db (空密码、不锁定), HOME=<dir> agy 登录/探测 | 内部设计, 已落地 PR #2525 | - | 未验证项: 重启/锁屏后无头运行(S2)、keychain ACL 弹窗卡死、refresh 原子替换破坏 symlink、同号并发刷新 |
| CodexBar (steipete) antigravity provider | 读额度: 优先 app/agy CLI 本地端点, 回落 Google OAuth 直调 cloudcode-pa.googleapis.com v1internal: loadCodeAssist -> onboardUser -> retrieveUserQuotaSummary (回落 fetchAvailableModels/retrieveUserQuota); fork 提到 `agy -p "/usage" --output-format json` | 成熟 | MIT [未核实] | 端点按 User-Agent/客户端版本门控 (#4102 #5147: 新额度组缺失); 文档中 host 已过时 (#4632); 非公开 API 随时变 |
| Gemini-Account-Switcher / gemini-accounts / gemini-cli-proxy | Gemini CLI: 复制 oauth_creds.json; proxy 在 429 时轮换并拷贝 | 小 | [未核实] | 只适用文件存储; keychain 单条目则无效 |
| Orca issue #9122 (stablyai/orca) | "Antigravity usage 是 Gemini 额度的副本, pool 错误" | issue | - | 说明第三方读用量易错组 |

## 4. Gemini CLI 对照
- 旧: ~/.gemini/oauth_creds.json (明文) + google_accounts.json; 新版(0.57+)走 HybridTokenStorage: keychain 优先, 失败回落加密文件 (keychain 条目 gemini-cli-oauth)。
- 环境变量: GEMINI_FORCE_FILE_STORAGE=true, GEMINI_FORCE_ENCRYPTED_FILE_STORAGE, GEMINI_CLI_HOME (每账号独立 home; shuriken.sh 建议)。
- agy 共享 "gemini" 命名空间 (keychain service=gemini, GEMINI_FORCE_FILE_STORAGE 在 Linux 报告有效, GEMINI_HOME 被 t3code 使用), 但 1.5.16 另有自己的 AGY_CLI_FORCE_FILE_TOKEN_STORAGE; 两者关系 [未验证]。

## 5. 给 loom 的建议 (选项, 非实现)
存储统一:
- A. 每账号独立 GEMINI_HOME(或 HOME) + AGY_CLI_FORCE_FILE_TOKEN_STORAGE=1: 凭据在文件, 不依赖钥匙串/GUI 会话, 终端与后台行为一致, 多账号天然并行、无串号。代价: 每账号一次浏览器登录(之后文件刷新); 需验证 GEMINI_HOME 对 1.5.18 确实生效 [未验证]。最推荐。
- B. 每账号独立 HOME + 独立 keychain (provenant 做法): 复杂, 有 ACL/锁/rename 风险。
- C. 单全局凭据 + 切换器拷贝 (agy-swap/agy-auth): 并发会话共享一个账号, 运行中刷新会写回, 不适合多 worker。
- 无论哪种: 禁止同一环境同时存在 keychain 与文件两份来源; loom 启动 agy 时显式设置变量并记录所用 profile。
用量读取:
- 以 `agy -p "/usage"`(指定账号环境后) 为准, 因为它读的就是该进程实际凭据; 辅以 statusline 做会话内即时值 [statusline 是否含额度未验证]。务必同时输出 identity(邮箱)以便发现串号。
- 自己直调 cloudcode-pa 端点不推荐: 非公开、UA/版本门控、易错组 (CodexBar、Orca 都踩过)。
切换可行性: 技术上可行(换 profile 目录即可, 方案 A 无需登出登入, 也无需拷贝 token); 拷贝/替换 token 的方案有刷新写回与 refresh-token 复用风险。ToS: 无官方多账号支持, 各工具均声明风险自担; 个人多账号轮换规避额度可能违反 Google 条款 [需用户自行判断]。

## Sources
- https://github.com/pingdotgg/t3code/issues/41973
- https://github.com/mblauberg/provenant/issues/2510
- https://github.com/aklkbqx/agy-swap ; https://github.com/pr656d/agy-swap ; https://github.com/gaoxiang89/agy-swap
- https://github.com/fikrilal/agy-auth ; https://github.com/0xcreed/agy-switcher ; https://github.com/KaylaONeal/agy-cli-manager ; https://github.com/shyim/agm ; https://github.com/ZhangNy301/agy-switch ; https://github.com/tekotechkotech/agy-multiaccount-encrypted
- https://github.com/steipete/CodexBar/blob/main/docs/antigravity.md (抓取 503, 内容来自搜索摘要) ; CodexBar PR #4102, #4632, issue #5147
- https://github.com/stablyai/orca/issues/9122
- https://github.com/google-gemini/gemini-cli/issues/20412 ; PR #29448 ; https://shuriken.sh/guides/gemini-cli-change-google-account ; https://github.com/kranthik123/Gemini-Account-Switcher ; https://github.com/freelanceagent1/gemini-cli-proxy
- https://realpython.com/antigravity-cli/ ; https://www.gradually.ai/en/antigravity-cli-commands/
