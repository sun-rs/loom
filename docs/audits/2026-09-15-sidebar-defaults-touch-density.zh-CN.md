# 聊天列表默认折叠、触摸选择与移动密度

## 来源与边界

Raft https://app.raft.build 授权分析包 `index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，
配套 `index-DPaRRgFJ.css`。发布包仅作分析证据，不引入运行依赖，不声称开源授权。

- pretty 136250：`sidebar-root` 使用 `select-none`，覆盖整棵导航子树。
- pretty 133605：FD 标题 `mt-3 mb-1 h-6`，没有窄屏分组间距分支。
- pretty 133835：Tg 条目 `mb-1 py-2 md:py-1`；高度不超过 600px 时 `py-1`。
  Raft 压缩矮屏条目内边距，但没有按手机宽度压缩分组间距。
- pretty 134318、134442、136700：Raft 读取和保存分组折叠偏好。此次空组折叠、
  非空展开是用户指定的本地默认策略，不声称和上游偏好机制完全相同。
- Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
  `packages/ui/components/ui/context-menu.tsx:19` 在共享菜单 trigger 使用 `select-none`；
  RAH 保留既有 Base UI 菜单事件所有权，采用 Raft 侧栏容器范围。

## 修改

`SidebarSection` 是折叠状态唯一所有者；初次渲染和空/非空边界变化采用默认值，
不通过 effect 延迟一帧，不在轮询或非零数量变化时覆盖用户手动选择。
内置置顶、频道、私信及自定义组共享规则，空组仍可手动展开查看提示、接受拖入。

先前 CSS 仅保护条目和标题，空白与提示文字仍可被浏览器选择。改为
`.rah-room-sidebar` 统一禁止文字选择、触摸 callout 和 tap highlight；未增加
全局 `preventDefault`、`touch-action: none` 或新的长按计时器。编辑表单通过 portal
保持文本选择；侧栏滚动、点击和键盘菜单继续由原组件负责。

移动端低于 768px：分组上间距 12→8px，净空 16→12px；条目下间距 4→2px。
文字、头像、按钮尺寸和条目内边距不变。每三个分组、十个条目约节省 32px，
实际随条目数变化。桌面保持 Raft 源参数。此密度调整是明确的本地差异。

## 验证状态

新增几何/状态断言先复现空组展开、移动净空 16px 和条目间距 4px；触摸断言
先复现侧栏根 `user-select: auto`。浏览器门禁覆盖空组创建、置顶内容 0→1→2→0、
手动折叠跨轮询保留、空白长按菜单与 Selection 状态、表单文本选择和长列表滑动。
几何/默认状态门禁在 Chromium、WebKit 的 1440×900、390×844 通过；分组拖动、
持久保存、取消和失败恢复在 Chromium、Firefox 通过。触摸门禁在 Chromium、WebKit
通过；Chromium 另验证原生触摸滚动。WebKit 桌面引擎不支持 iOS 专属的
`-webkit-touch-callout`，静态规则登记负责断言声明，不能声称由该引擎实测系统浮窗。

`npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench` 通过。组件规则报告和目录已重建；移动密度是有用户
决定和测试的维护规则，不增加未解决例外，也未放宽现有预算。

正式交付准备期间发现旧 PID 19349 已不存在，4173 无监听，日志没有留下退出原因；
未向已退出进程发送信号或强杀其他进程。再次检查无活动执行后，复用现有备份、
校验、冻结资源和网络启动所有者恢复工作台。备份为
`/Users/sun/.rah/backups/pre-restart-0d082769-26ae-4ca5-9789-da21d339aa8b`，
新 PID 31345，构建
`41b7b5f60cdff120c6b333ab7398e35bcf56a308652fe8eedb241f317363b7e9`。
保留原状态目录和网络模式，loopback、Tailnet、LAN 三个入口均返回该构建。

正式新浏览器 1440×900、390×844 验证默认状态、文字大小、间距、排序开关、
创建入口与重载，零页面错误、零 sidebar.patch/rooms.create 写入。移动重载需等待
频道恢复后点击“返回主页”；脚本已按实际导航生命周期等待，不在挂载前跳过返回。
截图人工查看通过：`rah-sidebar-formal-T80HQl`；隔离几何证据
`rah-sidebar-geometry-byv2ew`、`rah-sidebar-geometry-TL1QZw`，空白长按和长列表
滚动截图为 `/tmp/rah-sidebar-blank-touch-{chromium,webkit}.png`、
`/tmp/rah-sidebar-touch-scrolled.png`。这些临时证据不是用户产品入口。

物理 iPhone Safari/PWA 的系统选择浮窗尚需实机确认；WebKit DOM 触摸测试不等于
物理 iOS 手势验收。没有本次线上 Raft 同条件双边浏览器验收。
本批未提交、推送或调用付费 Provider。
