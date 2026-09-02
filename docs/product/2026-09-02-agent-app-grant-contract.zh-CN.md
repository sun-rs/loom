# Agent 应用授权投影合同

状态：`R/design` 完成；产品代码保持禁用，等待 External Agent / OAuth grant owner

日期：2026-09-02

## 1. 结论先行

Raft Agent 资料页的“应用”不是本机 CLI 安装列表、MCP server 列表、Skill 列表，也不是中央应用商店。它是**已经取得该 Agent 身份权限的 OAuth client grant 只读投影与撤销入口**。RAH OS 当前没有这种 canonical grant；把 MCP、Host token、Human token、Worker activation credential 或 CLI 账号状态改名显示为“应用”，都会混淆权限边界。

因此本批不创建空壳 `agent.apps.list` API，不把“系统尚不支持 grant”伪装成“该 Agent 确实没有 connected app”，也不移植 Multica 的 Composio 工具连接来冒充 Raft 身份授权。应用 tab 保持明确 unavailable，直到 P4.2b External Agent 的 durable client identity、scope、revoke 和认证审计进入同一 owner。

## 2. Raft 冻结前端合同

证据：`docs/evidence/raft-web-20260831-current/AgentDetailPanel-DKwoNvgK.js`，SHA-256 `b2762e06c521457f40879c6e974d3768fec5dd0bb9d8cb2d03bbb2d6accc2845`，组件 `fc`。

已证明的行为：

- Agent 切换或首次进入时 GET `/integrations/agents/:agentId`；
- section header 在请求期间显示 loading；读取失败显示 warning；
- 客户端仅投影 `type === "active"` 的 grant；
- 空态为 `noConnectedApps`；
- 非空卡片显示 `clientName`、短日期、active lime badge、可选描述、可选 Agent manifest URL、scope badges、可选 homepage；
- `canManageServer` 才显示 revoke；POST `/integrations/grants/:grantId/revoke` 成功后重新加载，失败显示 warning；
- homepage 使用新标签页和 `rel="noreferrer"`。

冻结 bundle 没有给出 grant 创建、授权同意、secret/refresh token 存储、scope enforcement、撤销传播和审计的 Server 事务实现，所以不能仅根据卡片 UI 自制后端。

## 3. 当前 RAH OS 不可复用的对象

| 现有对象                            | 为什么不是 Raft Agent app grant                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| Human / Host token                  | 代表 Human 或 Computer，不代表外部应用被某个 Agent 授权                             |
| activation-scoped Worker credential | 短期、由调度器下发，只允许当前 Activation；不是 durable client grant                |
| managed MCP assignment              | 代表 Agent 可调用的工具，已有独立 MCP tab；没有 OAuth client identity / Agent scope |
| CLI 本机账号                        | 由用户自行安装登录，RAH 只调用；不是 RAH 可撤销的第三方 client grant                |
| Skill                               | prompt/tool package，不是授权主体                                                   |
| Agent App Inbox                     | Computer-local 内部事件投影，不具备 client、scope、grant lifecycle                  |

## 4. Multica 对照裁决

对照 commit：`11861145abc59a0d39c8c8f24ad837d4584e664f`。

Multica 的 `server/internal/integrations/composio/dispatch.go`、`server/internal/runtimeapps/connected_app.go` 和 migration 127/129/132 实现的是：Human owner 连接 Composio account，Agent allowlist 与 owner active connection 取交集，为每次 task 创建 secret-bearing MCP overlay，并另外记录不含 secret 的 `ConnectedApps` 运行元数据。它的四级 fail-closed gate、account pinning、allowlist intersection 和 secret/non-secret 分离值得未来工具授权复用。

但它不是 Raft Apps tab 的 client grant：

- 权限方向相反：Multica 是“Agent 可调用哪些外部工具”，Raft 卡片是“哪些 client 被允许以 Agent 身份行动”；
- Multica connected app 是 per-run capability evidence，Raft grant 是 durable identity authorization；
- 引入 Composio 还需要第三方项目 API key、OAuth callback/webhook 和远端服务，违背当前本地基础能力范围；
- RAH 已有 MCP tab，直接移植会形成第二套 MCP 真相。

所以本批拒绝移植；若未来单独建设 tool-account connection，应在 MCP/工具授权域立项，而不是借 Apps tab 进入。

## 5. 解锁前置与唯一 owner

只有以下对象齐备后才施工：

1. `AgentClient`：稳定 client id、名称、描述、homepage、manifest、可信登记来源；
2. `AgentAuthorizationGrant`：AgentDefinition、client、严格 scope 集合、状态、创建/撤销时间、generation；
3. secret 只保存 hash 或受系统 keychain 保护；客户端 secret、Human token、Host token、Worker token互不复用；
4. 每个 Agent API command 在服务端依据 grant scope、Agent membership/ACL、freshness、idempotency fail closed；
5. revoke 事务使旧 generation 立即失效，并有跨重启测试和审计记录；
6. list 只返回非 secret summary；无管理权看不到 revoke；stale Agent 切换响应不能覆盖新页面；
7. P4.2b device authorization 若成为 client onboarding，必须与这里共享同一个 credential/grant owner，不能各建一套 token 表。

建议 owner 链：strict protocol -> Kernel `agent-client-grant-service` -> application/HTTP/SDK -> Raft 形 Apps tab。未经这条链，不新增页面本地假数据。

## 6. 后续失败优先验收

- protocol 拒绝未知 scope、secret 字段和非 active summary；
- Kernel 证明创建、scope enforcement、撤销、generation 轮换、并发 revoke、重启恢复和 ACL；
- Web 证明 loading/error/empty/non-empty/revoke/reload、Agent 快速切换 stale response、homepage 安全属性；
- desktop 与 `390×844` pointer/keyboard/focus/无溢出；
- 正式 4173 只做只读/已有 grant revoke 的用户授权验收，不凭测试创建真实第三方授权。

当前证据等级是 `R/design`：Raft 可见合同已冻结，本地必要性与边界已审计；没有 `C/A/L/D`，不得宣称 Apps 功能完成。
