# PILOT2-FIX-1 结果

根因是 Claude 2.1.331 重绘 composer 时留下了上一帧的实际空格单元。v3 日志第 240 条记录了粘贴写入，第 242、243 条重放后，投递 ID 之后、换行之前仍有尾随空格，三行的 `isWrapped` 都为 false。普通屏幕显示看起来正确，但 `deliveryId` 要求 ID 后紧跟换行，因此草稿校验以 `draft-unverified` 结束，自动 Enter 尚未尝试。原 pilot 的请求账本显示，Super 手动按一次 Enter 后才记录一次原生确认。 [原屏幕](/Users/sun/Code/exp-relay/pilot2-held/t3fj-screen.txt) · [复现输入](claude-draft.json)

在 loomd 的 `readGrid` 中删除 Claude 硬行末尾的绘制空格，保留软换行的内容。草稿校验仍核对投递 ID 与规范化正文。回归测试回放捕获的第 242、243 条输出，确认 xterm 仍存有实际空格，但草稿提取与预期一致，正文改动仍会被拒绝。 [修复](../../tui/pty-grid.mjs) · [回归测试](../../tui/pilot2-draft.test.mjs)

用绝对路径启动隔离 HOME 的真实 Claude 2.1.331，接本地 mock。先从 `22b96cca` 启动 v3 会话，再只更新 loomd 的网格修复。在同一会话发送与现场相同的三行输入，自动提交，原生确认 1 次并收到回复，人工输入 0 次。daemon PID 从 58606 变为 59195，Claude PID 58708、hc 窗格及 PID 58660、native session ID 与 holder 世代均保持。 [实机过程](/Users/sun/Code/exp-relay/pilot2-fix-1/r-rime2v/claude/steps.jsonl)

已有 Auditor 可通过 loomd 线上升级获得修复，其原生进程与 holder 无需重启。对 pilot-2 只读了指定证据，现场已确认的旧投递无需重发。改动未提交。

STATUS: done
