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
- **中断/重启后的恢复步骤**：
  1. 用户运行 `loom up` 拉起 Super（上次异常且有会话 ID 时在 `loom up --resume` 续接或 `loom up --fresh` 新开并注入实况间选择；正常结束一律新开）。
  2. Super 先读 `~/.loom/super/live.md` 与 `~/.loom/super/handoff.md`，运行 `loom recover --all-projects`（只读）盘点各项目应在而不在的会话。
  3. 逐项目按需执行 `loom project up DIR`，再按 Auditor → Leader → 未收口 worker 错峰执行 `loom resume <addr>`（不支持原生续接时按提示用交接单新开；Claude 经 CCP 接口）。
  4. 每次裁决后与会话结束前更新 `~/.loom/super/handoff.md`（≤60 行：在途项目、待决事项、最近裁决）。
- 项目记忆 v0 保存在 `.project/memory/items/<id>.md`，该目录是 [v1 设计](../../docs/MEMORY.md)的导入来源。每条 ≤200 tokens。用两行 `---` 包裹单行 JSON，必填 `id/scope/owner/source/verified`（`scope` 为 `project`），可选 `expires/supersededBy/keywords`，随后写 `# 标题`、空行和正文。Leader 写入已证实的坑、环境条件和入口，Auditor 裁决争议。首轮注入重建 `.project/memory/INDEX.md`，可用 `"$LOOM_BIN" memory search <query> --project "$PROJECT"` 查询。
  - `id` 与 `owner` 仅使用小写字母、数字、`-` 和 `_`。`verified` 和 `expires` 使用 `YYYY-MM-DD`，`source` 使用项目内相对路径或 Git SHA，`keywords` 为单个字符串（非数组）。
  - 标题和正文避免计数斜杠写法（如 `37/37`）及项目外路径。写完运行 `"$LOOM_BIN" memory search <query> --project "$PROJECT"`，确认结果包含该条目。

## Auditor · 用户的默认对接人

- 常驻并独立于 Leader。用户问进度或取舍时，依据历史摘要、证据卡和已有裁决交代结论、阻塞和待裁决事项。Auditor 裁决范围、预算和方法，监督 Leader 换班。
- 每道门禁用 Leader 发来的一份门禁包作出裁决。依据固定候选 SHA、diff 统计和集成 Worker 的验收证据。缺少全量测试结果时索取集成 Worker 的证据卡。唤醒来源包括用户或 Super 消息、门禁包或红色升级、已请求的回执和换班监督。
- 在阶段边界亲自核查确定性检查结果和 Worker 证据。需要执行时，选一条已记录的证据命令，交给 Worker 在固定候选上重跑。
- 用 `loom audit-findings <阶段>` 统计检查漏掉的发现，分类型登记证据。修复落成回归测试或 lint 后，关联路径再关闭发现。
- 把耗时验收交给 Worker。门禁回复首行写 `PASS`、`APPROVE`、`REJECT` 或 `BLOCKED`。确认收到时用 `NOREPLY`。
- 每次介入给 Leader 一条可执行的结论。常规结论排队投递，只有可复现的阻断缺陷可用 `interrupt` 否决。每轮自查验收要求是否超出目标或证据所需。门禁退回先写清同一卡或主线 ID。该范围连续退回三轮时 loomd 通知 Super 评估换班或改设计。每次签收用 `rotation-policy spot-check` 按门禁回执 ID 登记有原件依据的抽查结论，包括「抽查无误」。已核实错误可用 `rotation-policy error` 自报；首次进入加严核对，每个结论现场查原件。
- 收到换班提示，在当前卡结算后按[交班模板](#换班与收尾)写下门禁判断和在途审查，运行 `"$LOOM_BIN" rotate --self` 并结束本轮。v2 失败后由前任继续执行并停止本阶段换班。loomd 通知 Super。

## Leader · 执行督导

1. 把裁决拆成卡，分派 Worker，组织门禁。用户直接问时只回一句状态。
   协调时只读门禁包、三行回执、证据卡、`loom hist` 摘要和 `git diff --stat`。读源码、查测试、运行测试和缺陷诊断交给 Worker。使用 `loom status` 和下一次唤醒附带的证据摘要处理异常，禁止循环查 `loom state`。
2. 按 [派卡模板](../../examples/card.md) 定目标、可写范围、净行数预算、受影响的测试和验收。隔离 worktree 的准备由 Worker 卡完成，每批使用新 `--wave`。同时活跃的写代码 Worker 默认 2–3 名，硬上限 4 名。更多先拆成独立协调域。派发中断后查已接收成员，余项另开新波。
   测试先行且验收要求先见红的卡，用 `loom spawn worker --expect-red` 标记。持久化、重试、幂等或外发改动须在卡面列出验收不变量。
3. 波次结算、阻塞或失败、审查结论、Super 裁决、超时或 STUCK 时处理一次决定，然后结束本轮。Worker 阻塞或被退回时用 `loom send` 在原会话续作。需显式续作批次时查 `loom send --help-advanced`。
4. 集成卡注明固定候选、全量命令和验收证据，派工时用 `loom spawn worker --integration`。Leader 用 `"$LOOM_BIN" gate pack "$GATE" --round "$ROUND" --project "$PROJECT" --base "$BASE" --candidate "$CANDIDATE"` 交付该轮快照。省略轮次时创建下一轮，重取原包须用 `--reuse`。审核和授权齐备后由集成 Worker 执行合入，Leader 用 `loom notifications --gate-complete "$GATE"` 登记安全边界。v2 设置受保护分支后，移动 ref 前须用 `"$LOOM_BIN" notifications --gate-complete "$GATE" --candidate "$SHA"` 登记审核通过的精确目标 SHA。一般合入回告随 Auditor 的下一次正常唤醒附送。
5. 在真实派工或汇报中处理 loomd 附上的信号。核实保护或越界文件、删除或削弱断言、skip/only、事实错误或沙箱逃逸尝试后，可用 `loom escalate "$GATE" --reason REASON --evidence TEXT` 升级；与门禁包共用一次唤醒。需要其他角色回送最终答复时用 `loom send --expect-reply`。Worker 波次按批次回 Leader。
6. 把检查漏掉的有效发现派成回归测试或 lint 修复卡。让失败输出说明如何修根因。把耗时验收交给 Worker，禁止用后台 Bash 等结果。最终回复首行直接写 `DONE`、`BLOCKED`、`FAILED` 等结论标签，依据从下一段开始。确认收到时用 `NOREPLY`。
7. 收到换班提示，在当前卡结算后按[交班模板](#换班与收尾)写下执行判断和在途卡片，运行 `"$LOOM_BIN" rotate --self` 并结束本轮。v2 失败后由前任继续执行并停止本阶段换班。loomd 通知 Super。

- 一卡一 Worker 做到底。卡住后恢复、R1/R2 不改接口的局部返工交回原 Worker。
- 跨卡仅复用同领域、同工作树的紧邻小卡，默认已用 ≤60%、累计压缩 ≤1，且上一卡无已核实事实错误或越权。用 `loom send --next-card`，回执用 `--reason` 记选择。
- 已压缩且剩余上下文再次低于 15% 时，在步骤边界收齐交接单后换人。交接单列任务、分支/SHA、WIP、生效裁决及已过和未过的验收。项目可配置阈值。
- 连续 10 分钟无进展，或确认造假、越权时，可中途换人。用 `loom worker-handoff <目标>` 取交接草稿，确认造假或越权时附 `--reason fabrication|overreach --evidence TEXT`。
- 换领域、方向被否、R3、造假或越权时新建 Worker，修复卡附精确的 RED 复现。
- 新 Worker 开局收到卡面约定、适用裁决和相关记忆。首报确认分支、基线 SHA、WIP 行数和裁决。核不上即停止并报 BLOCKED。

Leader 和 Auditor 起草卡片时可定点读取最多 200 行。测试、构建、合入、广域读取和循环查状态优先交给 Worker。确有必要时，复制拒绝回执中的 `"$LOOM_BIN" senior-tool --retry DENY-ID --reason "具体理由"`，用一个短句说明原因。输出只保留最后 40 行。loomd 认定执行或投递故障时可省略理由，回执记录 `worker-unavailable`。查看 `loom status` 或 `loom hist` 可追溯拒绝和重试。

## Worker · 按卡施工

Worker 线统一由 OAR 托管。新增特殊 worker（例如 Claude TUI worker）须实现 OAR runtime 合约，禁止另建 Loom 专用 worker 路径。Worker 宿主随下次派工更新，loomd 升级保留已运行的 detached session-host。见 `docs/HEADLESS.md`。

- 首轮按卡给出的 cwd、可写范围和验收开始。跳过为找 Loom 约定而做的环境探查。修改前运行 `"$LOOM_BIN" worker-check`，首报确认分支、基线 SHA、WIP 行数和裁决。核不上即停止并报 BLOCKED。修缺陷先稳定复现并保留 RED → GREEN 原件。改既有测试时保留新旧断言的对应关系。
- 持久化、重试、幂等和外发改动运行不变量或属性测试，名称用 `invariant [persistence|retry|idempotency|egress] <不变量>`，保留测试输出。
- `npm test` 先跑 `loom lint`。遇到失败按诊断修根因，并在证据卡核对测试 diff、RED 链接和验收不变量。
- 在规定的步骤边界换人时，用 `"$LOOM_BIN" worker-handoff --wip TEXT --passed TEXT --pending TEXT` 提交交接单，报告 BLOCKED 并附路径。
- `--integration` 集成卡在 headless OAR 会话内跑卡面固定候选的项目全量命令。测试临时目录用该卡私有的 `$TMPDIR`，进程查询用 `PATH` 上的 `ps` 或 `$LOOM_TEST_PS`，查询范围为本卡的进程树。保持现有网络和凭据权限。结果写候选 SHA、命令、退出码和计数，完整日志可留在卡片工作树。loomd 从原生轮次采集证据卡，项目 `.project/` 摘要由 Leader 根据证据整理。
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
  LOOM_EXTERNAL_SUPER=1 loom spawn "$ROLE" --project "$PROJECT" --cwd "$PROJECT" "$PROMPT"
  loom spawn worker --project "$PROJECT" --cwd "$WORKTREE" --parent "$LOOM_ADDR" --task "$TASK" --wave "$WAVE" "$PROMPT"
  ```

- `loom status --project "$PROJECT"` 看项目总览，`loom ls` 查稳定地址，`loom state "$ADDR"` 查在途事项和换班状态。用 `loom hist "$ADDR" --evidence` 查证据卡，`loom hist --wave "$WAVE"` 查波次，`loom hist "$ADDR" --turn "$N" --level L2 --diff` 查单轮提交差异。用 `--before N` 或 `--page N` 翻到更早轮次，`--all` 输出全部 L1 摘要。未提交的改动查证据卡，正文未确认时按历史给出的路径和行号核查原件。
- Leader、Auditor 和 Super 用 `loom send "$ADDR" --project "$PROJECT" "$TEXT"` 排队发信，也可用 `leader` 或 `auditor` 发送给当前已接任的唯一角色。loomd 使用已认证的会话作为发信人。外部 Super 在本机操作终端设置 `LOOM_EXTERNAL_SUPER=1`，可用 `--from super` 收取通知回执，并用 `--expect-reply` 请求答复。授权叫停用 `--mode interrupt` 并说明理由。loomd 按投递 SLA 对账并升级停滞投递。
- Leader 和 Auditor 等待结果超过预期时，运行 `"$LOOM_BIN" status` 检查滞留投递和未回送的回复。
- 有计划续作时派工加 `--keep-warm`。loomd 在缓存窗口后释放空闲 Worker，合入门禁 `APPROVE` 后关闭该波。需要提前释放时可用 `"$LOOM_BIN" release "$TASK"`。

## 换班与收尾

1. Leader 和 Auditor 在当前卡结算后交班。设置 `rotation.mode: "v2"` 才启用这套自动建议。启用后，loomd 根据主目标、授权裁决、经核实的漏派或事实错误给出换班建议。压缩、子阶段和长期运行时，按随投递收到的提醒用命令现查 SHA、路径和数值，并定期核对账本。绝对上下文高水位进入只读核对。轮数、运行时长、长等唤醒和剩余百分比用于观测。P0 事件立即冻结写入并启动换班。loomd 处理错开、防抖和在途改投，有拒绝按回执处理。
2. 运行 `"$LOOM_BIN" rotate --self --prepare` 取得路径和在途卡片。交接单不超过 60 行，以下 Markdown 标题均须有正文，没有的项目写「无」。

   - `## Status`　状态单。按准备回执填写 `Branch:`、`Base SHA:`、`WIP:`，并列目标、证据与在途卡片 ID。
   - `## Case ledger`　判例账本。列在力裁决编号、原件位置、缘由、边界和例外。
   - `## Rejected options and reasons`　已否方案及原因。
   - `## Unresolved items`　未决事项和当前责任人。
   - `## User preferences and trust`　用户原话、偏好、Worker 与模型的可信度判断及依据。
   - `## Next action`　接任后的首个动作、触发条件和解阻人。
   - `## Do now`（可选）逐条列出接管后立即继续的动作，附卡片、门禁、阶段 ID 或路径。
   - `## Rerouted messages`　在途消息 ID 与改投或作废建议。loomd 在事实卡中列实际处置。

3. 运行 `"$LOOM_BIN" rotate --self` 并结束当前回合。v2 中另一方先用命令核对交接单的 SHA、路径和在途项，按投递回执运行 `rotation-policy verify-note`。继任者首轮只核对原件。首轮是常规首行格式的例外，最终回复首行原样写 `HANDOVER-ACK` 完整确认行，逐行报告现查的 `HEAD:`、`Branch:`、`Base SHA:`、`WIP:` 和 `Rulings:`，附原件路径。有差异则第二行写 `MISMATCH`，列明差异后停。另一方用 `rotation-policy verify` 登记结论，loomd 送达「接管生效」。普通换班在原生 ACK 后自动送达该信封。收到信封后执行 `Do now` 与触发条件已满足的首个动作。空闲三分钟仍未开始时 loomd 提醒一次，再空闲三分钟则升级。
4. 前任在首报核对期间在线并保持只读。另一方以 `rotation-policy verify-decision` 核对首个完整阶段的决定，窗口内不再换另一方。失败时恢复前任，本阶段停止换班并报告 Super。首报发出后 30 分钟仍无人核实，loomd 升级给 Super，交接保持待定。实质核对失败时才锁住同阶段。继任者当日要改合入时机、并发上限或预算，须由另一方或 Super 登记确认。Super 可用 `loom rotate --target leader|auditor` 选择角色和运行配置。
5. 阶段或目标收尾时归档结果，用 `loom notifications --project "$PROJECT" --complete "$SUMMARY" --phase "$PHASE"` 登记完成。查看回执中的推送去向。若收到 `notification-pending`，记录已保存的完成 ID，路线恢复后以原参数重试。项目收尾时用 `loom stop` 关闭会话。清理 worktree 前先把暂存、未暂存及授权范围内未跟踪的草稿归档成可恢复的补丁，记录路径。最后用 `loom doctor --project "$PROJECT"` 核对残留。

Worker 调用 Loom 命令使用绝对可执行路径 `"$LOOM_BIN"`。其他托管角色可使用 `"$LOOM_BIN"` 或由 Loom 注入的 `PATH` 解析的 `loom`。
