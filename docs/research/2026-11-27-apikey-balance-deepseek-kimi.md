# API key balance/quota query: DeepSeek and Kimi (2026-11-27)

Method: web docs only, no real-key calls. Fetched 2026-11-27.

## DeepSeek
- GET https://api.deepseek.com/user/balance, header `Authorization: Bearer <key>` (base URL/auth per general DeepSeek API convention; the balance page itself omits them [unverified on that page]).
- Response: `is_available` (bool), `balance_infos[]` {`currency` CNY|USD, `total_balance`, `granted_balance` (unexpired granted), `topped_up_balance`} - all amounts are strings.
- Money balance only. No token quota endpoint.
- Rate limit: concurrency-based per ACCOUNT (not per key): 2500 concurrent for deepseek-flash, 500 for deepseek-v4-pro; excess -> HTTP 429. Docs mention no x-ratelimit-* headers [none documented].
- Read-only GET, free [no charge stated; presumed].
- Sources: https://api-docs.deepseek.com/api/get-user-balance ; https://api-docs.deepseek.com/quick_start/rate_limit

## Kimi / Moonshot open platform (pay-as-you-go)
- GET /v1/users/me/balance, `Authorization: Bearer $MOONSHOT_API_KEY`.
- China: https://api.moonshot.cn (platform.kimi.com), CNY. International: https://api.moonshot.ai (platform.kimi.ai), USD. Keys of the two platforms are independent; wrong platform -> 401. (platform.moonshot.cn/.ai docs 301 to platform.kimi.com/.ai.)
- Response: `{code:0, data:{available_balance, voucher_balance, cash_balance}, scode, status}`; numbers (not strings). available = cash + voucher; <=0 blocks inference (exceeded_current_quota_error); cash may be negative (overdue).
- Money only; no token quota in this endpoint. Rate-limit tiers (concurrency/RPM/TPM/TPD) depend on cumulative recharge. x-ratelimit-* headers are documented only for web-search endpoints (/v1/tools/search, search_pro) on 429; for chat endpoints [unverified].
- Read-only, free [presumed].
- Sources: https://platform.kimi.ai/docs/api/balance ; https://platform.kimi.com/docs/api/balance ; https://platform.kimi.ai/docs/pricing/limits

## Kimi Code plan (subscription, kimi-for-coding)
- Separate key (`sk-kimi-...`, from Kimi Code Console), NOT interchangeable with open-platform keys.
- Community-documented (not official API docs) endpoint: GET https://api.kimi.com/coding/v1/usages with Bearer key. Response `{usages:{limit_5h:{used_ratio, reset_time}, limit_7d:{...}}}` (ratios 0-1, ISO UTC reset). Global host api.kimi.ai/coding/v1 [unverified]. Monthly pool (monthTotal/monthCode) NOT in cloud endpoint; only in local daemon GET /api/v1/oauth/usage (kimi web + OAuth). Reports of used_ratio stuck at 0 (issues #3908, #3951) - unreliable [per GitHub issues].
- Ratio only, no absolute token counts. Official docs: https://www.kimi.com/code/docs/en/kimi-code-cli/reference/server-api.html (local server API) [not fetched].
- Sources: https://github.com/MoonshotAI/kimi-code/issues/4046 ; https://github.com/steipete/CodexBar/blob/main/docs/kimi.md ; https://www.kimi.com/en/help/kimi-code/membership-guide
