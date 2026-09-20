# CLI 产品名称统一

用户要求所有前端 CLI 名称去掉 native/传输描述。显示 owner 为现有
`agent-runtime-presentation.runtimeProductLabel`，统一 Codex CLI、Claude Code、
Kimi Code、OpenCode。沿用当前产品映射，不改适配器 ID、执行参数、模型绑定。

新建 Agent、编辑运行时、绑定运行时列表、人类资料、计算机详情使用同一函数；
已有 Agent 资料与头像预览已使用此 owner。daemon 内建 Runtime spec 的 displayName
同步改为产品名称。旧私聊的四种精确自动生成名称在房间列表、搜索及动态卡片显示时
兼容转换，不写回历史数据，不截断任意用户自定义的带点名称。诊断数据仍保留真实
执行标识与传输信息，消息正文不做批量替换。

这属于用户明确的本地产品文字调整，不是上游代码复制。先增加内建名称测试和旧
名称兼容测试并确认失败，再实施；5 项相关测试通过。Web typecheck、正式 bundle
build 和 diff 检查通过。整体 check 仍有既存 `/v1/worker/message-present` 登记阻断；
format:check 仍有此前 5 个文件格式问题。本批未调用付费 CLI。

运行时编辑弹窗的隔离浏览器交互通过。正式安全重启构建
`7ccd488d19af17442bcc20ab78df872e7a63952b7b7f641cf7bfb916d8d18f26`，
进程 31560；备份 `pre-restart-79555d60-2f46-4fb4-9ffc-82d38c1f79ba`。
新浏览器实测编辑与新建的运行时下拉选项、旧动态卡片标题均无 native 后缀；
历史消息中用户或 Agent 自己写出的运行时说明保持原文。
