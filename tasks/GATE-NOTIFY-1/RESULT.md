# GATE-NOTIFY-1 结果

STATUS: done

## 1. 完成通知静默去重

- **根因。** pilot-2 同一 Auditor 会话 `loom-d173a83a` 的第 23 轮和第 34 轮分别执行 `"$LOOM_BIN" notifications --project "$PWD" --complete "$SUMMARY"` 和 `"$LOOM_BIN" notifications --project "$LOOM_PROJECT" --complete "$SUMMARY"`。两个变量都解析到 `/Users/sun/Code/loom-pilot2`，两次均未传 `--phase`。该会话的 CLI 固定在 `/Users/sun/.loom-cell/releases/52219963/bin/loom`，第 26 轮曾打印此路径。目标 3 的同期 `daemon status` 显示服务端 `055151d3`。目标 4 的 `05:31:46 UTC` 请求落在 `f2955b89` shim 安装与 `955874e5` 切换之间。两版服务端都把无阶段完成映射到 `completed:<project>`。pilot-2 的 `.project/loomd/notifications.json` 中，该 ID 已被第一阶段占用，只有它有桌面推送记录。重复插入被跳过，旧回执仍返回 `ok:true` 和整个通知列表。
- **变更与测试。** 无阶段完成按完整正文生成稳定 ID，显式阶段的不同正文返回冲突。完成通知先落盘，推送到托管 Super 的持久收件箱或确认桌面调用成功后返回带去向的 `completion`。路线缺失、失败或节流时返回非零 `notification-pending`，原记录仍可重试。沿用 pilot 的绝对 `--project`、无 `--phase` 的 CLI 形状，RED 只保存首条，修复后保存三条并投给 Super。同文重试复用 ID。另一个用例模拟桌面失败，随后建立托管 Super，原 ID 成功推送。[失败原件](/tmp/loom-gate-notify-1-red.log)

## 2. 门禁包快照与缩略原件

- **根因。** 原投递 ID 只含项目与门禁 ID，第二次打包在读取证据前就返回旧投递。问题、红色事实和审查正文被压成定长预览，没有对应原文路径。
- **变更与测试。** `gate pack` 按门禁和轮次选择 ID，省略 `--round` 创建下一轮，显式 `--reuse` 才返回旧快照。每处预览缩略后紧邻完整段落路径，补充红色事实也有独立 SHA-256 原文路径。回归在第一轮发出后添加证据和 Reviewer 结论，第二轮收录新增内容，第一轮字节保持一致。另核对长问题、完整 Reviewer 正文和升级原文。

## 3. 审计静默与合入回告

- **根因。** pilot 投递 `dead2d09-0526-4aba-860f-52e2e0b571c4` 是 Leader 发出的 `DONE G4-MERGE`。过滤留下了收件箱记录和 `auditor-wake-filtered`，通用回执仍呈现 `queued`，正文没有后续载体。
- **变更与测试。** 发送回执明确显示拒绝原因和下一次唤醒摘要去向。已知发送者的过滤正文附在 Auditor 下一次允许的原生投递上，超预算时附完整文件指针。`loom status --json` 显示摘要待送或已收到。回归重启后验证正文只随一条既有投递送达，Auditor 唤醒数不增。合入回告使用这条静默路径，`--gate-complete` 负责登记边界，确需新裁决才发新一轮门禁包。

## 4. Auditor 预算采样

- **根因。** pilot 账本 `2026-11-25T17:03:15.022Z` 的 `84/3` 次唤醒与 `275681` 上下文 token 是该门禁的首次超支记录。旧逻辑命中该事件 ID 后跳过采样，门禁完成时也沿用这份用量。
- **变更与测试。** 每次正常评估及完成门禁前重新计算，用相同事件 ID 保存当前用量和 `sampledAt`。回归在同一门禁采样 `501 → 750 → 50`，验证唤醒数、时间与上下文用量更新。恢复预算后完成门禁时不触发滞后的预算换班建议。

## 5. 会话内的稳定 CLI

- **根因。** 旧会话在启动时继承发布目录中的绝对 `$LOOM_BIN`。pilot Auditor 第 26 轮使用 `52219963/bin/loom` 调 `gate --help` 得到 `Unknown command: gate`。切换 loomd 不会改写旧原生进程的环境。
- **变更与测试。** 生命周期回归使用同一项目 shim 路径切换发布指针，然后调用真正的 `gate --help` 与 `escalate --help`。`loom status` 的 Release paths 对旧会话明确标出 `$LOOM_BIN` 固定及换班要求。继任者确认接班后旧路径警告消失。

## 6. 集成 Worker 全量验收

- **根因。** pilot Worker `T18-GOAL4-IMPL` 的失败涉及沙箱内的 `ps` 和临时目录权限。独立复现确认真实 Codex macOS 沙箱拒绝 `/bin/ps`，普通权限的副本也缺少全量进程枚举所需的权限。另有 Worker 因尝试写共享 `.project/` 摘要阻塞。
- **变更与测试。** 集成卡用 `loom spawn worker --integration` 声明 headless OAR 配置。每卡沿用私有 `$TMPDIR`，通过 `PATH` 上的 `ps` 或 `$LOOM_TEST_PS` 查询本卡进程树，只返回进程元数据和可执行文件名。网络与凭据权限沿用普通 Worker。验收命令和退出码从原生轮次进入证据卡。隔离回归检查配置的作用域、进程树过滤、命令参数不外泄和证据采集。独立 npm 项目在真实 Codex macOS 沙箱内完成全量验收，同时验证私有临时目录可写及共享 `.project/` 写入被拒。[沙箱验收日志](/tmp/loom-gate-notify-1-real-sandbox.log) · [Codex Seatbelt 实现](https://github.com/openai/codex/blob/main/codex-rs/sandboxing/src/seatbelt.rs)

`npm test` 共通过 410 项，失败、取消和跳过均为 0。`git diff --check` 通过。[全量结果](/tmp/loom-gate-notify-1-final.log)

集成项目需遵循 `$TMPDIR` 并通过 `PATH` 或 `$LOOM_TEST_PS` 查询进程。pilot-2 仅用于只读核对，未向其窗格输入，也未部署。全部改动留在当前工作树，未提交，供 Super 审阅。
