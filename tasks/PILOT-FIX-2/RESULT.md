# PILOT-FIX-2 结果

- **agy 投递收尾**。原生 Stop 或同一会话的新根轮次可结束已接收的旧投递。已归属到原投递的回复照常保存，缺少可归属的回复时记录带来源的 `noReply`。回放了 pilot 中 `initialNumSteps` 从 1 到 37 的外部接管形态，验证后续 BLOCKED 结果恢复投递，且外部轮次的回复没有归到原投递。
- **Claude 折叠粘贴**。参考 Orca 的 `native-chat-paste-landed.ts` 和 `agent-prompt-injection.ts`，从空编辑框记录本次粘贴并复读稳定画面。PTY 核对单个 `[Pasted text #N +k lines]` 的换行数，以及期间的人工输入、缩放、缓冲区和原生轮次状态。核对成功时仅按一次 Enter，随后等待原生确认。使用从 pilot 只读裁取的编辑框画面回归验证了匹配与不匹配的情况。
- **升级摘要**。loomd 启动时保存运行版本摘要，`loom upgrade --status` 返回此值，升级预检用此值识别在运行目录中的原地编辑。隔离测试使运行目录和待升级目录的磁盘摘要相同，预检仍检测到运行版本的漂移。
- **Super 通知**。确认 `blocked-escalation` 和 `delivery-uncertain` 都进入 Super 的领取与推送路径，并补全协议和技能的通知说明。

## 验收

- `npm test` 共 278 项，全部通过。新增 agy 外部接管与 Claude 折叠稿回归，并覆盖 Super 对两类通知的领取与推送。
- 本机 Claude Code 2.1.331 Sonnet 用隔离 HOME、原生绝对路径和本地模型端点完成了长粘贴实测。一次原生提交 hook 包含原投递标记和完整正文，PTY 已关闭。记录见 `/Users/sun/Code/exp-relay/pilot-fix-2/live-final.log`。
- 升级预检实测记录见 `/Users/sun/Code/exp-relay/pilot-fix-2/upgrade.log`。
- pilot 仅用于读取证据。折叠稿的自动提交要求新 PTY 观察到本次粘贴，pilot Auditor 已保留的草稿仍待人工处理。主仓库未提交。

STATUS: done
