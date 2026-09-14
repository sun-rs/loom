# Computer 批量重启弹窗文案与按钮

## 来源与根因

来源：`docs/evidence/raft-web-20260831-current/MachineDetailPanel-CIacRrGS.js`
的 Na 批量面板，以及同目录 index-BoAC7nSE.js 的 machine.detail.bulk* 中文文案。
MachineDetailPanel SHA-256：`5c5aa52ffc2b3098a93c33bf619cfce0797d47ea1cf7e5fb2c72f1c097b417a8`。
Na 的取消与确认按钮使用 `btn-brutal px-4 py-2 text-sm`，图标14px、gap6px；
2px边框、20px行高、上下8px内边距合计40px高度。取消64px宽，普通重启84px宽。

此前本地复用单Agent的 AgentExecutionResetDialog，并将 Aet→Si 小按钮28px
用于批量场景；调用者又将“所选”拼入标题。这是两种上游弹窗规格被混用。

## 修改

- 共享弹窗增加显式 selectionCount，批量标题为“重启 N 个 Agent”，不从名称猜场景。
- 普通“重新启动”统一为“重启”，“完全重置并重启”改为“完整重置并重启”。
- 批量三个说明逐字采用 Raft 中文文案，去掉本地冗长的 MEMORY.md/notes 示例。
  全量重置选中后的本地项目保留边界警示仍保留，不改变安全语义。
- 仅批量 footer 采用40px高、14/20px字、16px水平内边距；单Agent保留28px规格。
- 业务回调、执行围栏、批量失败重试及幂等键不变。

## 验证

先扩展 `test-computer-selection-browser.mjs`，旧标题“重新启动 所选 1 个 Agent”
触发失败；实现后文案、两按钮尺寸断言通过，截图已检查。
Chrome/Firefox × 1440/390 的单Agent恢复4场景、Computer三种模式12场景全部通过，
包括拒绝/临时失败、不确定结果重试复用同一操作，以及文件保留/删除边界。
均为隔离fixture，没有对正式Agent执行重启或重置。

正式页面首次宽度复验发现重启图标继承16px，按钮为86px；按Na的14px图标
修正后，隔离回归与正式页面均确认取消64px、重启84px，高度均40px。

本轮最初的 `npm run check`、`npm run format:check` 全部通过。
最后补图标后，正式构建、专项浏览器回归、`git diff --check` 通过；
再次全仓检查被共享工作区中新加入的三条未登记sq-btn规则阻塞
（runtime-environment-row及channel-confirmation），格式检查另报
`scripts/test-agent-launch-settings-browser.mjs`。这些并发改动不属于本弹窗修复，
不将最后一次全仓检查声称为通过。

正式状态已备份，工作台已平滑重启并保留原有三类网络监听。
新Chrome页面在1440×900、390×844实测文案、尺寸及取消关闭通过，截图已人工检查；
没有确认正式Agent的任何重启/重置。正式构建为
`b1b1fa070773be7fb8ff2cb483d0f72b996360aace4e64aef1798e6e0cd6f76b`。
