# 频道添加成员面板对齐

## 来源与边界

用户提供 Raft 对照截图。已核查发布 Web bundle（本地分析副本
`/tmp/raft-20260916-audit/web-index.js`，SHA-256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`）
的 `slt` 添加成员视图、`zk` 勾选框、`V9` 名称描述。发布包只作分析，不加入产品依赖，
本次是结构与参数适配，不是字节级复制；未取得新授权或变更上游许可边界。

- 候选行 `px-3 py-2 gap-2`，名称 14px/20px、描述 12px/16px 单行截断；短窗口上下间距 4px。
- 勾选框默认 `black-fill`：白底未选，黑底白色勾选；候选行颜色仍由共享 member-selection ChoiceRow 管理。
- 已选 Agent 标签使用蓝底、2px 边框、12px 字体、6px 标签间距，可单独取消。以 participantId/agentId 绑定，不按名称合并。
- 添加按钮 14px/20px、上下 6px/左右 12px 内边距；搜索框沿用本地共享搜索输入参数并固定为 40px，避免外层表单样式撑高。
- 创建入口 2px 上边框、上下 10px/左右 12px、灰色 hover；复用 AgentCreateDialog，显示蓝色目标频道提示。

## 行为 owner

RoomMemberPage 只拥有临时搜索与选择。App 在打开创建弹窗时固定目标 Room ID/名称，
复用现有 agent.provision，再通过 runRoomMutationAtLatest + ensureRoomMembership 加入目标频道。
Kernel 仍负责权限、持久成员关系及通知。弹窗保存已创建 Agent ID；加入失败时显示错误，
重试完成后续步骤而不重复创建；取消创建弹窗保留添加成员页的选择。

## 验证

新增 `npm run test:web:room-add-members`：先复现粉色勾选错误，修复后验证黑色勾选、
蓝色标签取消、复用弹窗/频道提示、桌面和 390px 截图，以及真实临时 Kernel + fake runtime
创建后的加入失败重试（创建请求 1 次、加入请求 2 次）。没有运行付费 CLI。
类型检查、正式构建、CSS 组件参数门禁、diff 检查通过。完整 check 仍被既有
`/v1/worker/message-present` 登记项阻断，format:check 仍有此前 5 个文件。
原有大范围成员布局浏览器脚本在进入本次新断言前，已于“返回成员管理”按钮等待失败；
本次另设聚焦门禁，未把该旧脚本标为通过。

正式状态备份后重启，构建
`62c688601e678b8387e2455e769a5b5e7a7f62e40f0b62b92e396a52ff5ed854`。
新浏览器在 Agent Council 检查选择标签、创建蓝色提示、关闭后保留选择，并检查截图。
正式页面未创建 Agent 或修改频道成员；真实创建/重试仅发生于明确的隔离 fake runtime gate。

## 创建后加入频道提示横条规格修正

Raft 发布源码 `/tmp/raft-20260916-audit/web-index.js`
（SHA256 `7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`）
的 `create-agent-channel-context` 使用
`border-2 border-black bg-brutal-cyan/60 px-3 py-2 text-xs font-bold text-black`。
结构化移植到 ui-tokens 的 `.rah-agent-create-channel`：12px/16px、700 字重、
上下 8px／左右 12px、2px 边框；移除额外底部 margin，由已有表单 4px gap 控制间距。
保留现有 cyan 60% 白底混色。不是截图估算或字节级复制。

`test-room-add-members-browser.mjs` 在 1440px、390px 验证 computed styles；
修复前观察到 14px/normal 和上下 12px，复现断言失败。

验证：上述隔离浏览器用例通过，正式 Web 构建通过；完成持久状态备份与安全重启，
正式页面桌面和窄屏的横条字号、行高、padding 均通过，未创建 Agent。
全仓 `check` 仍阻于既有 `/v1/worker/message-present` 未登记项；
`format:check` 仍报告此前 5 个非本次修改文件；`git diff --check` 通过。
