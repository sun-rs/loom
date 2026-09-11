# Tooltip 延迟与页内操作指南

## 来源与裁决

授权上游 `docs/evidence/raft-web-20260908-current/index-BVfbaScj.js`，SHA-256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`。根渲染树 `oDe → fR → yte` 使用无显式 delay 的 fR；`function fR({delay:e=0,...t})` 把 0 传给 Tooltip Provider。Rail 的 `zi → Bc → VLe` 没有另设触发延迟。RAH 原 HintTooltip 未设 Provider/Trigger delay，本机 Base UI `tooltip/utils/constants.js` 的 OPEN_DELAY 为 600，因此上次“沿 Base UI 默认值”的实现与上游不一致。

共享 HintTooltip 明确设置 Trigger delay=0，对齐上游有效触发时机；150ms CSS 出现/退出动画与碰撞定位保持原合同。测试先确认 50ms 虚拟时间内旧实现 tooltip 数量为 0，再验证新实现为 1，并保留焦点、Escape 与移出测试。这是源码参数核实＋本地浏览器验证，不是本轮在线 Raft 延迟测量。

帮助行为由用户明确改为直接进入操作指南页面，属于有意的 Raft 资源浮窗差异。问号保留同风格 tooltip，点击当前窗口导航到 settings/docs，沿用 SettingsPage 与更新日志 article 样式。移除帮助浮窗与无用 CSS。Docs 设置入口也展示同一页。

## 内容与验证边界

现有同源、随包发布的 `/help/local-workbench.html` 是唯一内容来源；组件请求并提取 main，避免复制两套指南。仅加载这个固定本地地址，不接受用户提供的 HTML/URL。请求可中止，失败提供明确提示及重试。无需新服务端 API，不执行 Agent 工作。

tooltip 浏览器门禁通过。问号的鼠标/键盘进入、单窗口、无菜单、三个桌面/移动视口 rail 门禁通过；操作指南桌面/390 页面、刷新、503 与重试通过。故障注入测试禁用 Service Worker，避免缓存绕过网络拦截；初次以单次拦截模拟失败会被 StrictMode/缓存影响，改为持续拦截直到显式重试。类型与 399 项 Web 测试、格式/diff、正式构建通过。全仓 check 仍受独立 UI 规格基线门禁阻塞。

## 正式部署

第一次重启被活跃 Activation 的保护检查拒绝，旧进程保持运行；待工作自然结束后重新执行。备份 `/Users/sun/.rah/backups/pre-restart-42a8b9ad-3119-4af0-a0a2-e2d2840efab2` 校验后温和重启至 PID 53390，build `293ec1627ab272d065dba6ff76cc9e0ecc59cf08fd73386901bf59be340d649a`。

正式 Chrome 在 50ms 虚拟时间窗口内确认设置 tooltip 已生成，问号直接导航到指南、无资源 dialog、无新窗口，刷新和 390×844 无横向溢出均通过。截图 `/Users/sun/Code/reviews/rah_os/2026-09-11-tooltip-help/` 已查看。该触发测试不声称现实设备绘制耗时为零，也不是本轮官网在线计时。未提交/推送或运行付费模型。

## 帮助正文排版续修

按用户要求，Settings 导航“文档”和页头“操作指南”统一显示“帮助”，旧 `settingsSection=docs` 地址保持有效。帮助正文不再复用 release-note 样式，移除其黄色左边框；独立定义标题、段落、编号列表、链接、行内命令与代码块的排版，长命令在窄屏换行。

测试先确认旧页面没有“帮助”标题，修改后 Chrome 1440/390 浏览器回归通过（导航、零左边框、列表编号、无横向溢出、刷新、加载失败与重试）。类型检查及 400 项 Web 单测通过，改动文件格式与 diff 检查通过，正式构建、备份和重启后全新 Chrome 页面复验及截图检查通过。全量 check 仍被独立 UI 规格 ratchet / 报告过期拦截，全仓格式检查另有并行施工的 Thread 测试文件未格式化；没有修改该文件或放宽门禁。没有提交、推送或付费模型测试。
