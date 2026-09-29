# Claude 全新 session 与认证配置差异

2026-09-29，用户建议关闭旧 session 后重新创建，授权继续 Sonnet/low 验证。

## 结果

- 新建专用频道 `room_26545f1d-41c4-43e6-b320-dc27e21df12a` 和全新实例，沿用 Sonnet/low 验收 Role；没有使用前次实例/session。首次运行仍返回组织禁用 Claude Code 订阅错误，故不能归因于旧 session。
- 随后通过 room.sos.stop 暂停这个测试频道，保留排队记录和原始错误，阻止继续自动重试；共发生 2 次已退出运行，没有回复。旧频道与正式 daemon 未改。
- 当前终端直接 `claude -p --model sonnet --effort low --tools '' --no-session-persistence --output-format json` 请求仅回复 OK，约三分钟未返回最终结果后停止本次探针；没有 token/费用回执，不能声称原生成功或零费用。

## 确认的配置差异

`~/.claude/settings.json` 存在 ANTHROPIC_AUTH_TOKEN、ANTHROPIC_BASE_URL，以及模型别名映射。仅检查键名及模型名，未输出令牌或地址。终端原生探针明确警告有其他认证源优先于 claude.ai 登录。

Loom 的 `packages/agent-host/src/provider-launch-arguments.js:204` 注释与 218 行参数明确使用 `--setting-sources project,local`，不读取用户 settings.json 的 env；因此全局 API 路由/认证设置与 hooks 等一起被隔离。免费 auth status 的 OAuth 已登录状态不能证明 Loom 与用户终端使用同一认证来源。

这是确定的认证配置来源差异；尚不能仅靠它判定用户自定义端点当前的可用性，也未将它作为自动导入密钥、关闭隔离或改账户的授权。后续需将明确批准的 CLI 认证/路由与个人 hooks/skills 等隔离策略分开处理，而不是反复重建 session。

证据：`/tmp/loom-sonnet-fresh.json`、正式频道账本、`/tmp/loom-sonnet-native-fresh.stderr`（只有认证来源警告）、空的原生结果文件。未修改产品代码、凭据、服务配置；UI 验收与完整业务验收仍未通过。
