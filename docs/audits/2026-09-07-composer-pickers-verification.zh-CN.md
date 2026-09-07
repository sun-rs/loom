# 媒体／文件双入口单项交付

范围：B019 的选择器子行为。顺序与出口见[当前单项队列](./2026-09-07-current-parity-closure-review.zh-CN.md)，
来源、参数和差异见[设计合同](../design/composer-attachment-pickers.md)。不扩大为整个 Files 或整个 B019 已完成。

## 已实现与纠错

Raft 官方两入口现由 ui-web 的 ComposerAttachmentPickers 统一提供：媒体筛选图片/视频，
普通文件不筛选，均支持多选，共用 FileUploadStore → RoomFiles → 原消息事务。
Chat/DM 和 Thread 共用控件，保留禁止态、取消无副作用、键盘激活、输入值清空以便重选。
实际选中文件后失焦；仅打开/取消不会丢失编辑光标。图标路径按官方来源逐项验证，旧 sprite 内容保留原 hash。

多选专项进一步复现旧固定高度缺陷：Thread 三个附件把 textarea 压至 0px，第三个草稿也被裁切。
维护的共享样式改为原最小高度、正文不收缩，让附件行撑开；没有用强制点击或删掉断言通过测试。
这是本地附件布局修复，不冒称已经复制 Raft 完整缩略图草稿托盘。

## 验证层次与限制

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-composer-pickers`。

- `browser-red.log` 先在真实生产组件上断言媒体入口不存在，确认 RED。
- `browser-green-first.log` 暴露多选后不可编辑；`multiple-red.log` 明确断言实际高度 0，保存失败截图。
- `browser-green-second.log` 已通过 Chrome 桌面及 390×844：真实按钮触发 filechooser，
  filter/multiple、取消光标、键盘选取、同文件重选、三个附件发送、Thread 归属及重载下载字节。
- 保留既有完整拖放回归，覆盖上传失败/移除重试、任务模式/归档禁止、慢上传与 Thread 草稿隔离。
- Mac 在本批官网 CUA 检查时锁屏，不能取得新的官网点击或原生 macOS 选择器验收。
  已有官网现场控件检查和两版发布物源码核对不等于官网完整上传/发送/下载的双边通过。
- 浏览器空 FileList 模拟选择器取消边界；不声称操作了原生 OS 对话框。付费 Provider 未调用。

本批只推进双入口及其真实附件链路；公开频道和 Agent API 没有同时施工。
最终四组浏览器、全量检查、正式重启与状态保存证据见下方交付记录。

## 最终交付记录

- `npm run check` 通过：package 910 pass / 2 opt-in skip、Web 353、parity 34、formal policy 9。
  `npm run format:check`、`git diff --check` 和正式 Web 构建均通过。
- 最终隔离浏览器回执 `rah-composer-drop-Mr6yA3`：Chrome/Firefox × 1440×900/390×844，
  每组实际完成 Chat/Thread 图片加两个文件的发送、刷新及逐文件下载字节校验；旧拖放边界全部保持。
  已复核回执输入与当前源码一致，查看最终桌面及手机截图。实际 DM 发送未独立复跑，
  其入口与 Chat 共用实现；不把共享组件推断写成新增 DM 实测。
- 正式冻结资产为 `b2e3b194a55edecad9d3c34dfb7a18106753273ca5526615d3d7d14e11509ee0`。
  原实例 84859 经准确身份、idle、备份验证后平滑退出；新实例 95813 使用该资产服务
  `http://127.0.0.1:4173`。备份：`/Users/sun/.rah/backups/pre-restart-43b1a451-4983-48a4-8565-e9e68998719e`。
- 正式双浏览器 Search/Tasks/消息只读检查通过，8 张截图；另一个新页面专项在两个浏览器、
  两个尺寸验证实际双入口及空选择、禁止空发送、刷新，4 张截图，收到的 build header 与冻结身份相同。
  正式请求白名单拒绝未声明写入，无页面错误；已查看手机正式截图。正式状态没有发送测试附件或消息。
- 重启前后 canonical 内容、Agent/runtime 配置及私有记忆 hash 完全一致：6 Room、43 Message、
  2 Task、378 event、4 Agent/35 revision、4 runtime profile/31 revision、37 个记忆文件。
- 本批没有 commit、push、发布远程服务或付费 Provider 测试。工作树继承内容保留，
  本批相对前一交付新增/修改的 18 个文件另有外部清单，不把累计 dirty tree 冒充全部为本批变更。

本项本地实现、浏览器和正式交付已收口；B019 仍保留官网现场、原生 OS 选择器、完整媒体缩略图草稿区等
明确未验收/未对齐部分。下一施工项为公开频道发现—预览—加入—发送及权限撤销完整链路，
不得把本批双入口或之前元数据 API 当作该链路已完成。
