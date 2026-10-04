# P109：Codex 提示式最终输出首轮失败

2026-10-05，owner持续授权。干净源码 `a062ecb1043d2273350d17921dc68aad9ae62d7e`，Codex0.160.0 / gpt-6-luna / low；固定P97题面和快照，原生三轮后Loom warm三轮计划。完整免费检查通过后才运行。**原生三轮完成，Loom第一轮失败，后两轮未启动；整批失败。** 没有同版本补跑。[原始脱敏结果](2026-10-05-final-output-p109.json)。

## 根因

模型正常完成本轮，输出项具有正确原thread/turn及 `phase=final_answer`，并非driver丢帧或host mode。实际字符串在body结束后提前关闭外层对象，再继续写 `,"final":true,"basedOnRoomSeq":4}`，不是合法JSON。

Host没有修补文本、补默认序号、重发或启动模型自我纠错。唯一Run正常exited，Activation进入quarantined/action-required路径；Kernel没有Room回复、final marker、held草稿或ACK游标。原生成功与业务完成分开记录，安全拒绝有效，但格式可靠性与最终送达失败。

## 已发生的用量

| 项目           |                 原生三轮 | Loom失败首轮 |
| -------------- | -----------------------: | -----------: |
| 完成生成       |                2 / 1 / 1 |            2 |
| 输入           | 22,121 / 13,570 / 13,878 |       27,456 |
| 缓存输入       |  9,728 / 13,056 / 13,056 |       11,008 |
| 未缓存输入合计 |                   13,729 |       16,448 |
| 输出合计       |                      756 |          502 |

产品数据由独立Kernel `run_attempt_usage`（两条）与原生rollout核对，gaps为空；gate在quarantine后没有填round.metrics不意味着费用为零。首代输入差+2,643是失败样本描述，不是验收通过。**不能拿Loom一轮除以原生三轮宣称成本下降**；没有有效Room replyAt，回复前后拆分不可定义。完成生成不等于独立观测的HTTP总请求数。

两边首轮同一个exec调用各读取指定两文件一次；原生后两轮零工具，Loom没有进入后两轮。固定文件hash相同，实际四个turn_context均为指定model/low。原生官方记忆关闭设置逐轮有证据，产品沿现有driver launch policy关闭；不把源码策略冒充独立捕获的完整子进程argv。原生三轮保持同一session；Loom仅执行首轮，不能证明其后两轮连续性。

## 内容与下一修复边界

未发表的Loom正文不能作为成功交付。其首轮还把已有整体mode深比较的loopback恢复测试描述为未证明列表，并提出依赖未来新增网络键的假设；两项不能直接算已证现存缺陷。原生三轮技术结论与回归标准基本正确，但不准确回撤了此前没说过的过强观点。不存在完整三轮质量通过结论。

本机稳定app-server schema确认 `turn/start.outputSchema` 可以约束本轮最终回复。P109后的新批次已复用Protocol schema，在生成前传入原生结构化输出约束，并通过[真实CLI＋假模型验证](2026-10-05-codex-output-schema-free.json)，真实provider效果仍待付费实证；不修补Host端文本、不新增纠错模型轮，必须另存验证，不能改写P109为成功。

原始目录：`/var/folders/ln/kr9m4x0d2bg353zcd3mzx_jr0000gn/T/rah-cli-efficiency-0lzchw`。原始result SHA-256：`1a66700b70a98b7e5af3c5184032b206e0fd7006976e492138779a676ee3a65f`。独立审计存于 `~/.loom/reviews/2026-10-05-final-output-product/codex/p109/` 与 `paid-p109/`。
