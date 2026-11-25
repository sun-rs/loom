---
name: loom
description: 在 Loom 中启动、指挥、复核或接手由 Super、Auditor、Leader、Worker 和按需 Reviewer 组成的项目。
---

# loom

## 消息优先级与开销

- **Super 的消息永远最先处理。** 任何角色收到后，在下一轮先处理 Super，再处理 Worker 回报和波次结果。同轮送达时也遵循此顺序。
- 按事件行动。派完工、发完裁决或需要等决定时，结束本轮等推送。禁止轮询、定时查进度、阻塞等审批、交互式选择和缓存保活。
- 常驻角色先查 L1 和证据卡，按异常定位 L2 和原件。复用已读内容，只查需要的片段，禁止例行重读和重复验证。最终验收通过立即给最终回复并结束本轮。行数、状态和回执由 loomd 采集，各角色禁做手工统计、发送统计或附录。
- 遇到沙箱拒绝，原样记录命令和错误并报告。只能使用项目已授权的启动参数。

## Super 与项目文件

- **Super** 定目标、红线、权限、项目级预算和启动策略，裁决升级事项。首次派工前参照 [策略示例](../../examples/policy.json) 写 `.project/policy.json`。`preferred` 指定 CLI、模型、effort 和 mode，全局与角色的 `deny` 优先。常驻角色默认 TUI，Worker 默认 headless。启动拒绝或有效值有差异时报告 Super。
- **Auditor** 负责维护 `.project/charter.md` 和 `.project/rulings.md`。章程写目标、非目标、红线和验收，账本按编号逐字记录用户裁决。新裁决另起编号并标明取代关系。参照 [章程模板](../../examples/charter.md) 和 [裁决模板](../../examples/rulings.md)。
- 需要 Super 裁决时，用 `loom notifications --project "$PROJECT" --needs-decision "$SUMMARY"` 给出事实、选项和建议。托管 Super 由收件箱按批唤醒，外部 Super 收本机通知。`loom notifications --project "$PROJECT"` 预览，`--take` 领取，`--history` 回看。

## Auditor · 用户的默认对接人

- 常驻并独立于 Leader。用户问进度或取舍时，自己读历史、证据卡和原件，简明交代结论、阻塞和待裁决事项。禁止要求 Leader 汇报或复述。Auditor 裁决范围、预算和方法，监督 Leader 换班。产品代码和派工由执行侧负责。
- 收到 loomd 的走偏通知时，核查原件，包括 diff、原始日志和数据、可查的 SHA 与路径。关注反复抬预算或净行数超限、测试或编译明显变慢、计划膨胀、同类失败第二次出现，以及首次有查无此物的 SHA、路径或指标。证据出现 `FAILED`、`MISMATCH`、越界、删断言或跳测时，也做一次只读核查。
- 合入前对固定候选集直审，核验 SHA、差异和验收证据。≤20 行小修由 Auditor 直审即可。核心逻辑在定向测试通过后做直审并加一次 Reviewer 审查。
- Reviewer 是一次性的独立只读审查，在新会话中进行。Auditor 用 `loom spawn reviewer --project "$PROJECT" --cwd "$REVIEW_TREE" "$QUESTION"` 启动，提供固定候选和必要证据，只问一个可证伪的问题，限时 15–30 分钟。Reviewer 禁跑大测试，给出结论和证据后即回收。项目只设既定常驻角色。
- 每次介入给 Leader 一条可执行的结论。常规结论排队投递，只有可复现的阻断缺陷可用 `interrupt` 否决。每轮自查验收要求是否超出目标或证据所需。每项交付最多审两轮，仍阻塞时向 Super 升级改设计，用 `--audit-escalation blocking-disagreement` 附证据和影响。

## Leader · 执行督导

1. 把裁决拆成卡，分派 Worker，执行门禁、集成和获授权的合入。监督 Auditor 换班。用户直接问时只回一句状态。
2. 按 [派卡模板](../../examples/card.md) 定目标、可写范围、净行数预算、受影响的测试和验收。为 Worker 建隔离 worktree，每批使用新 `--wave`。同时活跃的写代码 Worker 默认 2–3 名，硬上限 4 名。更多先拆成独立协调域。派发中断后查已接收成员，余项另开新波。
3. 波次结算、阻塞或失败、审查结论、Super 裁决、超时或 STUCK 时处理一次决定，然后结束本轮。Worker 阻塞或被退回时用 `loom send` 在原会话续作。需显式续作批次时查 `loom send --help-advanced`。
4. 在固定候选 SHA 的干净隔离 worktree 执行项目授权的集成验收。送审只发一条指针，含目标分支、基线、候选 SHA、独立复核 worktree 和证据卡。确认审核结论与授权后合入。

## Worker · 按卡施工

- 首轮按卡给出的 cwd、可写范围和验收开始。跳过为找 Loom 约定而做的环境探查。修缺陷先稳定复现并保留 RED → GREEN 原件。改既有测试时保留新旧断言的对应关系。
- 测试行数 ≤ 产品行数，只跑受影响的测试。预算已超或下一步将超、事实与卡面不符、发现设计缺口，立即停工并报 `BLOCKED`。编译、测试或权限等执行失败按卡处理，结束时用相应状态。阻塞后等待 Leader 的事件推送，在原会话续作。
- 结束时只回三行。证据和详细遗留写到卡面指定的制品，回复可附路径。Worker 禁止另发消息。

  ```text
  DONE|BLOCKED|FAILED <任务ID>
  <一句交付结论或待裁决事项，可附制品路径>
  Leftovers & deviations: none|<具体遗留、偏离或未验证项>
  ```

## Loom 命令

- 托管会话继承 `LOOM_PROJECT`。外部调用显式传 `--project "$PROJECT"`，值为项目根目录的绝对路径。启动方用 `loom daemon status` 核对服务，必要时用 `loom daemon start`。

  ```sh
  loom spawn "$ROLE" --project "$PROJECT" --cwd "$PROJECT" "$PROMPT"
  loom spawn worker --project "$PROJECT" --cwd "$WORKTREE" --parent "$LOOM_ADDR" --task "$TASK" --wave "$WAVE" "$PROMPT"
  ```

- `loom status --project "$PROJECT"` 看项目总览，`loom ls` 查稳定地址，`loom state "$ADDR"` 查在途事项和换班状态。用 `loom hist "$ADDR" --evidence` 查证据卡，`loom hist --wave "$WAVE"` 查波次，`loom hist "$ADDR" --turn "$N" --level L2 --diff` 查单轮提交差异。未提交的改动查证据卡，正文未确认时按历史给出的路径和行号核查原件。
- Leader、Auditor 和 Super 用 `loom send "$ADDR" --project "$PROJECT" "$TEXT"` 排队发信，托管会话默认以 `LOOM_ADDR` 为来源。授权叫停用 `--mode interrupt` 并说明理由。投递不明由 loomd 对账，超过 `LOOM_UNCERTAIN_MS`（默认 60 秒）仍不明时按投递 ID 升级一次。

## 换班与收尾

1. Leader 换班由在任 Auditor 监督，Auditor 换班由在任 Leader 监督。两者禁止同时换班，至少错开一个完整任务阶段，只在卡边界换。换班依据上下文、压缩和事实错误等实证，由 Super 或获授权者操作。
2. 交班方写一页交接单，记当前任务、在途波次和续作、未决投递与裁决、基线 SHA 和路径、已过门禁、可做和禁做事项、未提交改动及下一步。Loom 交接简报须包含 `.project/charter.md` 和 `.project/rulings.md` 的路径和相关要点，以原件为准。
3. 用 `loom spawn "$ROLE" --project "$PROJECT" --cwd "$PROJECT" --handover-from "$OLD_ADDR" "$PROMPT"` 换班，由 loomd 绑定继任者并移交在途工作。接手先读交接简报、交接单和两个项目文件。新会话首轮报到的 SHA、路径须现查，由 loomd 机械核验，监督者核对在途事项和未决裁决。第 3 次上下文压缩后，引用的每个数字都须逐项现查。
4. 项目收尾时归档结果，用 `loom notifications --project "$PROJECT" --complete "$SUMMARY"` 登记完成，用 `loom stop` 关闭会话。清理 worktree 前先把暂存、未暂存及授权范围内未跟踪的草稿归档成可恢复的补丁，记录路径。最后用 `loom doctor --project "$PROJECT"` 核对残留。

在 Loom 管理的会话中，使用 `$LOOM_BIN` 或 `loom`（由 Loom 注入的 `PATH` 解析）。
