# 安全强制改派实现与浏览器验收

日期：2026-09-01

## 结论

本机单 Computer 的运行中 Task 安全改派主链已经实现并通过隔离真实 Chromium 业务门禁。验证证明的是“旧 Runtime 有终止证明后才交给新 Agent”，不是简单覆盖 `assignee_id`。

## 实现证据

- Protocol：`packages/protocol/src/client-task-reassignment.ts`
- Durable operation/Task 状态机：`packages/kernel/src/task-reassignment-service.ts`
- Worker 与 scheduler fence：`packages/kernel/src/worker-task-scope.ts`、现有 scheduling/RunAttempt owner
- Human application service 与 typed SDK：`packages/application-service/src/client-application-service.ts`、`packages/client-sdk/src/index.ts`
- 本机 daemon terminal-proof coordinator：`packages/daemon/src/daemon-application-support.ts`
- Web eligibility 与弹层：`packages/ui-web/src/index.ts`、`apps/web/src/components/task-dialogs.tsx`、`apps/web/src/components/conversation-panes.tsx`
- 正式 Runtime prompt：`packages/daemon/src/local-cli-runtime-spec.ts`

## 发现并修复的真实缺陷

首轮浏览器实验中，改派 operation 已完成、旧 Alice Runtime 已终止、新 Kimi Activation 也已创建，但 Kimi RunAttempt 反复以 code 1 退出。保留的 SQLite 状态证明失败位于接管后的 Worker 命令，而不是 UI 或 scheduler。

根因是旧/new owner 对同一 Task 使用了相同的 `taskId + operation` 幂等键；Room event 幂等域是 Room 全局而非 actor 局部，新 Agent 的 claim 与旧 Agent 已落账 claim 冲突。修复后，Task 命令键固定为 `participantId + taskId + operation`；同 Agent 重试保持稳定，不同 owner 不再碰撞。正式多 Provider prompt 与 Fake CLI 同时修改，并增加 prompt 回归断言。

## 已运行门禁

1. 定向 protocol/kernel/application-service/SDK/daemon/UI 测试：72 项通过。
2. `packages/daemon/test/local-cli-runtime-spec.test.ts`：正式 prompt 明确要求 participant/Task/operation 三元幂等身份。
3. `npm run test:web:browser`：通过；脚本实际先运行 1440×1000，再运行 390×844，并在同一门禁覆盖安全改派及既有核心业务链。
4. 完整改造后重新运行 `npm run check`：core 713 项通过、2 项付费真实 CLI gate 按合同跳过；Web unit 123 项通过；parity regression 34 项通过。
5. `npm run format:check`、`npm run build:web:workbench`、`npm audit --omit=dev` 与 `git diff --check` 全部通过；production bundle 的大 chunk 警告仍存在，但不是构建失败。
6. 完成 service composition 与架构行数收紧后再次运行 `npm run test:web:browser`：`RAH_REAL_BROWSER_GATE` 通过，最终响应式视口为 390×844。

浏览器实验使用隔离临时 state 与 Fake CLI，避免付费 Provider。Fake CLI 仅提供确定性业务执行，页面、HTTP、Kernel、AgentHost、真实子进程终止和重新调度均走正式生产代码。

## 正式 4173 发布复核

发布前只读检查确认正式库 `PRAGMA quick_check=ok`；唯一历史 RunAttempt 为 `exited`、RuntimeProcess 为 `terminated`、Activation 为 `completed`，没有在途 Agent 工作。旧正式进程收到 `SIGTERM` 后优雅退出；迁移前状态完整备份到 `/Users/sun/Library/Application Support/RAH OS/backups/formal-pre-restart-20260901-145534/state`，备份库再次通过 `quick_check`。

新 production workbench 使用原持久目录与 Workspace 启动在 `http://127.0.0.1:4173/`；`/_rah/health` 返回 `online`，数据库由 schema v24 迁移到 v25，迁移后 `quick_check=ok`。全新浏览器页面实际确认：`RAH Local Workstation`、1 个频道、4 个本机 CLI 私聊入口、Room Tasks 面板均可见；进入 Codex 私聊后，重启前的 Human/Agent 两条历史消息仍存在。没有发送正式消息或调用付费 Provider。

## 仍不扩大宣称的范围

- 未用真实付费 Codex/Claude/Kimi/OpenCode 重跑改派；正式 prompt 合同与 fake 子进程链通过不等于真实模型服从性证据。
- 未实现跨 Computer 改派。
- 终止证明超过本机 daemon 等待窗口时保持 fail-closed；未决 operation 的独立恢复 UI 仍是后续可靠性增强。
- 本报告不宣布 Raft 全站 UI/交互 100% 一致。
