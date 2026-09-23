# Claude / Codex 调度与输入膨胀根因结论

本轮承接 [Speed_test 后续核实](2026-09-21-speed-test-followup.zh-CN.md)，
只分析已有原生记录、持久账本与源码，不再增加付费调用、不重置会话、不改生产代码。
模型/强度已匹配的 Claude、Codex 足以定位实现差异；不以其他 Provider 档位为前置阻碍。
[结构化证据](../evidence/2026-09-21-scheduling-preparation/scheduling-root-causes.json)
记录统计口径、原生文件和上游发布包 SHA-256。

## 总结

确认两条主要放大链：

1. 内部执行事件进入模型消息投影 → 每轮 check 追加大量 JSON → 持续恢复原生会话
   使这些内容累计保留 → 后续生成输入越来越大。
2. 当前执行只能确认冻结 Activation 窗口，但 read/held 能看到更晚消息 → 已展示消息
   仍保留后续 Activation → 再启动、再读取、再生成 → 同时产生更多内部执行事件。

这两条链可以相互放大。它们不是 SQLite 慢、每次会话丢失，也不等于每轮把全部
聊天历史重新查出来。第三类问题是回复责任：delivery ACK 与业务回复本来就不同，
模型可能检查成功后认为不需要发帖；泛问候漏回已定位此路径，不能推导所有失回应
都同因，也不能为了要求回复把所有聊天变成 Task。

## 1. 原始账本投影过宽是主要可修复输入来源

RAH `room-kernel.ts:5141` 的 syncWorker 经 `room-sync.ts:125` 查询整个序号窗口，
没有面向模型的事件类型过滤。`worker-read-render.ts:466` 对消息渲染正文，对其他
事件直接输出事件头和完整 payload JSON。`workerDeliveryReplayStart` 从持久 cursor
与 Activation 来源确定范围；上次 ACK 后产生的收尾事件会进入后续 check。
因此业务消息之间的 placement/run/activation 事件被稳定追加进原生会话。

S1 前累计原生工具结果（字符数，不是 tokenizer 归因）：

| 项目                          | RAH Codex | Raft Codex | RAH Claude | Raft Claude |
| ----------------------------- | --------: | ---------: | ---------: | ----------: |
| 工具结果字符                  |   310,828 |      4,826 |    334,510 |      39,416 |
| 其中 execution 事件行及 JSON  |   183,592 |          0 |    215,785 |           0 |
| startup context 次数          |        13 |          0 |         14 |           0 |
| startup manifest/context 字符 |    36,785 |          0 |     39,438 |           0 |
| startup MEMORY 段字符         |     7,375 |          0 |     23,887 |           0 |

execution 仅统计 activation.* / run.* / placement.*，不把 Task 状态、成员变更等
业务事实统称垃圾。事件段和 startup delivery 有重叠，表中各项不能相加。
这是截止 S1 的已记录工具输出累计，不能宣称等于模型当前保留 token，更不能
证明 Raft 不读取记忆：其记忆/系统指令可以经不同通道提供。

更强的同题增量证据：

| 同一 S1                         |          RAH |      Raft |
| ------------------------------- | -----------: | --------: |
| Codex 首 check 输出字符         |       15,805 |       267 |
| Codex 首次到第二次请求输入增量  |  6,999 token | 215 token |
| Claude 首次到第二次请求输入增量 | 12,232 token | 281 token |

请求增量还含模型工具调用和 Provider 包装，不能全部标成纯 check 的 tokenizer 数。
但它把差异定位到这轮读取附近，无须先清空两边历史才能证明新增成本存在。

修复 owner：Kernel 的模型可见投影/回执边界、AgentHost renderer；原始 Room ledger
完整保留。必须明确业务事件白名单与内部事件无需呈现的协议语义，再测试 ACK 跨越
纯内部事件、分页、Task 取消/改派、失败重放，不能简单删除数据库事件或截断正文。

## 2. 每轮 startup 重复追加，以及 cwd 带入的环境内容

`worker-startup-context.ts` 每次生成 Activation/Agent/manifest/appInbox JSON，
再读取完整 MEMORY.md。`provider-activation-input.js` 要求每个 Activation 首次
执行 message-check --startup。因此不变资料以工具结果反复写入恢复的会话历史。
本例 MEMORY 很小，不是唯一或最大的来源；不应先上截断记忆方案。

原生 Codex 开场站立指令：RAH 55,577 字符、Raft 51,140 字符，二者都不短，
不能宣称 RAH 仅靠站立指令就多出十几万 token。RAH 还在仓库 cwd 启动，首条
Provider 环境用户内容约 20,136 字符，含仓库工程指引；Raft 的对应内容约 1,196。
这是执行目录/环境输入差异，不是频道历史。不能全局禁止读取用户选定项目的规则；
应核对这些旧 Agent 是否本应使用私有 cwd，再单独处理明确选择仓库的场景。

Claude 记录中 deferred_tools_delta / mcp_instructions_delta 为 RAH 34 / 31 次，
Raft 6 / 5 次。原生附件 JSON 不等于模型实际输入文本，因此只作为会话恢复/工具环境
重复更新的次级迹象，不用其序列化大小冒充计费 token。没有证据证明每次会话都重建。

修复 owner：AgentHost 的 startup 与 session/环境边界。稳定指令与变化信息分离、
按已确认版本复用必须兼顾角色修改、记忆变更、resume 失败、新会话和崩溃恢复；
不能把“已经写进 system 通道”当作模型已读证明。

## 3. Raft 已展示去重与 RAH 冻结窗口不衔接

上游本次使用与运行收据同版的 1.0.18 发布源码（仍非中央服务器实现）：

- main.js:677012 drainInbox 读取最新 Agent inbox，729502 check 渲染消息。
- main.js:738090 consumeVisibleResponse 汇合 send-held / events / history 的可见结果。
- main.js:762810 recordConsumed 按 target、seq、message id 登记。
- main.js:764345 consumeVisibleMessages 从 active inbox / starting inbox 清除已展示项。

RAH 则由 `room-event-writer.ts:169` 只合并 queued Activation，不扩大 leased 窗口；
`room-kernel.ts:5162` 把 sync 上限冻结到 scope.toSeq；`worker-delivery-window.ts:24`
拒绝超范围 ACK。历史读取允许看到更晚消息，但不授权确认后续执行窗口。

S1 实际观察到 Claude、Codex 已经看过 DeepSeek 的回复，随后仍各开一轮 check。
这不是误用账户名计数，而是读事实、确认范围、后续运行之间缺少可合并的衔接。
Raft 的本机去重策略可作为来源，但 RAH 应在 Kernel 建立持久且有围栏的处理，
不能让 adapter 自行删除 durable work，也不能把 history read 等同于 Task 完成。

另一个观测：S1 回复前 Codex RAH 有两次 hold，Raft 一次；两边都存在保护。
回复后的运行数量不是全部可删，必须按“是否新消息、是否已展示、是否仍有业务义务”
逐项处理。不能靠无正文输出或进程退出认定不需要执行。

## 4. 大输入不是本轮缓存失效的同义词

S1 首请求（含缓存）：

| Provider | RAH 总输入 / 缓存输入 | Raft 总输入 / 缓存输入 |
| -------- | --------------------: | ---------------------: |
| Codex    |     179,526 / 178,944 |        25,959 / 25,344 |
| Claude   |     307,920 / 306,974 |        86,437 / 86,274 |

RAH 首请求命中均超过 99%。所以本轮不能把主要等待归因于缓存冷启动，更不能将
179,526 / 307,920 直接称为未缓存费用。缓存没有消除新增膨胀：下一请求的输入
分别增加 6,999 / 12,232 token。供应商每次生成仍有等待，多次调用继续累加。

序列化历史与当前模型保留窗口并非同物；本轮检查到的两家文件在截止时间内没有
显式 compact 边界，但不据此否定 Provider 的其他内部管理。没有真实账单数据，
不换算金额，也不声称精确解释全部 token 差额。

## 5. 漏回与原生 CLI 延迟的解释边界

原“大家好”中 Codex 已收到 Human，后又读到 Kimi，最后没有 message-post；
这证明后台工作与用户收到回复可以脱节。显式要求四人回答的 S1、B1/B2 两边都
全部答完，尚未证明普遍性丢消息。要修的是触发请求与新到同伴消息的上下文关系，
同时保留合理静默，不能增加无条件“每次都发一条”或读后自动 Task。

原生 CLI 的问答可以直接产出文本；平台必须发布显式 Room action，天然多一层。
但 RAH 额外的内部事件、重复 startup、重复消费不是这层业务必然成本。
Raft 实测也会先 check 再 send，并非普遍“正文已注入、一次生成就回复”。此前把
它作为既定事实的解释不成立。常驻进程是否能减少环境重复加载有独立价值；
不能说它对所有成本完全无影响，但它无法单独消除这里定位的投影与确认问题。

## 可落地修复顺序与验收

1. 优先收紧模型可见事件投影，保留完整 durable ledger 与必要业务变更。
2. 减少不变启动材料的重复注入，保留完整 Agent 私有记忆与版本变化语义。
3. 统一显式读取/held 可见消息与后续 Activation 的去重衔接，不能降低权限/ACK 围栏。
4. 明确尚未处理的 Human 请求，不允许被后来同伴内容悄悄替代；增加独立双问题回归。

每项先加失败测试，再实现。验收除了回复时间，还需记录每轮新增字符/token、
回复前模型请求数、已见消息重复次数、未缓存输入、实际 Room 发帖与未处理义务。
不需要再扩大普通聊天测速来决定是否修这几个已定位差异。精确速度收益和全部
失败恢复边界要在实现后验证；本结论不是修复完成声明。
