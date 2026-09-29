# Sonnet/low 真实复验（2026-09-29）

结论：**仍被 Claude Code 组织订阅策略阻塞，未通过。** 用户确认 Sonnet 可用后，将验收脚本改为 `sonnet / low`，新建独立 Role `e2e-claude-sonnet`，不修改旧 Haiku Role/实例。Codex 保持 `gpt-6-luna / low`，旧验收 Role 的 Offer 已失效，另建 `e2e-codex-0929` 避免改动历史配置。两处配置更改均先红测再修改，验收库 28 项测试通过。

- 新频道：`room_f1421840-830e-4201-853d-c78270de5ee8`，验收 stamp `20260929T021510Z`。
- 启动 `real-e2e.mjs --paid --until 8 --max-runs 20`，旧 Codex Offer 不匹配在付费前中止。换独立验收 Role 后，从步骤 3 恢复；进入步骤 4，Human 消息 #6。
- 三次 Claude Placement 都明确为 `local:claude-cli/v1:sonnet`、reasoning=`low`，无模型替代。均返回 `Your organization has disabled Claude subscription access for Claude Code`，在事件 #42 被三次同错围栏隔离；没有 Claude 回复或 token 用量帧，不能把缺失用量记作零。
- Codex 首轮因 `activation delivery is not acknowledged through sequence 6` 被重试，第二轮完成；两次运行累计 7 条生成用量记录、94,956 输入、74,240 缓存输入、20,716 未缓存输入、705 输出，只发出一条频道回复。首轮 ACK 缺失需要后续追查，不是已处理后续通知的重复唤醒场景。
- 脚本等待缺失回复会持续 15 分钟；确认本频道没有活跃运行后，已停止本次验收观察进程，未终止正式 daemon，未继续私聊/记忆/重启步骤。保留隔离记录与 session，不擅自重试或重建。
- 免费 `claude auth status` 显示已登录、oauth_token、firstParty。终端与 launchd plist 均没有显式的 CLAUDE_CONFIG_DIR/CLAUDE_CODE_OAUTH_TOKEN/ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN/ANTHROPIC_BASE_URL 覆盖。此证据不足以证明服务与用户交互会话使用完全相同的有效凭据，亦不代表实际推理权限可用；未读取或改写凭据值。

日志：`/tmp/loom-sonnet-e2e.log`、`/tmp/loom-sonnet-e2e-continue.log`。原始持久验收状态：`~/.loom/acceptance/state/20260929T021510Z.json`（脚本在步骤 4 观察阶段被停止，不能当完整报告）。本报告依据正式库只读查询补充真实结果。

本次仅改验收配置与测试、文档，没有改产品源码、重启服务、提交或推送。UI 浏览器阻塞仍独立存在；不是端到端 UI 验收通过。
