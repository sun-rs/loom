# Agent 环境变量与聊天任务开关收口

2026-09-13 用户将上一批研究建议收敛为环境变量：暂不提供 Provider 专属参数或原始 CLI 参数。Settings 启动信息维持只读，四卡片默认展开，Codex/Claude Guide 开关独立保留。

## 来源与移植边界

沿用[运行时研究](./2026-09-13-agent-runtime-options-research.zh-CN.md)的 Raft Computer 1.0.31 发布源码 URL、SHA256 和分析限定。Computer 的 `normalizeEnvVars` / `composeRuntimeConfig` / spawn 环境合成说明环境变量进入 Agent 进程；不是任意 CLI 参数文本编辑器。

前端证据为 `docs/evidence/raft-web-20260908-current/AgentDetailPanel-DSYPOiPi.js`（SHA256 `f65d89ca2784a6383173747778edbb263adcd514cf6ae0bc53e47e32bd0ac430`）的运行时表单调用：`envVarsMode:"advanced"`、`envVarsInjectedHint`。同目录 `index-BVfbaScj.js`（SHA256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`）的 `Dae → qL → _Ve / AVe` 提供环境变量提示、8px 行间距、KEY 三分之一宽度、等号、值输入、icon-xs 删除、ghost 添加按钮。结构移植到现有 React 表单，复用内部 Icon/按钮样式；不是字节复制，不把发布 bundle 引入生产。许可证与分析用途继承上述证据目录及复用账本，不声称获得中央服务器源码。

## 单一所有者与行为

- Daemon `RuntimeGuideSettings` 按 AgentDefinition + runtime 保存字符串环境变量；更新保留 revision 冲突检查和受控键保护。
- 全局及 Agent 历史自定义 argv 保留磁盘兼容，但不再读取到有效启动参数，也不接受 Agent 附加参数写入。系统生成的 argv、模型、推理强度和快速模式不变。
- `useAgentEnvironmentDraft` 仅持有表单草稿；“更多”包含环境变量，外层唯一“保存运行时配置”提交。名称重复或非法键阻止保存。Runtime 切换分别保留草稿，只有当前 Runtime 的变量提交。取消不提交。
- 环境变量与 Room Agent policy 分属原有 owner，不能伪装原子事务。环境变量先保存；若随后模型策略失败，明确显示环境变量已保存，并保留最新配置 revision 供重试。
- 下一次 Activation 的既有环境租约负责注入，运行中的进程不热改；不同 Agent 不继承彼此变量。未知变量能传入不等于第三方 CLI 会识别它。
- 聊天“作为任务”只改变发送意图，不再显示任务负责人面板，也不提交旧草稿里的隐藏负责人。正文 @ 文本保留，Task 仍由原有 `task.create` / Kernel 管理；没有新增从 @ 自动推断任务唯一所有者的规则。任务详情中的明确分配入口保留。

## 验证

后台退役测试先失败于 Agent 参数写入仍被接受，再通过。隔离子进程验证四个 runtime 的 Agent 环境映射；runtime-delivery-composition 验证 Activation 合成租约的变量能被子进程读取。这些都是假环境/子进程测试，没有运行付费 Provider。

浏览器脚本 `test-agent-launch-settings-browser.mjs` 验证统一保存、重读、遮罩、无参数编辑器、重复键拒绝、桌面与 390px；`test-composer-task-toggle-browser.mjs` 验证没有负责人区域、真实隔离 Kernel 接受任务且正文 @ 保留；`test-runtime-guide-browser.mjs` 回归默认展开和 Guide 开关。最终检查与正式重启结果于完成后记录；不将本地浏览器通过等同于 Raft 双边验收或真实 CLI 任务验收。

最终验收：`npm run check`、`npm run format:check`、`git diff --check` 和 `npm run build:web:workbench` 通过；上述三个隔离浏览器脚本通过，桌面/390px 截图已检查。正式实例空闲检查、持久状态备份与优雅重启完成，冻结构建 `8a46ff3b63399c462a8af5d7666fbb95221f2f1dc0d578a7d7e2dd2d9929827a` 在 loopback / 本地 LAN / Tailnet 地址的新 Chromium 页面验证：四个原有 Agent 保留、Settings 四卡片展开且 Guide 可用、Agent 仅环境变量编辑、聊天勾选任务后无负责人区域。正式数据未作配置写入；这证明本机三地址浏览器验收，不代替外部 iOS 蜂窝网络或 Raft 同条件双边验收。未提交 commit，未运行付费 CLI。
