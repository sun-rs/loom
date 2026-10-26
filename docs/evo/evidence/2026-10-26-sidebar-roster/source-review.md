# 主侧栏折叠与 Composer 成员读取

## 成员读取根因与修复

旧消息输入框使用官方 useChannelMembers，经 upstream-api 读取全局 bindMemberRoster 注册表。消息列和外层频道各自异步加载；消息列先完成时，外层频道尚未注册，出现“当前频道成员不可用”。独立消息列也不能依赖外层频道存在。仅重试或吞掉日志不能修复数据所有权。

当前频道/消息列宿主通过 ComposerFiles 提供所在 Room 的已授权成员快照。OfficialMessageInput 生成器只替换成员 hook import 为 ComposerMembers；保留官方候选渲染、过滤与键盘逻辑。匹配 Room 且 enabled 才提供候选；错误/加载期间无候选，不读取全局注册表或启动第二个网络加载。没有当前 scope 的其他官方调用者仍走已有 hook；本批不宣称全部附件评论入口验收完成。

## 主侧栏

聊天、Agent、计算机、设置四页统一使用上批提取的 Web1.21.34 LF 控件与 sidebar 注册项：默认240、最小200、最大400；小于 min-40 时折叠，拖回可恢复保存宽度。原始 LF 处理全局指针监听、取消、键盘、双击；本批通过现有 sidebar-hidden owner 和官方 toggleSidebar 焦点恢复接线，没有建立另一份折叠状态。

四页共享宽度，依次兼容旧 chat/agent/computers/settings 宽度键，首个可用值作为迁移值；这是官方共享 sidebar 列的语义。旧键迁移后清除。个人模式、频道数据、草稿与滚动内容不由 resize 管理。已退休 UI 不恢复，官方选取原始源码不改。

仍未包含：动态/搜索列表的独立 activityList 折叠状态、移动滑动。官方将 activityListHidden 与 sidebarHidden 分开；不能直接共用本批的布尔值。
