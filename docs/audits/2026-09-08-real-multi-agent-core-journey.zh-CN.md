# Room／DM／配置／记忆：真实多 Agent 双边旅程

日期：2026-09-08。状态：真实核心旅程发现阻塞性恢复故障；基础协作与记忆样例通过，不能交付为高可用。

后续修复：[执行中恢复与后台失败传播](./2026-09-08-core-recovery-repair.zh-CN.md)。以下保留修复前的原始实验结论；当前恢复状态以后续证据为准。

## 范围与证据等级

本轮由 Human 明确授权在 RAH OS 与 Raft 上执行真实 Agent 实验；未处理其他施工 Agent 负责的六组接口差异，未修改产品代码、提交或发布。RAH 使用独立持久状态、测试 cwd 和端口 4197，是真实 CLI 实验，不是正式产品部署，也不是 Fake CLI。正式 4173 未由本轮停止。并行工作树仍有其他施工，不能把本轮称为冻结候选的最终发布门禁。

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-multi-agent-journey/`。日志和导出的会话归档属于本地诊断证据；原始 provider 归档不作为公开附件。本文只呈现实验文本、业务结果和白名单配置字段，不发布凭据或模型内部推理。

Raft 为已登录官网实操；本地为浏览器真实操作、canonical SQLite 状态及真实 provider 会话导出。两边采用相同任务、成员关系与停止条件，替换相应 handle；初始模型组合不同，因此是行为语义对照，不是同模型性能比较，也不是相同 viewport 的视觉验收。

## 专用对象

| 对象    | Raft                                                        | RAH                                                             |
| ------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| Agent A | ParityAuditorA，OpenCode／DeepSeek V4 Flash                 | Kimi，Kimi K3 low                                               |
| Agent B | 新建 ParityReviewer0908，OpenCode／DeepSeek，之后切 Kimi K3 | OpenCode，原 OpenCode／DeepSeek low，之后同一身份切 Kimi K3 low |
| Room A  | parity-loop-0908，Human＋A＋B                               | Agent Council，Human＋A＋B                                      |
| Room B  | parity-memory-0908，Human＋B                                | parity-memory-0908，Human＋B                                    |
| DM      | Human 分别与 A、B 私聊                                      | canonical Direct Room，重复打开保持同一 Room                    |

名称只是稳定身份标签；RAH B 切换后显示名称仍含 OpenCode，实际 CLI 已是 Kimi，不能按名称判断执行器。
Raft UI 对 OpenCode 未显示 effort 选择，对本次 Kimi 显示默认；未把默认宣称为 low。

Raft 可复查入口：

- [Room A](https://app.raft.build/s/hakasemac/channel/c01a0a8c-e308-4d96-b716-55beec3bcf3d)
- [Room B](https://app.raft.build/s/hakasemac/channel/9323eacc-61b1-43ef-b110-a067a93680e8)
- [B 私聊](https://app.raft.build/s/hakasemac/dm/898aafbf-497a-4752-bf32-9949d94aa79a)
- [A 私聊负向对照](https://app.raft.build/s/hakasemac/dm/eeeb5b7d-a7df-4f40-b273-bcbf8c4ee1bf)

## 已观察结果

| 实验                       | Raft 实际结果                                                                         | RAH 实际结果                                                                                      | 裁决与限制                                                            |
| -------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| J0908 临时工作／审计分工   | 一条 Human 启动指令，A 提交、B 核算，连续三轮，第三轮 COMPLETE 后停止                 | 同样六条 Agent 回复、三轮及目标停止；真实 Kimi＋OpenCode                                          | 基础多轮协作通过；不是无限自主工作或复杂项目审计保证                  |
| M0908 私聊形成私有记忆     | 实际 MEMORY.md 写入三个虚构事实；没有观察到最初要求的 STORED 聊天回执                 | 显式 STORED，MEMORY.md 索引与 notes 文件实际写入                                                  | 文件形成通过；Raft 最初缺少聊天回执单独记录，不能假称一致             |
| 另一 Agent 负向对照        | A 回答不知道，自己的 MEMORY.md／notes 没有该资料                                      | A 回答不知道                                                                                      | 未自动共享记忆通过；不是同 UID 全盘访问条件下的强沙箱证明             |
| 清空执行会话后跨 Room 召回 | B 重置会话保留记忆，进入仅 B 参加的 Room B，正确回答三个事实                          | B 切 OpenCode→Kimi 后进入新 Room B，正确回答三个事实                                              | 同 Agent 跨 Room 连续性通过；未据此证明任意跨 Room 查询授权组合       |
| 更正后新会话回 DM          | Room B 更新记忆；切 Kimi K3 会重置旧运行时会话；DM 回答新值、旧值无效，颜色／限制不丢 | Room B 更新记忆；空闲服务重启，再重置执行会话；同一 DM 回答新值、旧值无效及原限制                 | 更正与新会话召回通过                                                  |
| DM 返回 Room A             | B 从私有记忆正确复述更正后的值                                                        | B 同样正确复述                                                                                    | 负向对照已先完成；返回 Room 后共享的答案不再是 A 不可见事实           |
| T0908 两条 Thread          | X/Y 各自一条执行、一条审计，结果分别为 121/144 与 AUDIT PASS                          | canonical 两个不同 thread_id 各自一条执行、一条审计，没有合并串线                                 | 本次四条结果正确；本地 Y 在 X Run 运行期间入队，忙时 follow-up 成立   |
| 实际 CLI/model/effort      | UI 显示 Kimi K3 默认；未独立导出官方实际请求参数                                      | 同一 B 身份切至 Kimi；native export 的 7 次实际 llm.request 全为 kimi-code/k3、thinkingEffort=low | RAH 参数不是仅改前端；不能把本地请求证明外推至官方或其他全部 Provider |
| 空闲服务重启               | 未重启用户整个 Raft Computer                                                          | 消息、Agent 定义及 revision、Room、membership 前后逐行相等，浏览器刷新恢复                        | 仅本地通过，不是双边服务重启验收                                      |

M0908 使用虚构资料：初值 cedar-7264、琥珀色、禁止周二发布；更正后的唯一有效值为 maple-9138。查询提示不提供答案。Raft 更正文件明确保留旧值但标为作废；RAH notes 同样标为 REVOKED。未要求系统自动摘要、重写或添加记忆引擎。

对应文件：`local-real-multi.log` 为真实双 CLI 前置门禁；`local-loop.log`／`local-loop.test.ts` 为独立三轮实验；`local-canonical-after-threads.json` 为实际消息、Thread、Activation 和 Run 记录；`kimi-actual-request-evidence.json` 为白名单实际模型请求；`provider-session-after-switch.json` 为身份／provider session 绑定；`restart-state-comparison.json` 为首次空闲重启的数据对照；`raft-corrected.md`／`rah-corrected.md` 为本轮虚构资料的更正后文件副本。

## 实验中发现的边界

1. 官方创建频道时，原生 UI 成员勾选与预期不一致，已先打开成员设置核实并补正，再发送实验。错误前提不计入对照结果。
2. 官网返回 Room 的一条 native typeText 中文输入被输入法处理成不完整文本，Agent 正确请求澄清。使用 paste 重发完整指令后成功。这是测试输入问题，不作为 Raft 幻觉或业务故障。
3. 本地独立端口仍使用同一 loopback 主机，出现会话更新提示；源码使用固定 rah_workbench_session Cookie。Cookie 不按端口隔离，存在与其他实例相互覆盖的可能，尚未单独复现归因。失败的 Y 发送仍保留在输入框；刷新后只发送一次成功消息，canonical 没有重复。
4. 本地 Room 的 Thread 预览更新后，已打开的消息列辅助功能树一度仍显示旧内容；刷新后截图确认三条回复完整可见。刷新前未保存对应截图，不据此直接裁定真实渲染缺陷；需要同一冻结候选下重新复现并同时检查真实画面、DOM 与网络。
5. RAH 的配置原则是下一 Run 生效、现有 Run 冻结；官方切 CLI 弹窗明确要求重置运行时会话。本次在空闲时切换，忙时差异尚未完成双边实验，不能直接将安全性差异判为缺陷。

## 执行中恢复：已复现阻塞，未修复

R0908 于 19:15 在现有 Thread 中要求 B 执行一次 `sleep 30` 后显式回复，并在重试时先查是否已回复。
19:16 停止前的只读证据确认 B 的 Run 为 running，canonical 尚无 R0908 RECOVERED；已备份数据库并校验停止的是独立 4197 实例。

本轮只向服务父进程发送 SIGTERM。产品自身在 `drainTimeoutMs=30000` 到期后终止子进程，旧 Run 记录为 cancelled、exit_signal=SIGKILL、error=`daemon drain timed out after 30000ms`。该旧 Run 的退出来源没有被重写。
一次过早启动受到 AgentHost 单实例锁拒绝；旧父进程完整退出后重新启动，仍复现下述问题，因此不能把最终故障仅归因于过早启动。

新的 Host generation 为同一 Activation 创建 attempt 2 的 reserved Placement，却没有创建新 Run，最后 Host 转为 offline。没有 R0908 RECOVERED 消息。
保留现场后，用相同状态和正常 DaemonApplication composition 再次运行只记录错误的外部诊断脚本，重复得到：

```text
ExecutionFencedError: run attempt run_8ce5d99b-6612-4260-a1d5-da2574f0095a belongs to another Host generation
  RoomKernel.#requireRunAttemptHostGeneration
  RoomKernel.#requireActivationHostGeneration
  RoomKernel.claimNextPlacement
  AgentHost.reconcileOnce
FINAL_HEALTH: state=failed, lastError=MultiLaneAgentHost workers failed
```

**根因定位**：`packages/kernel/src/room-kernel.ts` 的 `#requireActivationHostGeneration` 查询该 Activation 最新 Run，而未区分它是否属于本次 Activation attempt。新 Placement 被领取时，上一代已取消 Run 仍优先于新的 reserved Placement 做 generation 校验，合法重试被旧 Run 拦住。源码分支与真实异常栈一致；尚未写回归测试或修改实现。

**第二个生命周期缺口**：`local-core-workbench.ts` 的 runningWorkbench 只在 stop 时等待 applicationRun，没有将已启动 daemon 的后续失败传给外层；`restartable-local-workbench.ts` 的 failed 仅接重启操作失败。结果后台失败、数据库 Host offline 后，外层 4197 仍监听，`/_rah/health` 固定返回 online。本轮已实际观察这一组合。此 endpoint 不能被当作 AgentHost 工作正常的证据。

修复顺序及 owner：

1. Kernel：先加入“旧 Run 已终止且旧 Placement 已释放→新 Host 创建新 attempt→新 Run 能领取”的失败测试，同时保留旧 Host、旧 Run 迟到写入必须被拒绝的反例。基于当前 attempt／有效 Placement 判定 Activation 代际，不删除运行围栏，不改旧执行来源。
2. daemon／launcher：注入启动后 runner 失败的测试，让外层明确失败或退出并准确暴露状态；不能只改 health 文案掩盖后台已终止。
3. 原 R0908 场景复验：同一未完成 Activation 自动恢复、恰好一条结果、原 Thread 不变、旧 Run 仍保留 cancelled 来源，再检查另一 Agent 可继续处理工作。
4. 通过后再推进忙时配置切换及更多跨 Room 组合，不广撒网绕过此阻塞。

这是 RAH 自身已声明恢复合同的失败，不依赖声称 Raft 也使用同一种本地 Host 架构。没有重启用户的整个 Raft Computer，因此官方同条件服务故障结果仍未知，不能把本地失败包装成已完成的 Raft 双边重启差异。

证据：`active-restart-before.json`、`pre-active-restart.db`、`active-restart-stalled.json`、`recovery-diagnostic.mts`、`recovery-diagnostic.log`，以及三份有明确先后关系的重启日志。隔离实验服务已停止，测试状态及双方专用 Agent／频道保留；没有修改正式工作台数据。

## 尚未签收

- 执行中断后的恢复实验 R0908：已失败并定位上述两处责任边界，尚未修复。
- 忙碌时切 CLI/model/effort 对旧 Run／其他 Agent 的实际影响，官方与本地分别取证；目前实际请求证明只覆盖本地 Kimi K3 low。
- 跨 Room 主动消息寻址、未加入 Room 的拒绝、跨 Room 并发上下文冲突，需要独立于记忆召回验证。
- 多轮真正返工分支、长时目标停止、更多并发／重复网络／迟到请求组合，不由三轮算术样例覆盖。
- 记忆无文件对照、压缩后重读、长时间维护质量及各 Provider 的隔离强度，本轮尚未完成。
- 同 viewport 视觉验收、正式冻结构建及正式部署，不属于本轮已验证结果。

后续仍按一个失败点一份证据、一条最小修复、一条回归收口；不重新设计已通过的 Room／DM／memory owner，不把尚未观察的情况写成产品缺口。
