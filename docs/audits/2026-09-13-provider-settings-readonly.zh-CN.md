# Provider 启动配置只读（2026-09-13）

> 后续纠正：只读范围仅限启动命令、附加参数和环境变量。误删的 Guide 忙时投递开关现已恢复，下面“全局更新拒绝”仅指启动配置更新。

## 决策及来源

用户明确撤回此前全局追加参数/环境变量方案。Settings 管理页仅展示系统固定启动参数和环境变量；Agent 运行时配置独立编辑。此决策取代同日较早的全局继承设计，不将历史审计当作当前合同。

Raft 来源 https://app.raft.build/ ，冻结 `docs/evidence/raft-web-20260908-current/AgentDetailPanel-DSYPOiPi.js`，SHA-256 `f65d89ca2784a6383173747778edbb263adcd514cf6ae0bc53e47e32bd0ac430`：`Fc` 从 `agent.envVars` 读取并以 `updateAgent(t.id,{envVars:…})` 保存，支持 Agent 所有权证据；没有可核验的后端全局合并算法。Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `packages/views/agents/components/agent-detail-inspector.tsx` 使用 Agent inspector/runtime 信息，未作为本次配置 owner 的替代。发布 bundle 仅分析，未复制代码或新增上游依赖；沿用仓库来源许可记录，本次是 RAH 本地范围收缩。

## 单一所有者与兼容

- daemon RuntimeGuideSettings 拒绝无 Agent 身份的全局更新（conflict），不改变 revision 或磁盘状态；API 原有 Human 权限与 Agent 存在性检查不变。
- 历史 `additionalArgs`、`environment`、`overrides` 原值保留磁盘，但不再展示、继承或应用；保存 Agent 不改写这些历史字段，也不自动复制到所有 Agent。
- Agent 配置仍按 AgentDefinition + runtime 隔离，保护系统参数，保留版本冲突检查和原子文件保存。下一次启动生效，当前进程不热改。
- Settings 展示 `providerLaunchDefaults` 与 `providerLaunchPolicy` 的固定值，不展示进程继承的凭据、动态 Worker token 或具体 Run 的运行参数。Guide 编辑入口与启动配置独立，支持的运行时可开关；旧投递偏好继续保留。
- Agent 编辑器移除全局模式及继承文案，模型策略、环境变量遮罩保持原有逻辑。

## 验证

daemon 复现测试先失败于全局写入未拒绝及旧覆盖阻断 Agent 保存；修复后通过。覆盖旧数据保留但无效、独立 Agent 保存/重启重读、其他 Agent 无泄漏、清空、受控字段拒绝和 stale revision。

`test-runtime-guide-browser.mjs` 覆盖桌面与 390×844 下只读命令/环境、展开、刷新及无编辑控件；`test-agent-launch-settings-browser.mjs` 使用临时 Kernel/假 Provider，覆盖全局 API 拒绝和 Agent 独立保存重读。未调用付费 CLI，未宣称在线 Raft 双边验收。

完整 `npm run check`、`npm run format:check`、`git diff --check` 与正式 `npm run build:web:workbench` 均通过。安全重启前确认无活跃任务，由重启器完成持久状态备份；原四种 CLI Agent 仍在。正式冻结构建 `aab7cfb66260fe24cb939613dd2bf1ed1d6f3eb590143f0fb72d859ab1e9cccb` 的 loopback、本地 LAN、Tailnet 三个入口均经新 Chromium 页面验证管理页只读及 Agent 编辑入口，正式页面没有保存配置。检查了窄屏截图和无横向溢出；这些是 Mac 发起的检查，不等于 iPhone 5G 链路验收。

## 忙时投递开关恢复

用户指出此前将只读范围错误扩大到 Guide。恢复原 `rah-runtime-guide-row` 独立 checkbox 与已支持 CLI 的 enabled 更新，启动参数和环境变量仍只读。后台仅允许不带 Agent 身份、且不含任何启动配置字段的 enabled 更新；拒绝混合写入、未支持运行时及过期 revision。Agent 作用域不能修改全局 Guide。复用原 daemon owner、持久保存及前端 generation/pending 防重和失败重读，不创建第二套投递逻辑。来源沿用 [Guide 源码对照](./2026-09-11-runtime-wait-guide-source-matrix.zh-CN.md)，此开关本身是本地扩展。

测试先复现 Guide 更新被只读 guard 拒绝，再验证独立关闭/开启、重启读取、CLI 间隔离、stale/不支持拒绝及混合写入不改变磁盘。浏览器验证鼠标及 Space 开关、禁用项、桌面/390px 和启动字段只读。

恢复开关后的完整 `npm run check`、格式、diff、正式构建及桌面/窄屏交互浏览器验证通过。工作台空闲后备份并安全重启，冻结构建 `95adddea67a5cf20d461bc309f6d98e5cb9027eac2a2dabb1d7541861a14cef3` 在三个正式入口的新浏览器页面验证 Guide 可用/禁用条件、启动字段只读和 Agent 编辑入口。正式检查没有切换用户的开关值；开关实际写入与保存使用隔离测试验证。

## 触屏滚动及只读字段间距修复

Management 是 RAH 自有只读启动信息页（沿用 Settings 家族与既有 Provider 卡片），没有将 Raft 环境变量编辑表单移回全局设置。发现 `.rah-runtime-launch-fixed` 使用 `max-height:160px; overflow:auto`，使长命令成为嵌套滚动区域。移除内部滚动和高度上限，使用 `pre-wrap` / `overflow-wrap:anywhere`，保留文本复制，长命令随 `.rah-settings-scroll` 整页滚动。不添加触摸事件拦截，也不改变 disclosure 或 Guide 的事件处理。

命令和环境变量各自使用字段容器，区块之间保留至少 16px；没有系统环境变量时不渲染标题和内容，也不显示“无固定环境变量”。沿用 managedLaunch 的唯一数据来源。

浏览器测试先复现空环境变量标题仍存在，再验证隐藏空行、字段间距和无内层滚动。隔离 fixture 增加长命令场景并以固定高度容器模拟产品滚动布局；Chromium 390×844 通过真实 touchStart/move/end 从命令文字区域推动外层滚动，WebKit 窄屏验证布局与滚轮传递。WebKit 自动化不支持移动模式 wheel，因此不以桌面 WebKit 的滚轮结果声称 iOS 真机触摸验收。没有修改正式配置或调用付费 CLI。本批完整 check 的后台测试通过；Web 源码归属断言因并行频道标题组件拆分仍指向旧文件而失败，调整为核验新 header owner 后，407 个 Web 单测复跑通过。其余 parity、正式浏览器策略、双边证据规则、类型、格式、diff 检查及正式构建通过。未把该分段复跑报告为修正后的新一轮完整 check。

空闲检查、备份和优雅重启后，正式构建 `ae8e909ec82747aa363953692c62cefb0112a60dafc09eaf707af8b2d4aec5a5` 在 Chromium / WebKit 的 390px 页面经 loopback、LAN、Tailnet 三个地址确认卡片默认展开、可折叠、无空环境变量占位、命令无内部滚动、无横向溢出。截图已检查。正式页面未切换 Guide 或修改配置；触摸长命令验证使用隔离 fixture。
