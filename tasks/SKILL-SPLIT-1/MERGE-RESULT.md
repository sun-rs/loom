# SKILL-SPLIT-1 合并结果

在工作树 `/Users/sun/Code/repos/loom-skill-merge` 的 `integ/skill-split` 分支上，沿用前序已解冲突的工作树状态（未推倒重来），完成 `infra/skill-split`（`a1e1582c`）合并并同步合入最新 `main`（`e97556ae`，含 `CCP-ROUTE-1`、`WORKER-REAP-2`、`RESUME-1`、`GUARD-ARGV-1`、ROT-TUNE-2、ROT-AGY-2、记忆注入与 host 授权）。

| 阶段 | 来源提交 | 合并提交 |
| --- | --- | --- |
| 合并 `infra/skill-split` 到原 `integ/skill-split` 起点（`ec50d625`） | `a1e1582c` | `156d94d7` |
| 同步合并 `main`（含 `GUARD-ARGV-1`、`RESUME-1`） | `ae22dd86` | `a9c92799` |
| 同步合并最新 `main`（含 `CCP-ROUTE-1`、`WORKER-REAP-2`） | `e97556ae` | `6688312d` |

## 冲突解决与逻辑衔接

- **以 `main` 为准保留新逻辑，再接入拆分角色核心与事件模块**：
  - `daemon/sessions.mjs`：保留 `main` 的 `CCP-ROUTE-1`（`validateCcpClaudeEntry`、`nativeClaude()`、`--resume-session`、预绑定 `sessionId`/`transcriptPath`、`resumeNativeId`、跳过恢复会话的新建引导模板且无首条提示时不发额外回合）、`memoryInjection`（`prepare`/`launch`/`validateMemory`）、`pendingHostGrant` 与 `unconfined` host 授权生命周期、`closeFailedHandover`、`holders(..., report)`、`RESUME-1`（`ccpBridge`、`accountDir`、`resumeSession`、`markSuperCleanExit`）及 `WORKER-REAP-2`（释放清理 `releaseTimeoutAt`）；在非 `--resume-session` 启动路径接入 `roleCore(row.role)` 与 `skillModules(['worker-integration' | 'successor'])`。
  - `daemon/supervisor.mjs`：保留 `main` 的 `CCP-ROUTE-1`（`withClaudeTranscriptStops` 合成 `sessionEvents`、`resumedSessionId`）、`WORKER-REAP-2`（`workerResultReceiptMs`、`backfillAdoptedRetention`、`UNCONFIRMED` 上报、2 倍 TTL 告警与 `reapSessions()` 先于 `pushNotifications()`）、ROT-TUNE-2 / ROT-AGY-2、记忆注入与提取（`createProjectMemory`、`createMemoryInjection`、`createMemoryExtractor`、`durableUserMessage`、`memoryWriteReminder`、`refreshCompactIndex`、`mem` RPC）、`HOST-UNCONFINED-1` 及 `RESUME-1`（`superHandoffReminder`、`recoverProject`、`resume`/`recover`）；投递装饰接入 `deliverySkillEvents`、`skillModules`、Worker 续作基线与超限模块顺延，并将 `post-compaction` 压缩检测切到 `sessionEvents.findLast(nativeCompaction)`，使无 hook 的 CCP Claude TUI 会话经会话记录 `compact_boundary` 触发、走 loom 投递附带事实卡与红线。
  - `daemon/self-rotation.mjs`：保留 `main` 的 `await failHandover`，接入 `skillModule: 'rotation'` 与 `skillModules(['rotation'])` 指引。
  - `daemon/worker-retention.mjs`、`daemon/skill-events.test.mjs`：保留 `WORKER-REAP-2` 全量变更；`nativeCompaction` 兼容 `compaction_ended` 的字符串 `outcome: 'completed'`、对象 `outcome: { kind: 'completed' }` 及 `PostCompact`（含 Claude transcript `compact_boundary` 合成事件）。
  - `inbox/engine.mjs`：保留 `SKILL-SPLIT-1` 的 `payloadFrozen` 与 `gateRejection` 附文件逻辑以及 `main` 的 `memoryRecipient` 改投重置与 `replayForResume`；当改投因 `memoryRecipient` 变更清除 `payloadFrozen` 时，同步清理旧的 `skillModules`、`skillDeferred`、`skillDenialOf`、`skillRedNotices`、`skillCompactionAt`、`resumeCheckpoint`、`gateRejection` 字段。
  - `daemon/upgrade.test.mjs`、`daemon/release.mjs`：保留 `main` 的 `anchorUpgradeProcesses` 并包含 `skills/loom` 与 `docs/HEADLESS.md` 发布摘要与复制。
- **拆分技能与 `RESUME-1` / `CCP-ROUTE-1` 指引衔接**：
  - `skills/loom/SKILL.md` 保留拆分后的 15 行总索引。
  - `skills/loom/roles/common.md` 规则 1 明确 Claude 一律经 CCP 入口（默认 `/Users/sun/.local/bin/claude`）。
  - `skills/loom/roles/super.md` 规则 13 补入 `--resume-session "$SESSION_ID"` 恢复已结束常驻 Claude 会话指引，规则 20 保留 `RESUME-1` 的 4 条「中断/重启后的恢复步骤」。
  - `skills/loom/references/admin.md` 新增「4. Claude CCP 与恢复」节，写明 2026-11-27 用户裁决（禁 `~/.local/share/claude/versions/*` 与 `realpath` 绕过、`ccp-required`、不注入 hooks/statusLine 改读 `~/.claude/projects/<编码后的 cwd>/<sessionId>.jsonl`、`--resume-session` 用法）。
  - 更新 `daemon/lifecycle-resume.test.mjs` 对齐 `skills/loom/SKILL.md` 索引链接与 `roleCore('super')`。
  - `evidence/facts.mjs`、`evidence/facts.test.mjs`：将 `~/` 家目录路径按项目外绝对路径处理（无 `pathBoundary` 时跳过，带 `pathBoundary` 时拒绝），避免托管 Super 核心提及 `~/.loom/super/live.md` / `~/.loom/super/handoff.md` 触发 `fact-miss` 误报。

## Claude CCP 入口与零 Hook 投递核查

- `main` 合入的 `CCP-ROUTE-1` 全量保持不变（Claude 启动不带 hooks、`--settings` 禁键、`--setting-sources`、`--strict-mcp-config`，经 `/Users/sun/.local/bin/claude` 启动并读会话记录）。
- 修复本次合入的评测入口 `tasks/SKILL-SPLIT-1/eval.mjs`：复用 `daemon/claude-ccp.mjs` 的 `defaultCcpClaudeEntry` / `validateCcpClaudeEntry`，`--cli claude` 强制使用 `/Users/sun/.local/bin/claude`（可经 `LOOM_CLAUDE_CCP_BIN` 配置），禁止 `realpath` 穿透符号链接，硬拒绝 `~/.local/share/claude/versions/*` 及其他非 CCP 路径（`ccp-required`）；非 Claude 允许列表移除 `share/claude/versions/`；移除 `--setting-sources ''` 与 `--strict-mcp-config`；保留代理环境变量且不触碰 `/Users/sun/Code/ccp`。
- 新增回归测试：
  - `tasks/SKILL-SPLIT-1/eval.test.mjs`：覆盖 `eval.mjs` 的 CCP 入口校验与 Claude 参数约束。
  - `daemon/claude-ccp.test.mjs`：新增 `hookless Claude TUI delivers post-compaction skill module via transcript compact_boundary`，验证零 hook 文件下经 Claude 会话记录 `compact_boundary` 由 loom 投递 `[loom-skill:post-compaction]` 与事实卡。

## 角色核心尺寸

由 `node tasks/SKILL-SPLIT-1/eval.mjs --arm tasks/SKILL-SPLIT-1/split-arm.json --describe` 生成（均在 ≤120 行、≤1,500 估算 token 预算内）：

| 核心（含共用规则） | 行数 | 估算 token |
| --- | ---: | ---: |
| Super | 26 | 1,210 |
| Auditor | 25 | 1,161 |
| Leader | 25 | 1,154 |
| Worker | 26 | 1,060 |

## 验证

全程未调用真实模型，未执行 `commit -a` 或 `push`：

- `npm ci`：在 `ae22dd86` 合并后通过（`added 146 packages, and audited 147 packages`，0 vulnerabilities；`ae22dd86..e97556ae` 未改动 `package.json` / `package-lock.json`）。
- `npm run lint`：通过（`Loom lint passed (369 files).`，含 `lintSkill` 全套校验）。
- `npm test`：通过（`tests 1144 · suites 0 · pass 1144 · fail 0 · cancelled 0 · skipped 0 · todo 0`）。
- `git diff --check`：通过（0 警告）。

STATUS: done
