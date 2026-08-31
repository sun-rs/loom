# Agent Memory：精简索引与项目身份研究

日期：2026-08-30。本文为源码研究，不是已完成产品验收。实施合同见 [ADR-0026](../adr/0026-compact-agent-memory-and-project-hints.md)。

## 1. 问题与结论

同一 Agent 的记忆跨 Room、CLI、模型和项目连续。项目是相关性线索，cwd 是执行位置，二者都不成为第二个 memory owner。元信息应当帮助选择笔记，不能比笔记摘要更占上下文。

必须区分三个对象：

- 原始记忆：Raft-compatible `MEMORY.md + notes/`，仍由 Agent 整理。
- 来源信息：Computer、源项目绑定、源 cwd、Room/Run 引用；完整信息可保存在后台/笔记详情，不逐条注入。
- 启动索引视图：只提供本次有界、可定位的入口；不代表全部记忆，也不代表模型已阅读。

## 2. Raft：保留简单的 Agent-owned 文件协议

证据为官方 Computer 1.0.18 已授权提取的固定 bundle，SHA-256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。完整取证与切片校验见 [原有源码账本](./2026-08-29-raft-memory-source-extraction.zh-CN.md)。

- `agent-start-memory-bootstrap.js`：目录由 `agentId` 派生，不按 cwd 或频道重建一个人。
- `memory-standing-prompt.js`：统一索引、按需 notes、少量 Active Context；偏好/项目/经验是写作建议，不是三套数据库。
- `memory-startup-prompt-assembly.js` 的 `runtimeContextLines`：当前 Agent、Computer、Workspace 由 Runtime context 提供；不能从旧记忆猜测当前机器身份。
- 索引先读、正文按需读依赖 Agent 行为；已取得的切片没有证明每次索引读取都具有硬预算，也没有证明每条笔记已自动绑定来源项目。

采用：Agent owner、透明 Markdown、索引先行、正文按需、当前上下文与历史记忆分开。增强：Computer 生成有界启动视图。禁止宣称这些增强是 Raft 原有代码。

## 3. Claude-Mem：借鉴索引呈现，谨慎采用项目识别

本研究特指 `thedotmack/claude-mem`，不是 Claude Code 官方 auto memory。源码固定到既有审计版本 `fa6a1e9ec12d23f98326a9b26e243acb0819e105`；没有安装 hook、运行 observer 或导入依赖。

- [AgentFormatter.ts](https://github.com/thedotmack/claude-mem/blob/fa6a1e9ec12d23f98326a9b26e243acb0819e105/src/services/context/formatters/AgentFormatter.ts)：短行呈现 observation 标识/标题，提供按需取详情的入口。其时间、图例和统计字段并非 RAH 必须照搬的索引成本。
- [渐进式读取设计](https://docs.claude-mem.ai/progressive-disclosure)：先看简短入口，再选取正文；文档的 token 节省数字是上游示例，不能当作 RAH 实测成绩。
- [project-name.ts](https://github.com/thedotmack/claude-mem/blob/fa6a1e9ec12d23f98326a9b26e243acb0819e105/src/utils/project-name.ts)：先找 Git 顶层，再取目录名；worktree context 合并 parent/composite 检索范围。
- [worktree.ts](https://github.com/thedotmack/claude-mem/blob/fa6a1e9ec12d23f98326a9b26e243acb0819e105/src/utils/worktree.ts)：解析 `.git` 文件与父仓库关系，不能仅凭任意 cwd basename 判定项目。
- [维护者议题 #3608](https://github.com/thedotmack/claude-mem/issues/3608)：截至研究时仍为整改计划，指出 capture、sync、retrieval 项目规则不一致、目录同名碰撞、worktree/子目录碎片化和重复注入等问题。它提出统一 resolver 与 alias，但不能把计划当成完成的能力。

采用：有界短入口、按需取详情、读写共享身份解析的原则。不复制：以工具流水/Provider session 为 memory owner、目录名作为唯一键、当前时间反复改变注入头、全部元信息常驻、将整改提案冒称稳定实现。

## 4. 对 RAH 的裁决

1. 保留一份 Agent memory，项目提示可选；没有项目的普通对话不受影响。
2. 同一项目可有多个 checkout/路径别名；不同但相关的项目只建立关联，不自动合并事实或扩大 ACL。
3. 明确绑定优先；Git/worktree 关系仅提供证据；目录同名、共同 remote、相邻路径都不足以单独证明相同项目。monorepo 和 submodule 允许显式划分。
4. 同一事实不因关联多个项目复制成多份笔记。
5. 模型看短名称/摘要/相对笔记路径；完整路径、长 ID、别名清单、来源细节按需查看。
6. 先实现可测的总预算与完整条目呈现；不先引入分类模型、知识图谱、向量服务或每条消息一次自动整理。

## 5. 实施前差距

- 当前已有启动 cwd、冻结 Workspace mount 引用，但没有独立的项目别名/关联协议；产品 Workspace 不能冒充 Git 项目。
- 当前 `4 KiB` 仅为写作目标，`64 KiB` 为 cleaner 告警；尚无实际启动视图上限。
- 当前提示词直接要求读原始索引；源码/单测不证明模型每次只读相关笔记。
- 当前同 UID/full-access CLI 不是强隔离；有界索引不是“记忆关闭”或跨项目保密机制。

后续每一阶段必须单独给出证据，不以本文或 ADR 的落盘宣布所有能力完成。
