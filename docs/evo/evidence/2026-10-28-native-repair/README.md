# Codex / Kimi 回复传输修复

Owner 要求追查并修复近期 Codex/Kimi 效率问题。历史 v7 study 明确为 native-final 试验，不是默认七开关关闭路径；近期 Codex warm/Kimi ACP 的对照却使用工具发表。不能把两种传输的比率直接称为同路径回归，也不能把旧 native-final 试验当成全平台已正式启用。

## 本次修复

- Codex 常驻 app-server 复用已存在的 `final_answer` + 当前 turn/thread + 正常终态/工具收束验证，接入共享 native-final envelope 与 Worker 发布服务。只接收匹配当前投递单目标的最终正文，不要求模型抄写 final 或因果序号，不换 CLI 或静默新建 session。原生进度仍是诊断；多目标/不完整投递继续 Worker 回退。
- Kimi 复用既有 native-final transport，避免工具发表之后抢先取消下一代请求的竞争。不修改模型用量统计，不把取消请求填零。
- 新 Codex 常驻开关为 `LOOM_CODEX_NATIVE_FINAL_TRIAL=1`。已有常驻运行池通过模式指纹区分，测试证明两轮同 session；默认产品配置暂不自动改写，须完成实际模型验收再部署选择。
- 共用 warm native-final 发布前必须成功登记匹配输入的运行时投递回执。新增负例发现登记回调失败仍可能发表正文，已补 Host 守卫；没有放松 Kernel ACK/因果/取消围栏。Claude/OpenCode 受影响路径分别回归。
- 效率入口新增显式 `RAH_EFFICIENCY_REPLY_TRANSPORT=worker|native-final`，未指定为 worker；清除无关继承试验开关，并将选择纳入 baseline 哈希。native-final 的 Codex/Claude/OpenCode 仅准入常驻臂，Kimi 为 ACP 臂。不再将继承环境导致的不同路径统计成同一实验。

## 免费验证

新增测试先红后绿：Codex warm plain-final 两轮、无工具/无 outputSchema、评论/中断/投递登记失败拒绝；真实驱动以假 app-server 分别验证 JSON/native-text 模式的原始终态证据。共用 baseline、配置/组合、driver 22 项；Codex warm 11 项；Kimi native-final 14 项；Claude 15 项；OpenCode 11 项；类型检查通过。无关全套测试未跑。

此前失败实验费用与未知用量继续保留。本批真实模型验证结果后补，不由免费测试推断成本通过。

## 首次真实候选发现与保留

`538af19f` 的 Codex 三对真实对照保留：两对 over-budget，一对 needs-quality-review。接入 native-final 后仍暴露旧回复 MCP，模型部分轮次走回旧路。这不是消除工具开销的完整实现，也不能用最后一对低值宣称通过。后续先增加实际进程启动参数断言，移除 native-final 模式的竞争回复工具；Worker CLI 回退仍保留。新增模式切换测试验证同一个原生 session 续接，未替换实例会话；12 项 Codex 针对性测试通过。后继候选另立批次，不拼接前批。
