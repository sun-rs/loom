# UI 规则与后端接入盘点

Owner 决策：允许选择性提供内容、暂省没有对应能力的功能和按钮；保留的界面不能改变官方尺寸、比例、字体、颜色、hover／选中、右键、通知、层级和展开逻辑。只导入组件不等于保留 UI 规则，必须连同页面 wrapper、recipe、状态参数一起接入。不得用全局 CSS 缩放或重定义颜色来掩盖接线缺失。

来源版本仍为 `frontends/raft/adoption.json` 的 `a98ae003246a0360872a77d76dec2fccd0347ef7`；没有修改上游文件。以下是静态代码／接口盘点，不代表每个未接入接口都重新做过真实 CLI 验收。

## 本批三个修复

| 问题与触发                 | 官方组成链                                                                                                                   | 修正及验证                                                                                                                                                               |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 列表右侧出现游离红点       | `Sidebar.tsx` ChannelRow → SidebarItem → SidebarItemCount / SidebarItemMetaIcon → channelUnreadIndicator                     | 用原生行内计数替换 AttentionDot；未静音数字徽标、99+截断、未读加粗、静音弱化数字和图标均按官方条件；计数包含在同一行的 hover／选中／点击边界内。菜单打开使用原生行状态。 |
| 消息外框宽高节奏不对       | `ChatPanel.tsx` renderChannelItem → px-3 wrapper → messageGrouping / DateDivider → MessageItem → raft-ui message-item recipe | 补齐两侧12px留白、同作者续行、日期分隔、后继 compact/group 与 follows-system 参数；不修改边框、头像、字体、hover recipe。任务／线程独立分组所需元数据仍待对应接线。      |
| 刷新时列表单独显示加载文字 | `App.tsx` 的整页加载分支                                                                                                     | 初始目录／列表读取期间显示整页 cream 背景、居中文字加载画面；底层业务控件不可见且 inert，成功或失败后退出。后台刷新不重新挡住页面；失败进入既有错误和重试入口。          |

浏览器用延迟 sidebar/get 的可控门验证整页加载；旧实现因缺少整页画面失败。检查消息外框实际边距、续行状态、hover 后几何不变、数字徽标的 DOM 所属和真实未读切换。既有双尺寸所有业务流程继续回归。加载接入另复现了底层搜索控件在初始化期间过早可见的问题，修正可见性，不放宽搜索断言。

## 需要继续接入的后端能力（按纵向优先级）

扩展功能前，先修复已保留界面的规则偏差：移动端应恢复列表／正文切换，搜索应恢复官方选择／正文展示链。不能在窄并排容器里缩字体来解决标题挤压，也不能继续扩充替代原生页面的上下文弹窗。下面的纵向接线顺序以对应原生容器已恢复为前提。

| 顺序                         | 现有后端证据                                                                                                                                                            | 目前产品页                                                                 | 下一条最小完整路径与 UI 边界                                                                                                                                                                                                                                             |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P0：消息与成员交互           | client-sdk `room.member.list`、`room.agent.activity.list`、`message.context`、`navigation.resolve`，Role/Instance稳定身份                                               | 正文只读投影、姓名／头像跳转被关闭；成员目前是对话框                       | 姓名插入@、头像预览／右侧详情、消息定位；保留官方 MessageItem/hover/inspector 触发和层级，不能用另一个详情弹窗代替官方点击规则。                                                                                                                                         |
| P0：线程                     | `thread.create/list/reply`、`thread.followers`、follower移除／恢复；console任务消息列                                                                                   | 频道线程入口、原生侧栏、有界回复、刷新和手机返回已接；关注／独立读状态未接 | 消息列闭环及有回复根消息 standalone 分组已完成，见[线程接线](2026-10-15-thread-ui.zh-CN.md)；关注管理、任务独立分组及搜索到线程的完整定位仍待接。                                                                                                                        |
| P0：任务页                   | `task.global.list`、`task.create/convert/get/list/assign/amend/complete/cancel/reopen/history/review.list` 等；`apps/console/src/view-tasks.ts`                         | 已接原生看板／列表、任务详情、Human状态修改与讨论回复                      | 已有任务管理闭环见[任务页接线](2026-10-15-task-ui.zh-CN.md)；频道原生创建／转换入口已接，见[频道任务接线](2026-10-15-channel-task-entry.zh-CN.md)；指派和折叠历史已实现，见[本批接线](2026-10-15-task-management.zh-CN.md)；审核详情、描述和拖动待接；不新增协作工作流。 |
| P1：消息操作                 | discovery-operations `message.social/react/save/saved`；client-sdk `message.forward.targets/forward`                                                                    | 官方 hover toolbar、右键动作在只读投影中关闭                               | 沿官方菜单／hover工具条逐条接反应、收藏和转发；没接通的动作不显示可用按钮，不替换为自创行尾按钮。                                                                                                                                                                        |
| P1：附件与文件               | file-operations `file.prepare/cancel/list/comments/comment`，上传传输与 AgentHost 根目录访问接口                                                                        | composer 附件关闭；正文附件和转发当前为说明文字                            | 上传→提交消息→原生附件卡片／预览→安全下载；验证未提交文件不成为正式附件。恢复原生composer动作区，不改变现有外壳尺寸。                                                                                                                                                    |
| P1：实例详情、用量与生命周期 | `usage.summary`、`agent.run.usage.get`、`instance.session.reset`、`instance.activation.abandon`、`instance.fork`、`side.create/discard`；console channel/run/usage/fork | Role CRUD、实例添加／重启／移除／私聊已接；细节面板缺失，Fork／Side未接    | 官方 AgentDetailPanel 的既有 tabs/inspector → 状态与用量 → 明确生命周期操作；缺失用量显示unknown，不伪造在线；Side保持只读，Fork身份说明不改。                                                                                                                           |
| P1：频道设置与记忆           | `room.update`、`memory.list/read/search/history/pin/invalidate/restore/delete`、`memory.policy.read/update`；console memory                                             | 产品缺记忆与策略界面                                                       | 原有设置／详情容器接频道资料、策略与共享记忆；保留修订冲突、删除权限；不是新增模型私有文件记忆。                                                                                                                                                                         |
| P2：动态／通知完整操作       | `activity.list/mark/follow`、`notification.list/dismiss`、push配置；console/API                                                                                         | 动态和搜索主要只读；频道右键已接读状态                                     | 沿原生动态列表/右键/详情接已读和关注，保持频道与线程读位置独立；查看即标已读与现有显式标记差异需明确统一，不能靠前端清点消除。                                                                                                                                           |
| P2：运行设置、受限工作区     | `runtime.settings.read/update`、`runtime.guide.read/update`、`agent.workspace.*`；console settings                                                                      | Settings 占位，文件浏览未接                                                | 在官方设置/工作区容器内接真实字段；不引入第三方MCP托管、账户登录或未授权任意文件路径。                                                                                                                                                                                   |

接口名来源：`packages/client-sdk/src/index.ts`、`discovery-operations.ts`、`file-operations.ts`、`agent-workspace-operations.ts`、`composer-operations.ts`。实现仍经过 application-service/Kernel/AgentHost，不由 UI 重建队列或任务状态。

## 不能当作“直接接线”的项目

- 公共客户端当前没有 message.edit/delete 操作；不因 Raft 有按钮就启用或模拟成功。
- 自定义分组独立 sortMode、隐藏空分组等偏好缺少当前对应合约；与纯视觉 token 差异分开处理。
- 当前置顶保留原分组，而上游清除归属；此前审计已记录，需要按 UI 规则统一数据语义，不能只补外观。
- 移动端仍为窄列表与正文并排；需恢复官方列表／正文切换及返回规则，不能以“没有横向溢出”替代验收。
- 搜索目前是本地列表／上下文对话框；官方搜索定位、选择状态和正文／线程展示链未完整接入。应替换到官方链路，避免继续为本地对话框增加替代功能。
- 现有右键菜单的部分图标、分隔线和顺序仍待逐项核对；不把共享 Menu 原语视为完整菜单规则验收。
- 多Human、公域联合频道、计费／账户中继、第三方MCP管理不属于当前目标；远端Computer机制保持冻结，不删除也不扩展。

## 后续每批的准入方法

先列“官方触发→页面wrapper→组件/recipe/状态参数→后端owner→关闭/键盘/焦点/异步规则”；只接本批纵向路径。保留功能必须验证默认、hover、选中、菜单打开、空、加载、失败、禁用状态，覆盖1440×1000和390×844、DPR1。新功能不能覆盖原生字体和几何参数；需要产品新增的Loom专属字段使用原有组件体系并明确为本地扩展。未接功能保持不可用，console在替代路径验收前继续保留。
