# ROLE-BUDGET-1

- `loom cost` 和 `loom status` 按角色报告调用次数、原始 token、新输入和输出。Claude 写入缓存的输入计入新输入，估算费用仍按独立的缓存写入费率计算。消耗金字塔用最近一小时的调用次数和原始 token 比较 Auditor、Leader 和 Worker 合计。倒置提醒每项目每小时最多向 Super 投递一次，限频跨 loomd 重启保留。
- Auditor 默认每道门禁最多 3 次原生唤醒，上下文上限 150,000 token。唤醒从上次登记门禁完成后计数。上下文优先使用原生信号和 OAR 记录，缺失时用最近一次调用的输入量估算。超限时提醒 Leader 合并材料，由 Leader 或 Super 登记下一次门禁完成时生成换班建议。
- `loom gate pack <gate-id>` 以固定 Git 提交生成一份 ≤2 KB 的门禁包，汇总同名波次或屏障的证据卡、diff 统计、测试摘要、Reviewer 结论和待决问题。重复打包复用文件及投递 ID。Auditor 对已打包门禁发起的追加审查单独记录在通知账本，供 Auditor 查询。
- Leader 的启动提示和仓库内 Loom 说明将复现与全量测试交给隔离沙箱中的 Worker。Auditor 依据门禁包及 Reviewer 结论裁决，深入核查交给一名临时只读 Reviewer。

`npm test` 通过 348 项，失败和跳过均为 0。回归覆盖滑动窗口、Claude 缓存写入、重启后限频、Auditor 双预算、门禁边界、单次原生投递及追加审查留存。`git diff --check` 通过。

STATUS: done
