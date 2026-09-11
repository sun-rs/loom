# 投递、生命周期与提示词：仅审查与建议

本报告按用户澄清，仅分析后端差异并提出建议，不交付相关后端修复。被误启动的提示词与 Claude 就绪条件施工已逐项撤回；保留此前正式 Guide 设置功能。当前实际施工仅调整设置页及用户要求的 Guide 默认值。

## 查证结论

参考已提取 Raft Computer 1.0.18：main.js SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，文件位于 `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`。

1. **提示词分支未对齐，确实存在。** Raft `buildPrompt` 的 736035–736066 根据 includeStdinNotificationSection 与 messageNotificationStyle 添加 direct 或普通通知说明：通知可批量、无正文、只反映目标变化；在自然断点决定读取，不能从无正文推断无工作。RAH `standing-prompt-compiler.ts` 的 startupLayer 固定使用无通知启动分支，没有与实际原生投递关联的通知处理段。需要纠正措辞：`RAH never injects Room notices mid-turn` 是源码注释，不是逐字送给模型的文本；缺陷是代码假设陈旧及生成说明不完整，不能混为“模型读到了这句注释”。
2. **Claude 新建/恢复就绪条件有明确差异。** Raft 758068 设置 liveSessionReadyAt=turn_end；764676 的 initialSessionReadyForDelivery 对已有且匹配 config.sessionId 的会话允许就绪，对新会话等待 turn_end；764682 在相应事件后置就绪。RAH claude-stream-json-driver 当前检查输入已接受、session ID 稳定和未停止，然后 claude-busy-input 按工具边界放行；没有等价的新建/恢复就绪分支。
3. **不能孤立搬入 ready=true。** Raft Claude 是 persistent；RAH 在首个 result 后关闭 stdin，等待已写输入的结果后退出。这是实质生命周期差异。若只让新会话等首个 result，再马上向其写入，便会向关闭中的 stdin 投递。新建首轮未追加不等于消息可丢弃，必须继续保留已有 durable follow-up。

这些结论来自上述冻结版本与当前本地源码，不宣称已复验最新线上所有 Runtime。

## 按 Raft 思路建议的顺序

1. **统一有效模式的唯一判定。** 在现有 Runtime 描述/Host 边界把技术能力、用户开关和会话状态区分开。提示词与实际投递消费同一来源，避免设置开启、Host 追加、prompt 却只有等待说明。
2. **按模式组织提示词，而非无限增加补丁。** direct/gated 结构移植 Raft 通知段，将 Raft CLI 查询映射为现有 Worker 工具；等待模式如实说明后续交付。通知不是正文、read/ACK/Task 状态或新的跨目标执行授权。保留原问题、准确 Room/Thread 和当前执行围栏。明确运行中设置可能改变，不能让启动时的描述成为永久承诺。
3. **Claude 同批处理恢复身份与就绪。** 新会话 session ID 出现不等于 live-ready；恢复会话仍须验证实际 ID，恢复失败转新建必须重新走新建规则。继续保留 compaction、并行工具、错误及已结束执行的限制。
4. **明确生命周期裁决。** 最小安全适配是保留 RAH 有界 Run：新建首轮不忙时投递，积攒消息交给下一 Activation，成功恢复后走 gated。若目标是逐项复制 Raft 常驻进程，则需要另行设计跨 Activation 的凭据、范围、lease 与退出管理，不能以“让 stdin 不关闭”冒充完成。不要把 Raft 的驻留等待提示原样塞给当前有限进程。
5. **先验可观察结果。** 覆盖新建首轮、正确恢复、恢复失败转新建、错误 session ID、压缩/工具批次、结果结束竞态；同时核对实际提交给 CLI 的 prompt 与 mode，并验证连续消息不丢原请求。模型测试与同条件 Raft 双边验收另列，源码与 fake 测试不能代替它们。

提示词变化还会影响已有 standingPromptDigest 与 provider session key；应明确是否产生新会话并验证私有 MEMORY 连续性，不能为“保持会话”直接跳过现有摘要校验。
