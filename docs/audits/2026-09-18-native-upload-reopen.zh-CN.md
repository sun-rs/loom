# 移动附件选择器连续打开

## 证据与边界

用户报告 iOS PWA 文件菜单隔次打开。共享 Composer 原先阻止 pointerdown 默认行为，
再从按钮 click 调用隐藏 input.click()。旧回归使用鼠标式 click，未覆盖触摸 tap。
新增 WebKit 移动触摸回归在旧实现等待 filechooser 30 秒超时；这证明旧触摸触发路径
有缺陷，但不等于已经在 iPhone 复现用户所见的原生菜单精确交替序列。

沿用 [Raft/Multica 来源与 hash](../design/composer-attachment-pickers.md) 的
multiple、清空 value、选取后回调及无选择不上传约定。WebKit 官方
[FileInputType 源码](https://github.com/WebKit/WebKit/blob/main/Source/WebCore/html/FileInputType.cpp)
的 handleDOMActivateEvent/showPicker/fileChooserSettings 说明用户手势与输入元素框的
作用；本次仅参考其机制，没有移植该 LGPL 源码，也没有将某个历史 WebKit issue 当作
本次真机问题的已确认根因。

## 修复

ui-web 的 ComposerAttachmentPickers 是唯一交互 owner。移动上传用原生 input
覆盖已有 26px 图标控件，触摸由浏览器直接处理；保留 unrestricted multiple input。
无 pointerdown 拦截，无定时器重试、双击补偿或全局 picker-open 锁。
键盘及直接点边框由带 button 语义的 wrapper 激活；原生 input 冒泡不会重复调用。
原生输入与 wrapper 同步禁用，change 再检查资格，cancel 不上传、不发送。
频道、私聊、消息列继续使用同一组件与上传 owner；Plus 文件引用行为不变。

## 验证状态

新增门禁 `npm run test:web:native-upload-reopen`，`RAH_UI_BROWSER=webkit` 可选 WebKit。
覆盖连续四次真实 tap、取消边界、每次仅一个 chooser、可信原生 click、草稿及光标保留、
Enter/Space、同文件重复选择、Task 模式禁用、拒绝迟到的文件 change、重新启用及边框点击。
OS 菜单取消通过 filechooser/DOM 边界建模；真机原生 action sheet 仍需设备验收。
Chromium 与 WebKit 新门禁通过；完整 Composer 上传门禁在 Chromium/Firefox、
1440px/390px 通过，包含频道与消息列、上传失败恢复、重复文件和权限边界。
`npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench` 均通过。

本地浏览器证据位于本次临时目录中的 `rah-native-upload-reopen-Q0FpoO`（WebKit）、
`rah-native-upload-reopen-mwbb9V`（Chromium）及 `rah-composer-drop-djd8uU`（完整上传）。
冻结 Web build 为 `943308d1572a39fb04b238f236038fc4b4b93047448cafcc737c1ba923b5ef08`。

正式重启已尝试，检查阶段因 Agent Council 仍有一项 queued Activation 而拒绝，
尚未进入备份或停止阶段；原服务保留运行。因此本次为代码和自动化验证完成，
正式部署、正式入口新页面及 iPhone 原生菜单验收尚未完成。未绕过活动工作保护。
