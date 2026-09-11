# Worker 成员角色显示修复

根因：Kernel 已在 WorkerVisibleProfile.membership 返回 Room 的 role，但 Worker roster 的 memberLine 没有使用它；同时照搬了 Raft 的“未标角色就是普通成员”说明。profile-show 能显示 owner，不代表 room-members/server-info 也正确。

上游：Raft Computer 1.0.18，main.js 的 formatChannelMembers（675200 起）、roleLabel；SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`，路径 `/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`。采用“从权威身份数据输出角色”的结构，非逐字复制。上游角色是 server 级，本地只声明现有 Room membership，不能自行扩大成服务器权限。

单一 owner 仍是 Kernel Membership；AgentHost 只做显示。两个 roster 共享 memberRole，将已有 owner/admin/member 分别显示为 [room owner] / [room admin] / [room member]；缺少字段不猜角色，说明改为未提供。名为 owner 的普通成员仍显示 room member。未改变鉴权、Task、Activation 或默认 prompt。

TDD：先增加角色及身份误判反例，旧实现无法显示 @sun 的 owner 而失败；修复后渲染测试通过。真实 Worker HTTP→CLI gate 验证跨已加入 Room 的 room-members 输出 human 为 owner、reader 为 member。原权限与游标断言保持。

这修复的是发给 Agent 的 CLI 成员列表，不是额外添加网页权限页面。Task 自动认领已按双边实验另行裁决，不将此修复冒称原 A→B 串线唯一根因。

检查与部署：完整 npm run check、format:check、git diff --check 通过。首次完整检查发现新增测试的 string | undefined 类型未收窄，修正测试类型后重跑通过。真实 HTTP→CLI 用例通过。正式实例确认无活动工作，SQLite 在线备份及 state/council 文件备份后优雅停止，并以原冻结 Web 资源启动新进程；Chrome 重新加载频道及 Codex 私聊，历史正常，截图已人工检查。首次刷新早于服务 ready 出现连接错误，待启动日志 ready 后再次刷新通过，未隐去这一过渡状态。

证据目录：/Users/sun/Code/reviews/rah_os/2026-09-11-worker-roster-role/。本批未运行付费模型、未改 Web 资源、未提交或推送。角色显示已收口；原生忙时投递仍未实现，见下一批施工边界。
