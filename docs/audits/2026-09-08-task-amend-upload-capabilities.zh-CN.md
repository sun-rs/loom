# Task 修改与上传能力查询：本批收口记录

本批对应用户八组差异中的第 1、8 项。
[完整依赖顺序](../product/2026-09-08-backend-eight-gap-plan.zh-CN.md)保留其余六项；
未把源码合同、官方运行行为和本地测试合并成一个“已对齐”结论。

## 来源与实现

Task amend 依据 Raft Computer 1.0.18 `agentApiContract.ts:416–427,1703`、
发布 prompt 的当前可发言成员规则，以及官方 TaskModalHead 的
`changes[field].from/to`。上传查询依据同版 `attachmentUploadContract.ts:39–44`、
Agent API 2019–2027。性质为合同结构适配与 RAH 接线，不是原样复制 Server 实现。
上游 hash、Multica 具体对照、RED/GREEN 日志保存在下方专项报告。

- Kernel 的 Task amendment owner 原子修改当前卡片并追加精确修改历史。
  Human 与 Worker 共用事务；标题 trim，说明保留原文并允许清空；当前成员、执行围栏、因果检查和幂等检查继续生效。
  原 Message、负责人、认领和 Task 状态不随修改改变。修改通知沿现有 `task_updated` 投递给非修改者的当前负责人；这属于本地已有投递模型的适配，不宣称已实测 Raft 全部通知收件人。
- 修改历史复用已有 Human/Worker 读取投影，没有第二个历史 owner。
  合法完整前后值可能超过原读响应上限，因此 Task history 使用独立有界预算。
  Room 同步按完整事件前缀分页，保留实际 snapshot/envelope，cursor 只到本页最后返回事件；不截断正文，不因响应成功而自动 ACK。
- Worker 上传 capabilities 返回 `directUploadEnabled=false`、阈值 `null`、
  `maxBytes=209715200`、预约时长 `3600` 秒。
  限额与真正预约路径共享常量。查询不创建预约、写事件或推进已读。
  false/null 明确表示没有预签名对象直传；一小时是本地预约值，不推断 Raft 中央服务配置。

## 验证边界

专项确定性测试覆盖修改权限、冲突、重放、失败回滚、历史完整性、撤销、归档与重开，
以及真实 HTTP 和外部 Node Worker CLI 子进程；未调用付费模型。
主审另在隔离临时服务上验证 Chrome/Firefox：API 修改后现有 Task 详情更新，刷新保留新卡片，历史接口返回准确前后值；截图经过查看。
本批未新增前端标题/说明编辑控件，也未宣称历史时间线视觉已完全复刻。

官网浏览器本轮只确认了 Task 状态菜单和两处 Files 空态。
未执行 Task 删除；未验证非空附件评论、锚点及解决动作。
当前 Web 删除 reducer 可证明它与关闭不同，不能证明未知 Server 的物理删除和连带处理。
因此删除、Agent 静音、Worker 搜索/跨 Room 寻址/资料补齐、附件评论仍未收口。

## 证据

- [主审日志、官方观察和双浏览器结果](/Users/sun/Code/reviews/rah_os/2026-09-08-backend-eight-gap-closure)
- [上传查询专项](/Users/sun/Code/reviews/rah_os/2026-09-08-backend-gap-closure/upload-capabilities/closure.zh-CN.md)
- [Task 修改专项目录](/Users/sun/Code/reviews/rah_os/2026-09-08-backend-eight-groups/task-amend)
- [独立 Task 事务与同步审查](/Users/sun/Code/reviews/rah_os/2026-09-08-backend-gap-closure/task-amend-independent)

## 总检查与正式交付

`npm run check` 最终通过：包测试 1,056 项通过、5 项付费门禁跳过；Web 383 项、历史回归 34 项，以及格式外的协议、权限策略、双边工具检查通过。
初次全检因旧 CLI 超限测试仍把 512 KiB 用作 sync 上限而等待未关闭的流，已停止该测试进程；改为分别验证普通读取 512 KiB 和 sync 2 MiB 的超限取消，并保留凭据不泄露断言，再完整重跑通过。
`npm run format:check`、`git diff --check`、正式 Web 构建通过；Firefox 持久工作台门禁通过。

正式实例确认空闲后，使用既有操作流程备份并优雅重启，PID 从 `39102` 更新为 `62026`，
Web 构建为 `694423e5dd3563968cfcbfa464ea00c0af59c7c03e2ce04a22c989ecb2821878`。
备份为 `/Users/sun/.rah/backups/pre-restart-55c8262a-45df-45bb-830a-855394cd1e24`。
重启前后 canonical 表、Runtime 配置、用户配置与 37 个私有记忆文件的数量/hash 一致；1,219 个冻结源码/测试/资产文件 hash 未发生未验证变化。

新的 Firefox 页面在 1440×900、390×844、DPR 2 下读取正式 Computer、Task 历史和 Search 页面，
刷新、构建 ID、零 page error 与只读验收权限策略均通过，截图已由主审查看。
这证明本地正式实例交付，不代替尚未进行的 Raft Server 权限/删除/评论实验。
没有 Git 提交、推送或付费模型测试。
