# Loom Account Usage Protocol v1：调研与设计草案（2026-11-27）

方法：只读调研。读 loom main 与 df31f081 的 ACCOUNTS*.md、2026-11-26-account-status.md、2026-11-27-apikey-balance-deepseek-kimi.md；GitHub 公开源码（API/raw，未克隆、未运行）；本机 Orca.app 1.4.272 的 app.asar 只用只读脚本做字符串检索（未运行、未读凭据）。未修改其他文件。

## 1. 参考实现与许可

| 项目 | 版本/时间 | 许可 | 说明 |
|---|---|---|---|
| CodexBar (steipete/CodexBar) https://github.com/steipete/CodexBar | main，最近 push 2026-11-21；README 称 115 个 provider | MIT（GitHub spdx；LICENSE 徽章一致） | Swift，macOS/Linux；`docs/provider.md`、`docs/cli.md`、`docs/kimi.md`、`docs/deepseek.md` 等逐家文档 |
| T3 Code (pingdotgg/t3code) https://github.com/pingdotgg/t3code | main，2026-11-27 | MIT（T3 Tools Inc.） | TypeScript/Effect Schema；`packages/contracts/src/providerUsageLimits.ts`、`packages/provider-*/src/server/usageLimits.ts` |
| Orca (stablyai/orca) 本机 Orca.app 1.4.272 | 本机 bundle | MIT（GitHub spdx） | 打包后 `out/main/index.js` 压缩代码；内部有 codex/claude/gemini/opencode-go 额度读取 |
| ccusage (ryoppippi) | -- | MIT | 本地 JSONL 成本统计，只做“已花费 token/金额”，无额度窗口 |
| Claude-Code-Usage-Monitor (Maciek-roboblog) | -- | MIT | 同上，Python，按 5h session 块估算，无 provider 协议 |

ccusage / monitor 仅算本地日志成本，不是额度协议，只可借鉴“按 5h block 估算”的思路，价值低。

## 2. 数据模型对比

| 维度 | loom 现状 (schema v1) | CodexBar `UsageSnapshot` | T3 `ServerProviderUsageLimits` | Orca (index.js) |
|---|---|---|---|---|
| 窗口 | `windows[]`{id,label,kind 5h/weekly/model,model,usedPercent,windowMinutes,resetsAt,source,observedAt,stale} | 固定槽 `primary/secondary/tertiary` + `extraRateWindows[]`(NamedRateWindow) ；RateWindow{usedPercent,title,windowMinutes,resetsAt,resetDescription,quotaLimit,quotaUnit,nextRegenPercent,isSyntheticPlaceholder} | `windows[]`{id,kind session/weekly/monthly/other,label,modelIds[],providerIds[],usedPercent 0-100,resetsAt,windowDurationMins}；按 id 稀疏合并 | 固定 `{provider,session,weekly,updatedAt,error,status:'ok'|'error',buckets?,usageMetadata.failureKind}`；窗口={usedPercent,windowMinutes,resetsAt,resetDescription} |
| 绝对额度 | 无 | 有（quotaLimit/quotaUnit，可选） | 无 | 无 |
| 余额/金额 | 无 | `providerCost`、各家专用快照（OpenRouter/DeepSeek 等）、`details[]` 自由分节 | 无（`zeroSpendCap` 布尔） | 无 |
| 套餐/身份 | plan、alias、accountMasked（脱敏） | `identity`{email,org,loginMethod}、`planObservation`、subscriptionExpiresAt/RenewsAt | `UsageLimitSourceAccount`{id,driver,email,plan,workspaceId,models} | 无账号级模型 |
| 重置卡 | resetCredits | codex/grok/claudeResetCredits | `resetCredits`{availableCount,nextExpiresAt,options[]} | 无 |
| 新鲜度/来源 | source、observedAt、stale(2h/重置)、versionStatus | `updatedAt`、`dataConfidence`、fetch strategy(auto/web/cli/oauth/api) | `checkedAt`、`unavailable{unsupported,probeFailed}`；失败保留上次好值 | `updatedAt`、status、failureKind |
| 被动/主动 | 有，被动优先（loom 独有） | 无区分（均为拉取） | 有 push 更新（Codex token tick `ProviderUsageLimitsUpdate`）与全量 probe 两条路 | 拉取 |
| 凭据 | 不读凭据，仅 CLI 自己持有 | 读 Keychain/浏览器 cookie/OAuth token（host API） | 读 auth.json、API key、OAuth | 读 OAuth token 直接请求 chatgpt.com/backend-api/wham/usage、Google quota 接口 |
| 适配器接口 | `daemon/account-refresh/providers.mjs` 内置四家 | `ProviderDescriptor` + `ProviderFetchStrategy[]`（label/URL/默认值/多策略回退）+ `ProviderCredentialAdapter` | 每 provider 包一个 `usageLimits.ts`，产出 `ServerProviderUsageWindow[]`，`makeUsageLimits` 排序 | 每家一个函数返回统一 `{provider,session,weekly...}` |

观察：
1. 三家参考都以“百分比 + 重置时间 + 时长”为核心，与 loom 一致；余额（金额）模型都不统一（CodexBar 靠专用结构与 details，T3/Orca 无）。loom 需自建 balances[]。
2. 只有 T3 有“按 id 稀疏合并 + 失败保留好值”，与 loom compactState 思路一致；只有 loom 有“被动优先于主动”的显式规则。
3. 三家参考都会读 OAuth token 或 cookie 直连厂商接口，违反 loom 的“B 类零模型、不读凭据”边界；其厂商端点逆向知识可借鉴，其凭据读取代码不可搬。

## 3. Loom Account Usage Protocol v1（草案）

### 3.1 记录形状（每账号一条 `AccountUsage`）

```jsonc
{
  "protocol": "loom.account-usage/1",
  "provider": "codex|claude|agy|opencode|deepseek|kimi-open|kimi-code|...",  // 适配器 id，开放枚举
  "kind": "subscription | api-key",
  "account": {
    "alias": "主力 Codex",            // policy 别名，可空
    "masked": "s***@example.com",     // 或 key 末 4 位指纹 "sk-…a1b2"；永不含原文
    "ref": "<opaque hash>",           // 仅 loomd 内部去重；不出公开投影
    "region": "cn|intl|null"          // Kimi/DeepSeek 平台区分，避免 401 误判
  },
  "plan": "Pro|max_5x|go|null",
  "available": true,                   // 能否继续调用：订阅=无 quota-wait/auth-expired；api-key=厂商 is_available / available_balance>0
  "status": "ok|quota-wait|auth-expired|not-signed-in|unsupported|timeout|error|cooldown",
  "windows": [{
    "id": "codex/primary",             // 适配器内稳定
    "label": "5h",
    "period": "5h|daily|weekly|monthly|custom",
    "periodMinutes": 300,              // custom 或精确时长；对应现有 windowMinutes
    "scope": {"models": ["Fable"], "pool": "Claude/GPT"},   // 对应现有 kind=model/model
    "usedRatio": 0.59,                 // 0..1 主字段；厂商只给百分比则 /100
    "used": null, "limit": null, "unit": null,    // 仅当厂商给出绝对值（如 requests/tokens）
    "resetAt": "2026-11-26T16:22:00Z",
    "timeProgress": 0.62,              // 派生：1-(resetAt-now)/period，即现有 pace
    "observedAt": "...", "source": {"kind":"passive|refresh","method":"codex-rollout"}
  }],
  "balances": [{
    "currency": "CNY|USD|credits|tokens",
    "total": "12.30", "granted": "2.00", "toppedUp": "10.30",
    "cash": null, "voucher": null,     // Kimi open：cash/voucher；DeepSeek：granted/toppedUp
    "expiresAt": null                  // gift/voucher 到期（Kimi Code 赠送余额）
  }],
  "extras": {"resetCredits": 3, "expiresAt": "..."},
  "source": {"kind": "passive|refresh", "method": "<adapter-method>"},   // 账号级最新
  "observedAt": "...", "staleAfter": "2026-11-26T15:56:00Z",
  "versionVerified": true,            // 对应 versionStatus != unverified
  "diagnostics": [{"code":"unverified-version|unsupported-version-shape|usage-unavailable|wrong-platform","detail":"..."}]
}
```

规则：金额一律字符串（DeepSeek 原样；Kimi 数字转十进制字符串，避免浮点）；零值必须保留；时间一律带时区 ISO 8601；订阅 `balances` 通常为空，api-key 的 `windows` 通常为空（并发限流不是用量窗口，不建模，只在 diagnostics 提示），Kimi Code 订阅同时属于 `kind=subscription` 但认证为 key（见 3.3）。`staleAfter`：窗口取 min(observedAt+2h, resetAt)；余额取 observedAt+TTL（建议 30 min，api-key 仅按需/低频刷新）。

### 3.2 适配器接口

```ts
interface UsageAdapter {
  id: string; kind: 'subscription'|'api-key';
  capabilities: { passive: boolean; refresh: boolean; windows: boolean; balances: boolean; absolute: boolean };
  credential: 'none-cli-owned' | 'keychain-ref';       // 见 3.3
  verifiedVersions?: string[];                          // 白名单，未命中=unverified
  passive?(evidence: SessionEvidence): Observation[] ;  // 纯函数：只解析 loom 已读到的记录/statusline，零额外请求
  refresh?(ctx: { signal, now, resolveSecret(ref), exec(bin,args) }): Promise<Observation[] | Failure>;
  mask(raw): MaskedIdentity;                            // 统一脱敏，适配器不得输出原文
}
```
Observation 即上述记录的一个切片（identity + windows/balances + method + observedAt），由 loomd 合并，适配器不落盘。Failure 用现有 `status/reason` 词表。

### 3.3 安全边界
- 订阅类（codex/claude/agy/opencode）：`credential: none-cli-owned`。令牌始终由原生 CLI 持有，loom 不读 auth.json/Keychain/OAuth token，只调零模型只读命令（codex app-server RPC、`agy -p /usage`、opencode usage/limits、`claude -p /usage`）并保留 `num_turns==0` 等零模型守卫。
- Claude refresh 只经 CCP 之外？按本任务约定：Claude 刷新只允许通过 `/Users/sun/.local/bin/claude`（CCP 入口）；`daemon/executables.mjs` 的路径白名单据此调整（注意：现有 df31f081 文档写的是“强拒 CCP”，二者需 Super 裁定后统一，见 §6 待决）。
- API-key 类（deepseek、kimi-open、kimi-code）：唯一允许持有 API key 的适配器类别；key 只以 keychain 引用存放（如 `keychain:loom-usage-deepseek`），`resolveSecret(ref)` 在 refresh 调用瞬间取出、只放进 `Authorization` 头，不入日志/快照/环境变量/子进程参数；公开投影只给末 4 位指纹。只允许对白名单主机发 GET（api.deepseek.com、api.moonshot.cn/.ai、api.kimi.com/.ai），禁止重定向到其他主机，区分 region 不跨平台试 key。
- 任何适配器不得读取 OAuth token；不得抓浏览器 cookie（CodexBar/Orca 的 cookie/token 路线明确排除）。
- Kimi Code 的 `/coding/v1/usages` 是社区文档化端点（非官方），标 `versionVerified:false` 并带 diagnostics，used_ratio 恒 0 的已知问题需在适配器内判为 `usage-unavailable` 而非 0%。

### 3.4 合并规则
1. 键：`(provider, canonicalAccountKey, window.id)`；账号键沿用现有 `ref → masked → default/唯一活跃` 规则；api-key 账号以 key 指纹（hash）为 ref，同一 key 多次刷新只一行。
2. 同一窗口、同一重置周期内：被动（passive）新鲜观测 > 主动（refresh）；被动过期（>staleAfter）后回退到保留的 refresh 快照（沿用 `refresh_fallbacks`）。余额无被动源，仅 refresh。
3. 跨 source 同优先级：实时故障（quota-wait/auth-expired）> 有效 usedRatio > 较晚 resetAt > 较新 observedAt（现有 `pickBetterWindow`）。
4. 稀疏更新（借 T3）：Observation 只覆盖其出现的 window id；缺席的窗口保持原值直到 staleAfter；失败（timeout/error）保留上次好值并附 diagnostics，不清零。
5. 活跃 quota-wait / auth-expired 不被普通刷新或旧快照覆盖，仅 recovered 事件或到期恢复。
6. 对账互验：同时有百分比与绝对值时，重置时间差 ≤2 s 且时长一致才合并取更耗尽者（借 CodexBar Kimi 规则）。

### 3.5 现有字段映射
| 现有 | v1 |
|---|---|
| cli | provider |
| alias / accountMasked / account_ref | account.alias / account.masked / account.ref(内部) |
| plan | plan |
| windows[].usedPercent (0-100) | usedRatio = /100；remainingPercent 为派生，不存 |
| windowMinutes, kind(5h/weekly/model), model | periodMinutes + period；period=custom 或 scope 承接 model |
| resetsAt | resetAt |
| pace (展示用) | timeProgress（升格为协议派生字段） |
| source 字符串 (codex-rollout / codex-app-server...) | source.kind(passive/refresh) + source.method（沿用原字符串） |
| observedAt, stale(2h/reset) | observedAt, staleAfter（显式化） |
| versionStatus=unverified, cliVersion | versionVerified=false + diagnostics |
| status, unknownReason | status + diagnostics[]（unknownReason 为展示层文案，不入协议） |
| resetCredits(+Evidence), expiresAt | extras.resetCredits, extras.expiresAt |
| 无 | kind、available、balances[]、region、used/limit/unit、staleAfter（新增） |
v1 根 `version:1` 可保持；新字段均为可选追加，旧展示端可忽略，`windows[]` 向后兼容只需在投影层 `usedPercent=usedRatio*100`。

## 4. 可复制 vs 仅借鉴

许可均为 MIT，与 loom 兼容；复制需保留版权声明并在 SOURCES.md 登记。

可直接复制/移植（带出处）：
- T3 `packages/contracts/src/providerUsageLimits.ts` 的窗口 schema 与 `applyUsageLimitsUpdate`（按 id 稀疏合并，约 60 行）——但它依赖 Effect Schema，loom 为 .mjs，建议“按其语义改写成手写校验”，而不是搬代码；`clampPercent`、`kindForDuration`(5h/7d/30d 阈值)、codex `primary/secondary` 无时长时按套餐回退（free/go=月，其余 5h/周）这类小函数可原样移植。
- T3 `codexUsageLimits.ts` 对 `rateLimitsByLimitId` 的处理（`limitId!=="codex"` 的模型级窗口不进主行）：与我们 `Claude/GPT` 池逻辑互补，可参考移植。
- CodexBar `docs/deepseek.md`、`docs/kimi.md`、`docs/moonshot.md` 的端点/字段/区域规则（文档，MIT，可引用）；Kimi 的“count 与 ratio 同周期（±2s）取更耗尽者”规则。

只借鉴思想（不复制代码）：
- CodexBar `ProviderDescriptor` + `FetchStrategy` 多策略回退、`ProviderCredentialAdapter` 分层、`dataConfidence`、`isSyntheticPlaceholder`（Claude 无 5h 时不得伪造 0%：loom 也应遵守）、`provider.md` 的“身份字段按 provider 隔离”原则。其 Swift 代码与 UI 不能直接用。
- Orca：仅三类端点知识（chatgpt wham/usage、Gemini retrieveUserQuota）可知，但它们需要 OAuth token，loom 禁用；窗口模型本身（固定 session/weekly）比 loom 粗，不值得参考。
- T3 的 `UsageLimitSource`（HTTP 配额账号）适合“多账号路由”场景，loom 暂无此需求。
- ccusage / monitor：仅成本估算，另议（属 cost 面板，非本协议）。

不可复制：任何读取 auth.json / Keychain / cookie / OAuth token 的代码（CodexBar 浏览器 cookie 导入、T3 provider-opencode 的 auth 文件与 sqlite 读取、Orca 的 token 直连请求）。

## 5. 落地建议（最小步骤）
1. 先文档：把 §3 写入 ACCOUNTS-SCHEMA（version 仍 1，新增字段可选）。
2. 抽 `adapters/accounts/<id>.mjs` 统一接口，把现有四家 passive/refresh 逻辑原样挂入，行为零变化。
3. 新增 api-key 适配器 deepseek、kimi-open（官方文档明确）；kimi-code 最后（非官方端点，标 unverified）。
4. keychain 引用与白名单主机放在公共 `resolveSecret/httpGet` 中，适配器无法绕过。
5. 不新增模型请求：api-key 余额接口为只读 GET，沿用现有 15 分钟陈旧阈值、singleflight、指数退避与文件锁。

## 6. 待决 / 未验证
- Claude 可执行路径：本任务要求“Claude refresh 只经 CCP /Users/sun/.local/bin/claude”，而 df31f081 文档 §6.2 写的是“强拒 CCP、仅原生 versions 目录”。两者相反，需 Super 裁定（本文未触碰 /Users/sun/Code/ccp）。
- DeepSeek 余额端点的 base URL/鉴权头来自通用约定，余额页本身未写（见 2026-11-27-apikey-balance-deepseek-kimi.md）；Kimi chat 端点的 x-ratelimit-* 头未验证。
- 未实测任何 api-key 端点；CodexBar 的 provider 数量(115)来自其 README，未逐一核对。
- Orca 结论基于压缩后 JS 片段，未逐行通读。


## Super 裁定（2026-11-27）
草案里提到的冲突已有用户裁决：Claude 刷新**只经 CCP 入口 /Users/sun/.local/bin/claude**（"不允许脱离 ccp 保护的 claudecode 调用"）。df31f081 的 ACCOUNTS-SCHEMA §6.2"强拒 CCP"是旧规定（C4），已作废，随 CCP-ROUTE-1 与目标 4 收尾一并改正。
