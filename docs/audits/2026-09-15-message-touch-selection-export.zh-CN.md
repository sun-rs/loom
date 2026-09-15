# 消息长按、选择、导出与紧凑审批（2026-09-15）

## 来源与采用方式

Raft https://app.raft.build 授权 vendor build
`666bab60d8658d9e382e2c286ce1e423231e8f31`，`index-WTraJnrd.js` 的
`message.selectModeToolbar.selectedCount` / `generateImage` 附近：黄色 safe-bottom
操作条、flex-wrap、小间距、图片预览。原归档保持授权来源，不把发布 bundle 作为运行依赖。
本次为结构移植与 RAH glue；按用户要求去掉转发、链接与分享到 X，并显式展示剩余操作。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`，
`apps/mobile/data/chat-select-store.ts`：长按选择时切换原生可选文字包装，结束、滚动、
Tab 离开时清理选择。RAH 复用已有浏览器 selection owner，并依用户要求使用独立文本页；
不引入其 UIKit 包装或另一份状态 store。

图片生成依赖 [html-to-image](https://github.com/bubkoo/html-to-image) 1.11.13，MIT；
`toBlob` 把本地渲染的完整消息 DOM 转成 PNG，不调用图片生成服务。保留依赖许可。

频道标签参数复核：内部 Raft reference `raft-official-components.json` 的 tabChat 为
28px 高，12px 字体/16px 行高、14px icon、6px 图文间距、6px×16px padding；本地
维护的 `.tab` 与之相同。筛选按钮为 12px/14px、6px×12px、32px 高，PWA Room 紧凑
padding 是已有 RAH 适配。未取得 Raft iOS 原生样式，截图差异不冒称精确 CSS 提取，
本批不擅自放大这些标签。

## 行为及 owner

- `MessageItem`、`useMessageContextMenu`：移动端正文不显示黑框/角落操作条，500ms
  长按，8px 移动容差；Room、DM、Thread 母消息/回复、完整任务讨论共用。直接链接、
  task badge、头像点击不需要先选中。桌面原 hover 和文本选择保留。
- `FloatingContextMenu`：portal 到 body，高于全屏 Thread/Task；防止原生 callout，
  Escape、外部点击和键盘导航共用，焦点恢复 preventScroll。PWA 分隔为浅灰 1px。
- `MessageContextMenu`：无复制链接；打开消息列改名；收藏后紧邻任务操作；普通母消息
  可 task.convert；Copy Markdown 下方 PWA 专属复制文本，打开同字号可选择文字页、X 关闭。
- `MessageSelectionToolbar` + 原唯一 store：黄色条、黄勾/浅粉消息、所选数/全选/取消/
  Markdown/图片。移动端无图片。不同 Room/DM/Thread 选择不并存，不新增持久化。
- `MessageImagePreview`：完整正文、当前显示名称与头像，800px 图片画布、最大 1600 万
  像素保护；未解析消息禁用导出。等待字体；生成失败可重试；复制权限失败提供下载。
  预览关闭清理 Blob URL。无转发、链接或外部分享按钮。
- `GlobalTaskDetail`：状态/负责人不可拆行，长负责人省略（移动端 10ch 上限），创建人
  有空间同行否则换行；共享 DiscoveryFilter 标签包装保持计数和多选行为。
- Kernel `human-task-edit.ts`：仅 Human completed→todo 不生成 Agent Inbox/Activation。
  原 task event、Task 更新、幂等/版本检查仍在事务内。cancelled→todo 保留重做通知，
  避免改变既有 lead/helper 退回重做链路。

## 验证记录

新增菜单/属性浏览器检查与 quiet-reopen 测试先失败，随后修复。测试暴露 Thread 菜单
被全屏页遮挡、负责人匿名文本不受省略样式约束，均有实际复现及修复后通过记录。

隔离浏览器 390×844 与 1440×900，Chromium 原生 CDP 长按；WebKit 真实页面渲染加
合成长按事件（不是 iPhone 实机）：频道/私聊、Thread 母消息和回复、文本页、任务
转换实际创建、选中态、图片生成/下载通过。Chromium 实际写入/读回 PNG 剪贴板通过；
Agent 导出复用已知 Principal 的身份、头像和显示名称，并有失败后修复的回归检查。截图已逐项检查。完整任务讨论另有原生长按
及文本页 gate；任务筛选生命周期和审批前后阅读位置回归通过。

核心静默重开测试验证 canonical 状态、空 activationIds、无新 Inbox 和 Activation；
原 lead/helper closed→todo 重做集成测试单独通过。旧大浏览器 gate 的已移除转发 UI
场景改为本地图片出口，底层 forwarding SDK/Kernel 测试保留；不声称该整套大 gate
本批重新跑过。

最终 `npm run check`、`npm run format:check`、`git diff --check`、正式
`npm run build:web:workbench` 均通过；Agent 图片身份修复后补跑类型检查及完整新消息菜单
浏览器 gate，通过实际 PNG 剪贴板和母消息转换。WebKit 同页族与转换通过；完整任务
讨论原生触摸门禁、审批属性、阅读位置和筛选 scope 回归通过。

正式旧进程 33895 在 idle 检查、持久状态备份验证后优雅退出，新进程 72912 使用冻结版本
`478c5ecbe0a136a930bd1ff585bd1f930801d45a659ba03943955e97a40fbfac`。
备份位于 `/Users/sun/.rah/backups/pre-restart-e10f899b-4170-4d0c-820a-3aa4fd20464b`，
原 Room 历史、Agent 配置和记忆保留。原 loopback、tailnet、LAN 监听均返回该版本。
正式新浏览器在 1440×900、390×844 验证 Room/Thread 菜单、选择条、复制文本页、
PNG 预览、审批属性、重载及零页面异常；人工检查截图，未向真实 Room 发送测试消息或
修改任务。主要截图目录为临时 `rah-message-formal-ChcER5`（本机浏览器证据，不作为
仓库 fixture 或分享产物）。

本次未运行付费 CLI，未进行 Raft 同条件双边运行验收或物理 iPhone 原生手势验收。
未提交或推送本批改动。
