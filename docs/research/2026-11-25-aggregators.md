# 多 CLI 编排应用的故障处理调研（2026-11-25）

> 调研日期 2026-11-25，只读源码。loom 对照基线 55fd7e1a/92fa7690。各项目版本见下表，之后可能变化。

## 调研对象
| 项目 | 提交 | 驱动方式 | 状态 |
|---|---|---|---|
| claude-squad（smtg-ai） | 070eb93 | tmux 读屏，直接写入原始字节，等 100ms 再发 `\r`，用 capture-pane 哈希判断空闲 | 活跃 |
| vibe-kanban（BloopAI） | 3f095f0 | 每次执行起一个进程：Codex 走 app-server，Claude 走 stream-json 控制协议，其余走 ACP | 活跃 |
| t3code（pingdotgg） | f1efcfb4 | Codex app-server、Claude Agent SDK、ACP | 活跃 |
| superset（superset-sh） | 64fa0243 | 自研 PTY 守护进程加 hooks | 活跃 |
| happy（slopus） | 164c325 | 本地 TUI 加远程 SDK；向 Claude 进程注入 fetch 拦截 | 活跃 |
| sculptor（imbue-ai） | cdd6dc6 | Claude stream-json | 活跃 |
| opcode（getAsterisk） | c24004d | 每条提示单独跑一次 `claude -p` | 活跃 |
| Crystal、Terragon、Omnara | — | — | 已废弃、停服或转型 |
| Conductor | — | 闭源 | 未核实 |

## 结论
- **TUI 投递方面，loom 已经领先所有调研对象。** loom 有草稿回读核验、按 UTF-8 边界分块、人类输入序号保护、`[loom:id]` 标记、正文摘要回执；各家最多做到 bracketed paste 加延迟 Enter。superset 发现 TUI 会把同一次读到的 Enter 当作粘贴内容吞掉，所以把 Enter 延迟 500ms 单独写，我们已有对应处理。
- **真正的缺口在新写的 Codex app-server 管道（daemon/codex-pipe-session.mjs）**：
  - G1：请求没有截止时间，卡死的 app-server 不会被淘汰；
  - G2：失败分类只靠正则匹配 rate/auth；
  - G3：关闭进程时只发 SIGTERM，不升级到 SIGKILL；
  - G4：没有检查孤立的 UTF-16 代理字符。t3code 注释说，这种字符会让 Codex 不报错也不应答；
  - G5：重发和续跑没有上限（未核实）。

## 值得借鉴的具体做法
- **t3code**：
  - initialize 超时 30s，"Already initialized" 视为可接受；
  - 每个请求 2 分钟截止，超时就淘汰会话、下次重新 spawn；结果未知的请求只判失败，不重试；
  - SIGTERM 后 2s 强杀；
  - serverOverloaded 最多重试 5 次；
  - 遇到 `invalid_encrypted_content` 时新开一个会话，带上可见历史继续；
  - 重启续跑和重发都设循环上限；
  - 有 app-server 录制回放测试。
- **sculptor**：中断分四级升级：stdin 中断等 5s，SIGTERM 等 2s，SIGKILL 等 2s，最后合成一个终态，避免永远停在"思考中"。
- **vibe-kanban**：未知的服务端请求回 Null，防止流卡住；运行中收到的反馈先排队，在 interrupted 时作为新一轮发出；执行结束后对整个进程组发 SIGKILL。
- **superset**：发送前清洗控制字符；同一会话的发送串行化；agy 不能挂 PreToolUse hook，否则会拒绝工具调用；PTY 被 SIGKILL 后，回收遗留的输入模式（kitty 键盘、鼠标）。

## 不采纳
- happy 向 Claude 进程注入 fetch 拦截：违背 loom 的进程边界。
- 每条提示单独起一个进程（opcode）：与 loom 的常驻会话模型不同。
- "不保活、重启即判失败"（vibe-kanban）：loom 有 holder，可以保活。

## Super 标记采纳（交 ADOPT-1 第 6 项）
1. G1 请求截止与会话淘汰：2 分钟；结果未知只判失败，不重试。
2. G2 失败分类：复用 OAR 的 `failure`/`rpc-control` 分类；serverOverloaded 有界重试（5 次）；active-writer 映射为 in_use。
3. G3 SIGTERM → SIGKILL 升级：通过 holder 对进程组发信号。
4. G4 孤立代理字符：投递前用 `toWellFormed()` 处理；无法处理就拒收并说明原因。
5. G5 重发和续跑上限：设次数和时间窗，防止"一发就崩"的提示被无限重放。
6. app-server 录制回放测试，覆盖超时、提前退出、重复 initialize。

## 补充：Orca 的 TUI 投递（2026-11-25，读本机 Orca.app 打包代码 app.asar，未运行）
- **不往 TUI 里贴正文。** 只写一段短"指针"，内容是条数、邮箱名和读取命令，然后等约 500ms（`cmi=500`，可配）单独写一次 `\r`。正文由 agent 自己运行 CLI 去邮箱读。
- **送达以"agent 读过"为准**（unread→read），不以屏幕为准。按 Enter 之前先查一次：消息已读就不按（`areUnreadMessages`）。每个指针只按一次 Enter（`markMailboxPointerEnterAttempted`）。
- **仍未读就 `redrive`**，重新写一个指针。PTY 处于"等待用户输入"（审批、选择题）时不按 Enter，推迟到空闲（`isPtyAwaitingUserInput` → `deferFlightUntilIdle`）。另外核对进程化身（processIncarnation），防止投错到重启后的进程。
- **对 loom 的取舍**：
  - 借鉴三点：不盲按第二次 Enter、弹窗时推迟按键、核对进程化身。
  - **不采用指针模式**（用户裁决 2026-11-25）：每条消息都会让 agent 多一次带全量上下文的请求，丢掉 loom 少请求的优势。正文照旧内联，以原生记录回执为准。

## 补充：T3 Code 编排层（2026-11-26，读 /Users/sun/Code/research/t3code @ 6b02cbff，2026-11-09，server v0.1.7，未运行）
起因：用户转来一张"T3 Code vs Orca"对比图，逐条核对。
- **属实**：Orchestrator MCP Server（`127.0.0.1:<port>/mcp`，docs/orchestration-v2/orchestrator-mcp-server.md）、`delegate_task`（apps/server/src/mcp/toolkits/orchestrator/tools.ts:86，另有 task_status/task_cancel/t3_thread_send/wait/read）、AppThread / ExecutionNode / ProviderThread（packages/contracts/src/orchestrationV2.ts）、父子线程、事件回放。已上线，非设计稿。
- **部分不实**：MCP 不直连 Provider Adapter，经 V2 命令 `delegated_task.request` 走常规 provider 效果；"增量上下文交接"不属于委派——子线程只拿任务提示、不带父历史。交接用于切换 provider：回到某 provider 时续用旧线程，只补它错过的轮次摘要；摘要是确定性文本拼接（用户/助手文本、命令、改动文件、检查点），不调模型（ContextHandoffService.ts）。
- **委派成本**：父模型一次 MCP 调用；async 模式结果以 wake 推回（≤16KB 内联，超出让父调 task_status），约 2 次父请求，与 loom（spawn 一次 + 结果推送一轮）同级。wake 至少一次投递、按消息 ID 去重。子线程权限只能收窄。
- **没有的**：监督角色（只有 role 提示枚举）、门禁、按角色计费、原生 TUI（全走 SDK/app-server，node-pty 只给用户终端）、存活进程跨重启/热升级（重启后按原生引用重建会话）。
- **对 loom 可借**：①换班/记忆的"只补错过部分"的确定性摘要（不花模型 token），可用于 `--handover-from` 交接文件与 I/L 层记忆注入；②子会话权限只能收窄的规则，用于 Auditor 临时派的检查 worker；③超长结果内联上限 + 原文路径（GATE-NOTIFY-1 已同理）。不借：MCP 委派入口（loom 用 CLI + skill，避免给每个 CLI 挂 MCP）。
- **Orca 部分**：本地 skill 只是桩，Task/Dispatch、DAG 有据；`worker-start`、mailbox 字样需运行 Orca 才能核对，mailbox 指针投递见上节（已于 2026-11-25 拆包确认）。
