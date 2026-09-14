# 文件预览评论入口对齐

## 上游证据与边界

参考冻结的 Raft Web `docs/evidence/raft-web-20260908-current/index-BVfbaScj.js`（SHA-256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`，来源 app.raft.build；保留原始来源，仅作分析证据）。

- `RYe` 只有在预览 entry 带 `commentContext` 时才构建 comments，包含原消息 parentMessage。
- `SYe` 明确以 `preview.kind === "pdf" ? undefined : comments` 排除 PDF。
- `EYe` 将 comments 传给 HTML/视频；音频 `AYe` 不接收 comments。
- 消息附件打开函数 `ad` / `ku` / `Nd` 传入原消息 id/channelId/senderId/senderType。不能从“某文件可浏览”推断出原消息评论上下文。

本次是条件与入口的结构移植，不是逐字复制。未更换评论后端、鉴权、Room 围栏、定位协议或文件权限。未据此宣称整个文件预览与 Raft 双边验收完成。

## 本地实现

单一呈现 owner 为 `apps/web/src/components/room-files.tsx`。正常消息组件显式传入原消息 ID 的评论上下文，文件列表与无原消息上下文的转发快照不传入。所有评论入口共同消费 `commentsEnabled`：头部按钮、选中文字、视频时间点和评论面板。PDF/音频即使来自消息也关闭评论。

原消息上下文是入口条件，不是客户端鉴权凭据。原有 `file.comments` / `file.comment` 服务继续负责从附件解析真实 Room、原消息关系和权限，客户端不新增业务处理路径。

## 验证

- 新真实浏览器回归 `scripts/test-file-preview-comment-entry-browser.mjs`：同一 Markdown 附件在聊天中可评论，文件列表打开无评论；正文点击不能绕过条件。消息中的 PDF/音频无评论。覆盖 1440×900 / 390×844。
- 修复前新测试在 PDF 上失败：预期评论按钮 0，实际 1；日志 `/tmp/file-comment-entry-red.log`。
- 原评论端到端门禁保留发送、分页、引用定位、HTML 隔离与视频时间点；将 PDF/音频的旧“可以评论”断言改为上游明确的排除断言。
- 新入口回归 Chrome / Firefox 均通过两个尺寸；截图 `/tmp/file-comment-entry-{chrome,firefox}-{1440,390}.png`，已检查桌面和窄屏截图。
- 原评论 Chrome 门禁通过：发送/重试去重、定位、HTML 隔离、视频时间点及三页 115 条唯一评论、翻页期间新增、重载；证据 `/tmp/file-entry-comment-regression4/results.json`。分页入口显式携带来源消息定位，避免把当前最新窗口误当作完整历史。
- `npm run check` 完整通过（`/tmp/file-entry-check.log`），`npm run format:check` 通过（`/tmp/file-entry-handoff-format.log`），`git diff --check` 通过；正式 Web 构建通过（`/tmp/file-entry-build.log`）。后续仅修正浏览器测试的入口定位，没有追加产品代码修改。

## 正式实例

已检查空闲、备份并正常重启；备份 `/Users/sun/.rah/backups/pre-restart-085167ac-4324-427a-a667-7a70e5684133`，重启记录 `/tmp/file-entry-restart.log`。正式构建 `c9fc31746bbdc4adbc69d2ccbfd5094fc317ebdd0d2801a823e70427cb4c2031`。

重启后使用全新 Chrome 页面，在 `http://127.0.0.1:4173/` 对现有同一个真实 Markdown 附件验证：文件列表预览没有评论，原消息 Thread 入口有评论且等权限读取完成后输入框可用；1440×900、390×844 均通过，未发送评论。记录 `/tmp/file-entry-formal-green2.log`，截图 `/tmp/file-entry-formal-{1440,390}.png` 已检查。

本次未做新的 Raft 在线双边实验，结论是源码条件对齐、隔离浏览器通过和正式本地验证通过。没有 commit / push，也没有执行付费模型测试。
