# t13n 审计：换班方案 v2 与提示词（2026-11-26，只读；rot-tune 为在改快照，rotation-policy.mjs 未跟踪、supervisor 尚未构造 rotationPolicy，self-rotation.mjs:126 调用的 attemptFailed 不存在于其导出 rotation-policy.mjs:408）

**1. v2 漏洞/易误读**
- F"首报被另一方核实前只读"没人通知另一方去核实：全仓无给对方的提示文字，只有命令 rotation-policy.mjs:368；超时复用 15 分钟总限（self-rotation.mjs:13,165-167），含简报轮耗时，对方忙即判失败并锁住本阶段（rotation-policy.mjs:254,209）。须加"通知对方核对＋独立时限＋超时升级 Super 而非记失败"。
- B3 口径不一：文说 agy/Codex"距上次换班累计 token"，代码按"最近 24h 输入"折算（rotation-policy.mjs:49）。我的实测：同一主线 15 次压缩仍稳，错误随话题切换密度聚集；B3 用 AND 是对的，但"子系统=路径前缀"在 subsystemPrefixes 为空时退化为一级目录（:45），会把 docs/ 计为子系统，应排除文档/账本路径。
- C 漏判面：错误标记只认 Super/另一方（:378）。我的经验里最常见的已核实错误是"把测试夹具当产品""信报告不开原始日志"，往往是 Worker 或检视官自己发现的；应允许本人自报（计数同效），否则分母只来自抽查。
- D 用户纠正"由 Super 登记"（:327）与现实冲突：SKILL.md:25 规定 Auditor 是用户默认对接人，Super 看不到用户对 Auditor 的纠正。应由 loomd 从用户→角色消息中按标记计数，或允许被纠正方自登记。
- B 写"loomd 自动提示"，但默认 mode='explicit'（lib/rotation-settings.mjs:2），即默认不提示；文档须写明默认关闭，否则模型以为"没提示=不该换"。
- 缺：继任首报核对不一致时怎么办（停、回退前任、谁裁决）；A 冻结后紧急交接单由 loomd 用"待另一方核对原件补齐"填充（rotation-policy.mjs:396），继任会拿空账本上岗，须标"紧急、账本缺失、先读 rulings.md 全文"。

**2. skill 与 v2 不一致（现行 skill 仍是旧逻辑）**
- SKILL.md:78 仍以"上下文阈值默认 150000"为触发；rot-tune 版 :78 改成"压缩后剩余比例低于配置值"——两者都违背 v2 E"剩余上下文百分比不作为理由"。
- SKILL.md:79"按需要填写以下各项"＋:81-85 五项中文小标题，与 v2 F 必填五项不同（缺判例账本、已否方案、用户偏好与可信度），且代码只认英文标题 'Status','Case ledger',...（rotation-policy.mjs:29-35），按 skill 写中文必被拒；反之代码缺 skill 的"接任后的首个动作"。
- SKILL.md:87"随后等待投递"与 v2"首轮只核对"、与我要求的"核对后继续马上要做的事"都不符。
- skill 完全没写：加严模式、只读核对、rotation-policy 各命令、核对新任首报的责任、换班当天禁改合入/并发/预算（rotation-policy.mjs:401-406 已机械拦）。
- 应由 loomd 机械执行而非散文：SKILL.md:32/44"在安全点"（loomd 已判 idle，改为"loomd 只在空闲投递提示"）；:88"超过三轮/15 分钟"已在 self-rotation.mjs:12-14，散文删；压缩计数、卡/子系统切换（派工记录）、角色/权限变更、首报 SHA/分支比对（loomd 可直接比 note 中 SHA 与 HEAD）全部归 loomd；散文只留"写什么、核什么"。

**3. 交班模板与简报**
- 必填缺：①分支、基线 SHA、WIP 行数（facts 卡 rotation-policy.mjs:291-299 只有 HEAD 和"最新一条"裁决）；②全部在力裁决编号清单（简报总预算 1500 token，brief.mjs:11、:173 裁决会被截断）；③规则为何存在及其边界/例外；④哪些 Worker/模型需加严；⑤下一个具体动作＋谁解阻；⑥在途消息改投清单（v2 F 有，模板无）。
- 易偏句：SKILL.md:87"随后等待投递"、sessions.mjs(loom_new):525/540 与 rot-tune:570/585 "Wait for Loom to deliver queued work"/"then wait for Loom deliveries"——会让新任核完就停；rot-tune sessions.mjs:566"不执行未决任务"同样会让它把"马上要做"也当未决而闲置。self-rotation.mjs:154/161 'Take over this role at the recorded safe point.' 太空，未说首轮做什么。

**4. 首轮提示是否够**
- "只核对不决策"rot-tune:566 已有，但无"不一致即停并报谁"的判据，也无"核对通过后做哪件事"；新任会两头偏：要么闲等，要么把核对当授权开始决策。需写死：核对四项（分支、基线 SHA、WIP 行数、在力裁决编号）→不符首行写 MISMATCH 并停，由不换的一方/Super 解阻→相符则执行交班单"下一动作"中不改规则、不合入的部分，合入与规则改动等另一方 verify。

**5. 改写（原句 → 新句）**
- SKILL.md:78 "上下文阈值默认 150000，可用 `maxContextTokens` 和 `rotateAt: "gate"` 调整。" → "换班由 loomd 按 v2 信号在空闲时提示（默认关闭，策略 rotation.mode=v2 开启）；轮数、时长、剩余上下文都不是理由。"
- SKILL.md:79 "按需要填写以下各项。" → "以下各项必填，标题照抄：Status（分支、基线 SHA、WIP 行数）、Case ledger（在力裁决编号、为何存在、边界与例外）、Rejected options and reasons、Unresolved items、User preferences and trust（含需加严的 Worker）、Next action（具体动作与谁解阻）、Rerouted messages。"
- SKILL.md:87 "附现查的 SHA 和路径，随后等待投递。" → "附现查的分支、SHA、WIP 行数和在力裁决编号；与交班单不符则写 MISMATCH 并停，由另一方高管核对；相符则立即执行交班单的 Next action（合入、改规则须等另一方 verify）。"
- SKILL.md:32/44 补一句 → "新任首报到达后，不换的一方在本轮内用 `loom rotation-policy verify --target 新任 --verdict pass|fail --evidence 原件` 核对。"
- sessions.mjs rot-tune:566 "不执行未决任务或修改规则。" → "核对通过后执行交班单 Next action；不合入、不改合入时机/并发/预算，这些等另一方确认。"
- sessions.mjs rot-tune:570/585 "Wait for Loom to deliver queued work." / "then wait for Loom deliveries." → "If anything mismatches, put MISMATCH on line 2 and stop; otherwise carry out the note's Next action in this turn, then end the turn."
- self-rotation.mjs:154/161 'Take over this role at the recorded safe point.' → 'Verify the handover facts against originals, then continue the Next action from the note.'
- rotation-policy.mjs:184/317 "等待干净边界" → "继续执行已定动作但不作新决定；loomd 会在干净边界发换班提示。"
