# Task 状态统一入口：五态接线与本地安全边界

## 证据和范围

参考授权 Raft Computer SEA 1.0.18 提取物 `main.js`，SHA-256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。`src/commands/task/update.ts` 位于 730404–730474 行：接受 `todo/in_progress/in_review/done/closed`，发送单个状态更新请求；freshness hold 输出“未应用”，非 5xx 请求错误为 `UPDATE_FAILED`，成功输出 `#N moved to STATUS.`。这证明 CLI 可观察合同，不证明闭源服务端的任意转换、事务或批准判定。

本轮是现有 Kernel 状态机的五态组合入口，不宣称未知服务端的所有转换完全等价。新增 `rah worker task-update --task-id ID --status STATUS`，也支持已有 `--target '#channel' --number N` 寻址；可选 `--summary` 是本地已有交付证据所需的显式输入，Raft 该命令未提供它。

## 已实施边界

- `todo` 仅释放自己拥有且可合法释放的 claimed/in_progress Task，复用原释放 owner；不能解释成任意状态回退。
- `in_progress` 从 todo 在一个事务内组合认领与开始，从 claimed 真正追加开始事件；故障不残留半个认领。已在 in_progress 的重复设置不另起状态机。
- `in_review` 复用原提交、冻结证据和执行授权 owner。使用显式真实 summary，或本 Agent 在该 Task Thread 自最近开始后实际发送的结果；没有可用结果时明确拒绝，不能补虚构摘要。旧命令已提交后再换新入口是否等同无操作，不宣称完全一致。
- CLI 按返回的实际 canonical 状态渲染；held 不渲染成功移动。非 5xx 的状态路由失败输出 `UPDATE_FAILED`，保留诊断，其他路由不受影响。
- Room 交付、执行凭据、当前参与范围、唯一负责人、freshness 和幂等校验仍由原 owner 执行。旧生命周期命令继续兼容。

## 完成、关闭及来源边界

Raft 同一提取物 735620–735638 行 `buildTasksSection` 要求先 `in_review` 交人类验证，再在 Human 批准（例如 “looks good” 或 “merge it”）后由 Agent 设为 `done`。因此恢复该 prompt 约定，不新建批准表、令牌或自然语言分类器。后端并不验证一句话是否构成批准，也不把 Agent Review 当作 Human 批准。此前重复要求用户裁决造成不必要停顿，已按其持续要求的 Raft 对齐目标继续。

- `done` 使用真实 Agent 身份，只能完成自己负责且已 submitted 的 Task；Human 和 Worker 共享 `task-completion.ts` 的原完成事务。显式配置的 reviewer 必须批准当前 submission，依赖释放及 attention 保留。这些是 RAH 既有安全约束，不能称已证实 Raft 服务端同样检查。
- `closed` 仅关闭自己负责的 Task，复用原取消投影及 pending-input 清理。Worker 自行关闭不会取消整个 Activation，否则会终止同轮其他 Task；Human 强制取消的进程取消请求及终止证明保持原样。本人限制和执行衔接属于本地适配，上游 CLI 的五态枚举不证明这些服务端条件。
- 两条入口仍检查真实执行凭据、Task 交付范围、成员、freshness 和幂等。新 Room 事实未读时先 hold，读取后可重试；不能凭退出码宣称完成。

`reviewer-isolation`、任意状态互转及闭源服务端所有 hold 条件未因此对齐，登记表保留未证实行。五态入口可用与全部 Task 合同等价是不同结论。

## 验证状态

协议与 CLI 先红后绿，覆盖五态输入校验、可选摘要、实际状态输出、held、`UPDATE_FAILED` 与非目标路由回归。独立执行协议、CLI、错误码和真实 HTTP/Kernel 状态测试四文件通过；后端覆盖开始/释放与重复循环、claimed 真正开始、freshness 读后恢复、无摘要拒绝、实际 Thread 结果提交与重试、事务故障回滚、跨 Room 和撤销凭据拒绝。

测试使用临时数据库和假 Runtime。这不是付费模型验证、Raft 双边实景验收或正式部署。正式部署在本轮完整检查和独立审查通过后执行，下文另记实际结果。

完整 `npm run check` 已退出 0（`/tmp/rah-task-status-check-final.log`）：后端 1527 通过、17 跳过，Web 395 通过，另含登记表、类型检查及各回归门禁。`npm run format:check` 和 `git diff --check` 通过。登记表因有证据的 `UPDATE_FAILED` 一行完成，将缺失阈值从 42/26 收紧为 41/25；这不代表整个状态合同完成。以上是终态接线前的检查基线；终态接线后另跑完整门禁。未提交、推送或运行付费模型。

## 终态接线最终验收与部署

- 先红后绿：`/tmp/rah-task-terminal-red.log` 重现 done/closed 被旧 Human-only 检查拒绝；修复后 HTTP 实测完成、关闭、hold→读取→重试、真实 Agent actor、幂等以及关闭 A 后继续 B。Prompt 用实际字符串先失败，再恢复 Raft Human 批准后完成规则，同时移除过时 Artifact 必填 key 示例。
- 独立真实 Reviewer 测试 `task-update-reviewer.test.ts`：指定 reviewer 未审时拒绝且不写完成事件；独立 reviewer 凭据调用真实 Review API 后，owner 读取新上下文并成功完成。无 reviewer 路径由主 HTTP 测试覆盖。45 项组合回归通过（`/tmp/rah-task-terminal-independent.log`）。
- 完整 `npm run check` 退出 0（`/tmp/rah-task-terminal-check.log`）：后端 1531 通过、17 opt-in 跳过，Web 395 通过，其余登记表/类型/回归通过。新增独立 Reviewer 文件另行通过；最终类型、格式、diff 检查通过。没有运行付费模型或官方同条件模型实验。
- `build:web:workbench` 通过；Worker message tools 的 Chrome/Firefox、桌面/390px 隔离浏览器回归通过，证据目录 `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-worker-tools-browser-FQyOiO`。这些是假 Runtime 测试，非正式用户数据。
- 正式实例确认闲置，验证备份后 SIGTERM 温和重启：PID 82443 → 98637；备份 `/Users/sun/.rah/backups/pre-restart-0c7b81b7-c86a-4a1c-8925-889d8480b1c5`。正式 URL `http://127.0.0.1:4173` 实际返回 Web build `aff7b0d74d1fbecb3a56379d076a47770414e39f6ccf2bce164bc3b11deea248`。
- Chrome 新加载正式 Tasks 页看到原 2 项待确认任务，Room 页原消息保持可读。重启后 410 events、43 messages、2 Tasks、4 Agent definitions、6 Principals 与备份逐行一致；memory/config 文件摘要不变，外键检查为空。没有替用户完成历史任务或触发付费 Agent。
- 产品冻结清单 `/tmp/rah-task-terminal-source-manifest.json`：1361 文件，摘要 `6955d070f216c3edc0e416ddbaa18f98ce008b8473bf3b92216a6755dfaf69d8`，部署前重新验证。此次未 commit/push。

本批五态入口按以上允许路径完成代码、自动检查与部署收口；不据此扩张为整个 Raft 后端完全等价。第 3、5 项此前部署，第 4 项批量与本轮状态入口已交付，未知服务端转换及真实模型双边验证仍单独记账。
