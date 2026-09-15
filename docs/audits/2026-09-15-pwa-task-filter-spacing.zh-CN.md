# PWA 任务筛选间距与菜单关闭边框（2026-09-15）

## 来源与判断

Raft 授权参考 `https://app.raft.build`，vendor build
`666bab60d8658d9e382e2c286ce1e423231e8f31`，`index-WTraJnrd.js` 的 Task panel
工具栏为 `flex flex-wrap items-center gap-2`。`HG` creator/assignee 选择器使用 2px 边框，
未选中为 `border-black/30 ... hover:border-black`，已选中为 `border-black ... shadow-brutal-sm`。
内部维护参数 `extracted/raft-official-tasks.css` 已记录工具栏间距 8px 和选中阴影 2px/2px。
此次复用既有 token，不复制发布 bundle；沿用现有授权来源。

Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/issues/components/filter-chips-bar.tsx` 采用独立的属性值摘要 chip，
没有适合替换本地共用 DiscoveryFilter 的同款边框协议，本次不引入其 view store。

原 PWA 为容纳「新建任务」把按钮间距压至 2px，选中阴影占满了可见空隙；
关闭菜单后残留黑边来自触屏 sticky hover，而非菜单没有关闭。

## 规则与所有者

- Room TaskToolbar 移动布局使用既有 8px 工具栏 token，选中两项仍有可见空隙。
- PWA Room 的创建者/负责人是单选，移除只可能为 1 的计数角标，以容纳完整按钮文字。
  保留选中颜色、菜单中的勾选值和清除操作；桌面以及全局多选计数保留。这是用户要求单行布局的本地适配，非声称 Raft 原样。
- DiscoveryFilter 的真实展开状态仍由原 `aria-expanded` owner 控制；展开黑边、关闭灰边。
  hover 黑边仅在 `(hover: hover) and (pointer: fine)` 生效，桌面鼠标移出恢复。
  已生效的筛选保持黄色背景/黑边/阴影，不随菜单关闭清掉筛选。
- 不使用 blur、额外触屏状态或手动模拟点击，不改变键盘焦点及筛选协议。

## 验证

`test:web:task-filter-touch` 在修改前复现 390/430px 菜单已关闭但黑边残留、选中间距不足。
修改后以 Chromium/WebKit 检查 390、430、1440px：原按钮切换、外部关闭、桌面 hover/移出、
全局菜单同样关闭复原、实际筛选黑边保留，以及两项选中后所有按钮单行且不越界。
移动 Root 导航/任务工具栏既有门禁作为回归。自动化使用隔离 Fake provider；不等同于实体 iPhone 验收。

### 完成记录

Chromium/WebKit 的专项测试均通过，包含触摸外部关闭；既有移动导航与两项筛选单行回归通过。
`npm run check`、`npm run format:check`、`git diff --check` 和
`npm run build:web:workbench` 均通过；共享组件样式证据与 catalog 已更新。
正式实例经空闲检查、持久数据备份及优雅停止后使用新冻结资源启动，原 Tailnet/LAN 入口保留。
两个原入口均以新浏览器页面验证构建标识和操作；390/430/1440px 下复验菜单关闭灰边与选中间距。
选中截图等待背景过渡结束、确认两项真实筛选生效再采集；已检查正式页面截图。
正式复验只改变页面筛选，没有修改任务、发送消息或运行付费 CLI。本轮没有提交或推送。
