# ROT-SELF-2 结果

STATUS: done

从 main `0e280f39` 创建 `infra/rot-self-2`，独立工作树为 `/Users/sun/Code/repos/loom-rotself2`。改动未提交。

- 简报单列 `Do now`，把前任判断单或手动启动说明中的明确待办与背景分开。接任者在首轮开始待办，最终回复首行仍是原样 `HANDOVER-ACK`。工作项可用卡片、阶段、门禁 ID 或项目路径关联工具调用、对外投递与项目通知。
- 接任后三分钟，若仍空闲且有未开始的待办，loomd 用固定投递 ID 发一次「交接里有待办」。再次空闲三分钟后，Leader 的事项升给 Auditor，Auditor 的事项升给 Super。匹配到全部事项的开始证据后持久记录并停止计时。
- 14 项定向回归通过，包含四种 TUI 的紧凑简报、两条升级路径、无关阶段和工具调用、以及相对和绝对路径的证据匹配。Supervisor、角色预算及交班待办三个测试文件合计 64 项通过，零失败、零跳过。
- 以绝对路径运行真实 Claude Code 2.1.331，使用独立 HOME、Core 和回环模型。新 Auditor 在原生首轮调用 `loom notifications --complete … --phase goal5`，登记该阶段后发送 ACK，旧 Auditor 随后退休。启动投递为 362 字节，原生确认一次，无人工输入或提醒。回环模型提供可重复的工具选择与 ACK。

[定向回归](/private/tmp/loom-rotself2-branch-focused.log) · [三套回归](/private/tmp/loom-rotself2-branch-suites.log) · [Claude 实机记录](/private/tmp/rl-fXLeQt/evidence.jsonl)
