# Human Inbox + InputRequest 浏览器收口证据（2026-08-30）

结论：**actionable Human Inbox 已完成真实前后端闭环；它不是通用 Notifications 的替代品。**

## 真实链路

隔离 fixture 使用现有 `worker-task-input` fake Runtime，不调用付费 Provider：

```text
Human 在 Web 创建 Task 并指派 Alice
→ AgentHost 启动真实 child process
→ Worker API claim/start/request-input
→ Kernel 原子写 pending InputRequest + waiting_input + Human Inbox
→ Web 聚合全部可见 Room 的 pending InputRequest
→ Human 回答时先同步最新 Room seq，再 causal resolve
→ Kernel 写 input.resolved + Task todo + 新 Activation
→ 新 child 读取 answer，继续并提交同一 Task
```

## 浏览器结果

- `1440x1000`：rail badge `1 → 0`；NotificationCenter 显示问题、Room、Task 与回答入口；回答后 Task 最终为 `submitted`。
- `390x844`：bottom navigation 有可访问的 Inbox 入口；浮层边界为 `left=8/right=8/width=374`，`body.scrollWidth=390`；回答 textarea 获得初始焦点；回答后 badge 归零且 Task `submitted`。
- 浏览器 error/warn console：0。

## 所有权与限制

- Human Inbox 读取的是 Kernel canonical InputRequest；不读取 stdout、Provider prose 或 Computer-local Agent App Inbox。
- 当前跨 Room 聚合由 Client 对可见 Room 做有界 list；全局搜索/通知 index、push hint、已读/归档、任意 deep link 尚未实现。
- `查看 Room` 是当前 Room navigation；未来全局 deep link 必须使用 typed target，不得把任意 URL 当业务 identity。
