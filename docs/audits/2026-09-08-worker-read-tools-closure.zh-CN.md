# Worker 基础读工具与普通附件接线收口

日期：2026-09-08。范围：`rah_os`、本地单 Human、多 Agent。基线 `672c596` 之后的未提交工作区；不代表正式工作台已部署。本批先按 [75 路由与 18 命令族映射](../product/raft-agent-api-contract-map.zh-CN.md) 确认适用行为，再做失败用例与实现。

## 已闭合的行为与 owner

- Protocol 新建 Worker read schemas；Kernel `WorkerReadService` 组合现有投影和 `discoveryPage`；Application Service、Worker CLI 与 standing prompt 只作为 facade。新命令为 `message-read`、`message-resolve`、`room-members`、`server-info`、`profile-show`、`task-list`、`task-history`。
- 有效 grant 决定身份和 Room；同 Room 普通成员可读 Task/历史，不需认领。当前可见事实不受旧 Activation 起点截断，读取不 ACK、不推进 known causal cursor、不扩展写权限。成员撤销即时拒绝；跨 Room 与伪造 actor/Room 参数拒绝。
- 历史 before/after/around 与 Task history 使用本 Room 单调序号冻结第一页。独立审查另发现 around 后续旧页在 UTF-8 字节限额裁剪时丢中间记录：正式 RED 为预期 5 条、实际 4 条。现仅首个 around 页保留锚点裁剪，后续页按实际方向裁剪；14 项定向回归通过，日志 `around-utf8-red.log` / `around-utf8-green.log`。独立审查复现“删除另一个 Room 后 SQLite rowid 重用使旧窗看到新事实”，修复仍使用同一 cursor owner，未复制算法。Task 看板以 `task.created` Room 序号冻结候选，状态和负责人为当前投影，明确不是 MVCC 快照。
- profile 的展示名、描述、头像取当前 Agent revision；Principal identity 保持稳定，角色指令、记忆策略、凭据不出现在返回中。server-info 明示仅当前 Room，不伪称已经提供全部跨 Room/Runtime 目录。
- 页包含完整记录，按真实 UTF-8 JSON 控制预算；完整响应含元数据/cursor 不超过 512 KiB。单条过大明确拒绝，不截正文、不跳过、不空页无限循环。精确 resolve 若正文与 root 合计超限亦明确拒绝。
- 普通附件由协作批次的 RoomFiles/Worker message transaction owner 管理；本批接 Protocol 公共导出、Worker HTTP prepare/cancel/GET/PUT、CLI publish/cancel/download 和 message-post 附件数组。复用已有本地文件上传算法；普通消息无需 Task，Task Artifact 冻结证据不变。详情见 [协作闭环审计](./2026-09-08-collaboration-core-closure.zh-CN.md)。

## 上游依据与实现性质

Raft Computer 1.0.18 `agentApiContract.ts` 的 historyRead:1363、messageResolve:1453、channelMembers:1553、serverInfo:1583、taskList:1623、taskHistory:1713、profileShow:1853、attachmentUpload:2009、attachmentDownload:2069；文件 SHA-256 为 `ce9db68aff56f34e56186cc8332d9b1dae74196422f113353de0a288915cf4db`。定位见合同映射的固定源码链接。该文件是行为合同来源；产品代码为 RAH glue 和既有 owner 复用，没有把重写标成逐字复制。

## 本轮实际验证

证据目录：[2026-09-08-worker-read-tools](/Users/sun/Code/reviews/rah_os/2026-09-08-worker-read-tools)。

| 层级              | 实际结果与限制                                                                                                                                                                                                         |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TDD               | protocol 缺导出、HTTP 404、CLI 缺命令、prompt 缺指引、完整审计链缺真实读调用分别 RED→GREEN；高字节页、current revision 展示、删除 Room 冻结反例、精确 resolve 总封包超限均已复现并修复                                 |
| Kernel/HTTP/CLI   | 专项用例验证读权限、分页、精确 Thread、Task 查重/历史、UTF-8 和超限。HTTP 使用真 grant；较新读不授权写入时沿既有 `409 causal_cursor_not_delivered`；未知 actor/Room 参数不会被采用                                     |
| 确定性多 Agent 链 | `agent-task-split-chain.test.ts` 使用外部 fake provider child 调用真实 Worker CLI：成员/身份→任务列表查重→任务/Submission/历史/精确消息读取→回 canonical Task Thread，保留 Human 返工/验收断言。它不是付费真实模型验收 |
| 相关包回归        | Protocol、Kernel、Application Service 全部 tests，加 Worker CLI/read CLI、standing prompt/read prompt、确定性多 Agent 链，共 456 项通过。日志 `package-regression.log`，进程 exit 0                                    |
| 类型/差异         | `npx tsc --noEmit` exit 0；本批格式化已执行；`git diff --check` exit 0。全仓 `npm run check` 与 `format:check` 由主工作批最终冻结候选执行，本报告不代称通过                                                            |
| 尚未运行          | 本批未运行付费真实 CLI、官网同条件视觉/行为对照、正式服务重启/部署。这些验证层级由主交付分别记录                                                                                                                       |

普通附件的真实外部 Node Worker child 与 Kernel 失败恢复由协作批次另有证据，不将其当成图片截图或真实付费 Agent 的行为证据。

## 仍未在本批关闭

剩余 Worker 写工具、Agent 本人资料修改/头像、Agent 普通活动静音、完整附件评论 owner，以及映射中显式的 decision-needed 项。Task assign/unassign、转换不认领是下一项已存在 owner 可复用的闭环；真正 amend/delete 不与 closed/progress 混淆。Human 最终验收为已批准本地差异；跨 Room 目录与完整 profile 关系字段尚未因本批基础读工具而自动完成。
