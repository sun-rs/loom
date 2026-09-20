# Agent 资料行内编辑样式对齐

## 2026-09-20 头像上传按钮

Raft v1.16.0 `AgentDetailPanel-CW_VMZT6.js` 的上传入口使用 size-10、border-2、
hover:border-brutal-pink；空上传项为 16px、text-black/60 的 Lucide upload。
图标路径直接来自同版 `index-CKeqacxz.js` 的 E7e/AI，保留 Lucide ISC
声明，加入内部 interaction-icons sprite 并通过共享 Icon 使用。此为路径
原样采用、展示结构移植，原始 bundle 仍只用于分析，不增加运行依赖。
来源 URL 为 `https://app.raft.build/assets/index-CKeqacxz.js`，SHA-256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。

本地移除字符箭头和空上传项悬停的粉色背景，只让边框变粉；图标保持
60% 黑色、底色保持白色。上传成功后的图片预览/选中态与上传逻辑不变。
`scripts/test-agent-avatar-upload-style-browser.mjs` 先复现悬停背景变化，
再覆盖 1440/390px 图标、边框、底色、图标色、移出恢复及键盘打开文件选择器。
Chromium/WebKit 定向门禁、图标语义测试、类型检查、正式构建通过，截图
已检查。check 仍阻于既有 `/v1/worker/message-present` 未登记，format:check
仍报告五个未改动文件。正式实例已经保护检查、备份并重启，构建身份
`0a29a579f3261f10`；新浏览器正式资料页验证图标与悬停颜色通过，未修改头像。

## 行内编辑

来源：Raft v1.16.0 `https://app.raft.build/assets/AgentDetailPanel-CW_VMZT6.js`，
SHA-256 `918921bbb932ed020285d2f3639c0a5511249f4bca1d2468628da995078a37e3`。
沿既有授权 reuse ledger，只读解析、不执行 bundle；本次是结构与参数移植。

名称编辑（offset 97600 附近）采用 h-8、border-2、px-2/py-1、text-sm、
shadow-brutal-sm；描述（offset 99715 附近）rows=2、min-h-10、leading-4、
resize-none。`Qn` 根据 scrollHeight 在 40px 至 160px 内自动调整高度。
操作行距输入框 5px，按钮 gap-1.5、px-2/py-1、text-xs，保存粉色、取消白色。
这是文字按钮，上游未添加保存/取消图标。

本地单一 owner 为 AgentProfileFieldEditor 与内部 profile.css：移除原先
80px/resize:vertical 规则及通用大按钮尺寸，采用上述参数。计数放在操作行
下方右侧，沿现有数据合同显示 /2000，不伪装支持 Raft 的 3000 字。
保留 revision、保存防重、错误草稿、Enter/IME、Escape 与焦点恢复逻辑。

测试先复现名称框 38px（预期 32px），再通过 Chromium/WebKit 的
1280x844 与 390x844 检查：字段/按钮尺寸、resize:none、描述增长/缩回、
Escape 取消、Enter 保存。使用隔离 fixture，未改正式 Agent 配置。
运行方式：`RAH_AGENT_PARITY_MODE=profile-fields node scripts/test-agent-parity-controls-browser.mjs`；
WebKit 增加 `RAH_BROWSER=webkit`。这不等于 iPhone 实机或在线双边验收。
