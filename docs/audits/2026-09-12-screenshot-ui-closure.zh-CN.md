# 截图所示 UI 修复：标题、选择、通知、文档与设置

本批只修改呈现及组件交互，不更改 Agent 执行、Task 业务、附件权限、
HTML 脚本策略。未提交、未推送；正式部署状态见末尾。

## 证据与边界

- 2026-09-08 Raft index-BVfbaScj.js，SHA256
  65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde。
  XR 为视口级附件外壳，wYe 为 Markdown 文档，J9e 为大纲。
  wYe 的宽屏大纲使用 xl（1280px）、256px 栏、24px 间距、
  文档主体最大 768px、整体最大 1152px。普通视口正文居中，窄屏隐藏大纲。
- 2026-08-31 MachineDetailPanel-CIacRrGS.js，SHA256
  5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8。
  操作栏条件是 selecting 且选中数大于零。指标组件 lg / yellow-fill /
  previewOnHover：20px、黑框、黄色选中底、未选悬停灰勾。
- 2026-08-31 ReleaseNotesPanel-DO_q-S-n.js，SHA256
  ffed584ec62f9db5548b48974b89ce26f821eab7f9156bd6ff765ef97587f68a。
  采用两像素卡片、当前项浅黄底、日期框、分类标签与轻阴影；
  内容继续使用本地真实记录，不复制 Raft 版本号或商业发布内容。
- 本轮 Chrome 实际打开 Raft #all 设置，读到标题 20/28px，
  带描述的外层高度 74px。此前“Raft 始终固定 54px”的说法不能继续沿用。
  用户本轮明确要求统一页头横线，所以 RAH 使用共享 --head-h、
  标题 16/20px、描述 12/16px。这是用户要求的呈现约定，并非上游原值。
- 启动图标填充深色亦按本轮用户要求处理。帮助文档卡片属于本地指南设计，
  不是声称 Raft 存在同一内容页面。

## 单一 owner 与实现

1. 频道设置与成员子页消费共享 --head-h；短窗口时 portal 层也消费同一
   48px 分支。恢复可见描述，不把描述放在 visually-hidden 中。
   Agent/Thread 已使用 PanelHeader。居中的 Task 详情仍属独立 modal，
   本批没有把 Raft 的中央弹窗擅自改为右侧抽屉。
2. 动态保留原 30px、2px 边框的完成按钮，删除旁边独立的取消关注文字按钮。
   不改完成按钮语义或 activity.follow 接口。
3. Computer 空选择不显示操作栏。保留真实 checkbox 的键盘与 checked 状态，
   用伴随图形提供黑框、浅灰 hover 勾及黄色 checked 状态。
4. 通知触发器取消短 tooltip。真实 hover 回归先复现同时出现通知面板与
   “通知”tooltip，修复后只保留面板。其它 Rail tooltip 不受影响。
5. room-files 是全屏预览外壳 owner，file-preview-renderers 是文档展示 owner。
   继续复用 MessageMarkdown。大纲从已安全渲染的 h1–h3 生成，沿用原
   attachment-section 锚点，不创建第二套消息路由。点击只滚动，不改 Room URL。
   保留截断提示、下载原件、评论及现有 HTML trusted bridge 与 CSP。
6. Settings CSS 拥有更新日志与指南卡片；指南仍读取原单一 HTML 内容源。

以上为参数/结构移植与 RAH 接线，并非字节复制。冻结上游仅作证据。

## 验证

- 频道标题旧值实测 54px 对正文 62px：失败复现；修复后桌面及短窗口共用高度，
  原 pin/mute 持久化、可见性确认/取消、手机操作回归通过。
- Computer 0 选中仍显示操作栏：失败复现；修复后卡片选择、勾选边框、
  重置入口回归通过。没有执行真实 CLI 的启动或停止。
- 通知双浮层：失败复现后回归通过。
- Markdown 旧预览宽度 1000px 对 1440px 视口：失败复现；修复后全屏、
  1280px 大纲条件、标题跳转保持 Room 路由、HTML 脚本清除、文件下载原字节通过。
  Chrome 与 Firefox 各 18 个文件类型/视口场景执行通过。
- 更新日志、帮助卡片浏览器检查及截图检查通过。
- 前端单测 405 项通过；正式 Web 构建通过；git diff --check 通过。
- 文件门禁原先仍要求 HTML sandbox 为空，与本批前已存在的 trusted bridge
  不符。更新为现有 allow-scripts，并追加断言附件恶意脚本文本被移除；
  保留 parent 脚本执行失败断言。这不是放宽产品 HTML 执行权限。
- CSS 报告因本次样式修改失效，已重新生成 sq-btn/sidebar-row 的
  matched-rules、fixture-markup 及目录，未扩大预算。

## 集成检查与部署

首轮全仓检查暴露并行施工中的 HumanActivity 类型错误，后续已消除。
第二轮发现 Agent 打开 DM 被误接到 Human 私有侧栏；该在途修复已增加 Human
身份条件，原有 Worker Direct Room 回归恢复通过。本批没有改变 Agent 的参与权限。
两个旧图标断言也失效：sprite 新增 archive/log-out/circle-stop，以及路由列表前缀
改变。逐项核对 index-BoAC7nSE.js 的 Q4e/F3e/zUe 后，新增精确几何断言，
旧 sprite 的 hash 保持不变；图标路由断言改查 globe 实际归属而不依赖数组首项。

最终 npm run check 通过：包级测试 1571 项中 1554 通过、17 跳过、0 失败；
Web 单测 405 通过；其余合同、类型和回归检查通过。format:check、diff 检查通过。
Chrome 文件门禁最终稳定快照 18 场景通过（rah-file-types-s3e5QP），Firefox 对应
18 场景通过（rah-file-types-9a6RVd）。这些是隔离浏览器验证，不是假称同内容全量双边验收。

正式服务已进行经校验备份和优雅重启，本批备份为
`/Users/sun/.rah/backups/pre-restart-f38cb1f3-0b12-4346-855c-f341c74470b9`。
同目录另一轮施工随后再次更新正式构建；最终实际页面 build 为
`817e7ccb65d035bf5af6a17e42222cbc0edbff5d92080ad0b63bf83eb78e8b3d`。
重新核实本机、Tailscale 与局域网原有三处监听均存在，没有把临时回环监听状态留给用户。
本批全仓检查与最终并行批次的整体代码不能混称为同一冻结修订；以下 UI 验收针对最终正式页面。

正式 Chrome 页面验证：频道标题下边界与正文相同，900px 高窗口的标题为 62px，
500px 高窗口为 48px，标题 16px；Computer 零选中隐藏条、点击卡片选择和黑框通过；
更新日志与帮助卡片、通知短 tooltip 排除通过。正式 Room 的已有 Markdown 附件在
1440×900 与 390×844 全屏打开，大纲在桌面可见、窄屏隐藏，截图经人工检查。
正式截图与结果在 `/tmp/rah-ui-formal-closure/`；现有消息正文仅作为展示数据，不当作架构事实。

本批未提交、推送或运行付费 CLI；未向另一个 session 发送报告。
