# 聊天模型标识保留 Provider

## 来源与边界

Raft 发布源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`，
本地分析格式化版本 `Jrt`（141927）调用 `SI`（23757），根据运行时和模型查目录标签，找不到时保留原模型值。
本批保留其展示位置、11px 等宽灰字与外观开关，按用户要求补充多 Provider 同名模型的区分。
这不是声称上游已实现相同 Provider 拼接。

同时核对 Multica `11861145abc59a0d39c8c8f24ad837d4584e664f`
的 `packages/views/agents/components/model-dropdown.tsx`：`groupByProvider` 按目录的 provider 分组。
其数据模型与 RAH 不同；未复制代码或引入依赖。现有资源的来源与许可声明保持不变。

## 实现所有者

- AgentHost `model-catalog-probe.ts` 的 `parseOpenCodeCatalog` 已从 CLI 模型目录取得 Provider，
  并保留 CLI 发布的模型名称。正文不解析显示名，不额外探测 CLI。
- `agent-runtime-capabilities.ts` 的 `runtimeModelLabel` 为单一标签格式所有者，
  运行时配置选项与正文共用。OpenCode 显示 `provider · displayName`，无显示名时保留 modelId；
  Codex、Claude、Kimi 显示模型名或 modelId。旧目录缺少 cliId 时只识别精确可执行文件名。
- `MessageAgentModelName` 使用已有授权实体目录与 Agent 绑定；目录或条目缺失时保留完整绑定 ID，
  未配置模型或 Human 不显示。Room、DM、Thread 共用消息组件。
- 保留当前配置标签的语义；这不是每条历史消息实际执行模型的溯源记录。
- 当前协议支持 Codex、Claude、Kimi、OpenCode，尚无 Pi 适配器。本批未伪造 Pi 支持或扩大协议。

## 验证

先用真实消息组件的隔离浏览器用例复现实际只有 `DeepSeek V4`、预期 `aihubmix · DeepSeek V4` 的失败，
再复用目录标签格式。单测覆盖同名不同 Provider、目录显示名缺失、单 Provider、旧目录 CLI 标识回退。
外观浏览器门禁增加授权目录实体 fixture，检查两种 Provider 的正文与 title、模型后紧接时间，
以及桌面与 390×844、开关、刷新保持。Fixture 无真实 CLI 调用或消息发送。

## 交付验证

- `npm run check`、`npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。
  专项浏览器与标签单测通过；人工检查了 390×844 和正式桌面截图。
- 初次本批构建为 `1ba9bd8337b76ffc3d4d03fb5afecf0e3eb9084b372c790f90ca38f15017e052`。
  共享工作区在交付前另有构建更新；实际冻结、重启并验收的正式构建为
  `80605502442267284493a48743bd0b0b720e845bc292a98757445de614fef8f0`。
- 空闲保护检查通过，备份 `/Users/sun/.rah/backups/pre-restart-abd9920a-7ed7-41f1-a881-c496c6f97ef8`
  已验证；旧实例24864平稳退出，新实例31671由独立监督进程31615运行。
  保留原局域网和 Tailnet 绑定，未强制结束 Agent 工作。
- 新浏览器读取真实目录并核对既有 OpenCode 消息的标签、title、后续时间节点和刷新，
  实际显示 `iiiiitoken · Gemini 3.8 Flash High`，另有 Kimi 的 `K3`，均符合目录。
  `127.0.0.1`、`192.168.1.86`、`100.101.107.87` 的正式构建标识一致，无页面异常。
- 证据：`/tmp/rah-provider-model-{check,format,build,browser,formal,restart}.log`；
  截图 `/tmp/rah-provider-model-390.png`、`/tmp/rah-provider-model-formal.png`。
  未发送真实消息、改 Agent 配置、运行付费 Provider 测试、提交或推送。

本批是源码参照与隔离浏览器、正式本地浏览器验证；未宣称同条件 Raft 双边验收。
