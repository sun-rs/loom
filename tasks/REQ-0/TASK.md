# REQ-0：合成 loom_new 需求清单（来自 loom-next 亲历者访谈 + 实验）

## 输入（只读）
- 亲历者回答：~/.loom-next/runs/loom-next/briefing/ 下 ANSWER-t17w-worker-history.md、ANSWER-t17g-worker-history.md、ANSWER-t17w-painpoints.md、ANSWER-t17g-painpoints.md、ANSWER-t17w-midturn-messages.md。
- 实验：/Users/sun/Code/exp-relay/runs/20261124151218-59651/REPORT.md（第 1 轮）；如 runs/ 下已有第 2 轮 REPORT.md 一并引用。
- loom_new 现状：README.md、docs/PROTOCOL.md、tasks/*/RESULT.md（RELAY-0/1、TUI-HOOKS-0、DRV-*、ORCA-EVAL-0）、skills/。

## 交付 `docs/REQUIREMENTS.md`（中文）
1. 路线定位一段：hc（PTY holder）+ 薄 loomd + skill；Orca 作零件库/参考；调度方法论在 skill，daemon 只做机械事实。
2. 痛点合表：合并两人 Top10，去重，每条：现象、证据（引用原文件出处）、根因归类（CLI 固有/设计自伤/角色纪律/流程）、loom_new 归属（daemon / skill / 基建 / 不做）。标出两人一致与分歧之处。
3. P0–P2 需求清单：每条有可量化验收标准（采用访谈给出的数字，如 0 丢信/0 重复/0 死锁、卡死 60s 检测、裸 hc read 降 ≥90%、L1 摘要 ≤400 tok、8h 介入 ≤1 次、核心 ≤1000 LOC 等），并标注 loom_new 已有的基础（relay、loom-transcript 解析层、tui-hooks、drivers）及缺口。
4. 明确不做清单（合并两人，附理由）。
5. skill / 提示词承担的清单。
6. 建议的里程碑顺序（每个里程碑 1–3 张任务卡粒度），单机达标前不做多账号/容器/GUI。
7. 两人分歧或需要用户拍板的问题列表（≤8 条）。
最后一行 `STATUS: done`；同时在 tasks/REQ-0/RESULT.md 写 10 行内摘要。

## 红线
只写 docs/REQUIREMENTS.md 和 tasks/REQ-0/；不 commit；不读凭据和任何会话记录；不使用 hc send/keys/kill；不修改 loom-next、rah_os。
