# 后端收口：persona 调度接缝与创建端点退休

本刀基线 `0a33cf5`，开始时 evo 工作树干净。最终结果见文末“最终验收与部署”；中间失败和停止记录是修订过程证据，不是当前状态。按负责人任务书及修订 1–3执行。仅说明本刀，不宣称整个后端或 legacy 子系统完成退休。

## 代码与复核

逐条复核任务书：正式组合原来不传开关且 daemon 默认 false；Kernel 原默认 true；正式库 65 条 Agent 定义中 4 条无 Role 关联、Inbox 均为 0；persona 判定只有 writer 调用；两层开关、HTTP 路由与 SDK 位置属实；协议 schema 是 Role 活依赖；5 个 daemon 测试确实显式启用开关。修订 2 的调用链亦属实：workspace-agent-provisioning 仅在非 Role 时 requestAgentFirstRun，role-catalog 实例化明确传 roleInstance。

- `room-event-writer.ts`：保留 persona 判定并无条件 continue；删除开关字段、构造参数与条件。
- `room-kernel-options.ts`、`room-kernel.ts`、`daemon-application.ts`：删除两层可选开关及转发。不存在可重新启用的 true 路径。
- `client-application-service.ts`：删除 provision 路由和处理器；有效旧请求现返回 404。
- `client-sdk/src/index.ts`：删除 agent.provision 操作及其请求/响应导入；`human-application-port.ts` 删除该暴露。低层 Kernel provisioning 仍供 Role 创建和历史夹具使用。
- **协议三项未动**：ClientAgentProvisionRequestSchema、agent-provision-request.ts、RoleConfigurationSchema；没有 schema 迁移。
- 前端与控制台产品代码未动，无此端点活调用方。

### A：残留符号逐项

全仓搜索 `scheduleLegacyPersonas|legacyPersonaScheduling|isLegacyPersonaAgent`：前两个标识符在源码与测试中为 0，仅本报告保留说明；第三个仅有 `instance-worker-scope.ts` 定义、`room-event-writer.ts` import 与无条件调用三处，全部有意保留。status 的旧开关说明已重写，无悬空引用。

### B：基线 11 个 provisionWorkspaceAgent 测试文件

清单通过 `git grep -l provisionWorkspaceAgent 0a33cf5 -- 'packages/*/test/*'`复核，不把后续新增 helper 算入原 11 个。

| 文件（均在 packages 对应 test 下）              | 性质与处理                                                                                                                                        |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| core/core.test.ts                               | 借用端口清单；删除已退休 Human 方法断言，其余端口不变                                                                                             |
| application-service/worker-self-profile.test.ts | 借用 Agent 夹具；真实 Role create/instantiate，自己的频道执行，保留资料、权限、任务、头像不变量                                                   |
| kernel/agent-avatar-profile.test.ts             | 借用；真实 Role 命令建夹具，保留头像投影与修改不变量                                                                                              |
| kernel/agent-profile-update.test.ts             | 借用；真实 Role 命令，保留配置更新与校验                                                                                                          |
| kernel/agent-avatar-provisioning.test.ts        | 混合；头像/幂等/重开数据库迁到真实 Role，自动问候无 Role 对应，明确断言无合成 first-run 事件                                                      |
| kernel/agent-first-run.test.ts                  | 真有 persona 自动问候语义；主测试重建 Role 首次显式定向运行、消息持久化、精确幂等和 ACK；firstRunReplay/保留 key/历史事件兼容保留独立单测，见下文 |
| kernel/legacy-persona-fence.test.ts             | 真 persona 负例；必须保留历史形状，证明 0 Inbox/0 Activation，旁边 Role 仍入队                                                                    |
| kernel/private-workspace-provisioning.test.ts   | 真旧 persona cwd/显式挂载兼容；保留低层历史 fixture，不产生运行，不表示仍有产品创建入口                                                           |
| kernel/agent-account-lifecycle.test.ts          | 真历史账号重用/tombstone/不可变 Agent ID；保留历史 fixture，不调度                                                                                |
| kernel/workspace-member-graph.test.ts           | 真历史多房间成员图与可见性兼容；保留历史数据夹具，不调度                                                                                          |
| kernel/workspace-management.test.ts             | 混合：旧 provisioning 事务、原账号身份和配置兼容仍用低层 fixture；需 Activation 的配置/运行/活动部分统一绑定 Role，继续验证原业务结果             |

### 共享迁移与 90 个失败

10 个文件各有局部 helper，并非全仓共用一个建 Agent helper。新增两种共享形态，不复制 10 份角色构建：

1. `provision-role-fixture.ts`：真实 Role create/instantiate，返回控制 Room 的 canonical provision 收据供资料测试继续操作；不直接插 projection。
2. `role-definition-fixture.ts`：已有 fake Host、精确 policy/participant ID 的执行测试保留原建模，统一建 Role revision 并把定义绑定为单频道实例。**这是测试数据装配，直接插 role_instances，不证明产品实例化生命周期**。生命周期由 `role-http-closeout.test.ts` 的实际 HTTP + SDK 验证补足。

首次 Kernel 全量结果 759 tests / 669 pass / 90 fail；复核 90 个失败分布与负责人清单一致。迁移入口如下（数字是原失败数，不是覆盖率）：

| 文件                       | 原失败 | 共享入口/原不变量                                                                       |
| -------------------------- | -----: | --------------------------------------------------------------------------------------- |
| durable-placement          |     37 | createFixture、addAgent、额外容量释放成员；Placement/Host 身份/lease/容量/隔离/终止证明 |
| run-attempt-usage          |     21 | 主 fixture；usage/缺口/汇总/隐私/删除                                                   |
| instance-runtime           |      9 | 主 fixture；运行时与执行轮围栏                                                          |
| reminder-service           |      6 | 主 fixture；同房间提醒/恰好一次/线程/周期/权限                                          |
| agent-deletion-diagnostics |      6 | 主 fixture 的实际工作频道；诊断与删除                                                   |
| workspace-management       |      3 | 三个需执行场景绑定；运行控制/活动可见性                                                 |
| agent-deletion             |      3 | 主 fixture 的工作频道；删除/历史/只读                                                   |
| run-watchdog-service       |      2 | 主 fixture；有证明终止/续接                                                             |
| managed-mcp-retirement     |      2 | 主 fixture；MCP 退休及 Worker 通路                                                      |
| worker-visible-profile     |      1 | 执行 fixture；私有运行信息不泄露                                                        |

全仓检查另发现 `agent-host/test/multi-lane-agent-host.test.ts` 同类夹具：首次 Task 无 Placement 的红测试已复现；复用第二种绑定后，并发、单 lane、重启与隔离的完整原断言通过（1/1），未改调度实现。

5 个 daemon 文件也复用第二种形态：agent-task-split-chain、daemon-application、same-cli-instance-concurrency、presented-context-second-activation、busy-hold-recovery-chain。消息→运行→回复、并发、补读、暂存恢复断言保留；daemon-application 的新成员通过真正 HTTP Role 命令创建。

### 无 Role 等价物的断言（不隐瞒为“纯夹具替换”）

- persona 自动加入 all、合成 agent.first_run_requested、首次问候未发不得完成、问候设置与自动再问候：Role 实例化不请求该义务。改测第一次真实定向消息及执行 ACK，不发明 Role 自动问候。
- firstRunReplay 的专用一次性 key允许已提交问候重试返回旧事件；保留历史独立单测。Role 普通消息只接受同 key同 payload 重放，改正文须冲突。历史保留 key 的身份/顶层限制、无请求拒绝、durable event 与只发一次仍验证。
- persona 加入第二频道/跨频道提醒：Role 单频道，不能维持正向成功断言。客户端测试改测拒绝二次入频道；提醒改测跨目标明确拒绝，其余同目标投递断言保持。私有资料不可见测试使用同 session 私聊作为另一运行目标，不再伪造第二频道成员。
- Placement 的 memory_reset 操作不允许用于 Role；三个测试使用相同全局 exclusive-operation fence 的 memory_maintenance，保留原 home 所有权、含糊拒绝、队列保留、运行互斥断言。不是宣称 Role 支持旧私有记忆 reset。
- 有实例的频道不能直接删除。usage 删除测试先验证该拒绝，再在**临时 fixture**撤去 Role 关联成为历史快照，验证原历史频道 usage/缺口清理。未对正式库执行该操作。

## 自动检查与实际验证

红测试：无可选开关的 persona 围栏在旧默认值下失败 `2 !== 0`，修复后 0 Inbox/0 Activation；旁边 Role 仍被领取。有效 provision HTTP 请求的 404 断言在旧端点失败 `200 !== 404`，删除后通过。其余迁移针对已观察到的 90 个 fixture 失败，不伪称新产品功能。

Kernel 全量 `node --test packages/kernel/test/*.test.ts`：760/760 通过，原 90 个失败全部恢复。专项 `node --test packages/kernel/test/role-http-closeout.test.ts packages/kernel/test/agent-first-run.test.ts packages/kernel/test/legacy-persona-fence.test.ts packages/daemon/test/legacy-persona-fence-daemon.test.ts`：5/5 通过。四条 Role 命令通过临时数据库上的真实 HTTP 与 SDK 调用验证（无模型进程），包括精确重放和实例修订冻结。正式库部署前只读复核：65 条 Agent 定义、4 条 persona，四者 Inbox/Activation 均为 0。`npm run check` 实际执行至包测试：2779 项、2751 pass、6 fail、22 skip，退出码 1；后续 web/console 单测等串联阶段因失败未执行，不记为通过。6 个新增失败中5个修复后专项通过，远端执行1个仍失败；未重跑并宣称全仓绿。部署被下述远端执行边界阻断。本轮不运行任何付费 CLI；Fake runtime 仅用于确定性执行链测试，不冒充真实模型验收。

## 与任务书不符的事实、未覆盖与风险

- 原 §2.2 防护不是死代码：删除会恢复 persona 调度。执行修订后的无条件保留，而非原文删除。
- 最初 5 个 daemon 夹具不是全部影响面；Kernel 原默认 true 还支撑了上述 90 个测试；原 11 个 provisioning 文件中部分确实测历史 persona 行为。
- 原 first-run 自动问候并无 Role 产品对应，不能伪造“全部断言等价迁移”。保留有意义的历史兼容测试，明确已替换部分。
- 历史 web persona 脚本及 opt-in real-role-contrast 等旧 provision 调用未迁移；旧入口已 404，这些脚本不能作为当前产品门禁。当前 apps/web、apps/console 无此入口调用。
- 本刀不删底层 provisioning、历史 MEMORY.md、persona 数据、协议配置 schema；不处理 fork/side、预热或模型效率，不声称这些已验收。
- 未改 Web/UI，所以按任务书不另跑 UI 浏览器门禁；部署后真实页面只核验产品加载/读取，不证明付费模型工作。

## 审查中发现的远端缺口（修订5明确另刀处理）

全仓检查在原 90 个 Kernel 失败之外又发现 6 个测试失败。其中 MultiLaneAgentHost、Computer application-service、Computer HTTP transport 和 Worker Reminder 都可复用共享 Role 夹具：前者专项 1/1，后三文件专项 6/6 通过（未改变产品实现）。另外 `daemon/test/worker-self-profile-chain.test.ts` 原来在 seed Kernel 内用 persona 预排队，并非那 5 个显式开关文件；同样绑定后实际 Fake 子进程链 1/1 通过。

`packages/agent-host/test/remote-computer-agent-host-control.test.ts` 不同：原 persona 夹具无 Activation；临时迁到 Role 后确实可取得 Placement，但 reconcileOnce 返回 `RAH_INSTANCE_HOST_UNSUPPORTED`，而非原断言的 completed。证据在 `agent-host.ts:485–496`：有 instanceChannelId 且 control 未实现 recordInstanceSessionBinding 就拒绝启动；`remote-computer-agent-host-control.ts` 没有该方法。这是已有明确围栏，不是当前变更引入的 session 缺陷。

该测试原来验证真实远端控制口驱动 persona 的完整执行与 session 续期，确实没有当前可用的 Role 等价路径。迁移实验保留在工作树并仍失败，未伪造绑定回执、未放宽围栏、未删断言或 skip，也未扩展冻结的远端协议。修订4已否决历史快照方向；该方向不再作为后续方案。当前失败必须按远端 Role session 绑定能力缺失处理，见下述逐项对照。

因此检查未通过；本刀尚未部署、提交或推送。正式服务继续原已部署代码。不得以专项绿代替全仓通过。

## 修订4前的停止记录（历史，已被修订5裁定取代）

1. **代码**：上述源码删除与夹具迁移已在未提交工作树完成；保留一项远端迁移实验的失败，待裁定。HEAD 仍 0a33cf5，分支 evo。
2. **自动检查**：Kernel 760/760；Role HTTP/first-run/fence 5/5。全仓 check 包测试 2751 pass /6 fail /22 skip，总2779，失败后阶段未运行。5项新增夹具故障已另行专项验证恢复；不能据此声称完整 check通过。
3. **真实验证**：临时 DB、真实 HTTP SDK 四条 Role 命令成功；没有真实模型调用。正式库只读确认65条定义、4条 persona Inbox/Activation均0。部署后浏览器验证未执行。
4. **部署**：未部署、未做本轮备份或重启、未提交推送。原服务保持，部署脚本仅准备，未执行。不会用失败构建替换正式服务。

修订4后不再提议历史快照兼容方案，也不将成功断言改为拒绝来凑绿。远端绑定能力接线涉及冻结协议，须先裁定范围。

最终补核：上述六个新增失败文件合并复测 9 项，8 pass /1 fail，唯一失败为远端 Role 执行拒绝。`npm run typecheck` 退出码0（根、web、console）；`npm run format:check` 退出码0；`git diff --check` 退出码0、无输出。正式 launchd 仍 running/PID5231。本轮没有改 Web、Console、协议或架构文档。

## 修订4：真实失败位置与逐项回退（2026-10-03）

在独立临时源码副本运行同一免费测试，主工作树和正式服务未回退。副本保留当前依赖版本，分别恢复 0a33cf5 的事件 writer、Kernel/daemon 选项、provision 三层入口及原测试夹具。每组记录调度前数据库计数与首次 scheduleNextPlacement 的实际结果，而非沿用先前日志。

**当前文件中 bindRoleDefinitionFixture 在 postMessage 之前，房间 kind=channel，role_instances 有1行；它是 Role，不是 persona。当前失败不在 scheduleNextPlacement。**

| 对照                                       | Role行 | Inbox/Activation | 首次Placement | 测试结果                                        |
| ------------------------------------------ | -----: | ---------------- | ------------- | ----------------------------------------------- |
| 当前工作树副本                             |      1 | 1/1              | 成功          | reconcileOnce 被 INSTANCE_HOST_UNSUPPORTED 拒绝 |
| 仅恢复旧 writer（含旧可选拦截）            |      1 | 1/1              | 成功          | 同上                                            |
| 仅恢复 Kernel/daemon 选项接线              |      1 | 1/1              | 成功          | 同上                                            |
| 仅恢复 provision 的 service/SDK/Human port |      1 | 1/1              | 成功          | 同上                                            |
| 仅恢复原测试（撤掉 Role 迁移）             |      0 | 0/0              | falsy         | 原 persona 被无条件拦截，符合修订1              |
| 恢复旧 writer及原测试                      |      0 | 1/1              | 成功          | 通过1/1                                         |
| 全部相关改动恢复0a33cf5                    |      0 | 1/1              | 成功          | 通过1/1                                         |
| 基线生产路径，仅加入 Role 夹具迁移         |      1 | 1/1              | 成功          | INSTANCE_HOST_UNSUPPORTED                       |

真实失败点为 `agent-host.ts` 的 Role启动能力检查：`instanceChannelId !== undefined && control.recordInstanceSessionBinding === undefined`。`remote-computer-agent-host-control.ts` 没有接入这个能力；在本刀之前即如此。8组实验未发现修订1误拦 Role、破坏 Placement 的回归；它改变原 persona fixture 的投递是要求的行为。**Role迁移暴露的是此前未覆盖的远端能力缺口**，不是 provision 删除造成的故障。

纠正此前表述：早期未迁移测试确实在 Placement 处失败；加入 Role 夹具后，该处已经通过，失败向后移动到 Host 启动围栏。此前报告把两个阶段压成“persona依赖”过于含混。当前这条 Role 测试没有被 persona guard 跳过。迁移 helper 是本轮工作树新增，基线原测试不含该调用，逐项回退证明了区别。

最小安全处理涉及给现有 Computer execution 协议/服务/远端控制口接入 Kernel instanceSessions.record（保留 Host、RunAttempt、实例、generation 的认证校验），并验证真实绑定回执与重启续接；不是加空函数骗过能力检查。该接线属于目前明确冻结的远端机制能力扩展。本轮不擅自实施，不放宽围栏，不制造历史快照。

四类状态：代码仅补充诊断报告（生产逻辑未新增）；自动实验8组均获得上表预期结果，但产品成功正例仍失败；真实模型/部署后页面未测；正式服务、备份、部署、提交推送均未操作。此前其余修复及已验证结果保留，完整check仍不能标记通过。

## 修订5：远端正例与拒绝负例

负责人确认该缺口既有、另刀处理；本刀不补远端绑定能力，不再使用历史快照方案。

正例改为**协议测试夹具**：不创建 Role 行。产品 postMessage 仍然产生真实 Room event，且明确断言它没有为该通用定义投递 Inbox；测试显式在临时库事务中准备 Inbox/Activation 作为远端协议的输入。随后依然通过真实 Kernel Planner、Computer HTTP、短时凭据续期、AgentHost、Fake 子进程、Worker sync/ACK、RunAttempt/进程终止及 RemoteComputerAgentHostService 第二轮执行，原成功断言全部保留。手工队列只在测试内，不是产品 persona 调度能力，不是 Role 远端运行证明，也没有修改任何生产围栏或加入空回执。

负例使用真实 Role 出处与正常 Room 投递，不使用上述队列注入；同一个真实远端控制口缺少 recordInstanceSessionBinding，要求返回 RAH_INSTANCE_HOST_UNSUPPORTED、RunAttempt失败、runtime process数量0、role_instance_sessions数量0。不得静默新开 session。

TDD反证在独立副本进行：只去掉 AgentHost围栏仍被 GenericProcessAdapter第二层保护拒绝；去掉两层后，负例出现 completed !== failed，按预期变红。还原后正负两例2/2通过。本轮没有修改 agent-host.ts或generic-process-adapter.ts的生产实现。

远端缺口完整边界：当前实际控制协议无法上报Role原生session绑定，Host与Adapter会在spawn前拒绝Role。后续若补齐，需要独立协议、鉴权、generation、RunAttempt归属及重启续接验收。本刀只登记，不能宣传远端Role可用。前述8组二分证明：单独回退拦截/选项/provision无效；基线仅迁Role也失败。因此未发现修订1误拦Role或破坏Placement的回归。

最终全仓检查、备份、正式页面、提交推送结果在完成后写入下一节；以上历史失败数字保留，不替代最终检查。

## 最终验收与部署

### 代码

修订1–5范围已完成：Kernel无条件persona拦截；可选调度开关及daemon接缝删除；provision HTTP/SDK/Human端口退休；协议配置Schema保留；共享Role夹具迁移；远端协议正例与Role fail-closed负例分离。远端绑定能力未扩展。文件职责、11文件分类、90失败迁移、无Role对应的断言见前文。未改Web/Console产品或协议Schema，未改表结构。

### 自动检查（最终一次）

`npm run check`退出码0，完整串联执行，无失败例外：

| 阶段                                                   | 通过 | 失败 | 跳过 |
| ------------------------------------------------------ | ---: | ---: | ---: |
| packages 全量（总2780项）                              | 2758 |    0 |   22 |
| Web单测                                                |  487 |    0 |    0 |
| Console单测                                            |   59 |    0 |    0 |
| CLI效率脚本单测（非付费）                              |  236 |    0 |    0 |
| 仓库/CI/发布/启动单测                                  |   51 |    0 |    0 |
| UI component spec / Raft registry                      |   74 |    0 |    0 |
| parity regression / browser policy / bilateral capture |   52 |    0 |    0 |

检查还包含根/Web/Console typecheck、UI库/choice/catalog/contract校验，均退出0。各阶段数字是实际运行项，不声称去重覆盖率。22个跳过项保留原opt-in条件，未为本刀新增skip。

专项Kernel 760/760；远端正负例2/2；临时HTTP Role quartet部署后再跑1/1通过。`npm run format:check`与`git diff --check`通过。未修改Web/UI，不额外跑专项UI浏览器门禁；check自身包含的UI choice检查已实际运行。

### 真实验证

临时库上的真实HTTP+SDK调用验证role.create/instantiate/list/revise，精确重放、不可变实例修订与已删provision返回404；没有实际模型调用。正式Chrome刷新4176后读取P95频道历史，再打开Role管理、P95 Codex A，确认配置（gpt-6-luna/low）、指令、参与频道与实例信息正常；未发送消息、创建实例或保存配置。

正式库仍65条Agent定义，其中4条遗留persona全部保留，四者Inbox/Activation均0。11表（消息、Task、Role模板/修订/实例、记忆条目/修订、session绑定、Room事件、Agent定义、Inbox）全量行哈希与重启前一致；quick_check=ok，foreign_key_check为空，schema81未变。私有目录由完整state备份保留，未删除或迁移。

### 部署

2026-10-03：检查无活动工作后，对room.db与runtime-registry.db执行sqlite `.backup`并逐个quick_check；另有完整state备份与校验、升级副本预检。备份位置：

`~/.loom/evo/backups/pre-restart-backend-closeout-bf2e7f9d-6e37-41f3-9cd8-753628751fbf`

优雅bootout旧com.loom.evo（PID5231），确认旧进程退出再bootstrap同一plist，新PID35927监听127.0.0.1:4176。没有强杀。沿用已验证前端snapshot/buildId 30db8e5d1da11648；服务由Node运行本次通过check的TS源码，部署时记录并核对packages/scripts逐文件SHA，未另造二进制构建结论。正式数据目录未搬迁，4条SOS保留队列未启动，预热仍关闭。产品提交号在status当前部署行回填。

### 未覆盖与遗留风险

- 没有付费CLI、效率对照或真实远端Role验收，不声称本刀验证模型行为。
- 远端Role绑定能力仍缺失，已有双层拒绝围栏与新增负例守住，单独一刀处理；8组对照未发现修订1误拦Role回归。
- 历史persona脚本与低层兼容代码仍在，已删入口不再可用；保留历史数据不等于恢复persona产品路径。
- 本刀只完成所列范围，不宣称整个后端或全部legacy清理完成。
