# loom_new

loom 使用驻留的 loomd 组织本地 agent 会话。无头会话通过 OAR 启动，交互会话由 hc 持有。每个项目目录独占一个 loomd，由它登记索引、持久化收件箱、合并波次和记录阻塞边沿。

- [协议 v2](docs/PROTOCOL-v2.md)
- [归档的协议 v1](docs/archive/PROTOCOL-v1.md)
- [LOOM-CLI-0 验收记录](tasks/LOOM-CLI-0/RESULT.md)
- [loom skill](skills/loom/SKILL.md)

## 安装与入口

需要 Node.js 24.2+、Git，以及所选后端的原生 CLI。TUI 还需要本地 hc。根依赖固定为 `@botiverse/oar@0.130.1`。

```sh
npm ci --ignore-scripts --omit=optional
npm test
```

OAR 由根目录统一安装。在根目录运行 `node --test runtimes/oar/events.test.mjs` 可单独验证 OAR 事件兼容层。

每个命令的 `--project DIR` 都接收项目根目录绝对路径。省略时优先读托管环境的 `LOOM_PROJECT`，再从当前目录向上查找 Loom 项目元数据或 Git 根。回执的 `project` 为规范化路径，`projectId` 由该路径派生。

```sh
loom=/path/to/loom_new/bin/loom
"$loom" daemon start --project "$PWD"
"$loom" spawn leader --cwd "$PWD" --project "$PWD" "开始本项目"
"$loom" ls --project "$PWD"
"$loom" state leader --project "$PWD"
"$loom" send leader --wait --project "$PWD" "目前进度如何？"
"$loom" hist leader --project "$PWD" --turn 1 --level L2 --diff --evidence
"$loom" notifications --project "$PWD"
"$loom" handover leader --project "$PWD"
"$loom" stop leader --project "$PWD"
"$loom" daemon stop --project "$PWD"
"$loom" doctor --project "$PWD"
```

`loom daemon start --foreground` 和 `loomd --project DIR` 可前台运行。`daemon status` 返回运行状态和 PID。项目元数据、原生记录路径、投递账本、证据卡和巡检事件由项目目录管理。`stop` 确认会话退出后保留历史供查询。

## 启动策略

在项目根的 `.project/policy.json` 中写入这个结构。把示例模型换成项目已验证的值。

```json
{
  "preferred": [
    { "cli": "codex", "model": "gpt-5.4", "effort": "high", "mode": "headless" }
  ],
  "deny": [
    { "cli": "codex", "model": "disallowed-model" },
    { "effort": "low" }
  ]
}
```

按文件顺序取第一项与显式 `--cli`、`--model`、`--effort` 相容的 profile，补齐省略项。显式给全时可以使用策略外的组合，任何匹配 `deny` 条目的组合都会拒绝。每条 deny 可给 `cli`、`model`、`effort` 的任意非空子集，条目内各字段同时匹配。启动拒绝后不会换另一项。模式依次取显式值、profile 值和 CLI 默认值，Claude 默认 TUI，其余默认 headless。只有 Worker 必须提供 `--task` 和 `--wave`。

启动回执的 `requested` 保留显式值，`selected` 为补齐后的启动参数，`effective` 记录运行时确认值。`differences` 列出已确认的差异，`unverified` 列出运行时尚无确认值的字段。没配置策略时可以传完整的 CLI、model 和 effort。Leader 先创建工作树，再把路径传给 Worker 的 `--cwd`。

Worker 用 `"$LOOM_BIN"` 的绝对路径调用 Loom。启动时分配私有可写的主目录、XDG 配置、缓存、数据和状态目录，`TMPDIR` 同时用作 `XDG_RUNTIME_DIR`，zsh 的 `TMPPREFIX` 也指向该临时目录。私有 Git 全局配置从启动环境继承 `user.name` 和 `user.email`，已有的仓库级身份优先。Worker 关闭 Git 自动维护，并保留提交 hooks。

无头 Codex Worker 用命名权限配置开放工作目录、私有 `HOME` 和 `TMPDIR`。工作目录下的 `.git`、`.agents`、`.codex` 和 `.aws` 保持只读。关联的 Git 工作树额外可写其专属的 `<common>/worktrees/<name>`、共享的 `<common>/objects` 与 `<common>/packed-refs.lock`。有分支时还可写当前分支的 `<common>/refs/heads/<branch>`、对应的 `.lock` 和 `<common>/logs/refs/heads/<branch>`。Git 提交清理会使用 `packed-refs.lock`，而共享的 `packed-refs` 数据文件仍只读。Unix socket 权限只授予该 Worker 的 `TMPDIR`，本地 TCP 监听关闭。

macOS 无头 agy 和 Claude Worker 的原生进程使用原来的 `HOME` 定位登录。Seatbelt 将普通文件写入限制在工作树、对应 Git 元数据、Worker 私有主目录和临时目录，以及已存在的原生会话数据子目录。agy 的原生例外是 `brain`、`conversations`、`log` 和命令工具生成的单个 `bin/agentapi` 文件。命令工具的 PTY 只额外获得设备数据写入权限。Claude 的原生例外是 `projects`、`sessions`，其内部临时文件通过 `CLAUDE_CODE_TMPDIR` 写入 Worker 私有目录。登录目录根和凭据仍为只读，XDG 目录继续指向 Worker 私有位置。

托管会话的 `LOOM_ADDR` 默认提供 `send --from`，也用于启动子会话时的父会话寻址。`send --wait` 只供非托管调用方同步取一次回复。项目通知用 `loom notifications` 一次领取，`--peek` 只查看。

- `drift.deferAuditorNotices` 默认为 `true`。事实检查和走偏通知随 Auditor 的下一条实际投递附送；完整通知仍可用 `loom status --json` 查看。
- `delivery.replyBytes` 默认 600，最小 160，按 UTF-8 正文计量。超限的自动回传通过 `.project/replies/<sha256>.txt` 交付，文件名是保存内容的 SHA-256。
- 设置 `rotation.mode: "v2"` 可启用 [高级角色换班政策](docs/ORG.md#高级角色换班-v2)。默认由角色或 Super 主动换班。项目也可在显式规则模式配置 `rotateAt: "gate"` 或上下文窗口阈值。
- `loom status --json` 提供 Leader 和 Auditor 的轮次、会话时长、转录字节数、上下文窗口及来源、压缩后首个可用读数和换班原因。`loom cost` 单列已匹配到原生用量的接任简报 token。

## 历史与巡检

- `hist ADDR --turn N` 取该会话的一轮。用 `--outcome failed|aborted|quota|blocked|unverified` 查异常，用 `--grep KW --project DIR` 在项目内查命令、错误和路径。
- `hist ADDR --level L2 --tool shell|edit --cmd REGEX --tail N` 筛选工具，保留每项最后 N 行。L1 默认最近五轮，L2 默认一轮。历史同时给出原件路径和能确认的行偏移。
- `hist ADDR --diff --evidence` 给出轮次和任务基线相对候选提交的分类 numstat、被删改的测试断言及证据卡。提交 diff 取记录中的 HEAD 快照，未提交改动查证据卡。历史缺少边界时标为 `missing-boundary`。
- `hist --wave W --project DIR` 显示成员、结果、耗时、净行数、改动文件、测试退出码及合并、阻塞、超时或补投的去向。
- `state` 的 `signals` 显示上下文占用、压缩次数、轮数和用量。原生记录缺值时显示 `null`。
- `doctor` 默认报告本项目的运行残留、未封存波次和不明投递。`--fix` 在项目写入者退出后清理可核实归属的残留。已结束的 hc 窗格和已记录的孤儿进程按原生身份或进程身份复核。工作树清理使用 Git 的常规移除，脏文件、忽略文件、锁和未合入的 detached 提交会保留。投递与波次状态留给 loomd 继续对账。
