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
无目录条目时回退绑定ID的模型部分，去掉 `local:<runtime>/vN:` 传输命名空间；
2026-09-20 修正此前直接显示完整绑定ID的行为。已删除与存活Agent共用此规则，
保留provider和模型内部路径，不改变持久绑定。未配置模型和Human仍不显示模型标签。
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

## 2026-09-20 无目录回退修复

新增回归测试先复现 `local:opencode-cli/v1:iiiiitoken/gemini-3.8-flash-high`
未去前缀的失败，再由同一聊天格式所有者修复；Kimi对应显示 `kimi-code/k3`。
不按删除状态分支，普通含冒号模型ID保持不变。真实消息组件fixture覆盖两种已删除
Agent的标签和title，桌面及390px窗口均与模型ID一致；不创建第二套历史身份逻辑。

本批3项格式单测、模型外观浏览器门禁及删除Agent任务身份门禁通过，TypeScript、
正式bundle构建、diff检查通过。全仓库check仍被既有message-present surface登记
问题阻断；format检查仍有5个本批未改文件的问题，不宣称全绿。
正式工作台经过活动检查、备份和优雅重启，构建为
`105b6d25d0531b639db244ea23da657d2a552560e241d3a31b257c9f73c00b3f`。
新浏览器打开真实任务中的已删除Gemini历史回复，核对标签及title均为
`iiiiitoken/gemini-3.8-flash-high`，并检查截图。Kimi由隔离组件浏览器验证，
未声称本批观察到正式Kimi历史消息。未发送消息或运行付费CLI。

## 2026-09-20 原生 ID 显示规则修正

按用户确认，撤销此前“额外拼接 provider 元数据”的规则。共享 `chatModelIdentifier`
只去掉 `local:<runtime>/vN:` 内部绑定前缀，不读取 provider 来构造显示字符串。
Codex 原生 slug、Claude 原生 value 原样显示；OpenCode/Kimi 的原生 provider/model
仍保持原样。有目录及无目录（含已删除身份）使用同一规则；不改目录元数据或执行绑定。
这是 RAH CLI 身份显示的产品修正，不宣称复制 Raft 服务端。

先修改单测复现 `openai/gpt-5.6` 等额外前缀失败，再最小修改共享显示函数。
四项单测通过；消息组件浏览器门禁覆盖标签及 title、1440/390px、目录及删除身份回退。

本次浏览器门禁、类型检查、正式构建及 diff 检查通过；全仓库检查仍有既有登记与
五个无关文件格式阻断。正式实例已备份并安全重启，冻结构建
`757dc9f7024c0485c2948e285d7523ad0485400393c8701c0bb1b86360fd1cd5`。
新真实浏览器从正式历史消息观察到 `gpt-6-astra`、`opus[1m]`、`kimi-code/k3`、
`iiiiitoken/gemini-3.8-flash-high`，无额外提供方拼接。未发送消息或运行付费模型。
