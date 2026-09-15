# 消息菜单场景矩阵与 PWA 选择条间距

## 来源与采用边界

授权网页发布物 https://app.raft.build/assets/index-MqTUR4Ez.js，SHA-256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
本机分析副本位于 `Code/reviews/rah_os/2026-09-13-dialog-audit/`；下列行号指
`index-MqTUR4Ez.js.pretty.js`。发布 bundle 仅作授权分析证据，不加入运行依赖，
本批是 RAH 适配和条件对齐，不宣称逐字复制或获得通用开源授权。

- `kg` 146041：`parentMessageId`、`hideThreadActions`、`showThreadFollowAction`、
  `linkedTask` 决定消息身份。146357 的 `As = !g || !!b`，以及 `li` 判断消息列是否存在。
- 菜单 148100–148287：复制、选择、打开消息列、收藏、关注、任务操作的渲染条件。
- `Pd` 146808：只有 `status === "done"` 才提交 `todo`；其余提交 `done`。
- Thread 渲染 164635–164725：回复传 `parentMessageId` 并隐藏 Thread actions；
  母消息隐藏打开入口，但显式保留 follow，并传 linkedTask。
- `Ide` 148375–148507：移动 `gap-1`（4px），桌面 `sm:gap-1.5`（6px），
  外侧 padding 8px；测量按钮宽度和 gap，再逐项收起文字。
- 旧授权 vendor build `666bab60d8658d9e382e2c286ce1e423231e8f31` 的
  `index-WTraJnrd.js` / `index-EQxYM8hQ.css` 仍与上述 4/6px 间距及
  `.btn-brutal-sm` 的 2px 常态阴影、4px hover 阴影一致。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`apps/mobile/components/chat/message-long-press.tsx` 用原生 ActionSheetIOS
提供 Copy / Select Text / Cancel，不包含 Room/Task/Thread 条件矩阵，不替换现有 owner。

## 去重场景矩阵

共同菜单：快速表情、分隔线、复制 Markdown、选择消息、分隔线。PWA 在复制 Markdown
后增加用户要求的“复制文本”；下面表格仅列共同菜单之后的部分。收藏/关注的反向文案由
canonical saved/following 结果决定。消息作者是 Human 或 Agent 不改变这些主菜单条件。

| 场景                                 | 本地菜单尾部                                 | 对比结论                                                 |
| ------------------------------------ | -------------------------------------------- | -------------------------------------------------------- |
| 频道/DM 普通顶层消息，无消息列       | 打开消息列、收藏、转为任务                   | 核心条件一致                                             |
| 普通顶层消息，已有消息列             | 打开消息列、收藏、转为任务、关注/取消关注    | 保留用户指定的转换紧邻收藏、不加横线                     |
| 任务顶层消息，待办/进行中/评审中     | 打开消息列、收藏、关注、分隔线、标记为完成   | 一致                                                     |
| 任务顶层消息，已完成                 | 打开消息列、收藏、关注、分隔线、重新打开任务 | 一致，继续使用静默完成任务重开合同                       |
| 任务顶层消息，已关闭                 | 打开消息列、收藏、关注、分隔线、标记为完成   | 本批修正原错误“重新打开任务”                             |
| 普通消息列母消息                     | 收藏、转为任务、关注（消息列存在时）         | 不再打开自身；允许转换，一致                             |
| 任务消息列母消息                     | 收藏、关注、分隔线、完成/重开                | 与顶层共用状态判断，一致                                 |
| 消息列回复（普通/任务讨论，频道/DM） | 收藏                                         | 不打开嵌套消息列、不转换、不关注母列、不操作母任务，一致 |

仅展开空消息列不创建 durable Thread，所以此时母消息没有关注操作；首条回复创建 Thread，
发言者自动关注。回复里的彩色 Task 引用不等于该回复承载 Task，不能据此补任务菜单。

明确保留的产品差异：无复制链接、转发或分享到 X；普通转换紧邻收藏且不加分隔线；
无权限时操作禁用而非绕过后端校验；异步错误可见、禁止重复提交。较新的参考发布物另外
含翻译能力条件、在新窗口打开消息列、在新标签页打开任务；本地未提供这些独立能力，
不伪接成功按钮，也不把本矩阵称为所有 Raft 菜单功能完全复刻。系统通知不是普通消息卡片。

## 修正

PWA 选择条按钮间距 4px 改为 8px，外侧 padding 对齐源值 8px。这是针对用户反馈的
明确本地改进：4px 阴影之外仍有 4px 净空；不是将 Raft 原值误报为 8px。桌面维持 6px。
原有逐项收起文字逻辑测量实际 gap，保持单行，不通过缩小字或按钮来挤占间距。

`messageTaskMenuTarget` 是菜单完成/重开目标的唯一前端 owner，菜单文案与 App 提交都
使用它。`cancelled` 对应 closed，点击标记完成提交 done；只有 completed 提交 todo。
Kernel 事务、任务权限、旧状态保护、Agent 激活规则均沿用既有实现。

## 验证状态

间距测试先复现 4px/8px 差异；已关闭任务的单测与浏览器矩阵先复现 reopen/complete 差异。
扩展 `test:web:message-menu` 验证菜单完整顺序和分隔线、收藏/关注正反状态、空 Thread、
转换、完成与重开、五种任务状态的顶层/母消息/回复，以及 DM 普通消息和 Thread。
状态测试使用无 Agent 的隔离 Room，避免 Fake Worker 并发认领改变被测状态。
`test:web:message-selection` 增加 390/320/240px 按钮间距、阴影净空、单行及恢复检查。

Chromium 与 WebKit 的菜单矩阵均通过（1440×900、390×844）；Chromium 使用 CDP
真实触摸事件，WebKit 使用合成长按事件，不等于 iPhone 实机。已检查菜单与选择条截图，
包括五种任务状态、PWA 灰色分隔线、按钮留白与窄屏收起文字。已关闭任务的浏览器用例
还验证提交后 durable state 为 completed、回执没有新增 Activation。

`npm run check`、`npm run format:check`、`git diff --check` 和
`npm run build:web:workbench` 均通过。CSS 改动后依照门禁重建 sidebar-row/sq-btn
匹配规则报告与 UI catalog，没有放宽规则或 source-size ratchet。

正式实例经 idle 检查与完整备份后优雅重启，新 PID 19349；原 PID 6365 已退出。
备份：`/Users/sun/.rah/backups/pre-restart-fbbb51ca-3d12-40d1-ba84-99153a1e3927`。
冻结构建 `6f1842d7b9fa4ce0da244bda29d903a9c9e5c0b5f1743c6b448ccda199d33ae7`
已在 loopback、Tailnet 与 LAN 三个原入口验证。

正式新浏览器在 1440×900、390×844 验证菜单、原生触摸长按、复制文本页、选择条
8px/6px 间距、任务覆盖层往返保留选择、图片预览和重载，页面无异常；未发送真实消息
或修改真实任务。首次运行在消息列初次加载的滚动恢复期间打开菜单，被滚动关闭；等待
内容稳定后完整重跑通过。这不证明加载过程中菜单交互的稳定性。
截图：`rah-message-formal-1PghP5`；隔离 Chromium/WebKit 菜单分别为
`rah-message-menu-rV4UCA`、`rah-message-menu-H6kgkF`；窄屏几何为
`rah-selection-refinement-9596Vu`（均为本机临时证据目录）。

以上来源是网页源码，不是 iOS 原生源码，未做 Raft 在线同条件双边验收。
没有运行付费 Provider、提交或推送。
