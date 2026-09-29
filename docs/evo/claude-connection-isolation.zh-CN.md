# Claude 连接配置与个人行为配置分离

2026-09-29，负责人同意修复 Loom 隔离全局配置时误丢 CLI 认证/路由的问题。

## 设计与所有者

AgentHost 的 Claude driver 是唯一所有者。冷、热 driver 在真正 spawn Claude 子进程前共用 `claudeConnectionEnvironment`，不改 Kernel、Role、session key、CLI 账号或用户文件。继续传 `--setting-sources project,local`、`--strict-mcp-config` 和已有强制关闭项。

仅读取 `CLAUDE_CONFIG_DIR/settings.json`，未指定时读取 `HOME/.claude/settings.json` 中的 env 白名单：

- 连接组：ANTHROPIC_API_KEY、ANTHROPIC_AUTH_TOKEN、ANTHROPIC_BASE_URL。
- 别名：ANTHROPIC_DEFAULT_SONNET_MODEL、ANTHROPIC_DEFAULT_HAIKU_MODEL、ANTHROPIC_DEFAULT_OPUS_MODEL，供显式模型别名按用户已配置的网关映射解析。

不读取 ANTHROPIC_MODEL、effort、hooks、plugins、skills、permissions，不执行 apiKeyHelper，不导入整份 env。显式进程环境优先；任一连接键或 CLAUDE_CODE_OAUTH_TOKEN 已存在（包括显式空值）时，不再从文件拼入整个连接组，避免把文件里的密钥发到另一份配置的地址。别名逐键遵循显式值优先。托管的模型/effort 参数仍由 Role 决定，实际模型仍需运行证据核对。

密钥只出现在 Claude 子进程环境，不加入 argv、启动回执、Loom 配置库或 session 摘要。解析错误不包含原文、路径或凭据；缺文件保留原登录路径，存在但无法读取/解析时失败而不是静默切换身份。此机制不是 OS 沙箱，CLI 与工具仍按现有同 UID 权限运行。

冷启动每次重新读取；常驻进程仅在启动时读取，用户变更连接设置后需等其退出/重建，不实现轮中换账号。现有 Claude 常驻默认关闭。只支持这里列出的直接环境配置；helper、Bedrock/Vertex 等不在本次窄修范围，未宣称全渠道兼容。

## 依据与差异

- [Claude 官方设置来源与优先级](https://code.claude.com/docs/en/settings)：用户 settings.json 与项目/local 来源不同，CLAUDE_CONFIG_DIR 可改变配置目录。
- [Claude 官方模型配置](https://code.claude.com/docs/en/model-config)：默认模型别名映射与显式模型选择是不同设置。
- Loom 既有 `provider-launch-arguments.js` 的个人配置隔离策略会连 settings.json.env 一起排除。本次是经负责人批准的本地适配修复，不宣称是 Raft/Multica 源码移植；不撤销先前对 hooks/MCP 的隔离。

## 验证

先以两个真实 driver + 假 Claude executable 复现 env 丢失，再实现共用读取；冷/热接线、允许键、禁止键、显式源不混密钥、空覆盖、坏文件错误脱敏、凭据轮换共 5 项新测试。与 provider 启动规则合跑 13 项通过；验收 Sonnet 配置库 28 项通过。完整检查、真实调用和部署结果随后记入 status；未通过前不宣称正式修复验收完成。

修复后的隔离原生探针已成功：`sonnet / low` 返回 OK，CLI 报告实际模型 `claude-sonnet-5`、1 次生成、输入 4,623（其中缓存创建 4,621）、输出 4，报告费用 $0.0115965。只用于连接验证，不是业务或效率门禁；原始结果保存在 `/tmp/loom-auth-sonnet-probe.json`（本机私有）。

完整 `npm run check` 已通过：核心 2,687 通过、22 跳过，Web 481、控制台 59、效率门禁单测 235 等均零失败；格式与 diff 检查通过。正式 4176 已在空闲检查与验证备份后重启，schema 79 不变；重启前后消息、运行记录、session 绑定及 Role/实例配置共 7 张业务表内容哈希一致，旧暂停/隔离工作未恢复。

正式业务验证**未通过**：专用频道 `room_d50709d7-4abd-4026-b3a9-800be44cb4b3` 的 Sonnet/low 首轮不再出现订阅拒绝，但模型请求阶段未返回回复或用量，在 Human 消息发出 180 秒后经 SOS 安全停止；账本 RunAttempt 为 cancelled，确认没有继续运行。计划中的第二轮续聊未发送。初次只看 Loom 轨迹未定位原因；后续原生日志核查如下。原始本机记录 `/tmp/loom-auth-formal-evidence.json`，没有 token 帧，费用未知，不记作零。

浏览器管理策略校验仍不可用，正式页面未完成验收。未提交、未推送，未更改用户 Claude 配置或凭据。

## P50 超时继续定位

原生 Claude 2.1.284 session JSONL 确认：03:18:42.208Z 至 03:20:50.684Z 连续 9 条 `system/api_error`，均为 HTTP 502 `Upstream service temporarily unavailable`，`source=request_retry`、`maxRetries=10`。退避从 608 ms 增至最后 38,940 ms；最后一次等待未结束即被 Human SOS 中止。此前口头提及 8 次是初步计数，完整逐条提取为 9 次。见[脱敏重试证据](evidence/2026-09-29-sonnet-upstream-retries.json)。

时间拆分：Human 发消息约 03:18:06，RunAttempt 启动 03:18:36.923，模型请求状态 03:18:37.569；03:21:18.134 取消结束。约 30 秒启动前等待与随后上游失败/CLI 退避是两件独立问题。这轮没有 assistant 回复、工具回帖或用量收据，不能把无用量当成零费用，也不是已生成答案但 Loom 丢失回帖的证据。

诊断可见性缺口：`provider-trajectory-normalizer.js` 的 `normalizeClaudeTrajectoryEvent` 在 system 分支仅处理 init、压缩和 requesting，其余返回空数组；即使 stream-json 发出 api_error，也不会进入当前轨迹。此运行未保存原始 stdout，原生 JSONL 有错误并不证明同样帧实际出现在 stdout，因此后续应先用本地假上游、真实 CLI 的免费探针确认输出渠道，再决定最小诊断适配，不能直接断言都是转换器丢帧。

P49 无工具原生探针约 7 秒成功、P50 完整工具/常驻指令/stream-json 请求失败，只能证明两次结果不同；不能从 502 本身判定临时网关故障、请求形状兼容性或服务商限流。若继续追最深层原因，应固定同一模型/连接配置，逐项对照 stream-json、工具与正式上下文，并核对上游请求日志。本次定位只读既有证据，没有增加付费调用、修改运行代码或重启服务。
