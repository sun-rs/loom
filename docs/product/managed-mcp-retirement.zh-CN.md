# RAH 托管 MCP 模块退役

决策日期：2026-09-08。用户明确要求“rah_os不需要这个mcp功能模块，可以移除掉”。本决定优先于旧复刻清单中对 Settings MCP、Agent MCP、首次连接配置与托管工具调用的要求。

## 产品边界

RAH 不再管理第三方 MCP Server 连接、凭据、目录、Agent 分配和调用统计；移除 Settings MCP、Agent MCP 页签、RAH 托管 MCP Human/Worker API、SDK/CLI 入口及 daemon executor/proxy 接线。旧 managed-mcp.json 不再作为本机启动配置读取；不因历史文件存在而重新启用模块。旧页面链接回落至仍支持的页面，不保留可操作的失效按钮。

这不是禁止用户的 Agent 使用工具。用户自行安装配置的 CLI 及其自身 MCP 环境不由本次变更删除；Room 的 Worker CLI/HTTP、Activation、Task、附件、私有记忆与必要的 Provider 通信仍保留。不能按 MCP 字符串全局删除诊断或通用协议支持。

## 历史兼容与验证

旧 SQLite 迁移、持久记录及备份不作破坏性清理；没有公开入口的历史结构可以保留，以保证既有状态可打开与 Room 历史完整。保留历史结构不表示当前仍支持此功能。后续若要恢复，需要新的用户产品决策。

验收要求：界面入口和请求消失；旧 URL 安全回落；已退役 API 不执行动作；不读取历史 executor/secret 配置；既有 Room/Agent/Task 工作链与正式启动保持；通过必要检查后备份并优雅重启正式实例。代码实施、测试、浏览器与正式交付结果由本批审计报告分别记录，本文件只定义决定和退出条件。

Raft 此功能继续存在也不再构成 RAH 首版缺口。历史双边截图与修复报告保留为旧版本证据，不据此重新安排 MCP 施工。
