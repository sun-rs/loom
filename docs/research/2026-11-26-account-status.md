# 账号状态与额度：各 CLI 的来源（2026-11-26，只读调研，未打开任何凭据）

版本：Claude Code 2.1.331、codex-cli 0.171.0、agy 1.5.17、OpenCode 2.3.0。证据主要来自二进制字符串和本机会话记录，未做实机探测。来源分级：A=CLI 已写出的数据（零成本）；B=官方命令/接口（无模型回合，令牌由 CLI 自己持有）；C=需要令牌（只记录，不做）。

| CLI | A 被动 | B 按需 | 缺口 |
|---|---|---|---|
| Codex | rollout `token_count.payload.rate_limits`：`limit_id`、primary/secondary{`used_percent`,`window_minutes`,`resets_at`}、credits、`plan_type`、`rate_limit_reached_type`；每次模型响应都有。本机样本：pro，周窗口（10080 分钟）已用 58%，5 小时窗口为 null | app-server `account/read`、`account/rateLimits/read`（含 `rateLimitsByLimitId`）、`account/usage/read`；推送 `account/rateLimits/updated`。勿调 `account/rateLimitResetCredit/consume`（改变账号状态） | 当前账号无 5 小时窗口 |
| Claude Code | statusline stdin `rate_limits.five_hour/seven_day{used_percentage,resets_at}`；headless stream-json `rate_limit_event`（status、resetsAt、rateLimitType 含 seven_day_opus/sonnet、utilization）；被拒时 transcript `rate_limit_info` | `claude -p "/usage"`（支持非交互，调用 `/api/oauth/usage`，无模型回合）；`claude auth status --json`（账号/订阅，邮箱需打码） | 被动来源没有按模型的周额度；`~/.claude/settings.json` 的 statusLine 已被 Orca 占用，loom 只能在自己启动的会话里用启动级 `--settings` 套一层透传 |
| agy | 自定义 statusline 载荷 `quota/quotas[]{display_name,used_percentage,reset_time}`、`plan_tier`；`[quota]` 低额度警告、429/RESOURCE_EXHAUSTED | `agy -p "/usage" --output-format json`（也有 `/quota` `/credits`），按模型的 `remainingFraction`、`resetTime`、`refreshWindowLabel` 和 AI credits；changelog 称不开回合、不耗额度、不留会话 | 无本地额度文件，需 statusline 包装；开启 `use_ai_credits` 时耗尽的模型改用 credits 继续 |
| OpenCode | `session.status` retry 事件、`RateLimitError`/`QuotaExhaustedError`/`ExpiredKey`（仅事后） | 本地 server `GET /api/experimental/usage/limits`、TUI `/usage`：仅 OpenCode Go/Console 的 rolling/weekly/monthly | 上游是 Claude/Codex 登录时只有错误里的 retry-after |

loom 现状：只有事后识别（屏幕/失败字符串 → `quota-wait`、`auth-expired`，OAR `rate_limited` → stuck/rate-limit），没有读取上述任何额度字段。

**建议（CELL-ACCT-1）**：①被动快照，零额外请求：loomd 已在读的记录里提取 Codex `rate_limits`、Claude `rate_limit_event`/`rate_limit_info`、loom 启动会话的 statusline 透传（Claude、agy），按 (cli, 账号, plan, limit/bucket) 存最近值和观测时间；②`loom accounts --refresh` 才按需调 B 类（Codex app-server、`claude -p /usage`、`agy -p /usage`、OpenCode usage/limits），不轮询；③显示打码账号、套餐、各窗口已用比例、重置时间、数据新鲜度；旧快照不得覆盖实时的 `quota-wait`/`auth-expired`。
