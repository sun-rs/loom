# 调度修复方案与 Raft 源码对照审查

承接[根因结论](2026-09-21-scheduling-root-causes.zh-CN.md)。本批仅审查设计，未修改
生产逻辑、运行配置或会话，未新增付费调用。主证据为本地留存 @raft/computer
1.0.18 发布包 main.js（与本轮运行收据同版）；hash 见根因证据 JSON。
补查 1.0.32 的 canAdvanceBoundaryForTarget，普通 read/held 不推进连续边界的
限制相同。发布包是分析证据，未将其作为生产依赖；未掌握 Raft 中央服务器全实现。

## 审查结果：方向成立，但四步方案不够完整

| 原方案                | Raft 源码行为                                                                       | 本地结论                                                                       |
| --------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 精简模型可见事件      | check 渲染 Agent inbox 的消息，非完整运行账本；677012、729502                       | 首先对齐，不能仅在 UI 或 renderer 隐藏而不定义 ACK 语义                        |
| 减少 startup 重复注入 | buildPrompt startup 明确要求读取完整 MEMORY.md；memory-startup-prompt-assembly.js   | 精简 manifest/技术配置合理；不变 MEMORY 免读不是已验证的上游行为，应从首批移除 |
| read/held 去重        | consumeVisibleResponse 738090；recordConsumed 762810；consumeVisibleMessages 764345 | 应对齐精确消息去重，但不可把展示直接等同业务处理完成                           |
| 保住 Human 请求       | Raft 有通知与正文分流、按 target 组织；本地 deliveryInstructions 已有保留原请求文字 | 不能再加一句提示词就称根治，要验证实际输入/窗口关系；不新增强制每条回复机制    |

## 必须补上的边界

### 精确集合不能替换成最大序号

main.js:744712 canAdvanceBoundaryForTarget 只给 verified_contiguous_content_consumption
或特定 Thread join context 连续推进许可。普通 history/held/check 可见记录主要
按 target + 具体 seq/id 去重；762860 的 shouldSuppress 也检查该限制。

例如 A、B、C 三条只展示 C，不能因为 C 序号最大，就清除 A、B。跨 Root/Thread、
频道/DM 也不能共享一个“最大已读”标记。有限页、around 查询、hold 有界上下文
尤其需要此规则。RAH 必须在 Kernel owner 内复用或扩展现有回执，不能由 adapter
另建一套 durable queue。避免过早决定添加新表；先核查既有 read-position、presented
window、activation obligations 能否表达精确集合与重放边界。

### 去重展示不等于取消后续业务

Raft 本机 suppress 操作针对 active/starting inbox 缓存，不能据此推导它的中央
服务已经完成 Task。RAH queued Activation 是持久执行记录，语义不同。

首批去重不得仅因“history read 展示过”就取消 Activation。需要区分：提示已写入、
正文已输出、delivery 已确认、用户请求已回应、Task 义务已完成。尤其是输出后进程
崩溃、用户问题被读但未答、Task 被改派/取消时，后续工作必须可恢复。
若这一轮不能证明安全消除执行，可先去除重复正文/通知并保留必要执行；不得为了
减少运行数丢失义务。ACK 和 Task 完成继续独立，不把退出码当作回复证据。

### 消息投影需覆盖业务事实与空页

不能只允许 message.posted：任务取消、改派、审批结果、输入请求解决、相关成员
移除等仍可能改变行动。Protocol/Kernel 应明确事件分类：用户可见业务事实、
内部审计事实，以及未知类型的保守处理。原始账本继续完整保存。

纯内部事件页要能前进，不能无限空页或重新唤醒；业务事件必须完整呈现，不能
因字节预算被静默跨过。输出失败不能确认未展示正文；重复响应不能重做业务。
现有 worker-message-check.test.ts 已有异步输出/EPIPE/部分分页测试，应扩展而非绕过。

### 普通唤醒和补上下文不是同一条路径

Raft main.js:765187–765238 明确区分：普通 wake 通常为 content-free inbox notice；
Thread join 有上下文时和 resume catchup 可带具体正文。744801/744813 分别渲染
具体消息和通知。不能一律改成“正文直接灌入首次请求”，再称完全复刻。

RAH 已有 wake-message-input 与 presented-window 等 owner。应先核实哪些正式路径
实际启用、哪些是历史实现/受限路径，再做有界接线；本批不重写四家 driver。
Thread 首次进入保留父消息、近期上下文、附件身份、Task 信息与准确回复目标；
不能只压到一句最新消息导致模型缺上下文。

### 忙时通知去重必须跨恢复边界审查

Raft main.js:769185–769236 对已贡献的消息、重复 fingerprint 和编码失败分别处理，
带 session 维度。本地 runtime-busy-notices.ts 已实现每 Run 的 accepted fingerprint
及最多 256 个 event id 排除集合，并保留失败后的 durable follow-up。

不能重复实现现有每 Run 去重。应测试同一 Provider session 的下一 Run 是否再次
推送相同通知、Guide 开关切换、session 变化、传输拒绝和晚到响应。确认 notice
成功仅证明通知传输，不证明正文已读。跨 Run 优化需要可靠会话/凭据边界，不能
把旧 session 的展示收据带入新会话导致上下文缺失。

### MEMORY 与 cwd 不宜夹带重构

Raft startup 要求完整原始 MEMORY 索引，notes 按需读取。继续保持；本例技术事件
远大于 MEMORY，优先级更高。不加记忆片段化、截断、每轮全部 notes 哈希、默认按
Room 分裂会话或无证据 token 上限。将不变技术说明放入稳定指令属于候选优化，
但需验证 Provider resume、压缩、记忆变化和新 session；不能缓存一个“读过”布尔值。

旧 Agent 的仓库 cwd 会引入项目指引。对照私有 cwd 是合理审查项，但不能悄悄迁移
用户明确选择的项目或禁止合法 AGENTS.md。保持 Agent 身份、工作目录与记忆 owner 分离。

## 是否比 Raft 更好

目前不能宣布更好，也不能把“约束更多”当作质量更高。

- 对齐目标：消息投影紧凑、精确去重、有限上下文补齐、忙时通知合并。
- RAH 必须保留：持久账本、幂等命令、租约/Host 代际、明确 ACK、Task 独立完成、
  失败重放。它们是本地工程合同，不证明 Raft 中央服务没有同等保障。
- 可验证的潜在改进：把优化后的展示/确认与恢复证据放在同一 Kernel 事务边界，
  重启后既不漏业务，也不反复灌同一段技术数据。只有故障注入与真实对照通过后
  才能称更可靠；当前只是设计目标。
- 不接受的“改进”：无条件一轮生成、所有消息必须答、read 后直接取消工作、
  清空会话获得好看的延迟、绕过 freshness hold、按 Room 默认重建 Provider session。

## 修订后的施工顺序

1. 先固定共同投影/回执合同及失败测试，明确哪些事实必须让模型看到。
2. 实现紧凑业务投影，减少内部 JSON 和重复技术 manifest；完整 MEMORY 规则不变。
3. 衔接 read/check/held 的精确去重及忙时通知恢复。保留未回应用户请求、Task 义务
   和冻结授权窗口；消除额外执行必须有证明，不能仅据“已展示”。
4. 核实现有普通 wake、Thread join、resume catchup 接线，补缺失上下文和准确目标；
   验证原 Human 请求不会被后来消息覆盖，不增加同义提示词堆叠。
5. 再评估稳定 system 注入、跨 Run 会话/进程复用等后续优化；不作为首批必须重构。

最少验收矩阵：纯内部事件/业务混合页；多页及超大单条；只展示中间/最后一条；
Root/Thread/跨 Room；hold 后继续新消息；busy 两个独立 Human 请求；Task 取消/改派；
输出失败/输出后崩溃/ACK 响应丢失；同 session 下一 Run 与新 session；Guide 开关；
停止后重发；角色/记忆变更。确定性 fake 测试先失败再修复，随后用已授权同模型的
Claude/Codex 比较新增输入、模型调用、重复展示、真实回复和恢复，不只看运行数。
