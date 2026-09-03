# Task 标识与 Thread 回复头像对齐审计

日期：2026-09-03
范围：聊天正文中的 Task 关联入口，以及其下方内联回复预览头像。本文只审计 RAH OS，
不修改旧 `rah` 仓库，也不把这一处通过扩大成整个 Task 页面等同 Raft。

## 1. Raft 事实

证据为 Raft 正式页实操与冻结的官方 Web bundle
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`；入口文件 SHA-256 为
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。

- `Qet` 负责 Task 状态入口并调用通用 badge `jg`。正式页 `#5 @Cindy` 的 `in_review`
  样本为 82.3125×20px；宽度由内容自适应，固定合同是 20px 高、1px `--ink` 边框、
  0 圆角、无阴影、左右 6px、上下 0、
  gap 4px；字体为 Raft sans 栈、700、10px/10px，图标 10×10px。
- `in_review` 背景为 `#BBAFE6`（lavender），前景为 `--brutal-pink-950`，边框为
  Raft brutal black `#141111`；hover 是 100ms filter 过渡到 `brightness(.9)`。
- 内联回复由 `ntt/rtt` 以消息 `senderId` 解析 Agent/User，随后调用共享头像组件 `Bn` 的
  `compact-list` 变体。正式页观测为 20×20px 外框、1px 黑边，内部是与 Room 正文完全相同的
  Agent 图像身份，而不是名称首字母。

## 2. 原缺陷与所有权裁决

- RAH OS Task 标识曾使用 11px 图标、不同 padding/gap、纯黑边框与纯黑前景，无法与
  Raft 的 `Qet -> jg` 合同对应。
- `App.tsx` 构造回复预览时丢弃了 `actorId`；`conversation-panes.tsx` 因而只能用作者名首字母
  生成蓝色方块。这既是视觉差异，也是身份数据被展示层降级。
- 修复后 `ThreadReplyPreview` 保留 `actorId`，由 `ThreadReplyAvatar` 解析同一 Participant，
  Agent 统一调用 `AgentAvatar size="compact"`；Human 图片头像沿用 `ProfileImageAvatar`，
  仅未知且无头像的主体才使用文字兜底。没有新建 Thread 专用头像库。
- RAH OS 当前 `submitted` 在聊天正文中的可见含义对应 Raft `in_review`。两边状态集合并不同构，
  因此本批不猜测 `claimed/waiting_input/blocked/cancelled` 的 Raft 色彩映射。

## 3. 实施与回归

- `apps/web/src/components/conversation-panes.tsx`：Task 入口增加稳定状态/test 标识；预览头像改用
  canonical Agent/Human 头像组件。
- `apps/web/src/App.tsx`：从 canonical Message 向预览模型保留 `actorId`。
- `apps/web/src/product.css`：精确实现 20px badge、Raft token、10px 图标和 hover；
  `apps/web/src/agent-directory.css` 成为 compact/member 头像尺寸的唯一 CSS owner。
- `apps/web/test/thread-panel-parity-contract.test.ts` 先以旧实现得到预期失败，再覆盖尺寸、token、
  hover、`actorId` 与共享头像；定向测试和 Web TypeScript 检查通过。

## 4. 浏览器验收

正式 workbench 在确认 28 个 Activation 均为 `completed`、28 个 RunAttempt 均为 `exited`、
28 个 RuntimeProcess 均为 `terminated` 且没有未决 InputRequest/ComputerOperation/HeldDraft 后，
从 PID 75118 优雅停止并以新资产重启为 PID 81278。正式入口返回
`index-6blH1wI1.js` 与 `index-CnKdfTt1.css`；健康状态为 `online`。

真实 Google Chrome 分别以 1280×720 与 390×844 打开正式 Room，两个视口得到相同结果：

- Task `#1 @Kimi` 内容宽度为 73.171875px、高 20px；背景 `rgb(187, 175, 230)`，边框
  `1px solid rgb(20, 17, 17)`，0 圆角、无阴影；前景为
  `oklch(0.198 0.08 359.99)`。
- 字体栈为 `"Raft Quote Glyphs", "Space Grotesk", system-ui, sans-serif`，字号/行高
  10px/10px、字重 700、gap 4px、padding `0 6px`，图标 10×10px；hover 140ms 后为
  `brightness(0.9)`，transition duration 为 0.1s。
- 两条 Kimi 回复预览均为 20×20px `AgentAvatar is-compact`；其背景 token、全部 8×8
  grid-area 与每格颜色同 Room 正文的 36×36 Kimi 头像逐项相等。也就是说只缩放尺寸，身份图案未变。

截图证据保存在本轮临时验收目录 `/tmp/rah-task-marker-avatar-desktop.png` 与
`/tmp/rah-task-marker-avatar-mobile.png`；它们不是仓库发布资产。

重启前备份 `/Users/sun/.rah/backups/pre-task-marker-avatar-20260903-DJD9La` 的 Room DB
再次以 immutable 模式通过 `quick_check`，消息/Room/Workspace 数量与正式库同为 38/6/2。
按既有最多保留三份的策略，最旧的 `pre-p15-room-file-gc-20260903-myjmPC` 已移入系统废纸篓，
仍可由用户恢复；另外三份备份保留。

自动门禁：`npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench`、`npm run test:web:message-timeline` 与
`npm audit --omit=dev` 全部通过；audit 报告 0 vulnerabilities。

## 5. 保留边界

本批不修改 Task 后端生命周期、编号或负责人协议。Raft 其他 Task 状态到 RAH OS 扩展状态的
完整颜色/图标映射仍需独立语义裁决；在此之前不得仅凭截图添加自造颜色。
