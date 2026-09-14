# 任务标识随 canonical 状态更新

## 来源与边界

沿用 `packages/ui-web` 的 `taskStatusPresentation` 五态投影和维护中的 Raft 色彩 token：待办橙色、进行中 cyan、待确认 lavender、完成 green、关闭 gray-chip。来源仍是 Raft `index-MqTUR4Ez.js`（SHA256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`）及既有 Task 状态控件移植。发布 bundle 保持分析用途，没有引入新依赖或复制发布包。

已核对授权展开源码 Task inline 分支 144680 行附近：该旧版本正文 `task` 引用固定 soft-signal，不能据此声称上游所有引用都动态着色。本次按用户明确要求，把正文引用也扩展为当前状态配色；Task 身份标识本身仍复用原解析和导航。

## 根因与 owner

聊天 `rah-message-task-link` 已拿到最新状态属性，但 CSS 固定 lavender；正文 `rah-rich-task-reference` 固定黄色，引用目录仅传 ID/编号而不传状态。动态现有 `activity.list` 返回当前 Task 投影，原有五秒前台刷新已经能更新数据。

本次为正文引用目录传入 canonical Task state，共用 `taskStatusPresentation`。`task-reference-colors.css` 统一聊天、正文引用和动态标识的五态底色及文字色；hover 只调整亮度，不改回固定黄色。未知/不可访问引用不猜测状态。

状态仍由 Kernel 拥有；Room task window 和 discovery query 负责原有刷新，不新增缓存、消息改写或任务状态机。任务修改后沿用原有 refresh/reload，其他窗口通过既有前台轮询和聚焦刷新收敛，并非跨客户端零延迟推送。

## 验证

新增浏览器测试先复现 canonical in_progress 的标识仍是紫色，再验证无 reload 的进行中→待确认→完成颜色变化。任务响应使用明确的展示夹具及合法 schema，动态展示项注入相同测试任务，验证现有刷新后展示当前配色；不冒充真实状态转移证据。另扩展真实临时数据库的任务弹窗门禁，以关闭→待办操作验证聊天底色跟随持久化结果。正式数据不用于测试写入，不运行付费 CLI。

专项浏览器配色门禁通过；真实临时数据库的桌面与 390px 任务修改门禁通过。`npm run check`、`npm run format:check`、`git diff --check`、正式 Web 构建通过。正式服务已在空闲检查与持久数据备份后安全重启，冻结 Web 构建为 `a22f7e9b1844f743dc33ad824eb620a284cc3d3021124d5b94ad76bdca56c59e`。本机、局域网、Tailnet 三个地址的新浏览器页面均核对现存聊天和正文任务引用的实际底色与状态映射一致，已检查截图；正式环境不写入测试状态。
