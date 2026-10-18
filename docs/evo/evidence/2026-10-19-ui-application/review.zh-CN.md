# 官方 UI 规则应用

上游：`raft-ui@0.5.64`（MIT）、`botiverse/raft-source@a98ae003246a0360872a77d76dec2fccd0347ef7`（FSL-1.1-ALv2）；原始来源和授权记录保持在 adoption.json。

这是 Loom 接线层的参数归一，不是逐字复制官方页面。冻结的官方源码未修改。参数来源、具体采用语义见 ui-contract.json 的 actionBindings。

- 完整配置保存/取消参考 AgentDetailPanel；紧凑提交参考 CreateChannelDialog。
- 删除与变更确认参考 ConfirmDialog 的 sm 与 danger/warning；保留 Loom 原有修订、权限、unknown-write 防重及确认流程。
- 读取失败恢复参考 MessageSearchPage 的 SearchResultsBoundaryFallback；同语义适用于未知写入核实，不静默重发。
- 纯图标入口使用官方 icon recipe；Role 侧栏使用 Sidebar 的 24px 规格。
- 已有官方消息工具栏、Composer、筛选器、导航、文件树、Dialog/Drawer 和 CloseButton 保持原 owner；不全局替换 ghost，也不把所有控件压成同一尺寸。

覆盖角色、实例、聊天、任务、记忆、权限、收藏、用量、Side/消息列及文件操作的本地对应动作。源盘点不是视觉覆盖百分比。动态标签及全主题组合仍依赖对应浏览器检查，不宣称全产品逐像素相同。

TDD：新增动作规格测试首先因缺少绑定模块失败；实现后通过。过程中发现自动编辑重叠造成的 JSX 语法错误，在类型检查阶段修复，未部署。浏览器测试曾错误假设官方输出 data-size 及固定背景 class，改为实际高度／字体和场景标记，避免把内部实现误认成公开 DOM 契约。
