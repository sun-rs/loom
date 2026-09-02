# 聊天表面双边差异合同

来源：Raft 登录页 `https://app.raft.build/s/hakasemac`；2026-09-01
桌面 1440×1000 / DPR 1。静态证据为
`docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，SHA-256
`7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
下列 offset 为该文件 UTF-16 字符位置，不是行号。

| 触发／内容     | 官方事实                                                                                      | 本地处理／owner                                                                           | 验收要求                                                      |
| -------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 频道、私信行   | computed style 为 14px/20px、500（选中 class 虽含 font-bold，实际仍500）；描述12px、black/40  | workspace-navigation / chat-surface.css；显示 description，不拿人设 role 当副标题         | 同尺寸 computed style、长名称最多70%、保留描述空间            |
| 频道行铅笔     | 进入对应频道设置；创建在 section 的 +                                                         | 复用现有 Room 设置和 canonical room.update；不得编辑上一频道                              | 点击非当前频道、只读加载屏障、关闭                            |
| 分栏拖动、刷新 | bct @3365878 的 sidebar min180/max320/default240；$_ @2366342 保存宽度，无黄色线              | room-sidebar-resize / hook；仅存本浏览器布局数字，不存业务数据                            | 鼠标拖动、刷新、坏值/存储拒绝回退、键盘                       |
| 私信标题       | 名称与 presence 同一行，头像独立                                                              | ChannelHeader；沿用真实 presence，不把本地休眠伪装为在线                                  | 窄屏省略、状态颜色                                            |
| 空聊天         | tg @3101946；36px chat icon、暂无消息、开始对话吧。；title18/600，description14               | ChatEmptyState；结构移植，不引入业务空消息                                                | DM/Room 空态，同尺寸居中                                      |
| 消息 hover     | 在消息列中回复／添加回应／收藏消息                                                            | 本地已有 thread action；reaction/bookmark 无 durable API，仍未完成                        | hover、键盘 focus、thread 真实打开；不得伪造后两项成功        |
| 头像预览       | RO @2866713；名字/状态同排、handle 下排、Computer/runtime/model/effort、描述独立分隔、最近5条 | AgentPreview；分开加载资料与动态，保留 ACL、失败/未知与真实状态                           | hover→卡片、离开、Escape、点击 Activity；资料失败不能抹掉动态 |
| 头像素材       | generated avatar-pack 来自官方 index-WTraJnrd；预设与 random 两套                             | 保留显式预设/random 和用户身份；旧 provider 占位 key 映射官方预设，不重写 AgentDefinition | 已有头像不漂移，4种旧 key 可区分，任意未知 key 仍稳定         |
| 排序／置顶     | section sort 的手动／最近／A-Z；服务端带版本的个人侧栏偏好；拖拽另有排序 owner                | 尚无对应个人导航偏好协议，不能用数组本地排序冒充完整实现                                  | 后续须持久化、并发版本、键盘/拖拽和 reload                    |

本批是上游结构/CSS 移植与 RAH glue，不是整个 minified bundle 的字节级复制。
不会移植联合频道的中央服务器依赖，不更改 Agent 的名字、人设、模型或记忆。
技术名称过长属于已有 Agent displayName，不能为了截图一致擅自改名。
原本默认宽度240与当前官方一致，不能据截图把320宣称为官方默认。

## 二次设计检查

- 设置仍由 Room 管理 owner 完成；跨 Room 时清空旧投影，未完成回放不允许写。
- 资料/动态请求独立失败，取消与晚响应受 AbortController 约束。
- 只修呈现不会把诊断变为 Room 消息，也不会由工具事件推导 Task。
- 收藏、回应、排序、置顶不能标为完成；本批不新增第二份业务状态。
- 门禁、真实浏览器和正式重启结果单独记录，本文不是验收通过证明。
