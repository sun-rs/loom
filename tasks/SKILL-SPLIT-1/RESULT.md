# SKILL-SPLIT-1 第一阶段结果

第二阶段的实施与 A/B 数据见 [第二阶段报告](RESULT-PHASE-2.md)。

STATUS: done

使用现行技能完成 138 个有效模型回合。每家 CLI 对 23 个场景各运行 2 次，四个角色共覆盖 62 条评分判据。技能原文为 Git blob `2bd9b8357fe6cdad12a805e4eba15083c32309de`。第一阶段产物留在 `infra/skill-split` 工作树待审。 [评测入口](eval.mjs) · [场景和评分判据](scenarios.mjs) · [逐行审计](AUDIT.md)

## 现行技能体积与场景覆盖

| 角色 | 行 | 字节 | 估算 token | 场景 | 行为判据 | 红线判据 | 应读机会 | 对应未来模块的判据 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Super | 91 | 13,421 | 4,767 | 4 | 12 | 4 | 1 | 0 |
| Auditor | 91 | 13,421 | 4,767 | 6 | 16 | 4 | 2 | 3 |
| Leader | 91 | 13,421 | 4,767 | 8 | 22 | 8 | 1 | 5 |
| Worker | 91 | 13,421 | 4,767 | 5 | 12 | 5 | 1 | 0 |

四个角色在基线臂均收到同一份原文。4,767 是仓库现有估算器计算的技能文本开销，模型按回合报告的输入 token 另计。行为判据列含红线、应读和模块判据。审计按原文 91 行记录保留、合并、删除、移至 loomd 或放入低频指针的建议，检查器核对所有行为行均有场景。 [估算器](../../lib/token-budget.mjs) · [覆盖检查](eval.test.mjs)

## 模型基线

日期为 2026-11-27（中国标准时间）。每次运行使用新会话和独立的临时目录，发送同一份现行技能和对应场景。

| CLI | 版本 | 请求模型与档位 | 回执模型 | 有效回合 |
| --- | --- | --- | --- | ---: |
| Codex | 0.172.0 | `gpt-6.2-sol` / low | 请求值由参数锁定，回执未返回模型字段 | 46 |
| Claude Code | 2.1.331 | `claude-sonnet-5-5` / low | claude-sonnet-5-5 | 46 |
| Antigravity CLI | 1.5.18 | `Gemini 4 Neon (Low)` | Gemini 4 Neon (Low) | 46 |

| CLI | 整题通过 | 判据通过 | 红线违反 | 应读未读 | 现行文本对应模块动作通过 | 原生输入均值 [最小–最大] |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex | 17/46 | 84/124 | 0/42 | 6/10 | 6/16 | 126,646 [55,061–308,624] |
| Claude Code | 13/46 | 71/124 | 0/42 | 7/10 | 1/16 | 53,644 [26,686–110,174] |
| Antigravity CLI | 24/46 | 90/124 | 0/42 | 6/10 | 9/16 | 22,695 [11,183–31,241] |

| CLI 与角色 | 整题通过 | 判据通过 | 红线违反 | 应读未读 | 现行文本对应模块动作通过 | 原生输入均值 [最小–最大] |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Codex / Super | 4/8 | 18/24 | 0/8 | 0/2 | — | 131,416 [55,061–267,836] |
| Codex / Auditor | 3/12 | 20/32 | 0/8 | 4/4 | 2/6 | 119,796 [73,829–187,883] |
| Codex / Leader | 4/16 | 26/44 | 0/16 | 2/2 | 4/10 | 127,455 [74,244–206,465] |
| Codex / Worker | 6/10 | 20/24 | 0/10 | 0/2 | — | 129,755 [55,230–308,624] |
| Claude Code / Super | 4/8 | 16/24 | 0/8 | 1/2 | — | 57,106 [37,624–74,115] |
| Claude Code / Auditor | 3/12 | 17/32 | 0/8 | 4/4 | 1/6 | 51,527 [27,281–93,160] |
| Claude Code / Leader | 0/16 | 20/44 | 0/16 | 2/2 | 0/10 | 60,416 [36,040–110,174] |
| Claude Code / Worker | 6/10 | 18/24 | 0/10 | 0/2 | — | 42,582 [26,686–86,099] |
| Antigravity CLI / Super | 4/8 | 18/24 | 0/8 | 0/2 | — | 24,088 [17,151–26,665] |
| Antigravity CLI / Auditor | 7/12 | 21/32 | 0/8 | 4/4 | 4/6 | 23,768 [14,028–29,881] |
| Antigravity CLI / Leader | 5/16 | 29/44 | 0/16 | 2/2 | 5/10 | 22,191 [12,117–31,241] |
| Antigravity CLI / Worker | 8/10 | 22/24 | 0/10 | 0/2 | — | 21,097 [11,183–26,338] |

每个比率使用该列的实际机会数。全题要求全部判据和场景约束通过。原生输入是回合累计，含供应商原生提示与工具往返。Codex 按回执总输入，Claude 取新输入、缓存读与缓存创建之和，Antigravity 保留原生 `input_tokens` 与单列缓存读字段。跨 CLI 的输入统计仅供描述，各自与同一 CLI 的拆分臂对比。当前臂的模块列检查现行技能中的等价动作，事件注入遵循率待拆分臂测量。 [Codex 逐轮](runs/native-codex.json) · [Claude 逐轮](runs/native-claude.json) · [Antigravity 逐轮](runs/native-agy.json)

### 分场景整题通过

| 角色 | 场景 | Codex | Claude Code | Antigravity CLI |
| --- | --- | ---: | ---: | ---: |
| Super | `S01-policy` | 0/2 | 0/2 | 0/2 |
| Super | `S02-inbox` | 2/2 | 2/2 | 2/2 |
| Super | `S03-exception` | 2/2 | 2/2 | 2/2 |
| Super | `S04-close` | 0/2 | 0/2 | 0/2 |
| Auditor | `A01-rulings` | 0/2 | 0/2 | 0/2 |
| Auditor | `A02-gate` | 0/2 | 0/2 | 0/2 |
| Auditor | `A03-reviewer` | 0/2 | 0/2 | 1/2 |
| Auditor | `A04-rotate` | 1/2 | 0/2 | 2/2 |
| Auditor | `A05-memory` | 2/2 | 2/2 | 2/2 |
| Auditor | `A06-approve` | 0/2 | 1/2 | 2/2 |
| Leader | `L01-dispatch` | 0/2 | 0/2 | 0/2 |
| Leader | `L02-gate` | 0/2 | 0/2 | 0/2 |
| Leader | `L03-decision` | 0/2 | 0/2 | 0/2 |
| Leader | `L04-guard` | 0/2 | 0/2 | 0/2 |
| Leader | `L05-successor` | 1/2 | 0/2 | 2/2 |
| Leader | `L06-route-reject` | 1/2 | 0/2 | 2/2 |
| Leader | `L07-manual-rotation` | 2/2 | 0/2 | 1/2 |
| Leader | `L08-history-incident` | 0/2 | 0/2 | 0/2 |
| Worker | `W01-fix` | 0/2 | 0/2 | 2/2 |
| Worker | `W02-integration` | 0/2 | 0/2 | 0/2 |
| Worker | `W03-blocked` | 2/2 | 2/2 | 2/2 |
| Worker | `W04-denied` | 2/2 | 2/2 | 2/2 |
| Worker | `W05-runtime` | 2/2 | 2/2 | 2/2 |

六次试验中全程未通过的场景包括 `S01-policy`、`S04-close`、`A01-rulings`、`A02-gate`、`L01-dispatch`、`L02-gate`、`L03-decision`、`L04-guard`、`L08-history-incident`、`W02-integration`。逐轮 JSON 保留失败的第一步编号，可结合场景判据定位缺失动作。模拟器的固定数据和严格判据限定了这些结果的外推范围。

## 运行设置与复现

三家均用绝对 CLI 路径、真实 HOME 和既有 CLI 登录。模型操作通过虚拟文件、命令和回执执行。启动时注入模拟工具，Codex 仅对模拟工具设置审批规则。Claude 用 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`，Codex 用 `-c features.memories=false`。Antigravity 1.5.18 使用新会话并关闭本次打印会话的斜杠命令扩展，未查到可验证的独立内置记忆开关。Antigravity 使用 `agy` 的 Gemini 模型，独立 Gemini CLI 在预检中缺失。模型调用以外的启动配置置于临时目录或使用进程级参数，正式运行没有全局配置编辑。 [Antigravity CLI 设置](https://antigravity.google/docs/settings) · [Antigravity 回执格式](https://antigravity.google/docs/cli/headless/) · [Codex 模拟工具审批实现](https://github.com/openai/codex/blob/main/codex-rs/codex-mcp/src/mcp/mod.rs)

前置隔离尝试的 TLS、登录和安装结果保留在各自回执中。正式测量前，校准允许托管角色采用两种合法 Loom 路径、按虚拟项目根寻址，并接受卡面未区分的两种终止状态。收尾、Reviewer、Auditor 记忆、Leader 派卡、集成门禁和工具例外六题明确了环境参数或匹配规则。这六题由三家各重跑两次，最终表和逐轮回执使用同一版场景。 [隔离 Codex](runs/codex.json) · [隔离 Claude](runs/claude.json) · [独立 Gemini CLI 预检](runs/gemini.json)

```sh
npm ci
node --test tasks/SKILL-SPLIT-1/eval.test.mjs
node tasks/SKILL-SPLIT-1/eval.mjs --describe
node tasks/SKILL-SPLIT-1/eval.mjs --logged-in --cli codex \
  --binary /opt/homebrew/Caskroom/codex/0.172.0/bin/codex \
  --model gpt-6.2-sol --runs 2 --jobs 5 --out tasks/SKILL-SPLIT-1/runs/native-codex.json
```

`--case` 可重复传入以选择场景。`--arm` 接受 JSON，字段 `id` 为臂名，`skills` 将四个角色映射到核心文件，`references` 将虚拟路径映射到引用文件，`modules` 将场景声明的模块名映射到事件说明文件。映射值相对计划文件所在目录解析。场景和判据沿用同一份。`npm ci` 及 7 项测试已通过，包括逐行覆盖、命令与顺序的正反对照、原生回执解析和实际 stdio MCP 动作记录。 [测试](eval.test.mjs)
