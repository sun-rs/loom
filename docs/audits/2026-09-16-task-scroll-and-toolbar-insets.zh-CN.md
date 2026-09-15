# 任务触摸滚动与工具栏上下留白

## 来源与根因

沿用 [Task 虚拟窗口来源](../design/task-virtual-window.md)：Raft 发布包
`index-BoAC7nSE.js`，SHA256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
重新检查字符偏移 3134583 起的 `L8/Fj/cce`，其锚点保存屏幕 top，在 scroll
事件到达后清除；本地结构移植保留了同一竞态。Multica 无对应共享 Task 虚拟窗口
实现，继续使用现有 ui-web owner，不导入新依赖或改变任务业务状态。

手指滚动先改变 scrollTop，React 刷新可能早于主线程 scroll 事件。此时旧锚点的
屏幕 top 已变，布局补偿将这段用户滚动误判为布局变化，写回旧位置。专用夹具
令滚动与刷新发生在同一事件周期，修复前期望 340px 却得到 300px。修复后为
锚点记录其 scrollTop；检测到独立滚动时重新采集，只有布局变化才继续补偿。
输入取消还会撤销待执行的锚点采集，保留五次校正上限、虚拟行测量与键盘遍历。

工具栏的 Raft 来源参数位于
`packages/ui-tokens/src/neo-brutalist/extracted/raft-official-tasks.css`：
桌面最小高度 58px、上下 padding 12px。PWA 之前改成 32px 按钮和上下 10px
padding，却仍继承 58px 最小高度，实测顶部 10px、底部 14px。本批仅取消
移动 Room TaskToolbar 的最小高度，使实际内容决定高度，上下均为 10px。
Room/DM 复用该工具栏；不改变桌面尺寸和筛选按钮间距。

## 测试与边界

- 新增 `task-scroll-anchor` 夹具，验证刷新提交先于 scroll 事件时上下滚动均不回退。
- 扩展 `test-task-touch-scroll-browser.mjs`，验证全局/Room 的列表及看板从卡片
  按住后双向触摸滚动、没有卡片按压位移、不进入任务拖拽；桌面鼠标和键盘拖拽
  可正常激活并取消，没有任务写入。
- 扩展 `test-task-filter-touch-browser.mjs`，390/430px 下验证上下留白相等；
  修复前两种宽度均得到 10/14px，修复后 Chromium/WebKit 均通过，桌面测试保留。
- `test:web:task-virtual` 的 Chrome/Firefox 门禁通过：1,000 条任务有界挂载、
  移动及桌面列表/看板、真实滚轮、任务删除/恢复时锚点保持、边界 Tab 遍历。

## 正式交付

- `npm run check`、`npm run format:check`、`git diff --check` 和
  `npm run build:web:workbench` 全部通过。CSS 改动后重新生成 sidebar-row/sq-btn
  匹配规则证据与 UI catalog，没有提高例外预算。
- WebKit 额外验证刷新先于 scroll 事件的双向滚动夹具通过。原生触摸门禁日志
  `/tmp/task-bidirectional16.log`；虚拟窗口双浏览器记录目录 `rah-task-virtual-fb0Z8b`。
- 经过空闲检查、备份和优雅停止后，正式实例运行冻结构建
  `9dc5d0cb7f5f92a95eb59f1744a3f32fe11afd868d9342ed34b96f8e26995a6c`。
  备份 `~/.rah/backups/pre-restart-5d1da7bc-b213-4f04-88da-10c9f966d207`；
  原 loopback/LAN/tailnet 三个监听返回该构建，Room 与 Agent 数据保留。
- 正式页面 390x844 / 430x844 / 1440x900 验收通过：移动任务大页双向触摸、
  等待刷新后 scrollTop 不回退、标题固定、频道工具栏上下 10px、重新加载无错误。
  已检查对应移动和桌面截图，目录
  `/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-task-scroll-formal-flsFwj`。

本批浏览器触摸自动化不等于物理 iPhone 惯性回弹实机验证，不声称 Raft 实时
双边验收。未运行付费 provider，未提交或推送。
