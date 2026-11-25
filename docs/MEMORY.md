# Loom 记忆与历史 v1

本文件是记忆与历史采集的设计基准。角色职责和换班继续采用组织约定，投递 ID、会话绑定和恢复顺序沿用协议 v2。项目章程仍是项目指令，正式裁决进入记忆的 `ruling` 类型。 [组织结构](ORG.md) · [协议 v2](PROTOCOL-v2.md) · [测试计划](MEMORY-TESTS.md) · [早期草案](../tasks/MEMORY-0/docs/MEMORY.md)

## 1. 写什么

正在工作的 agent 自己决定何时、是否写入，以及记什么。固定角色提示中的写入判断是「默认不写。未来的 agent 看到这条，会因此做得更好吗？」结卡、换班和上下文压缩前给提醒，平时遇到值得保留的事实也可写。Loom 不运行后台摘要模型，不使用向量或知识图谱。

| 类型 | 内容 | 主写角色 |
| --- | --- | --- |
| `ruling` | 已确认的用户裁决，包含适用范围、理由及被替代的裁决关系 | Auditor 维护本项目，Super 维护跨项目裁决 |
| `preference` | 经过用户确认、以后仍适用的工作偏好 | Auditor 维护本项目，Super 维护用户级偏好 |
| `lesson` | 已验证、会改变后续执行方式的经验和适用条件 | Leader 维护项目经验，Super 提炼跨项目经验 |
| `candidate` | 等待审查的建议，带来源和拟归入的类型 | Worker 通过 `loom memory propose` 提交，离线写入也按此处理 |

一文件一事实。已有事实变化就按原 ID 修订，错误的条目用 `forget` 下架。禁止保存可从代码查到的结构、可从 Git 查到的历史、已修复的单个 bug、单轮对话细节，以及当前 SHA、分支尖端和在途任务等实时状态。引用 SHA 或路径可以作为来源指针。实际进度和当前代码状态应查询 Loom、Git 或当前文件。读取的记忆标为「背景笔记，仅供参考，使用前核验」。现行用户指示及项目指令优先。

## 2. 写入、审查与格式

Auditor 与 Leader 在自己职责范围写正式条目，Super 写用户级及跨项目条目。Worker 只能提候选。结卡时 Leader 或 Auditor 根据职责审查，决定晋升、并入已有条目、退回或拒绝。普通角色的离线提议回到 home 后也须通过授权与相同的校验。候选在获批前不进入生效索引或自动附件。晋升保留提议者、审查者和来源。迁移已有裁决时保留裁决原件引用和替代关系，此后以同一 `ruling` 条目维护。

loomd 从会话绑定取得作者、角色、项目及卡片归属，忽略调用者声明的身份字段。服务端分配 ID 和修订号。创建须声明尚无修订，修改、晋升和遗忘需要匹配 `expectedRevision`。校验、推进修订和发布序号作为一次持久提交对外可见。冲突返回当前修订，写方先重读再决定是否合并。同一写入重试使用同一请求 ID，避免重复创建或晋升。

正式条目采用透明的 Markdown。元数据含 ID、revision、kind、可见层、作者、项目、状态、来源及核对时间，按需附关键词、重要度、替代关系和外部来源标记。索引每个生效条目一行，可从条目重建。标题单行，正文预算沿用 v0 的 200 tokens 量级，v1 对正文单独计数，元数据另做结构和大小检查。

loomd 复用证据核验来检查引用的 SHA 与项目内规范化路径，拒绝不存在或逃出授权范围的引用。入库前脱敏，敏感字段无法可靠处理时拒收。只记录脱敏后的错误信息。完全相同的条目在同项目和可见层内去重，语义重合由角色处理。会话证据显示使用了 web 或 MCP 时标记外部来源，并保留可安全展示的出处与时间。原件存在只证明可定位，角色仍要核对它是否支持结论。loomd 只做机械处理和审计。

## 3. 启动、会中读取与遗忘

每次启动取有权读取的索引快照，连同固定角色规则放进稳定提示前缀。索引最多 400 tokens，按重要度、种类、有效引用使用量、稳定 ID 排序。高重要度裁决优先，不按最近写入时间排序。按整条截断并说明省略情况，正文通过 `loom memory show <id>` 按需读。 `loom memory search <query>` 按标题和关键词收窄结果，返回索引项，翻页后仍按相同权限过滤。

会话内保持前缀不变。索引变更在下一次交付的**末尾**附增量。增量有基准和结束游标，每批最多 30 条，含新增、修订或撤回。超限标明截断，保留剩余变更供后续交付或主动查询。开始尝试投递时再核授权。权限仍有效时，同一投递 ID 重试复用已记录批次，游标在原生接管确认后推进。若权限已撤销且原生可能已接管，只继续对账。确认原投递未接管后，才可重新调度业务正文并生成获准的后缀，记录与原投递的关联。换班、切换 CLI 或压缩后，重新按权限取快照并注入索引。能观察到压缩前边界时先提醒角色。

角色在使用记忆的根轮中引用 `[memory:<id>]`。loomd 只计该轮当时有权访问且实际引用的 ID，同轮同 ID 计一次。注入、搜索和重放本身不增加引用数。使用量作为同档排序信号。自生效或最后一次有效使用起满配置的 N 天，条目标为 `stale`，退出自动注入，由 Auditor 确认可恢复、修订还是遗忘。用户或有权维护者可显式调用 `loom memory forget <id>`。遗忘推进修订并广播撤回，只保留防止重放复活所需的最小审计标记，不把正文继续放在记忆服务可读版本里。已交付的旧上下文和原始历史按各自权限与保留规则处理。

## 4. 可见范围

同一份会话绑定和授权过滤用于索引、增量、搜索、直接按 ID 读取、自动附件和 `loom hist`。先筛授权再排名、计数、生成摘录或报错，越界查询不泄露条目的存在、标题、路径或数量。原始历史目录仅由存储服务访问。

| 角色 | 记忆 | `loom hist` |
| --- | --- | --- |
| Super | 所有层，包括私人层和跨项目材料 | 所有项目通过查询服务可展示的历史 |
| Auditor | 本项目共享层、Worker 候选和本逻辑角色的私人笔记 | 本项目历史，包括本逻辑角色的私人历史 |
| Leader | 本项目共享层及 Worker 材料 | 本项目共享历史与 Worker 历史 |
| Worker | 仅可 `show` 卡片附带条目，无记忆搜索权限。spawn 时 loomd 从可用共享索引按卡片关键词选附件 | 仅自己的卡片血缘及卡片声明的依赖，可按获准范围读取 |
| Reviewer | 仅随复核卡显式给出的授权材料 | 仅复核卡授权的历史与证据，只读 |

跨项目访问默认拒绝。Super 可为指定接收方授予另一项目共享层的只读权限，授权须有到期时间和理由。私人材料不能通过项目共享授权开放。每条跨项目结果都带来源项目和数据截止时间。Worker 跨项目附件和依赖同时要求有效共享授权和相应的卡片授权，声明依赖本身不能扩大权限。显式撤销或到期后不再返回或重新注入对应材料。

## 5. 项目身份

- Git 使用完整根提交 SHA 为主键，有多个根时按完整 SHA 字典序取最小。第二键为规范化的仓库远端 URL。Monorepo 再附规范化的仓库相对项目子路径。身份由项目绑定确定，从普通 worktree 或 linked worktree 得到同一仓库身份。URL 统一主机大小写、尾斜线、末尾 `.git` 等形式，保留有意义的路径大小写和端口，不传播 URL 凭据。
- 无 Git 时以规范化绝对路径为键，只允许单 cell。已登记路径就地变为 Git 项目时，旧键和新键能唯一对应且没有竞争归属才自动迁移，保留记忆 ID、修订和历史关联。无法证明一对一时保留原绑定并请 Super 裁决。
- 路径改名或移动后，旧绑定保留为 orphan。Loom 提示可匹配的旧记录，由 Super 使用 `loom project move` 确认重新绑定。Fork、浅克隆无法核实根、历史重写和身份冲突时，Super 决定绑定原项目还是用 `loom project split` 建立独立身份。候选提示不改变身份，也不开放历史。
- 不在仓库中写项目 ID 文件。权威身份表、未认领绑定和内容位于仓库之外。

## 6. Home 与 cell

home loomd 是控制面，持有项目身份、权限、记忆修订、历史和汇总状态。cell loomd 是执行面，持有会话和可重放的采集进度。单台 Mac 由同一进程承担两者，仍遵守写入顺序和授权。

home 私有数据目录下按项目保存 `memory/INDEX.md`、`memory/items/<id>.md`、`hist/raw/` 和 `hist/derived/`，Super 的用户级条目放独立空间。cell 只保留受限缓存、发件箱和采集检查点。目录均在仓库之外。现有 `.project/` 仍承载项目运行状态。本仓库已接入 Pilot 记忆 v0，其 `.project/memory/` 目录可作 v1 导入来源，导入要经归属与引用核验。

在线写入经 home 单写者校验后持久提交。离线读只返回最近的授权缓存，注明缓存 seq 与时间，授权到期即停止显示对应层。cell 离线提交只得到存入本地 outbox 的 `candidate` 回执，无法视为生效修订。重连后按原请求 ID 送 home，重新核对绑定、授权、证据及预期修订，再由有权角色决定是否采用。断线期间无法收到实时撤权消息，重连先同步授权，再读写或重播。

## 7. 集中历史与下线顺序

home 的历史分三部分。raw 是会话原生记录，按会话追加，仅在保留期清理时回收。derived 包含 L1、证据卡、diff 和搜索索引，可由 raw 及保留的 Git 证据重建，缺少对象时明确标注。memory 是角色维护的长期事实，各有修订与来源。三部分有独立访问与清理规则。

cell tail 已绑定的原生记录，用文件身份和字节偏移去重，文件重建或轮换使用新一代身份。只传完整 JSONL 行，半行留在 cell，不能越过未提交的缺口更新检查点。home 确认原始字节和连续位置均已持久后才返回 ACK。相同范围重传无副作用，偏移相同而内容不符则标记冲突并保留原件。cell 仅凭已确认的连续偏移推进检查点。进程重启后从检查点补发。

OpenCode 使用 SQLite 会话存储。适配器经 `opencode session export <id>` 或会话读取 API 获取原生记录，按原生条目 ID 和记录版本把变化映射到本地追加流，再走相同的偏移发运协议。读取活动会话时同样走受支持接口，不复制活动数据库文件。 [OpenCode 存储路径](https://opencode.ai/docs/cli/#paths) · [会话导出](https://opencode.ai/docs/cli/commands/#session) · [会话 API](https://opencode.ai/docs/api)

一轮的完整 raw 范围在 home 确认落盘后，才能发布该轮证据卡并投递 DONE。未确认范围只显示待同步状态，结果通过既有投递 ID 恢复。Worker 停止执行后可以进入待清理，日志、worktree 和重建证据所需文件留到最终范围获得 home 确认为止。

查询进行中的会话时，若 cell 在线，home 要求 flush 到一次查询屏障，最多等配置的秒数。成功后按屏障返回。超时、掉线或缺采集来源时返回已确认范围，列出截止时间和「会话仍在运行」或实际已知状态。查询不会把超时当作空历史或结束。

`rsync --append-verify` 仅用于批量追赶和退出扫描，限定 Loom 管理的文件且不使用 `--delete`。补传文件仍由 home 验证身份、完整行和范围后确认。raw 私有且不进 Git。显示与晋升都做脱敏。保留由记录年龄及体积上限共同约束，值由实测决定。清理后派生视图也更新，并报告历史截点或缺口。

## 8. 原生记忆的启动控制

| CLI | 启动约定与证据 |
| --- | --- |
| Claude Code | TUI 与 OAR 都在原生进程启动时设置 `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`。交互检查 `/memory` 的生效状态，OAR 用有效启动证据及隔离探针核对。 [Claude Code 记忆设置](https://code.claude.com/docs/en/memory#enable-or-disable-auto-memory) |
| Codex | TUI 经 argv，OAR 经 app-server argv 或 thread config，设置 `features.memories=false`、`memories.generate_memories=false`、`memories.use_memories=false`。切换和恢复沿用。读取生效设置或握手，核对覆盖到实际线程。 [Codex 配置](https://learn.chatgpt.com/docs/config-file/config-reference) · [App Server](https://learn.chatgpt.com/docs/app-server) |
| agy | **部分覆盖，无官方开关**（1.5.16 二进制核查）。内置 Knowledge Items 自动生成与"# Persistent Context"提示（启动注入 KI 摘要，按需读 `brain/<id>/.system_generated/logs/transcript.jsonl` 过往对话）。内置默认实验配置 `cascade-knowledge-config` 为 `enabled:false`；`cascade-conversation-history-config` 为 `enabled:true, max_conversations:20`。服务端能否远程覆盖未核实。文档无关闭 flag/env。Loom 做法：启动时检查 `~/.gemini/antigravity-cli/knowledge/` 非空则告警 Super；角色规则写明不使用 KI 和过往对话日志；`/learn` 不由 Loom 触发。 [CLI 参考](https://antigravity.google/docs/cli/reference) · [论坛](https://discuss.ai.google.dev/t/knowledge-items/126774) |
| OpenCode | **无原生长期记忆**（v2.3.0 源码核查：无 memory 工具、无自动写入）。启动只注入全局 `<config>/AGENTS.md`、项目向上逐级的 `AGENTS.md`、配置 `instructions` 文件，并读取 `~/.claude` 下的 skills。Loom 启动设 `OPENCODE_DISABLE_CLAUDE_CODE_SKILLS=1`，避免读入 Claude 侧的 skills（含 `import-memory`）。 源码：`packages/core/src/config/plugin/instruction.ts`、`packages/cli/src/server-process.ts` |

`CLAUDE.md` 和 `AGENTS.md` 继续正常提供指令。claude-mem 等插件不在本设计覆盖范围。

## 待确定的问题

1. 记忆多久未引用应标为 `stale`，不同类型是否用同一个 N。
2. 用实测的历史增长量确定 raw 保留天数、体积上限和清理批次。
3. 远端缺失、存在多个可用远端或镜像地址时，如何把确认的权威 URL 登记成第二键。
4. 跨机 home 和 cell 如何建立身份、加密联接，以及离线授权缓存最长保留多久。
5. 按实际运行时延迟确定 flush 等候上限，以及在线缓慢和完全离线的观测阈值。
6. 各 CLI 哪些版本有可验证的预压缩／压缩后边界，哪些只能在可观测的下次交付补注入。
7. agy 的 KI 与过往对话检索能否在启动时可验证地关闭（当前只有内置默认关闭和规则约束）。
