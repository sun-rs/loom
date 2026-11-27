# CCP-ROUTE-1：所有 Claude Code 调用必须经 CCP 保护

用户裁决 2026-11-27："不允许脱离 ccp 保护的 claudecode 调用，而且直接调用 claude 本来就是可以的"。
此前 loom 的规定方向错了：C4、WORKER-TIER-1、MERGE-ACCT-1、AGY-HOST-1 等处"拒绝 CCP 路径、优先原生 Claude 二进制"，导致两个 pilot 的 Claude Auditor 被 loom 直接以 `~/.local/share/claude/versions/2.1.331` 启动（绕开 CCP），评测脚本与额度探测也直接调原生二进制。

## 事实（Super 观察）
- `/Users/sun/.local/bin/claude` 是指向 `/Users/sun/Code/ccp/bin/claude-protected` 的符号链接，这是正确入口。
- 经 CCP 启动的 Claude 进程，前台 argv 形如：原生二进制 + `--settings /Users/sun/Code/ccp/protected-claude.json`。
- loom 启动 Claude 时自己会传 `--settings '<hooks JSON>'`、`--setting-sources ''`、`--strict-mcp-config` 等参数。

## 红线
- **不得读取、修改或绕开 `/Users/sun/Code/ccp` 下的任何文件，也不碰 CCP 的进程与网络配置。** 把 `/Users/sun/.local/bin/claude` 当黑盒入口。
- 不读凭据。

## 要做
1. 全仓搜出所有启动 Claude 的路径（TUI 角色、headless/OAR、账号探测、评测脚本、test fixtures、skill/docs 里的指引），一律改为调用 `/Users/sun/.local/bin/claude`（可配置，但默认必须是 CCP 入口；**禁止** realpath 解析后执行目标、禁止直接执行 `~/.local/share/claude/versions/*`）。解析器里"拒绝 CCP 路径"的逻辑对 Claude 反转为"必须是 CCP 入口"；对其他 CLI 不相关。
2. **参数冲突核查（关键）**：loom 追加的 `--settings`、`--setting-sources`、`--strict-mcp-config` 等，会不会覆盖或削弱 CCP 自己加的 `--settings`？只允许用黑盒方式验证：用 CCP 入口启动一个由你自己创建的 Claude 进程（不发模型请求的方式优先，例如 `--version` 或立即退出的交互），用 `ps -o args=` 观察**你自己启动的那个子进程**的实际 argv，判断两份 `--settings` 是否同时存在、哪个生效（可查 Claude Code 官方文档对多个 `--settings` 与 `--setting-sources` 的说明）。若 loom 的参数会让 CCP 的设置失效，就改 loom：不传会冲突的参数，hooks 改用不冲突的方式注入；做不到就停下，写清事实与选项报 Super，不要自行取舍。
3. RED→GREEN 测试：Claude 启动 argv 的第一个可执行文件必须是 CCP 入口；直接用原生二进制被拒；其他 CLI 行为不变。
4. 文档与 skill：把"拒绝 CCP"改为"Claude 必须经 CCP"，写明原因来自用户裁决。
5. 全量 `npm test`、`npm run lint` 通过。分支 infra/ccp-route，工作树 /Users/sun/Code/repos/loom-ccp-route，显式路径提交，不 commit -a，不 push。RESULT.md 列出：改了哪些启动点、参数冲突核查结论（附你观察到的 argv）、剩余风险；以 STATUS 行收尾。
