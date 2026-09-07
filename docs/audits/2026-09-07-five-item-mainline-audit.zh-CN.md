# 五项主线施工与审计

范围：`rah_os`，单 Human、单 Mac、多 Agent。本报告不把旧 `rah` 计划作为依据。
结论必须分层：第一至第三项已有本地确定性闭环，本批补第四项并执行第五项的本地门禁；
**尚不能宣布五项全部完成或完整复刻 Raft**。真实 Provider、完整双边视觉和物理设备仍缺证据，
第四项也仍有下面明确列出的适用性与类型覆盖缺口。

## 本批已修复

1. 文件动作菜单转到 `packages/ui-web` 的 `ActionMenu`，由已安装的 Base UI 1.3.0
   统一定位、键盘和焦点。保留 FileCard 的下载幂等 pending、失败和重试 owner。
   浏览器先复现 ArrowDown 无法打开，再验证打开、Escape 和焦点返回，以及既有失败下载链。
   Raft `_it` / `Ait` / `B8` 为行为和结构参考，本地是结构移植与 glue，不是字节复制。
2. 正式 Local Core 接通已有 Managed MCP executor。此前通用 daemon 支持配置，正式组合根
   却未传入它。本批从私有 `state/managed-mcp.json` 读取并复用现有 schema、registry 和
   assignment owner。拒绝重复引用、不安全地址、宽权限、符号链接和超限文件；不回显配置秘密。
   测试覆盖首次启动、停止、配置、重启、认证客户端读取和公开响应不泄露 URL。
3. Settings 文档、Computer 恢复和 MCP 首次配置跳转到随包本机指南；Feedback 的剪贴板
   拒绝显示可恢复错误，成功后才显示已复制。此处是明确的本地产品适配，不是 Raft 云支持服务。
4. 发布脚本修复：两个隔离 PATH 增加 Git 的单独链接，保持真实 CLI 隔离；LAN 导航按标签
   span 定位，避免新增“本地”徽标导致选不中。两次故障日志均保留，修复后重跑实际链路。

来源：`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
授权与既有来源登记沿用 [复用账本](./2026-08-29-raft-multica-reuse-ledger.zh-CN.md)。
MCP 与本机帮助是 RAH 组合层适配，未复制未知 Raft Server 实现。

## 五项分别判定

| 项目          | 当前事实                                                                                                         | 未收口边界                                                                                                                                                                   |
| ------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 配置/执行   | [配置→子进程→下一 Run](./2026-09-07-runtime-configuration-continuity.zh-CN.md)、重置和记忆身份连续性已有本地证据 | 真正四家 CLI 的同旅程未跑；PATH/版本发现不等于实际模型执行                                                                                                                   |
| 2 Room 协作   | 持久投递、单 lane、Worker 消息工具、忙时 follow-up 和因果围栏已有测试                                            | 多轮真实模型、长期 soak 未完成；完整 Raft Agent API 对等未由当前 Room 闭环覆盖                                                                                               |
| 3 Task/Review | 双版本冻结提交、驳回返工、Human 验收和数据库重开已有证据；本批业务旅程重跑                                       | 真实模型 reviewer 的交付验收未做                                                                                                                                             |
| 4 页面/本机   | 轨迹刷新、文件下载恢复、共享菜单、本机 MCP、帮助反馈本批及前批修复                                               | 九组文本/结构化文件及大文件边界已通过本地矩阵；图片/媒体完整类型对照与菜单全部动作组合；Computer 批量操作/扫描、可选 Settings 的适用行为仍需逐行核实；全页面同条件视觉未收口 |
| 5 验收        | 本地确定性、业务浏览器、持久重启、LAN 配对和构建恢复已执行                                                       | 真实 CLI 待单独授权；实体设备 PWA/通知、完整同条件官网对照、长时间 soak 未完成                                                                                               |

上述缺口不能用“继续 11 turn”或源码回调计数估算完成率。后续保持一个行为一个出口：
先文件类型及菜单完整状态，再核定并关闭 Computer 单机适用动作，最后整理剩余 Settings
逐行证据；不重新建设 Room/Task/AgentHost 核心，也不重新引入多 Human 工程。

## 官方实操的新事实

本轮登录态浏览器中，官方 Computer 1.0.18 显示在线。Cindy 工作区可读取非空文件树，
展开 notes 后出现子文件，打开 MEMORY.md 有加载态和预览，源码/预览切换改变选中状态。
没有发送官方消息、上传文件或启动 Agent。本报告不保存私有笔记正文。

因此不能继续引用“官方 Computer 离线”作为当前通用阻塞。此次使用已有分屏页面，未完成
同 viewport/DPR/zoom 的双边截图，因此只能作为上述交互观察，不能宣称像素验收通过。

## 验证证据与限制

日志目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-five-item-audit`。

- `check-final.log`：完整 `npm run check` 通过。首次 `check.log` 暴露新测试 response.json
  的 unknown 类型，已改为公共协议 schema 解析后重跑。
- `mcp-loader-red.log`、`mcp-red.log`、`mcp-green.log`：先失败再修复的配置测试。
- `menu-red.log` / `menu-final.log`：文件菜单与下载，Chrome/Firefox × 桌面/390。
- `help-red.log` / `help-final.log`：本机指南弹出页、刷新、剪贴板失败/恢复，双浏览器双尺寸。
  已人工检查 Firefox 390 截图。
- `business-final.log`：实际隔离 daemon、Fake CLI 与浏览器业务旅程通过。
- `persistent-final.log`：冻结生产包、持久状态、会话恢复、浏览器无缝重连通过。
- `lan.log`、`lan-final.log` 保留失败；`lan-green.log` 验证 TLS、HttpOnly Cookie、配对、
  设备管理、持久会话和 Service Worker。自动测试信任隔离证书，不等于实机证书安装通过。
- `timeline.log`：10,050 条逻辑消息，DOM 27 行，anchorDelta 0，20 次 Markdown 刷新无失败。
- `build-recovery.log`：旧构建恢复，桌面与移动截图。
- `doctor.log`：四家 CLI 可发现，状态边界及构建检查通过；不代表登录或推理成功。

首次合跑的 foundations/business 进程未正常退出，已停止精确测试进程并分别重跑；不以首次
部分日志当成通过。最终独立结果与正式部署记录追加如下。未运行付费 CLI，无提交、推送或发布。

## 最终本地交付

Chrome foundations `foundations-chrome.log`、Firefox foundations `foundations-firefox.log`
分别正常退出通过；首次未退出结果不采用。完整检查、格式检查、diff 检查、正式 Web 构建通过。
Foundation 证据分别为 `rah-ui-foundations-z7kUki` 和 `rah-ui-foundations-ZHdn5G`，位于本机临时证据目录。

正式工作台先验 idle、验证备份、优雅停止旧实例，再启动冻结构建：
`7a2617e4401202f8fa4417d03b32f309307862d197db100ac09c09f543de724b`。
备份：`/Users/sun/.rah/backups/pre-restart-ec53aa1b-a9ae-4776-8fa3-e24aa38e1392`。
交付时正式监听 PID 82654，地址 <http://127.0.0.1:4173>。

重启前后所选持久表及记忆 inventory hash 完全一致：6 Rooms、43 messages、2 Tasks、
380 Room events、4 Agents、36 Agent definition revisions、37 memory files。
正式 Chrome/Firefox 新页面验收通过，已检查桌面 Task 截图；其导航产生正常 read cursor 变化，
不改变消息/Task 内容。证据目录：
`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-discovery-formal-AkAFMj`。

正式用户状态未写入 Fake CLI 数据，也未擅自添加外部 MCP executor。
本批修复可使用；五项整体仍按表中的未收口边界报告，不能把正式重启当成完整产品验收。

## 文件类型矩阵追加验收

正式部署后继续验证既有渲染 owner，未再改变产品代码。
`node scripts/run-file-types-browser-gate.mjs` 验证九个具名文件 × Chrome/Firefox ×
1440/390：Markdown、沙箱 HTML、带引号 CSV、Diff、300,000 字符显示截断、未知类型、
超过 2 MiB 的文本预览拒绝，以及 CSV 200 行和 Diff 5,000 行显示边界。
每组都经过真实上传→发送→刷新→预览→下载字节一致→Escape 焦点返回。
36 组通过，日志 `file-types-receipt.log`；receipt 记录具体文件名，避免相同预览类型混淆。
这是本地既有功能验证，不是九类新实现；HTML 的沙箱断言也不代表完整安全审计。
图片/音视频/PDF 等完整官方类型清单和相同条件视觉仍另行收口。
