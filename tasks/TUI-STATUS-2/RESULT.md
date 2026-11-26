# TUI-STATUS-2 v1 结果

- Status TUI 使用圆角面板、页签和底部按键栏。100 列起双栏展示，窄屏纵向堆叠并保留 Accounts 与 Release。界面采用 Solars 配色，支持真彩色、256 色和 `NO_COLOR`。终端仅重绘变化行，`--once` 输出纯文本。列宽由 `string-width` 测量，截断和换行方法改编自 pi-tui v0.73.1，源码中保留 MIT 许可。[pi-tui 源码](https://github.com/earendil-works/pi/blob/v0.73.1/packages/tui/src/utils.ts)
- Board 显示 Leader、Auditor、投递状态、Worker、门禁、Super 通知、成本和发布版本。列表地址截为前八位，回车可查看完整 Herdr 标签 ID、会话 UUID、路径或门禁裁决。数字键和左右方向键切页，上下方向键选择，问号打开帮助。
- Accounts 在 Board 和 Cost 页显示。配额统一标为已用百分比，`│` 表示窗口已经过的时间比例。账号行显示掩码、计划、使用状态、最近重置倒计时、重置卡和到期日。用量达到 80% 或超前 10 个百分点标为警示，达到 95% 或超前 25 个百分点标为高风险。观测距今至少两小时，或其记录的窗口已重置时，显示过期状态。样例使用合成账号。实际面板等待 CELL-ACCT-1 按接口提供数据。[账号 JSON 契约](../../docs/ACCOUNTS-SCHEMA.md)
- 最近一小时 Leader、Auditor 和 Worker 各记录至少 3 次模型调用后，才评估金字塔倒置与资深角色工具输出占比告警。样本不足时显示中性的 `warming up`。
- `npm ci` 成功。隔离环境下 `npm test` 通过 724 项。快照覆盖 80、100、140 列和中英文、组合 emoji 及截断，交互回归覆盖 `NO_COLOR`、差量刷新和旧版本断连后连到新版本。另用独立 PTY 验证了切页、完整裁决、配额和退出。

以下为 `loom tui --once` 通过临时 fixture RPC 套接字生成的文本，采样时间固定为 2026-11-26 14:00 UTC。

## 80 列

```text
╭──────────────────────────────────────────────────────────────────────────────╮
│ Loom · 织布工程 · online                          loomd cafe1234 · 14:00:00Z │
╰──────────────────────────────────────────────────────────────────────────────╯
[1 Board]  2 Workers  3 Gates  4 Notices  5 Cost

╭─ Leader ─────────────────────────────────────────────────────────────────────╮
│ codex·GPT-5.6  [busy]                                                        │
│ Context 38% · activity 1m · 1234abcd                                         │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Auditor ────────────────────────────────────────────────────────────────────╮
│ claude·Fable  [idle]                                                         │
│ Context 52% · activity 3m · 9876dcba                                         │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Delivery ───────────────────────────────────────────────────────────────────╮
│ [queued 3]  [typed 1]  [stalled 1]  [refused 0]  [awaiting-user 0]           │
│ [oldest 7m]                                                                  │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Workers · 3 ────────────────────────────────────────────────────────────────╮
│ Task                           Wave   State         CLI     Addr      Age    │
│ 索引🧵校验与回放跨项目工作队…  W-02   busy          codex   bead0001  6m     │
│ 👩🏽‍💻 快照核对 · 中文长标题与表…  W-02   starting      agy     bead0002  12s    │
│ Delivery retries and reconne…  W-03   idle          claude  bead0003  23m    │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Gates ──────────────────────────────────────────────────────────────────────╮
│ GATE-042 · round 2 · [completed] · [PASS] · 回归用例通过 ✅                  │
│ GATE-043 · round 1 · [queued]                                                │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Super notices ──────────────────────────────────────────────────────────────╮
│ delivery-stalled · 有一条投递等待重试 🧵                                     │
│ Pyramid / tool output share warming up                                       │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Cost pyramid · 1h ──────────────────────────────────────────────────────────╮
│ warming up                                                                   │
│ auditor ▕█████████░░░░░░░░░░░▏  2100 tokens · 5 calls                        │
│ leader  ▕████████████████████▏  4600 tokens · 2 calls                        │
│ worker  ▕███████████░░░░░░░░░▏  2600 tokens · 1 calls                        │
╰──────────────────────────────────────────────────────────────────────────────╯
╭─ Accounts ───────────────────────────────────────────────────────────────────╮
│ Usage shown as used % · │ elapsed window time                                │
│ codex·Pro · c***@example.test · [in use] · next reset 2h22m                  │
│ ⟲3 reset credits · expires 2026-11-28                                        │
│   5h             ▕██████│░░░░░▏  59% used · ~ on pace · resets in 2h22m · 5h │
│   周             ▕█████░░░░░░│▏  41% used · ↓ behind · resets in 18h05m · 7d │
│                                                                              │
│ codex·Pro · d***@example.test · next reset 4d 4h · ⟲1 reset credits          │
│   周             ▕█░░░░│░░░░░░▏  12% used · ↓ behind · resets in 4d 4h · 7d  │
│                                                                              │
│ claude·Max 5x · m***@example.test · [in use] · next reset 2h59m              │
│   5h             ▕███░░│░░░░░░▏  22% used · ↓ behind · resets in 2h59m · 5h  │
│   Fable 周       ▕███████│████▏  96% used · ↑ ahead · resets in 2d 21h · 7d  │
│                                                                              │
│ agy·Google AI Ultra · a***@example.test · [in use] · next reset 3h32m        │
│   Gemini 周      ▕████░░░│░░░░▏  32% used · ↓ behind · resets in 2d 23h · 7d │
│   Gemini 5h      ▕████│███░░░░▏  66% used · ↑ ahead · resets in 3h32m · 5h   │
│   Claude/GPT 周  ▕█████████│░░▏                                              │
│     79% used · ~ on pace · resets in 1d 15h · 7d                             │
│   Claude/GPT 5h  ▕██████░░░░░░▏                                              │
│     52% used · reset due · 5h · stale · data 3h03m old                       │
│                                                                              │
│ kimi·Pro                                                                     │
│   No snapshot · R refresh                                                    │
╰──────────────────────────────────────────────────────────────────────────────╯
Release · loomd cafe1234
↑↓ select  Enter detail  h hist  g grep  m mem  r refresh  q quit  ? help
```

## 120 列

```text
╭──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Loom · 织布工程 · online                                                                  loomd cafe1234 · 14:00:00Z │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
[1 Board]  2 Workers  3 Gates  4 Notices  5 Cost

╭─ Leader ────────────────────────────────────────────────╮  ╭─ Auditor ───────────────────────────────────────────────╮
│ codex·GPT-5.6  [busy]                                   │  │ claude·Fable  [idle]                                    │
│ Context 38% · activity 1m · 1234abcd                    │  │ Context 52% · activity 3m · 9876dcba                    │
╰─────────────────────────────────────────────────────────╯  ╰─────────────────────────────────────────────────────────╯
╭─ Delivery ───────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ [queued 3]  [typed 1]  [stalled 1]  [refused 0]  [awaiting-user 0]  [oldest 7m]                                      │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
╭─ Workers · 3 ───────────────────────────────────────────╮  ╭─ Gates ─────────────────────────────────────────────────╮
│ Task             Wave  State     CLI     Addr      Age  │  │ GATE-042 · round 2 · [completed] · [PASS] · 回归用例通… │
│ 索引🧵校验与回…  W-02  busy      codex   bead0001  6m   │  │ GATE-043 · round 1 · [queued]                           │
│ 👩🏽‍💻 快照核对 · …  W-02  starting  agy     bead0002  12s  │  ╰─────────────────────────────────────────────────────────╯
│ Delivery retri…  W-03  idle      claude  bead0003  23m  │
╰─────────────────────────────────────────────────────────╯
╭─ Super notices ─────────────────────────────────────────╮  ╭─ Cost pyramid · 1h ─────────────────────────────────────╮
│ delivery-stalled · 有一条投递等待重试 🧵                │  │ warming up                                              │
│ Pyramid / tool output share warming up                  │  │ auditor ▕█████████░░░░░░░░░░░▏  2100 tokens · 5 calls   │
╰─────────────────────────────────────────────────────────╯  │ leader  ▕████████████████████▏  4600 tokens · 2 calls   │
                                                             │ worker  ▕███████████░░░░░░░░░▏  2600 tokens · 1 calls   │
                                                             ╰─────────────────────────────────────────────────────────╯
╭─ Accounts ───────────────────────────────────────────────────────────────────────────────────────────────────────────╮
│ Usage shown as used % · │ elapsed window time                                                                        │
│ codex·Pro · c***@example.test · [in use] · next reset 2h22m · ⟲3 reset credits · expires 2026-11-28                  │
│   5h             ▕████████│░░░░░░░▏  59% used · ~ on pace · resets in 2h22m · 5h                                     │
│   周             ▕███████░░░░░░░│░▏  41% used · ↓ behind · resets in 18h05m · 7d                                     │
│                                                                                                                      │
│ codex·Pro · d***@example.test · next reset 4d 4h · ⟲1 reset credits                                                  │
│   周             ▕██░░░░│░░░░░░░░░▏  12% used · ↓ behind · resets in 4d 4h · 7d                                      │
│                                                                                                                      │
│ claude·Max 5x · m***@example.test · [in use] · next reset 2h59m                                                      │
│   5h             ▕████░░│░░░░░░░░░▏  22% used · ↓ behind · resets in 2h59m · 5h                                      │
│   Fable 周       ▕█████████│█████░▏  96% used · ↑ ahead · resets in 2d 21h · 7d                                      │
│                                                                                                                      │
│ agy·Google AI Ultra · a***@example.test · [in use] · next reset 3h32m                                                │
│   Gemini 周      ▕█████░░░░│░░░░░░▏  32% used · ↓ behind · resets in 2d 23h · 7d                                     │
│   Gemini 5h      ▕█████│█████░░░░░▏  66% used · ↑ ahead · resets in 3h32m · 5h                                       │
│   Claude/GPT 周  ▕████████████│░░░▏  79% used · ~ on pace · resets in 1d 15h · 7d                                    │
│   Claude/GPT 5h  ▕████████░░░░░░░░▏  52% used · reset due · 5h · stale · data 3h03m old                              │
│                                                                                                                      │
│ kimi·Pro                                                                                                             │
│   No snapshot · R refresh                                                                                            │
╰──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────╯
Release · loomd cafe1234
↑↓ select  Enter detail  h hist  g grep  m mem  r refresh  q quit  ? help
```

## v1.1

- 基于 `main` 的 `cf865965` 更新。Leader、Auditor 和 Worker 的短地址显示 UUID 的前八位十六进制字符，回车仍可查看完整地址。
- Workers 和 Gates 按本屏内容的显示宽度分配列宽。Wave、Addr 和 Gate 优先获得空间，任务名与裁决摘要随空间伸缩。较窄的屏幕上仍可在详情里查看完整字段。
- Context 使用最近一次原生模型调用的输入 token，含缓存读写，优先使用运行时或原生记录报告的模型窗口。Gemini 4 Neon 和 Claude Sonnet 5.5 在缺少实际窗口时按公布容量估算，界面用 `≈` 标记。只知道用量时显示 token 数。采样复用 loomd 已缓存的历史读取，换班预算继续使用项目策略阈值。[Antigravity 模型窗口](https://antigravity.google/docs/models#gemini-4-neon) [Claude Code 模型窗口](https://code.claude.com/docs/en/model-config#1m-context-window)
- Super 通知按时间从新到旧排列并标注相对时间。普通成功投递回执只计数，失败回执仍可见。先过滤常规回执再截取最近八条，避免回执挤掉待处理事项。
- 隔离环境下 `npm test` 通过 727 项。更新了 80、100、140 列快照，并通过临时 fixture 套接字在 120 列验证实际 `loom tui --once`。回归覆盖带前缀 UUID、完整 Wave 和 Gate ID、实测与估算上下文、回执过滤、时间排序及重连。

STATUS: done
