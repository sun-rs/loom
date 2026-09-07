# Task ledger、行为队列与 Workspace 切换器累计交付审计

日期：2026-09-06

状态：本地候选已经通过完整自动化、双浏览器与正式持久实例验收；等待既定第三方线程给出累计独立裁决。

## 候选身份

- 仓库：`/Users/sun/Code/repos/rah_os`
- 基线 HEAD：`0fa8f89b5981536c5c52ccd1c4b998316bd97c20`
- tracked 变更文件：65；未跟踪文件：21（均不计本报告自身）。
- `git diff --binary --no-ext-diff` SHA-256：`561d579ebd5ea5246f50f0e50068219da1fbb3c0a0e2b8a6e9781c8ebd36cbfd`
- 排序后的未跟踪路径与逐文件 SHA-256 JSON 清单摘要（不计本报告自身）：
  `6cfe6620ee139a09fb2912f14046dd1ffb78a6c77fb6d46e0de061dca52f4641`

这些指纹只冻结本次未提交审查对象，不把工作区误写成 Git 里程碑，也不授权提交或推送。

## A：Task S1 阻塞项

多标题 Task 创建现在由 `task-create-execution.ts` 持有逐行完整冻结的 typed command ledger。已经确认的行从队列移除；成功响应不可解析等歧义失败只重放未确认行的同一请求，不重新采样标题、参与者、依赖、Room 序列或幂等键。只有 Kernel 明确拒绝且未接受的 `stale_context` 才允许重新生成。

Room Task 首屏只取最近 200 条和最多 500 条 active Task，并通过 continuation 显式加载更早记录。
浏览器为每个 Room 最多保留三个访问过的早期页、全局最多八个 Room window；普通轮询同时重读首屏与
已访问 cursor，旧 Task 不会因轮询消失，也不会保留过期状态。Room 请求另有 generation/abort fence，旧 Room
的迟到响应不能覆盖新 Room。真实浏览器覆盖服务端已接受但响应丢失后的精确重试，以及 1,001 条 active Task、
两个早期页、两轮普通轮询、旧页状态变化和继续前进；业务出口继续断言 canonical Task、Room ledger、
Submission、Review、Human completion 与依赖唤醒，而非只看卡片列。

## B：机器可校验的行为交付队列

`ui-behavior-registry.json` 的 84 个行为均具有适用性、当前状态和原因，脚本验证 ID 完整覆盖、枚举、交叉引用和非空理由，并生成 `raft-behavior-inventory.zh-CN.md`。当前队列为：

- `verified`：29
- `needs-verification`：29
- `needs-feature`：12
- `needs-decision`：7
- `needs-fix`：1
- `not-applicable`：6

这些数字是可执行工作队列，不是完成率，也不把旧审计自动升级为当前证据。唯一已知 `needs-fix` 是 B070：desktop 页内通知中心 hover/focus 时序；真实设备通知送达仍由 B063/B069 跟踪。

## C：Workspace 切换器完整页面族

B071 已从历史声明迁移为当前 owner、采用记录和双浏览器场景。生产页面与 fixture 共用内部 Workspace identity/switcher owner；没有把测试状态机带入生产。

Chrome 与 Firefox 的组件页面族同时覆盖：桌面点击打开、256px anchored geometry、外点关闭、Escape
关闭并还焦、长名称截断、真实 pointer 排序拖拽与刷新持久化、每 Workspace 合法最近 URL、独立管理弹窗及
焦点返回，以及 390×844 下无横向溢出。Firefox 完整生产 App 另创建两个 canonical Workspace/Room，先记录
第二 Workspace 的桌面 Settings，再证明移动选择忽略该详情、进入既有 Home owner、history 不增加、
Back/Forward 准确且 reload 后仍恢复正确 Workspace/Room。

来源采用固定的 Raft Web 冻结发布物证据：`Switch or Create Server`、`updateServerOrder`、`replace-with-home`、`max-h-[calc(100dvh-16px)]` 和 `w-64`。RAH 只移植可观察 UI/交互合同，Workspace/Room 身份及 URL 合法性由 canonical owner 裁决；排序和最近位置是有界 Human-scoped 浏览器偏好，不宣称跨浏览器同步。没有引入 Multica 的模拟业务状态机。

## 验证与正式运行

- `npm run check`：通过；包含全包测试、Web 单测、历史回归 34/34、浏览器请求策略 8/8 和源码体积 ratchet。
- `npm run format:check`、`npm run build:web:workbench`、`npm audit --omit=dev`、`git diff --check`：全部通过；生产依赖审计为 0 vulnerability。
- UI foundations：Chrome 14/14、Firefox 14/14，总计 28/28，收据为
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-ui-foundations-q5L8qJ/receipt.json`。
- Firefox 完整 workbench 门禁通过并输出
  `RAH_FIREFOX_WORKBENCH_GATE {"browser":"Firefox 150.0.2","desktopViewport":"1440x1000","mobileViewport":"390x844","persistent":true,"scenarios":["workspace-switcher-full-app"]}`。
- 正式 Discovery 收据：
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-discovery-formal-aqRYic/receipt.json`；
  Settings 收据：
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-settings-formal-pSCmrs/receipt.json`。
- 正式实例：`http://127.0.0.1:4173`，PID 24385，`/_rah/health=online`，内容确定 build ID
  `7cab52644662ab500144e4830ec123ebd47d41b91c2ca154f82784006655c84d`；response header 与 HTML meta
  精确一致。
- 正式重启前先由 guard 确认无活动执行，再备份并校验 Room、Runtime Registry、Web Push 数据库和全部状态文件；
  备份为 `/Users/sun/.rah/backups/pre-restart-994b51c5-12d1-4d7a-adb1-22b86aa2758e`，receipt 为
  `/Users/sun/.rah/backups/pre-restart-994b51c5-12d1-4d7a-adb1-22b86aa2758e.receipt.json`。旧 PID 83386
  仅通过 SIGTERM 优雅退出，没有 force-kill。

正式 Discovery/Settings 验收没有写入付费 Provider。两份 receipt 的前后快照均为 6 principals、6 rooms、
43 messages、2 tasks、378 room events，逐 Room 最大序列不变；只读 cursor 的推进属于预期持久投影行为。

## 未扩大声明

- 当前不是全产品 1:1，也不是 84 项全部完成；下一修复优先级仍由机器队列决定。
- 组件自身回归只能证明 RAH 未退化；与 Raft 相同功能页面的最终一致性仍要求固定官方来源、同前置浏览器操作及 computed-style/业务副作用证据。
- Raft 官方可观察合同优先；Multica 只在适配 RAH 本地架构时提供参考，不能覆盖 canonical Room、Task、RunAttempt、Submission 或 Review owner。
- 本报告不提交或推送当前工作区；第三方独立裁决未返回前，不把状态写成最终审计通过。
