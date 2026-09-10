# 前端续批：频道入口、Settings 与 Reminder

基线提交 `951ad8b`。仅续修已取证的 UI，不调整 Task 权限、状态机或 Worker 接口。

## 来源及实现

- 频道：上一轮 Chrome 实际 `all` 行的 DOM 只有选择频道按钮，无铅笔；顶部存在“频道详情与设置”。移除本地行内重复编辑按钮及预留宽度，保留顶部原业务入口。`chat-surface-parity` 更新后先失败、修复后 8 项通过。
- Settings：`docs/evidence/raft-settings-20260905.js` 的 `Xr` 使用主 bundle `KF/Av`（`gR` 样式：`gap-1`、`px-2 py-1.5 text-xs leading-4 border-2`）。本地字号控件对齐 4px 间距、32px 高度、无阴影。预览使用显式静态在线样例，不影响真实 Agent presence。
- About：同一 Settings bundle 的 `qt` 对应 `index-BVfbaScj.js` 的 `hqe`：`border-black/30 bg-white px-4 py-3`，interactive=false 无 hover shadow。仅为 About 三张卡增加只读样式，未改变可编辑表单卡。
- Help：已有本地反馈页增加帮助菜单入口；链接目标仍是本地 Settings，不向 Raft 传诊断信息。
- Reminder：`AgentDetailPanel-DSYPOiPi.js` 的空态使用 `En`（主 bundle `Ng`），28px bell，48/24px 内边距，图标间距16，标题18/28、600、black/60，说明14px relaxed、32ch、black/60。移植参数到现有空态，保持提醒查询与点击业务不变。

以上为结构/参数移植，不是逐字复制完整组件。主 bundle SHA256 沿用前批证据 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`。授权来源仅用于分析，运行不依赖外部工作树。

## 验证与边界

Settings Chrome fixture 在 1280×800、390×844 验字号几何、选择后刷新持久化、预览状态点、About 卡片、反馈入口与 Escape；先失败8px≠4px，修后通过。追加预览在线断言发现原实现仅显示灰点，补明确静态样例后通过。

Agent Chrome fixture 在1280与390宽度验原三模式及Reminder字号。Reminder先失败14px≠18px，修后通过。中断任务曾添加reset448px和create16px断言，但其当前来源未定位到对应组件；已移除未证实的假设测试和无用fixture分支，未把改变断言冒充产品修复。

整体门禁与正式重启在最终交付时另行记录；fixture通过不等于新一轮官网同条件双边验收。

## 仍未收口

- Agent 创建表单完整字体/高度、重置弹窗几何及选项表现，仍需对应组件源码或同条件实操证据。
- Task 历史：Human history 当前复用 Worker 的倒序冻结分页。官方UI按服务端events顺序显示，前后值来自payload.from/to；不得倒转当前页或从上一行猜旧值。正确修复需要Human查询合同与事件投影支持。
- 已提交Task改派：本地UI与Kernel均有限制，官方可见编辑器不能单独证明写入成功；需官方实操后调整业务合同，不能单纯启用按钮。
- 文件预览成功条件、Computer创建者、其余页面族未复核差异仍保留此前清单，不宣称全产品完成。

## 最终交付检查

`npm run check`、`npm run format:check`、`git diff --check`、Web build、业务 Chrome gate 通过；修改预览样例后另跑 typecheck 与 Settings Chrome fixture 通过。正式实例经空闲检查和已验证备份后优雅重启，保留持久目录。Chrome 页面读取构建 `4e9700fed36fbdb491383ce5fe0b90c991c4568f391953c07c7275ec19429a78`，字号三个按钮均32×32且无阴影，预览online=true，截图已目视复核。正式频道行无铅笔，顶部入口实际打开原有详情与设置对话框。未进行新一轮官网全页面同条件验收，未运行付费模型，续批修改未提交。
