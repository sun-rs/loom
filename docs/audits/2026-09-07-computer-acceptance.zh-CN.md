# Computer 单机适用行为验收与恢复指南修复

基线 `1dbb354` 加当前恢复指南修复；不包含多 Human、添加远程 Computer、大文件流式。
本轮先核对官网当前登录页及已有实现，没有依据旧缺失列表新建后端。

## 官网实操与源码

2026-09-07 Firefox 已登录 Computer 页：Computer v1.0.18 在线、5 个 Agent；
工作区列表非空，显示文件数、大小、修改时间、ACTIVE 和删除工作区入口。
服务重启按钮可用；升级按钮禁用且明确“此 Computer 来源无法升级”，并提供固定版本重装指南。
点击“显示恢复指南”后原页展开三步内容，按钮变为“隐藏恢复指南”。
未执行官方重启、升级、删除或发送消息，未读取私人文件正文。
本次是功能观察，沿用已有分屏布局，没有宣称同 viewport/DPR/zoom 像素验收。

来源：`docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js`，
SHA-256 `5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8`。
`Je` 发起 computer/restart 或 upgrade；`va` 扫描和删除工作区；recoveryGuide 控制原页展开。
Multica 现有恢复相关入口检索到 onboarding runtime-connect 等专用流程，不作为本机工作台
恢复协议替代；本次直接采用 Raft 展开行为和 RAH 既有恢复指令，未引入新算法或依赖。

## 逐项裁决

| 单机行为                         | 本地事实                                          | 本轮结论                                                                   |
| -------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------- |
| Computer 名称/描述、runtime 详情 | 已有 profile 与 runtime inspector                 | 不重建；完整双边状态仍待验                                                 |
| Agent 创建/进入/批量启停         | 复用已有 Agent owner                              | 扫描 gate 四组合复验通过                                                   |
| 批量 restart/session/full        | 复用逐 Agent 幂等回执                             | reset gate 十二组合复验通过                                                |
| 已绑定 Agent 工作区扫描          | 有界 reader、部分结果/未创建/失败反馈             | 四组合通过；不等于官方所有遗留目录扫描                                     |
| 恢复指南原页展开                 | 原先只有帮助页链接                                | 本批修复并通过四组合                                                       |
| Computer 服务重启                | 有 operation store、Computer 消费接口、supervisor | 正式 Web Human 入口与实际服务链路尚未接齐；不是纯样式问题                  |
| Computer 升级                    | 有 k-carrier 升级基础                             | 当前官方机器也受来源限制；需要本地 release capability 明确，不得假装可升级 |
| 孤儿/已删除工作区清理            | 当前 summary 只遍历绑定 Agent                     | 功能差异确认，未收口；不能直接删除私有记忆来冒充                           |
| 添加远程 Computer                | 用户延期                                          | 不阻塞首版                                                                 |
| 删除唯一 Computer                | 本机卸载/状态保留与云登记删除语义不同             | 需明确本地产品合同，不能照抄云端删除                                       |

## 本批实现与验证

`ComputerRecoveryGuide` 复用已有 `rah-profile-disclosure`，使用原生 details/summary，
支持鼠标、Enter/Space 与折叠后焦点保留，刷新回默认折叠。内容引用本机现有诊断、安全重启
流程，保留完整指南链接；不会执行命令、启动第二个 daemon 或操作官方服务。
本地文案与原生 disclosure 是明确适配，不冒称 Raft 同像素复制。

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-computer-acceptance`。
`recovery-red.log` 复现缺少原页入口；`recovery-green.log` 双浏览器双尺寸通过，
收据 `rah-local-help-27vZec`。已检查 Firefox 390 截图；保留既有文档弹页/刷新、反馈剪贴板
拒绝与恢复检查。`scan.log` 收据 `rah-computer-scan-KdHell`，`reset.log` 收据
`rah-computer-reset-x4ZlHA`；包括部分失败、原回执重试与真实 API 状态断言。
这些均为隔离状态与 fixture，不是正式产品数据，也不是本轮新付费 CLI 结果。

下一闭环是本机服务重启的 owner 接线与生命周期验收：先区分当前项目工作台与已安装 carrier，
复用既有 operation/supervisor，在不能提供安全接管证明时拒绝操作；不把 PID kill 写进 Web。
Computer 页面族尚未全部验收，不开始扩展其他页面族来掩盖上述未闭项。

## 正式交付

`check.log`、`format.log`、`build.log` 与 diff 检查通过。idle 检查后备份至
`/Users/sun/.rah/backups/pre-restart-7dd327cf-899b-4b52-8120-1a976ee51cf1`，
优雅重启正式工作台，冻结 Web build
`6ee920054d36fe19c7f1c13d3b1b0ef204368d823c17d2c391c4f583093bae6a`。
`formal-browser.log` 双浏览器新页验收通过，收据 `rah-discovery-formal-dmbMee`。
另外在正式 Firefox 新页打开 Computer 恢复指南，确认内容可见并检查 `formal-recovery.png`。
前后 snapshot 内容一致：6 Rooms、43 Messages、2 Tasks、380 events、4 Agents、36 revisions、
37 memory files。没有向正式状态写 fixture，也没有新增付费调用。本批未提交或推送。
