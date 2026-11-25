# LOOM-UX-1 结果

`skills/loom/SKILL.md` 共 **59 行**，含 frontmatter 与空行。覆盖 Super、Leader、Auditor、Worker 的启动、查阅、续作、合入复核、换班和收尾。运行边界按本轮末尾重读的 [协议 v2](../../docs/PROTOCOL-v2.md)。

## 实现与取舍

- 命令统一用 `--project DIR` 表示项目根目录绝对路径。省略时从环境或当前目录推导。回执显示规范化 `project` 和 `projectId`，后者由目录名和规范路径的 SHA-256 前 12 位组成。已登记的内部项目键继续用于旧数据寻址。
- 策略在 `.project/policy.json`。preferred 为有序的 CLI、model、effort 组合，deny 为非空字段子集组成的规则。首个相容组合补缺省字段，deny 优先。回执保留 requested、selected、effective、differences 和 unverified。运行时拒绝的组合原样返回。
- state 呈现 daemon 的 headless 状态及原始信号，从可用的 daemon 字段、项目 journal 和绑定原件取值。提供方尚无确认值时显示 null。
- hist 分开显示轮次与任务的提交 diff。缺少边界的旧记录报告 missing-boundary。证据卡能提供观察时的未提交改动。托管输入前采样 HEAD，轮末按原生证据采样。TUI 手工轮须靠近可归属的原生边界，采样时刻可查。
- doctor 默认只读。--fix 持项目写锁重新核对归属及原生身份。脏工作树、忽略文件、未合入的 detached HEAD、缺归属证明的旧资源和仍在恢复中的会话保留现场。不明投递与未封存波次交由 daemon。
- notifications 接入已有项目队列，默认一次性领取，--peek 只读预览。外部 Super 可在项目节点按需查询。

### 共用目录增量

| 文件 | 用途 |
| --- | --- |
| daemon/main.mjs、daemon/rpc.mjs | 统一入口帮助，托管地址优先于旧 hc 地址。 |
| daemon/sessions.mjs、daemon/supervisor.mjs | 启动策略、运行时有效值与回执，TUI 输入 HEAD 和临时目录归属，波次消息归属与类型。 |
| daemon/oar.mjs、daemon/turn-heads.mjs | OAR 根轮起止 HEAD、OpenCode 无原生工具记录时的文字投影、TUI 边界及 Codex 子命令环境。 |
| daemon/tui.mjs、daemon/processes.mjs | agy 临时工作区身份，daemon 启动的 OAR 进程及可核验的子进程身份。 |
| relay/project.mjs | 结算、阻塞及补投添加 waveKey、waveKind，供历史追踪投递。 |
| index/ | 沿用现有字段，无 schema 增量。 |

编辑前重新读取与 PROTO-HARDEN-0 共用的 daemon 和 relay 文件。波次封存兜底用例曾失败。PROTO-HARDEN-0 的失边界修复进入工作区后，单例和全量复跑均通过。最新协议已统一描述 Claude TUI 与 headless 两个入口。无未解决的文本冲突。

## t17w 审查逐条对照

| 条目 | 处理 | 理由及落地 |
| --- | --- | --- |
| §1.1 厂商写死 | 已采纳 | 示例只传角色、项目和 cwd，运行面取策略。 |
| §1.2 每次手填 model/effort | 已采纳 | 匹配有序首选并执行 deny，显示确认值。 |
| §1.3 常驻角色的占位任务与波次 | 已采纳 | 仅 Worker 必填。 |
| §1.4 state 与旧索引说明冲突 | 已采纳 | 使用最新 daemon 接口呈现活跃 headless 状态和可读信号。 |
| §1.5 两处登记 | 已采纳 | 角色用 spawn 与 hist --wave，登记走 daemon。 |
| §1.6 轮末丢失或中断时的封存 | 改写采纳 | 查成员，待派项新开波。封存及超时采用协议兜底。 |
| §1.7 单独启动 relay | 改写采纳 | CLEAN-0 已删除独立进程，启动方管理 loomd。 |
| §1.8 抄送与例行复核 | 改写采纳 | 每次合入前独立复核，优先 MISMATCH、UNVERIFIED，沿用协议抄送条件。 |
| §1.9 Worker 阻塞去向 | 已采纳 | 首行 BLOCKED，写所需决定并结束，由 Leader 排队续作。 |
| §1.10 Auditor 的否决权 | 已采纳 | 可复现阻断缺陷可用 interrupt 并写理由，CLI 验证原生轮保护。 |
| §1.11 人工对账和重试 | 已采纳 | 角色报告拒绝或 uncertain，daemon 对账。 |
| §1.12 doctor 缺席 | 已采纳 | 提供项目报告及可核验归属的清理。 |
| §1.13 换班信号 | 已采纳 | Super 查询状态原数后决定。 |
| §2.1 投递与唤醒 | 改写采纳 | 角色按事件工作，确认、去重及恢复沿用最新协议。 |
| §2.2 卡死与弹窗 | 改写采纳 | 查状态与通知队列，headless 巡检由协议卡负责。 |
| §2.3 过度设计 | 已采纳 | 移除角色手册中的运行路由和人工核对。 |
| §2.4 角色纪律 | 改写采纳 | 保留 RED → GREEN、三轮复核和授权门槛，加上独立复核与沙箱纪律。 |
| §2.5 不实回报 | 已采纳 | 证据卡、原始退出码、候选 diff 和复跑作为合入依据。 |
| §2.6 沙箱权限 | 改写采纳 | 拒绝原样报告，禁止自行绕开，项目授权的参数仍可用。 |
| §2.7 账号与模型 | 改写采纳 | 落地模型和 effort 策略，账号字段按协议保留空值。 |
| §2.8 轮换与上下文 | 已采纳 | 向 Super 报原始信号，先停旧会话。 |
| §2.9 合并、工作树、残留 | 改写采纳 | Leader 获授权后合入并建清工作树，具体 Git 合入方式交给项目。 |
| §2.10 可观察性 | 改写采纳 | headless 用状态、历史和原件定位。 |
| §3.1 异常筛选 | 已采纳 | 五种结果筛选，补充 blocked。 |
| §3.2 波次视图 | 已采纳 | 成员状态、耗时、改动、净行数、测试退出码、投递去向。 |
| §3.3 固定候选 diff | 已采纳 | 轮次及任务独立的 base..candidate。 |
| §3.4 跨会话查询 | 已采纳 | grep 支持命令、错误、路径。 |
| §3.5 L2 筛选 | 已采纳 | 工具类型、命令正则、输出行尾。 |
| §3.6 原件定位 | 已采纳 | transcriptPath、零基偏移与可确认的一基行号。 |
| §3.7 L1 事实行 | 已采纳 | 退出码、文件数、claims 结论及缺值。 |
| §4.1 Claude 取证 | 改写采纳 | 沿用协议核对原生身份，绑定与崩溃注入由协议卡处理。 |
| §4.2 双渠道 | 改写采纳 | 波次历史从同一 inbox 查询回执，运输方式留在协议。 |
| §4.3 未封存不唤醒 | 改写采纳 | 协议封存兜底与 doctor 未封存清单。 |
| §4.4 relay 停运 | 改写采纳 | 统一 daemon 状态及项目残留报告。 |
| §4.5 headless 挂起 | 改写采纳 | 查未完成项和最近活动，由 Leader 决定处置。 |
| §4.6 ACP 正文未确认 | 已采纳 | unverified 过滤及原件定位，角色注明未确认。 |
| §4.7 重复登记 | 已采纳 | 读取 daemon 的单一登记与投递记录。 |
| §4 验收建议 | 改写采纳 | SIGKILL、千条并发、丢轮末、挂起和 ACP 边界对应协议卡故障矩阵，本卡实测 CLI 流程、历史与清理。 |
| §5.1–6 删减清单 | 已采纳 | 删除底层详情、角色对账与 steer、常驻占位字段、必填模型和免复核表述。 |
| §6 L13 / L24–25 / L32 / L33 / L34 | 已采纳 | 阻塞回报、策略示例、拒绝后报告、删实现详情、历史状态查询。 |
| §6 L41–43 / L52 | 改写采纳 | 角色用 queue 和 interrupt，中断后核对成员并新开波。 |
| §6 L58 / L59 / L64 | 改写采纳 | 每次合入前复核，可复现的缺陷否决，Worker 三类首行。 |
| §6 L68 / L70 / 沙箱红线 | 改写采纳 | 信号驱动换班，stop 后 doctor。报告原拒绝，允许授权参数。 |

## t17g 审查逐条对照

| 条目 | 处理 | 理由及落地 |
| --- | --- | --- |
| §1.1 项目绝对路径 | 已采纳 | 全局及子命令统一，拒绝项目昵称与相对路径，回执给派生 ID。 |
| §1.2 Claude 模式与示例冲突 | 已采纳 | 运行细节退出 Skill，示例由策略决定，运行面依最新协议。 |
| §1.3 常驻角色占位 | 已采纳 | 常驻角色可省 task/wave。 |
| §1.4 Worker 中途发信与身份碰撞 | 已采纳 | 用最终回复回报，由 Leader 按原地址续作。 |
| §1.5 BLOCKED | 已采纳 | 三种最终首行，BLOCKED 走协议的单独通知路径。 |
| §1.6 悬空证据、doctor 和策略 | 已采纳 | hist --evidence 给摘要及路径，提供 doctor 及策略格式。 |
| §1.7 Worker 和 Auditor 工作树 | 已采纳 | Leader 预建两个隔离工作树、传路径并清理。 |
| §1.8.1 跨轮补派 | 已采纳 | 先核对成员，余项开新波。 |
| §1.8.2 同会话续作 | 改写采纳 | 记在途事项并接收同会话回报，CLI 保留协议支持的可选续作批次。 |
| §1.8.3 超时处置 | 改写采纳 | 查状态和历史，依据进展处置，Skill 无固定等待时长。 |
| §1.9 --wait、来源、架构裁决 | 已采纳 | LOOM_ADDR 默认来源，托管拒绝 --wait，重大取舍提供事实、选项与推荐后结束。 |
| §1.10 换班顺序 | 已采纳 | 写交接、stop 确认、spawn、handover --to。 |
| §2.1 方法论状态机 | 已采纳 | Skill 保留角色操作。 |
| §2.2 SQLite 竞态 | 改写采纳 | 沿用单写者，doctor 修复持项目写锁。 |
| §2.3 纪律与防轮询 | 改写采纳 | 保留防轮询、RED → GREEN 和三轮复核，每次合入独立审查。 |
| §2.4 投递、多回合、ACP | 改写采纳 | 按事件续作，超时查历史，ACP 原文可查并标明未确认。 |
| §2.5 证据卡可观察性 | 已采纳 | 原件路径、基线和 evidence 查询均可见。 |
| §2.6 沙箱与宿主机验证 | 改写采纳 | Leader 负责整体验证和隔离复核，Worker 原样报告拒绝。 |
| §2.7 429、去重、hung、降级 | 改写采纳 | 沿用协议巡检和一次性通知，模型失败直接返回。 |
| §2.8 上下文与换班 | 已采纳 | 展示原始信号，先停旧会话。 |
| §2.9 工作树与进程归属 | 已采纳 | 明确 Leader 归属及 doctor 的验证与清理。 |
| §2.10 模型及 effort 目录 | 改写采纳 | 按项目已验证的策略启动。厂商实时目录超出本卡接口。 |
| §3.1 精确轮与异常筛选 | 已采纳 | --turn、五种 --outcome，结合退出与原生状态。 |
| §3.2 L1 上限 | 已采纳 | 正常 400 字节，异常 800 字节，优先保存事实、失败命令及首行错误。 |
| §3.3 波次及逐轮 diff | 已采纳 | 聚合视图和轮次、任务两个固定提交区间。 |
| §3.4 基线、账号和原件索引 | 改写采纳 | baseCommit、transcriptPath 沿用最新协议，account 保留为空。 |
| §3.5 证据卡接入 | 已采纳 | 输出摘要、路径、Git 统计、断言与验证退出码。 |
| §3.6 跨会话检索 | 已采纳 | grep 查项目历史。 |
| §4.1 ACP 正文 | 改写采纳 | 可读未确认原文，并沿用协议确认要求。 |
| §4.2 续作、steer 与归属 | 改写采纳 | 角色只用 queue 和 interrupt，回到原会话续作。 |
| §4.3 超时与晚到 | 已采纳 | 查成员状态和投递类别，由 Leader 依据证据决定重派。 |
| §4.4 uncertain 升级 | 已采纳 | 一次性项目通知与 doctor 清单。 |
| §4.5 headless 挂起 | 改写采纳 | 展示现有巡检及原始计数，行为由协议卡定义。 |
| §4.6 外部 Super | 改写采纳 | 直接领取项目通知，保留按需查询和单次外部 --wait。 |
| §5.1、2、4、5、6 | 已采纳 | 删除运行路由、steer、对账及 Worker 主动发信，移除占位字段并提供 doctor。 |
| §5.3 删除或隐藏 --wait | 改写采纳 | 保留外部调用，在托管入口机械拒绝。 |
| §6 角色、启动、发信 | 改写采纳 | 角色按授权、策略、事件操作，遵守本卡的模型默认、回执取舍。 |
| §6 Leader、Auditor、Worker、收尾 | 改写采纳 | 落地工作树、三态阻塞、例行合入复核与换班，抄送条件按协议。 |
| §2.6 独立 verify 原语 | 不采纳 | 固定候选和项目验收命令提供验证边界。额外权限原语超出本卡。 |
| §2.5 / §3.4 采集账号身份 | 不采纳 | 最新协议明定 account 保留为空，本卡策略与查询无需账号身份。 |

## 验收

- 根目录 npm test **225/225 通过**，零失败、跳过或取消。
- 实测项目在 /Users/sun/Code/exp-relay/loom-ux-1/p-zwoQsY。使用本地 app-server 夹具跑真实 loomd、OAR 和 CLI，Git 两个提交仅存在于测试仓库。模型回复、测试输出和额度事件来自夹具。hc 与 OAR 残留进程清理使用真实本地进程，已关闭本轮创建的窗格及 daemon。
- 全量记录为 [npm-test-final.log](/Users/sun/Code/exp-relay/loom-ux-1/npm-test-final.log) 和 [smoke-output.jsonl](/Users/sun/Code/exp-relay/loom-ux-1/smoke-output.jsonl)。可用 `node /Users/sun/Code/exp-relay/loom-ux-1/smoke.mjs` 在同一隔离目录复跑。

以下摘录实测回执字段。命令中的 $PROJECT 为上述项目绝对路径，$ADDR 为 Worker 地址。

```text
$ loom spawn leader --project "$PROJECT" --cwd "$PROJECT" "HOLD first round"
{"projectId":"p-zwoQsY-9cc38a572c62","requested":{"cli":null,"model":null,"effort":null,"mode":null},"selected":{"cli":"codex","model":"fixture","effort":"high","mode":"headless"},"effective":{"cli":"codex","model":"fixture","effort":"high","mode":"headless"},"differences":[],"unverified":[],"task":null,"wave":null}
$ loom ls --project loom-ux-1
{"ok":false,"error":{"code":"invalid-arguments","message":"--project DIR selects the absolute project root directory."}}
$ loom spawn ... --model denied ...
{"ok":false,"error":{"code":"policy-denied","message":"Project policy denies codex / denied / high"}}
$ loom spawn ... --effort medium ...
{"ok":false,"error":{"code":"unavailable","message":"codex thread/start kept effort high although effort medium was requested"}}
$ LOOM_ADDR=$LEADER LOOM_PROJECT=$PROJECT loom send "$ADDR" "RETURN BLOCKED UX-DEMO..."
{"id":"bf4f2964-9961-46fc-a09d-b3101d1441b1","deliveryStatus":"accepted","fromInLedger":"oar-41ab841b-7597-4e1f-a7e3-66557c5bd7ca"}
$ LOOM_ADDR=$LEADER loom send "$ADDR" --project "$PROJECT" --wait "do not send"
{"ok":false,"error":{"code":"invalid-arguments","message":"--wait is unavailable in a managed session. End this turn and let Loom wake the session when a reply arrives."}}
$ loom send "$AUDITOR" --project "$PROJECT" --wait "external wait"
{"reply":"OK external wait"}
$ loom state "$ADDR" --project "$PROJECT"
{"state":"idle","signals":{"context":{"tokens":200,"contextWindow":1000,"percent":20},"compactions":0,"turns":1,"usage":{"calls":1,"inputTokens":180,"cachedInputTokens":0,"cacheWriteInputTokens":0,"outputTokens":20,"reasoningOutputTokens":0}}}
$ loom hist "$ADDR" --project "$PROJECT" --turn 1 --diff --evidence --json
{"index":1,"facts":{"exitCodes":[1],"changedFiles":3,"claims":["MISMATCH","UNVERIFIED","MATCH"]},"transcriptPath":"/Users/sun/Code/exp-relay/loom-ux-1/p-zwoQsY/worker/.native/d7859d1d-1970-4553-9c07-d085ddf727b6.jsonl","lineOffset":0,"startLine":1,"endLine":7,"base":"4dc0316bb29085d120980777490c1941702a0f0d","candidate":"bb04dca839cc2e81121762d45c6660cf67093996","numstat":{"src":{"added":2,"deleted":1,"net":1,"binary":0},"test":{"added":1,"deleted":1,"net":0,"binary":0},"docs":{"added":1,"deleted":1,"net":0,"binary":0}},"testAssertions":[{"path":"test/main.test.js","line":1,"text":"assert.equal(value, 1);"}],"evidence":[{"path":"/Users/sun/Code/exp-relay/loom-ux-1/p-zwoQsY/.project/evidence/UX-DEMO-9ce890cb3f2461b4d12f.json","summary":"证据 MISMATCH 1 · 待证 1\n改动 3 · 保护 0 · 测试 0（删 0） · 断言 -0 · skip +0 / only +0\n验证 0/1 通过 · 沙箱 0 / 外 0 / 未知 1\n全绿 → 有验证失败 · 通过 8 项 → 缺少测试计数"}]}
$ loom hist "$ADDR" --turn 1 --tool shell --cmd "npm test" --tail 1 --json
[{"tool":"shell","name":"exec_command_begin","command":"npm test","paths":[],"exitCode":1,"output":"last output line"}]
$ loom hist "$ADDR" --turn 1 --tool edit --json
[{"tool":"edit","name":"apply_patch_begin","command":null,"paths":["src/main.js"],"exitCode":null,"output":null}]
$ loom hist "oar-f4567157-1afb-4fdd-87f5-c0c9c4075b8e" --project "$PROJECT" --outcome failed --json
[{"index":1,"outcomes":["failed","unverified"]}]
$ loom hist "oar-41ab841b-7597-4e1f-a7e3-66557c5bd7ca" --project "$PROJECT" --outcome aborted --json
[{"index":1,"outcomes":["aborted"]}]
$ loom hist "oar-126105d9-9133-4fe0-a28e-f14e52a41b47" --project "$PROJECT" --outcome quota --json
[{"index":1,"outcomes":["quota","failed"]}]
$ loom hist "oar-f4567157-1afb-4fdd-87f5-c0c9c4075b8e" --project "$PROJECT" --outcome blocked --json
[{"index":2,"outcomes":["blocked"]}]
$ loom hist "oar-126105d9-9133-4fe0-a28e-f14e52a41b47" --project "$PROJECT" --outcome unverified --json
[{"index":2,"outcomes":["unverified"]}]
$ loom hist --project "$PROJECT" --grep "expected regression" --json
[{"addr":"oar-f4567157-1afb-4fdd-87f5-c0c9c4075b8e","index":1,"startLine":1}]
$ loom hist --project "$PROJECT" --wave UX-W1 --diff --evidence --json
{"wave":"UX-W1","state":"closed","members":[{"task":"UX-DEMO","outcome":"done","elapsedMs":757,"netLines":1,"files":["docs/intro.md","src/main.js","test/main.test.js"],"testExitCodes":[{"command":"npm test","exitCode":1}]}],"destinations":[{"kind":"merged","to":"oar-41ab841b-7597-4e1f-a7e3-66557c5bd7ca","status":"delivered"},{"kind":"merged","to":"oar-2b374ee2-0ef8-4ba0-8704-b0131982eeb5","status":"delivered"}]}
$ loom handover leader --project "$PROJECT" --to "$NEW_ADDR"
{"addr":"oar-41ab841b-7597-4e1f-a7e3-66557c5bd7ca","to":"oar-6ccd19be-e4a3-4717-a915-253c04008204","status":"accepted"}
$ loom notifications --project "$PROJECT"
{"notifications":[{"type":"leader-exited","addr":"oar-31ad665d-8567-4c0d-9da8-ea14373c1a40"}]}
$ loom notifications --project "$PROJECT"
{"notifications":[]}
$ loom doctor --project "$PROJECT"
{"lock":"stale","panes":[{"pane":"t31y","residual":true}],"temporary":1,"uncertain":["synthetic-uncertain"],"unsealedWaves":["INCOMPLETE"],"worktrees":[{"path":"/Users/sun/Code/exp-relay/loom-ux-1/p-zwoQsY/audit-tree","state":"clean","cleanable":true},{"path":"/Users/sun/Code/exp-relay/loom-ux-1/p-zwoQsY/worker","state":"dirty-or-ignored-files","cleanable":false}]}
$ loom doctor --project "$PROJECT" --fix
{"fixed":["stale-lock","temporary","hc-pane","worktree"],"uncertain":["synthetic-uncertain"]}
$ loom doctor --project "$PROJECT"  # 测试 daemon 在独立目录内被 SIGKILL 后
{"oarChildren":[{"pid":94534,"residual":true}]}
$ loom doctor --project "$PROJECT" --fix
{"fixed":["stale-lock","socket","oar-child-sigterm"]}
```

STATUS: done
