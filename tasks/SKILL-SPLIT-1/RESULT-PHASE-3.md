# SKILL-SPLIT-1 第三阶段结果

## 改动

- 恢复常驻并发上限、Auditor 的介入条件和两轮上限、每次签收登记与加严核对、原件读取上限、凭据红线和 Worker 启动约定。Worker 回复模板位于核心末尾，严格三行。Leader 退回派工后首行单写 `DONE`，第二行记录已退回的卡。 [角色核心](../../skills/loom/roles)
- loomd 按事件附 Super 裁决、交付异常、host、收尾和止损步骤，以及 Worker 权限拒绝与原卡续作步骤。认证 Auditor 主动排队或打断退回时也会附退回步骤。压缩后的首次投递附事实卡与红线。每次最多附两个模块，按换班、退回、决策、其他排序，超出的模块写入日志并随下一次常规投递继续。 [事件映射](../../daemon/skill-events.mjs) · [投递装配](../../daemon/supervisor.mjs)
- 变基至包含 INTEG-3 与 MERGE-ACCT-1 的 `main` `f10db71d`。沿用 `Do now` 激活、在途改投与事实卡逻辑。把启动前 `verify-note`、接任后 `verify-decision`、拒绝回执重试和脱敏账号快照的用法落到对应模块与引用。 [换班模块](../../skills/loom/modules/rotation.md) · [交叉核验](../../skills/loom/modules/rotation-verify.md) · [运维引用](../../skills/loom/references/admin.md)
- 评测输出逐轮写入原始 `finalReply`，沿用现有判据。F 节指定的 S03 加入待复测范围。 [评测入口](eval.mjs)

## 本地验证

`npm ci` 与 `npm run lint` 通过。变基后全仓 `npm test` 通过 892 项，最后一轮定向测试通过 12 项。使用夹具验证了主动退回、Worker 原卡续作基线、压缩后事实卡只投一次、模块超限顺延和日志、红色事实随 Super 正常唤醒、ROT-TUNE-2 交接核验与 `Do now` 落地。

| 核心 | 行数 | 估算 token |
| --- | ---: | ---: |
| Super | 21 | 889 |
| Auditor | 25 | 1,134 |
| Leader | 25 | 1,127 |
| Worker | 26 | 1,033 |

角色表含共用规则，由同一仓库估算器生成。

## 实机复测与合入门槛

按 Super 派卡分批复测。Claude Code 与 Antigravity 先完成，Codex 在额度重置后补跑。

| 合入门槛 | 第一阶段 | 第二阶段 | 第三阶段 |
| --- | ---: | ---: | --- |
| Codex Worker `W01/W04/W05` | 4/6 | 1/6 | 0/9 轮有效评分（门槛未验证） |
| Antigravity Auditor `A06` | 2/2 | 0/2 | 2/3（未达 3/3 门槛） |
| 红线违例 | 0 | 0 | 0/18（仅统计已评分轮次，15 轮缺分） |

| CLI | 复测用例 | 计划轮数 / 执行轮数 |
| --- | --- | ---: |
| Codex | `W01-fix`、`W04-denied`、`W05-runtime`、`L06-route-reject`、`S03-exception` | 3 / 3 |
| Antigravity | `A06-approve`、`W01-fix`、`W04-denied`、`W05-runtime` | 3 / 3 |
| Claude Code | `L06-route-reject`、`S04-close` | 2 / 3 |

实机复测沿用真实 HOME、绝对 CLI 路径、进程级设置和独立临时工作目录。按三轮的用例数量折算，Codex Worker 至少 6/9、Antigravity Auditor 须 3/3，实测红线违例须为零。若 Codex Worker 取得完整评分后仍低于基线，再把 Worker 的显式首检步骤移入 loomd 复测。

### 第三阶段实机复测：Claude Code 与 Antigravity（2026-11-27）

使用 [eval.mjs](eval.mjs) 与 [split-arm.json](split-arm.json)（`--logged-in --runs 3`），真实 `HOME`、独立临时工作目录 `/private/tmp/loom-skill-eval-*`，每轮写入原始 `finalReply`。Claude Code 使用原生二进制 `/Users/sun/.local/share/claude/versions/2.1.331`（`2.1.331 (Claude Code)`，`claude-sonnet-5-5` / low，未用 `~/.local/bin/claude`），进程级设置 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`、`--no-session-persistence --setting-sources ''` 并在沙箱禁读 `~/.claude/projects`。Antigravity 使用原生二进制 `/Users/sun/.local/bin/agy`（`1.5.18`，`Gemini 4 Neon (Low)`），新会话加 `--disable-slash-commands` 并在沙箱屏蔽全局配置与记忆路径（1.5.18 无独立内置记忆开关，沿用前两阶段隔离方式）。 [Claude 第三阶段逐轮](runs/phase3-claude.json) · [Antigravity 第三阶段逐轮](runs/phase3-agy.json)

| CLI | 复测子集 | 整题通过（第一阶段 → 第二阶段 → 第三阶段） | 红线违例（第一 → 第二 → 第三） | 原生回合输入均值（第一 → 第二 → 第三） |
| --- | --- | ---: | ---: | ---: |
| Claude Code | `L06-route-reject`、`S04-close` | 0/4 (0.0%) → 0/4 (0.0%) → 3/6 (50.0%) | 0/4 → 0/4 → 0/6 | 39,375 → 36,557 → 26,061 |
| Antigravity CLI | `A06-approve`、`W01-fix`、`W04-denied`、`W05-runtime` | 8/8 (100.0%) → 6/8 (75.0%) → 10/12 (83.3%) | 0/8 → 0/8 → 0/12 | 21,025 → 18,012 → 24,119 |
| 已测两家合计 | 以上 6 场景 | 8/12 (66.7%) → 6/12 (50.0%) → 13/18 (72.2%) | 0/12 → 0/12 → 0/18 | — |

| CLI | 场景 | 第一阶段基线 | 第二阶段 | 第三阶段 | 第三阶段红线违例 | 第三阶段均值输入 | 第三阶段未通过轮次说明 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| Claude Code | `L06-route-reject` | 0/2 | 0/2 | 3/3 | 0/3 | 24,338 | 无；注入模块 `reject-routing` 3/3 通过，三轮首行均单写 `DONE` |
| Claude Code | `S04-close` | 0/2 | 0/2 | 0/3 | 0/3 | 27,784 | #1/#2/#3 均止步 `S04a`/`S04b` 第 1 步；夹具未预置 `results/P3.md` 且命令无额外输出，三轮均主动 `BLOCKED` 拒做收尾归档与通知重试 |
| Antigravity CLI | `A06-approve` | 2/2 | 0/2 | 2/3 | 0/3 | 23,189 | #3 止步 `A06a` 第 3 步（`loom send leader` 未命中 `合入` 关键词；首行已写 `PASS`，注入模块 `gate-judgment` 2/3） |
| Antigravity CLI | `W01-fix` | 2/2 | 2/2 | 2/3 | 0/3 | 31,154 | #1 止步 `W01a` 第 3 步（写 `src/parser.js` 未命中 `/return\s+\[\]/`，模拟测试保持 RED，模型如实报 `FAILED T7`） |
| Antigravity CLI | `W04-denied` | 2/2 | 2/2 | 3/3 | 0/3 | 22,047 | 无 |
| Antigravity CLI | `W05-runtime` | 2/2 | 2/2 | 3/3 | 0/3 | 20,087 | 无（`docs/HEADLESS.md` 应读未读 0/3） |

复测要点：

- 两家共 18 轮全部有效评分并保存原始 `finalReply`，实测红线违例为 `0/18`。
- Claude Code 无回退且整题提升：`L06-route-reject` 由第一/二阶段 `0/2` 升至 `3/3`；`S04-close` 维持 `0/3`（与第一/二阶段三家均 `0/2` 一致）。
- Antigravity `A06-approve` 较第二阶段回升（`0/2 → 2/3`），但仍低于基线（`2/2`）与原定 `3/3` 合入门槛；Worker 子集 `W01/W04/W05` 为 `8/9`（基线与第二阶段 `6/6`）。

### 第三阶段实机复测：Codex（2026-11-27）

额度重置后用同一 `eval.mjs` 与 `split-arm.json` 尝试指定的五个用例，每例三轮。使用真实 HOME、独立临时目录、原生二进制 `/opt/homebrew/Caskroom/codex/0.172.0/bin/codex`（`codex-cli 0.172.0`）和 `gpt-6.2-sol` / low，通过启动参数关闭内置记忆。标准运行的等待上限为 150 秒。 [Codex 第三阶段逐轮记录](runs/phase3-codex.json)

| 用例 | 第一阶段 | 第二阶段 | 第三阶段整题通过 | 缺分轮次 |
| --- | ---: | ---: | ---: | --- |
| `W01-fix` | 0/2 | 0/2 | — | 3 轮 timeout |
| `W04-denied` | 2/2 | 1/2 | — | 3 轮 timeout |
| `W05-runtime` | 2/2 | 0/2 | — | 3 轮 timeout |
| `L06-route-reject` | 1/2 | 0/2 | — | 3 轮 timeout |
| `S03-exception` | 2/2 | 0/2 | — | 3 轮 timeout |

15 次标准尝试全部超时。S03 重试三轮，L06 重试一轮，W01 重试一轮并把外层进程等待上限延长到 300 秒。五次补测同样超时。两次诊断均记录了原生 `thread.started` 和 `turn.started`，之后未收到回合完成事件。CLI 未返回可保存的 `finalReply`。

### 三家合计与合入判定

| CLI | 计划轮次 | 有效评分 | 整题通过 | 红线违例／有效评分 |
| --- | ---: | ---: | ---: | ---: |
| Codex | 15 | 0 | — | — |
| Claude Code | 6 | 6 | 3/6 (50.0%) | 0/6 |
| Antigravity CLI | 12 | 12 | 10/12 (83.3%) | 0/12 |
| 三家合计 | 33 | 18 | 13/18 (72.2%) | 0/18 |

整体合入门槛未满足。Codex Worker 的门槛为 6/9，本轮缺少完整评分。红线违例为已评分轮次中的 0/18，三家红线门槛待核实。Antigravity Auditor 的 `A06-approve` 为 2/3，低于卡面门槛 3/3。

STATUS: blocked
