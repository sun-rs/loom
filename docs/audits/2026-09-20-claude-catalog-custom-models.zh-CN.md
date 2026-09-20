# Claude 模型候选与原生自定义 ID

Raft Computer 1.0.32 发布 main.js 的 `RUNTIME_MODELS.claude`（20241–20258）
提供静态别名及具体版本候选，没有 Default。发布文件 SHA256 为
`531f41e2ee626d729c92933fbc753008af42380c5745c54b5d0af9901e43d170`。
来源与许可边界沿用[模型名称审计](2026-09-20-model-picker-labels.zh-CN.md)及其引用，
发布 bundle 只作调查证据。本次是候选数据的结构性移植与 RAH 调度胶水，
不声称复制了 Raft 云端目录或验证了所有型号的账户可用性。

RAH 原先只读取 Claude control initialization 返回的 models（value/displayName），
因此有 Default，但没有 Raft 补充的具体版本。现保留真实探测目录，选择器去掉
Default，并补充 Raft 别名/版本候选。没有探测到的候选走显式 custom_model，
绝不伪造为 probed binding。Claude Code、Codex 新建和编辑共用自定义 ID 输入。
显示名不参与匹配；聊天继续显示原生 ID。

所有权：Protocol 定义 customModel `{runtime, modelId}`；Kernel planner 仅在
RuntimeOffer 声明匹配的 customModelRuntime 时选择，禁用 fallback；AgentHost
再次检查仅 Claude stream-json/Codex app-server 原生 adapter 支持，原样传递
`--model`（Codex 后续进入 thread/start）。未知模型的 effort/tier 保持默认，
不捏造能力。Placement/RunAttempt 保留 custom_model provenance，Worker profile
同样显示原生 ID。用户选择失败由 CLI 原生错误路径处理，不暗换模型。

测试：planner 的旧行为（误选 runtime_default）先复现失败；补充 schema、选择器、
planner、原生 Fake Claude/Codex 参数及浏览器提交验证。测试使用临时状态和 Fake CLI，
没有付费调用；Raft 候选不等于真实模型执行验收。

验收结果：63 项相关自动化测试、Claude/Codex 隔离浏览器请求内容断言、模型显示
桌面/手机回归、根与 Web 类型检查及正式 Web 构建通过。正式实例已备份并安全重启，
新浏览器核对真实 Claude 目录无 Default、含别名/版本候选，编辑页两种 CLI 自定义
输入与创建页 Claude 自定义输入正常，390×844 无横向溢出；未保存正式 Agent 配置。
Fake CLI 证明参数传输，不声称真实付费模型执行通过。

`npm run check` 仍在既有 `/v1/worker/message-present` surface 未登记处阻断；
`npm run format:check` 仍报告原有 wake-body 文档和四个 delivery/activation 测试文件。
本批文件格式与 `git diff --check` 通过。这些全仓库阻断项未计为通过。
