# 交付后独立反证审计

后续修复：[A1/A2/A3/A8 已按限定边界修复并交付](./2026-09-08-evidence-led-repairs.zh-CN.md)；其余项目未在该批修复。本文保留发现时的原始反例，不作为最新缺陷状态表。

后续裁决：[Raft 源码与官网实验复核](./2026-09-08-raft-behavior-revalidation.zh-CN.md)。本文八项是相对于 RAH 当前合同的内部反例，不是八项已确认的 Raft 差异；以下 P1/P2 与建议顺序不能直接当作复刻主线优先级。

日期：2026-09-08。按用户要求先审计、后报告，本轮不修产品。审计对象仅为 `rah_os` 当前工作树（HEAD `672c596` 加尚未提交增量），不是旧 `rah`。

## 结论

上一批已实现并通过既有门禁，但“本批收口”需要收窄。本轮发现 **8 类可复现问题：3 个 P1、5 个 P2**。这些是现有授权、任务投递、幂等回执和页面生命周期边界遗漏，不构成推翻 Room-first 架构的依据；也不能继续宣称只剩截图对照。

主审复核源码、关键反例和已有验证日志；三个独立审计者分别检查任务管理、附件/读取、Computer/页面。反例全部在临时环境运行，无正式业务写入、无付费 CLI、无正式重启、无提交或推送。审计报告和索引是本轮唯一仓库修改。

## P1：优先重新打开

### A1 清除 Task 负责人后，后续 Agent 无法接手

Human 合法解除分配，第一 Run 正常退出后，新 Activation 只包含 `task.unassigned`。Task 已开放，但 claim 返回 403 “was not linked in this Activation range”。投递 owner 创建了 attention，执行授权白名单却遗漏该事件。

位置：[worker-task-scope.ts:50](../../packages/kernel/src/worker-task-scope.ts#L50)、[task-unassignment.ts:126](../../packages/kernel/src/task-unassignment.ts#L126)。最小修复应在现有任务投递授权 owner 补齐同 Task、同 Room、同 Activation 的合法来源，保留单赢家认领；不能改成知道 Task ID 就可认领。

旧测试止于清除成功和历史查询，没有验证下一 Agent 的接手终点。[三项任务反例、日志及分析](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/worker-management-audit.zh-CN.md)。

### A2 任务提交与 MCP 调用，异步等待后继续使用已撤销 Worker 凭据

在冻结交付证据期间撤销 HTTP bearer，Run 本身仍有效，提交仍返回 200，Task 成为 submitted 并产生一份 Submission。MCP executor 等待期间撤销 bearer，同样返回 200 并完成调用记录。两个分支均有失败反例，原有两个正向控制测试仍通过。

位置：[worker-application-service.ts:1058](../../packages/application-service/src/worker-application-service.ts#L1058) 的证据采集后提交，以及 [同文件:695](../../packages/application-service/src/worker-application-service.ts#L695) 的 MCP completeCall。先前修复覆盖请求体与上传等待，没有覆盖后续内部 await。

应复用当前凭据 owner，在等待后的新写入/结果交付前重验；内部 patch Artifact 路径也须覆盖。MCP 已经发出的外部操作不能承诺回滚，应区分已执行副作用与撤销后的结果交付。本例不证明已终止 Run 可以绕过 Kernel 围栏。

证据：[submit 反例](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/submit-revoke.test.ts)、[日志](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/submit-revoke.log)；[MCP 反例](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/mcp-revoke.test.ts)、[日志](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/mcp-revoke.log)。

### A3 LAN 设备撤销后，已开始的请求仍能触发重启

真实隔离 TLS gateway 中，合法设备发送部分重启请求体，Human 撤销设备，再补完请求体；返回 202，测试 restart control 被调用一次。没有重启正式服务。

位置：[workbench-service-control.ts:14](../../packages/daemon/src/workbench-service-control.ts#L14) 接收一次性的 authenticated 布尔值，读取请求体后 [第 56 行](../../packages/daemon/src/workbench-service-control.ts#L56) 执行 restart，没有重新确认设备会话。应由原 gateway 提供可重新验证的认证上下文，执行前检查；Origin、generation 和忙碌守卫继续保留。

这需要此前已认证且仍在传输的请求，不是任意匿名远程重启。它属于已支持的 LAN 浏览器访问，不属于延期的远程 Computer 调度。[反例](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/computer/lan-restart-revoked.test.ts)、[失败日志](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/computer/lan-restart-revoked-red.log)。

## P2：本批一致性和恢复缺口

| 编号 | 已复现行为与影响                                                                                                                    | 单一修复边界                                                                                                   |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| A4   | convert 成功后换一个有效 Run，同键使用旧 cursor 返回 409，使用新 cursor 也返回幂等冲突；没有重复 Task，但无法确定性取回原成功回执。 | `task-intent.ts:115` 将业务意图与本次执行 cursor 分开；保持当前身份与可见性检查。                              |
| A5   | unblock 成功后 Human 合法重新分配，原有效 Run 重放同键返回 403，历史成功回执受新 assignee 影响。                                    | `task-unblock-service.ts:38` 区分已接受回执读取与新操作资格；不能绕过凭据撤销。                                |
| A6   | Human 将 Agent disabled 后、Host 取得终止证明前，普通附件和资料读取已拒绝，Task Artifact prepare/PUT 仍 200 并落盘。                | `room-files.ts:985` 与既有 enabled/membership 准入一致；不声称已终止 Run 可写。                                |
| A7   | Task claim 到期但 Host Run lease 仍有效，progress 已 409，Artifact prepare/PUT 仍成功。                                             | `room-files.ts:1003` 复用有效 Task claim 判定，不能只看 claimed_by；未证明最终 submit 可绕过其独立检查。       |
| A8   | A 的停止操作已成功但响应延迟，浏览器返回并打开 B 的停止确认框后，A 的旧响应关闭 B 的新确认框。                                      | `agent-state-dialog.tsx:41` 等待后检查组件/操作身份；`agent-directory-pane.tsx:815` 不能被旧实例清除当前弹窗。 |

A4/A5 证据见[任务专项](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/worker-management-audit.zh-CN.md)；A6/A7 见[附件专项](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/worker-read-files-profile-review.zh-CN.md)。A8 用真实 Chrome 隔离页面、延迟真实成功响应复现，未执行 B 的停止操作；见[浏览器日志](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/computer/agent-dialog-late-browser.log)及[前后结果](/Users/sun/Code/reviews/rah_os/2026-09-08-post-delivery-audit/computer/late-dialog-result.json)。

## 本轮确认及排除

- 正式页面仍服务构建 `160b0033f8f5786a04b33196e09eb7829d220f87141a1cb0517d5c8a61f599a1`。产品源码与上一轮冻结候选匹配。已有全量检查通过记录真实存在；新反例说明覆盖不足，而不是旧日志不存在。
- 真实父子任务链的保留数据库确有三项 completed，父任务 unblock 与后续 claim 来自同一 Agent 的不同 Run。但证据是分段续验；修正后的单次全程付费门禁仍未复跑通过。
- 本轮新增不等长 UTF-8 历史分页检查通过：首、中、尾 anchor 双向遍历没有漏项或重复，维持字节上界。
- Computer 深链“选择/创建 Agent 禁用”疑点未复现：隔离页与正式只读页初始、轮询后、刷新后入口均可用，不据旧截图列缺陷。
- 读取、资料、附件审查未复现新的跨 Room 数据通路。这是本轮范围内结果，不是全面安全证明；慢速下载途中撤销是否强制截断仍缺明确合同及真实回压测试。

## 距离 Raft 复刻仍未收口

下列是已有差异或验收缺口，不计入上述 8 类新发现；来源见[上一批集成证据](./2026-09-08-parallel-closure-integration.zh-CN.md)与[API 合同映射](../product/raft-agent-api-contract-map.zh-CN.md)。本轮没有重新抓取官网，不声称完成新的全产品双边验收。

- **后端功能：**Task 标题/描述修改及真正删除、Agent 自身 Room 静音、附件评论/锚点、Worker 搜索完整参数、Kimi/OpenCode Skills 发现、跨 Room/DM 寻址及 Agent 自主管理授权；仅附件消息转 Task 的上游语义仍待核实。Wiki、本机 Integration、Action card 需要逐项适用性裁决，不能因无中央订阅而默认排除。
- **前端对照：**当前官网版本下全页面族同条件视觉和交互尚未闭合；Search 结果计数口径、帮助入口等保留差异。Computer/Agent 部分旧截图数据量或缩放不同，不能作为严格双边通过。
- **验收：**完整父子任务单次运行、新增工具真实模型使用、当前候选真机 PWA 安装/通知/离线、MCP 首次配置→分配→实际调用等尚缺完整专项证据。代码、确定性测试、隔离浏览器、付费 CLI、官网双边、正式部署各自单独判定。
- **继续延期：**多 Human、远程其他 Computer、大文件流式待核实。中央订阅/账单、应用市场、语言/翻译/时区不做。

## 后续施工顺序建议

1. 先关闭 A2/A3：撤销凭据后不得继续接受新的提交或重启；审查同 owner 的等待点，新增反例先红后绿。
2. 关闭 A1，并验证清除负责人→下一次唤醒→其他 Agent claim/start/submit 的业务终点；同时关闭 A4/A5 回执恢复。
3. 在原 Files owner 关闭 A6/A7；在原弹窗生命周期 owner 关闭 A8，验证切换、返回和迟到响应。
4. 集成回归上述边界及完整父子任务链，再按证据清单逐项推进尚缺的 Raft 功能与双边页面验收。不要在这些已知缺陷上继续扩展基础工具。

可以并行修复互不重叠的 owner，但由一个集成负责人验证组合结果；每项必须写明反例、修复、复验及剩余限制。当前仅完成审计，没有将上述建议记为已修复。
