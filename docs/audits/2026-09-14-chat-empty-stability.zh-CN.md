# 空消息状态的文案与后台同步稳定性

用户要求：所有空消息正文仅保留图标与“暂无消息”，去掉“开始对话吧。”；后台同步不闪烁。

唯一 owner：App 的 RoomData 已加载快照标识与共享 ChatEmptyState 展示组件。
Room/DM 共用 ChatPane；不增加消息缓存或第二套同步状态。

来源：Raft `index-MqTUR4Ez.js`（SHA256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`）
ChatPanel 160814–160853 行将加载、正文与空状态分支分开，空状态为 36px 聊天图标与两段文案。
本地按用户要求有意删除第二段文案，并保留既有图标与标题风格；不是逐字复制。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/chat/components/chat-window.tsx:130` 使用 query 初次 loading，145 行说明已有数据的刷新不显示 skeleton。
参考仓库仅用于分析，生产无依赖；不复制其会话所有权或缓存。

根因：App 每次后台轮询都设置 loading=true，ChatPane 在无消息时卸载整个空状态，短暂改为同步提示。
修复：传给 ChatPane 的加载状态仅适用于尚无当前 RoomData 的请求；已有当前 RoomData 的空列表在后台刷新期间继续呈现。
切换对话仍由原有 RoomData 清理与请求代际机制负责，不展示上一个 Room 的内容。

验证：新增 `scripts/test-chat-empty-stability-browser.mjs`，隔离 fixture 保留真实同步生命周期，将消息页设为空。
先确认慢同步导致原 DOM 被卸载的失败，再验证 Room/DM 后台同步期间 DOM 身份保持、仅显示“暂无消息”，并覆盖桌面与 390×844。
这项验证不运行真实付费 Provider。

自动验证：Chromium 与 Firefox 的上述回归通过。`npm run check` 的包测试有一项因并发测试占用
`agent-task-split-host` 失败；其余包测试通过，冲突项单独复验通过。随后补跑的 Web 单测因另一批
同时修改的标题 class 与旧断言不一致失败；该批更新断言后重跑通过。完整 check 的其余后续命令
（Web 单测、parity、formal-browser-policy、bilateral-captures）全部补跑通过；没有将首次完整命令报告为绿色。
格式、diff、UI catalog 检查与正式 bundle 构建通过。

正式工作台按冻结构建 `8cdf037caab506a7a12e6f0a9f2dc46b6e713c7bc73b4e5819e40d230cb205c7`
完成安全备份与重启，保留持久历史、Agent 配置和私有记忆。

正式浏览器：localhost、LAN、Tailnet 的两条现有空私聊均通过连续同步期间 DOM 保持、刷新后文案、
390×844 可见性验证，并检查真实截图。现有 all 频道有成员加入记录，不能作为空正文验收样本；
空频道由隔离 Chromium/Firefox 回归覆盖，正式环境未创建测试频道或发送消息。
