# t17w 审计：换班方案 v2 与提示词（2026-11-26，只读）
**版本说明**：loom_new main 是 `e2c34519`，ROT-TUNE-1 在 main 上只有卡片；实现都在 `loom-rot-tune` 的未提交改动里（基于 `a02748ea`，25 个文件）。下文“HEAD”指 main，“rt”指该工作树。

## 1. 方案 v2 的漏洞与易误读处
- **B3 几乎不会触发。** 条件是“>10 卡或 >4 子系统，**且**压缩 ≥5 次 / 24h”。t17g 7 天 21 次 CHECKPOINT，约 3 次/天。建议把“且”改成“或”，或者用 pilot-2 回放先校准阈值。
- **A 的“未批准合入”可以机械判定，不必靠人。** 受保护分支的 ref 变了，但没有对应的 `gate-complete` 授权记录，就是 P0。
- **D 的 650–700k 只适用于 Claude。** codex 窗口是 258k/475k，按 CLI 定高水位才有意义。
- **F 的“前任只读在线”和“新任不改规则”，模型做不到自律。** 必须由 loomd 拒绝：前任的 send/spawn/gate/merge 一律拒；新任改规则走锁，rt 已有 `rotation-phase-locked`，这个好。
- **F 的“另一方核实”可能死锁。** 另一方自己正在换班，或者被弹窗卡住时，没人核实。需要加超时，例如 30 分钟后转 Super。

## 2. skill 和代码与 v2 不一致的地方（行号指 HEAD）
- **SKILL:78**“上下文阈值默认 150000”是旧逻辑，v2 的 E 明确“不按剩余上下文换”。
  - rt 改成了“剩余比例 / 上下文比例”可配，默认关（`role-budget.mjs` 中未设置即为 NaN），但文字仍把它写成主要机制。
  - HEAD 的 `role-budget.mjs:17` 还在按 150k 或唤醒超预算触发换班。
- **SKILL:32、44、88**“首次失败…自行重试一次”与 v2 F“同阶段失败 1 次即停下报 Super”冲突。rt 没改。
- **SKILL:79**“按需要填写”，而 v2 要求必填；还缺“已否方案及原因”“用户偏好与可信度判断”。
- **v2 的 A、C、错开、防抖、在途改投，skill 里一条都没写。** 这些本来就该由 loomd 执行，skill 只需写一句“loomd 拒绝时按回执处理”。
- **应改为 loomd 机械执行的**：失败计数与停止、前任只读、规则锁、错开与防抖、在途改投、P0 合入检测、事实卡附带。

## 3. 交班模板和简报
- **缺必填项**：已否方案及原因；用户原话与偏好；对 worker 和模型的可信度判断；当前阻塞在谁身上。“首个动作”虽然有，但没要求写明触发条件。
- **最容易执行偏的一句是“随后等待投递”**：SKILL:87；`sessions.mjs` 里的 “Wait for Loom to deliver queued work.” 和 TUI 指针 “then wait for Loom deliveries.”
  - 如果首个动作是“派下一张卡”，又没有在途结果，继任就会一直空等。
  - 这句是 TUI 首条消息的最后一句，权重最高。
- **首行规则冲突**：角色指引要求首行写 DONE/PASS…，交接又要求首行写 HANDOVER-ACK。
- **原因码直接暴露给模型**：`self-rotation.mjs:177` 把 `budget`、`gate` 原样写进“换班提示（…）”，模型看不懂为什么要换。

## 4. 继任首轮提示够不够
- **“只核对”**：rt 加了“首轮只核对原件…另一方高管确认前保持只读”，方向对。但只在文件里写，TUI 首条消息仍以“wait”收尾。
- **核对之后**：没有任何一句告诉它“确认到达后做首个动作”，确认消息也没规定由谁送、长什么样。**结论：不够，会停工。**

## 5. 改写建议（原句 → 新句）
- **SKILL:78** “上下文阈值默认 150000，可用 … 调整” → “换班信号由 loomd 按 v2 规则发出；上下文和剩余比例只作软提示，默认关闭。”
- **SKILL:79** “按需要填写以下各项” → “以下各项必填，没有写‘无’”，并补上两项：已否方案及原因；用户原话、偏好与可信度判断。
- **SKILL:87** “附现查的 SHA 和路径，随后等待投递” → “附现查的 SHA 和路径；本轮只核对不决定。收到另一方的确认后，立即执行交接单的‘首个动作’，不等其他投递。”
- **SKILL:32、44、88** “首次失败…自行重试一次” → “失败即保持原职并停止重试，loomd 上报；本阶段不再发起换班。”
- **sessions.mjs TUI 指针** “then wait for Loom deliveries.” → “This turn: verify only, decide nothing. When Loom delivers the other senior's confirmation, immediately perform the note's first action.”
- **角色指引首行规则**后加：“Except in the handover turn, whose first line is the HANDOVER-ACK.”
- **`self-rotation.mjs:153`（rt:190）** “Take over this role at the recorded safe point.” → “按交班判断接任：首轮只核对，确认后执行首个动作。”
- **`self-rotation.mjs:175`** “在安全点” → “在当前卡结算后”。原因码映射成一句中文原因，例如“进入新阶段 G3”。
