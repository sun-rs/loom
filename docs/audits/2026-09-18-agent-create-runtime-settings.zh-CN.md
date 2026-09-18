# 创建 Agent 运行时设置统一

本批按用户要求移除创建窗口的 Handle、头像、人设指令、Agent 指令及高级分支。
Handle 仍按名称生成供既有协议使用；默认头像继续由后端分配。描述、自动身份
和默认指令保留原有作用，不修改 Agent 身份/记忆 owner。

Raft v1.16.0 来源 `https://app.raft.build/assets/index-CKeqacxz.js`，SHA-256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`。
普通创建表单提供模型、推理强度、更多环境变量；`ibe` 将 Claude custom provider
的 apiUrl/apiKey 映射为 ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY，default 不覆盖
CLI 配置。只读分析授权 bundle，结构移植与本地 glue，不执行原始材料。

创建与运行时编辑共用 AgentProviderEditor 和 parseAgentEnvironment。
Claude 显示默认/自定义提供方；其他 CLI 的提供方沿其本机模型目录和环境变量，
不虚构中央凭据连接库。模型/推理强度/快速模式仍仅接受已发现的能力。
创建窗口支持刷新模型，推理强度紧邻模型，更多仅含既有 RuntimeEnvironmentEditor。
描述上限统一为现有协议实际接受的 2000，避免 UI 接受而服务拒绝。

环境变量和 Provider 密钥仅通过既有 runtime.guide.update 写入 daemon 私有
Agent launch overlay，不进入 agent.provision、Room ledger 或 execution policy。
先创建身份，再写 launch overlay：这不是跨 owner 原子事务。保存失败保留已创建
ID 和冻结字段，明确显示部分成功；当前窗口重试只补写 overlay，不再创建 Agent。
关闭窗口不会删除已创建身份，可通过该 Agent 的运行时配置继续调整。
不扩展协议，不新增后台环境变量存储或覆盖宿主 CLI 账户文件。

隔离浏览器测试覆盖移除字段、模型/推理选择、Claude provider、环境变量、失败
重试不重复创建及 payload 不含凭据。环境变量单测覆盖重复键和受保护键。
Chromium/WebKit 均检查桌面和 390px；不代表真实 Provider 接通或 iPhone 实机验收。
