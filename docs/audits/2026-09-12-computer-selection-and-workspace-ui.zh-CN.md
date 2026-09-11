# Computer 选择、工作区与操作区收口

## 来源

Raft Web `docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js`
（SHA256 `5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8`）
包含选择时整行触发、选择底色、批量重启/重置、三行工作区及删除确认。
本次以用户双边截图和该组件为输入，没有重做整页。

Raft Computer 1.0.18 forensics
`packages/daemon/dist/chunk-ZHWD6VKE.js:11443` 的
`summarizeWorkspaceDirectory/scanWorkspaceDirectories/deleteWorkspaceDirectory`，
以及 34178 的 `scanAllWorkspaces` 与 41293 的 `machine:workspace:delete`：
删除数据目录下指定工作区，返回成功结果；不是 full reset/restart。
Multica 与本页相关替代实现的比较沿用
[既有 Computer 来源审查](2026-09-07-computer-alignment.zh-CN.md)。

## 修复及本地差别

- 动态“全部已读”使用共享 btn hover/active；禁用条件仍有效。
- Task 频道选项增加 # 前缀。
- Computer 选择模式整张 Agent 卡片切换选择，退出模式后恢复打开资料；
  选中浅蓝，卡片最低 56px，使用现有批量执行 owner。
- 当前错误观测时，读取有界 trajectory 最近 100 条中的最新错误详情；
  无可用详情时仅显示运行异常，不解析聊天或伪造 Provider 错误。
- 工作区三行：名称与状态、目录、大小/文件数/修改时间。
  ACTIVE 依赖已有 presence，只有启用配置不足以证明 ACTIVE；未知显示 UNKNOWN。
- 操作区仅保留复制诊断与重启服务，同一行；重启珊瑚红。

工作区删除复用既有 `agent.memory.reset`，它实际上移走当前扫描的 Agent
私有工作区、清除 Provider continuity、不启动 Agent、不删 Room/Agent 身份。
确认框明确清除文件、私有记忆和旧会话续接。不同于上游直接递归删除，RAH 保留
执行 fence、幂等、隔离目录与回滚保护。不是新增算法或假冒 Raft 原码；这也是一项
明确的本地适配。隔离备份的物理回收，以及已删除身份/孤儿目录的机器级枚举，
仍非本次扫描接口的能力，不宣称已复刻机器级所有目录清理。

## 验证

- RED：选择模式点击卡片后打开资料，checkbox 消失；修复后卡片点击选择及弹窗通过。
- 独立临时 daemon + Fake CLI：批量 restart/session/full 三模式，Chrome/Firefox、
  1440×900/390×844，共 12 组合通过，包含幂等与实际文件状态断言。
- 工作区删除浏览器：取消保留，确认收到真实 memory.reset 回执，再扫描为 absent；
  只操作临时 fixture，没有删除用户正式工作区。
- 新页面错误文字使用实际诊断接口；本批没有启动付费 CLI 制造真实错误。
- 全仓 gate 的既有 UI spec ratchet 与旧 matched-rules hash 仍需单独收口，
  格式检查还有在途 ui-catalog 文件；不冒称全仓通过。
