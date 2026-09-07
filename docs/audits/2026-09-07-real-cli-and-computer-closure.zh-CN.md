# 四家真实 CLI、冻结 Review 与 Computer 操作收口

本报告只适用于 `rah_os` 的单 Human / 单 Mac 主线。用户本轮明确授权四家付费 CLI，
指定尽量 low effort、Claude Sonnet 4.6（禁用 Fable）、Codex gpt-5.6-sol、Kimi K3、
OpenCode DeepSeek。以下结果替代旧报告中的“尚未授权／未运行真实 CLI”，不替代完整产品验收。

## 真实执行证据

私有证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-real-closure`。
所有执行使用隔离临时数据库和工作目录；没有向正式 Room 发送测试消息，没有修改用户 CLI 账户。

| 执行                        | 精确模型及 effort                                                                           | 实际结果                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| 三家 native adapter 同 Room | Codex `gpt-5.6-sol` low；Kimi `kimi-code/k3` low；OpenCode `deepseek/deepseek-v4-flash` low | 各回复一次、普通讨论零 Task、持久请求一个负责人及实际文件交付；全部 Activation 收敛，`native-multi-final.log`      |
| Claude native adapter       | `claude-sonnet-4-6` low                                                                     | 普通回复及独立 Task 文件交付通过，`claude-native.log`                                                              |
| 双 Agent Review             | DeepSeek low 负责；Kimi K3 low 审查                                                         | VERSION_ONE 冻结附件→驳回→VERSION_TWO 新附件→批准→Human 完成→数据库重开保持两份提交和两条审查，`review-native.log` |

Claude 当前 CLI 的 `sonnet` 别名指向 Sonnet 5，不能代替用户指定的 4.6。
测试通过进程范围的 `ANTHROPIC_CUSTOM_MODEL_OPTION=claude-sonnet-4-6` 注册精确模型，先核对
真实 catalog 和支持的 effort，再用生产 `claude-stream-json/v1` 执行；不改全局配置、不使用 Fable。
另有 generic Claude gate 通过，但不以 generic 结果替代 native 结果。

`canonical-results.json` 汇总三个成功临时数据库的 Placement、RunAttempt、Activation、Task、Review。
测试通过认证 API 驱动与读取 canonical 状态；provider transcript 不用作 Room 完成判据。
Review 是有预设二版本目标的协议验收，证明模型实际调用冻结文件/审查流程，**不证明能识别任意复杂缺陷**。

首次三家 gate 假定 Run 数恰好等于 Agent 数，未通过。实际 Room 将同伴回复作为上下文投递，
因此存在不再回复、只读并 ACK 的额外运行；这是既有路由合同，并非无限自激活。
修订测试为每 Agent 一次回复、第一阶段最多 N² 次运行、全队列终态、普通聊天零 Task，
并保留后续单 owner/真实文件断言。没有为迁就模型结果改业务路由；失败日志保留为 `native-multi.log`。

可重跑命令（均显式付费 opt-in；默认 check 跳过）：

```bash
npm run test:real:multi-cli
npm run test:real:claude:sonnet46-low
npm run test:real:review
```

## Computer 补缺与唯一 owner

- `agent.workspace.summary`：protocol schema → SDK → authenticated application service →
  AgentHost coordinator → 既有 root-scoped 文件读取器。manager 身份在 I/O 前后复核，
  客户端只能提交 Agent ID，不能提交任意根目录。扫描不建立新持久状态、不创建尚不存在的工作区。
- 计数限于可浏览文件；不跟随链接，不计入既有 secret filter 排除项。最多 128 个目录，
  每目录沿用有界读取，超限明确标记部分结果。Web 手动扫描前 50 个 Agent，标明范围及失败重试。
  这是有界观察，不是原子磁盘快照，也没有独立的总墙钟超时。
- Computer 创建入口复用已有 AgentCreateDialog/创建命令；Escape 关闭与焦点返回已验证。
- 批量启用/停用复用已有 `agent.manage set_state` 和 causal barrier；无第二个业务队列。
  部分失败保留操作键，重试跳过已成功项；离开范围停止后续请求，已接受的命令仍由服务端完成。
  UI 用“启用／停用”，不把 Agent 调度状态称为 CLI 进程运行状态。暂未引入批量 reset/delete。

来源与差异：

| 来源                      | 固定证据                                                                                                                                                                                                                | 采用／不采用                                                                                           |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 授权 Raft Computer 1.0.18 | `raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/source-slices/packages/daemon/dist/chunk-ZHWD6VKE.js`，`summarizeWorkspaceDirectory` 11437、`scanWorkspaceDirectories` 11462；版本来源沿用既有提取账本 | 结构移植文件数、字节、修改时间聚合；以现有受限 reader 替换无界递归 Promise.all，不复制原始全目录删除   |
| 授权 Raft Web             | `docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js`，SHA-256 `5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8`                                                                    | 采用扫描/重扫、选择入口及 border-2、gap-2、px-3、py-2 行结构；进入内部 ui-tokens；不是 byte-exact 复制 |
| Multica（Apache-2.0）     | commit `11861145abc59a0d39c8c8f24ad837d4584e664f`，`server/internal/daemon/diskusage.go` `taskSize`，SHA-256 `aea2311c6e0478f5702d24ae35ce691f8377035165770c5b115844f386425ce7`                                         | 交叉核对不跟随链接、普通文件计数；其 Task/artifact GC 所有权不适用 Agent Workspace，未移植             |

官方登录页实际扫描显示非空工作区、文件数和大小，因此“官方离线”不是当前阻塞。
当前官方观察为分屏交互证据，未形成同 viewport/DPR/zoom 的双边像素验收。

## 逐层验证与纠错

`scan-red.log`、`scan-absent-red.log`、`bulk-retry-red.log` 保留预期失败；对应 green 日志通过。
API 测试包含非 manager 403、任意 root 400、授权前禁止 Host I/O；SDK operation/route inventory 同步。

Computer browser gate 在 Chrome/Firefox × 1440×900 / 390×844 注入第二项命令 503，
核对三次请求中的幂等键复用，并从真实 API 查两 Agent 的 disabled/enabled 状态。
扫描 503→重扫恢复、创建入口关闭和焦点也在同旅程核对。截图和源输入 hash 随最终 receipt 保存。

早期 scan gate 只等待行出现，截图却暴露 internal server error；它不算通过。
根因是从尚未创建的父目录解析 realpath；已改为从既有 Agent 专属路径调用 absent-aware reader，
加入未物化目录回归测试，并强化浏览器等待扫描结束且无 alert、出现真实计数。

后续更新：有界媒体预览已进入[下一批收口审计](2026-09-07-media-preview-closure.zh-CN.md)，
下述媒体未实现是本批修订时的事实；完整流式/原生 PDF 工具栏仍不由后续基础预览代替。

## 五项当前裁决及未收口边界

1. 配置/运行：四家指定模型真实普通回复及 Task 运行通过；同一 Agent 在运行中改模型后下一 Run
   的配置连续性仍以既有确定性门禁为证，不冒称四家所有生命周期组合全测。
2. Room 协作：真实三家同 Room 和队列收敛通过；重启/丢失 wake/围栏已有确定性证据，长期 soak 仍缺。
3. Task/Review：真实双 Agent 驳回返工、冻结读取、Human 验收及数据库重开通过。
4. 页面：Computer 本次功能闭环成立，但孤儿/已删除工作区清理、批量 reset、直接 Computer
   进程重启/升级 UI 仍须按单机适用性逐项裁决；现有安全终端恢复指南不冒称 UI 等价。
   **附件 PDF、音频、视频内嵌预览确实未实现**：官方 `index-BoAC7nSE.js` 的 Ott/mle/fle
   分类和 Nb/xle 动作有此能力；本地 `classifyAttachmentPreview` 仍返回 unsupported。
   当前文本/结构化预览与完整文件下载可用，不等于所有类型预览完成。
5. 发布：本地自动门禁及本轮真实 CLI 分层列证；完整同条件全页面对照、实体 PWA/系统通知、
   长期运行验收尚未完成。因此不能宣布“五项全部完成”或“完整复刻 Raft”。

后续首先沿现有 Files ACL/download owner 关闭二进制预览（明确内存上限、CSP、资源释放和
解码失败），再裁决 Computer 剩余适用操作和 Settings 行为清单，最后补双边与实机证据。
不引入中央账户、账单或多 Human 项目来扩大范围。

## 正式交付结果

`check-final-complete.log`（全量 check）、`format-final.log`、`build-final.log`、diff 检查通过。
`business-final.log` 主业务旅程通过；`foundations-current.log` Chrome/Firefox 共享基础及资料族通过。
Computer 最终源输入收据：`rah-computer-scan-X3ire1`，截图已检查。
主业务首次失败是旧 direct-child selector 未跟随实体卡片组件拆分，已修正为 shared card selector，
未删导航和身份断言。三处源码结构测试也沿真实组件/权限 owner 修正，不放宽行为要求。

2026-09-07 正式实例 idle 检查通过后，备份到
`/Users/sun/.rah/backups/pre-restart-d5629f43-8871-40d7-92ee-1396516b94a8`，优雅停止原实例，
以冻结 Web build `6f98733dde0598e17f6c8fb03bdd092c5c6b75fae68af0bd516e57566535a904`
重启 `http://127.0.0.1:4173`。当时新 PID 7339（历史证据，后续操作必须重查）。
正式 Chrome/Firefox 新页面 Search/Tasks/消息动作只读 gate 通过，截图已检查；收据
`rah-discovery-formal-xYcW1U`。前后 snapshot 完全一致：6 Rooms、43 Messages、2 Tasks、
380 events、4 Agents、36 Agent revisions、37 memory files，包含内容 hash 核对。
没有提交、推送或发布；真实 CLI 仅在本轮用户授权的隔离 gate 中运行。
