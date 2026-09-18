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
