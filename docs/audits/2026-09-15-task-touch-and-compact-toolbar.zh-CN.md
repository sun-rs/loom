# 任务卡片触摸滚动与频道单行工具栏

## 原因、来源与选择

用户要求 PWA 任务大页和频道任务页在列表/看板中都能从卡片上滑动；频道工具栏压缩为一行，并维持白底上的纯黄/白色切换。

GlobalTaskBoard 采用 Raft `Vie` 的 MouseSensor 距离 5、TouchSensor 延迟 200ms/容差 5 和 KeyboardSensor；本地 discovery-controls.css 又给整个卡片壳设置 `touch-action:none`，所以从卡片开始的触摸连原生滚动也被禁止。发布来源仍为 Raft `666bab60d8658d9e382e2c286ce1e423231e8f31`，授权 vendor manifest 和内部 ui-tokens/adoption.json 的来源/许可记录保持不变。本批不导入新外部资源。

Multica `apps/mobile/components/project/project-related-issues.tsx` 选择只提供移动列表，未保留移动看板；不采用此删减，RAH 保留用户要求的两种视图。采取明确差异：手指负责原生双向滚动，不启动拖拽；鼠标和键盘仍可拖动，触屏通过现有状态菜单更改状态。没有新增手势计时器、业务操作或状态 owner。

## 实施

- GlobalTaskBoard 移除 TouchSensor，保留 MouseSensor 的 distance:5 和原 KeyboardSensor。卡片壳 touch-action:auto，纵横方向及缩放交给浏览器。
- 移动频道 TaskToolbar 隐藏批量清除与新建按钮文字，保留「新建任务」无障碍名称；创建者、负责人、加号、看板/列表同一行。选项弹窗内的「清除」继续工作，桌面工具栏保持完整文字与批量操作。
- Segment 的 plain surface 在移动端仅白色/纯黄；signal surface 仍是任务大页黄色标题上的白色/浅黄。颜色继续由 ui-tokens 共享 owner 管理，不给卡片或筛选行另定色值。

## TDD 与验收

移动工具栏测试先以 158px 与 118px 中心线不符失败，再改为单行。原生触摸测试在修正临时投影的 Task 状态证据后，复现从卡片按住 300ms 再滑动，scrollTop 仍为 0 的失败；修复后分别核对 global/room × list/board 的原生触摸滑动，scrollTop 增加超过 30，且不启动任务拖动。测试使用隔离 fixture 和密集的临时任务投影，不修改正式数据或运行付费 CLI。

还核对鼠标与键盘可激活拖拽并用 Escape 取消，两项筛选同时激活不换行、加号无可见文字、频道切换按钮按黄白呈现。浏览器门禁纳入 test:web:mobile-navigation。WebKit 移动布局验证不等同于物理 iOS 手势验收。

## 已完成验收

- `npm run check`、`npm run format:check`、`git diff --check` 和 `npm run build:web:workbench` 通过。共享 CSS 变更后重新生成 sidebar-row/sq-btn 的实际测量报告和 UI catalog。
- Chromium 原生 Input.dispatchTouchEvent 验证四种组合均能从卡片按住后纵向滚动；两种看板也验证横向滚动。独立桌面页面验证鼠标、键盘拖拽激活和 Escape 取消，未发出 task.workflow 写入。日志 `/tmp/task-touch-final-verified.log`。移动页面缩放成桌面后仍可能有惯性滚动，旧混合测试因此出现一次指针目标漂移，已改为独立桌面页面验证，不放宽拖拽断言。
- Chromium 与 WebKit 390×844 布局门禁通过，双筛选激活后保持一行、纯图标新建、纯黄/白色分段色已目视检查。证据目录为系统临时目录下 `rah-mobile-tabs-PfXurU`、`rah-mobile-tabs-hcELCn`。
- 正式构建 `80ca8033bfec1a277120079e4a783cec04e3fe69af741553ead0333163d64eb8` 经空闲检查、状态备份、精确 PID 正常停止后上线；备份 `~/.rah/backups/pre-restart-cee111a5-cfd6-444e-afbd-fefb6f00e62c`，交付时新进程 34629。原 Tailnet/loopback/LAN 三个监听均保留。
- 两个真实手机网络入口重新打开 430×932 页面，校验冻结构建与完整移动导航场景均通过；已查看正式频道工具栏双筛选截图。证据 `rah-task-compact-formal-BgRpXi`、`rah-task-compact-formal-GE87Jq`；日志 `/tmp/task-compact-tailnet.log`、`/tmp/task-compact-lan.log`。未宣称物理 iPhone 或官方 Raft 双边验收，未运行付费 CLI、提交或推送代码。
