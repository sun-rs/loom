# 快速模式卡片与配置生效时点

## UI 来源与修复

Raft Web `index-MqTUR4Ez.js`，SHA256 `9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，授权展开源码 103660 行附近使用 `sL variant=option render=label`、`iL`、`h0 size=md`、标题及说明。option 参数在 50308 行附近：2px 黑边、小阴影、12px padding、14px column gap、14/20 粗体标题、12/16 说明。发布包仅分析；结构移植进入原 AgentRuntimeDialog/CSS owner，不增加库或修改第三方许可。

快速模式改为 label 卡片，原生 checkbox 保留键盘和 disabled 语义。整卡片（含说明和空白）可以切换；选中黄色底、黑色 check SVG，不依赖操作系统 checkbox 的蓝色默认主题。支持能力仍来自模型目录的 service tier，提交值仍是原有 serviceTier，不新增执行开关。

## RAH OS 的实际行为

- 保存：`AgentRuntimeDialog.save` 复用既有配置命令，同时保留 displayName、role、instructions、avatar/description 等字段。`workspace-agent-management.ts` 写入新 AgentDefinition/ExecutionPolicy revision，并更新 current_revision_id；participant 身份不变，memoryPolicyRef、skillRefs、instructionRefs 与 executionWorkspace 沿用旧 revision。
- 新调度：`placement-candidate-projection.ts` 对 queued Activation 读取 current_revision_id；`placement-planner.ts` 将选中 revision/model 固化到 Placement。
- 已调度/已运行：`run-agent-context.ts` 按 Placement 内的 revision ID 读取配置，不改读 current_revision_id。保存不会重写该 Placement 或热切换 RunAttempt。故“下一次执行一定使用新配置”过于绝对：已提前分配的执行可能仍绑定旧 revision。
- 环境变量：`RuntimeGuideSettings.runtimeOptions().launchEnvironment` 在 `runtime-profile-composition.ts` 的 activationEnvironment 中读取，并注入启动环境；不会改写已存在子进程的环境。
- 私有记忆：配置操作保持原 Agent 身份和 memoryPolicyRef，不执行记忆删除/重置。运行时会话是否恢复与私有文件记忆是不同事项。

提示改为：“保存后立即更新配置，供后续新调度的执行使用；正在运行的执行不会热切换。Agent 身份、人设和私有记忆保持不变。”这是对现有行为的说明修正，不是本批新增热切换或重启策略。

## Raft 对照的证据限度

Computer 1.0.31 `main.js`（SHA256 `d971d8f23b3178b008ce409964082f1dacb1d638a8965f11d19fef274331aeca`） 的 `startAgentNow` 经 buildSpawnConfig 建立 runtime session；`rebindRunningStart` 可以更新管理器的 ap.config 及 restart snapshot，同时保留当前 process/session。这里不能把管理器配置对象更新等同于 Provider 正在进行的请求已换模型，更不能改变既有子进程环境。没有中央服务保存配置后的完整调度证据，因此不声称 Raft 所有 Provider 都即时生效或都必须重启。弹窗没有提示本身不构成实时生效证据。

## 验证

原浏览器门禁先复现快速模式没有卡片高度；修改后验证空白处正反切换、Space 切换、选中黄色及黑色 SVG、保存 serviceTier=priority，以及 390px 窄屏整卡点击。夹具保存故意拒绝以验证请求内容，不修改正式 Agent 的配置、不运行付费 Provider。

专项桌面和 390px 浏览器门禁、`npm run check`、`npm run format:check`、`git diff --check` 及正式构建通过。正式服务通过空闲检查、持久状态备份后安全重启，冻结 Web 构建 `07a2017e4ba1b40fbc057b356fbf13ec92638ba691009d2956f3eff994488c71`。本机、局域网、Tailnet 三个地址的新 Chromium 页面均验证实际 Codex 卡片整卡切换后取消草稿，未保存正式 Agent 配置；已检查截图。未运行真实付费 CLI 或宣称 Raft 在线双边验收。
