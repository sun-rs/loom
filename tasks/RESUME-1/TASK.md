# RESUME-1：所有角色的会话恢复（中断、loomd 崩溃、电脑重启后，由 Super 执行）

> **暂缓（Super，2026-11-27）**：用户指出 `loom up` 应负责 Super 而不是全部项目，Super 自身由什么管理也未定，要先设计整个启动/恢复流程。本卡等设计定稿后改写再派。

用户 2026-11-27："我们需要提供 resume 能力，不仅仅是 worker，还有高级角色，因为假设因为进程中断，或者计算机重启等等，是需要对工作进行恢复的，但是这个操作可能一般是拉起 super 后让 super 去操作的。"
前置：CCP-ROUTE-1 已合入（Claude 一律经 CCP 入口，含"经 CCP --resume 恢复 Claude 高级角色"）。本卡在其基础上做成通用能力。

## 要做
1. **盘点**：`loom recover --project DIR [--json]`（仅 Super）。列出该项目所有"应在而不在"的会话：Leader、Auditor、未收口的 worker（含 idle-warm）。每行给出：角色、CLI、模型/effort、原生会话标识（Claude sessionId / Codex thread id / agy conversation id / OpenCode session）、最后活动时间、结束原因（stop、进程消失、holder 丢失、loomd 不在线期间丢失）、待投递和未确认的投递数量、对应卡与 worktree、能否原生 resume。
2. **恢复**：`loom resume <addr> [--project DIR]`（仅 Super；可 `--all` 但需逐个打印计划并要求 `--yes`）。按 CLI 用各自的原生续接方式拉起原会话：
   - Claude：经 CCP 入口 `--resume <sessionId>`（CCP-ROUTE-1 的路径，非 CCP 一律拒绝）；
   - Codex：app-server 的 thread resume（或 `codex resume`），沿用原 CODEX_HOME 与权限档；
   - agy、OpenCode：按固定版本支持的续接方式；不支持就明确报"无法原生续接"，给出"用交接单开新会话"的替代，不静默降级。
   恢复后由 loomd 重新接管：同一角色、同一项目、原卡与 worktree、原 worker 权限档与 grant（不重新计次），待投递按原水位重放并去重。
3. **电脑重启场景**：写清并测试顺序——`loom up` 拉起 loomd 与 Herdr 空间 → Super 运行 `loom recover` → 逐个 `loom resume`；高级角色先 Auditor 后 Leader（错峰），worker 最后。holder 丢失时 PTY 内容不可恢复，只恢复原生会话。
4. **恢复中的安全**：恢复不得改变网络出口（Claude 必须经 CCP；其他 CLI 保持原环境变量）；恢复前对照原会话记录核对 CLI、模型、账号目录，不一致就拒绝并说明。
5. skill：Super 核心里加一段"中断/重启后的恢复步骤"（3–5 行），其他角色不需要知道。
6. 测试先行：用假 CLI 覆盖四家的恢复路径、重放去重、拒绝非 CCP、拒绝 CLI/账号不一致、loomd 重启后的盘点。全量 `npm test`、`npm run lint` 通过。
7. 分支 infra/resume，工作树 /Users/sun/Code/repos/loom-resume，显式路径提交，不 commit -a，不 push。RESULT.md 以 STATUS 行收尾。
不往 pilot 终端输入，不读凭据，不碰 /Users/sun/Code/ccp。
