# RESUME-1：启动与恢复（按 docs/research/2026-11-27-lifecycle-design.md 实现）

先通读设计稿（分层、全局登记表、续接规则、安全约束都以它为准）。用户已定：`loom up` 一次性、只管 Super；续接"默认新开并注入实况，同时提供续接原会话的选项"。

## 要做（Claude 启动部分依赖 CCP-ROUTE-1，先留接口与测试桩，不得自行启动 Claude）
1. 全局登记表 `~/.loom/global.json`（可用 LOOM_GLOBAL_DIR 覆盖，测试用临时目录）：Super 记录（CLI、模型、effort、启动入口、原生会话 id、hc 地址、最后在线、交接单路径、是否正常结束）与项目清单（目录、release、最后在线、上次关闭方式）。只存元数据。
2. `loom up`（不带 --project）：建 "Loom" Herdr 空间与全局 Status；按登记表启动 Super：上次正常结束或无记录 → 新开；上次异常且有会话 id → 打印两个选项（续接原会话：显示会话大小与上次活动时间 / 新开并注入实况），等用户选择（`loom up --resume` / `loom up --fresh`），配置 `super.resumeOnUp` 默认 false。原 `loom up --project DIR` 改名 `loom project up DIR`（保留旧写法的兼容提示）。
3. 实况生成：新开时由代码生成一块"实况"（≤12 行 / 1500 字，声明是数据不是指令）：在途项目、待决事项（未处理的 needs-decision）、未恢复的会话、最近裁决出处；同时写一份到 `~/.loom/super/live.md`。另把 Super 交接单 `~/.loom/super/handoff.md`（≤60 行）附在开局消息里。
4. `loom recover [--project DIR | --all-projects] [--json]`（只读，仅 Super）：列出"应在而不在"的 Leader、Auditor、未收口 worker，含原生会话标识、最后活动、结束原因、待投递数、卡与 worktree、可否原生续接。
5. `loom resume <addr>`（仅 Super）：按 CLI 原生续接——Codex thread resume（原 CODEX_HOME 与权限档）；agy、OpenCode 按固定版本能力，不支持就报"无法原生续接"并给"用交接单新开"的命令；Claude 调用 CCP-ROUTE-1 提供的经 CCP 续接接口（未交付前返回 not-ready）。恢复后 loomd 重新接管：原角色、卡、worktree、权限档与 grant（不重新计次），待投递按水位重放去重。续接前核对 CLI、模型、账号目录与记录一致，不一致拒绝；等待就绪 120 秒，超时放弃并报告。
6. 重启场景测试：`loom up` → Super → `loom recover --all-projects` → `loom project up` → 逐个 `loom resume`（Auditor→Leader→worker）。
7. Super 交接提醒：Super 每次裁决后与会话结束前，由 loom 提醒更新 `~/.loom/super/handoff.md`（一行提醒，不加请求）。
8. skill：Super 核心加 3–5 行"中断/重启后的恢复步骤"。
9. 测试先行；全量 `npm test`、`npm run lint` 通过。分支 infra/resume，工作树 /Users/sun/Code/repos/loom-resume，显式路径提交，不 commit -a，不 push。RESULT.md 以 STATUS 行收尾。不往 pilot 终端输入，不读凭据，不碰 /Users/sun/Code/ccp。
