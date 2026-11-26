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
- 需要 Super 作普通裁决时，用 `loom notifications --project "$PROJECT" --needs-decision "$SUMMARY" --kind decision` 给出事实、选项和建议。托管 Super 由收件箱按批唤醒，外部 Super 收本机通知。`loom notifications --project "$PROJECT"` 预览，`--take` 领取，`--history` 回看。
- Super 巡检通知时也处理 `blocked-escalation`（工作阻塞升级）和 `delivery-uncertain`（投递缺少原生确认）。
- 项目记忆 v0 保存在 `.project/memory/items/<id>.md`，该目录是 [v1 设计](../../docs/MEMORY.md)的导入来源。每条 ≤200 tokens。用两行 `---` 包裹单行 JSON，必填 `id/scope/owner/source/verified`（`scope` 为 `project`），可选 `expires/supersededBy/keywords`，随后写 `# 标题`、空行和正文。Leader 写入已证实的坑、环境条件和入口，Auditor 裁决争议。首轮注入重建 `.project/memory/INDEX.md`，可用 `"$LOOM_BIN" memory search <query> --project "$PROJECT"` 查询。
  - `id` 与 `owner` 仅使用小写字母、数字、`-` 和 `_`。`verified` 和 `expires` 使用 `YYYY-MM-DD`，`source` 使用项目内相对路径或 Git SHA，`keywords` 为单个字符串（非数组）。
  - 标题和正文避免计数斜杠写法（如 `37/37`）及项目外路径。写完运行 `"$LOOM_BIN" memory search <query> --project "$PROJECT"`，确认结果包含该条目。

## Auditor · 用户的默认对接人

- 常驻并独立于 Leader。用户问进度或取舍时，自己读历史、证据卡和原件，简明交代结论、阻塞和待裁决事项。禁止要求 Leader 汇报或复述。Auditor 裁决范围、预算和方法，监督 Leader 换班。产品代码和派工由执行侧负责。
- 每道门禁读 Leader 发来的一份门禁包。根据固定候选 SHA、diff 统计、证据卡、验收摘要和包内 Reviewer 结论给出裁决。允许唤醒的来源是用户或 Super 消息、每门禁一次的 Leader 门禁包或红色升级、主动发起的追加审查结论，以及换班监督。消耗倒金字塔由 loomd 提醒 Super。
- 需要核查 diff、原始日志或数据时，只派一名临时 Reviewer。证据出现 `FAILED`、`MISMATCH`、越界、删断言或跳测时，由 Reviewer 复核原件。有效结论回送一次并计入 `maxWakesPerGate`，超长正文通过回执文件交付。`loom notifications --history` 可查询追加审查记录，确认或等待状态留在历史。
- 把耗时工作交给 Worker 或 Reviewer，禁止用后台 Bash 等结果。结论首行用 `PASS`、`APPROVE`、`REJECT` 或 `BLOCKED`。确认收到时用 `NOREPLY`。
- 每次介入给 Leader 一条可执行的结论。常规结论排队投递，只有可复现的阻断缺陷可用 `interrupt` 否决。每轮自查验收要求是否超出目标或证据所需。每项交付最多审两轮，仍阻塞时向 Super 升级改设计，用 `--audit-escalation blocking-disagreement` 附证据和影响。

## Leader · 执行督导

1. 把裁决拆成卡，分派 Worker，执行门禁、集成和获授权的合入。监督 Auditor 换班。用户直接问时只回一句状态。
2. 按 [派卡模板](../../examples/card.md) 定目标、可写范围、净行数预算、受影响的测试和验收。为 Worker 建隔离 worktree，每批使用新 `--wave`。同时活跃的写代码 Worker 默认 2–3 名，硬上限 4 名。更多先拆成独立协调域。派发中断后查已接收成员，余项另开新波。
   测试先行且验收要求先见红的卡，用 `loom spawn worker --expect-red` 标记。测试失败原件仍入证据卡，预期红灯跳过重复测试失败告警。
3. 波次结算、阻塞或失败、审查结论、Super 裁决、超时或 STUCK 时处理一次决定，然后结束本轮。Worker 阻塞或被退回时用 `loom send` 在原会话续作。需显式续作批次时查 `loom send --help-advanced`。
4. 由 Worker 在自己的隔离沙箱中对固定候选 SHA 复现问题、跑全量测试和记录验收证据。Leader 用 `"$LOOM_BIN" spawn reviewer --project "$PROJECT" --cwd "$REVIEW_TREE" --wave "$GATE" "$QUESTION"` 发起独立审查，提供候选 SHA 和必要证据，只问一个可证伪的问题。Reviewer 在新会话里只读复核，限时 15–30 分钟，给出结论和证据后回收。Leader 收到结论后用 `"$LOOM_BIN" gate pack "$GATE" --project "$PROJECT" --base "$BASE" --candidate "$CANDIDATE"` 打包结论和验收证据，向 Auditor 投递一条指针。缺少 Reviewer 结论时，`gate pack` 发出告警。确认审核结论与授权后合入，再用 `loom notifications --gate-complete "$GATE"` 登记安全边界。收到 Auditor 超预算通知时，把材料合并到下一份门禁包。
5. 在真实派工或汇报中处理 loomd 附上的信号。核实保护或越界文件、删除或削弱断言、skip/only、事实错误或沙箱逃逸尝试后，可用 `loom escalate "$GATE" --reason REASON --evidence TEXT` 升级；与门禁包共用一次唤醒。需要其他角色回送最终答复时用 `loom send --expect-reply`。Worker 波次按批次回 Leader。
6. 把耗时验收交给 Worker 或 Reviewer，禁止用后台 Bash 等结果。结论首行用 `DONE`、`BLOCKED`、`FAILED` 等标签，确认收到时用 `NOREPLY`。

## Worker · 按卡施工

Worker 线统一由 OAR 托管。新增特殊 worker（例如 Claude TUI worker）须实现 OAR runtime 合约，禁止另建 Loom 专用 worker 路径。Worker 宿主随下次派工更新，loomd 升级保留已运行的 detached session-host。见 `docs/HEADLESS.md`。

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
4. 阶段或目标收尾时归档结果，用 `loom notifications --project "$PROJECT" --complete "$SUMMARY" --phase "$PHASE"` 按 ID 登记完成。项目收尾时用 `loom stop` 关闭会话。清理 worktree 前先把暂存、未暂存及授权范围内未跟踪的草稿归档成可恢复的补丁，记录路径。最后用 `loom doctor --project "$PROJECT"` 核对残留。

Worker 调用 Loom 命令使用绝对可执行路径 `"$LOOM_BIN"`。其他托管角色可使用 `"$LOOM_BIN"` 或由 Loom 注入的 `PATH` 解析的 `loom`。
