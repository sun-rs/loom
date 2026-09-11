# 语义寻址修复后的多 Agent 重复验证

后续裁决见 [Task 选择双边根因实验](./2026-09-11-task-choice-bilateral-root-cause.zh-CN.md)：Raft 同样复现原指令认领并转 Thread。下文保留当时的严格测试失败，不能继续将其直接计为 RAH 独有缺陷。

## 结论

原 A 审计回复串到 B，本次没有重现；这不证明唯一根因已消除。目标呈现阶段仍未收口：两个独立的新 Codex Agent 都在 Human 明确“不创建任务”的文件工作中创建 Task，并将最终回复转入新 Task Thread。不是跨 Room 错发，也不能按顶层回复成功计数。继续保持目标呈现与串线 → 原生忙时投递 → 严格双边组合 → UI 的顺序。

本批只增加验收脚本和证据，没有改生产逻辑或 prompt，没有提交或推送。

## 条件与结果

每个 Agent 使用独立临时状态、工作区和初始 Provider session，Host 实际凭据只授权该 Agent。预先确认 A、B、DM 成员关系。每轮 B → A 文件工作 → DM → A，每步跨全库检查回复落点、Thread、Run 数；结束等待 20 秒检查迟到回复。文件步骤先在空闲时将文件置为 WRONG，再要求实际修正。

| 对象                   | 实际模型 / effort                | 结果                                                           |
| ---------------------- | -------------------------------- | -------------------------------------------------------------- |
| 新 Codex 1             | gpt-5.6-luna / low               | B 通过；A 创建 Task、最终回复进入 Thread，失败；后续步骤未执行 |
| 新 Codex 2             | gpt-5.6-luna / low               | 同上，独立复现                                                 |
| 新 OpenCode 1          | deepseek/deepseek-v4-flash / low | 两轮八步通过                                                   |
| 新 OpenCode 2          | deepseek/deepseek-v4-flash / low | 两轮八步通过                                                   |
| 新 Codex 3，纯聊天对照 | gpt-5.6-luna / low               | B → A → DM → A 四步通过，无文件工作                            |

Codex 原生 turn_context 与 OpenCode 原生消息数据库均核实实际模型和 effort，不仅检查配置界面。纯聊天 Codex 四步耗时约 37.3 / 19.9 / 17.8 / 21.1 秒；每步一个 Run，未通过第二轮执行掩盖失败。两个审计失败样本还产生 Task 进度/提交消息；不能把这些当作重复的最终回答，但它们同样不符合“只回复”的严格场景。

## 上游依据与未决点

Raft Computer 1.0.18 提取文件：`/Users/sun/Code/repos/raft-runtime-forensics/artifacts/extracted/raft-computer-1.0.18-recheck-20260909/main.js`，SHA256 `20f16da1a37173925bb8707254329dd6e0df4b694c809c53b3f35f38ab00fd0e`。

`buildTasksSection`（735606 起，尤其 735611）要求超出纯回复的实际工作默认先认领 Task；735618 区分顶层消息与 Thread。735932–735936 的权限优先级允许被系统记录为 owner/admin 的用户设置或豁免平台策略。RAH `standing-prompt-compiler.ts` 同时存在实际工作先认领与 owner 覆盖默认规则。因此“先认领 Task”不能直接归为 RAH 自创缺陷。

失败轨迹显示，Codex 收到正确的 #agent-council 和 @owner 后，主动调用 task-claim-message，再使用返回的 Task Thread 发送最终结果。尚未证明：是授权身份呈现不足、默认规则与 Human 指令裁决偏差，还是 Raft 同条件也会如此。必须先做该指令在 Raft 的同条件实验及身份/Task 输出对照，不能用更多自研 prompt 或禁止合法 Thread 来掩盖。

本批不是 Raft 双边通过，也不是忙时投递验收；纯聊天对照成功不能覆盖实际工作失败。

## 测试与证据诚实性

最初脚本遗漏加入 Room A，403 是测试设置错误；加入成员关系预检后才重跑，原日志保留。另一次预期切换纯聊天参数的编辑没有成功，实际又跑了一轮审计；按第二轮审计记录，没有把它误标为纯聊天或删除。正确纯聊天对照另行完成。

证据：`/Users/sun/Code/reviews/rah_os/2026-09-11-target-repeated-verification/`。包含两轮审计日志、纯聊天日志、各临时状态的 evidence、失败全库消息及 Codex 原生模型/工具调用摘录。保留失败与未执行步骤，不只记录成功消息。

正式 4173 的重启后 Chrome 刷新、频道→DM→频道真实点击和历史恢复已补验，截图在前一批 target-presentation 证据目录。本批没有再次重启未变更的生产服务。

完整 `npm run check` 最终重跑通过；首次运行有一条启动间隔测试测得 39ms、小于 40ms，已保留失败日志，原断言未改变，单独六项及完整重跑均通过。`npm run format:check`、`git diff --check` 通过。这些默认检查通过不覆盖上面的真实 Codex 失败。
