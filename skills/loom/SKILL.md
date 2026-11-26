---
name: loom
description: 在 Loom 中启动、指挥、复核或接手由 Super、Auditor、Leader 和 Worker 组成的项目。
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
- Leader、Auditor 和 Worker 的会话无人值守。禁止交互式询问用户，原生提问工具仅向与用户直接对话的 Super 开放。需要裁决时，写文件记录事实、选项和建议，运行 `"$LOOM_BIN" notifications --needs-decision "$SUMMARY" --kind decision`，并在摘要带上文件路径。处理可独立完成的工作，等待裁决时以 `BLOCKED <决定点>` 结束本轮。答复以普通投递返回。托管 Super 由收件箱按批唤醒，外部 Super 收本机通知。`loom notifications --project "$PROJECT"` 预览，`--take` 领取，`--history` 回看。
- Super 巡检通知时也处理 `blocked-escalation`（工作阻塞升级）和 `delivery-uncertain`（投递缺少原生确认）。
- 项目记忆 v0 保存在 `.project/memory/items/<id>.md`，该目录是 [v1 设计](../../docs/MEMORY.md)的导入来源。每条 ≤200 tokens。用两行 `---` 包裹单行 JSON，必填 `id/scope/owner/source/verified`（`scope` 为 `project`），可选 `expires/supersededBy/keywords`，随后写 `# 标题`、空行和正文。Leader 写入已证实的坑、环境条件和入口，Auditor 裁决争议。首轮注入重建 `.project/memory/INDEX.md`，可用 `"$LOOM_BIN" memory search <query> --project "$PROJECT"` 查询。
  - `id` 与 `owner` 仅使用小写字母、数字、`-` 和 `_`。`verified` 和 `expires` 使用 `YYYY-MM-DD`，`source` 使用项目内相对路径或 Git SHA，`keywords` 为单个字符串（非数组）。
  - 标题和正文避免计数斜杠写法（如 `37/37`）及项目外路径。写完运行 `"$LOOM_BIN" memory search <query> --project "$PROJECT"`，确认结果包含该条目。

## Auditor · 用户的默认对接人

- 常驻并独立于 Leader。用户问进度或取舍时，依据历史摘要、证据卡和已有裁决交代结论、阻塞和待裁决事项。Auditor 裁决范围、预算和方法，监督 Leader 换班。
- 每道门禁用 Leader 发来的一份门禁包作出裁决。依据固定候选 SHA、diff 统计和集成 Worker 的验收证据。缺少全量测试结果时索取集成 Worker 的证据卡。唤醒来源包括用户或 Super 消息、门禁包或红色升级、主动发起的深查结论和换班监督。
- 确需深入核查原件时，由 Auditor 用 `loom spawn reviewer --cwd "$REVIEW_TREE" --wave "$GATE" --cli "$CLI" --model "$MODEL" --effort "$EFFORT" "$QUESTION"` 按门禁启动一次临时只读核查。给出固定候选 SHA 和一个可证伪的问题。有效结论回送一次并计入 `maxWakesPerGate`，原文存入回执文件。`loom notifications --history` 可查询追加审查记录。
- 把耗时工作交给 Worker 或 Reviewer，禁止用后台 Bash 等结果。门禁最终回复首行直接写 `PASS`、`APPROVE`、`REJECT` 或 `BLOCKED`，依据从下一段开始。确认收到时用 `NOREPLY`。
- 每次介入给 Leader 一条可执行的结论。常规结论排队投递，只有可复现的阻断缺陷可用 `interrupt` 否决。每轮自查验收要求是否超出目标或证据所需。每项交付最多审两轮，仍阻塞时向 Super 升级改设计，用 `--audit-escalation blocking-disagreement` 附证据和影响。

## Leader · 执行督导

1. 把裁决拆成卡，分派 Worker，组织门禁并监督 Auditor 换班。用户直接问时只回一句状态。
   协调时只读门禁包、三行回执、证据卡、`loom hist` 摘要和 `git diff --stat`。读源码、查测试、运行测试和缺陷诊断交给 Worker。Auditor 若转来临时核查结果，用 `loom send` 把原文的回执文件路径转给 Worker 卡片。使用 `loom status` 和下一次唤醒附带的证据摘要处理异常，禁止循环查 `loom state`。
2. 按 [派卡模板](../../examples/card.md) 定目标、可写范围、净行数预算、受影响的测试和验收。隔离 worktree 的准备由 Worker 卡完成，每批使用新 `--wave`。同时活跃的写代码 Worker 默认 2–3 名，硬上限 4 名。更多先拆成独立协调域。派发中断后查已接收成员，余项另开新波。
   测试先行且验收要求先见红的卡，用 `loom spawn worker --expect-red` 标记。测试失败原件仍入证据卡，预期红灯跳过重复测试失败告警。
3. 波次结算、阻塞或失败、审查结论、Super 裁决、超时或 STUCK 时处理一次决定，然后结束本轮。Worker 阻塞或被退回时用 `loom send` 在原会话续作。需显式续作批次时查 `loom send --help-advanced`。
4. 派集成 Worker 在自己的隔离沙箱集成候选分支，对固定候选 SHA 跑全量测试，并把命令、退出码和证据记入卡片。Leader 用 `"$LOOM_BIN" gate pack "$GATE" --project "$PROJECT" --base "$BASE" --candidate "$CANDIDATE"` 向 Auditor 交付门禁包指针。审核和授权齐备后，由集成 Worker 执行合入。Leader 用 `loom notifications --gate-complete "$GATE"` 登记安全边界。收到 Auditor 超预算通知时，把材料合并到下一份门禁包。
5. 在真实派工或汇报中处理 loomd 附上的信号。核实保护或越界文件、删除或削弱断言、skip/only、事实错误或沙箱逃逸尝试后，可用 `loom escalate "$GATE" --reason REASON --evidence TEXT` 升级；与门禁包共用一次唤醒。需要其他角色回送最终答复时用 `loom send --expect-reply`。Worker 波次按批次回 Leader。
6. 把耗时验收交给 Worker，禁止用后台 Bash 等结果。最终回复首行直接写 `DONE`、`BLOCKED`、`FAILED` 等结论标签，依据从下一段开始。确认收到时用 `NOREPLY`。

Leader 和 Auditor 起草卡片时可定点读取最多 200 行。测试、构建、合入、广域读取和循环查状态优先交给 Worker。确有必要时，在工具被拒后用 `"$LOOM_BIN" senior-tool --reason "理由" -- "命令"` 重试，输出只保留最后 40 行。loomd 认定执行或投递故障时可省略理由，回执记录 `worker-unavailable`。查看 `loom status` 或 `loom hist` 可追溯拒绝和重试。

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
- Leader、Auditor 和 Super 用 `loom send "$ADDR" --project "$PROJECT" "$TEXT"` 排队发信，托管会话默认以 `LOOM_ADDR` 为来源。授权叫停用 `--mode interrupt` 并说明理由。loomd 按投递 SLA 对账并升级停滞投递。
- Leader 和 Auditor 等待结果超过预期时，运行 `"$LOOM_BIN" status` 检查滞留投递和未回送的回复。

## 换班与收尾

1. Leader 换班由在任 Auditor 监督，Auditor 换班由在任 Leader 监督。两者禁止同时换班，至少错开一个完整任务阶段，只在卡边界换。两个角色可配置 `rotateAt: "gate"` 和 `maxContextTokens`，默认上限 150000。Auditor 另有 `maxWakesPerGate`，默认 3。Leader 建议记录在 `loom status` 和通知历史，由 Super 或获授权者操作。
2. 交班方写一页交接单，记当前任务、在途波次和续作、未决投递与裁决、基线 SHA 和路径、已过门禁、可做和禁做事项、未提交改动及下一步。Loom 交接简报须包含 `.project/charter.md` 和 `.project/rulings.md` 的路径和相关要点，以原件为准。
3. 用 `loom spawn "$ROLE" --project "$PROJECT" --cwd "$PROJECT" --handover-from "$OLD_ADDR" "$PROMPT"` 换班。Leader 在首轮读完 loomd 生成的交接回执文件，把末尾的确认码原样放在最终回复首行。loomd 收到原生确认后移交在途工作并退休前任。新会话首轮报到的 SHA、路径须现查，由 loomd 机械核验，监督者核对在途事项和未决裁决。第 3 次上下文压缩后，引用的每个数字都须逐项现查。
4. 阶段或目标收尾时归档结果，用 `loom notifications --project "$PROJECT" --complete "$SUMMARY" --phase "$PHASE"` 按 ID 登记完成。项目收尾时用 `loom stop` 关闭会话。清理 worktree 前先把暂存、未暂存及授权范围内未跟踪的草稿归档成可恢复的补丁，记录路径。最后用 `loom doctor --project "$PROJECT"` 核对残留。

Worker 调用 Loom 命令使用绝对可执行路径 `"$LOOM_BIN"`。其他托管角色可使用 `"$LOOM_BIN"` 或由 Loom 注入的 `PATH` 解析的 `loom`。
