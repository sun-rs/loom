# 消息渲染修复后的正式重启

日期：2026-08-31。用户明确要求每批修复后重启；该流程已写入项目 AGENTS.md。

本报告更新此前[渲染与覆盖复核](./2026-08-31-rendering-regression-and-contract-coverage.zh-CN.md)和[presence复核](./2026-08-31-agent-presence-closure-review.zh-CN.md)的“尚未部署”状态，不扩大它们的功能验收范围。

## 备份与切换

- 正式入口仍为 `http://127.0.0.1:4173`，原持久目录 `/Users/sun/Library/Application Support/RAH OS/state`，不是4198 Fake CLI环境。
- 重启前核实：1个completed Activation、1个exited Run、1个terminated RuntimeProcess、0个Task。没有停止正在工作的Agent。
- SQLite一致性备份及配置/supervisor副本：`/Users/sun/Library/Application Support/RAH OS/backup-before-presence-R2Ym1X`。两份数据库integrity_check均为ok。没有清空历史或重新初始化身份。
- 优雅停止精确原进程62903，确认旧进程和4173监听均消失，再启动固定新资产。新Web资产为 `.workbench-web/874a88df337bf48d7c9004922d37246bd778a1a2f00661ff6096abce7babcbf8`，正式DOM入口 `/assets/index--LK39FJw.js` 与快照一致。
- 首次启动后逐表比较备份：2个Workspace、3个Room、8条Membership、2条Message、4个AgentDefinition、8个Revision内容完全相同；配置、凭据及supervisor中的8个普通文件逐字节hash相同。

## 重启验收新增反例

首次重启实际页面显示其他Agent“休眠”，Codex却为“状态未知”。原因是presence先拒绝旧Host generation，再检查历史Run已结束；服务正常重启使已完成历史失去休眠呈现。

先增加失败测试：健康Host从g1更换g2后，已exited/cancelled Run仍应idle；原实现返回unknown。修正Kernel只读presence检查顺序后通过；活跃旧Run仍受generation fence，Host失联/停止仍优先，不改变Task或执行状态。完整check重跑通过后，优雅停止首次新进程90647，再启动修正版。没有以改数据库或伪造状态解决。

## 门禁与浏览器范围

- `npm run check`：811项，809通过、2项opt-in跳过、0失败，TypeScript通过。
- `npm run format:check`、`git diff --check`通过；复用已通过构建和浏览器稳定性回归的固定Web产物，第二次仅改变Kernel终态判定。
- 首次新页实际读取四家Agent目录，进入原Codex DM，恢复原有两条消息；头像打开默认动态侧栏，历史命令/文件/输出可见。打开资料运行时编辑弹层后取消，没有保存配置或发送新消息。
- 本轮不调用真实模型，不把历史消息当新运行测试；不在正式库植入图表或Fake CLI探针。图表稳定性仍引用上一轮真实浏览器失败→通过证据与本次相同资产身份。

最终进程为93243，正式4173监听和health online均确认。第二次冷加载原Codex DM（实际1049×1172）后，四个Agent及消息/标题头像统一显示“休眠 · 等待唤醒”，不再有“状态未知”；原有两条消息仍在，实际截图已查看。再次比较上述六张业务表及8个私有文件均与备份一致，integrity_check为ok。没有将本次实际尺寸写成1440或390，也不扩大为全站双边验收。

用户常驻规则是“验证→安全重启正式实例→新页实测→交付”；不能再以保留测试端口代替正式交付。提交/推送和付费测试仍需各自授权。本轮未提交或推送。
