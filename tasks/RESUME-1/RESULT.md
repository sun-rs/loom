# RESUME-1 结果

按 `docs/research/2026-11-27-lifecycle-design.md` 与 `tasks/RESUME-1/TASK.md` 在分支 `infra/resume`（工作树 `/Users/sun/Code/repos/loom-resume`）完成了 L1–L4 启动与恢复闭环。全程未启动 Claude、未触碰 `/Users/sun/Code/ccp`、未读凭据、未向 pilot 终端输入。

## 交付内容

1. **全局登记表**（`daemon/global-registry.mjs`）：持久化 `~/.loom/global.json`（支持 `LOOM_GLOBAL_DIR` 覆盖，0600 原子写入），记录 Super 元数据（`cli`、`model`、`effort`、`entry`、`accountDir`、`sessionId`、`transcriptPath`、`hcAddress`、`cwd`、`lastOnlineAt`、`handoffPath`、`cleanExit`、`exitReason`）与项目清单（`dir`、`release`、`lastOnlineAt`、`lastShutdown` 为 `normal`/`abnormal`），严格白名单校验、拒绝凭据或密钥字段。配置 `super.resumeOnUp` 默认 `false`。`loomd` 启动时登记为 `abnormal`，正常退出（`daemon-stop`/信号）时置为 `normal`。
2. **L1 `loom up` 与 L3 `loom project up`**（`daemon/super-up.mjs`、`daemon/herdr-layout.mjs`、`cli/loom.mjs`）：
   - `loom up`（不带 `--project`）只管全局层：建/复用 `Loom` Herdr 空间与全局 Status（`loom tui --all`），不碰任何项目。上次正常结束或无记录直接新开；上次异常且有 `sessionId` 且 `resumeOnUp=false` 时打印两个选项（续接原会话并显示会话大小与上次活动时间 / 新开并注入实况），等待用户运行 `loom up --resume` 或 `loom up --fresh`。
   - `loom up --resume` 核对 CLI、模型、账号目录、启动入口与会话归属，不一致拒绝（`resume-mismatch`）；120 秒就绪超时即中止并自动降级为新开、汇报原因。
   - 原 `loom up --project DIR` 更名为 `loom project up [DIR]`，保留旧写法兼容执行并在 stderr 及 JSON 中输出迁移提示；另提供 `loom super --close` 记录正常结束。
3. **实况生成与 Super 交接单**（`daemon/super-live.mjs`）：新开 Super 时由代码生成实况块（硬上限 ≤12 行 / ≤1500 字，首行声明仅是只读状态数据不是指令，清洗多行注入），覆盖在途项目、未处理 `needs-decision`、未恢复会话、最近裁决出处，写入 `~/.loom/super/live.md`；同时读取 `~/.loom/super/handoff.md`（截断至 ≤60 行）一并附入开局消息。
4. **`loom recover [--project DIR | --all-projects] [--json]`**（`daemon/recover.mjs`、`daemon/socket-auth.mjs`）：只读且仅 Super 可调用（在线走 `superCommands` 鉴权，离线由 `requireSuperCaller` 拒绝 Leader/Auditor/Worker）。按 Auditor → Leader → 未收口 worker 顺序列出应在而不在的会话，含原生 `sessionId`、`lastActivityAt`、`exitReason`、`pendingDeliveries`、`task`/`wave`、`worktree`、`workerTier`/`hasHostGrant` 与 `nativeResume` 状态及命令。
5. **`loom resume <addr>`**（`daemon/sessions.mjs`、`daemon/tui.mjs`、`daemon/oar.mjs`、`daemon/codex-holder.mjs`、`daemon/host-client.mjs`、`inbox/engine.mjs`、`daemon/rpc.mjs`）：
   - 仅 Super 可调用（`superCommands`）。续接前核对 CLI、模型、账号目录与政策 `deny`，不一致拒绝（`resume-mismatch`）；等待就绪 120 秒，超时中止并回滚至结束态（`resume-timeout`）。
   - Codex 走原生 thread/TUI resume 并保留原 `CODEX_HOME` 与权限档；agy（固定版本 1.5.17/1.5.18）与 OpenCode（固定版本 2.3.0 headless 支持、TUI 不支持）按 `daemon/resume-capabilities.mjs` 固定版本能力表判定，不支持时返回 `resume-unsupported`（含"无法原生续接"与"用交接单新开"命令）。
   - Claude 走 `daemon/claude-ccp.mjs` 定义的 CCP-ROUTE-1 接口与测试桩：非 CCP 入口直接拒绝 `ccp-required`，未接入 CCP-ROUTE-1 前返回 `not-ready`，绝不自行启动 Claude。
   - 恢复后 `loomd` 重新接管原 `addr`、角色、卡、worktree、权限档与未过期 `hostGrant`（不重新计次，过期则拒）；`inbox/engine.mjs` 的 `replayForResume` 按原生日志/已确认水位重放未送达投递并去重，不重放已确认消息与已完成首轮的 `firstId`。同时调整 `daemon/host-client.mjs`：已运行过的 `session-host` 进程意外消失（如重启）时不再自动拉起，改为收尾并交由 Super 决策恢复。
6. **Super 交接提醒与 Skill**（`daemon/supervisor.mjs`、`daemon/super-up.mjs`、`skills/loom/SKILL.md`）：
   - Super 每次裁决后（`send` 裁决消息、`rotation-policy ruling/rule-change`、`grant` 授权、`notifications --take` 领取 `needs-decision`）与会话结束前（`stop` Super、`loom super --close`）在回执附单行 `handoffReminder`，不增加模型请求。
   - `skills/loom/SKILL.md` 的 Super 核心节增加 4 行"中断/重启后的恢复步骤"。

## 验证（测试先行 RED → GREEN）

- 先行编写 3 个新测试文件并运行确认 RED（3/3 模块缺失失败）：
  - `daemon/global-registry.test.mjs`（含 `invariant [persistence]` 元数据与凭据拒绝测试、CCP 桩、固定版本能力表）
  - `daemon/super-up.test.mjs`（含 `invariant [persistence]` `live.md` 12 行/1500 字上限与多行注入中和、假 Herdr 空间创建、异常退出双选项、`--resume` 校验与超时降级、Claude 拒直启）
  - `daemon/lifecycle-resume.test.mjs`（含完整重启场景 `loom up` → Super → `loom recover --all-projects` → `loom project up` → 逐个 `loom resume` Auditor→Leader→worker、`invariant [idempotency]` 重放去重与 host grant 不重计次、TUI Codex `CODEX_HOME` 续接与 OpenCode TUI 拒绝、CLI 端到端兼容提示与 Super 鉴权、交接提醒与 Skill 校验）
- 更新 `daemon/socket-auth.test.mjs` 覆盖新增 `superCommands`（`recover`、`resume`）。
- 全量验收：`npm test`（含 `pretest` 的 `npm run lint`）：
  - `Loom lint passed (357 files).`
  - `tests 1106 · pass 1106 · fail 0 · cancelled 0 · skipped 0`

## 遗留与接口衔接

- Claude 的经 CCP 启动与续接逻辑当前由 `daemon/claude-ccp.mjs` 留出标准接口（`launchSuper`、`resumeSuper`、`resumeSession`）并在未交付前返回 `not-ready`（非 CCP 入口返回 `ccp-required`），待 `CCP-ROUTE-1` 合并后接入实现并做实机验证。

STATUS: done
