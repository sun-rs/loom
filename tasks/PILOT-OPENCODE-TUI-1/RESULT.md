# PILOT-OPENCODE-TUI-1 实测结果（W3 · agy worker）

状态：**DONE**（4 项真实 OpenCode TUI 实测全部通过并留存脱敏原生对账证据，临时会话与 `hc` 窗格已彻底清理；`node --test adapters/opencode/adapter.test.mjs` 全绿）。

## 测试环境与参数

- CLI：`/opt/homebrew/bin/opencode`（`opencode v2.3.0`，绝对路径调用，未读取任何凭据或配置）
- 模型：`deepseek/deepseek-flash`
- 终端宿主：`hc 0.1.22` + `loom-pty`（`runtimes/tui/transport.mjs` `openNativeTui` + `daemon/tui.mjs` `refreshOpenCode`）
- 实测脚本：`tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs`
- 脱敏原生对账日志：`tasks/PILOT-OPENCODE-TUI-1/evidence.json`

## 4 项实测结果

| 实测项 | 结果 | 关键原生证据 |
| :--- | :--- | :--- |
| 1. 冷启动 | PASS | `elapsedMs: 4856`, `transport: "loom-pty"`, `phase: "idle"`, `source: "hook"`, `screenKind: "idle"`, `empty: true`, `draft: ""`, `nativePhase: "idle"`, `ready: true` |
| 2. 5 条排队投递 | PASS | 5 条独立 `deliveryId` 连续投递并通过 `opencode session export --standalone` 核对：0 丢失、0 重复，5 条均 `count: 1`，原生回复 `["Q1","Q2","Q3","Q4","Q5"]` |
| 3. 一次中断续作 | PASS | 生成中触发双击 `esc`（按 OpenCode v2.3.0 `Press esc again to interrupt` 机制），原生导出确认 `outcome: "interrupted"`（`nativeInterruptionCount: 1`，第 6 轮 `status: "interrupted"`）；同会话/窗格恢复 `ready: true` 后续作第 7 轮获原生确认（回复 `"RESUMED_OK"`） |
| 4. 人工草稿不被覆盖 | PASS | 输入人工草稿 `"human draft"` 并保持 `1100ms`（>800ms 保护窗）后触发 `host.submit`，返回 `{"kind":"refused","code":"composer-not-proven-empty"}`，原草稿保持完整且未泄漏到原生导出；清除草稿并等待保护窗结束后恢复投递并获原生确认（回复 `"DRAFT_OK"`） |

清理核验：`hc ls --json` 确认临时 `hc` 窗格（`t3d1`）及隔离临时目录均已清理（`remainingMatchingPanes: 0`）。

## 最小修复（可写范围内，净增 +10 行：产品 +5 / 测试 +5）

1. `adapters/opencode/index.mjs`（+4 行）：
   - `launch()`：未传 `effort` 时不再拼出 `model#undefined`，改为 `effort ? `${model}#${effort}` : model`。
   - `classify()`：适配 OpenCode v2.3.0 实际页脚（`· ctrl+p menu`，不再硬编码 `· OpenCode ·`），并识别运行中/待二次确认中断页脚（`esc interrupt ·` / `Press esc again to interrupt` → `'busy'`）。
   - `miniDraft()`：适配实际页脚，且空输入占位符 `Ask anything, / for commands, @ for context…` 归一化为 `''`，使 `loom-pty` 正确判定空输入框。
   - `hooks.normalize()`：`is_interrupt: true` 归类为 `'turn-end'`（避免 `hookObservation` 误判为 `'error'` 导致中断后无法恢复 `idle`）；`input.plan('interrupt')` 更新为双击 `esc`。
2. `daemon/tui.mjs`（+1 行）：
   - `refreshOpenCode()` 通过 `absoluteCommand('opencode', 'opencode')` 解析绝对路径，不再依赖 `PATH`。
3. `adapters/opencode/adapter.test.mjs`（+5 行）：
   - 补充 DeepSeek 页脚 `classify`（`idle`/`busy`）、占位符 `miniDraft`、无 `effort` 的 `launch` 参数、以及 `is_interrupt` 归一化断言。

## 遗留与超范围设计缺口（未改范围外文件）

- `host.interrupt()` 对 OpenCode 仍返回 `{"kind":"refused","code":"not-interruptible"}`：根因在可写范围外的三处代码——`tui/providers.mjs:154` 将 `hasEmptyComposer` 定义为 `classify(text) === 'idle'`（与 `tui/index.mjs:208` 要求 `screen.kind === 'busy' && screen.empty` 互斥），`tui/index.mjs:213` 仅发送单次 `esc`（OpenCode v2.3.0 需两次 `esc`），且 `daemon/sessions.mjs:196` 显式屏蔽了 `opencode` TUI 中断（`binding.provider !== 'opencode'`）。本卡未触碰上述范围外文件，实测第 3 项已记录 `host.interrupt()` 拒绝回执，并通过 `hc keys escape` x2 验证了 OpenCode 原生中断确认与同窗格续作。

## 验收命令结果

- `node --test adapters/opencode/adapter.test.mjs`：PASS（1/1）
- `node tasks/PILOT-OPENCODE-TUI-1/verify-opencode-tui.mjs`：PASS（4/4 + 清理通过）
