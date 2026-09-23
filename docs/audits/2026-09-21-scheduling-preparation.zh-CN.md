# 调度与回复延迟：冻结基线、差异和修复准入

日期：2026-09-21。范围：用户要求的五项修复前准备；不改变生产调度、提示词、会话或 ACK，不运行付费模型，不重启正式服务。

## 1. 基线与证据边界

冻结提交：`9f5a83e99b6efb5efeb3dac5413d782be5100209`（UI milestone v2）。开始时 tracked tree 干净，仅有原有未跟踪 scratchpad。本批新增诊断工具、测试和证据；不覆盖 scratchpad。

[基线清单](../evidence/2026-09-21-scheduling-preparation/baseline.json)记录源码哈希、CLI 版本、正式健康标识、资产租约、当前 Agent 的模型意图/会话策略、Provider 会话键及会话 ID 哈希。没有导出凭据、消息正文、角色内容或私有记忆。

- Node 25.9.0；Codex 0.155.1；Claude Code 2.1.278；Kimi 0.39.1；OpenCode 1.18.30。仅运行 `--version`，未调用模型。
- 正式 Web build ID `179d7a0b517d363b`，构建于 2026-09-20T16:42:35Z；源提交发生于 16:46:32Z，不能由时间接近推断内容一致。
- 当前正式后端是源码加载的 `scripts/run-local-workbench.mjs`，没有暴露可核验的后端制品哈希。**正式进程与冻结提交的字节一致性尚未证明**；后续性能门禁使用冻结源码的隔离 daemon，正式发布时再核对构建/重启。
- Raft Computer 1.0.32 发布实现 SHA-256：`531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`，本次重新计算一致。原 /tmp 文件已不存在，改从本机 `raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.32/main.js` 核查。
- [上游来源与许可](../evidence/raft-release-20260916/manifest.json)：发布后的转译实现，仅分析；不是完整原始仓库，也不包含中央 Server 实现。未复制 bundle 到生产，不能宣称后端数据库逐字复刻。
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `server/pkg/agent/claude.go`、`kimi.go` 为辅助接入对照；其 ACP resume 拒绝/历史流过滤机制不能代替 Raft 协作调度合同，本批不引入第三方代码。

## 2. 场景对照及单一 owner

下表 Raft 行号均指上述哈希的 main.js；“一致”仅指该行为，不表示性能或整个生命周期已相同。测试入口见第 4 节。

| ID / 场景             | Raft 可核实行为                                                   | 冻结 RAH / owner                                                                            | 判断及后续动作                                                                                                  |
| --------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| S01 普通 DM/频道唤醒  | 844205–844225、836169：content-free inbox notice，提示 check/read | agent-host/provider-activation-input.js：固定启动说明，首调 check --startup                 | 普通无正文方向一致；RAH 缺逐目标 unread 摘要，非已证明的主要慢点                                                |
| S02 消息列首次上下文  | 844213：有 thread-join context 时具体消息可内联                   | 仍走 Worker check 与 canonical Thread 路由                                                  | 输入表面不同；不能由特殊分支推断所有唤醒都应内联正文                                                            |
| S03 读取与 ACK        | 807724：check 排空并确认；50 轮上限                               | worker-message-check.ts 输出成功后逐页 ACK；application-service 保管交付页，Kernel 验证游标 | 结构移植；RAH output-before-ACK 和有限 Activation 重放属可靠性适配，不移除                                      |
| S04 历史范围          | inbox 增量，历史另 read；可有补读分支                             | room-kernel.ts syncWorker 限 throughSeq，首 check replay 已冻结交付窗                       | 不是每次从头读全频道；崩溃恢复合法重放须与重复灌历史区分                                                        |
| S05 同 Agent 会话     | Agent runtime 绑定 session，turn_end 更新绑定（847860）           | ProviderSessionStore 按 Agent/provider/profile/prompt digest/mount 复用                     | 不因缺 roomId 判错；不默认拆 Room、不按 45 分钟/40 轮轮换                                                       |
| S06 Kimi 规则         | 820569：standing roleAdditional/harness 原生层                    | kimi-acp-driver：fresh 用户输入全文，resume 仅指针                                          | fresh 注入位置待验证改进；“当前每轮重加全文”不成立，已有回归                                                    |
| S07 启动记忆/manifest | 815061：每轮读完整 MEMORY.md、正文按需                            | startup 返回完整索引及 context/manifest                                                     | 全索引保留；manifest 重复量可测量瘦身，不以裁剪记忆换速度                                                       |
| S08 回复后收尾        | 815061–815068：完成工作后停，不轮询等新消息                       | standing-prompt-compiler 仍有 and then acknowledge                                          | 已复现提示冲突；可进入最小修复，不承诺固定少一轮模型生成                                                        |
| S09 忙时追加          | direct/steer、可见消息本地 pending 去重（843357、848352）         | Host 原生接纳仅传输证明，Kernel 后续 Activation 仍待 ACK                                    | 部分对齐；已有“同 Run 回复后续消息，仍再运行确认”的历史证据，需跨层复现，不能删 queued 绕过                     |
| S10 同伴回复          | 全员投递受 mute/目标约束（848545）                                | 顶层成员 attention，Thread 只给有效关注者；Kernel 拥有                                      | 无可见回复不等于无效运行；分别检查重复触发和合法静默                                                            |
| S11 freshness hold    | 815645–815699：未见消息导致 held draft                            | Kernel held draft，读返回的新事实再重发                                                     | 机制不是 RAH 独有；验证有限范围/幂等恢复，不关闭新鲜度保护                                                      |
| S12 停止后重发        | stop epoch/旧进程停止保护，具体中央事务不可见                     | Room SOS、terminal proof、纠正输入与 queued 合并                                            | 修复已在冻结树，前/后 terminal 两种顺序测试通过；真实 Provider 仍待复验                                         |
| S13 退出与恢复        | 847860：persistent runtime 保留，per-turn 退出                    | 有限 Run 与进程 terminal proof 耦合                                                         | 明确差异；进程启动快不代表 lane 尾部占用/后续重跑无成本，不能整体宣布常驻无价值                                 |
| S14 缺失会话/断连     | 运行器恢复分支；Provider 能力各异                                 | 四家 adapter 专属 resume 与有证据的 fallback                                                | fake 协议门禁通过；要测实际 session ID 连续性，不只看 sessionPolicy 标签                                        |
| S15 presented 残留    | 不由普通 content-free notice 自动 ACK                             | message-present API、Kernel window、Codex turn/start acceptance 注册仍在冻结树              | 与 Claude 草稿“已撤回”冲突；未看到当前普通 wake 获取正文，不能声称已启用直灌；必须先完成调用范围与退役/登记裁决 |

同一 Agent 的单 lane、身份/成员隔离、交付确认、Task 履约、进程终止证明继续由原 owner 负责。Provider 会话/轨迹是诊断，不新增业务队列或第二套游标。

## 3. 测量合同与实际只读核查

新增 [阶段审计工具](../../scripts/scheduling-phase-audit.mjs)（独立诊断 owner）：

```sh
node scripts/scheduling-phase-audit.mjs /absolute/path/to/room.db 100
node --test scripts/scheduling-phase-audit.test.mjs
```

以 SQLite readOnly + query_only + 单读事务读取最近 N 次 Run；导出字段白名单，无消息正文、tool 文本、凭据或 Provider transcript。测试验证数据库文件不变且敏感内容不导出。

已对正式账本运行，保存[阶段表](../evidence/2026-09-21-scheduling-preparation/formal-phases.json)。100 次 Run 全部 exited，时间 2026-09-20T01:25:10.250Z 至 13:52:16.855Z；2 次 attemptNumber > 1；22 条可归因 post、80 次无可归因 post。**这不是 80 次无效调度**：可能是合法静默、其他业务动作，或缺少 post 归因字段，不能从无 post 推定无用。

字段的准确含义：

| 字段                                           | 含义 / 不能推导的事实                                                                |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| activationAgeAtRunStartMs                      | Activation 创建至该 attempt 开始；重试时含旧运行时间，不叫纯排队时间                 |
| firstToolAfterRunMs                            | 已记录第一个 tool_start；无轨迹则 null，不是首 token                                 |
| firstAttributedPostAfterRunMs                  | 相同 actor/activation 且在 attempt 时间窗的第一条 post；可能是进度，不是正确最终答案 |
| postToFinishMs                                 | 上述 post 至 Run 结束；不直接等于全部无效收尾                                        |
| startMarkerCount                               | 当前 init/turn/prompt 标记数；不代表单次模型请求数                                   |
| modelRequestsBeforeReply / usage / rateLimited | 当前无法可靠取得，明确 null；不从 silence、工具数或账户额度猜测                      |

运行中的 attempt 保留 finishedAt/duration 为 null。Activation 的 fromSeq/toSeq 是当前投影，不冒充历史 attempt 的实际交付范围。跨目标 post 缺 activation provenance 时不强行归因。正式账本样本跨不同模型与问题，不计算“Raft 比 RAH 快几倍”。

后续原生观测必须增加 providerSession 哈希、resume requested/confirmed/fallback reason、requestId/turnId/Run 对应、单请求 usage 或明确 aggregate scope、cache read/create、工具输入输出字节、实际交付消息 ID/序号、hold/retry、首 token 与明确 429/retry 信号。不可得标 unknown。保留原始时间来源与延迟接收误差；模型请求与工具调用不能等同。

默认编译提示实测 47,158 UTF-8 bytes / 47,004 字符（不含 Agent 定制层）；不是 token 数。其本身较大不证明每轮重复新增，也不能由 moving-to-system 推断 token 自动减少。

## 4. 可复现测试与修复优先级

[验证记录](../evidence/2026-09-21-scheduling-preparation/verification.json)保存命令、结果、日志摘要与哈希。

- 16 个现有定向文件、77 项通过：四家 Provider session、store、startup/check 输出失败和重放、已交付与未来消息隔离、busy notice、Codex boundary、SOS 两种到达顺序、persistent pause、freshness hold、真实 HTTP + fake runtime 贯通。
- 新阶段审计测试先因工具不存在失败，最小实现后通过；覆盖未知指标不伪造、重试年龄、边界时间、未完成运行和只读脱敏。
- [提示词复现](../evidence/2026-09-21-scheduling-preparation/reproduce-post-ack.mjs)为显式 opt-in RED：直接调用真实 compiler，要求 emitted prompt 不再命令 post 后 ACK，冻结树失败。仅验证可见提示冲突，不声称证明真模型必定多调一次。
- 已有绿色测试不是新发现的失败。Kimi 恢复不重复规则和 SOS 已修复，不能为制造 RED 而撤销实现。

执行提示词 RED：

```sh
node --test docs/evidence/2026-09-21-scheduling-preparation/reproduce-post-ack.mjs
```

修复开始时将该断言迁入 owner 的常规测试，先失败后最小修改，不在准备阶段修生产提示。

尚缺的确定性反例：同 Run 已回复冻结范围外的消息后，后续交付怎样避免无效模型运行且仍保证 ACK/Task 义务；跨 Room、未输出页、接受后崩溃、消息在收尾中到达、恢复失败等必须一起覆盖。不能仅以“存在回复”为自动消费证明。该项未准备到可安全修改 Kernel 的程度，列入独立批次，不阻塞提示词小修。

## 5. 施工与退出条件

| 批次             | 修改范围及 owner                                  | 开始条件 / 验收                                                                                        | 回退                                                |
| ---------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------- |
| A 基线冲突裁决   | application-service/Kernel/Host 的 presented 残留 | 明确是否保留、退役；未登记表面检查恢复；拒绝以补登记伪装已撤回                                         | 不改正式数据库，不删除历史兼容数据                  |
| B 诊断补齐       | agent-host 原生事件边界，daemon 聚合              | 真/假协议帧区分 request 与 turn、unknown 与 0、单请求与累计 usage；不改变业务状态                      | 关闭新增诊断采集，旧轨迹仍可读                      |
| C 最小提示修复   | daemon prompt；agent-host startup 输出            | post-ACK RED 转绿；保留完整索引、身份/路径/因果字段；防止 prompt digest 变化无意清空所有会话           | 恢复 prompt 及受验证的兼容策略，不删除 session 记录 |
| D Kimi 原生规则  | agent-host ACP driver                             | 先验证安装版 agent-file/roleAdditional、fresh/resume/compaction，失败保留现状；system token 仍计成本   | 可恢复旧 driver，保留旧会话映射                     |
| E busy/follow-up | Kernel 交付/义务 + Host capability                | 先做上述跨层失败复现，再设计去重/交付闭合；不把传输接受当 ACK                                          | 独立开关或可回退版本，持久工作不得丢弃              |
| F 双边性能验收   | 隔离测试 harness                                  | 同 Provider/model/effort、相同题与上下文级别，核验实际 session；分开 fresh/warm/long-session/busy/stop | 不触碰正式 Agent 与私有记忆                         |

不采用默认 45 分钟/40 轮轮换、不按 Room 强制拆会话、不裁剪 MEMORY.md、不移动 ACK 到 post。长期会话控制如仍有必要，应作为另立的可选增强，先证明会话连续性不会损失。

速度目标不是固定 1 次生成、30k token 或 6–8 秒。先取得同条件 Raft baseline，以预先约定的 warm 简单问答 p50/p90 相对差、端到端 post 与 lane idle 分开评价；同时报告全部样本、失败与限流，不能只删慢样本。少样本 p90 只作探索，不作发布承诺。必须先检查正确回复、无丢交付/重复动作、连续对话，再比较延迟与每轮新增 token。

## 付费验证边界及建议范围

本批模型调用为 0。建议先批准小规模四 Provider 对照，而非原计划一次 72+ 问题：每家 RAH 隔离 Agent 做 1 次 fresh + 3 次连续 warm，原生 CLI 同样 4 次，共 32 次 Human 提交；Raft 普通 DM 同条件再 16 次，共 48 次。**这些是用户提交次数，不是模型 API 请求上限或费用上限**。必须确认 Raft 可选择完全相同绑定/推理档及账户条件，否则只报非等价参考。使用 Sonnet/low、gpt-5.6-luna/low、deepseek/deepseek-v4-flash/low、kimi-code/k3/high；不能静默替换。busy/双 Agent/stop 的下一批在简单问答证据通过后单独批准。

此阶段样本只用于定位，不足以证明尾延迟持平；正式性能验收再按初测方差决定重复次数。连续性测试包含未要求写入 MEMORY 的近期约定、跨 Room 切换、工作途中追加，不只测试显式写记忆后召回。不存在进行中 Task 不等于可以丢掉普通讨论上下文。

## 本批交付范围

五项准备均已有可复查产物；本地测试与只读核查已执行，模型层 usage/实际请求计数、真 CLI 与 Raft 双边速度仍未验证。正式部署 hash 一致性也未证明。完整检查和全量测试的最终状态以验证记录为准，不能用定向绿色代替全量绿色。

本次没有修复生产行为、运行模型、修改正式会话或重启；因此不宣称回复已变快或调度已全面对齐。下一步可以安全进入明确的小批修复，不能直接进入未经设计的会话轮换或 ACK 改造。

### 冻结基线门禁结果

- 定向 77/77、新诊断工具 4/4 通过；提示冲突复现按预期 RED。
- `npm test`：1,757 通过、3 失败、17 个付费门禁跳过。失败分别为 `room-kernel.ts` 7,102 行超过 6,925 限制；迁移保护测试预期 schema 56、实际 57；UI token 图标几何 SHA 不匹配。相关生产/测试文件本批均未修改，不能把此冻结基线宣称为全绿。
- `npm run check` 在 `check:raft-parity` 因未登记 `/v1/worker/message-present` 停止，后续门禁未因此执行。
- `npm run format:check` 报 5 个原有文件（验证 JSON 列明），没有替用户格式化其他工作。
- 独立执行 `npm run typecheck` 通过；本批文件单独格式检查、报告链接检查及 `git diff --check` 通过。未涉及 Web 产品改动，未构建或重启正式工作台。
