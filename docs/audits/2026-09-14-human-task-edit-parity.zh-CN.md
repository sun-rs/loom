# Human Task 状态和负责人编辑

当前规则已由 [2026-09-20 新版源码核对](2026-09-20-task-assignee-status-and-live-badge.zh-CN.md)修正：完成任务须先重开才能人工更换负责人。下文保留旧版本证据。

## 来源与证据边界

Raft 授权归档 `index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
格式化源码140681–140698：非guest可编辑，deleteAnyTask管理员有全部五状态，普通成员
另有迁移图。125702–125737：PATCH /tasks/:id/status 与 /assignee 是独立接口，
后者传 assignee:{type,id}|null，可选expectedRevision；todo无负责人切进行中走claim。
171655–171735：人类与Agent共同出现在负责人列表，不按任务状态禁用负责人。
沿用归档来源许可；本地是结构移植和RAH事务适配，非复制闭源服务端实现。

[官方任务文档](https://docs.raft.build/zh-cn/features/collaboration/tasks/)确认五状态、
单一负责人和任务消息/线程关系。Computer 1.0.18 agentApiContract还发布assign nullable
与expected_revision协议。未取得Raft服务端处理函数源码，不能把前端调用或用户观察写成
服务端事务实现已双边验证。Multica server/pkg/db的task体系以会话任务为主，不能替换RAH
Room-first执行隔离；本轮采用更直接的Raft接口语义。

## 所有者与行为

Kernel `human-task-edit.ts` 接入现有Human状态、分配和取消分配入口；同一事务完成Task、
Room event和通知派生，不新增业务状态存储。人工状态选择更新canonical state，旧workflow
触发器及矛盾校验保留。人工标记不证明Agent执行或提交；协议允许无claim的人工进行中、
无提交证据的人工待确认/完成。真正Worker流程不因此跳过证据要求。

五状态可双向转换；负责人可在任意状态设置为人类、Agent或未指派，不强制退回待办。
已有单负责人及次级角色排他保持。撤销旧claim后用已有停止请求隔离原Runtime，新claim
等待终止证明；编辑界面不等待整个停止流程。新轮通知仍通过原Inbox/Activation owner。
人工完成派生依赖就绪通知；回退后新claim重新检查依赖。已运行的其他任务不伪造回滚。

Web任务页、任务独立详情和聊天任务弹窗共用状态与负责人控件；菜单允许管理员全部
五状态。负责人采用共享选择浮窗、头像、人类/Agent与未指派，移除旧“安全改派”分支。
仍校验请求前任务版本，失败显示错误，不使用乐观假成功；后台幂等重放不覆盖后续修改。

本节取代历史task-workflow-canonical审计中“Human只能由submitted完成、只能由cancelled
重开”的产品限制。证据式completeTask/Worker限制仍保留，不能把人工菜单当作Worker捷径。

## 验证

新增后端测试先失败：五状态两两转换、各状态修改/清空负责人、人类候选。
实现后验证精确重放、冲突key/过期版本拒绝、旧Worker被fence、重复编辑仍保留停止请求。
前端限制测试先失败后更新实现；浏览器覆盖任务弹窗完成回待确认/待办、各状态改派、
刷新、消息徽章更新，以及1440和390布局。最终执行结果见交付记录。

补充源码参数：JD（155670起）在可搜索负责人模式使用240px共享人员浮窗、标题、
搜索人和Agent、4px间距、8px视口边界。当前控件使用这些参数、人类优先顺序与真实头像。
todo且未指派时人工选择进行中，对齐Raft前端claim分支：负责人变为当前Human，但不创建
Agent Runtime lease。聊天右键“标记完成/重新打开”同步使用人工状态接口。

## 交付记录

完整 `npm run check` 最终通过；旧“必须拒绝人工待确认/完成”的API与消息菜单断言
已明确改为用户要求的新契约，真正Worker权限/提交证据测试保留。格式、diff、组件
视觉规格、catalog与正式构建通过。Chrome/Firefox在1440与390均通过真实隔离后端的
状态双向切换、负责人修改、刷新、线程回复、失败恢复与键盘关闭检查；截图已核验。

正式服务完成空闲检查、状态备份和安全重启，冻结Web构建
`6da9b04d857c9e230d1da9b8e55d3ef561698affe09e701906a0dfe087077214`。
本机、LAN、Tailnet新页面均验证五状态菜单可用、240px负责人菜单及人员选项。
正式页只读检查，没有修改用户任务、发送消息或启动付费CLI。未声称Raft服务端源码
或同条件官方后端写入的双边验收。

最终头像展示复用WorkspaceEntities身份映射；补充类型、格式和真实浏览器复核，避免负责人菜单采用另一套默认Agent头像。
