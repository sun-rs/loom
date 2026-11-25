---
name: loom
description: 在 Loom 中启动、指挥、复核或接手由 Super、Leader、Auditor 和 Worker 组成的项目。
---

# loom

## 角色与节奏

- **Super** 定目标、权限、预算、项目启动策略和升级条件。**Leader** 负责拆卡、派工、集成和获授权后的合入。**Auditor** 与 Leader 平级并独立复核。**Worker** 按任务卡执行。
- Super、Leader 和 Auditor 按事件行动。派完工、发完信或需要等决定时，结束本轮等推送。禁止轮询、定时查进度、等审批或用交互式选择器。范围或架构需裁决时，用 `loom notifications --project "$PROJECT" --needs-decision "$SUMMARY"` 写明事实、选项和推荐。
- 遇到沙箱拒绝，原样记录命令和错误并报告，禁止自行绕开。可使用项目已授权的启动参数。

## 控制请求开销

- Worker 首轮提示带有任务卡约定，按卡面给定的 cwd、可写范围和验收开始。跳过开局环境探查和为寻找 Loom 约定而检索 AGENTS.md 或 skill。
- 已读文件只在需要时看相关片段。先过滤大文件和长日志。常驻角色先查 L1 和证据卡，按异常定位 L2 片段。
- 最终验收通过后直接给最终回复并结束本轮。额外的 git status、diff、重读或重跑只在卡面验收要求时执行。行数、状态回报和回执由 loomd 采集，角色无需手工统计、发送或附录。

## 启动与查询

- 托管会话默认继承 `LOOM_PROJECT`。外部调用所有命令都传 `--project "$PROJECT"`，值为项目根目录绝对路径。启动方用 `loom daemon status --project "$PROJECT"` 核对服务，必要时执行 `loom daemon start --project "$PROJECT"`。
- Super 首次派工前参照 [examples/policy.json](../../examples/policy.json) 写项目根的 `.project/policy.json`。`preferred` 设置 CLI、模型、effort 和 mode，全局与角色 `deny` 优先。常驻角色默认 TUI，Worker 默认 headless。保持 `keepAlive: false`。启动拒绝或有效值有差异时报告 Super。

```sh
loom spawn "$ROLE" --project "$PROJECT" --cwd "$PROJECT" "$PROMPT"
loom spawn worker --project "$PROJECT" --cwd "$WORKTREE" --parent "$LOOM_ADDR" --task "$TASK" --wave "$WAVE" "$PROMPT"
```

- `loom ls --project "$PROJECT"` 列出稳定地址、待处理续作和投递。 `loom state "$ADDR" --project "$PROJECT"` 查某会话的在途事项、活动状态、上下文和轮数。
- `loom hist "$ADDR" --project "$PROJECT" --evidence` 查证据卡，`loom hist "$ADDR" --project "$PROJECT" --turn "$N" --level L2 --diff` 查单轮提交差异，`loom hist --project "$PROJECT" --wave "$WAVE"` 查成员和去向。Worker 未提交时，改动见证据卡，轮次提交差异可能为空。正文未确认时，按历史给出的原件路径和行号查看并注明。

## 发信

- Leader、Auditor 和 Super 用 `loom send "$ADDR" --project "$PROJECT" "$TEXT"` 排队发信。托管会话默认以 `LOOM_ADDR` 为来源。外部调用方可在必要时用 `--wait` 读一次回复。
- 需要叫停活动轮时，授权角色用 `loom send "$ADDR" --project "$PROJECT" --mode interrupt "$TEXT"` 写明理由。投递不明时由 loomd 对账，超过 `LOOM_UNCERTAIN_MS`（默认 60 秒）仍不明则按投递 ID 升级一次。保留已受理的请求，等待对账结果。

## Super

- 裁决请求、Leader 异常退出、合并后的 BLOCKED、波次或续作超时、投递不明和项目完成会入项目通知日志。托管 Super 每批由收件箱唤醒一次，外部 Super 收本机 macOS 系统通知。 `loom notifications --project "$PROJECT"` 默认预览。Super 确认后用 `--take` 领取，`--history` 可回看已领取事件。
- 根据上下文占用、压缩次数和轮数等原始信号决定换班。Leader 已退出且有接管授权时，Auditor 方可接任指挥。

## Leader

1. 拆卡写明任务 ID、cwd、可写范围、红线、基线、验收命令、提交权限和回报格式。为 Worker 建隔离 worktree。未提交草稿先归档成补丁到授权路径，包含暂存、未暂存和授权范围内的未跟踪改动。确认归档可恢复，在结果或交接中记录路径，再清理工作树。
2. 只因波次结算、阻塞或失败、审计结论、Super 裁决、超时或 STUCK 等事件唤醒。每次唤醒做一个决定，执行后结束本轮。每批用一个新 `--wave`。默认同时最多 3 名活跃 Worker，仅当各卡可独立验收且文件所有权互斥时由 Super 将策略提高至最多 5 名。派发中断后先查成员，余项另开新波。
3. 对照原生回报和证据卡推进依赖。Worker 阻塞或被退回时，用 `loom send` 在原会话续作。默认合并在途回报，需要固定人数时用 `loom send --help-advanced` 查显式批次。续作采用波次的超时和 BLOCKED 合并规则，在途项目见 `ls` 和 `state`。
4. 在固定候选 SHA 的干净隔离 worktree 用 Super 授权的权限执行整体验证。送审只给一条证据指针，包含目标分支、基线、候选 SHA、独立复核 worktree 和证据卡。确认独立结论与合入授权后再合入。

## Auditor

- 默认静默、只读历史和证据，绝不要求 Leader 汇报。合入前按候选集独立复核一次，核对固定 SHA、差异和验收证据。出现 `FAILED`、`MISMATCH`、保护路径越界、删断言或跳测等红色事实时，做一次只读核查。
- 每次介入只发一条汇总结论，常规结论排队给 Leader。只有可复现的阻断缺陷才用 `interrupt` 否决。每个交付最多两轮审计，第二轮仍有阻断便请 Super 裁决重设计，用 `loom notifications --project "$PROJECT" --needs-decision "$SUMMARY" --audit-escalation blocking-disagreement` 附证据和影响。

## Worker

- 按卡执行。修缺陷先稳定复现，保留 RED → GREEN 的原始结果。改动既有测试时列出旧断言和新断言的对应关系。
- 最后一次验收完成后直接回复。通常只写三行，机械证据由 loomd 收集。

  ```text
  DONE|BLOCKED|FAILED <任务ID>
  <一句结论，写明交付或卡住的决定，必要时附制品路径>
  Leftovers & deviations: none|<列出具体遗留和偏离>
  ```

  有相关情况时各加一行，说明设计取舍、旧断言为何修改及新断言如何覆盖原行为、未验证的内容与原因。
- 阻塞时在最终回复写明尚缺的决定或权限，然后结束本轮。Leader 排队答复后，在原会话接着做。

## 换班与收尾

1. 交班方在授权路径写交接，记录当前任务、在途波次和续作、未决投递、未提交改动、基线和下一步。
2. Super 或获授权的换班操作方执行 `loom spawn "$ROLE" --project "$PROJECT" --cwd "$PROJECT" --handover-from "$OLD_ADDR" "$PROMPT"`。新会话首轮包含前任简报，loomd 绑定新会话后移交在途工作并停止旧会话。接手或压缩后先读简报和交接。
3. 收尾时归档结果，用 `loom notifications --project "$PROJECT" --complete "$SUMMARY"` 登记完成。用 `loom stop` 关闭项目会话。Leader 清理工作树，运行 `loom doctor --project "$PROJECT"` 核对残留。
