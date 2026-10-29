# 全部右键目标及共用行为核对

锚点 Web1.21.38，包0.52.0。分类覆盖当前产品自定义右键入口；原生浏览器选择文本、
系统拼写等菜单不由 Loom 改写。下列“已核对”不是全部平台逐像素或故障时序已穷尽。

| 目标                 | 共同动作与触发规则                                                            | 来源/接线                                                      | 验证或保留边界                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| 聊天列表空白         | 新建频道、分组、查看归档；外点/Escape关闭，不触发下层菜单                     | 官方 ContextMenu 家族，SidebarMenus/ChannelSidebar             | sidebar-actions：1440/390，新建取消与创建；保留归档入口                                                                     |
| 分组标题/排序        | 排序选中项、重命名/删除自建分组；原生拖动不改为上下移                         | 同上，官方DND及持久个人偏好                                    | 原有 sidebar-state/DND 合同；本批补前置图标/分隔线，不添加置顶分区“＋”                                                      |
| 频道行               | 移到分区子菜单、读/未读、置顶、静音、归档                                     | 原生菜单与图标；权限/版本/归档确认归Kernel/ManagementClient    | sidebar-actions：移动、偏好刷新、丢响应不重发、活动工作拒绝归档、归档只读与恢复；手动标记不会虚构数字                       |
| 独立单聊行           | 移动、读状态、置顶、关闭会话                                                  | 相同原生菜单；普通Channel上的Human展示偏好                     | 关闭隐藏入口保留历史与未知写入守卫；频道内私密消息不混为列表外独立单聊                                                      |
| 动态频道/单聊        | 读/未读、完成；可持久静音的Channel显示静音项                                  | 原始 HXe/l1 菜单行；HumanActivity与sidebar偏好                 | activity-menu/remaining138：键盘、碰撞边界、精确frontier、读不等于完成；实例private box未绑定静音偏好，不显示无效按钮       |
| 动态消息列           | 读/未读、完成、关注/取消关注；关注状态先读权威值                              | 同上，ThreadActivityClient                                     | 右键立即提交；390真实触控滑动才延迟/撤销。失败读回一次，不静默重发；无权限按钮不冒充成功                                    |
| 搜索频道结果         | 右键“打开”进入完整聊天；普通点击保留预览；外点/Escape不导航                   | 官方 EntityResultRow/MessageSearchPage 结构与MenuItem          | search-entities及边缘弹窗检查；稳定Room路由，不打开外部官网                                                                 |
| 消息正文/hover More  | 共用复制链接、复制Markdown、收藏、允许的任务/消息列操作；触屏长按另有选择文本 | 原始MessageItem提取 + 明确Loom适配，官方菜单行                 | remaining138/references/saved：真实菜单点击、复制目标、触屏引用进入正确composer；不恢复外部分享/翻译或没有权限的编辑删除    |
| 发送者名称/头像      | 与正文菜单独立，复制显示名、复制Handle，Escape恢复焦点                        | 原始MessageItem发送者分支，SenderActions                       | message-references：1440/390姓名、handle、头像/名称右键与点击分离。实例私聊/Fork/Side是明确的Loom附加操作，保持后端能力守卫 |
| 已保存消息           | 复制链接、复制Markdown、分隔线、移除收藏；点击跳原消息                        | 独立 SavedPanel-B78TItCT 原件菜单组合，原生ContextMenu/ListRow | remaining138 + saved：消息列链接、文本、刷新/跳转/未知保存核实及移除                                                        |
| 代码/附件正文        | 原生选区/复制和既有预览工具；不能夺走浏览器通用菜单                           | 锁定CodeBlock/Preview/评论提取及官方按钮                       | 无自定义文件写入菜单；未恢复音视频/外部分享                                                                                 |
| 工作区树             | 当前锁定TreeNode只有展开/选择，保留浏览器右键                                 | 原始AgentWorkspace具名声明                                     | 无onContextMenu覆盖，不擅加重命名/删除/终端；这是未支持动作而非空菜单                                                       |
| 记忆卡片             | pin/unpin、编辑/撤销/删除等本地授权操作，用相同菜单原语                       | Loom独有MemoryCard + SidebarContextMenu                        | 不等同Raft单Agent记忆；现有修订/来源/确认规则保留，本批统一继承原生行尺寸/状态                                              |
| Role、Computer、实例 | 原生点击/“…”菜单；只有真正的实例才启停/重置/分叉                              | 官方Dropdown/Button/确认弹窗，现有Loom owners                  | Role是配置，Computer是宿主；不为凑右键一致而给Role虚构原生Agent/session动作。不额外拦截没有自定义菜单的位置                 |

共同底层：官方 ContextMenu/Dropdown 原语负责焦点、disabled、submenu和关闭；保留手工
定位的 Message/Activity/Search 使用官方MenuItem recipe和视口放置。业务确认/未知写入
状态有明确Loom守卫，不因复用展示代码而绕开。手机触屏和桌面键盘检查均使用隔离fixture；
实体iOS/Android、OS菜单和所有辅助技术组合未作为本批通过项。
