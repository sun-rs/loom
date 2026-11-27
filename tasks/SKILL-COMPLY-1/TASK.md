# SKILL-COMPLY-1：把 skill 遵循率研究清楚并提上去

> **暂停（Super，2026-11-27）**：用户要求先讨论、参考他人经验定设计再实施；本卡待设计定稿后改写。

用户 2026-11-27："skill 也需要研究清楚，要能够遵循。"
已知（SKILL-SPLIT-1 三阶段）：拆分后"该读没读"从 19/30 降到 2/30；剩余失败主要是最终回复格式/关键词（单独一行 DONE、"合入"关键词），以及评测框架 Codex 组卡在审批（turn.started 后无 turn.completed）。长对话/压缩后是否遗忘从未测过。

## 要做（研究 + 改进 + 证据）
1. 失败归因：把三阶段全部失败轮按 {没读到、读了没照做、格式/结尾错、记忆或上下文遗忘、评测框架问题} 分类计数，附原文摘录。
2. Codex 组评测修复：exec 显式 approval_policy=never 与合适 sandbox，加"turn.started 后 60 秒无 item 判卡死并打印最后事件"；跑通 Codex 组。
3. 机械化格式：loomd 解析最终回复的状态行（DONE/BLOCKED/FAILED/PASS 等）；不合规时自动只请模型补那一行，或由 loomd 从正文提取并记录"格式已纠正"；评测里统计纠正前后。
4. 压缩后重注入：会话发生压缩后重新注入角色核心（复用记忆索引的压缩后注入机制；Claude 走 CCP 无 hooks 时用会话记录检测压缩）。
5. 长对话评测：新增场景——一个会话连续 30+ 回合并触发一次压缩，再考 5 个核心规则，三家 CLI（Claude 只经 CCP）各 1 轮，统计遗忘率。
6. 结论报告：docs/research/2026-11-27-skill-compliance.md，给出各因素贡献与改进前后对比。
分支 infra/skill-comply（基于合入 skill 拆分后的 main），显式路径提交，不 push。不读凭据，不碰 /Users/sun/Code/ccp。
