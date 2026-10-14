# 聊天提及：原生组件与 Loom 成员投影

依据 [raft-source a98ae003](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，FSL-1.1-ALv2，沿用 owner 授权。官方 `packages/**` 未改动。

## 采用路径

完整读取 `MessageInput.tsx` 的成员加载、候选构建、排序、候选行、键盘与发送路径，以及 `MessageItem.tsx` 的 senderMention 分支和 `senderMentionInsert.ts`。直接复用原生 MessageInput、useChannelMembers、useAutocomplete、AutocompleteOptionRow／ComposerSuggestion、MessageItemSenderButton、Tooltip 和姓名插入事件。不新增提及菜单或重画候选行。

本地 `member-roster.ts` 只注册当前挂载 RoomSession 成员投影的读取函数，不保存第二份成员状态、游标或投递队列。原生组件的 `GET /channels/:id/members` 在 Axios 本地 adapter 中转为读取该投影，不发出上游 HTTP 请求；其他路径、写操作和未绑定 Room 仍拒绝。服务端鉴权、成员投影、收件人解析与投递仍由现有 SDK／Kernel 负责。

Loom 的频道和私聊都只列本对话成员，因此给原生候选器使用其 `private` 成员范围参数；这只是原生候选过滤参数，不改变 Loom Room 类型。候选保留 Principal ID 和 canonical handle，显示 displayName；service 身份不进入候选。没有伪造 activity、status、模型、在线状态或成员权限，也没有把投影灌入官方 Agent／Server store。原生候选头像的缺省状态会显示 offline；本地仅对 MessageInput 的 AvatarSlot import 使用 MentionAvatar 薄包装，去掉尚无数据源的 badge，内部仍直接渲染原版 AvatarSlot，不改尺寸或样式。浏览器先复现两个假离线徽标，再验证二者都省略。

消息行通过原生 previewSenderAgent／previewSenderMember 接收仅身份字段的只读预览。适配点的类型断言用于兼容上游完整 profile 类型；只能与 readOnlyProjection 一起使用，不能据此开放 profile／运行操作。姓名点击继续走原生插入事件，回到本频道输入框的光标位置。离开成员没有当前身份投影时不提供姓名提及按钮。

## 交互与失败约束

| 触发                       | 行为与 owner                                                                                                                                         |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 输入 `@` 与查询            | 原生候选匹配与样式；本频道成员来自 RoomSession。                                                                                                     |
| 键盘 Enter／Tab 或点击候选 | 原生选择插入 canonical handle，不发送消息；Escape 关闭。                                                                                             |
| 点击正文姓名               | 原生 senderMentionInsert 指定当前 composer channel，保留光标和焦点规则；不开放头像 inspector。                                                       |
| 发送                       | 继续走同一 LoomChannelClient／WriteIntentSlot；Kernel 从正文解析 canonical 提及。前端选择不成为执行授权或投递证明。                                  |
| 首次加载／刷新／失败       | layout effect 先绑定读取源，再让原生 hook 加载；已有轮询更新触发原生成员失效通知。错误时解除源并清空候选；恢复后重新显示，不保留旧候选冒充当前成员。 |
| 切换／卸载                 | 原生 hook 请求版本保护与 Room 隔离保留；注销仅删除本次注册函数，不清除后来替换的 owner。                                                             |

## 验证与边界

先红后绿：旧页面无法显示实例候选；缺少受限 roster adapter。浏览器额外复现被动 effect 绑定晚于原生读取，改为 layout effect 后接通。测试覆盖未知 Room／其他端点／写方法拒绝、同 Role 多实例身份、移除后的投影、旧 owner 清理，以及双尺寸候选选择、canonical 消息绑定、姓名点击焦点、读取失败恢复和跨频道隔离。

浏览器只使用临时 Core 和禁用的夹具实例。早期夹具未提前禁用，触发假 discovery CLI 启动后被围栏拒绝；没有付费调用。随后将禁用前置到共享夹具，避免后续私聊重复禁用冲突。移动端同作者连续消息不重复显示姓名，测试点击原生分组头，不要求每条消息伪造姓名按钮。

本批不修改后端和模型上下文，不新增付费验收。仍未接入：头像预览／右侧 inspector、结构化提及的历史展示深化、线程、附件、转发、可见窗口自动已读。已有手写 `@all` 语义仍由后端处理，本批没有额外增加广播候选。结果见[验收证据](../evo/evidence/2026-10-15-chat-mentions/summary.json)。
