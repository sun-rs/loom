# Raft Managed MCP 产品监督基线

**2026-09-08 范围变更：本文托管 MCP 部分已由[用户退役决定](./managed-mcp-retirement.zh-CN.md)取代，仅保留历史设计证据，不再是当前实施要求。Agent 非 MCP 页签的导航与身份不变量继续适用。**

状态：**Active / first canonical RAH slice implemented**（2026-08-28）。

本文记录已登录 Raft 官方 Web 的只读实操证据，并把它转换成 RAH OS 的 owner、协议和浏览器验收约束。页面文案和可见状态可以监督产品；Raft 未公开的 Server 事务、secret storage 和 OAuth 实现不能由 DOM 推断成源码事实。

## 1. 2026-08-28 live Raft 证据

在 `https://app.raft.build/s/hakasemac` 的现有已登录会话中，只做导航、展开和 computed-style 读取，没有保存、授权、创建或删除外部连接。

### 1.1 页面归属

- Agent 详情的 `MCP` tab 是**使用记录**：标题为“MCP 使用记录”，说明“已启用的 MCP 服务器会自动可用；此 Agent 调用后会显示在这里”。空状态不提供配置按钮。
- Workspace 级目录位于 `设置 → MCP 服务器`。页面说明它配置当前 Raft Server 的 MCP 目录、凭据和 provider connection。
- 因此 RAH OS 不能把 MCP Server secret/config owner 放入 Agent profile。Kernel 持有 versioned Server catalog 和 Agent assignment；Agent 页面只显示 canonical usage/audit projection。

### 1.2 目录与创建流程

空目录包含：

- 标题、服务器计数、`添加服务器`；
- “暂无托管 MCP 服务器”空状态；
- 推荐集成 `Notion`、`Linear`，各有描述和 `添加`；
- 自定义创建 dialog。

自定义 dialog 的可观察字段与状态：

1. `提供方`：自定义 / Notion / Linear；
2. `身份验证`：无 / 凭据请求头 / OAuth；
3. `名称`；
4. `MCP 服务器 URL`；
5. 可选描述；
6. `测试连接` 在必要字段不足时 disabled；
7. `取消` / `保存`。

Notion 推荐项会预填 provider、OAuth、名称、URL 和描述，并禁用 OAuth 类型与 URL 编辑；页面明确表示保存后再执行连接授权。此行为证明 Raft product surface 有 provider preset 和 OAuth lifecycle，但不证明 token 刷新或 Server secret 的内部实现。

### 1.3 Agent Runtime 配置的相邻边界

Agent `资料 → 编辑运行时配置` 另行管理 Runtime、model、reasoning、fast mode 和 advanced environment variables。它与 MCP Server catalog 是两个页面、两个 owner；环境变量展开会推动 dialog 内容而非覆盖下方区域。

### 1.4 本轮提取的几何

- 页面标题：Space Grotesk，16px/20px，700；
- 页面说明：12px/16px，black 60%；
- 小 brutal button：28px 高、2px 黑边、2px 右下 shadow；
- MCP create card：672px 宽，24px padding、2px 黑边、4px 右下 shadow；
- overlay：black 60%；
- form 内容宽 620px。

这些值来自 live DOM/computed style；生产组件仍只消费 RAH-owned CSS/token，不导入 Raft 业务 bundle。

## 2. RAH OS owner 映射

```text
daemon config + SecretProvider
  -> executorRef / transport / owner-private credential
  -> Managed MCP administration port (list + tools/list discovery)

Workspace control Room
  -> versioned MCP Server definition
  -> versioned Agent assignment + explicit tool allowlist
  -> canonical Room event / sequence / idempotency

Activation-scoped Worker
  -> version-fenced catalog
  -> local runtime MCP proxy
  -> exact executor call
```

- `Kernel`：Server/assignment revision、enabled state、ACL、Room event 和 stale-context fence；
- `daemon`：实际 Streamable HTTP client、redirect/URL policy、SecretProvider、timeout 和 result normalization；
- `AgentHost`：按 Provider adapter 注入本机 MCP proxy，native-name collision fail closed；
- `RahClient`：唯一 Human UI transport；
- `apps/web`：表单、loading/error/disabled/focus 状态和 canonical projection，不保存 bearer、URL 或 Server truth。

## 3. 当前已实现

- Kernel schema v12 durable Server/assignment record、immutable revision、enable/disable、causal/idempotent Room event；
- Human Client API 与 typed SDK 的 executor list/discover、Server list/create/revise/state、assignment list/create/revise/state；
- daemon 的真实 official MCP v2 Streamable HTTP client、HTTPS/loopback policy、file/Keychain-compatible SecretProvider reference 和 bounded call；
- Worker catalog/call、runtime proxy、Claude/Codex/Kimi/OpenCode 注入与 version fencing；
- `设置 → MCP 服务器`：真实 executor inventory、`tools/list` 测试连接、Server create/edit/enable/disable、Agent tool allowlist create/edit/enable/disable；
- control Room 最新 sequence barrier、idempotency key、owner/admin + capability 双重 UI gate；
- Agent `MCP` tab 查询 Kernel 持久化的有界调用审计，显示历史 Server 名称、tool、Room、Run、时间和终态；arguments、credential、result body 不进入 Client DTO；
- settings/Agent/Computer surface 不再保留 Chat Room sidebar；
- desktop 与 390×844 共享同一 React/RahClient 行为。

## 4. 明确未完成

- 本机 Core 现在从已初始化 state 目录的 `managed-mcp.json` 读取 schemaVersion 1 / executors；复用 daemon 配置校验和 owner-private SecretProvider，缺文件为无 executor，非法文件拒绝启动。配置随 state 备份，重启生效。浏览器仍不能编辑 URL/secret 或 OAuth connection；具体操作见产品内本机指南。
- Notion/Linear preset、OAuth redirect/refresh/revoke、credential rotation UI 未实现；
- MCP Server hard delete 未实现；当前只支持保留 provenance 的 soft disable；
- Human Web/PWA 的 HTTPS LAN pairing edge 已落地；证书自动管理、通用 rate limit 和远程 Computer executor routing 尚未收口。

这些差异必须在 capability matrix 中保持可见；“设置页能创建目录”不等于已经与 Raft 的 OAuth 管理 100% 等价。

## 5. 自动门禁

`npm run test:web:browser` 会启动隔离 daemon、owner-private bearer file、真实 official MCP Streamable HTTP fixture 和两个 Fake Agent Runtime，并在真实 Chrome 中验证：

```text
Settings
  -> executor inventory
  -> tools/list discovery
  -> canonical Server create
  -> Agent assignment create
  -> assignment disable
  -> return to Room
Agent
  -> MCP usage projection empty state
  -> confirm arguments/credentials/results exclusion notice
  -> 390×844 Settings 无横向 overflow
```

同一门禁还检查非 Room surface 不渲染 Chat sidebar。它不调用付费 Provider，也不触碰用户 live daemon 或官方 Raft 账户。
