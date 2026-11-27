# SKILL-SPLIT-1 合并结果

在工作树 `/Users/sun/Code/repos/loom-skill-merge` 的 `integ/skill-split` 分支上，沿用前序已解冲突的工作树状态（未推倒重来），完成 `infra/skill-split`（`a1e1582c`）合并并同步合入最新 `main`（`ae22dd86`）。

| 阶段 | 来源提交 | 合并提交 |
| --- | --- | --- |
| 合并 `infra/skill-split` 到原 `integ/skill-split` 起点（`ec50d625`） | `a1e1582c` | `156d94d7` |
| 同步合并最新 `main`（含 `GUARD-ARGV-1`、`RESUME-1`） | `ae22dd86` | `a9c92799` |

## 冲突解决与逻辑衔接

- **保留 `main` 新逻辑并接入拆分角色核心与事件模块**：
  - `daemon/sessions.mjs`：保留 `main` 的 `memoryInjection`（`prepare`/`launch`/`validateMemory`）、`pendingHostGrant` 与 `unconfined` host 授权生命周期、`closeFailedHandover`、`holders(..., report)` 及 `RESUME-1`（`ccpBridge`、`accountDir`、`resumeSession`、`markSuperCleanExit`）；启动提示接入 `roleCore(row.role)` 与 `skillModules(['worker-integration' | 'successor'])`。
  - `daemon/supervisor.mjs`：保留 `main` 的 ROT-TUNE-2 / ROT-AGY-2、记忆注入与提取（`createProjectMemory`、`createMemoryInjection`、`createMemoryExtractor`、`durableUserMessage`、`memoryWriteReminder`、`refreshCompactIndex`、`mem` RPC）、`HOST-UNCONFINED-1` 及 `RESUME-1`（`superHandoffReminder`、`recoverProject`、`resume`/`recover`）；投递装饰与命令路径接入 `deliverySkillEvents`、`skillModules`、压缩后事实卡与红线、Worker 续作基线（`workerCheckpoint`）及超限模块顺延。
  - `daemon/self-rotation.mjs`：保留 `main` 的 `await failHandover`，接入 `skillModule: 'rotation'` 与 `skillModules(['rotation'])` 指引。
  - `daemon/worker-retention.mjs`、`daemon/skill-events.test.mjs`：`nativeCompaction` 兼容 `compaction_ended` 的字符串 `outcome: 'completed'` 与对象 `outcome: { kind: 'completed' }`（匹配 `main` 的 Codex pipe 会话压缩事件）。
  - `inbox/engine.mjs`：保留 `SKILL-SPLIT-1` 的 `payloadFrozen` 与 `gateRejection` 附文件逻辑以及 `main` 的 `memoryRecipient` 改投重置与 `replayForResume`；当改投因 `memoryRecipient` 变更清除 `payloadFrozen` 时，同步清理旧的 `skillModules`、`skillDeferred`、`skillDenialOf`、`skillRedNotices`、`skillCompactionAt`、`resumeCheckpoint`、`gateRejection` 字段。
  - `daemon/upgrade.test.mjs`、`daemon/release.mjs`：保留 `main` 的 `anchorUpgradeProcesses` 并包含 `skills/loom` 与 `docs/HEADLESS.md` 发布摘要与复制。
- **拆分技能与 `RESUME-1` 恢复指引衔接**：
  - `skills/loom/SKILL.md` 保留拆分后的 15 行总索引；将 `RESUME-1` 新增的「中断/重启后的恢复步骤」（`loom up`、`~/.loom/super/live.md`、`~/.loom/super/handoff.md`、`loom recover --all-projects`、`loom project up`、`loom resume`、Claude 经 CCP 接口）落入 `skills/loom/roles/super.md` 规则 20。
  - 更新 `daemon/lifecycle-resume.test.mjs` 对齐 `skills/loom/SKILL.md` 索引链接与 `roleCore('super')`。
  - `evidence/facts.mjs`、`evidence/facts.test.mjs`：将 `~/` 家目录路径按项目外绝对路径处理（无 `pathBoundary` 时跳过，带 `pathBoundary` 时拒绝），避免托管 Super 核心提及 `~/.loom/super/live.md` / `~/.loom/super/handoff.md` 触发 `fact-miss` 误报。

## Claude CCP 入口约束

- 修复本次合入的评测入口 `tasks/SKILL-SPLIT-1/eval.mjs`：
  - 复用 `daemon/claude-ccp.mjs` 的 `defaultCcpClaudeEntry` / `validateCcpClaudeEntry`，`--cli claude` 强制使用 `/Users/sun/.local/bin/claude`（可经 `LOOM_CLAUDE_CCP_BIN` 配置），禁止 `realpath` 穿透符号链接，硬拒绝 `~/.local/share/claude/versions/*` 及其他非 CCP 路径（`ccp-required`）。
  - 非 Claude 允许列表移除 `share/claude/versions/`；`cliOptions('claude', ...)` 移除可能与 CCP 保护设置冲突的 `--setting-sources ''` 与 `--strict-mcp-config`；`privateRun` 保留代理环境变量（`HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 及小写形式、`ANTHROPIC_BASE_URL`），且不读取或改动 `/Users/sun/Code/ccp`。
  - 在 `tasks/SKILL-SPLIT-1/eval.test.mjs` 新增单元测试覆盖上述 CCP 入口校验与参数约束（未调用真实模型）。
- `main` 原有 `daemon/executables.mjs` 等 loomd 运行时 Claude 路径仍归属独立分支 `infra/ccp-route`（`CCP-ROUTE-1`），本次合并未改动。

## 角色核心尺寸

由 `node tasks/SKILL-SPLIT-1/eval.mjs --arm tasks/SKILL-SPLIT-1/split-arm.json --describe` 生成（均在 ≤120 行、≤1,500 估算 token 预算内）：

| 核心（含共用规则） | 行数 | 估算 token |
| --- | ---: | ---: |
| Super | 26 | 1,135 |
| Auditor | 25 | 1,134 |
| Leader | 25 | 1,127 |
| Worker | 26 | 1,033 |

## 验证

全程未调用真实模型，未执行 `commit -a` 或 `push`：

- `npm ci`：通过（`added 146 packages, and audited 147 packages`，0 vulnerabilities，`postinstall` 成功）。
- `npm run lint`：通过（`Loom lint passed (368 files).`，含 `lintSkill` 全套校验）。
- `npm test`：通过（`tests 1132 · suites 0 · pass 1132 · fail 0 · cancelled 0 · skipped 0 · todo 0`）。
- `git diff --check`：通过（0 警告）。

STATUS: done
