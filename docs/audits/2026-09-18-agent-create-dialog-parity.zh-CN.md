# 创建 Agent 弹窗视觉对齐

来源：Raft v1.16.0 `https://app.raft.build/assets/index-CKeqacxz.js`，
SHA-256 `7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
原始 bundle 只读分析，沿既有授权 reuse ledger，不执行、不作为生产依赖。
本次是结构与参数移植，不是字节复制。

普通创建分支使用 `Td`：max-w-md (448px)、p-6 (24px)、标题 text-lg
(18px/28px)、header mb-4，无头尾分隔线，关闭图标 20px。
`o0`/`Ire` 字段间隔 4px，标签 14px/20px；描述行保留 min-h-4，
计数靠右。`ml` 输入 px-3/py-2、16px/24px；`qze` 文本域 min-h-24，
描述 rows=3。底部按钮 gap-3 (12px)，大按钮 40px 高。

RAH 原有固定高度、表单滚动、额外内边距和头尾横线导致外观不一致。
修复仅限定创建弹窗，管理弹窗不受影响；窄屏保留视口边距与整窗滚动。
WebKit 原生 select 外观会忽略部分框体尺寸，改为 appearance:none，
使用共享 chevron 图标，仍保留原生选择行为和无障碍语义。

本地差异：运行时、模型仍来自本机能力清单，不添加未支持的提供方凭据配置。
因此字段数量随本地能力不同，不能宣称截图总高度或功能完全一致。
上游自定义选项弹层未在本批移植。创建验证及协议未改变。

验证：浏览器测试先复现 padding 0 与移动端拉伸，再验证 Chromium/WebKit
1280x844、390x844 的标题、字段、计数、按钮及展开/Escape；截图人工复核。
测试命令：`RAH_AGENT_PARITY_MODE=create node scripts/test-agent-parity-controls-browser.mjs`，
WebKit 加 `RAH_BROWSER=webkit`。完整旧脚本仍有独立 runtime fixture 和移动端
header 用例失败，不计作本批通过。未完成同前置条件的在线 Raft 双边验收或 iPhone 实机验收。

2026-09-19 用户明确退役 Claude Code 的“提供方”模式：创建与运行时编辑
均移除专用编辑器、API 地址/密钥映射及环境变量隐藏规则。此项是用户指定的
Raft 差异。原实现只写入通用 `runtime.guide.update` 环境变量，无独立后端
提供方协议或执行分支；通用环境变量 owner 保留。旧变量不静默删除，统一在
环境变量编辑器中可见。创建浏览器回归验证不再出现提供方，并继续验证一般
环境变量保存、失败重试和避免重复创建 Agent。

2026-09-19 选择器统一：创建与编辑共同使用 `RuntimePicker`，沿用
`DiscoveryFilter` 的 portal、键盘与焦点 owner，并加入 field 外观。
Raft v1.16.0 `index-CKeqacxz.js` Select 的 `chrome.field` 使用
`px-3 py-2 text-field font-field`；菜单 `w-(--anchor-width)`、2px 边框、
选项 `py-1.5`，列表 `max-h-64`。`AgentDetailPanel-CW_VMZT6.js` 的编辑
窗口是 `max-w-md p-6`、表单 `space-y-4`。这是结构移植，不是 bundle 复制。
本地消除通用 form 的 18px 内边距覆盖，两种窗口同为 448px、内边距 24px。
字段与菜单 16/24px 正常字重；沿用已取证的系统字体回退（见 Agent 删除审计）。
选项颜色仍由共享 property-option profile 管理。超过 10 项保留本地搜索，
它是方便长目录检索的本地适配，不声称此阈值来自 Raft。
OpenCode 依用户约定显示 `provider.model_id`，提交原始 modelBindingId；
不把友好名称作为模型身份。浏览器覆盖创建/编辑、1280/390px、菜单等宽、
Escape 焦点返回及创建保存重试；模型身份另有单元测试。
