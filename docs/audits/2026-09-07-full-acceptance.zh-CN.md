# 单 Human 单 Mac 全面验收记录

本轮按用户要求在同一施工 turn 内执行跨页面、后端与正式实例验收。
基线 `1dbb354` 加恢复指南与本轮修复；不是全产品每个功能已对齐的认证。
多 Human、远程其他 Computer 添加、大文件流式按用户决定延期；完整 PDF 工具栏不再作为
未经证明的 Raft 自研要求。本轮没有新付费模型调用，也没有提交/推送。

## 验收范围与证据

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-full-acceptance`。
`run.mjs` 为本轮仓库外串行分组、最多两个隔离 gate 并发的调度器；`results.json` 保留首轮结果，
不覆盖原始失败。各 gate 的 receipt 是实际输入/截图证据，不能用门禁组数作功能覆盖百分比。

| 范围                                                 | 本轮门禁                                                                                    |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| 后端协议、Kernel、AgentHost、daemon、SDK 和 Web 单元 | npm run check                                                                               |
| Shell、资料、Settings、发现、交互状态                | foundations Chrome、Firefox                                                                 |
| Room/Task 真实 API 业务旅程                          | real-browser、firefox-workbench                                                             |
| 持久工作台、LAN 配对与重启、旧构建恢复               | local-workbench、lan-workbench、web-build-recovery                                          |
| 配置、下一 Run、重置、轨迹与 Worker 工具             | agent-runtime-continuity、agent-configure、agent-reset、agent-preview、worker-message-tools |
| Room 生命周期、Task 虚拟窗口、长消息历史             | room-lifecycle、task-virtual、message-timeline                                              |
| 拖放、下载重试、文本类型、PDF/音视频                 | composer-drop、file-download、file-types、media-preview                                     |
| Computer 与帮助                                      | computer-workspace、computer-reset、local-help                                              |

以上为 22 组浏览器门禁，各组包含不同数量的子场景；不是 22 个功能，也不是去重后的全部适用行为。
首轮 19 组成功、3 组失败。修复与复跑情况见下节及最终交付。
`formal.log` 验证正式持久实例；破坏性操作与 Fake CLI 留在隔离目录。
四家真实模型与冻结 Review 的已完成结果沿用
[当日真实 CLI 审计](2026-09-07-real-cli-and-computer-closure.zh-CN.md)及其 canonical-results.json，
不冒称本轮重新执行，亦不据此证明每家 CLI 的所有生命周期组合均通过。

## 发现并修复

1. 两个 foundations 在 Computer profile 失败。旧脚本用 `.rah-profile-disclosure` 匹配唯一
   折叠区，恢复指南加入后出现两个。改为以 summary 文本 `CLI / Runtime / Offer 详情`
   定位原目标；保留原始折叠、展开和键盘断言，没有改成 first() 绕过错误。
2. LAN 重启实际失败：第二次启动被 Host 单实例围栏拒绝。确认 HTTPS `closeAllConnections`
   不关闭 TLS 尚未完成握手的 TCP 连接；停止流程可能被浏览器预连接阻塞，无法及时进入
   daemon offline，测试最终强制结束后的新进程继续受到正确的围栏拒绝。
   在现有 LAN gateway 增加仅属于该 server 的连接跟踪，停止时释放包括未握手连接在内的 socket。
   不放宽 Host takeover、不改 ACL、不取消 TLS 校验，也不在 Web 中执行 kill。
   `tls-red-confirmed.log` 复现部分 ClientHello 阻塞，`tls-green.log` 修复通过。
   初次测试连接尚未进入 TLS 即关闭，`tls-red.log` 当时成功不算复现证据；强化后才正式 RED。
   原始 LAN 失败与 `lan-retest.log` 完整恢复结果分别保留。

单一 owner 仍是 LanWorkbenchGateway 的连接生命周期。相较只调用 Node server.closeAllConnections，
本地补齐握手前连接的清理，不是复制未知 Raft Server 实现。

## 官网实际观察

本轮使用已有 Firefox 登录页，只读导航、菜单和对话框检查，没有发送消息、修改凭据或重启官方 Computer。
页面 About 显示 Raft 1.12.0；Computer 为 1.0.18。保留既有分屏，未测量到与隔离门禁完全一致的
viewport/DPR/zoom，因此下述只算功能观察，不作全页面双边像素通过。

- Computer 在线且工作区列表非空；服务重启按钮可用，升级因安装来源禁用。
- Language & Region 明确存在自动/手动/关闭消息翻译模式。本地仅关闭可用，差异属实。
- MCP 添加弹窗支持提供方、认证、URL、描述与连接测试；本地预登记 executor 路线不等于该表单完整对等。
- Tasks 展示频道/创建者/负责人筛选、看板/列表及五种状态。创建者菜单含“我创建的”和 Agent。
  本次 Escape 未使该菜单关闭，点击外部可关闭；不为复制该表现退化本地键盘可用性。
- Search 输入后有频道结果；点击结果打开包含聊天/任务/文件的频道预览，URL 带 open=channel。
  已观察最终预览及正文，并非仅看到 URL 改变就判成功。

## 尚未通过的完成条件

**功能/接线缺口**：页面点击 Computer 服务重启尚未接通；遗留/已删除 Agent 工作区扫描清理
不等于现有绑定 Agent summary；消息翻译未接入。MCP 浏览器凭据/OAuth、Finder reveal、
显示语言/时区选择、单机 onboarding/协议等仍需明确本地替代合同，不能由通用 Settings 页面存在而标记完成。
升级必须按真实来源与发布能力判断，不凭官方禁用按钮推导必须实现云升级。

**验证缺口**：所有适用行为去重逐行、同条件官网视觉/交互对照尚未齐；真实物理设备 PWA、
系统通知与长时间 soak 未完成。本轮长历史与恢复门禁不等于跨日长期运行。

因此本轮可出“已实现主线的广泛回归结果”，不能出“后端全面等同 raft-computer、前端全面等同官网”的证书。
下一项仍按用户确定的行为关闭服务重启：页面提交 → 服务完成重启 → 页面自动重连确认；
一项收口再进入其他实证缺口，不继续扩大延期范围。

## 复跑补充

`foundations-chrome-retest.log` 与 `foundations-firefox-retest.log` 正常退出通过，
收据分别为 `rah-ui-foundations-TkGsF4`、`rah-ui-foundations-gvwK15`。
已查看 Search 桌面、Language & Region 390px 截图；截图中的禁用选择明确显示本地限制，
不能将其算成可用的翻译/多语言/时区切换功能。
`lan-retest.log` 的配对、设备管理、TLS、持久会话、PWA 和重启旅程正常通过。
修复后的首次全量检查 `check-final.log` 检出 Node connection 事件参数类型为 Duplex，
已按实际类型修正连接集合；无运行行为变更。最终采用 `check-verified.log`，不采用前者。

## 最终结果与正式交付

22 组浏览器门禁在上述定点修复/复跑后通过，合并索引 `browser-final-results.json`
保留初次 code 与最终采用日志。最终 `check-verified.log` 全量检查、`format.log`、
`build-verified.log`、`git diff --check` 通过。初轮 19 组不受两处定点变更影响的证据保留，
没有将其伪装成修复后全部重新执行；最终基础门禁后仅改正了后端连接集合的类型声明。

正式实例 idle 检查与备份成功，备份为
`/Users/sun/.rah/backups/pre-restart-6f571e79-3822-4e21-9cc3-838a0a889ac6`。
优雅重启后的 PID 为 67578（后续需重查），Web build 保持
`6ee920054d36fe19c7f1c13d3b1b0ef204368d823c17d2c391c4f583093bae6a`，
本次变化在后端及验收脚本，不强行制造新 Web hash。
`formal-final.log` 的 Chrome/Firefox 新页通过，收据 `rah-discovery-formal-29Fo2D`，
已查看正式 Firefox Task 截图。正式地址仍为 `http://127.0.0.1:4173`。
`formal-before.json` 与 `formal-after.json` 完全一致：6 Rooms、43 Messages、2 Tasks、
380 Room events、4 Agents、36 Agent revisions、37 memory files，包含内容 hash。

最终判定：已实现主线的本轮广泛回归通过；完整单机 Raft 功能/视觉对齐验收尚未通过，
理由为上文明确的功能缺口和未取得的验证证据。不是要求重新开展整轮重构。
