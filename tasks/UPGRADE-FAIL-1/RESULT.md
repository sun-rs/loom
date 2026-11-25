# UPGRADE-FAIL-1 结果

## 超时原因

超时发生在 v3 TUI holder 的冷重附。loomd 重放出生以来的输出，每条事件单独等待 xterm 的异步写回调。旧代码依次重建 Auditor 和 Leader，还要核验其他宿主，超过 launcher 的 45 秒窗口。旧 launcher 恢复时要求旧 loomd 先走同一次完整重附，因此再超时一次并杀掉了恢复进程。现场记录显示两个相同的超时，间隔合计约 90.5 秒；此次只读取现场。 [故障记录](/Users/sun/Code/exp-relay/pilot2-held/upgrade.json) · [故障日志](/Users/sun/Code/exp-relay/pilot2-held/upgrade.log)

只读重放现场在开始升级前已写完的日志段，Claude 的 8,640 条输出耗时 10.958 秒，agy 的 26,580 条耗时 34.319 秒。两项合计 **45.277 秒**，尚未计入 holder RPC、原生会话和 OAR 查询。相同日志合并连续输出后耗时 **1.239 秒**。实现保持输出事件的绝对顺序，并在输入、尺寸变化和其他控制事件前把输出交给 xterm。两个老版本的 TUI holder 与 OAR v1 在实机测试中都保留原身份，未发现协议或二进制摘要不兼容。 [重放测量](/Users/sun/Code/exp-relay/upgrade-fail-1/replay.jsonl) · [TUI 重放](../../tui/holder-terminal.mjs)

## 故障恢复与预检

- 候选 loomd 先开放只读状态，验证全部原会话后才允许发布并启用调度。候选明确报告失败会话和原因，launcher 只清理自身启动的候选进程。在原发布根恢复时，旧 loomd 先恢复服务，再以正常轮询重附会话，避免将旧进程的存活再次绑在全部附件的复核耗时上。恢复成功仍写入 `phase: failed`，附失败原因、恢复标记及服务 PID，保留旧的发布指针。 [交接](../../daemon/upgrade.mjs) · [loomd 启动](../../daemon/main.mjs)
- 修复版 `bin/loom` 也支持从旧 daemon 发起升级。旧 launcher 两次超时并退出后，它启动仍然生效的原发布根。若 launcher 中途丢失，修复版候选让出项目写锁，仍在执行升级的 CLI 由项目写锁保护恢复。旧二进制保留旧的调用行为，从旧项目进行首次升级时使用修复版 CLI。 [CLI 恢复](../../cli/upgrade.mjs)
- 原始 `--check` 只检查发布清单、协议及由旧 loomd 已附着的会话，现场 **零 blocker**。修复版候选支持只读复核，逐个查询原 pane／host 身份、重放 holder 日志，检查原生会话和 pipe 水位。预检不申请 writer lease、不发输入。施行升级时也会重新捕获会话列表并复核。旧候选没有该入口时，显示 `attachmentCheck: unsupported` 并保留协议检查。 [候选预检](../../daemon/attachment-check.mjs)

## 实机验证

- 以 `9603c9c1` 启动隔离项目，使用绝对 CLI 路径、隔离 HOME 和 hc、回环 mock。保留 Claude 与 agy v3 TUI、一个原生 Codex OAR v1 和一个已经结束的 v1 host。复核拒绝测试在原 daemon PID 下报告两条 TUI 水位 blocker。随后另一个候选通过预检，在取得 writer lock 后报告附件失败；旧发布自动以 PID 84579 恢复服务，三条活跃会话的原生 ID、holder/host PID、窗格和 stream ID 均保持。五条输入各有一次原生确认，含失败前已排队的消息，人工输入为 0。随后同一组会话成功升级。 [混合会话记录](/Users/sun/Code/exp-relay/upgrade-fail-1/r-7i2mcY/summary.json) · [过程日志](/Users/sun/Code/exp-relay/upgrade-fail-1/r-7i2mcY/steps.jsonl)
- 另一次隔离测试让历史 launcher 的候选和旧版 recovery 先后超时。修复版 CLI 从原发布根恢复普通启动，原会话重新连接、待发消息继续交付，`upgrade.json` 仍为 `failed`。这是首次从旧版本升级时的兼容路径。 [旧 launcher 双超时记录](/Users/sun/Code/exp-relay/upgrade-fail-1/r-WLFnQA/summary.json)
- 另一次隔离测试在候选取得 writer lock 后终止 launcher，候选自行退出，等待中的 CLI 恢复了原发布。记录保留 `phase: failed` 及 launcher 中断原因，五条消息均确认一次，随后成功切换。 [launcher 中断记录](/Users/sun/Code/exp-relay/upgrade-fail-1/r-faSNOk/summary.json)

## Claude 回执附加修复

- `db8b48bc` 的前置空行已被旧代码正确剥离。真正差异是结尾：Claude 用正文现有的最后一个 LF 分隔 `</pasted_content id="4228">`，旧 Loom 剥离该行时少哈希了一个字节。新代码只在已知包装格式下比较两个可能的精确正文摘要，保留包装外的额外字节，并允许同一原生提交纠正历史误报。没有原生证据时，单独留存的旧版不匹配摘要不足以重判。 [原文回归样本](claude-receipt.json) · [回归测试](../../inbox/inbox.test.mjs)
- 只读复核现场的 hook 和原生 transcript。189 字节的 `db8b48bc` 与预留摘要相符，应为 `received`；实际截断且包含 U+FFFD 的 `64e3ea10` 仍为 `corrupted`。 [现场摘要对比](/Users/sun/Code/exp-relay/upgrade-fail-1/receipt-recheck.jsonl)

最终 `npm test` **318／318 通过**，无失败、取消或跳过。`git diff --check` 通过。实机成功切换的完整候选与工作树的发布摘要相同。 [测试日志](/Users/sun/Code/exp-relay/upgrade-fail-1/npm-test-verified.log) · [已验收候选](/Users/sun/Code/exp-relay/upgrade-fail-1/r-faSNOk/c)

未向 pilot-2 部署或操作其窗格。并行提交 `55fd7e1a` 带入了当时已跟踪的部分改动。完整验收范围还包括工作树中的预检模块、回归夹具和后续修订。

STATUS: done
