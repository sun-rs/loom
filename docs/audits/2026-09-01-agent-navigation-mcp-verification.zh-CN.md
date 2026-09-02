# Agent 导航与 MCP 使用页验收

日期：2026-09-01。范围：Agent 稳定身份/tab 路由与 MCP server→tool 使用投影。

## 结果

| 项目                 | 证据                                         | 结果                                                   |
| -------------------- | -------------------------------------------- | ------------------------------------------------------ |
| 规范 URL 与解析      | `apps/web/test/agent-route.test.ts`          | 通过；未知 tab 回退、隐藏 Room 状态剔除                |
| 目录水合竞态         | 同上 + 真实 Chromium gate                    | 通过；刷新不再先回退到第一位 Agent/profile             |
| MCP server/tool 汇总 | `apps/web/test/agent-mcp-projection.test.ts` | 通过；仅展示已使用、已分配、允许的工具                 |
| Agent MCP 刷新       | `scripts/run-real-browser-gate.mjs`          | 通过；刷新前后 Agent ID、`agentTab=mcp` 与空态一致     |
| 桌面/移动            | `npm run test:web:browser`                   | 通过；门禁最终报告 viewport `390x844`，同一套组件/协议 |
| Web 单元             | `npm run test:web:unit`                      | 122/122 通过                                           |
| TypeScript           | `npm run typecheck`                          | 通过                                                   |

真实浏览器首次暴露了一个水合竞态：刷新后 Agent 目录短暂为空，旧实现把深链目标当作不存在并改写到第一位 Agent。修复后，空目录只表示“仍在加载”；非空目录才有资格裁决目标缺失。

MCP 本轮没有制造非空假数据，也没有调用真实或付费 Provider。服务器/工具分组有官方冻结源码、canonical 本地 read model 和纯投影测试证据；当前浏览器只证明空态和刷新恢复，不冒称已完成双方同前置非空数据 `R-pass`。

## 生命周期二审

Raft 的 `restart/session/full` 是三种不同破坏范围。RAH OS 当前具备 `execution_restart` fence 类型、Memory reset 与 Provider session quarantine，但 AgentHost 没有面向单 Agent 的 drain/reap 控制 API；Task cancellation 又绑定 Task 重新分配语义。直接拼接 disable/enable 会产生错误业务事件，直接 Memory reset 会错误删除长期记忆。因此本轮保持按钮禁用并把该能力留在 P2，先补 Host 控制面后施工。

## 正式发布复验

全量 `npm run check`、Prettier、diff、production build 与依赖审计通过后，先确认正式库不存在活动 Task、InputRequest、Activation 或 Run，再将在线 SQLite、私有配置、Provider session 与 Agent Memory 备份到 `/Users/sun/Library/Application Support/RAH OS/backup-before-agent-mcp-thread-files-4xHWYl`。两份备份数据库 integrity check 均为 `ok`。

旧实例优雅停止后，正式 `4173` 从冻结资产 `/assets/index-oDMj5FZ7.js` 启动。新开的真实浏览器页面显示四个本机 Runtime；从主导航进入 Agent，切到 MCP 后刷新，URL 中相同的 AgentDefinitionId 与 `agentTab=mcp` 均保持，页面仍选择 MCP。正式库没有 MCP assignment/call，因此如实显示“暂无 MCP 使用记录”，未回填 fixture 数据冒充非空结果。
