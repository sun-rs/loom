# Worker 目标呈现修复：实施与验收边界

用户顺序：目标呈现与串线 → 原生忙时投递 → 严格双边组合复验；之后才继续 UI 探针与局部差异。本文不宣称第一项已经完成真实模型验收。

## 来源与实际缺陷

Raft Computer 1.0.18，`raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，675920–675995：`formatTarget` 区分频道、DM、Thread；`formatMessageLine` 逐条打印可发送 target；历史窗口打印 Thread 与回复位置。

RAH 的 `worker-read-render.ts` 在 sync/room-read 的 message.posted 行省略所属 Room，history 行也没有目标。message-resolve 又将 Room UUID 与 Thread ID 拼成 `RoomID:ThreadID`，但 `worker-read-targets.ts` 仅对 `#频道` 与 `dm:@handle` 解析冒号后缀，UUID 按完整 Room ID 查询。显示值与可接受参数不一致。

## 实施边界

单一 owner 仍为 AgentHost Worker 文本呈现层。消息交付及历史行增加 canonical Room target；Thread 使用独立 threadId，符合现有 message-post 的 `--target RoomID --thread-id ThreadID`。这是 Raft 逐消息目标呈现的结构适配，不是逐字复制。保留完整 ID，未新建别名解析器、修改权限、自动选择目标或推进任何读取/ACK/执行位置。

## 验证

先改变精确输出断言并增加多 Room/DM 与双 Thread 呈现用例，运行确认旧实现失败，再修复渲染。定向呈现测试通过。新增真实 Kernel/Worker HTTP 测试从 Thread 读取输出提取目标与 threadId，再发送回复，断言两条独立 Thread 分别收到回复且顶层没有误发。

这些是确定性接口与呈现证据，不是旧 Provider session 的真实模型复验；此前 Codex 显式选错 Room 的行为仍需受控复验。UI 未改；原生忙时投递未开始。最终全套检查、正式重启和真实模型结果需另行记账，不能从上述通过推导。

## 本轮真实双 Thread 结果

隔离本地门禁在 295 秒内通过，实际 Kimi `kimi-code/k3` high 与 OpenCode `deepseek/deepseek-v4-flash` low。A/B 各自 RESULT → PASS → DONE，加 A:NOTE 共七条业务回复，发送者、Room、Thread、顺序与唯一性均通过，完成后的自然静默检查也通过。证据：`/Users/sun/Code/reviews/rah_os/2026-09-11-target-presentation/dual-thread-result.json` 与同目录运行日志。

这是新的真实本地通过，不是旧失败门禁的离线重放。仍不能替代 Codex 旧会话从 Room B 切回 A、再转 DM 的受控复验，也没有新增同条件官网组合样本。独立只读审计确认接线可用，并纠正 Search 来源标签可直接作为 --target 的旧注释。

## 本批检查与正式重启

完整 `npm run check` 最终退出 0；`format:check`、`git diff --check` 通过。首次全量运行的两个失败来自旧测试按行首 seq 固定解析输出，更新为明确识别 target 后的完整复跑通过，未删除消息数量或 ACK 边界断言。

正式实例已先确认无活动工作，完成 SQLite 与文件状态备份核验，有序停止旧实例并启动新实例。沿用已冻结 Web build `90358c5c11a8be860739611365460391850dbdc53398c58fdfa3f86e47f03b7e`，本批不改 UI。Chrome 新标签页已实际打开正式 4173，历史消息、频道/私信目录与输入区正常显示，并检查截图。未提交或推送。

第一项剩余：Codex 旧 Provider 会话跨 Room/DM 的原串线场景复验。此项通过前不将整个“目标呈现与串线”标为收口，不进入原生忙时投递施工。

后续已完成[原 Codex 会话顺序跨 Room/DM 续验](./2026-09-11-codex-original-session-target-recheck.zh-CN.md)：原错房间审计未重现，四步最终落点正确；但 DM 首次目标拼接错误并跨第二 Run 恢复，语义地址对齐仍未收口。此结果取代上文“尚未复验”的进度状态，不改变原样本边界。
