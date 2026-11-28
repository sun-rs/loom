# AUDITOR-LEAN-1 结果

## 1. 只读统计（pilot-cell / pilot-2，仅 Auditor）

只读采集时间：2026-11-27 16:15 +08:00（使用 `projectSessions`、`historyReader`、`projectCost` 与 `seniorToolEvents` 只读解析两个 pilot 的原生转录与 `tool-guard.jsonl`；未向 pilot 终端输入，未读取任何凭据）。pilot-2 在卡片起草后又运行了 3 个回合，故快照回合数为 144（143 含用量）。

### 1.1 每回合模型调用数分布

| 指标 | pilot-cell (Claude Sonnet, 1 会话) | pilot-2 (Claude Sonnet, 7 会话) |
| :--- | ---: | ---: |
| 回合数（含用量回合） | 25 (25) | 144 (143) |
| 总模型调用数 | 362 | 876 |
| 每回合平均调用数（目标 ≤ 5） | **14.48** | **6.13**（按总回合 6.08） |
| 分布（min / p25 / median / p75 / p90 / p95 / max） | 2 / 10 / 12 / 21 / 23 / 24 / 33 | 0 / 1 / 3 / 7 / 11 / 19 / 44 |
| 桶分布：`0 / 1 / 2 / 3-5 / 6-10 / 11-20 / 21-50` | `0 / 0 / 2 / 1 / 5 / 10 / 7` | `1 / 44 / 17 / 32 / 32 / 10 / 8` |
| 达标回合（≤ 5 calls/turn）占比 | 3 / 25 (12.0%) | 94 / 144 (65.3%) |
| 0 拒绝回合均值 vs ≥1 拒绝回合均值 | **2.67** (n=3) vs **16.09** (n=22) | **3.20** (n=111) vs **15.79** (n=33) |
| 总 raw tokens / 平均单次输入 token | 97,565,001 / 268,936 | 169,279,797 / 192,508 |

核心发现：两套 pilot 在无守卫拒绝的回合里每回合仅 **2.67–3.20 次**调用（天然 ≤ 5）；一旦触发拒绝，每回合立刻飙升到 **15.79–16.09 次**（平均每回合 6.09–6.91 次拒绝 + 5.85–6.41 次 override）。

### 1.2 被拒工具调用占比与被拒工具/命令构成

| 维度 | pilot-cell | pilot-2 | 合计 |
| :--- | ---: | ---: | ---: |
| 总工具调用 / 守卫拒绝次数（占比） | 390 / **152 (39.0%)** | 896 / **201 (22.4%)** | 1,286 / **353 (27.4%)** |
| 按工具类型：`Bash / Read / Write` | `149 / 2 / 1` | `190 / 9 / 2` | `339 / 11 / 3` |
| 按守卫分类：`unclassified-tool / source-read / source-search` | `84 / 58 / 10` | `71 / 86 / 44` | `155 / 144 / 54` |
| **本应允许类** — `.project/` 查询（`jq`/通配符/`tail -n +N`/`$LOOM_PROJECT`/管道过滤） | 48 (31.6%) | 25 (12.4%) | 73 (20.7%) |
| **本应允许类** — `loom <cmd>` 接管道 `grep/jq/cut/head/tail` | 6 (3.9%) | 40 (19.9%) | 46 (13.0%) |
| **本应允许类** — `git` 元数据（`--stat`/`diff-tree --stat`/`log` 接管道、`date`） | 6 (3.9%) | 10 (5.0%) | 16 (4.5%) |
| **本应允许类** — `git show <sha>:<path> \| sed -n`/`head -n`（候选 SHA 定点切片） | 19 (12.5%) | 24 (11.9%) | 43 (12.2%) |
| **应继续禁止类** — `git diff` 补丁正文 | 13 (8.6%) | 41 (20.4%) | 54 (15.3%) |
| **应继续禁止类** — `git grep` 仓库搜索 | 39 (25.7%) | 9 (4.5%) | 48 (13.6%) |
| **应继续禁止类** — `/tmp` scratchpad 或 `~/.claude` 工具结果读写 | 6 (3.9%) | 38 (18.9%) | 44 (12.5%) |
| **应继续禁止类** — `node`/`python`/`for` 脚本、`git show` 整文件/无界搜索等 | 15 (9.9%) | 14 (7.0%) | 29 (8.2%) |

### 1.3 拒后 Auditor 立即行为分布

| 拒后下一步动作（同回合下一条 assistant 消息） | pilot-cell (n=152) | pilot-2 (n=201) |
| :--- | ---: | ---: |
| 立即走 `senior-tool` override（同命令 `--` 或 `--retry DENY-ID`） | **126 (82.9%)**（`--`: 99，`--retry`: 27） | **146 (72.6%)**（`--`: 146） |
| 立即走 `senior-tool` override（改写命令后 `--`） | 10 (6.6%) | 11 (5.5%) |
| 换同工具参数（仍被拒 / 放行） | 8 (5.3%)（仍拒 7 + Read 1 / 放行 2 Bash） | 21 (10.4%)（仍拒 15 / 放行 6，含 Read 加 `limit<=200` 3 次） |
| 换其他工具（放行 / 仍被拒） | 6 (3.9%)（Read 放行 4 / Bash 仍拒 2） | 21 (10.4%)（Read/Write 放行 15 / 仍拒 6） |
| 停止/直接回复（不再补工具） | 0 (0.0%) | 2 (1.0%) |

注：旧拒信附带可直接复制的 `senior-tool --retry ... --reason "示例"`，导致 **89.5%（pilot-cell）与 78.1%（pilot-2）** 的拒绝在下一轮直接触发 override；同时 15.6%（22/141）与 17.1%（33/193）的 override 执行报错（主要为 `senior-override-needs-denial`：pilot-cell 15 次、pilot-2 29 次），造成二次往返。

### 1.4 Override 后实际读取字节数统计

| 指标 | pilot-cell | pilot-2 |
| :--- | ---: | ---: |
| Transcript 中 `senior-tool` 执行次数（成功 / 失败 / 触发 40 行截断） | 141 (119 / 22 / 14) | 193 (160 / 33 / 11) |
| `tool-guard.jsonl` 登记 `senior-override` 次数 | 121 | 160 |
| 全部执行返回总字节（均值 / 中位数 / p90 / 最大） | 202,939 B（1,439 / 1,073 / 3,195 / 8,424 B） | 223,446 B（1,158 / 1,052 / 2,409 / 4,062 B） |
| 成功执行返回总字节（均值 / 中位数 / p90 / 最大） | 197,399 B（1,659 / 1,284 / 3,376 / 8,424 B） | 216,631 B（1,354 / 1,264 / 2,590 / 4,062 B） |
| 主要来源 Top 3（成功次数 / 字节） | `git grep` (36 / 56,112 B)、`git show` 切片 (19 / 41,407 B)、`.project/` 过滤 (17 / 34,072 B) | `git diff` 补丁 (32 / 59,445 B)、`git show` 切片 (34 / 53,810 B)、`/tmp` scratchpad (20 / 33,590 B) |

---

## 2. 改动说明

1. **Auditor 常驻核心显式允许/禁止清单**（`daemon/sessions.mjs`、`skills/loom/SKILL.md`）：
   - 在 Auditor 启动注入的 `## Loom role guidance` 与 `skills/loom/SKILL.md` 的 Auditor 节中分别加入逐条一句、不加解释的 `Allowed actions` / `Forbidden actions`（中文 `允许：` / `禁止：`）清单，并同步更新 `seniorGuidance` 与 senior-tool 覆盖说明。
2. **工具守卫单行拒绝回执**（`lib/senior-tool-guard.mjs`）：
   - `recordSeniorToolDenial` 统一只返回单行 `禁止：<原因>；改为：<允许的替代>`（无换行、无长说明、不附带可照抄的占位理由、不泄露命令/路径文本）。
3. **Override 唯一文件与 ≤200 行硬约束**（`lib/senior-command.mjs`、`cli/senior-tool.mjs`、`daemon/senior-tools.mjs`、`daemon/supervisor.mjs`、`cli/history.mjs`）：
   - 新增 `parseOverrideFile` 与 `parseOverrideLines`（上限 200 行）；CLI 与 daemon 均强制要求单一 `--file PATH`（项目内单文件，禁目录/通配符/多文件/项目外/凭据路径）与 `--lines START-END`（超 200 行返回 `senior-override-range-exceeded`，缺失或非法返回 `senior-override-target-required` / `invalid-arguments`）。
   - `overrideCommandTargets` 交叉校验被覆盖命令本身是否越界（多文件、与 `--file` 不一致、显式要求 >200 行均拒绝），并将 `file`、`lines`、`lineCount` 写入 `tool-guard.jsonl`、`loom status` 与 `loom hist`。
4. **合理只读需求改放行并保持安全边界**（`lib/senior-tool-guard.mjs`）：
   - 引入管道感知解析 `shellPipelines`（保留 `shellCommands` 兼容导出）：允许已放行命令通过管道接 `grep`/`egrep`/`rg`（无递归且无文件参数）、`jq`（禁 `-f`/`--rawfile` 等读文件开关）、`cut`/`sort`（禁 `-o`）/`uniq`/`tr`；修复 `tail -n +N`、`2>/dev/null`、`$LOOM_PROJECT` 展开（含 `cd "$LOOM_PROJECT"`）与 `.project/` 内安全通配符；放行 `git diff-tree --stat`、`--name-only`/`--name-status`、只读 `date`、单文件 `head -N`/`tail -N`（≤200 行）以及有界单文件切片 `git show <sha>:<path> | sed -n 'a,bp'` / `head -n N`（≤200 行，禁 `..`、禁凭据路径、校验 `git -C` 在项目内）。
   - 历史回放验证：353 条历史拒绝中 **118 条（33.4%）** 直接放行（pilot-cell 55/152 = 36.2%，pilot-2 63/201 = 31.3%），其余 **235 条（66.6%）** 重型源码搜索/补丁/脚本/项目外访问继续严格拦截。
5. **`auditor calls per turn` 指标（目标 ≤ 5）**（`cli/cost.mjs`、`cli/status.mjs`、`daemon/role-budget.mjs`、`daemon/supervisor.mjs`、`cli/status-view.mjs`）：
   - `loom cost` 输出 `auditorCallsPerTurn`、`auditorCallsPerTurnTarget: 5` 以及 1h 滚动窗口 `pyramid.auditorCallsPerTurn` / `pyramid.auditorCallsPerTurnTarget`。
   - `loom status`（JSON 与文本）及 Status 页（`loom status-tui` 的 `5 Cost` 面板/详情与 `1 Board` Auditor 卡片/详情）展示 `Auditor calls/turn · <值> (target ≤ 5)`，超过 5 标示 `over target`（warn 配色）。
   - 在两套 pilot 上只读实测新指标：pilot-cell `14.48 (1h: 20.00)`，pilot-2 `6.13 (1h: 22.00)`。

---

## 3. 测试与验证（RED → GREEN）

- **既有测试断言变更对照**（`daemon/supervisor.test.mjs`）：
  - `assert.match(recordSeniorToolDenial(...), /带理由重试/)` → 改为断言无换行且匹配 `/^禁止：.+；改为：.+$/`，并新增缺 `--file`/`--lines` 拒收与 `--lines 1-201` 返回 `senior-override-range-exceeded` 的断言。
  - 原 `senior-tool` / `senior-override` 调用补齐 `--file` 与 `--lines`，同时验证缺失目标、超 200 行、多 `--file` 及目标文件与命令不匹配均被拒绝，并在 `status` 和 `hist` 验证 `file`/`lines` 落盘。
- **RED**：新增/更新 5 组测试在改动前全部失败（日志 `/tmp/loom-auditor-lean-1-red.log`）。
- **GREEN & 全量验证**：
  - `npm run lint` 通过（332 files）。
  - `npm test -- --test-concurrency=4` 全量 **899/899** 通过（fail 0、cancelled 0、skipped 0；完整日志 `/tmp/loom-auditor-lean-1-full.log`）。
  - `git diff --check` 通过。

## 4. 合并 main 与验证

- `cli/cost.mjs` 保留 main 的 `memoryExtractor`、`memoryPilot` 与恢复后首轮用量统计，同时保留本分支的 Auditor 每轮模型调用数、目标值和一小时滚动指标。
- `cli/status.mjs` 保留 main 的账号、状态页和恢复字段及统一采样时间，同时展示 Auditor 每轮调用指标和超标提示。CLI 与 Status TUI 的指标回归均通过。
- `npm ci`、`npm run lint` 与 `git diff --check` 均通过。合并 `c8717916` 后运行全量 `npm test -- --test-concurrency=4`，1097 项通过，失败、取消、跳过均为 0。 [全量日志](/private/tmp/loom-auditor-lean-merge-full.log)
- 已纳入本次验证期间 main 的后续提交，最新合并到 `1f528010`。这些上游提交只改研究文档，最终代码与已验证的合并提交 `21f0acf2` 一致。
- 2026-11-28 合并最新 `main`（`1ab84f67`，包含 `e97556ae` 的 `WORKER-REAP-2`、`1d1872a1` 的 `CCP-ROUTE-1`、`RESUME-1`、`GUARD-ARGV-1` 及 `NODE-LTS-1` 卡）：
  - `cli/status-tui.test.mjs`：保留两边新增的 Status TUI 回归用例（本分支的 `auditor calls per turn` 指标断言与 `main` 的 `release timeout count` / `printStatus` 断言）。
  - `daemon/sessions.mjs`：保留 `main` 的 CCP 无 hooks Claude 启动与 `!resumeSession` 跳过新建角色模板逻辑，同时保留本分支的 `auditorGuidance` 允许/禁止清单与 `seniorGuidance` ≤200 行单文件覆盖说明；其余自动合并文件（`cli/status-view.mjs`、`cli/status.mjs`、`daemon/supervisor.mjs`、`daemon/supervisor.test.mjs`、`skills/loom/SKILL.md`）均核对兼容。
  - 验证：`npm ci` 通过，`npm run lint` 通过（360 files），`git diff --check` 通过，全量 `npm test -- --test-concurrency=3` **1126/1126 通过，0 失败、0 取消、0 跳过**（首轮 `--test-concurrency=4` 仅 `daemon/upgrade.test.mjs` 偶发一次 `ps` 枚举竞争 `SIGKILL`，单跑 4/4 与降并发全量 1126/1126 均通过）。

STATUS: done

## 2026-11-28 merge follow-up

- Ran `git merge main` on `infra/auditor-lean`. The local `main` was `e1afe62e`, a descendant of the requested `8efd3cbb`.
- Resolved `daemon/sessions.mjs` with `main`'s split `roleCore` and `skillModules` startup flow.
- Resolved `skills/loom/SKILL.md` with `main`'s split skill index and moved the Auditor cost-reduction allowed/forbidden list into `skills/loom/roles/auditor.md`.
- Verification passed: `npm ci`, `npm run lint` (369 files), and `npm test` (1149 passed, 0 failed, 0 cancelled, 0 skipped).
- No push was performed.
