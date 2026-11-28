# 统一待办与环节时限提醒（OA 式），设计草稿（2026-11-28，Super）

依据：
- 用户原话（2026-11-28）："这其实需要的就是一个办公 OA 系统里经典的提醒：你有一个待办，多久没办，每个环节多久没办，后台要来提醒，其实都是一件事。"
- 相关文档：2026-11-27-lifecycle-design-v2.md §3 的核对超时、IDLE-ALARM-1、DLV-CCP-1，以及 t17w 对 v2 的答复（DISCUSS-ANSWER-t17w-lifecycle-v2.md）。

## 0. 为什么是一件事
本周这些事故和设计点，形态都一样：**某人有一件事没办，没有人知道它卡了多久，也没有人被催**。

| 现象 | 待办 | 办理人 | 实际耽搁 |
|---|---|---|---|
| pilot-2 5 小时无进展（R45a） | needs-decision | Super | 约 5 小时 |
| 投给 Auditor 的门禁消息 2c0fc285 | 投递 → 收件 | loomd / Auditor | 约 10 小时 |
| pilot-cell 宿主机全量请示（754ec6d6 等） | needs-decision | Super | 约 8 小时 |
| 换班首报核对（v2 的"5 分钟 / 30 分钟"） | 核对 | 另一方 / Super | 设计期 |
| 积压的 needs-decision | needs-decision | Super | 最长 2 天，约 50 条 |
| 卡片原地待命 | 卡片下一步 | Leader | 不定 |

现在这些分散在 IDLE-ALARM、投递停滞、needs-decision 重提醒、换班超时里，阈值和升级路径各写各的。结果有的会重复轰炸，有的完全静默。

## 1. 模型：一张待办表
loomd 持久化保存每一条待办：

- `id`、`kind`：kind 取 decision / delivery / gate / handover-verify / card-step / host-run / approval 等。
- `project`、`subject`：指向哪张卡、哪条消息、哪道门禁。
- `owner`：当前办理人的角色别名，不用 hc 地址，这样换班时会跟着移交。
- `stage`：当前环节。每个 kind 都有固定的环节序列，例如 gate 是 已打包 → 待审 → 审中 → 结论 → 合入。
- `createdAt`、`stageEnteredAt`。
- `pausedFor[]`：暂停原因及起止时间，例如等额度或 429、CLI 冷启动、CCP 不可用、用户正在和 Super 对话。
- `escalations[]`：已经发出的提醒及其级别，用于去重。
- `resolvedAt`、`resolvedBy`、`resolution`。

规则：
1. **所有"等某人做某事"都必须落成待办**，不允许口头等待。
   - Leader 回 BLOCKED 或"等待 Super"时，loomd 自动建一条 owner=Super 的待办。
   - 发出 expect-reply 消息时，建一条 owner=收件人的待办。
2. **办结只有两条路**：对应事件发生（消息已收、门禁结论已出、卡片推进），或者办理人显式 resolve 并给出理由。不允许静默消失。
3. **转办**：owner 换人（换班、改派）时，环节计时不清零，并记一条转办记录。

## 2. 时限：每个环节一套 SLA，计时扣除暂停时段
SLA 表放在 policy.json，可以按项目覆盖。计时用"有效等待时间"，即墙钟时间减去 `pausedFor`。

| kind / 环节 | 提醒办理人 | 升级上级 | 通知用户 |
|---|---|---|---|
| delivery 投递 → 收件 | 2 分钟（已有） | 10 分钟 → Super | 60 分钟 |
| decision（owner=Super） | 15 分钟 | — | 60 分钟，按小时汇总 |
| gate 待审 | 15 分钟 → Auditor | 45 分钟 → Super | 2 小时 |
| handover-verify | 按 t17w：10 分钟没有首条输出判为启动失败；等 Super 核对按 2 个 Super 回合计 | Super | 有效等待累计 60 分钟时，让用户选"继续等"或"回退" |
| card-step（卡片无进展） | 30 分钟（IDLE-ALARM） | 2 小时 → Super | 4 小时 |
| host-run（待宿主机执行） | 15 分钟 → Super | — | 60 分钟 |

数字只是初值，讨论时再定。原则：
- **提醒只催，不替人做决定**。自动回退、自动改派这类动作，只在"明确失败"时触发，见 t17w 的意见。
- 每升一级，只发一次，并去重。
- 一次汇总列出所有到期待办，不逐条刷屏。

## 3. 呈现
- `loom todo [--project P] [--owner X] [--overdue]`：待办清单，按逾期程度排序，显示环节、已等多久、下一次提醒在什么时候。
- `loom tui --all` 的健康视图，以及各项目的 Status 页，改为读同一张表：谁手上有几件、最老的一件等了多久。
- Super 首页（以及换班后的新 Super 首轮简报）显示"你名下的逾期待办"。这正好也是 v2 第 2 节"机器实况 + 承诺清单"要的东西。

## 4. 与已有机制的关系
- IDLE-ALARM-1 的停滞告警、needs-decision 每 30 分钟重提醒、投递停滞（DLV）、v2 的核对超时，**统一迁移**为待办表里的不同 kind，不再各自计时。
- 遵守守护进程边界：loomd 只负责记录、计时和提醒，不做业务判断。是否回退、是否改派，由办理人或 Super 决定；只有"明确失败"才走代码路径。
- 不增加任何模型请求：提醒复用已有的投递通道，汇总成一条消息。

## 5. 讨论题
1. 待办由谁来建：全部由 loomd 根据事件自动建，还是也允许角色用 `loom todo add` 手动建（例如"Super 说过稍后汇报"）？
2. SLA 初值，以及要不要区分工作时间和夜间。
3. 用户通知走什么通道：桌面通知、Alma，还是只在 TUI 显示。
4. 历史积压怎么迁移：首版上线时，把现有未关闭的 notifications 导入待办表，然后一次性清理。
