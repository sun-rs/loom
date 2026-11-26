# INTEG-2 集成结果

从 `main` 的 `1a8a6319` 创建 `/Users/sun/Code/repos/loom-integ2`，分支为 `integ/main-2`。

| 卡片 | 源分支提交 | 集成合并提交 |
| --- | --- | --- |
| ROT-SELF-2 | `0bf68fab` | `17369a7d` |
| SKILL-VERIFY-1 | `7f855284` | `09f93b22` |
| WORKER-TIER-1 | `171ada65` | `0b31a7cf` |

三张卡各自在原工作树提交，然后按表中顺序合并。提交带有任务卡指定的共同作者。集成修正和补充断言见 `0bc8ff02`。

## 冲突与解法

- ROT-SELF-2 的冲突涉及 `daemon/routing.mjs`、`daemon/sessions.mjs`、`daemon/supervisor.mjs`、`skills/loom/SKILL.md`。保留 INTEG-1 的 SOCK-AUTH、换班 v2 首报及对方核对与 Worker 启动检查。简报把 `Do now` 单列。普通换班在原生 ACK 绑定后自动投递「接管生效」，v2 在另一位资深角色核对通过后将待办加入同一个确认信封。继任者在下一原生回合继续，提醒从信封的原生签收起计时，继续沿用 Leader → Auditor、Auditor → Super 的升级路线。TUI 的启动指令压缩为一次粘贴。
- SKILL-VERIFY-1 的 CLI 冲突涉及 `cli/control.mjs`、`cli/loom.test.mjs`、`cli/policy.mjs`、`cli/status.mjs`。保留 Worker 暖保留与派工原因、历史会话回归和轮换状态。保留 INTEG-1 对 Reviewer 的退役，仅为历史行提供兼容。读取旧策略时提示移除 `roles.reviewer` 并忽略该键。状态加入每阶段的审计发现。
- SKILL-VERIFY-1 的 daemon 冲突涉及 `daemon/gate-packet.mjs`、`daemon/hardening.test.mjs`、`daemon/routing.mjs`、`daemon/rpc.mjs`、`daemon/sessions.mjs`、`daemon/supervisor.mjs`、`daemon/supervisor.test.mjs`、`daemon/upgrade.test.mjs`。保留固定候选与基线、资深角色核对投递和升级恢复。门禁包加入不变量缺口及复核样本。Unix RPC 继续传递能力证明，审计发现写入由当前 Auditor 发起，门禁及阶段关闭检查未补回归的发现。保留认证、审计持久化、Worker 暖保留和升级测试。
- SKILL-VERIFY-1 的其余冲突涉及 `docs/ORG.md`、`index/index.mjs`、`memory/v1-read-auth.test.mjs`、`package.json`、`skills/loom/SKILL.md`。沿用现有组织和退役流程，从已存索引读取历史 Reviewer，保留跨项目记忆授权撤销测试，将 lint 接入 pretest，继续使用隔离的测试启动器。技能说明合并审计抽查、Worker 派工和换班指引。
- WORKER-TIER-1 的冲突涉及 `daemon/hardening.test.mjs`、`daemon/worker-environment.test.mjs`。保留 Worker 路径验证和各档权限测试，临时目录及进程使用夹具启动器。host 授权沿用 SOCK-AUTH 及现有资深角色写入锁。认证 Super 可签发，当前认证 Leader 可请求。给伪造身份、权限分层、持久化用量和到期行为保留真实 Unix socket 或隔离夹具验证。

## 验证

- `npm ci` 完成，`npm run lint` 通过，扫描 307 个文件。
- 顺序执行两轮 `npm test -- --test-concurrency=4`。每轮 791 项通过，失败、取消及跳过均为 0。 [第一轮](/private/tmp/loom-integ2-full-1.log) · [第二轮](/private/tmp/loom-integ2-full-2.log)
- `git diff --check` 通过。
- 在独立临时项目中，用 Git 归档的 `8fc550c0` 启动旧 loomd 和三个夹具会话，热升级至本分支后提交切换。 旧 Leader、Auditor、Worker 的 PID 保持不变，换班记录为零。三者经内核 peer PID 继续执行各自的授权命令，伪造身份和越权请求被拒绝。Worker 的空闲起点保持一致，剩余 TTL 从 14,843 ms 降至 12,220 ms，按原期限释放。 同一 Status TUI 在 15 次切换期间的短暂请求失败后恢复。 [演练日志](/private/tmp/loom-integ2-hot-upgrade.log)

`main` 保持在 `1a8a6319`。集成分支未推送。

STATUS: done
