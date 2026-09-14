# 预览评论按钮三点图标

用户指出预览右上角评论按钮缺少气泡内的三个点。本次仅修正共享预览工具栏的图标。

## 来源和实现

Raft 授权分析源为 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
pretty 95062–95076 的 lVe/Hse 是 `message-square-more`；122049 的图片预览和
122923 的文件预览评论按钮均使用 Hse。原有空气泡是另一图标 `message-square`。

将 lVe 的四条 SVG path 原样提入 ui-tokens 的维护型 `interaction-icons.svg`，
保留 Lucide ISC 来源及随包 `/legal/lucide-icons-LICENSE.txt`；ui-web 负责符号路由，
Web 的共享文件预览工具栏选择新图标。未改冻结 snapshot 或附件评论业务 owner。
文件卡片的评论计数仍使用 Raft 的空气泡，评论引用仍使用 file-text。
Multica 的预览内容边界已在[上一批证据](./2026-09-14-file-comment-count-and-glyph.zh-CN.md)核对；本项没有复制 Multica 代码。

## 验证

先修改实际浏览器断言，确认旧按钮引用 `message-square` 而失败；实现后 Chrome、Firefox
均通过附件卡片/预览门禁，覆盖桌面与 390px 窄屏、评论开关、入口和类型限制、评论计数及引用。
图标单元测试逐字验证四条路径，原有精灵内容继续受原哈希约束。

`npm run check`、`npm run format:check`、`git diff --check` 与正式 Web 构建均通过。
图标目录随维护型 sprite 更新后重新生成并通过一致性检查。

正式实例完成空闲检查、持久状态备份和优雅重启；备份为
`/Users/sun/.rah/backups/pre-restart-ad28133a-0e2f-4709-b531-ed8f932e506d`。
新实例使用冻结构建 `b4f44d72d270c0cb5a955033952ca9abf2aad943f582c17669d6d786d52efdfc`。
新建真实浏览器页面核对现有 Markdown / patch 文件：工具栏的三点图标、打开后的黄色状态、
评论面板、2条/1条计数及刷新均通过；LAN/Tailnet 页面也验证相同构建。未发送真实测试消息。
截图 `/tmp/rah-comment-toggle-formal-preview-0.png` 已目视核查。
本项为原始 SVG 几何提取及本地真实浏览器验证，不声称本轮完成线上 Raft 双边像素验收。
