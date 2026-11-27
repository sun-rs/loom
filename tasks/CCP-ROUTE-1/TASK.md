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

## 追加（Super，用户再次强调）
用户原话："存在 ip 暴露的 claude session 必须结束掉……为什么要绕开 ccp 的环境保护，这是当前情况下，没有搞定 cell 前，绝对禁止行为"。
- loomd 里做成硬性拒绝：任何 Claude 启动请求，可执行入口不是 `/Users/sun/.local/bin/claude`（或配置指定的 CCP 入口）就直接报错 `ccp-required`，不降级、不回退原生二进制，不允许任何开关绕过（包括测试以外的环境变量覆盖）。
- loom 启动 Claude 时不得清空或改写会影响网络出口的环境变量（HTTP(S)_PROXY、ALL_PROXY、NO_PROXY 及其小写形式、ANTHROPIC_BASE_URL）；CCP 自己设置什么就是什么。
- 在 RESULT.md 附：修复后经 loom 启动一个测试 Claude 会话（可用一次性项目，不发模型请求或至多 1 次最小请求），用 `ps eww` 只看代理相关变量名与值、用 `lsof -nP -a -p <pid> -i` 看连接目标，证明其出网只连 127.0.0.1 上的 CCP 代理端口。

## 追加 2（Super，用户要求用 resume 恢复 Auditor）
- 已确认：代理变量由 CCP 入口自身设置（shell 配置里没有；由 Herdr 直接拉起的 CCP Claude 也带 HTTPS_PROXY=http://127.0.0.1:17891），所以只要以 `/Users/sun/.local/bin/claude` 启动，任何环境下都走 CCP 代理。
- 需要支持：对已结束（loom stop）的 Claude 高级角色会话，经 CCP 入口以 `--resume <原 sessionId>` 重新拉起并由 loomd 重新接管（同一角色、同一项目、原会话上下文），例如 `loom spawn auditor --resume-session <sessionId>` 或等价命令。用于恢复：
  - pilot-cell Auditor：sessionId dd8f3c43-2781-4f75-8c80-7a259c3d3137，cwd /Users/sun/Code/loom-pilot-cell
  - pilot-2 Auditor：sessionId 296091e4-ad89-4b92-80d9-d7968f4e4a31，cwd /Users/sun/Code/loom-pilot2
- 拉起前若可执行入口不是 CCP 入口，直接拒绝（ccp-required），绝不回退原生二进制。
- 有测试覆盖；RESULT.md 写明恢复命令的用法。不要自己去恢复这两个会话，交付后由 Super 执行并实测。

## 追加 3（Super，用户裁决："暂时别碰他保护的那个 settings"）
你实测到 CCP 入口只允许 `--settings` 内联 JSON 且仅含 Orca 用到的 `disableAllHooks`、`fastMode`。这是 CCP 的保护，**不得绕开、不得改 CCP、不得改用别的方式塞 hooks**（包括写项目 .claude/settings.json 注入 hooks、改 `--setting-sources` 去引入其他来源）。
因此经 CCP 启动的 Claude 一律**不注入 loom hooks**，loom 改用"读 Claude 自己的会话记录"接管（和 Orca 一样）：
- 用会话 id 定位 `~/.claude/projects/<编码后的 cwd>/<sessionId>.jsonl`，只读元数据与必要的结构（type、timestamp、message 角色、是否 end_turn、usage），用于：回合开始/结束、最终回复提取、投递确认（用户消息出现在记录里即视为送达）、上下文用量。
- 投递仍走 holder/PTY 粘贴；确认改为"记录里出现对应用户消息 + 随后 assistant 回合结束"。
- 原先依赖 hook 的功能（PreToolUse 守卫、权限请求通知等）逐项列出：能改为读记录的就改；做不到的写明降级与风险，报 Super，不要自行恢复 hooks。
- 不要传 `--setting-sources ''`、`--strict-mcp-config` 等可能改变 CCP 行为的参数，除非你实测证明 CCP 接受且不影响其代理与保护；拿不准就不传。
- `--dangerously-skip-permissions` 与 `--resume <id>`、`--session-id`、`--model`、`--effort` 这类不涉及 settings 的参数，若 CCP 接受可以保留；实测并记录。
如果 Codex 持续报 "model at capacity" 超过 15 分钟，把当前进展与发现写进 RESULT.md 草稿并提交 WIP，Super 会改派 agy 接手。
