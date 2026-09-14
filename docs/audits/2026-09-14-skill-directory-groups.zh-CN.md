# 技能目录分组标签与空状态

## 来源和改动

Raft 来源为已发布 [AgentDetailPanel-CVJr5D-b.js](https://app.raft.build/assets/AgentDetailPanel-CVJr5D-b.js)，SHA256
`e42e78339874cc0d43165b1005d8c246824c399d394eec826492abbe73615afb`。
分析副本中 `pc`（2651附近）使用 InlineCode 显示目录路径：字号11px、40%黑色，计数在标签外、间距8px。
主 bundle [index-MqTUR4Ez.js](https://app.raft.build/assets/index-MqTUR4Ez.js)（SHA256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`）
`$l/tDe`（55180附近）定义默认黄色50%底、1px强边框、横向6px内边距、等宽500字重。
这不是仅在hover时出现的背景；静止、悬停、移出均保留分组标签。源码中文空状态为“此 Agent 工作区内暂无 skill”。

本批采用结构与参数，不复制发布bundle，不新增上游资源；既有notice与资源provenance不变。
内部 `profile.css` 继续拥有这些样式，边框使用现有黑色语义token。
`skillSourceLabel` 仅将截图要求的 `~/.codex/skills` 及子目录显示为 `~/skills` 及子目录，
原始 `sourcePath`、分组key、实际扫描根和访问权限不变；title保留原路径，其他自定义或CLI路径原样显示。

## 验证

先复现目录没有code标签和简写函数，再实现。
单测覆盖Codex根/子目录、相似名称和其他路径不被改写。
`test-agent-skills-groups-browser.mjs` 用生产组件及有明确标记的无网络fixture，在Chrome/Firefox、
1440×900与390×844验证两个独立分组、源路径title、文字、1px边框、11px字号、6px内边距、
50%背景以及hover/移出稳定性。Fixture使用与产品相同的响应式容器标记；未调用真实Provider。
旧技能浏览器门禁的空状态断言同步更新，但本批不据此声称该旧完整门禁已运行。

`npm run check`、`npm run format:check`、`git diff --check`、
`npm run build:web:workbench` 已通过；sidebar-row、sq-btn组件规格门禁及UI目录构建通过。
核心测试1592项（1575通过，17跳过，0失败），Web单测410项通过。

正式构建 `a22f7e9b1844f743dc33ad824eb620a284cc3d3021124d5b94ad76bdca56c59e`
已由同仓库并行交付流程完成空闲检查、持久状态备份和优雅重启，本批核验其备份receipt及新进程，未重复重启。
新建真实浏览器页面分别访问本机、LAN和Tailscale三个正式入口，实际Codex资料的目录标签、原路径title、
默认/hover/移出样式和工作区空状态均通过，且页面构建标识与候选一致；截图已人工检查。
未运行付费CLI，未改变Agent配置或技能源文件。Raft依据为发布源码与用户截图，本批未做同视口在线双边验收。
