# 最终回复提交后的崩溃恢复

2026-10-14。Kernel 是唯一 owner。故障复现：Worker 已提交 final，daemon
在 Activation 收尾前退出；旧逻辑在取得进程终止证据后无条件重新排队，可能重复调用模型。

恢复复用原 Activation 完成路径，不引入新队列、模型去重指令或假 ACK。
final marker 随写入保存认证 scope 的 consumer 和 delivery toSeq（schema 89）。
旧记录的新字段保持 NULL，不猜测历史凭据。仅最新 Run 的 marker、同 session
代际的实际消息写入、原 consumer 的持久 ACK 覆盖完整 Activation，且所有进程
终止、既有业务义务满足时，恢复直接完成原 Activation。RunAttempt 保持真实退出
结果；后继消息的 Activation 不合并进已完成工作。Task 不因 final 自动完成。

证据不足或义务未满足时保留既有恢复路径；不得以“存在一条回复”代替完成证明。
测试覆盖提交后崩溃、有/无后继消息、缺失 ACK/历史 scope/最新 final、代际围栏、
终止证明与升级保留数据。真实 CLI 请求中断和 HTTP 提交成功但响应丢失另列证据，
不将合成模型实验当作付费模型的质量或效率验收，也不保证任意外部工具副作用 exactly-once。
