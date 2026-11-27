# 调研资料索引

每份调研都写明了日期。产品版本、默认值和价格变化很快，引用前请先核对日期和版本，过时的内容应重新核实，不要直接沿用。

| 日期 | 主题 | 文件或位置 |
|---|---|---|
| 2026-11-25 | AML 记忆排行榜、MemoraX 与开源冠军 | [2026-11-25-aml-memorax.md](2026-11-25-aml-memorax.md) |
| 2026-11-25 | 记忆系统：单机、跨机，以及各 CLI 原生记忆的关闭方式 | [2026-11-25-memory-systems.md](2026-11-25-memory-systems.md) |
| 2026-11-27 | cell 隔离与部署选型 | [2026-11-27-cell-isolation.md](2026-11-27-cell-isolation.md) |
| 2026-11-26 | skill 拆分 | [2026-11-26-skill-split.md](2026-11-26-skill-split.md) |
| 2026-11-26 | 长期角色换班时机 | [2026-11-26-senior-rotation.md](2026-11-26-senior-rotation.md) |
| 2026-11-26 | worker 寿命：前辈经验与 pilot 实测 | [2026-11-26-worker-lifespan.md](2026-11-26-worker-lifespan.md) |
| 2026-11-26 | 用确定性检查替代对抗式 review | [2026-11-26-verification-over-review.md](2026-11-26-verification-over-review.md) |
| 2026-11-26 | a11y、get-selected-text、wterm | [2026-11-26-a11y.md](2026-11-26-a11y.md) |
| 2026-11-26 | Status TUI 产品化 | [2026-11-26-status-tui.md](2026-11-26-status-tui.md) |
| 2026-11-26 | 账号状态与额度来源 | [2026-11-26-account-status.md](2026-11-26-account-status.md) |
| 2026-11-26 | Claude Code Code Mode | [2026-11-26-code-mode.md](2026-11-26-code-mode.md) |
| 2026-11-25 | 热升级：hc/Herdr、Orca 的做法，loom 现状与计划 | [2026-11-25-hot-upgrade.md](2026-11-25-hot-upgrade.md) |
| 2026-11-25 | Paseo 如何驱动多个 CLI provider | [2026-11-25-paseo.md](2026-11-25-paseo.md) |
| 2026-11-25 | 无头 Claude 的计费与条款：claude -p、OAR、Agent SDK | [2026-11-25-claude-headless-billing.md](2026-11-25-claude-headless-billing.md) |
| 2026-11-25 | 多 CLI 编排应用的故障处理（claude-squad、vibe-kanban、t3code 等） | [2026-11-25-aggregators.md](2026-11-25-aggregators.md) |
| 2026-11-25 | 组织结构、成本与 pilot-1 复盘 | [2026-11-25-org-cost-pilot.md](2026-11-25-org-cost-pilot.md) |
| 2026-11-24 | 外部编排产品：Devin、agy、Claude projects 等 | [tasks/RESEARCH-ORCH-0/RESULT.md](../../tasks/RESEARCH-ORCH-0/RESULT.md) |
| 2026-11-24 | 各家提示缓存的存活时间；保活是否划算 | [tasks/CACHE-TTL-0/RESULT.md](../../tasks/CACHE-TTL-0/RESULT.md) |
| 2026-11-24 | 成本主要由请求次数决定 | [tasks/COST-REQ-0/RESULT.md](../../tasks/COST-REQ-0/RESULT.md) |
| 2026-11-24 | L1 机械摘要评估 | [tasks/L1-EVAL-0/RESULT.md](../../tasks/L1-EVAL-0/RESULT.md) |
| 2026-11-24 | 热升级初查：hc、Herdr、Orca | [tasks/HOTSWAP-0/RESULT.md](../../tasks/HOTSWAP-0/RESULT.md) |
| 2026-11-24 | Orca TUI 调度体系复刻 | [tasks/TUI-ORCA-1/RESULT.md](../../tasks/TUI-ORCA-1/RESULT.md) |
- [2026-11-27 cell 容器与沙箱项目调研](2026-11-27-cell-container-projects.md) — srt/bwrap/Seatbelt/Podman/sbx/apple container/Claude-Cage 等，含维护证据
- [2026-11-27 cell 底层 PK：Podman / Docker / srt / blackwall](2026-11-27-cell-substrate-pk.md) — 含“容器包 srt”核查与组合判定
- [2026-11-27 启动与恢复流程设计（草案）](2026-11-27-lifecycle-design.md) — L1 全局只管 Super，Super 决定项目恢复；待用户决定 Super 由什么管理
- [2026-11-27 Orca bot 会话连续性](2026-11-27-orca-bot-session-continuity.md) — 默认新开+带上限播种，原生续接默认关、只提供给用户选
- [2026-11-27 Claude 出网硬保证](2026-11-27-claude-egress-guarantee.md) — Mac 上用 Seatbelt 只放行 127.0.0.1:17891 是最便宜的内核级保证；pf 需专用用户、VPN 进程规则会 fail-open
- [2026-11-27 DeepSeek / Kimi API key 余额查询](2026-11-27-apikey-balance-deepseek-kimi.md) — DeepSeek GET /user/balance、Kimi GET /v1/users/me/balance（只有金额）；Kimi Code 订阅 /coding/v1/usages（5h/7d 比例，社区资料）
- [2026-11-27 账号用量协议 v1 草案](2026-11-27-account-usage-protocol.md) — loom.account-usage/1：windows[]+balances[]、适配器接口、被动优先合并；参考 T3/CodexBar/Orca（均 MIT）
- [2026-11-27 cc-switch / Magpie 如何切换 Codex 账号](2026-11-27-account-switch-ccswitch-magpie.md) — 两者都经手并覆盖 auth.json（cc-switch 明文多副本，已有 refresh_token_reused 事故）；不持有 token 的替代：每账号一个 CODEX_HOME
- [2026-11-27 智能体身份与指令遵循：他人做法](2026-11-27-agent-identity-adherence.md) — Orca 哈希版本化规则+替换声明、live block 数据非指令、格式靠代码校验、压缩后重发核心；漂移文献
