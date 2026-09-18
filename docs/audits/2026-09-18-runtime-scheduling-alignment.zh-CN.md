# Raft 1.0.32 运行时调度对齐：第一批

日期：2026-09-18。当前范围是 Claude 忙时投递及升级时的 Provider 会话连续性。
这不是整个延迟 P0 或常驻生命周期的完成声明，不以清空会话换取延迟改善。

## 来源与采用范围

[Raft Computer 1.0.32 制品](https://cdn.raft.build/computer/1.0.32/raft-computer-darwin-arm64)
提取 `main.js` SHA-256：
`531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`。
[来源与许可边界](../evidence/raft-release-20260916/manifest.json)保持不变；发布 bundle
只用于分析，不执行、不进入生产依赖。本次是有引用的行为结构移植与 RAH glue，
不是字节级复制。

| 上游位置                 | 事实                                                                                                  | RAH 本批处理                                            |
| ------------------------ | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `836632` Claude driver   | persistent、direct/steer；原生 stream-json 接纳工具和 compaction 期间的输入，避免重复建立工具边界队列 | 删除旧 gated 暂存/边界判断；改为立即写入原生队列        |
| Claude session readiness | fresh session 出现 ID 不等于可恢复；第一次 turn 完成前不按旧会话投递                                  | 保留 fresh/readiness 围栏，不伪报已就绪                 |
| `837278` Codex driver    | persistent、原生 direct/steer                                                                         | 本批未改 Codex 传输                                     |
| `839424`、`820569` Kimi  | SDK persistent、direct/steer、原生 system `roleAdditional`                                            | 安装版 ACP 不暴露等价通道，未伪造配置字段               |
| `839488` OpenCode driver | `opencode run` per-turn                                                                               | 不把四家统一改为常驻；RAH serve 接法的差异仍存在        |
| `847860` turn_end        | 保留 persistent 实例，仅 per-turn 实例退出                                                            | RAH 有限 Run 与 OS 终止证明仍耦合，本批没有假报进程已死 |

Multica `server/pkg/agent/claude.go` 与 `kimi.go` 也已核对；没有提供可以直接移入 RAH
当前 per-Run 授权/终止合同的常驻池。Raft 中央 Server 的源码不可见，不能声称其
Inbox/Activation 数据库实现与本地完全一致。

## 实施

单一 owner 为 AgentHost 的 `claude-busy-input.js`，daemon 只编译有效投递模式。
恢复会话在身份匹配、未结束且 stdin 可写时立即投递。只保留一个尚未完成的 pipe
write 和上一次已接受指纹，不添加第二个消息队列、计时器或持久 cursor。

重复指纹、pipe 错误、同步 write 异常、终止/取消、会话身份改变、超长或破损 frame
均有回归；关闭后的迟到 callback 不能声称成功。第一个 result 关闭新输入 admission，
已经写入 CLI 的输入仍可处理完毕。其回执只证明 transport，Kernel ACK、任务义务与
终止围栏保持原 owner。

投递模式参与 standing prompt digest，直接改为 direct 会意外命中新 session key。
本次增加精确兼容：仅 Claude direct 在新 key 缺失时，尝试同一 Agent、角色规则、
Provider、profile revision、workspace mount 的原 gated key。不会删除旧 session；
成功原生完成后才写新 key，改变角色的摘要不能借兼容机制复用旧规则。

## 先失败后通过

- thinking、并行工具与 compaction 三种状态的 direct 测试先在旧 gated 代码失败。
- standing prompt 兼容摘要及旧 key 升级恢复测试先失败，最小实现后通过。
- 原 helper 与 driver 回归更新为 direct 合同，保留错误、取消、fresh、身份漂移与
  有界 frame 检查，不再要求等待上游已移除的工具边界。
- `npm test`：1,677 通过、0 失败、17 个付费门禁默认跳过；最终 `typecheck`、
  `format:check`、`git diff --check` 通过。
- `npm run check` 未通过：共享工作树中另外的 sidebar CSS 变更与组件证据 hash
  不匹配，并新增未登记的空分组隐藏规则。本批未修改那些界面样式或伪造其视觉证据。

## 真实证据与残留

隔离临时 daemon 使用用户授权的 Claude `sonnet/low`，不修改正式 Agent 或 Room。
先完成一个 warmup turn，再让原任务执行 30 秒工具，在执行期间发送追加消息。
最终门禁完整通过：追加消息落账到原生接受 **418 ms**；原回复和追加回复均在原
Run 中各落账一次，Provider JSONL 另有一个真实 `queued_command`。
这证明忙时直投功能，不证明完整回答只需 418 ms，也不是与 Raft 同条件的速度比较。
脱敏时间和结果见[本批证据](../evidence/2026-09-18-runtime-scheduling-alignment.json)。

早期门禁失败已保留：一次旧夹具对永久 all 重复加成员；一次观察了错误的相对文件路径；
两次业务断言通过但最后的 transcript 路径/字段校验仍使用旧 workspace 假设。
没有把这些失败报告为整项通过。门禁已改为绝对标记文件及共享 Agent 私有 cwd owner。

最终样本仍有额外运行：原 Run 在 `03:29:24.130Z` 结束，后续 Run 在
`03:29:24.137Z` 启动，耗时 **9.319 秒**，没有第二份业务回复。原因不是 native input 丢失，而是 target
read/post 没有替后续 Activation 完成 assigned-consumer ACK。这是已复现的调度开销，
不能靠把 transport receipt 当 ACK 来抹掉。

下一批必须闭合的合同：

1. Kernel 只根据实际运行内有界交付确认与已满足的业务义务合并/完成已消费 follow-up；
   未读、新到消息、失败/取消和未完成 Task 均保留恢复路径。
2. AgentHost 把 Provider instance 生命周期与有限 turn/RunAttempt 分开，轮换 Worker
   授权、处理旧工具调用、重启恢复和失联清理。不能让活进程得到 `terminated` 证明。
3. Kimi 使用兼容已安装 CLI 与现有 session 的原生 system/steer 通道；当前 ACP
   不能凭 `_meta` 或未转发的 `--agent-file` 声称已实现。继续保留原始会话历史。
4. 相同模型、缓存/会话前提下进行 fresh/resumed/busy/stop、DM/频道的计时比较。

## 交付状态

代码与 Claude 定向门禁完成，包测试通过；全仓库 `check` 因上述并行 UI 证据变更失败，
Raft 同条件双边计时未执行。正式库仍有此前 OpenCode 超时遗留的 quarantined
Activation；现有 `assertWorkbenchIdle` 将其视为未排空工作，尽管当前已无 active
RunAttempt 或非 terminal RuntimeProcess，本批仍保留隔离状态，没有绕过 guard。
**未重启正式实例、未部署本批代码、未提交、未推送。**
