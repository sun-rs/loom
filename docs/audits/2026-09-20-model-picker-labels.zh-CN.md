# 模型选择器：提供方与模型显示名

用户确认选择器顺序为提供方在前、模型名在后，以 `·` 分隔。
显示 owner 仍为 agent-runtime-capabilities.runtimeModelLabel；OpenCode 优先
使用 probe 已读取的 metadata.name/displayName，无名称时按 token 格式化，
保留连字符、斜杠和版本标点，例如 Aihubmix · GPT-6-Astra。已知品牌采用
明确映射，未知 token 仅首字母大写；不把生成标签用于模型匹配。

参考已核查的 Raft Computer 1.0.32 main.js 811804–811840、820854 的
formatRuntimeProviderModelLabel/humanizeRuntimeProviderSegment。结构性借鉴，
不是源码复制；本地有意采用用户指定的提供方优先及保留模型连字符规则。
来源/许可边界沿用 [动态审计](2026-09-20-activity-responsive-navigation-investigation.zh-CN.md)。
RAH 的模型目录目前有提供方 ID，没有单独提供方 displayName，故提供方标签
使用明确品牌映射/保守回退，不声称从 CLI 读取了这个字段。

新建与编辑使用同一 RuntimePicker：选项悬停含完整原生 ID，搜索同时匹配 ID，
已选模型下方显示原生 ID。原绑定 value 始终保留。Codex/Claude 不附加 RAH
补出的提供方。聊天正文继续使用原生 ID，只去除内部 local:…/v1: 前缀。

验证：先修改预期并确认旧实现失败，再实现新标签规则；模型选择器与聊天模型
ID 的 10 项测试、Web 类型检查、模型目录刷新/失败恢复浏览器回归及正式构建通过。
正式实例完成持久状态备份和安全重启；新浏览器页面验证 OpenCode 实际目录显示
`Aihubmix · DeepSeek V4.1 Flash`，选项包含完整 `aihubmix/…` 原生 ID。
本批次未调用付费 CLI，也未修改模型绑定或聊天模型标识规则。

全仓库检查仍受既有 `/v1/worker/message-present` surface 未登记项阻断；
全仓库格式检查仍报告此前的 wake-body 文档及四个 delivery/activation 测试文件。
本批次文件格式及 `git diff --check` 通过。未将这些既有阻断项计为通过。
