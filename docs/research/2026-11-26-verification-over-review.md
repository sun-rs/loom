# 用确定性检查替代对抗式 review（poteto / Lauren Tan），2026-11-26

身份：Lauren Tan（X @poteto，React Compiler 核心成员）。原推文因 X 返回 402 未能直接读取，以下多为二手转述。
- 2026-11-03 推文（转述，来源 aicoder.com 新闻与 x.com/AGTPinsights）：不跑代码、不用确定性检查器的读码式对抗 review 大多浪费 token，agent 容易陷入挑刺和 YAGNI；token 应花在运行时验证和形式化验证上；她在自己的 pstack 里减少使用 "interrogate" skill。
- 2026-11-14 演讲 "All Code Is Slop (Except Mine)"（AI Engineer Code Summit，https://www.youtube.com/watch?v=O_zcc6Xl12g ，摘要 https://xiaohu.ai/en/article/lauren-tan-agent-code-quality/ ）：自上而下的"poteto 金字塔"——代码库设计让错误写不出来 > 静态检查（lint、类型、测试、CI）> 运行时与形式化验证 > 散文规则（rules/skills/AGENTS.md，只放无法编码的判断）> 人工 review。每次纠正 agent 都要变成确定性检查而不是往 AGENTS.md 加一行（摘要转引："make that a deterministic check, instead of adding another line to your rules or your AGENTS.md"，未对照视频核实）；报错信息写成"修根因"指令；agent 自己跑应用交回截图/录屏作证据。自报约 11,000 PR/月、回滚率约 0.5%（未核实）。
- 反方与折中：Steve Yegge 统计数千条对抗 review 约四分之一被拦下且多数合理，选择保留；Garry Tan 认为新一代模型下跨模型 review 价值下降；Anthropic 最佳实践把"给 agent 验证自身工作的手段"放首位，同时提醒测试全绿不等于端到端正确。

**对 loom 的判断**：她反对的是"不跑代码的读码 review"，与 loom 的 Auditor 只看证据卡一致；前提是验证产物足够强。loom 临时 reviewer 抓到的两类问题都可确定化：重试路径未落盘指纹 → 不变量/属性测试（"任何终态后指纹必已落盘"并对重试路径做随机化）；外发超出策略 → 出口白名单测试与网络 mock 断言、对 fetch/http/curl 的项目 lint。仍需 review 的：规格本身错、断言过弱或被悄悄放宽、新型红线、跨模块语义耦合、worker 与测试共享盲点。

**拟改 skill / 流程（SKILL-VERIFY-1）**：
1. reviewer 的每个有效发现，关闭前必须落成一条回归测试或 lint 规则。
2. 红线（PATH 解析 CLI、读凭据、外发白名单、全局配置写入）做成项目 lint/CI 检查，证据卡附结果。
3. 持久化、重试、幂等类改动要求不变量/属性测试，证据卡列出被检查的不变量。
4. 证据卡自动给出断言放宽、新增 skip、删除测试的 diff，并附"先见红"证明。
5. 不设 reviewer 角色（用户 2026-11-26）：深查由 Auditor 在阶段边界亲自做，依据确定性检查结果与 worker 证据卡，不派临时 reviewer。
6. lint/测试报错写成给 agent 的修根因指令，不往 skill 里堆散文规则。
7. Auditor 抽查一条证据命令可复现（交由 worker 重跑，不自跑）。
8. 每个阶段统计"review 抓到、检查没抓到"的缺陷类别，转成新检查，逐步降低 reviewer 频率。
