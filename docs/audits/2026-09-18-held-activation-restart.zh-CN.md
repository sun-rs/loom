# 暂停通知不应阻塞正式重启

## 原因与边界

Agent Council 的唯一 queued Activation 来自 Room seq 583 的 task.cancelled，
是 Human 撤销误认领后的 task_updated 通知，目标为 OpenCode。运行尝试为 0、租约为空。
同 Room 已有 stopped SOS 和持久 hold；现场所有活动 RunAttempt、RuntimeProcess、
Placement 和独占操作租约均为 0。它没有实际占用执行资源。

Kernel `placement-candidate-projection.ts` 明确排除所有存在 SOS hold 的 Room。
重启检查却无条件拒绝 queued，导致这个不会被调度的通知一直挡住界面修复部署。
此前建议取消该通知并非必要：队列和暂停本来就是持久状态，可以原样保留。

## 修复

唯一 owner 是 daemon 的 `assertWorkbenchRestartable`。只允许租约全部为空，且
hold 与 stopped 操作属于同一 Room 的 queued 通知保留；普通待调度 queued 仍阻塞。
stopping/resumed、错 Room、残留租约均拒绝，原有运行中进程和执行占用检查继续生效。
备份、备份校验、账本复查、停止前二次检查和 SIGTERM 正常退出流程均不改变。
严格恢复检查 `assertWorkbenchIdle` 不放宽。不取消通知、不移除 hold、不唤醒 Agent。
这是 RAH 部署检查对既有 Kernel 调度不变量的修复，不改变 Raft 产品交互或调度算法。

## 验证

测试先在旧实现以 Active work in activations 失败；修复后通过，验证暂停通知保留、
非法 hold/操作/租约拒绝及原有执行 owner 拦截。全量检查、正式备份重启和入口验证
结果在完成后追加。
