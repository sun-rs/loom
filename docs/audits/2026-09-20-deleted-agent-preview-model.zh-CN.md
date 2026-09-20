# 已删除 Agent 预览模型与重建名称调查

## 同日后续统一规则

用户要求悬浮资料卡和聊天模型后缀始终显示原生 ID。此前仅修复目录缺失分支，
目录存在时仍优先 displayName，自定义模型也未经过前缀处理。本次将所有资料模型
分支交给聊天同一个 `chatModelIdentifier`，无生命周期状态特例；模型选择器不变。
先修改断言并确认失败，再实现；12 项定向测试、类型检查、正式构建和桌面/移动
模型显示浏览器门禁通过。全仓库仍有下文登记及 5 个格式阻断项。
正式状态完成备份并安全重启，新构建
`936cc723d73cdfcbbf90843d8e0c20184360c237b1ecc5c9072b0f12586de5a1`。
新浏览器实际悬浮已删除 Gemini、Kimi，原生 ID 断言及截图检查通过。

下文为此前批次的调查记录；账号复用现状已由
[身份协议后续实现](2026-09-20-agent-account-identity.zh-CN.md)取代。

## 此前调查

聊天正文已使用 chatModelIdentifier 移除内部绑定前缀，但共享
runtimeProfilePresentation 在目录缺失时仍直接输出 exactBindingIds[0]。
现让该回退路径复用同一规则，保留 provider/model，不改变底层绑定。
正常目录的真实显示名优先级保持不变，也不以新建同名 Agent 的目录补旧身份。

回归先复现完整 local 前缀与原生 ID 的差异，再修复；9 项相关测试、类型检查、
正式构建通过。正式状态备份并安全重启，新页面实际悬浮已删除 Gemini、Kimi，
分别显示 iiiiitoken/gemini-3.8-flash-high、kimi-code/k3，无 local 前缀。
全仓库 check 仍受先前 worker/message-present 登记项阻断；format:check
仍报告先前 5 个文件，本批格式和 diff 检查通过。

名称调查（本批未改身份协议）：RAH workspace-agent-provisioning 为每次创建分配
新的 principalId 与 agentDefinitionId，消息/私聊不靠显示名分组。
message-reference-identity.allocateRecreatedAgentHandle 在旧 handle 的 Agent
为 tombstoned 时主动追加 -2/-3；principals.handle 的全局 UNIQUE 及启动时名称
歧义检查均保留旧名字。前端 message-rich-text 也按 handle 匹配文本 @提及。
所以后缀是当前名称约束，不能解释为没有内部 ID，也不能只删追加函数。

Raft Computer 1.0.32 main.js 的 agentMigrationUpdatedPayloadSchema（15175）
明确使用 UUID agentId；文件 SHA256 与来源/许可见
[Claude 目录审计](2026-09-20-claude-catalog-custom-models.zh-CN.md)。
独立 ID 有源码依据；用户观察到的删除后重用 handle 合理，但云端唯一索引、
历史提及绑定策略未获该发布源码证明，不把推测描述成已查实的后端实现。
后续若对齐名称复用，应一起处理活跃身份名称约束、历史提及绑定和旧数据迁移，
并验证旧消息、头像、私聊、任务、记忆不归并到新身份；本批没有改写 Kimi-2。
