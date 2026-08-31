# Memory P0 修复与索引/正文形成机制审计

日期：2026-08-30。范围：`rah_os`；没有修改旧 `rah`、原始 `raft-ui`、用户正在运行的 daemon 或 Provider 配置。

## 结论

用户的理解正确：**小索引 + 经过整理的知识笔记 + 很短的未完成工作恢复点**，不是“小索引 + 无限聊天全文”。原始证据按需去 Room/Task/Artifact 查；笔记总结出为什么、学到了什么、何时适用，并保留可核验出处。

本轮修复维护检查/wake 故障隔离与跨 Computer 空白 Memory 接管，补充笔记形成规则。尚不能宣布整个 P0 收口：自主 idle maintenance runner、active safe notice、跨 Computer 内容迁移与恢复流程仍未完成。

## 1. 实际核对的来源

### Raft：当前 Agent 自己整理文件

授权官方 Computer 1.0.18 bundle SHA-256：`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

只读核对 `raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18/memory-slices/`：

- `onboarding-and-initial-memory.js` 的 `buildInitialMemoryMd`：初始 Role/Key Knowledge/Active Context 骨架，不是现成的历史摘要。
- `agent-workspace-initialization.js`：缺失时创建，已有 Memory 不重写。
- `memory-standing-prompt.js`：当前执行 Agent 主动记录有意义的学习，详细知识进 notes，索引更新指针，长任务前后维护 Active Context。
- `memory-index-cleaner.js`：文件大小检查、10 秒 measurement timeout、typed App Inbox hint、wake 失败隔离。cleaner 本身不调用摘要模型、不自动改写/删减正文。

因此 Raft 主要用 **Prompt + Agent 文件工具** 生成索引/正文；并非每条聊天都由后台自动总结。默认 64 KiB 是索引告警阈值，不意味着理想索引应写满 64 KiB，也不等于固定 token 数。

### Claude-Mem：旁观模型提炼记录，再由代码生成检索索引

用户的 `claudememory` 名称存在歧义。本次主要分析 [`thedotmack/claude-mem`](https://github.com/thedotmack/claude-mem)，冻结 commit `fa6a1e9ec12d23f98326a9b26e243acb0819e105`。未安装、未运行上游任何 hook/worker、未导入其依赖或代码。

核对源码：

- [`src/sdk/prompts.ts`](https://github.com/thedotmack/claude-mem/blob/fa6a1e9ec12d23f98326a9b26e243acb0819e105/src/sdk/prompts.ts)：工具输入/输出组成 observer prompt；模型返回 title、facts、narrative、concepts、文件引用等 observation；summary prompt 另生成 request/investigated/learned/completed/next_steps。对超大字段明确裁剪并禁止猜测缺失部分。
- [`plugin/modes/code.json`](https://github.com/thedotmack/claude-mem/blob/fa6a1e9ec12d23f98326a9b26e243acb0819e105/plugin/modes/code.json)：强调耐久技术发现，跳过无信息的检查、重复操作和空查找。使用工具不等于一定形成记忆。
- [`AgentFormatter.ts`](https://github.com/thedotmack/claude-mem/blob/fa6a1e9ec12d23f98326a9b26e243acb0819e105/src/services/context/formatters/AgentFormatter.ts)：代码从已存 observation 的 ID/时间/类型/title 渲染短索引；按需展开细节。
- [`ObservationCompiler.ts`](https://github.com/thedotmack/claude-mem/blob/fa6a1e9ec12d23f98326a9b26e243acb0819e105/src/services/context/ObservationCompiler.ts)：按项目和平台范围查询、组合记录/summary。还存在可选 transcript 上一条回复读取路径，不能将其当作 RAH canonical truth 导入。

这不是 Raft 同款 Markdown owner：Claude-Mem 额外付出 observer 模型调用，以项目/会话/工具事件形成 SQLite 记录，再渐进检索。适合借鉴“提炼、跳过无意义操作、短索引按需取正文”，不适合直接替代 RAH 的 per-Agent 私有记忆。

### Claude Code 官方 auto memory：更接近 Raft 的文件形态

核对 [官方 memory 文档](https://code.claude.com/docs/en/memory)：Claude 自己编辑 MEMORY.md 和主题文件；启动载入入口前 200 行或前 25 KB（先到者），主题文件按需读取。它默认按 repository 归属，与 RAH 的稳定 Agent participant 归属不同。

另有 `codenamev/claude_memory` 与 `gunesbizim/claudememory` 等同名仓库；不能把它们和 Claude-Mem/官方 auto memory 混为一个实现。若用户指定另一个仓库，应重新冻结该版本核对。

## 2. 本轮实现与复用边界

| 项目           | 本轮实现                                                                                                     | 来源/边界                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------- |
| Memory 形成    | 索引条目含一句话、相对 notes 路径、读取时机；正文整理结论/理由/出处；先笔记后索引；清理已完成 Active Context | Raft 结构化适配，质量规则借鉴 Claude-Mem          |
| 索引体积       | 新增 4 KiB 写作目标，保留 64 KiB 告警                                                                        | 4 KiB 是 RAH 产品选择；不是源码原值或硬 token cap |
| 检查卡死       | 10 秒 deadline，超时为 unknown；晚到结果无副作用                                                             | 移植 Raft measurement timeout                     |
| wake 失败      | 不阻塞正常 Activation，hint 保留                                                                             | Raft failure 隔离 + RAH 非阻塞接线                |
| 重复/迟到 wake | 单 owner pending 合并；关闭/改配置/恢复正常时 abort；不合作回调仍占据 pending 防并发                         | RAH 安全加固，不冒称已启动 maintenance Runtime    |
| 跨 Computer    | v19 durable Memory Home；lease、Placement、Run 和 reset/maintenance 多层保护                                 | RAH Kernel owner，补全本地文件模式的安全缺口      |
| 旧数据升级     | 单历史 Host 保留；多 Host 明确 conflicted                                                                    | 禁止猜测主副本，未提供静默覆盖/迁移               |

没有导入新的常驻旁观 Agent，没有解析 Provider transcript 来形成 canonical 记忆，没有全局共享所有人的笔记，没有自动删除超阈值内容。

## 3. 本轮验证

新增测试先复现 wake exception 阻断、同 Agent 重复 wake、跨 Computer legacy lease 与 Placement 可错误接管，再修复。超时使用 fake clock；Kernel 测试使用隔离 SQLite、多 Host 与数据库重开；包含旧 v18 多 Host 历史冲突的升级检查。

最终 gates：

- `npm run check`：通过；Core/packages 607 项中 605 通过、2 项 opt-in 真实 CLI gate 跳过；Web 25/25 通过；root/Web TypeScript 通过。
- `npm run format:check`：通过。
- `git diff --check`：通过。
- `npm audit --omit=dev`：0 vulnerabilities。
- source-size gate：RoomKernel 6,924 行，仍低于原 6,925 行上限；抽出了 RunAttempt 的 Placement/Memory admission owner，没有抬高上限。

本轮没有修改 UI，也没有新增付费真实模型或浏览器写入测试。此前的真实 OpenCode 跨 Channel/DM 召回、Kimi 默认不共享另一 Agent 内容、桌面/PWA Memory 查看证据保留；它们不能替本轮新增的写作规则证明真实模型的长期记忆质量。单元测试匹配 prompt 只证明规则被发送。

## 4. 剩余项与下一个可验收切片

1. 自主维护：Computer 启动时恢复 Agent schedule；typed hint → 全局独占 fence → 使用该 Agent 选择的现有 Runtime 的 idle maintenance → 源状态重查/scoped ack/receipt。不得伪造 Room Message 或给维护进程 Worker Room credential。
2. 迁移：旧 writer terminal proof → 文件 bundle+digest → 目标验证 → Kernel 原子切换 home → 释放源；崩溃/断连恢复、失败回滚及 Human 操作面板。当前只完成禁止无证据接管。
3. 长期质量：真实多 Provider 测试重复事实去重、错误纠正/forget、跨 Room 作用域、secret/injection 拒绝、索引大小和内容保真。禁止仅以模型说“已经记住/整理完成”验收。

本轮代码未提交、未发布、未重启用户的在线服务。
