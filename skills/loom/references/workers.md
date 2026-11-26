# Worker 续作及授权

1. 续作和换人
2. 执行等级
3. 生命周期

## 续作和换人

R1/R2 局部返工且接口保持时发回原 Worker。仅在相邻小卡同领域同工作树、已用 ≤60%、累计压缩 ≤1、上卡无事实错误或越权时用 `loom send --next-card --reason "$WHY"`。

已压缩且剩余又 <15% 时在步骤边界取交接单。连续 10 分钟无进展可用 `loom worker-handoff "$TASK"`，确认造假或越权加 `--reason fabrication|overreach --evidence "$PROOF"`。换领域、方向被否、R3、造假或越权时新开卡并附精确 RED。交接单列任务、分支/基线、WIP、裁决及已过和待验收项。

## 执行等级

默认 sandbox。只需本卡进程树或测试临时资源时用 integration。host 要有当前卡或波的获准额度，外写路径另需列明，Leader 只可申请。已获授权用 `loom spawn worker --tier host`。

## 生命周期

确有续作才用 `--keep-warm`。无待办可用 `"$LOOM_BIN" release "$TASK"` 提前释放。缓存窗口结束及波次合入后的回收由 loomd 处理。
