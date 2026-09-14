# 紧凑聊天模型标识

按用户本次明确要求，聊天模型格式更新为 `provider/model_id`，没有provider时仅显示
model_id。本契约替代[此前聊天标签](./2026-09-14-chat-model-provider-labels.zh-CN.md)
中的 `provider · displayName`，运行时配置选项仍保留原有友好名称。

## 证据与所有者

沿用Raft授权发布源 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`；
Jrt（pretty 141927）→SI（23757）查目录标签并回退模型值。保留位置、样式及外观开关，
此次紧凑格式是用户指定差异，不宣称Raft本身使用同一格式。
Multica `11861145abc59a0d39c8c8f24ad837d4584e664f` 的
`packages/views/agents/components/model-dropdown.tsx:286`按provider分组，未采用代码。

`chat-model-identifier.ts` 为唯一聊天格式所有者，消费已授权目录中的provider/modelId，
不按运行时名称分支，不从displayName推断provider，不发起新CLI探测。
去除外围空白，已有相同 `provider/` 前缀时不重复添加；模型ID内部路径原样保留。
无目录条目时仍回退完整绑定ID，未配置模型和Human仍不显示模型标签。
Room、DM、Thread通过现有MessageAgentModelName共用；tooltip与正文一致。
本项为RAH展示逻辑，不新增运行时适配器、协议或历史模型归因能力。

## 验证

先将真实消息组件浏览器预期改为紧凑格式，复现旧 `aihubmix · DeepSeek V4` 失败，
随后实现并验证。单测覆盖任意provider、缺失/空白provider、已有前缀及内部路径保留；
原运行时友好选项断言保留。浏览器fixture覆盖OpenCode的两个provider、Codex、Claude、
Kimi以及无已知cliId的grokbuild目录条目，确保不受运行时白名单约束。
fixture不代表已新增grokbuild适配器；它只验证现有目录数据的呈现。

8项相关单测、外观专项桌面/390px浏览器、完整 `npm run check`、
`npm run format:check`、`git diff --check` 与 `npm run build:web:workbench` 通过。
已检查窄屏fixture与正式桌面截图。

正式实例通过空闲保护，备份为
`/Users/sun/.rah/backups/pre-restart-8b890b05-c21b-44d3-be49-6813fd041018`；
优雅重启后的冻结构建为
`e3e08105c8735500caa29516e5765fd07cab7bac6351c2b081441962673ce24e`。
新浏览器按实际模型目录核对现有聊天与title，观察到
`iiiiitoken/gemini-3.8-flash-high`、`kimi-code/k3`，标签后仍紧接时间。
刷新、本机、LAN和Tailnet构建身份均通过；截图为 `/tmp/rah-compact-model-formal.png`。
未发送消息、修改Agent配置、运行付费CLI、提交或推送；未声称Raft同条件在线双边验收。
