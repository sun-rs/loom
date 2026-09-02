# Agent 导航与 MCP 使用页合同

状态：2026-09-01 已实现并完成本地真实 Chromium 验收。本合同只覆盖 Agent 稳定路由和 MCP 使用投影，不扩大为提醒、应用授权、Agent-to-Agent Chat 或重启／重置完成证明。

## 1. 来源与适配边界

| 合同                      | Raft 冻结来源                                                      | RAH OS owner                                                   | 适配说明                                                                                       |
| ------------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Agent 身份与 tab 进入 URL | `AgentDetailPanel-DKwoNvgK.js` 的 `qc`、tab 描述及 `agentTab` 写入 | `apps/web/src/agent-route.ts`、`App.tsx`、`AgentDirectoryPane` | 使用稳定 `AgentDefinitionId`，不把 Room、Thread、Message 或筛选状态夹带进 Agent URL            |
| MCP Agent scope           | `webAppVersion-CfNNzAIv.js` 的 `Ye` Agent scope                    | `apps/web/src/agent-mcp-projection.ts`、`AgentDirectoryPane`   | 复用已有 managed MCP server、assignment、usage 三个 canonical read model，不新增第二份调用真相 |

Raft 页面与发布包只决定触发、参数、条件显示和交互结果。RAH OS 后端仍是本机 daemon owner，不复制 Raft 中央账户或服务器拓扑。

## 2. 稳定 Agent 路由

规范 URL 为：

```text
?surface=agents&agent=<AgentDefinitionId>&agentTab=<tab>
```

合法 tab 为 `activity/profile/chat/reminders/workspace/apps/mcp`。未知 tab 回退到 `profile`。进入 Agent 页面时会剔除先前 Room、Thread、Message 与全局筛选状态；浏览器后退/前进从 URL 恢复身份和 tab。

目录水合期间必须保留 URL 请求的 Agent 与 tab。只有 canonical Agent 目录已非空且确认目标不存在时，才回退到第一位 Agent 的 `profile`，并用 `replaceState` 规范化 URL。侧边 hover/click 打开的 Agent panel 仍默认 `activity`，不污染主页面 URL。

## 3. MCP 使用页

Agent MCP 页只展示满足以下条件的服务器：

1. 服务器已分配给当前 Agent；
2. assignment 允许的工具与服务器目录相交；
3. 至少存在一次该 Agent 的 canonical MCP usage。

服务器行显示连接／分配状态、调用总数、失败数与最后使用时间；展开后只列允许的工具，并汇总每个工具的调用次数、标题与描述。调用参数、凭据和结果正文不进入浏览器投影。服务器增删改、OAuth 与连接测试属于 Server 管理 scope，不加入 Agent tab。

## 4. 失败与隐私

- 三个 read model 任一读取失败，页面显示可重试错误，不把旧 Agent 的结果采用到新选择。
- 空态必须表示“当前没有 canonical usage”，不能伪造示例调用。
- Agent 切换、tab 切换和卸载会取消当前请求；晚返回不得覆盖新身份。

## 5. 不在本批的能力

- Agent-to-Agent 私信摘要的 ACL/read model；
- Reminders 和 Apps grant；
- restart/session/full 三档重置。当前只有全局 Agent 独占 fence、Memory reset 和 Provider continuity 隔离，尚缺 per-Agent execution drain/reap 控制面，不能用 pause/resume 冒充。
