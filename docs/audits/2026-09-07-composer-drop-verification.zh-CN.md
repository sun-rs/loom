# 文件拖放交付子链路验证

范围：B019 中 Chat/DM/Thread 的拖放入口。复用 FileUploadStore、RoomFiles 和原消息发送 owner，
没有新上传队列、数据库迁移或 Provider 调用。本文不宣布整个 Files 页面族或整个 B019 完全复刻。

## 来源与实现

[设计合同](../design/composer-file-drop.md)记录冻结 Raft Web 与本轮官网现行发布物的 SHA、
源码位置、CSS 参数，以及 Multica 的比较。当前源码仍使用 Files-only、嵌套深度、目录跳过、
同批文件去重和粉色虚线提示层。ui-web/ui-tokens 共享提示层，两个表单复用 ComposerDropForm；
附件草稿仍由原 FileUploadStore 按 Room/Thread key 持有。picker 补齐同等 disabled 检查。

Computer 1.0.18 的 attachmentUploadContract 也明确规定服务端上传会话、完成验证与取消；
本地 RoomFiles 承担等价业务职责，不能因为没有中央账户就省掉这些步骤。

## TDD 与真实业务结果

- `rah-drop-red.log`：新增提取合同测试先因缺少实现失败。
- `rah-drop-browser-red.log`：实际生产组件在文件 dragenter 后没有官方提示层，真实浏览器先失败。
- 浏览器第一次接线复跑发现测试在 capability 尚未就绪时拖放；改为等待真实附件按钮可用。
  后续 native checkbox 被自定义视觉框覆盖，改为点击真实 label；Room messages/list 包含回复，
  顶层断言改为按 threadId 明确分类；reload 后旧 DataTransfer handle 无效，归档场景创建新句柄。
  这些是测试前置纠正，保留错误日志，没有削弱业务断言。
- 完整回归的原 owner 测试要求 form DOM 仍在 conversation-panes；现改为明确要求 Chat/Thread
  两处委派同一个 form owner，且仍委派原 submit。不是删除 ownership 检查。
- 最终隔离浏览器回执 `rah-composer-drop-mPYbJh`：Chrome/Firefox × 1440×900/390×844。
  原始 DataTransfer 经过真实 React form、HTTP prepare/PUT、消息发送和文件下载；每个引擎/尺寸
  均验证 Chat 和 Thread 的附件-only 消息、刷新后引用、实际下载文件名及字节。
- 附加覆盖：嵌套 enter/leave、Escape、普通文本保留默认行为、文件夹拒绝、任务模式及归档禁止、
  picker 不能绕过 disabled、上传失败不可发送、移除重试、慢上传时关闭并重开 Thread，Room 草稿不串入。
  文件失败注入仅改变临时环境上传响应；成功与 canonical 结果仍由真实 Kernel 产生。
- 拖放本身不产生消息；显式发送才写入。Thread 回复的 threadId 与根消息保持绑定；
  不是把按钮成功提示或 CLI exit 当交付。专项 6 项自动测试也通过。
- 已查看最终桌面 Chat、手机 Thread 提示层截图。边框 2px dashed、z30、pink 15%、
  label 14px/700、6px 12px padding、black 文本边框与 2px shadow 均按官方来源参数验证。

## 现场对照边界

本轮 CUA 官网实操：Search → #test → 频道右面板，读取输入栏控件、1280×720/DPR2
几何并检查真实截图；下载并核对现行 index-BVfbaScj.js 的拖放 handler 与样式 class。
这不是官网完成上传/发送/下载的同条件双边验收，没有向官方频道发消息或上传文件。
本地浏览器 DataTransfer 注入不是 macOS Finder 实物拖拽；这两层仍不能标为通过。
因此登记保留 needs-verification，不虚报 verified 或全产品完成百分比。
官方双入口（媒体/文件）与本地单入口的视觉差异仍单列，不在本轮偷偷扩建。

## 证据与交付

证据目录：`/Users/sun/Code/reviews/rah_os/2026-09-07-composer-drop`。
本批提交、付费 Provider 和官网消息发送均未执行。完整检查、正式备份重启及用户数据比对结果
在最终交付记录追加。后续不另开功能，先完成本环节剩余正式交付与明确的现场验收边界。

## 最终交付记录

- `npm run check` 通过：package 909 pass / 2 opt-in skip、Web 353、parity 34、formal policy 9；
  `npm run format:check`、`git diff --check` 与 `npm run build:web:workbench` 通过。
- 为更新 form owner 的静态检查后仍能关联完整输入，最终重跑回执为 `rah-composer-drop-IYA3G4`，
  1,005 个输入 SHA 与当前候选一致，四组 Chrome/Firefox × 桌面/手机均通过；查看最终 Thread 截图。
  `mPYbJh` 是此前同产品代码的通过回执，不改写其旧测试输入 hash。
- 正式冻结 build：`7be9bd24a47983e68bff1a2c8ff53a7928e1017da48321609f4cc366fa630abe`。
- 原正式实例 66197 在 idle、准确身份、数据库和备份复核后正常退出；备份目录
  `/Users/sun/.rah/backups/pre-restart-cbcd40da-7cde-48d9-ae8e-d19b8eb47a2a`。
  新实例 84859 服务 `http://127.0.0.1:4173`，使用上述冻结资产。
- 新正式页面回执 `rah-discovery-formal-j7Ggsz`：Chrome/Firefox 的 Search/Tasks/消息操作只读烟测通过，
  8 张截图、无未声明请求或页面错误。CUA 另开正式新页面，确认新 form owner、附件按钮可用、
  无 alert，并真实点击 Tasks → Chat 验证恢复。正式数据未用于拖放、发送或归档测试。
- 重启前后内容快照完全相同：6 Room、43 Message、2 Task、378 event、4 Agent/35 revision、
  4 runtime profile/31 revision、37 个私有记忆文件。前台读取只推进原有读前沿。
- 未 commit/push、未运行付费 Provider；不声称官网上传下载双边、Finder 原生拖拽或全产品完成。

本轮本地文件拖放交付子链路已收口；B019 的现场对照以及整个附件入口仍保留已列明差异。
没有同时开工新的后端权限或其他页面。
