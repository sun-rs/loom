# skill 拆分调研（2026-11-26；【二手/未核实】已标注）

**官方指引**
- Anthropic skill 最佳实践（platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices）：SKILL.md 正文 <500 行，超出拆文件；引用只一层（嵌套时可能只读前 100 行）；>100 行的引用文件顶部放目录；description 写"做什么 + 何时用"；"上下文窗口是公共资源"；先建评测（≥3 场景，多模型）再写最少指令；观察"没跟进引用"的情况。
- Claude Code memory（code.claude.com/docs/en/memory）：CLAUDE.md 目标 <200 行，越长遵循度越低；它只是上下文不是强制配置，硬约束用 hook；多步骤流程移到 skill 或路径作用域规则；`@import` 不省上下文；规则冲突时模型可能任选其一；`/doctor prompt-audit` 查冲突与失效引用。
- Codex AGENTS.md：合并上限默认 32 KiB，逐层覆盖。Gemini CLI GEMINI.md：分层拼接，较新版本支持按目录即时加载【文档版本间有出入】。Cursor Rules：Always / Apply Intelligently / 按文件 globs / 手动四档。
- Anthropic《Effective context engineering》（2025）：最小高信号 token 集合；部分预加载、部分即时探索的混合方式。

**真实库**：obra/superpowers 用 SessionStart hook 常驻注入约 480 词核心并在压缩后重注，其余按需；writing-skills 目标常驻 <200 词、其他 <500 词；issue #2454 指出强硬措辞在新模型上过度触发【部分二手】。CrewAI/AutoGen/MetaGPT 未查到可引用资料。

**研究证据**：IFScale（arXiv 2507.11538）指令 10→500 条，最强模型 500 条时约 68%，遗漏型衰减、偏好靠前指令；Lost in the Middle（2307.03172）U 形位置效应（老模型）；Chroma Context Rot（2025-07）输入越长越差；Vercel 2026-01 评测：skill 默认 56% 未被调用，显式指令后触发率 79%，AGENTS.md 文档索引 100%【二手、厂商自评】；OpenDev（arXiv 2603.05344）30+ 次工具调用后指令淡出，用事件驱动"系统提醒"修补，以 user 角色注入比 system 遵循度高【摘要级】。

**陷阱**：规则冲突任选其一；失效引用；嵌套引用被部分读取；按需文件不被打开；关键规则藏在引用文件；强硬措辞过度触发。

**对 loom 的设计结论（SKILL-SPLIT-1 据此执行）**
1. 角色核心只放身份、红线、必须升级的情形、结论标签、每轮必用命令；目标 ≤1.5k token；红线放开头，末尾一两行重述。
2. 情境模块由 loomd 在触发事件时随投递以 user 消息附送（一次性标记、重试上限），单个 ≤500 token、同时最多 2 个——零额外请求。
3. 指针文件只放冷门操作，只一层、顶部目录；写成"当 X 时读 Y，再做 Z"；**任何红线或必做步骤不放指针文件**（触发率无保证）。
4. 每条规则只出现一处并编号；构建时脚本检查重复、冲突、失效指针。
5. 能由 loomd/hook 强制的不写成散文。
6. 不用 MUST/EXTREMELY IMPORTANT 式强硬措辞。
7. 先建评测再拆：每角色 ≥3 场景，度量红线违反率、该读未读率、模块注入后遵循率，与现行 13 KB 整体版 A/B，用 codex、gemini、claude 多次运行。
8. 预算数字（1.5k / 500 / 2）是初始值，按评测调整。
