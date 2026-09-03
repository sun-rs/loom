# ADR-0027: Task 工作流、执行阶段与注意事项分层

## 状态

已接受。

## 背景

Raft 的用户可见 Task 看板固定为五个工作流状态：`todo`、`in_progress`、`in_review`、`done`、`closed`。RAH OS 的既有持久化模型还包含 `claimed`、`waiting_input`、`blocked`、`submitted`、`completed` 与 `cancelled` 等状态。这些值混合了三类天然不同的信息：工作流位置、当前执行阶段，以及是否需要人类介入。

如果前端直接显示持久化枚举，就会产生 Raft 中不存在的列、标签和筛选；如果直接删去额外状态，则会丢失原子认领、等待输入、阻塞原因和取消栅栏等后端证据，并破坏 ADR-0011、ADR-0020、ADR-0021、ADR-0022 的并发与审阅约束。

## 决策

协议包是 Task 生命周期投影的唯一所有者。所有客户端都使用同一投影，不在页面内自行推断。

1. `workflowStatus` 是 Raft 对齐的五态公开合同：
   - `todo` → `todo`
   - `claimed | in_progress | waiting_input | blocked` → `in_progress`
   - `submitted` → `in_review`
   - `completed` → `done`
   - `cancelled` → `closed`
2. `executionPhase` 是正交执行证据：`idle | claimed | running | cancelling`。
3. `attention` 是可选的人类介入证据：`waiting_input` 或带原因的 `blocked`。
4. `cancelling` 只能由真实的取消请求所有者提供，不能从 `cancelled` 或运行日志反推。
5. 页面、筛选、颜色、列标题和可访问语义只消费 `workflowStatus`；执行与注意事项只能作为次级说明，不能创建第六个工作流列。
6. 现阶段保留既有八态存储与事件格式，通过兼容投影交付。只有在读写路径、事件回放、数据回填和回滚都可证明后，才考虑把三层结构持久化；不得用一次破坏性迁移替代投影。
7. Raft 的可见状态不意味着允许任意直接改写。Human 操作继续走现有 command、认领、提交、审阅、完成、关闭与重开所有者，不能用通用 PATCH 绕过 ACL、版本和运行取消栅栏。

## 结果

- Raft 的五列、标签、颜色和筛选可以逐项审计。
- RAH OS 保留本地多 Agent 调度所需的强一致性证据。
- Room Task、全局 Tasks、Activity 和未来客户端不会各自维护一份不一致映射。
- 后续若扩展执行阶段，只需扩展正交维度；除非 Raft 的公开合同变化，否则不新增用户可见工作流状态。
