# 侧栏上下文菜单核对与实施记录

## 来源和已确认行为

2026-09-12 在用户已登录的 Raft Chrome 页面实测右键，没有执行停止、归档或发送操作。
冻结源码参考 `docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js`，
SHA-256 `7328c15614ac53c7cc906e0f56665dd822a4c0ffaa64e4cb6b9a7a76a692b26a`。
这是结构性移植与本地 facade 接入，不是逐字复制，也不等于所有状态已经双边验收。

| 对象              | 实测菜单                                   |
| ----------------- | ------------------------------------------ |
| 普通频道          | 移动到分区、标为未读、置顶、静音、归档     |
| all               | 移动到分区、标为未读、置顶、静音；没有归档 |
| Agent DM          | 移动到分区、标为未读、置顶、关闭会话       |
| 成员页 Agent      | 发消息、停止、重启 / 重置                  |
| 成员页 Human 自身 | 发消息                                     |

源码 `zW` 从约 2,742,412 起，频道/DM/Agent 触发器分别在 2,736,592、2,738,600、
2,740,178 附近；`hiddenDmIds` 保存隐藏 DM，关闭不是删除 Room 或历史。约 2,747,193
按 name=all 优先排序；空白处 `sidebar-surface-context-menu` 约 2,799,706 显示创建频道、
条件性创建联合频道、新建分区。空白处实测点击命中了子行，不能记录成空白菜单实测通过。

成员菜单实测：宽 192px，黑边 2px，墨色 4px 阴影；行 padding 8px 12px，font 14/20、500。
本地 `ContextActions` 复用现有 Base UI 1.3.0 ContextMenu 的焦点、外部点击关闭和长按机制，
补键盘 ContextMenu / Shift+F10 桥接。业务动作沿用现有 AgentStateDialog / AgentExecutionResetDialog。
右键目标独立于正在浏览的 Agent，不能将 B 的操作误发到 A。

## 尚存的差异

RAH SidebarPreferences 尚无自定义分区、隐藏 DM 或标为未读写入接口。因此用户所述“仅缺菜单”
并不完全成立：这些项目需要同一 HumanSidebar owner 的持久偏好扩展与权限/版本/重放测试。
Human 自身 DM 在 RAH 当前单 Human 范围不支持，菜单保留发消息项但禁用，不伪造成功。
默认 all 的现有数据迁移方式等待用户选择：改名现有 Agent Council 或新建。

成员菜单已通过隔离浏览器：右键、现有停止确认窗口、Escape、Shift+F10；尚未正式部署。
刷新失败的 WebKit 恢复门禁仍在排查，不能把 UI 改动与未通过恢复核验的正式构建混合发布。

## 本批正式部署结果

已备份原状态并 graceful restart。成员菜单已正式部署，三个地址的正式 Chromium 页面均验证
四个原 Agent、右键菜单、历史消息及刷新恢复。WebKit 在正式 Tailnet 页面阻断模块两次后
恢复请求，点击重新加载成功显示原四个 Agent，无残留 dialog。查看了恢复截图。
默认 all 与聊天侧栏菜单仍未实现；不将成员菜单的完成外推到这些项目。

构建 `1268ec0994e7bbd561f4de576194ea70a6510732fa19a78edc3a38a82c88c8ac`。
根测试 1566 项：1547 通过、17 跳过、2 项既有图标断言失败。类型、格式、diff、Web 单元、
parity regression、恢复浏览器、成员菜单、样式协议实测与正式页面验证通过。
无付费 CLI 测试，无 commit，未宣称用户 iPhone 5G 实测已通过。

## 续批：后端规则与菜单接线

用户明确要求常驻 `#all` 后，采用**新增公共 all，保留 Agent Council 原身份与历史**。
正式 bootstrap 用 Kernel 创建命令幂等补齐，并原子替换默认 Room 元数据；不改已有消息、
Agent 配置和记忆。`all` 的不可变 slug 是后端身份：禁止删除、归档、离开、改名或私密化，
创建也拒绝私密 all 或以另一 slug 冒用 all 名称。保留描述编辑。显式深链优先，无 Room
深链时优先 all。该初始化归正式本地工作台 bootstrap；不声称所有 headless Workspace
创建入口已经自动创建 all，也不隐式扩大 Agent 的 Room 执行成员权限。

来源补核：同一冻结 Web bundle 的 `sr`（约 2,644,566）使用
`hover:bg-soft-signal/30`，发布 CSS 对应 `#ffd4404d`。本地复用既有
`--soft-signal: rgba(255,212,64,.3)`；此前误用实心 `--yellow`。
Raft 官方文档 `features/messaging/channels/index.md` 明确每个 server 内建公开 all。
Web 的约 2,800,782 处 `!et` 排除 all 归档。**未找到 Raft 中央服务端源码**，
因此这些是公开行为与 API 使用证据，不是其后端实现已审查的证明。
Multica `server/pkg/db/queries/channel.sql` 管外部平台接入，不适合移植为内建聊天频道。
本批为 RAH owner 内结构性实现，不是 Raft 后端逐字复制。

- `HumanSidebar` 扩展 `hiddenDms` 与 `customSections`，沿用 Human×Workspace 私有性、
  版本和幂等命令，目标必须在可见集合内；旧 JSON 默认为空，部分 patch 不重置旧字段。
  关闭 DM 仅隐藏；canonical open-DM 同事务恢复显示。频道删除清理分区引用。
- `HumanActivity` 接受显式 unread：最新已观察消息头匹配时回退个人 frontier，恢复最后
  一条外部消息的未读；消息已变化则拒绝，不能以旧请求覆盖新事实。普通 read/done
  仍只单调推进。前端先等已有读取请求完成，并暂停当前频道自动已读直到重新进入。
  多浏览器同时操作的显式读取仍可再次标记为已读，并未引入全局禁止阅读状态。
- 聊天普通频道/DM/all/空白区域分别提供菜单；移动到分区使用 Base UI 子菜单；
  分区创建与归档使用共享焦点协议弹窗，失败保留窗口与错误。归档基于右键目标的最新
  RoomSession，不依赖当前选中频道。分区、置顶、静音、关闭会话均走持久 API。
- 联合频道不在当前产品范围，空白菜单不伪造该功能。

验证包括：修复前 hover 和聊天菜单失败测试；Kernel 常驻 all、分区/隐藏/重新打开、
unread 旧消息头拒绝；真实鼠标子菜单、分区刷新持久、静音、归档取消、空白区及键盘。
最终检查与正式部署结果另见本批交付记录，不将此实施记录等同于完整双边验收。

补充源码 `Bo`（约 2,777,237）：已有未读时显示 markAsRead，否则 markAsUnread。
菜单现按 canonical unread summary 切换，分别调用已有 read 和本批显式 unread。
完整回归曾发现恢复 DM 显示误作用于 Agent 调用：现仅 Human 执行个人侧栏恢复，
Worker Direct Room 创建/同一 pair 收敛的回归已恢复通过。

官方文档来源：`https://github.com/botiverse/raft-docs.git`，本地参考 revision
`126af666e08a6d96e8990e59dcb9a003a5f85576`；Multica 对照 revision
`11861145abc59a0d39c8c8f24ad837d4584e664f`。均只读分析，没有作为产品运行依赖。

## 续批正式交付

`npm run check` 通过：根测试 1571 项（1554 通过、17 跳过、0 失败），其后 Web 单元、
parity regression、正式浏览器策略和 bilateral-capture 元测试均通过。类型、格式和 diff
检查通过。子菜单箭头最后调整为右对齐后重跑聊天浏览器并重建。Chromium/WebKit 隔离
浏览器验证分区刷新保存、静音切换、归档取消、空白菜单与 DM 隐藏后刷新仍不出现。
不是完整 Raft 双边功能验收，也没有运行付费 CLI。

最终正式构建：`817e7ccb65d035bf5af6a17e42222cbc0edbff5d92080ad0b63bf83eb78e8b3d`。
平滑重启并保留 `/Users/sun/.rah/state`；最后备份为
`pre-restart-c47b826c-eb12-4890-b146-7e63fb138ae9`。
复核期间曾有另一启动流程将正式服务替换为仅 loopback；本批随后恢复三入口，未修改
其他启动流程或宣称它们以后不会再次覆盖监听配置。

最终正式 Chromium 页面逐一验证 loopback、当前 RFC1918 LAN、Tailnet：默认 all，
all 无归档/删除入口、名称不可编辑、浅黄菜单；原四 Agent 与 Council 历史均存在。
正式 WebKit 390×844 再次阻断模块两次后解除，刷新恢复到 all，底部导航可见；检查了
实际截图。不代表用户 iPhone 移动 5G 网络已做同条件验收。
无 commit/push；不把其他并行 UI 变更归为本批作者工作。
