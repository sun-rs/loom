# CCP-ROUTE-1 RESULT

## 1. 结论摘要

已完成全仓 Claude Code 调用切换至 CCP 入口（默认 `/Users/sun/.local/bin/claude`，可由 `LOOM_CLAUDE_CCP_BIN` 配置），并落实用户全部裁决与追加要求：

1. **强制 CCP 入口与硬拒绝（`ccp-required`）**：所有 Claude 启动/探测/恢复路径一律使用 CCP 入口，禁止 `realpath` 解析目标后再执行，禁止直接调用或回退 `~/.local/share/claude/versions/*`。非测试环境下任何非 CCP 入口（含 `LOOM_CLAUDE_BIN` / `OAR_CLAUDE_BIN` / 指向原生版本的符号链接 / 非 CCP 的 `LOOM_CLAUDE_CCP_BIN`）均在执行前直接抛出 `code: 'ccp-required'`。其他 CLI（`codex`、`agy`、`opencode`）保持原样，继续以 `protected-executable` 拒绝 CCP 路径。
2. **代理环境变量零干扰**：Loom 启动 Claude（TUI、OAR/headless、账号刷新）时绝不清空或覆写 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY`（及其小写形式）与 `ANTHROPIC_BASE_URL`，完全交由 CCP 入口设定。
3. **零 hooks / 不碰 CCP 受保护 `--settings`**：遵守用户裁决，经 CCP 启动的 Claude 一律不注入 hooks、不写 `.claude/settings.json`、不传 `--setting-sources ''` / `--strict-mcp-config` 或被 CCP 拒绝的 `--settings` 键；Claude TUI 会话改由直接读取 `~/.claude/projects/<编码后的 cwd>/<sessionId>.jsonl` 实现回合跟踪、投递确认、回复提取、上下文用量与压缩感知。
4. **支持经 CCP `--resume` 恢复已停止的 Claude 常驻角色**：新增 `loom spawn <super|leader|auditor> --resume-session <UUID>`（`<prompt>` 可选），经 CCP 以 `--resume <UUID>` 重新拉起并由 `loomd` 接管，拉起前强制校验 CCP 入口。未执行两个 pilot Auditor 的恢复，命令附于第 5 节供 Super 实测。
5. **对齐 RESUME-1 契约**：新增 `daemon/claude-ccp.mjs`，完整对齐 `infra/resume` 分支上的接口桩（`defaultCcpClaudeEntry`、`isCcpClaudeEntry`、`validateCcpClaudeEntry`、`claudeCcpNotReady`、`createClaudeCcpBridge`、`nativeClaudeVersionsPattern`、`LOOM_CLAUDE_CCP_BIN`）。

---

## 2. 修改的启动点与文件清单

### CCP 入口契约与可执行文件解析
- `daemon/claude-ccp.mjs`（新增）：对齐 `infra/resume` 桩，提供 CCP 默认入口解析、合法性校验（拒绝原生 `~/.local/share/claude/versions/*` 与非 CCP 路径，抛 `ccp-required`）及 `createClaudeCcpBridge`。
- `daemon/executables.mjs`：`nativeClaude()` / `resolveClaudeExecutable()` 改为强制校验并返回 CCP 入口符号链接路径（绝不 `realpath` 返回 `claude-protected` 真实目标）；拒绝直接指向 `versions/*` 的符号链接与所有非 CCP 覆盖；非 Claude CLI 保持 `resolveNativeExecutable()` 原逻辑。
- `lib/host-tool-guard.mjs`：Bash 命令中 `claude` 校验切换为 `resolveClaudeExecutable()`，并新增 `nativeClaudeVersionsPattern` 拦截，阻止直接执行 `~/.local/share/claude/versions/*`。

### Claude TUI 启动、传输与环境卫生
- `adapters/claude/launch.mjs`：移除全部 hooks、`statusLine`、`idleCompaction`、`skipDangerousModePermissionPrompt`、`--setting-sources ''`、`--strict-mcp-config`；仅在显式设置布尔 `fast` 时传递 `--settings '{"fastMode":<bool>}'`；保留 CCP 接受且不冲突的 `--session-id` / `--resume`、`--dangerously-skip-permissions`、`--disallowedTools AskUserQuestion`、`--model`、`--effort`、`--prompt-suggestions off`、`--system-prompt-snapshot off`、`--append-system-prompt`。
- `runtimes/tui/transport.mjs`、`runtimes/tui/hc.mjs`：TUI 启动 Claude 时经 `nativeClaude()` / `resolveClaudeExecutable()` 解析 CCP 入口；从 `unset` 与覆盖 `env` 中剔除全部代理/网络变量（`claudeNetworkEnvKeys`），确保不干扰 CCP 环境；透传 `CLAUDE_CONFIG_DIR` 证据用于定位 transcript。
- `daemon/tui.mjs`：Claude 不再注册 `hookRunner` 与 `contextStatusPath`；支持传递 `resume: job.resumeNativeId`。
- `memory/launch-config.mjs`：移除 Claude 经 hooks 注入记忆索引的旧路径（改由 `--append-system-prompt` + 压缩后 transcript 事件重注）。

### Claude Headless / OAR 与账号探测
- `daemon/oar.mjs`：Claude 一律通过 `nativeClaude()` + `resolveClaudeExecutable(installation.command)` 校验 CCP 入口；构建子进程环境时不清空/覆写 `claudeNetworkEnvKeys`；不向 OAR 传递会触发冲突 `--settings` 的选项。
- `daemon/account-refresh.mjs`：经 `resolveClaudeExecutable(..., { env })` 执行 `auth status --json` 与 `-p /usage`，并将 `claudeNetworkEnvKeys` 加入 `baseEnvKeys` 透传。
- `daemon/account-collection.mjs`：`accountStatusline` 仅保留给 `agy`；Claude 改用 transcript `rate_limit_info`、headless `rate_limit_event` 与主动刷新。

### 去 Hook 化：基于 Claude 会话记录（JSONL）的 TUI 接管
- `adapters/claude/locate.mjs`：导出 `CLAUDE_BUCKET_NAME_MAX_LENGTH`、`encodeClaudeProjectPaths`、`encodeClaudeProjectPath`、`isClaudeProjectOwnBucketName`、`isSafeClaudeSessionId`。
- `tui/providers.mjs`：为 `providers.claude` 启用 `screenStartup: true`（允许首轮无 hook 场景采用草稿与启动探测）；扩展 `transcriptRow` 识别普通用户提示与 `queued_command` 附件进入 `busy` 态；移除 `start()` 中的 hook/statusLine 注入。
- `tui/native.mjs`：支持 `configDir`；无 hook 时当 `boundTranscript && !transcript` 自动通过 `provider.transcript.locate({ sessionId, cwd, configDir })` 定位 `<sessionId>.jsonl`，校验常规文件与规范路径（兼容 macOS `/var` -> `/private/var`）。
- `tui/index.mjs`：`idleBefore` 判断改为基于 `provider.screenStartup && !native.phase && !native.turnSequence`，兼容无 hook 的 Claude 首轮投递。
- `relay/sources.mjs`：`transcriptPath` 同时识别 `--session-id` 与 `--resume` 并复用编码定位逻辑；`withClaudeTranscriptStops` 在 `events` 为空（0 hooks）时也能直接定位并解析 `<sessionId>.jsonl`，合成 `UserPromptSubmit`（含 `prompt` / `deliveryId` 供投递确认与 SHA-256 完整性校验）、`Stop`（含 `last_assistant_message`）、`Interrupt`、`StopFailure` 及 `PostCompact`（来自 `compact_boundary`）。
- `daemon/sessions.mjs`、`daemon/memory-injection.mjs`、`daemon/supervisor.mjs`：`refreshTui` 直接为 Claude 定位绑定 `row.transcriptPath`；`retainCompaction` 与压缩后记忆索引重注改读 `withClaudeTranscriptStops` 合成的 `PostCompact` 事件；移除对 Claude 旧 hook 文件缺失的告警。

### 支持 `--resume-session`
- `cli/control.mjs`：`loom spawn` 新增 `--resume-session <UUID>`（仅限 `super` / `leader` / `auditor`，禁止用于 `worker` 或与 `--handover-from` 混用，`<prompt>` 可选）。
- `daemon/socket-auth.mjs`：限制 `--resume-session` 仅允许 Super 调用。
- `daemon/sessions.mjs`、`daemon/supervisor.mjs`：校验 `--resume-session` UUID、拉起前强制 `validateCcpClaudeEntry` + `nativeClaude()`、预绑定 `row.sessionId` 与既有 `transcriptPath`、写入 `job.resumeNativeId`、跳过新会话角色引导模板、支持无首条 prompt 启动，并在返回中附 `resumedSessionId`。

### 评测/探测脚本、文档、Skill 与测试
- 脚本：`tasks/CODEMODE-AB-1/launch.mjs`、`tasks/PTY-INTEG-0/probe-recovery.mjs`、`tasks/TUI-HOST-0/probe.mjs`、`tasks/TUI-ORCA-1/isolated.mjs`、`tasks/TUI-ORCA-1/soak.mjs`。
- 文档与 Skill：`adapters/claude/README.md`、`runtimes/tui/README.md`、`docs/ACCOUNTS.md`、`skills/loom/SKILL.md`。
- 测试：新增 `daemon/claude-ccp.test.mjs`；更新 `adapters/claude/test.mjs`、`adapters/accounts/statusline.test.mjs`、`cli/accounts.test.mjs`、`daemon/account-refresh.test.mjs`、`daemon/account-wiring.test.mjs`、`daemon/adopt-launch.test.mjs`、`daemon/memory-injection.test.mjs`、`lib/session-context.test.mjs`、`runtimes/tui/hook-cwd.test.mjs`、`runtimes/tui/runtime.test.mjs`。

---

## 3. 黑盒参数冲突核查结论与实测 argv

严格按黑盒方式仅调用 `/Users/sun/.local/bin/claude`（未读取 `/Users/sun/Code/ccp` 下任何文件），实测结果如下：

### 参数探测矩阵（`/Users/sun/.local/bin/claude` -> `2.1.331 (Claude Code)`）

| 参数组合 | CCP 行为 | 说明与处理 |
| :--- | :--- | :--- |
| `--settings '{"hooks":{}}'` | **拒绝**（rc=1） | stderr: `CCP: --settings 仅允许 Orca 的 disableAllHooks 和 fastMode`；已移除 |
| `--settings '{"statusLine":{...}}'` | **拒绝**（rc=1） | 同上；已移除 |
| `--settings '{"idleCompaction":false}'` | **拒绝**（rc=1） | 同上；已移除（保留 policy 字段解析兼容性） |
| `--settings '{"skipDangerousModePermissionPrompt":true}'` | **拒绝**（rc=1） | 同上；已移除 |
| `--settings '{"fastMode":true/false}'` | **接受**（rc=0） | CCP 将其与自身受保护 env 合并为单一 `--settings {...}` JSON；仅在显式配置 `fast` 时传递 |
| `--settings '{"disableAllHooks":true}'` | **接受**（rc=0） | 允许键；Loom 当前不依赖 |
| `--setting-sources ''`、`--strict-mcp-config` | 接受（rc=0） | 按追加 3 审慎原则，为避免影响 CCP 行为，Loom **不再传递** |
| `--dangerously-skip-permissions`、`--session-id`、`--resume`、`--model`、`--effort`、`--prompt-suggestions off`、`--disallowedTools AskUserQuestion`、`--system-prompt-snapshot off`、`--append-system-prompt` | **接受**（rc=0） | 不涉及 `--settings`，经实测不影响 CCP 代理与保护配置，保留 |

### 实测 `ps -o args=`（黑盒 `node-pty` 零请求启动 + 立即退出）

1. **带 `--settings '{"fastMode":false}'` 启动**：
```text
/Users/sun/.local/share/claude/versions/2.1.331 --settings {"env":{"HTTP_PROXY":"http://127.0.0.1:17891","HTTPS_PROXY":"http://127.0.0.1:17891","http_proxy":"http://127.0.0.1:17891","https_proxy":"http://127.0.0.1:17891","ALL_PROXY":"","all_proxy":"","NO_PROXY":"localhost,127.0.0.1,::1","no_proxy":"localhost,127.0.0.1,::1","TZ":"America/New_York","LANG":"en_US.UTF-8","LC_ALL":"en_US.UTF-8","BROWSER":"/Users/sun/Code/ccp/bin/claude-oauth-browser","ANTHROPIC_BASE_URL":"https://api.anthropic.com","ANTHROPIC_API_KEY":"","ANTHROPIC_AUTH_TOKEN":"","CLAUDE_CODE_OAUTH_TOKEN":"","CLAUDE_CODE_USE_BEDROCK":"","CLAUDE_CODE_USE_VERTEX":"","CLAUDE_CODE_USE_FOUNDRY":"","DISABLE_AUTOUPDATER":"1","DISABLE_TELEMETRY":"1","DISABLE_ERROR_REPORTING":"1"},"fastMode":false} --session-id e75d7008-0124-40cb-8226-b6cff8dfdc5b --prompt-suggestions off --dangerously-skip-permissions --disallowedTools AskUserQuestion --model claude-sonnet-5-5 --effort low --system-prompt-snapshot off
```

2. **不带 `--settings` + `--resume <uuid>` 启动**：
```text
/Users/sun/.local/share/claude/versions/2.1.331 --settings /Users/sun/Code/ccp/protected-claude.json --resume 6f939291-cef1-4b6a-a0e6-330e66757bbe --prompt-suggestions off --dangerously-skip-permissions --disallowedTools AskUserQuestion --model claude-sonnet-5-5 --effort low --system-prompt-snapshot off
```

3. **其他核查**：
   - Claude Code 重复传 `--settings` 会以后者覆盖前者（`@botiverse/oar/dist/runtimes/claude/launch-args.js:55` 亦证实此行为）；CCP 已通过拦截与合并机制处理允许键，且拒绝其他任何键。
   - `@botiverse/oar` 传入 `OAR_CLAUDE_BIN=/Users/sun/.local/bin/claude` 时返回 `command: '/Users/sun/.local/bin/claude'`（未 realpath），且 `environment.js` 不清空代理变量；Loom 不向 OAR 传 `serviceTier`/`userConfiguration`，不产生冲突 `--settings`。
   - Seatbelt 兼容性：`/usr/bin/sandbox-exec -p '(version 1)(allow default)(deny file-write*)(allow file-write* (literal "/dev/null"))' /Users/sun/.local/bin/claude --version` 正常退出 0（`2.1.331 (Claude Code)`）。

---

## 4. 经 `loomd` 实机端到端验证（1 次最小请求 + 0 请求 `--resume-session`）

在一次性项目 `/private/tmp/loom-ccp-live-1795788218921` 中启动 `loomd`（`LOOM_DESKTOP_NOTIFY=0 LOOM_HERDR_LAYOUT=0`），验证全链路：

### A. 新建 Claude TUI Auditor（1 次最小请求）
- 命令：`loom spawn auditor --project /private/tmp/loom-ccp-live-1795788218921 --cwd /private/tmp/loom-ccp-live-1795788218921 --cli claude --mode tui --trust-workspace "Reply with only CCP_OK. Use no tools."`
- 会话：`addr=loom-4ba9abe4-9a0b-4562-9b7e-c889bec7a23b`，`sessionId=5042f70d-e085-4c79-91b0-9827f1de0c8b`，`deliveryId=f4f37c78-fb6f-4f46-8f1e-ca2122610d12`。
- 进程链（`ps -ax -o pid=,ppid=,args=` 节选）：
  - `pid=77228`（`loom-holder-darwin-arm64`）以 `/Users/sun/.local/bin/claude --session-id 5042f70d-e085-4c79-91b0-9827f1de0c8b --prompt-suggestions off --dangerously-skip-permissions --disallowedTools AskUserQuestion --model claude-sonnet-5-5 --effort low --system-prompt-snapshot off --append-system-prompt ...` 启动（无 hooks、无 `--settings` / `--setting-sources` / `--strict-mcp-config`）。
  - `pid=77229`（经 CCP 入口拉起 `2.1.331`）。
- **`ps eww`（严格仅过滤代理相关变量名与值，零凭据）**：
```json
{
  "pid": 77229,
  "env": {
    "HTTP_PROXY": "http://127.0.0.1:17891",
    "HTTPS_PROXY": "http://127.0.0.1:17891",
    "http_proxy": "http://127.0.0.1:17891",
    "https_proxy": "http://127.0.0.1:17891",
    "ALL_PROXY": "",
    "all_proxy": "",
    "NO_PROXY": "localhost,127.0.0.1,::1",
    "no_proxy": "localhost,127.0.0.1,::1",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com"
  }
}
```
- **`lsof -nP -a -p 77229 -i` 采样结果（9 条连接全部指向 `127.0.0.1:17891`，0 条非回环出网连接）**：
```text
2.1.331 77229  sun    8u  IPv4 0xbb17d9150b535cfd      0t0  TCP 127.0.0.1:61241->127.0.0.1:17891 (ESTABLISHED)
2.1.331 77229  sun   11u  IPv4 0x2bc8fc400dbaf904      0t0  TCP 127.0.0.1:61244->127.0.0.1:17891 (ESTABLISHED)
2.1.331 77229  sun   12u  IPv4 0xe230206a8f546832      0t0  TCP 127.0.0.1:61242->127.0.0.1:17891 (ESTABLISHED)
2.1.331 77229  sun   13u  IPv4 0xad4e5fcadfa81963      0t0  TCP 127.0.0.1:61245->127.0.0.1:17891 (ESTABLISHED)
2.1.331 77229  sun   19u  IPv4 0x1eec4db0739428e3      0t0  TCP 127.0.0.1:61246->127.0.0.1:17891 (ESTABLISHED)
2.1.331 77229  sun   22u  IPv4 0x9e18e1bd31a68661      0t0  TCP 127.0.0.1:61248->127.0.0.1:17891 (ESTABLISHED)
2.1.331 77229  sun   11u  IPv4 0x6e80e9803f5d967e      0t0  TCP 127.0.0.1:61258->127.0.0.1:17891 (ESTABLISHED)
2.1.331 77229  sun    8u  IPv4 0x261f67d022186fa1      0t0  TCP 127.0.0.1:61262->127.0.0.1:17891 (ESTABLISHED)
2.1.331 77229  sun   12u  IPv4 0x5c21bcd70fe7498e      0t0  TCP 127.0.0.1:61290->127.0.0.1:17891 (ESTABLISHED)
```
- **零 Hook 纯记录接管验证**：
  - `.project/events/loom-4ba9abe4-9a0b-4562-9b7e-c889bec7a23b.jsonl` 不存在（0 条 hook 事件）。
  - `~/.claude/projects/-private-tmp-loom-ccp-live-1795788218921/5042f70d-e085-4c79-91b0-9827f1de0c8b.jsonl` 实际写入 `user` -> `assistant`（`stop_reason: "end_turn"`, `hasUsage: true`）-> `system/stop_hook_summary` -> `system/turn_duration`。
  - `loom state` 观测完整流转：`queued/accepted` -> `awaiting-user`（自动确认工作区信任）-> `received/delivered/delivered`（`state=busy`, t=9s）-> `received/delivered/answered`（`state=idle`, t=10s）。

### B. 停止后经 `--resume-session` 恢复（0 次额外模型请求）
- 命令：`loom stop loom-4ba9abe4-9a0b-4562-9b7e-c889bec7a23b` 后执行 `loom spawn auditor --project /private/tmp/loom-ccp-live-1795788218921 --cwd /private/tmp/loom-ccp-live-1795788218921 --resume-session 5042f70d-e085-4c79-91b0-9827f1de0c8b --trust-workspace`。
- 返回：`addr=loom-22fa44de-d6bc-4620-af0f-62027199b101`，`sessionId=5042f70d-e085-4c79-91b0-9827f1de0c8b`，`resumedSessionId=5042f70d-e085-4c79-91b0-9827f1de0c8b`，`deliveryId=null`。
- 进程链：`loom-holder` 启动 `/Users/sun/.local/bin/claude --resume 5042f70d-e085-4c79-91b0-9827f1de0c8b ...`，子进程 `pid=89302` 代理变量与上完全一致，`lsof -nP -a -p 89302 -i` 7 条 `ESTABLISHED` 连接 **100% 指向 `127.0.0.1:17891`，0 条非回环出网连接**；`loom state` 为 `state: "idle"`, `deliveriesCount: 0`（未误复放历史回合）。
- 验证完成后已停止所有临时会话与临时 `loomd`，并清理临时项目目录及临时 `~/.claude/projects/-private-tmp-loom-ccp-live-*` 目录。

---

## 5. `--resume-session` 用法与 Pilot Auditor 恢复命令

### 命令用法
```bash
loom spawn <super|leader|auditor> \
  --cwd <DIR> \
  --project <PROJECT_DIR> \
  --resume-session <UUID> \
  [--cli claude] [--mode tui] [--model <MODEL>] [--effort <EFFORT>] [--trust-workspace] \
  ["<可选首条消息>"]
```
- **权限与约束**：仅限 Super 发起，仅限常驻角色（`super` / `leader` / `auditor`），禁止用于 `worker` 或与 `--handover-from` 同用；`<prompt>` 可选（不传则仅恢复会话待命，不产生额外模型请求）。
- **CCP 强制校验**：拉起前若 Claude 可执行入口不是 CCP 入口，直接报错 `ccp-required` 并拒绝启动。

### 待 Super 实测执行的两个 Pilot Auditor 恢复命令（本任务未执行）

> 先确认目标项目对应的 `loomd` 已切换/重启到包含本次提交的代码，再按需执行（如工作区已在 `~/.claude.json` 信任，可省略 `--trust-workspace`）：

1. **恢复 pilot-cell Auditor**（`dd8f3c43-2781-4f75-8c80-7a259c3d3137`，cwd `/Users/sun/Code/loom-pilot-cell`）：
```bash
LOOM_EXTERNAL_SUPER=1 loom spawn auditor \
  --project /Users/sun/Code/loom-pilot-cell \
  --cwd /Users/sun/Code/loom-pilot-cell \
  --cli claude --mode tui \
  --resume-session dd8f3c43-2781-4f75-8c80-7a259c3d3137
```

2. **恢复 pilot-2 Auditor**（`296091e4-ad89-4b92-80d9-d7968f4e4a31`，cwd `/Users/sun/Code/loom-pilot2`）：
```bash
LOOM_EXTERNAL_SUPER=1 loom spawn auditor \
  --project /Users/sun/Code/loom-pilot2 \
  --cwd /Users/sun/Code/loom-pilot2 \
  --cli claude --mode tui \
  --resume-session 296091e4-ad89-4b92-80d9-d7968f4e4a31
```

---

## 6. 原依赖 Hook 功能的迁移、降级与风险清单（报 Super）

| 原功能 | 原依赖 | 现状态 | 替代机制 / 降级影响与风险 |
| :--- | :--- | :--- | :--- |
| 回合起止与最终回复提取 | `UserPromptSubmit` / `Stop` / `StopFailure` hook | **已迁移至记录** | 读 `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` 的 `user`、`assistant (stop_reason=end_turn)`、`system/turn_duration`、`system/stop_hook_summary`、`isApiErrorMessage` 与中止标记；零 hook 完成闭环。 |
| 投递确认与载荷完整性校验 | `UserPromptSubmit` hook + digest | **已迁移至记录** | holder/PTY 粘贴后，由 `tui/native.mjs` 与 `relay/sources.mjs` 从 JSONL `user` 行提取 `[loom:<deliveryId>]` 并执行 SHA-256 载荷摘要校验，随后匹配 assistant 回合结束确认。 |
| 上下文用量统计 | `statusLine` (`claude-context.mjs`) | **已迁移至记录** | `lib/session-context.mjs` 读取 JSONL 中 `assistant.message.usage` 结合 `model-table` 估算上下文占比；不再依赖 `statusLine` 注入。 |
| 压缩检测与记忆索引重注 | `SessionStart (compact)` / `PostCompact` hook | **已迁移至记录** | `withClaudeTranscriptStops` 将 JSONL `system/compact_boundary` 映射为 `PostCompact`，触发 `daemon/memory-injection.mjs` 重注记忆索引及 `retainCompaction` 留档。 |
| 工具调用证据审计 | `PreToolUse` / `PostToolUse` hook + transcript | **已迁移至记录** | `adapters/claude/parse.mjs` 直接从 JSONL `assistant.message.content` 的 `tool_use` 与 `user` 的 `tool_result` 生成完整事后证据。 |
| 账号额度与限流观测 | `statusLine` 包装 + hook | **已迁移至记录/刷新** | 改由 JSONL `rate_limit_info`、OAR `rate_limit_event` 及经 CCP 执行的 `loom accounts --refresh`（`auth status --json` + `-p /usage`）提供。 |
| 首轮启动与信任弹窗识别 | `SessionStart` hook + screen | **已迁移至屏幕+记录** | 启用 `providers.claude.screenStartup = true`，结合屏幕分类与 OSC 状态识别启动就绪与信任弹窗。 |
| **Senior Tool Guard（高级角色工具事前拦截）** | `PreToolUse` (`senior-tool-guard.mjs`) | **降级（无法事前阻断）** | **风险**：CCP 禁止注入 hooks，Leader/Auditor 的 Claude 会话无法在工具执行前由 hook 阻断越界修改；降级为系统提示约束 + 事后 transcript 审计（`--disallowedTools AskUserQuestion` 仍生效）。 |
| **Host Tier Claude Worker 工具事前拦截** | `PreToolUse` (`host-tool-guard.mjs`) | **降级（无 hook 事前阻断）** | **风险**：Host 级 Claude Worker 失去 `PreToolUse` 实时阻断，但 macOS Seatbelt 写边界（非 unconfined 模式）与事后 transcript/host 证据审计仍生效；`lib/host-tool-guard.mjs` 逻辑保留并补齐 `versions/*` 拦截规则（对其他仍支持 hook 的路径有效）。 |
| **PermissionRequest / Notification 结构化事件** | `PermissionRequest` / `Notification` hook | **降级至屏幕+OSC** | Claude 运行于 `--dangerously-skip-permissions` + `--disallowedTools AskUserQuestion` 下常规不弹权限框；异常弹窗改由 PTY 屏幕分类与 OSC 状态兜底，结构化详情略少于 hook。 |
| **`idleCompaction: false` 禁用空闲压缩** | `--settings '{"idleCompaction":false}'` | **降级（不可配置）** | **风险**：CCP 拒绝 `idleCompaction` 键，无法通过 `--settings` 关闭空闲压缩，Claude 将沿用其默认空闲压缩策略（`tui/providers.mjs` 已兼容 `Compacted while idle` 记录行，不误触发回合）；`.project/policy.json` 仍接受该字段以保持向后兼容。 |
| **`PreCompact` 压缩开始时刻通知** | `PreCompact` hook | **降级** | 压缩进行中改由屏幕 `compacting` 态识别，精确事件在压缩结束后由 JSONL `compact_boundary` 补齐。 |
| **`SessionBindingChanged`（会话中手工 `/clear` 等换 ID）** | `SessionStart` hook | **降级（保守隔离）** | Loom 启动时固定 `--session-id` / `--resume` 且仅对绑定 `<sessionId>.jsonl` 确认；若人工在 pane 内手工切换新 sessionId，Loom 不会误把别的会话当成当前会话（保守停留在未确认态）。 |
| **`cli/prompt-doctor.mjs` / `adapters/prompt-smoke.mjs` 本地回环冒烟** | `ANTHROPIC_BASE_URL` 指向本地 mock | **受 CCP 限制** | CCP 保护配置固定 `ANTHROPIC_BASE_URL=https://api.anthropic.com`，本地 mock 重定向对经 CCP 启动的 Claude 不会生效（未绕过 CCP）。 |

---

## 7. 测试与 Lint 验证

- `npm run lint`：`Loom lint passed (350 files).`
- `npm test`：**1096 tests, 1096 pass, 0 fail**（0 条 `spawn-guard` 违规，包含新增的 `daemon/claude-ccp.test.mjs` 对 CCP 契约、硬拒绝 `ccp-required`、代理变量保护、host-tool-guard 拦截 `versions/*`、以及 `--resume-session` 全流程覆盖）。

---

## 8. 剩余风险与注意事项

1. **首轮投递短暂 `draft-held` / 单次 `TUI submit unconfirmed`**：无 hook 时，全新 Claude 会话在首条消息提交后创建并落盘 `<sessionId>.jsonl` 约需 1–2s，可能略超过 `inbox/tui.mjs` 首跳确认窗，日志偶发单条 `TUI submit unconfirmed` 并在下一 `loomd` tick（约 5s 内）自动对账为 `delivered` / `answered`（0 丢失、0 重复，与 OpenCode TUI 行为一致）。
2. **历史实验归档脚本**：`tasks/CODEMODE-AB-1/launch.mjs` 已改为 CCP 入口，但同目录下已完成的历史基准脚本 `live.mjs` / `activation.mjs` 仍含旧版内联 hooks `--settings`（非生产路径，未动历史实验逻辑；若未来重跑该基准需同步改为读记录）。
3. **无 PreToolUse 事前拦截的风险**：见第 6 节；若 Super 需要对 Claude 高级角色或 host worker 恢复事前工具阻断，需后续与 CCP 侧协商白名单方案（本任务严格未碰 CCP）。

---

## 9. 合并 `main`（`960a2363`，含 RESUME-1 与 GUARD-ARGV-1）冲突处理说明

合并 `main` 时解决 4 处冲突并补齐回归断言，所有自动合并文件（含 `daemon/oar.mjs`、`daemon/socket-auth.mjs`、`daemon/supervisor.mjs`、`skills/loom/SKILL.md`）均已核查兼容：

1. **`daemon/claude-ccp.mjs`（AA 冲突）**：以 CCP-ROUTE-1 实现为准（导出 `nativeClaudeVersionsPattern`、严格拒绝控制字符与指向 `versions/*` 的 `LOOM_CLAUDE_CCP_BIN`、安全捕获 `defaultCcpClaudeEntry` 异常），同时保持 `createClaudeCcpBridge()` 默认 `ready: false` / 抛出 `not-ready` 契约，完整满足 RESUME-1 全部测试（`daemon/global-registry.test.mjs`、`daemon/lifecycle-resume.test.mjs`、`daemon/super-up.test.mjs`）。
2. **`daemon/sessions.mjs`（3 处冲突）**：
   - 合并 `../inbox/message.mjs` 的 `deliveryId` 与 `messageIdPattern`/`wireText` 导入，去重 `validateCcpClaudeEntry`（已在下方与 `createClaudeCcpBridge`、`defaultCcpClaudeEntry` 一并导入）；
   - `job` 构造同时保留 RESUME-1 的 `accountDir: resolveAccountDir(cli)` 与 CCP-ROUTE-1 的可选首条消息（`...(prompt !== undefined && { firstId, prompt })`）及 `...(resumeSession && { resumeNativeId: resumeSession })`；
   - `activate` 首条消息入队条件合并为 `!job.resumingExplicit && job.prompt && job.firstId && !mail.messages.some(...)`，兼顾 `loom resume` 与无 prompt 的 `loom spawn --resume-session`。
3. **`daemon/tui.mjs`（内容冲突）**：保留 Claude 不注册 `hookRunner`（`!['opencode', 'claude'].includes(row.cli)`）与 RESUME-1 的 `accountEnv` 传递；同时对 Claude 仅在已显式配置 `CLAUDE_CONFIG_DIR` 或 `job.accountDir` 非默认 `~/.claude` 时注入 `CLAUDE_CONFIG_DIR`，避免向默认 `~/.claude` 强设环境变量导致 macOS Keychain 命名空间切换，并去除重复的 `resume` 字段传递。
4. **`lib/host-tool-guard.mjs`（内容冲突）**：完整保留两侧改动——采用 GUARD-ARGV-1 的 `shellExecutables(command)` 仅检查可执行位置 `argv[0]`（支持字符串与数组命令，避免把普通参数中的 CLI 名称或路径误判为执行），并在可执行位置上套用 CCP 规则：拦截 `nativeClaudeVersionsPattern`（禁止直接执行 `~/.local/share/claude/versions/*`），对 `claude` 调用 `resolveClaudeExecutable(candidate, { env })`，其余 CLI 保持 `resolveNativeExecutable`。同步在 `daemon/claude-ccp.test.mjs` 补充组合断言（参数位允许、字符串与数组执行位均拒）。

**合并后验收**：`npm ci` 通过，`npm run lint` 通过（360 files），全量 `npm test` **1114/1114 通过，0 失败**。

STATUS: DONE
