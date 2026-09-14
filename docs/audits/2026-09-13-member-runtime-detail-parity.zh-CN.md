# 成员详情与模型目录修复

> Human 侧栏的适用范围已由[成员资料入口边界](./2026-09-13-member-profile-entry-boundary.zh-CN.md)修正：仅聊天使用侧栏，成员页使用整页资料。本记录中的成员页侧栏断言已被替换，其他历史证据不变。

## 来源与边界

Raft 2026-08-31 冻结证据：`docs/evidence/raft-web-20260831-current/MemberGraphSection-C1stxx0a.js` 的关系排行、刷新按钮；同目录 `index-BoAC7nSE.js`（SHA256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`）的 Vf 侧栏行、资料操作与快速模式。采用行为和样式参数的结构移植，不是逐字复制。原始发布 bundle 仅作分析证据，未成为生产依赖。

另检查 Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的 `packages/views/onboarding/components/use-runtime-picker.ts`：数据重取保留用户选择，但其首次自动选择不适用于本项目必须明确选择模型的要求。没有复制其实现。

## 所有权与实现

- 图表刷新采用 Raft 的 12/16px 字体、6px/10px padding、14px 图标；两种排行整行撑满，计数右对齐，12px 等宽字体、黑色 55%。
- 成员列表采用 Raft Vf 的 4px 行间距；不改变现有行高度。
- Human 点击与 Agent 共用 App 右侧 inspector 容器，HumanProfilePane 提供资料内容；不改变当前路由。三个 Agent 标题操作复用 HintTooltip，移除重复原生 title。
- OpenCode 模型选项显示目录原有 provider 字段，保留真实 binding id。
- 手动刷新沿现有 `host.runtime.list` 增加可选 `refreshOfferId`。Human application-service 转交 daemon；daemon 对同一 offer 合并并发探测，AgentHost registry 保存新 probe，Publisher 发布新 observation，旧 Placement 引用的 observation 不变。仅允许当前 revision 和相同 executable identity；升级可执行文件须重启。普通轮询不执行完整模型探测。
- 快速模式只在已验证模型目录发布 priority/fast 能力时可选，优先映射 priority；通过既有 Agent configure/modelIntent.serviceTier 保存。未选择模型时不猜默认模型。

## 验证范围

新增能力单元测试、Publisher observation 不变性/可执行文件更换拒绝测试、HTTP refresh 参数转发与校验，以及隔离浏览器的间距、tooltip、右对齐和 Human 侧栏检查。正式部署与最终检查结果见下文。未运行付费模型请求；不以模型目录探测声称真实推理通过。Raft 官网双边同条件实测尚未完成，以上视觉参数来自冻结源码。

### 本轮自动化记录

`scripts/test-member-ui-details-browser.mjs` 验证桌面行间距、tooltip、计数位置、Human 侧栏保留路由，以及模型刷新错误反馈和快速模式提交 priority；保存请求使用明确的失败 fixture，不修改正式 Agent。补查 390×844 截图。`test-trusted-reconnect-browser.mjs` 通过。

两个旧浏览器门禁未通过：local-workbench 在 Fake CLI 回复前超时（无 provider 协议记录）；LAN 门禁先要求旧 Agent Council 首页，试验改为 all 后继续要求已移除的局域网设备 Settings 页面。未保留临时放宽或恢复旧产品页面，不能将这两项标作通过。当前修复以专用隔离浏览器与正式入口验证分别记录，不声称旧门禁全绿。

## 正式交付验证

整套 npm run check 通过：核心测试 1572 项（1555 通过、17 个 opt-in 跳过）、Web 单元测试 407 项通过，回调回归 34 项通过。末次视觉修正后重跑能力单测、专用浏览器、两项组件规格、UI 库检查、类型检查、格式与 diff 检查，并重新构建正式 Web bundle。

正式构建为 `f191d9d857dca0bf24512f5c5e38d9b7e561885108cfd7b5f1ec63ece2498d39`。空闲检查后完成持久状态备份及平滑重启；继续使用原 `~/.rah/state`。新鲜 Chromium 页面逐一验证 loopback、本地 LAN 与 Tailnet 入口：原四个 Agent、原 Council 历史、Human 侧栏保留 Room 路由、标题 tooltip 和 Codex 快速模式可见。真实点击模型刷新返回 200；OpenCode 目录提供商显示在名称前，避免窄菜单将其截断。未提交 Agent 配置变更或发送推理请求。正式截图人工检查发现并修复复选框继承普通输入框宽度的问题，专用浏览器现在断言其 16×16px 尺寸。
