# 运行时配置入口、环境变量摘要与模型刷新

## 来源

Raft 官方 `https://app.raft.build/` 冻结 2026-09-08 bundle：
`AgentDetailPanel-DSYPOiPi.js`（SHA-256
`f65d89ca2784a6383173747778edbb263adcd514cf6ae0bc53e47e32bd0ac430`）中
`Fc` 显示环境变量名称与最多 8 个圆点，白底黑框、12px mono、横向换行。
本地保留遮罩展示；有意不移植含原始值的 `title`，并固定八点，不暴露值长。

`index-BVfbaScj.js`（SHA-256
`65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`）的模型 labelAccessory 使用 `ij(tone: icon)`，转成
`va(variant: ghost, size: icon-xs)`：24px 点击区域、零内边距、12px 图标，
禁用透明度 50%，无 sq-btn 边框和硬阴影。来源 key 为
`agent.runtimeModels.rescan`，不是凭截图估计图标大小。

本次是源码参数及结构移植，发布 bundle 仅作分析证据；不宣称逐字复制或在线双边验收。
沿用已核对的 Multica inspector 比较：其 SettingsRow 布局不替代 Raft 此处的 labelAccessory。

## 本地归属

编辑按钮原已存在，被共享 section 的 `margin-left:auto` 推至远端；
仅对运行时配置区覆盖为零，保留相邻 8px 间距及原编辑弹窗回调。
刷新按钮保留原异步锁、错误显示、重试能力，替换其外观。

`AgentEnvironmentSummary` 通过现有 `runtime.guide.read` 读取当前 Agent、当前 CLI
的独立环境变量，不混入全局变量。持久 owner 仍为 HostRuntimeGuideSettings，
不把启动配置写入 Room ledger。摘要仅保留键名，无原值 DOM/title。
切换身份/CLI 中止旧读取，旧身份结果不能显示到新身份。

编辑器保存成功后调用 App 既有 reload invalidation，列表页和右侧栏均重新读取摘要；
没有第二份业务配置或额外轮询。启动配置与模型策略继续按原有两个保存操作处理。

## 回归

扩展 `scripts/test-agent-launch-settings-browser.mjs`，先确认编辑按钮远离标题失败，
另确认刷新点击区原 12px 不符合 24px 来源的失败。修复后检查：
标题旁编辑入口打开原弹窗、刷新零边框/12px 图标/24px 点击区；
真实隔离 Host 配置保存后，关闭弹窗即显示 `LABEL=••••••••`，无原值 title；
重新打开仍能编辑原值，全局值保持不变；390×844 不横向溢出。
未修改正式用户环境变量，未调用付费 Provider 推理。

## 正式交付

完整 check、format:check、diff 检查与正式 Web 构建通过，现有模型刷新失败恢复浏览器门禁通过。
构建 `99cd6e622a862343a166cc7a72e831d8759a37bc9d44e7359a63695306e23910`
在空闲检查、备份收据 `pre-restart-b70713b0-2a45-46e1-9ce6-0fe621770109`
后优雅重启。三个正式访问入口的新 Chromium 页面均检查标题旁编辑图标，
打开原运行时弹窗，确认刷新零边框、12px 图标/24px 点击区与 390×844 无横向溢出。
正式截图已检查，取消关闭，不修改用户配置。环境变量保存与立即显示由隔离 Host 测试证明，
不把未执行的正式配置写入或真实 CLI 推理记为通过。原四个 Agent 与持久对话保留。

## 刷新状态视觉修正（后续修复）

同一冻结 `index-BVfbaScj.js` 的 `Dae`：模型 `labelAccessory` 内 12px 刷新图标在 loading 时使用 `animate-spin`；`belowControl` 使用 `mt-2 border-l-2 border-black/20 pl-2 text-xs text-black/60`。`ij` 解构并未透传调用处的 className，因此不能把调用处 `text-black/40` 当成最终图标颜色。RAH 将无边框图标正常颜色修正为黑色，忙时保留 50% 透明度；文字与图标继续由同一个居中 flex 行布局。加载提示移至模型选择框下，12px/16px、60% 黑、2px 的 20% 黑左线，文案按用户要求改为“正在检查此计算机上的模型…”。动画为 1 秒线性循环；系统要求减少动态效果时不旋转，仍保留状态文字和 aria-busy。

唯一异步 owner 仍是 AgentRuntimeDialog 的 refreshing / refreshLock，不新增请求或业务状态。加载结束（含错误）停止动画、恢复按钮；既有错误提示与重试保持。共享样式由 ui-tokens/profile.css 管理。

`scripts/test-runtime-model-refresh-browser.mjs` 先在原 40% 黑色断言失败，再验证正常对比度、图标与 label 中心差小于 1px、延迟请求期间动画/禁用/提示结构、错误后恢复，检查桌面与 390×844 截图。该脚本使用隔离 fixture 和人为延迟/失败响应，不调用付费模型。正式专项浏览器检查已通过。环境变量编辑回归、类型检查、格式及 diff 检查、正式构建通过。完整 check 首先遇到 CSS 证据/目录待刷新，再遇到并行频道功能的接口注册放错声明区；完成机械归位后，完整测试运行剩余 7 个失败均为新增接口或 schema 56 的旧清单/版本断言。补齐精确清单和版本后，对应 SDK/Core 与迁移测试复跑通过，剩余 Web 单测、parity、浏览器策略和双边证据规则检查分别通过；未声称修正后又完成一轮完整 check。

空闲检查及持久状态备份后正式实例优雅重启，新进程监听 loopback/LAN/Tailnet。冻结构建 `e776e77d27fb39def11dee42ce8704c6afaf0984c9846b79c3660caa3336ad73` 的三个入口均通过全新 Chromium 页面验证图标颜色、水平中心、原四个 Agent 和 390px 无横向溢出。正式页面只打开/取消编辑器，没有修改配置；动画和延迟失败恢复由隔离浏览器测试验证。本批未做在线 Raft 同条件双边验收，也未调用付费模型。
