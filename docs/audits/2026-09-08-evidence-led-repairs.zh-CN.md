# 上游核实后的首批修复与交付

2026-09-08。仅 `rah_os`。依据[重新分类](./2026-09-08-raft-behavior-revalidation.zh-CN.md)与[施工顺序](../product/2026-09-08-evidence-led-repair-order.zh-CN.md)，本批关闭 A1/A2/A3/A8 的下述本地边界，没有把全部八项当成 Raft 缺陷，也没有改变 A4/A5/A6/A7 的产品语义。

## 已修复的行为

| 项目                      | 最小实现与实际退出条件                                                                                                                                                                                             | Raft 证据边界                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| A1 开放任务重新接手       | 原 `requireWorkerTaskDelivery` 白名单补 `task.unassigned`。原 Agent 完成执行，另一 Agent 仅收到解除分配事件后 claim/start/submit；HTTP 和真实 Node fake 子进程均通过。未来 Task、其他 Room、终止后的旧凭据仍拒绝。 | 官方明确解除分配后重新开放；本地事件/Activation 结构不是官方规范，未冒称本轮完成官网另一 Agent 接手实操。 |
| A2 等待后 Worker 凭据撤销 | 证据采集后、内部 patch 上传与最终 submit 前复验当前凭据；撤销或到期不能落账 Submission。MCP 结果完成后重验，使用原调用记录表述授权丢失。                                                                           | 修复 RAH 已有认证承诺；Raft server 同条件撤销时序仍未知。                                                 |
| A3 LAN 在途重启撤销       | 共享 gateway handler 使用动态认证函数，正文完整读取/校验后、同步 restart 接受前再验同一会话。真实 TLS 中通过另一临时设备撤销在途设备，返回 401 且调用次数零；正常请求仍 202/一次。                                 | 已有 LAN 部署认证适配；没有声称 Raft 使用同样的配对 cookie 模型。                                         |
| A8 Agent 旧结果串扰       | 原 AgentStateDialog 复用 latest-request，卸载后撤销旧回调的更新资格；不再关闭 B 新弹窗或写入旧失败。成功/失败迟到、B 正常继续及刷新均通过。                                                                        | 本地 UI 正确性修复；官方源码存在相似结构，本轮不标双边相同竞态已通过。                                    |

A1 的真实 fake 子进程起初只 ACK 解除分配通知而不处理 Task，新测试按 canonical 状态失败；随后仅给既有测试 provider 补齐该事件识别，再验证真正 submitted。不能以 child exit 0 或通知 ACK 作为提交证明。

A2 不承诺回滚已经发生的外部 MCP 效果：当前 Run 仍有效时，既有调用记录为 failed，原因 `authorization_lost_after_execution`；同时 Run 已终止时不绕过执行围栏补写终态，返回认证/执行错误且原调用可能保持 pending。pending 表示终态尚未收敛，不等于工具没执行，不授权自动重试。此边界在 owner 文档明确保留。

## 验证证据

证据根目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-evidence-led-repairs`。

- A1：[仓库测试](../../packages/application-service/test/worker-unassigned-handoff.test.ts)，`a1-red.log`、`a1-green.log`、`a1-child-red.log`、`a1-child-green.log`、`a1-regression.log`。独立复核另测 Room/participant/Task/aggregate/range 边界、原 Agent 与接手者旧凭据、提交 Run ID：[独立报告](/Users/sun/Code/reviews/rah_os/2026-09-08-evidence-led-repairs/a1-independent/review.zh-CN.md)。
- A2：7 个正式 RED→GREEN，相关包/MCP/Files 60 项通过；独立增加 5 个反例，含上传已暂存后撤销、仅 Run 终止、executor 自身失败。已暂存文件不等于公开或提交成功。[作者证据](/Users/sun/Code/reviews/rah_os/2026-09-08-evidence-led-repairs/a2-worker-await-closure.zh-CN.md)、[独立报告](/Users/sun/Code/reviews/rah_os/2026-09-08-evidence-led-repairs/a2-independent/review.zh-CN.md)。
- A3：真实 TLS/100-continue 反例先红后绿、正常接受控制、13 项相关回归及原独立反例通过：[证据](/Users/sun/Code/reviews/rah_os/2026-09-08-evidence-led-repairs/a3-lan-restart/closure.zh-CN.md)。
- A8：Chrome/Firefox × 成功/失败迟到 × 1440/390，共 8 个精准浏览器场景通过；原启停、失败同键重试、删除前置及删除的隔离回归通过。作者查看 RED/GREEN 截图，主审再次查看修后移动弹窗：[证据](/Users/sun/Code/reviews/rah_os/2026-09-08-evidence-led-repairs/agent-dialog/closure.zh-CN.md)。
- `integration-check.log`：`npm run check` exit 0。包测试 1061 通过、5 opt-in 跳过；Web 371、回归 34、正式浏览器策略 11、双边工具测试 3 通过。工具测试不等于官网双边实操。
- `format-check.log`、`git diff --check` 通过。`formal-build.log`：正式 Web 构建成功，保留既有大 chunk 提示，不扩大阈值掩盖。
- `restart-browser.log`：Chrome/Firefox 桌面和 390px 的页面重启、初次状态错误恢复、旧页面回执及持久状态检查通过。`firefox-workbench.log`：冻结工作台桌面/移动持久旅程通过。
- `frozen-source.json` 保存冻结产品/测试文件摘要；集成、构建后再次比对无变化。本轮没有执行付费 CLI 或新的官网 mutation 实验，未声称真实模型验收或完整 Raft 复刻。

## 正式实例交付

正式构建：`543770d26bc9d59c850a309b5e9e40355c6680a1ee694d68dd1b7892a5ecaa95`。

按用户既定要求执行精确实例空闲检查、备份及优雅替换：原 PID 55768，后继 PID 79469；正式地址仍为 `http://127.0.0.1:4173`。`formal-restart.log` 记录验证备份 `/Users/sun/.rah/backups/pre-restart-ab8f0be9-7fc3-42c9-8547-4b1cf0d81692`，未强杀、未使用 fixture 替换正式地址。

`formal-before.json` / `formal-after.json` 完整摘要一致：6 Room、43 Message、2 Task、4 Agent、44 Agent revision、16 membership、396 Room event；Runtime 配置、工作台配置及 37 个私有记忆文件摘要保持。此比较只涵盖列出的持久内容，动态 Host 心跳不是不可变表。

`formal-browser-after.json`：新 Firefox 页面在 1440×900、390×844、DPR 2 读取新 build；Search 刷新、Agent 资料/Skills、Computer 6 个页面观察通过，无页面异常、无策略拒绝请求。截图已经查看。它是新版本真实页面的交付复验，不替代隔离环境中实施的授权竞态和 Agent 停止操作。

本批未提交或推送 Git；HEAD 仍为 `672c596`，上述结果对应未提交工作树及已重启的本地正式实例。

## 仍未收口与后续顺序

1. A4/A5 的本地历史回执合同、A6/A7 的暂停/Task Artifact 租约语义仍待裁决或补证，未偷偷作为本次修复追加。
2. 下一页面族是 **Task 适用行为**：先核实官网 amend、delete/closed、负责人/状态权限，再逐个实现缺失 owner 与 UI 并验收；不能把既有代码更强限制自动当官方合同。
3. 之后按依赖推进 Agent 频道静音、搜索完整参数、消息附件交互及跨 Room/DM 寻址；Wiki/Integration/Action card 先做适用性裁决。
4. 全页面族同条件官网对照、完整真实模型单次父子任务链、PWA 真机及 MCP 首次配置调用等仍按[剩余清单](./2026-09-08-parallel-closure-integration.zh-CN.md)保留。多 Human、远程其他 Computer、大文件流式继续延期。

此批关闭四类有明确范围的本地修复，没有关闭全部复刻任务。
