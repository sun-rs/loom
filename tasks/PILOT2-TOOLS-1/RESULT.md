# PILOT2-TOOLS-1 结果

STATUS: done

基线为 `main` 的 `2fb384f5`。改动留在工作树供 Super 审查。pilot-2 原件仅作只读对照。

## 交付

1. **事实检查**。识别 Loom 标记、UUID 和已知通知及投递的八位前缀。短 SHA 需要 Git 语境；无目录的裸文件名不触发巡检告警。对仍在进行的卡片，Leader 和 Auditor 的事实检查跳过卡面明确计划新建的文件。回复引用已收到的通知时，去重该通知里的旧问题，同时保留新问题。项目记忆的引用校验仍使用严格模式。
2. **Auditor 唤醒**。`drift.deferAuditorNotices` 默认开启。待发事实及走偏通知附在下一条实际投递上。批次过长时提示用 `loom status --json` 查看完整记录。将该项设为 `false` 可恢复单独投递。
3. **门禁换班**。开启 `roles.auditor.rotateAt: "gate"` 后，Leader 或 Super 可用 `loom notifications --gate-complete ID` 记录门禁完成。每个项目的同一门禁只产生一条 Auditor 换班提议。实际执行走原有换班流程，Leader 与 Auditor 的换班仍须错开。
4. **原生回执**。Claude 的 `db8b48bc` 在基线已通过末尾换行修复。另两条实际上是 agy 的一次合并投递，主记录为 `eec4e9d0`、成员为 `a111f511`。原生正文只在 Loom 插入的两项结果之间少了一个换行。新 agy 合并投递使用显式结果分隔符。旧记录只在完整预留摘要、边界变化后的摘要及绑定原生证据均吻合时纠正，正文的其他差异仍报损坏。
5. **交接简报**。同时支持模板标题和 `R1.` 格式，按上下文选摘并保留 `.project/rulings.md` 路径。缺失、不可读或没有可用摘录时显示原因。
6. **自动回传**。`delivery.replyBytes` 默认 600 字节。超限的自动回复、续作批次和托管审查回复写入 `.project/replies/<sha256>.txt`。自动投递发短指针，保留完整内容及摘要。合并到 Super 消息里的自动结果也受该上限约束。
7. **Worker 沙箱**。zsh 使用 Worker 私有目录下的 `TMPPREFIX` 写 heredoc。Git 的权限增加一个精确路径 `packed-refs.lock`，共享的 `packed-refs` 文件仍只读。证据卡逐条计入沙箱拒绝，包括退出码为 0 的命令和非测试命令。pilot-2 的 OAR 原始工具结果里有 10 条 refs 锁拒绝和 3 条 heredoc 拒绝。[Git 对提交清理行为的说明](https://code.googlesource.com/git/+/d8e458582219ef786545ce7c083595c5ec91d5d3)
8. **后台任务判定**。agy 的 composer 后台任务行及 Claude 的后台等待提示保留 `busy` 状态。提示消失后恢复按已有规则计时。
9. **Worker 合同**。启动提示与卡片模板均明确禁止 `--no-verify`、覆盖 `core.hooksPath` 和等价的 hook 绕过。
10. **agy 记忆**。2026-11-25 复核本机 1.5.17 的帮助、二进制及官方 CLI 参考。确认内置默认值为 Knowledge Items 关闭、会话历史开启且最多 20 条。复核范围是内置默认值与公开配置入口。登录后下发的配置及会话中的实际注入和写入仍待验证。[记忆调研](../../docs/research/2026-11-25-memory-systems.md)

## 验证

- `npm test` 通过 340 项，失败 0 项，跳过 0 项。`git diff --check` 通过。
- 在隔离的 macOS 工作树中用 Codex 0.171.0 原生命名权限配置复现两种拒绝。加入修复后 zsh heredoc 和 Git 提交均成功，提交 hook 写出证明，标准错误为空，修改共享 `packed-refs` 文件的探针仍被拒绝。
- 回归覆盖 pilot-2 的原生回执与事实告警、通知随实际唤醒交付、门禁错峰、裁决摘录、摘要文件跨重启交付、超长续作原文及后台任务状态。
