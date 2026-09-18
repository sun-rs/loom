# Composer 引用窗口与菜单定位

## 范围与依据

用户要求菜单不跟随加号动画；引用文件默认从当前用户目录打开，取消目录根选择，
允许返回 `/Users` 和 `/`，并采用已有 Raft 按钮配色。

Raft Web 1.16.0 发布包 `web-index.js` 的创建频道主按钮位于字符偏移
2421045，使用 `btn-brutal bg-brutal-pink`，取消按钮为白色。
版本、URL、SHA-256 和来源授权见 [Composer 合同](../design/composer-controls.md)
与 [证据清单](../evidence/raft-release-20260916/manifest.json)。
本次为 RAH 文件引用窗口组合共享按钮，不声称复制了 Raft 同名窗口。

## 根因和实现

- Base UI 原先锚定在有 transform 的加号按钮；改为不参与动画的外层锚点。
  保留按钮反馈、共享菜单的焦点、关闭与碰撞处理。
- 原先将 home 同时作为起点和授权根，无法返回父目录。ComputerFileBrowser
  单独拥有引用范围和初始目录：正式默认范围 `/`、起点 `homedir()`；显式配置
  较窄根仍受约束。前端以响应中的相对路径导航，无目录根选择器。
- Computer 只显示当前主机名称，未来选择计算机不需要恢复目录根选择器。
- 元数据列表复用原有路径、敏感目录、符号链接和数量限制；仅引用读取器允许
  filesystem root。Agent 工作区 list/read 仍拒绝 `/`，不增加正文读取接口。
- 已选文件明黄，普通 hover 浅黄；当前目录引用使用共享黄色按钮，引用所选使用
  共享粉色主按钮。已选状态不被 hover 覆盖。目录错误时仍可返回上一级。

## 验证入口

- `computer-file-browser.test.ts`：先复现旧实现拒绝 `/`；验证用户目录起点、
  逐级父目录、根目录、非法子路径，以及工作区 list/read 仍拒绝根目录。
- `test-composer-controls-browser.mjs`：先复现目录根下拉仍存在；验证移除后，
  文件选择颜色、菜单移动差值、拒绝访问后返回、路径引用不上传，以及原发送/停止。
  Chromium 和 WebKit，1440x900 与 390x844；截图检查与运行结果独立记录。
- `test-composer-formal-browser.mjs`：正式实例只读浏览默认 home、父目录及 `/`，
  检查无消息变更、无控制台异常；不触发真实 CLI 或发送引用。
- 上传仍由 `test:web:composer-drop` 覆盖 Chrome/Firefox；类型与完整检查遵循
  工程门禁。自动化浏览器不等于实机 iPhone，也不等于 Raft 双边验收。

## 本轮运行记录

完整 `npm run check`、格式检查、diff 检查、正式构建通过；Chromium 完整 Composer
门禁及 Chrome/Firefox 上传门禁通过。WebKit 文件引用专项（包含桌面/触摸尺寸，
按住、松开加号时菜单位置不变）通过。完整 WebKit Composer 门禁在后续发送/停止
和页面重载场景出现间歇性 `rooms/sync due to access control checks`，保留为未闭合
的完整门禁问题，未过滤异常或更改产品同步逻辑；一次完整复跑通过不视为稳定结论。

正式实例已按 idle 检查、备份、正常退出、冻结构建启动流程更新；真实新页面验证
`/Users/sun` → `/Users` → `/`，无正文或 Room 事件变更。最终截图发现未选中时的
主按钮仅功能禁用而缺少视觉淡化，补入 `opacity: 0.5` 与禁用光标并再验收。
