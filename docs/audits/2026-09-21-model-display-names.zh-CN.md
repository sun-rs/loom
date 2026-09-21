# 模型显示名称统一

## 设计与来源

`apps/web/src/model-display-name.ts` 是唯一显示名称解析 owner。选择器、Agent
资料模型徽章、头像预览和消息作者旁标签共同使用它；目录 displayName 优先，
缺失时使用既有品牌映射与保守分词格式化。Claude 静态候选沿用现有目录标签。
原始 ID 保留在 title、配置、保存和调度中，不使用显示名反推身份。

来源沿用 [模型选择器审计](2026-09-20-model-picker-labels.zh-CN.md) 中的
Raft Computer 1.0.32 `formatRuntimeProviderModelLabel` /
`humanizeRuntimeProviderSegment` 位置与许可边界。本次是已有本地算法的共享化，
不是复制发布 bundle。用户提供的 Raft 截图显示 Claude/Codex 友好标签与其他
运行时原始 ID 混用；RAH 有意统一四种运行时的显示规则，OpenCode 保留提供方前缀。
不声称已对当前 Raft 线上所有模型逐项验收。

替代上述旧审计中的“聊天正文继续使用原生 ID”显示约定。未知模型仅保守格式化，
不推断模型能力；删除 Agent 缺少目录时仍解析其已有 ID，不串用其他 Agent 目录。

## 数据边界

聊天作者标签的数据源仍是 Agent 目录（含删除身份），并非每条消息的执行模型
快照。因此不能将这个标签宣称为历史消息实际使用的模型。本次只改变展示，未增加
消息模型快照、追溯迁移或任何执行配置写入。原始 ID 悬停可见。

## 验证

新增解析测试先因缺少模块失败，再实现；19 项解析、资料、选择器、原生 ID 单元
测试通过。真实 Chromium 的隔离 Fake CLI 页面覆盖目录标签、无目录回退、删除
Agent、原始 ID title、外观开关保存/重载以及 1440 与 390 宽度。Web 类型检查通过。
没有付费 CLI 调用；浏览器夹具不是正式产品。

正式 bundle 构建通过；备份持久状态并安全重启后，新浏览器验证正式 Codex 资料
显示 `GPT-5.6-Luna`，title 保留 `gpt-5.6-luna`。只读浏览器策略拦截环境变量
读取，因此该区域不在本次验收内。未提交 Git。

全仓 `check` 仍受既有 `/v1/worker/message-present` surface 未登记阻断；
`format:check` 仍报告 10 个既有文件（含 scratchpad）。本批次文件已格式化，
`git diff --check` 通过。没有把这些全仓检查报告为通过。

## 推理强度说明补充

“Runtime 默认”改为“默认”，值仍为 `default`，不指定具体档位。共享
`runtimeReasoningOptions` 仅给原来允许返回的选项附加说明，不生成新档位；
已有探测档位、Claude 有界自定义版本提交规则及未验证提示保持不变。
Raft `index-BVfbaScj.js` 中文语言包 `agent.reasoningEffort.*Description`
提供 Low/Medium/High/Extra High/Max 的文案参考。Ultra 使用“最大推理深度”，
有意不复刻未经本机能力验证的自动任务委派承诺。说明是本地文案，不是 CLI 探测结果。

创建与编辑复用 RuntimePicker/DiscoveryFilter 的可选第二行：名称保留原字号，
灰色说明 12px/16px，可换行；选中控件只显示名称。沿用 field 的 6px/12px padding、
选项边框、勾选和 ChoiceRow 交互。这是本地结构适配，不声称新 CSS 字节级复制。

本次补充验证：先修改能力选项测试并确认失败，实施后相关 9 项单测通过；
Chromium 创建/编辑及 1440/390 双行菜单验证通过，类型检查与正式构建通过。
CSS 改动后重新运行 sidebar-row/sq-btn 的真实浏览器 matched-rules 证据生成门禁，
未手改哈希。正式重启守卫发现一项 active Activation 并拒绝停止，故本次说明文案
尚未部署到正式实例，也未声称正式页面验收通过。未运行付费 CLI、未提交 Git。

后续[导航按钮修复批次](2026-09-21-navigation-chrome-roles.zh-CN.md)已在工作空闲后完成
正式备份和安全重启，上述暂缓的“默认”及推理强度说明随该构建一起部署。
