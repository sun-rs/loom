# loom 记忆方案（2026-11-26，综合 Claude Code、claude-mem、raft、Orca）

## 调研事实（只读，未运行任何被调研的程序）

| 来源 | 版本 | 谁生成 | 怎么注入 | 每轮额外请求 |
|---|---|---|---|---|
| Claude Code 官方 | 2.1.331（二进制字符串）+ code.claude.com/docs/en/memory | ① 在岗会话直接写文件（主路径）；② 回合后 `extractMemories`：Haiku 先答 `{write_likely}`，是才由主模型分叉（共享缓存，≤5 轮）写，本回合已直接写则跳过；③ `autoDream` 整理：距上次 ≥24h 且 ≥5 个会话有活动，加锁，分叉代理读这些会话整理 | `MEMORY.md` 前 200 行或 25KB（写入时超限警告/报错）；类型 user/feedback/project/reference；每条用户提示由 Sonnet 选 ≤5 条相关记忆（每条 ≤200 行/4KB，会话总上限 60KB）以 system-reminder 附上；压缩后重新注入根 CLAUDE.md、规则和记忆 | 约 1 次 Sonnet 选择 + 1 次 Haiku 判断；判是时再加分叉 |
| claude-mem 插件 | v17.0.0 @ 9b3b78df（2026-11-25） | 独立"观察者"代理（默认 Haiku）：每次工具调用 1 次请求生成观察，每次 Stop 再总结 | SessionStart 注入最近 50 条观察索引；MCP 工具渐进展开（search → timeline → get_observations）；可选每条提示语义注入 5 条 | 约每次工具调用 1 次 + 每轮 1 次；曾因配额恢复后重放 1,200 条旧事件、观察者思考吃掉 70% 输出 token 等问题返工 |
| raft（我们的旧版） | origin/raft @ bf439460（2026-11-05） | 阶段 1：agent 自己写 MEMORY.md + notes；阶段 2：SQLite 条目（类型同上、描述 ≤150 字、正文 ≤16KiB、不可变修订+来源、`expectedRevision` CAS、FTS5），模型用命令写，删除/置顶只归人 | 会话启动注入 ≤3KiB 索引（置顶优先，末行"另有 N 条"）；变更随下一次唤醒消息附带（≤30 条）；压缩后重附索引；强制关闭原生记忆（Claude 可证实，Codex 未能证实） | 0 |
| Orca bot 记忆 | Orca 1.4.272 | bot 正常回合中直接改文件；Orca 代码给每条加来源、只能经命令删除（他处删掉会被恢复）、CAS；日志由已关闭工作项无模型生成 | 首轮注入 MEMORY.md 前 200 行，声明"供参考的笔记、非指令"，末尾"N 行未加载"；会话外修改以 ≤20 行/3,000 字 diff 附在下一条提示上 | 每轮 0；每晚 1 次整理（无工具，改写为约 60 行，校验：删除 ≤1/5、≤200 行、只能加主人说过的事实、可撤销） |

## 方案

**原则**：照 Claude Code 官方结构做，凡它靠每轮额外请求实现的部分，换成 loom 已有通道（启动参数、已有投递、结构化事件）的零请求等价物。

### 存储（memory v1 已合入 main）
条目带类型（user / feedback / project / reference）、≤150 字描述（作索引和检索键）、正文、来源指针（hist 投递/轮次/门禁）、修订号。写入走 CAS 和冲突检测；作废要留痕；删除和置顶只归用户或 Super。`<private>` 内容不入库。

### 生成（按优先级）
1. **在岗角色当场写**（对应 Claude 主路径）：skill 教会 `loom mem write|update|invalidate`；也可在本来要发的最终回复里写 `REMEMBER:` 行，由 loomd 提取，不加请求。
2. **loomd 从结构化事件生成**：用户裁决（Super 记账）、门禁结论和条件、卡片结果、红色升级处理、换班交接。零模型调用。
3. **阶段整理**（对应 autoDream / Orca 夜间整理）：阶段边界，或距上次 ≥24h 且有 ≥5 个会话活动时，派一张低成本 worker 卡，读上次整理以来的 hist，只产出合并、作废、更正的提案。按 Orca 的做法在代码里校验（删除比例、行数上限、不得凭空新增用户事实），可撤销；项目级随下一次门禁包交 Auditor，用户级交 Super。
4. **不做**：每次工具调用的观察者（claude-mem），每回合的抽取判断（Claude `extractMemories`）——都与"少请求"冲突。pilot 若显示漏记严重，再只对高级角色、先用规则预筛后试点。

### 注入
1. **启动索引**放系统层（Claude `--append-system-prompt`、Codex 开发者指令、OpenCode agent 配置；agy 待查，否则首轮简报）：按角色筛选，上限沿用 Claude 的 200 行 / 25KB，末行"另有 N 条未加载"，声明"参考笔记"，裁决类除外。
2. **按需展开**：`loom mem search`（FTS5）→ `loom mem show`，即渐进展开；不挂 MCP。
3. **相关性提醒用确定性规则替代 Sonnet 选择器**：条目可带作用域（卡片、波次、路径，仿 `.claude/rules` 的 `paths:`），派卡时把命中的条目附在卡片投递里；新增或修订的条目随下一次已有投递附上增量（上限仿 raft/Orca：≤30 条或 ≤3,000 字）。
4. **压缩后补回**：Claude 用 SessionStart（compact）hook；其他 CLI 由 loomd 检测压缩后，在下一次投递时附回索引。

### 隔离
托管角色关闭各 CLI 自带记忆（Claude `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` 启动环境；Codex、agy、OpenCode 各自等价开关，逐版本冒烟），loom 是唯一记忆所有者（MEM-ISO-1）。不写项目的 AGENTS.md / CLAUDE.md。

### 验收指标（pilot）
每轮额外请求 = 0；换班首轮 token 相比交接文件方案下降；"事实遗漏/走偏"计数（loomd 已有 fact-miss 统计）下降；索引大小与注入增量的 token 分布；整理提案的通过率与回滚次数。
