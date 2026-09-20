# Task 卡片单击打开

## 原因与来源

卡片内部只有 `.rah-global-card-open`（文字块）绑定打开动作，外框内边距和底部空白不属于按钮。
因此点击这些空白无响应，换到文字区域才打开，表现为需要多次点击。

核对 Raft v1.16.0 `ba2a1dbac175595f28dfe1c09e4df2556d59ac0c` 的
[发布 bundle](https://app.raft.build/assets/index-CKeqacxz.js)，SHA256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
`xbt` 卡片同样由外框、正文 button 和独立状态控件组成。
本次按用户要求扩大本地点击范围，不宣称上游已支持外框所有空白。
沿用来源许可台账，bundle 仅分析；这是 RAH CSS glue，不是复制上游代码。

## 单一所有者

`discovery-controls.css` 为已有 native button 添加绝对定位伪元素，覆盖卡片内部；
状态控件位于其上，保持独立操作。任务打开、键盘、禁用和拖拽仍使用原组件路径，
不添加新的导航状态或重复 onClick。全局/频道任务共用 GlobalTaskBoard。

## 验证

新增 `test-task-card-hit-area-browser.mjs`：先在卡片内边距单击，旧实现两秒内无法显示
审批弹窗，确认失败后修复。覆盖 1440 和 390 宽度下内边距、底部空白、标题的一次点击，
Escape 关闭后再次打开、状态菜单不误开审批窗、键盘 Enter 打开。
纳入 `test:web:task-presentation`。浏览器使用临时数据库和 Fake CLI，未运行付费 provider。

Chromium/WebKit 的列表和看板、桌面和窄屏均通过；既有 touch-scroll 门禁通过，
包括长按后的原生滚动及桌面鼠标/键盘拖拽的激活与取消。正式构建与 diff 检查通过。
全量 check 仍被已有 `/v1/worker/message-present` 登记缺失阻塞；format 仍有前批记录的
五个无关文件问题，未修改这些文件或放宽门禁。

活动工作检查与备份验证完成后重启正式实例，备份 receipt
`pre-restart-224d5728-99d4-4f0a-9fc7-16a345c39901`，冻结构建
`b185c2bb5a5d459cf0477d4943a99bf537e558b8edd92f1c53733b7fd07d42f6`。
新进程已监听正式端口。全新 Chromium 打开正式任务列表，用户截图的 Agent Council #3
在内边距/底部空白各单击一次均打开审批窗；状态菜单独立，未改变正式任务状态。
截图 `/tmp/rah-card-formal.png` 已检查，卡片视觉几何未变化。
