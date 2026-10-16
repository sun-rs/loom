# Fork／Side 产品前端接线

## 来源与边界

官方来源 <https://github.com/botiverse/raft-source>，revision `a98ae003246a0360872a77d76dec2fccd0347ef7`，FSL-1.1-ALv2；原许可保留，owner 另行授权非商用复用。raft-ui 为0.5.64。

Fork／Side 是 Loom 专属能力，不声称官方有相同业务。复用官方 AgentProfileOverflowMenu 所用 DropdownMenu 组合、完整 ConfirmDialog、ThreadPanel 的侧栏外壳、panelBounds 和 useResizablePanel，以及 index.css 的 thread-layout 容器查询。会话正文／输入／历史和发送直接复用现有 Channel 组合。未修改官方源码或尺寸／字体／主题规则。

Side 外壳是原生 ThreadPanelRoot／thread-side-column 的结构移植，数据与 URL 组合为本地胶水。只保留最外层 thread-layout 容器，防止嵌套容器将桌面关闭误判为窄屏返回。桌面源聊天和 Side 并列且可拖动；窄屏折叠源聊天，返回恢复原视图。关闭面板不丢弃会话。

## 已接通

- Agent 页实例菜单、频道实例详情菜单提供 Fork／Side。能力来自当前冻结 runtime 的 sessionBranches、唯一 offer 和 channel_home；无厂商白名单，也不以空白 session 冒充复制。空闲、已建立会话和权限最终仍由 Kernel／Host 双重校验。
- Fork 调用 instance.fork，创建同 Role／冻结配置的新成员。原生上下文和新身份说明由冻结后端负责，前端不拼接系统提示或重读整个 box。
- Side 调用 side.create，打开 `room=<source>&side=<sideRoom>`。独立 RoomSession／WriteIntentSlot／有界时间线，消息发送只绑定 Side roomId；不进入普通频道／实例列表。
- 实例菜单按需读取 room.list，显示既有 Side（包括已丢弃历史），可重新打开；不为每个实例增加持续轮询。刷新 URL 可恢复 Side。
- side.discard 与 Side 发送共用写槽。忙时立即禁止发送，显示等待执行退出，后台确认终止／清理后转为已丢弃只读。未知创建／丢弃保留同键同载荷核实或显式放弃，状态轮询不能擅自清除未知意图。

## 验证与保留限制

隔离测试使用真实 Kernel、Application Service、SDK 和 gateway，原生复制及执行为明确标识的假适配器；不冒充真实 CLI／模型。验证 Fork 新成员、Side 双向私有消息、源频道写入被拒绝、源频道序号不变、刷新／关闭／重开、精确重放、窄屏折叠、桌面拖动及忙时丢弃的终止证明。类型、源码检查和产品构建限定于本批，无全后端套件或付费调用。

实际 CLI 复制、身份交接和 Side 权限沿用 [冻结后端证据](../evo/session-branches.zh-CN.md)，本次没有新增五家付费模型结论。真实页面只检查入口、能力预览、取消、布局和错误，不创建真实分支、不发消息。结果及部署见 [证据](../evo/evidence/2026-10-16-branches-ui/summary.json)。

限制：源实例移除后，现有 Side 可保留直接 URL，但缺少独立全局 Side 历史管理入口；不新增大页。物理手机和真实 provider 本次未重跑。CLI 同 UID 文件权限不构成 OS 只读沙箱。频道记忆前端和其余 console 替换仍为后续工作，暂不清退 console。
