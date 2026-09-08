# Agent 操作、新 Task 默认表单与 PWA 图标收口

本批限于既有基础工具的入口与默认产品流程：Task 不预设协作者/审阅者，Agent 页面直接使用既有启停/重启/删除 intent，PWA 保留现有品牌。没有创建新角色协议，也没有新增 AgentHost 执行路径。

## 官方证据与所有权

- Raft `AgentDetailPanel-DKwoNvgK.js`，SHA-256 `b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845`：~126k 的顶部按钮直接提供聊天、停止/启动、重启；~144k 的停止/删除使用确认窗。2026-09-08 官方在线 Cindy Profile 的 1440×900、DPR 2 截图也观察到顶部直接操作。
- 同一 frozen bundle ~140714 的底部操作容器是 `space-y-2`，按钮是 `flex w-full ... gap-2 px-4 py-2 text-sm font-bold`。本批保留纵排，不根据未滚动到的截图推断底部横排。
- 新 Task 保留 [Task 页面族](../design/task-page-family.md) 已验证的多标题、负责人和依赖创建路径；默认无协作者/审阅者遵从用户明确的“不预设角色，Human 对话临时指派”决定。旧 Task 协议和 Review 读取/执行保留兼容，不改 Task 所有权。
- `App.changeWorkspaceAgentState` 是现有前端状态 intent；新入口只传给它 Agent ID、动作和稳定幂等键。`AgentStateDialog` 使用已有对话框焦点/关闭协议；执行和 tombstone 检查继续由 Kernel/Host 负责。
- Runtime chip 可见文字此前已用 `runtimeProductLabel`；本批只修复其可访问名称仍使用技术 displayName 的错配，详情内部保留真实 Runtime 诊断名称。
- PWA 原图为维护中的 `apps/web/public/rah-app-icon.svg`，SHA-256 `026cdbca41a10548ca3da1551fc95a260a8b5277a8352b1d0b9c724e35d51b3a`。`scripts/generate-pwa-icons.mjs` 通过 Chromium 原生 SVG 渲染，以 DPR 1 输出 192×192 和 512×512 PNG；没有生成新图案或使用 AI 改图。

## 实现与验证

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-08-agent-task-ui`。

| 项目           | 结果与证据                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Task 默认表单  | Room composer 标记 Task、独立多标题创建对话框均不再显示协作者/审阅者；新的创建请求与 canonical Task 结果数组为空，负责人、依赖与原有安全重试保留 |
| Agent 顶部操作 | 直接停止/启动，确认后读取 canonical enabled/disabled；顶部重启打开既有重启/会话重置对话框                                                        |
| Agent 删除     | 底部入口直接打开删除确认；运行中准确要求先停止，无 Room 的临时 Agent 经停止→确认删除后从 canonical 目录消失                                      |
| 状态失败重试   | 注入 503 后保留确认窗，使用同一幂等键重试成功，不依赖重新打开管理窗口                                                                            |
| Runtime 标签   | chip 的可见文字与可访问名称使用同一产品名称；`chip-red.log` 复现原错配，后续浏览器通过                                                           |
| PWA PNG        | 两个真实 PNG 已登记进 manifest；验证 PNG 签名、尺寸、HTTP 200 和 image/png Content-Type；原 SVG 保留                                             |

- `red.log`：新 Task 无预设角色断言、PNG 192/512 要求先失败。
- `browser-red.log`：顶部停止入口不存在，真实浏览器失败。
- `browser-complete.log`：Chrome/Firefox × 1440×900 / 390×844 四组合通过，另各一个实际临时 Agent 删除组合；receipt `rah-agent-task-parity-MxIh80`。已打开检查桌面 Agent、390 Task 和 PNG 图片。
- `web-unit-final.log`：371 项 Web unit 通过；`typecheck-final.log`：Web 类型检查通过。首次 Web unit 因并行 icon mapper 提取后的旧 owner 断言失败，已由图标 owner 更新为同等行为验证；不把失败记录覆盖为通过。
- 全局主浏览器门禁通过，记录于 `global-browser.log`（`RAH_REAL_BROWSER_GATE`）。它的历史 Review fixture 通过既有 canonical API 创建明确含审阅者的兼容 Task，替代新表单里已移除的角色选择。其余提交、Review、冻结证据与返工验收断言不降低。

## 范围限制

主任务当天又确认官网已发布 `release/v1.12.0`，release/commit `f1a9a6b83add3db8f44320c753d2f8d8b03b8f06`，构建时间 `2026-09-04T11:56:32Z`。本报告引用的 8 月 31 日 bundle 是冻结历史语义来源，不能等同当前官网全部实现；新版源码与双边逐项核对仍由主任务继续，不把本批本地回归扩大为最新版完整对齐。

这些是来源明确的本地适配，不是 Raft 服务端源码字节复用。新停止入口沿用现有持久 Agent enabled/disabled、受控 cancel 与恢复语义；删除仍保留先停止、无在途工作和明确确认的边界。原“管理 Agent”入口保留以访问已有完整配置，不因入口对齐而删除可用能力。

官方 Skills 显示真实 CLI 全局/工作区目录。本地 `Agent.skillRefs` 只是发布 Artifact 引用，不能冒称等同官网 Skills 清单；本批没有增加假空列表，Host 目录发现与详情工具仍属后续独立收口。

PNG 与 manifest 通过不证明物理设备安装、通知或离线全链通过。专项浏览器使用隔离 Fake CLI 和真实 Kernel/daemon/Web；未向正式状态写测试数据，未调用付费 CLI、提交或推送。冻结正式构建、全仓检查和正式重启由主任务统一完成。
