# 动态时间与处理按钮替换

## 修正旧基线

用户发现时间和对勾应共享右侧位置。此前本地审计取到的旧浏览器页仍加载 `index-BVfbaScj.js` / `ThreadsInbox-Df4Pr6bf.js`，其中按钮在普通布局中占位，时间右距 56px。不能将旧构建继续当成线上最新版。

2026-09-13 重新请求入口并打开全新 Chrome 标签后，实际加载 `index-MqTUR4Ez.js` / `ThreadsInbox-C27ErbNa.js`。最新版明确采用时间/按钮替换。旧报告已增加失效说明。

## 源码与实景

- URL：https://app.raft.build/assets/ThreadsInbox-C27ErbNa.js
- SHA-256：`64c2b872b4ee297644ec762fa8bb097d6b932b214caca7e192f27f3ba1c44648`。
- 分析副本：`/Users/sun/Code/reviews/rah_os/2026-09-13-activity-swap/ThreadsInbox-C27ErbNa.js`，保留上游发布物，仅供分析，不作为产品依赖。
- `conversation-card-content` 改为 `min-w-0 w-full`。
- `conversation-card-actions` 为 `absolute right-3 top-3 z-10 pl-1`；按钮初始 `opacity-0 pointer-events-none`，hover/focus 时可见且可点击。
- `conversation-card-timestamp` 在有操作时使用 `group-hover:opacity-0 group-focus-within:opacity-0`；无 hover 的设备默认隐藏时间、显示操作。
- 悬停背景为白色；时间保留布局尺寸，避免交互时正文跳动。

过渡参数也由官网计算值复核：时间 opacity 150ms、按钮 opacity 100ms，均为 cubic-bezier(0.4, 0, 0.2, 1)，复用本地已有交互 token。

最新官网真实 DOM/计算值：viewport 1098×1172、DPR 2；时间右距 14px；操作区 top/right=12px、padding-left=4px；非悬停时 time opacity=1，button opacity=0、pointer-events=none。

本轮原生电脑工具报告 Mac 已锁定，浏览器 DOM 仍可读取；不能宣称完成官网真实指针 hover 的双边验收。官方条件由最新版源码与实时 DOM 确认，本地真实指针交互由隔离 Chrome/Firefox 验证。

## 实施和验证

`packages/ui-tokens/src/neo-brutalist/activity.css` 是布局及配对可见性的唯一 owner。移除 global-discovery/interaction-state 中重复的按钮显隐覆盖；不改已读/处理动态的业务接口。

更新 `scripts/test-activity-read-all-size-browser.mjs`：修复前实际56px、预期14px失败；修复后 Chrome/Firefox 在1440和390宽度验证右锚点、hover移入/移出、键盘Tab进入/离开、触屏、隐藏按钮不可接收指针、卡片无重排；保留全部已读按钮尺寸回归。日志 `/tmp/activity-swap-{red,green,firefox}.log`。

## 收口结果

- `npm run check` 完整退出0（`/tmp/activity-swap-check.log`）。最终过渡参数修正后，Chrome/Firefox 专项回归、组件规格与库合同、格式检查、正式 Web 构建再次通过；没有重复运行与 CSS 无关的业务套件。
- 日志：`/tmp/activity-swap-final-{chrome,firefox,library,format,build}.log`，`git diff --check` 通过。
- 已检查空闲、验证备份并正常重启正式实例。备份 `/Users/sun/.rah/backups/pre-restart-1e25e217-f75d-482d-9325-0071cc4e7154`；重启 `/tmp/activity-swap-restart.log`。
- 正式构建 `602927b930079ed7cea1a9460f29520059390c329b48b4ec3b9261c7ee3f94e6`，入口 `http://127.0.0.1:4173/`。
- 全新 Chrome 页面在1440和390宽度分别检查8张真实动态卡片：所有时间右距14px；真实指针 hover 时隐藏时间并显示对勾，移出恢复；卡片不重排。未点击已读/完成按钮。记录 `/tmp/activity-swap-formal.log`；已检查 `/tmp/activity-swap-formal-hover-1440.png` 和 `/tmp/activity-swap-formal-rest-390.png`。

未提交commit/push，未运行付费模型。
