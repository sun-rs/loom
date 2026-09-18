# Agent 直接启动

用户明确要求启动无需确认。此批为用户指定交互，不新增上游一致性声明。
Agent 详情标题操作、资料页启动按钮、成员右键菜单直接调用既有
`AgentStateChange` / `agent.manage(set_state, enabled)`；停止、删除、重置
继续使用各自确认流程。权限、控制 Room 版本围栏与 Kernel 状态没有改动。

`use-agent-start.ts` 统一请求中的禁用、同步重复点击保护、页面错误提示，
失败重试沿用 idempotencyKey。切换 Agent 或卸载后旧请求不覆盖当前反馈。
没有通过此改动启动正式 Agent 或调用付费 CLI。

`scripts/test-agent-direct-start-browser.mjs` 先复现点击后仍出现启动确认框，
再通过隔离 Kernel / fake provider 验证三个入口、停止确认保留、失败提示、
pending 禁用和同键重试。浏览器测试不是正式部署或真实 CLI 验收。
