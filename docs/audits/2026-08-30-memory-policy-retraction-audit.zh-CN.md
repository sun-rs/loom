# Memory 策略收缩：上游规则、全量哈希与维护方案审计

日期：2026-08-30。范围：默认 memory prompt 的最小回退、全量笔记哈希的必要性、未来维护与整体引入成熟体系的决策。本轮未部署、未重启用户服务、未改写用户记忆、未运行付费模型/浏览器。

## 1. 核心裁决

1. Raft 与 Claude-Mem 都有内容指导，问题不是“存在指导就危险”，而是把不同体系的规则摘取后，未经效果验证就加入另一体系的默认 Agent prompt。
2. 保留 Raft 的 `MEMORY.md + notes/ + Active Context` 与原始记忆规则。撤回 RAH 自增的价值筛选、跳过清单、项目标签写作/检索规则；路径、传输、凭据与 canonical 权限边界仍保留。
3. 每 Run 全量 notes 哈希没有充分必要性作为聊天启动必经项。它主要服务 RAH 自增 receipt，不是 Raft 记忆形成/召回的要求；计划撤出启动路径而非再开发缓存。**本轮尚未修改哈希实现或收据 schema。**
4. 暂停自定义独立维护上下文/固定五分钟时限的开发。先按 Raft 的实际 idle/start/notice 流程评审最小适配；不把 Claude-Mem observer 当作可直接插入 Raft 的整理器。
5. 将来整体采用成熟体系，应评估一整条经过版本冻结的形成/存储/检索/维护链路。本轮不安装 Claude-Mem、不引入新数据库、不提前建 MemoryEngine 抽象层。

## 2. 上游实际有没有“记什么”的设计

### Raft Computer 1.0.18

固定授权 bundle SHA-256：`20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。本次重新读取本地 `memory-slices/memory-standing-prompt.js` 和 `main.js:764777` 的 `notifyAgentAppInbox`。

- 原 prompt 明确列出用户偏好、项目/领域背景、工作历史、频道背景和其他 Agent；要求有重要学习时主动更新，不限定为“对当前 Room 以外有用”。
- 原索引包含当前工作与最近交互，长任务前保存恢复点，结束后更新文件。它不是仅允许存储通用经验的知识库。
- 文件大小检查只产生提醒；可向现有 Runtime 发 notice，或用可信 idle restart snapshot 调用普通 `startAgent`。不是后台程序替 Agent 自动摘要或删减笔记。

### Claude-Mem（不同产品，不是 Claude Code auto memory）

冻结源码 commit：`fa6a1e9ec12d23f98326a9b26e243acb0819e105`。

- [`plugin/modes/code.json`](https://github.com/thedotmack/claude-mem/blob/fa6a1e9ec12d23f98326a9b26e243acb0819e105/plugin/modes/code.json) 确有 recording focus、skip guidance 和 cwd 空间说明；会跳过空检查、无后续发现的目录列举、重复操作等。
- [`src/sdk/prompts.ts`](https://github.com/thedotmack/claude-mem/blob/fa6a1e9ec12d23f98326a9b26e243acb0819e105/src/sdk/prompts.ts) 将这些规则交给观察另一会话的 observer，输出 observation/summary，不是原工作 Agent 的通用记忆权限规则。
- [官方架构](https://docs.claude-mem.ai/architecture/overview)描述 Hook 捕获、后台 Worker、SQLite 存储与渐进检索；Stop 触发总结。这与 Raft 的文件索引加原 Agent 唤醒不同。本次未据主链文档断言其所有版本都没有其他维护功能。

由此只能支持“上游各有完整规则”，不能支持“将 observer 跳过清单移到 Raft worker 也必然合理”。本轮也不把两个系统拼成新的默认策略。

## 3. 已撤回的默认行为

唯一生产代码改动：`packages/agent-host/src/agent-memory-prompt.ts`。

| 撤回内容                                                      | 原因                                                                        |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 仅在对当前 Room/Run 外有用时记忆                              | 比 Raft 更窄，可能排除频道背景和恢复点，未有真实模型对照收益                |
| 日期/一次性查询/失败查找/测试标记等统一跳过清单               | 是 RAH 对 worker 的扩展，不是 Raft 原规则；不能把 observer 策略视作通用正确 |
| 完成/取消后仅保留可复用经验等追加写作要求                     | 原规则已有更新与恢复约定，无需再施加未验证的选择条件                        |
| 项目标签写索引、据标签选择 notes、路径/验证时间的追加写作约定 | 属于记忆策略而不是必要的目录寻址；当前无效果证明                            |

保留：两个 byte-exact 原始 memory 函数的正文、独立 Agent 记忆路径、完整索引读取、正文按需读取、scope/check/ack/recheck 说明、禁止凭据进入记忆、canonical 权限权威。原始函数文件未改；最终 prompt 仍包含 RAH 必要绑定，所以不称为最终提示词 100% 逐字一致。

已有可选项目映射及 envelope 元数据保留兼容，没有新建/改写操作者配置；只撤回默认写作/筛选指令，不声称元数据对模型完全无影响。没有加入新的 feature flag、实验记忆引擎或替代规则。

memory prompt UTF-8 长度从 7,519 bytes 降到 6,263 bytes；减少 1,256 bytes，不将 bytes 冒充真实 token 节省或召回改善。新 prompt 需要后续正确 revision 的新 Run 才生效，在线旧进程未改变。

## 4. 全量哈希消费者与必要性

代码调用链：

- `agent-memory-activation.ts:prepareAgentMemoryRun` → `materializeAgentMemoryForRun` → `inspectNotesTree` → 对全部 notes 内容执行哈希。
- `snapshotDigest` 用于 receipt identity 和同一 RunAttempt 重复物化的一致性比较；启动入口直接消费的文件内容校验是首项 `MEMORY.md`。
- `AgentMemoryMaterializationReceiptSchema` v1 声明 files/digest；已有本地收据依赖该格式，不能通过伪造全量摘要绕过。
- Human workspace inspect/read 也复用文件观察函数；它是另一访问场景，不能因 UI 按需检查就要求每次聊天同样全扫。
- 当前检索范围内，Kernel 调度、Task 状态、Provider session 恢复未消费全量 notes digest。不要把这项局部结论扩大为“全系统不需要任何哈希”。

全量扫描没有保存正文，也没有在整个遍历期间冻结文件系统。因此它不是可还原备份、模型读过的证明或原子时间点快照；安全 reset 的恢复依赖 quarantine/fence，不依赖这个 hash 恢复原文。

裁决是**移出普通启动**。后续最小改动须同时保持旧 v1 读取兼容、明确新记录只覆盖什么、保留 owner/路径/索引读取安全，并用测试证明不再预读无关 notes。全量检查可留给明确的审计/导出，不追加增量索引或缓存服务。当前代码仍在每次 Run 扫描，未谎称本轮已移除。

## 5. 空闲维护与未来整体替换

已核实当前本机与 remote composition 均仍为 `wake: () => false`，未启用自治调用。本轮将 ADR-0023 的独立维护上下文标为待重新审议，撤下候选五分钟限制。

下一次审议优先复用 Raft 的同 Agent notice/idle/start 分支；RAH 的 Activation-scoped credential 与 Raft 的 managed runner credential 不同，这是要解决的具体接口问题。单 Agent 单执行、停止后不唤醒、无虚构 Room 事件、真实终止证明与凭据回收继续保留；不能以整包复制为由放弃这些已确认边界。

未来整体引入其他成熟体系，需要固定具体项目/版本并验证：

- Agent 独立身份及记忆，不随 Room、CLI、model/effort 改变；
- 完整采集/形成/检索/维护流程及其上下文、后台调用、存储成本；
- 多 Provider 支持和明确权限边界；
- 数据导出、迁移、停用与回退，不能破坏已有 `MEMORY.md + notes/`；
- 基于真实对话的形成、纠错、跨 Room 召回与模型更换验收。

目前选择仍为朴素 Raft 文件基线；停止追加混合策略，不把“未来可能替换”当作现在开发通用记忆平台的理由。

## 6. 验证与证据限度

- TDD：新默认策略测试和 CLI prompt 合同在旧代码上 **2 项失败**，撤回后 **4/4 通过**；同时保留源 SHA、Raft channel/work history/Active Context 规则和凭据安全检查。
- 六个定向文件 **27/27 通过**，覆盖 prompt、bootstrap、coordinator、App Inbox、materialization；不等于真实模型语义验收。
- 全量检查首轮发现已有 remote fixture 输出未以换行结束，随机秘密值前缀可能使末尾 `true` 的 `e` 被防泄漏逻辑遮蔽。固定假 secret 为 `e-...` 后稳定复现；修复仅为 fixture 输出完整换行记录及严格末尾断言，未放松生产脱敏。该测试重新 **1/1 通过**。
- 最终 `npm run check` 通过：根工程与 Web TypeScript 检查通过；后端 634 项中 **632 通过、0 失败、2 项 opt-in gate 跳过**，Web 单元测试 **25/25 通过**。`npm run format:check` 与 `git diff --check` 均通过。
- 日志：`/tmp/rah-memory-baseline-audit.yEMegS/` 的 `red.log`、`targeted.log`、`red-diagnostic-frame.log`、`diagnostic-frame-green.log`。首轮全量失败保留在 `check.log`，最终结果单独记录在 `check-final.log`。

本轮未测试真实 LLM 的召回质量，也没有浏览器操作；这次回退是恢复上游行为规则，不是证明 RAH 已优于 Raft/Claude-Mem。全量哈希收缩和自治维护均仍未完成。
