# 官方聊天交互链路复核

来源：`frontends/raft/adoption.json` 记录的 botiverse/raft-source
`a98ae003246a0360872a77d76dec2fccd0347ef7`。以下路径均相对
`frontends/raft/packages/web/src`。上游文件和许可保持原样。

本次问题不是缺少上游源码，而是接入只复用了 PublicServerSidebarFrame/Row、
MessageInput 等组件，没有完整接入成员聊天 Sidebar/MainLayout/ChatPanel 的交互链。
上移／下移按钮是本地添加的替代操作，不属于官方交互，现删除。

| 交互             | 官方来源                                                      | 本地实现及边界                                                                                                                                          |
| ---------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 聊天标题         | Sidebar/MainLayout 页面语义                                   | ChannelSidebar 显示“聊天”，不再使用主机名                                                                                                               |
| 空白右键         | layout/Sidebar.tsx surface menu                               | 新建频道／分组；Loom 另保留归档列表入口；不引入联合频道与远端账户功能                                                                                   |
| 分组右键         | 同文件 section context menu                                   | 创建／重命名／删除分组、三种排序及当前选中状态；删除保留频道                                                                                            |
| 行右键           | 同文件 channel context menu                                   | 移动分区、读状态、置顶、静音、归档；当前分区显示勾选并禁用；不再提供上移／下移                                                                          |
| 子菜单与关闭     | 官方 raft-ui ContextMenu                                      | Escape、外部点击、焦点归还、键盘菜单键及触摸长按；窗口边界避让                                                                                          |
| 行拖动           | Sidebar.tsx SortableSidebarItem、传感器                       | 复用 dnd-kit，6px pointer 阈值、500ms/10px touch 阈值和键盘坐标；手动排序内重排或跨分组投放；松手一次带版本 patch，取消不写入                           |
| 分组拖动         | 同文件 SortableSidebarSection/Toggle                          | 从标题拖动，仅纵向位移；复用 sidebarDnd.ts 的 replaceSidebarSubsetOrder 保留隐藏分区位置                                                                |
| 列表／正文分隔线 | MainLayout、useResizablePanel、panelBounds、PanelResizeHandle | 直接复用原 hook、组件及 180/240/320px 参数；8px 命中区域、pointer capture、上下限、布局宽度持久化                                                       |
| composer         | message/ChatPanel.tsx、MessageInput.tsx                       | 恢复官方 full-chat 外壳的顶边线、12px 顶／左右留白、安全区底部留白；内部保留 compact 以禁用尚未接通的附件上传；Enter／IME／未知发送状态仍走原 Loom 合约 |

## 仍存在的已知差异

- 上游自定义分组有独立 sortMode；Loom 当前协议与频道共享排序偏好。未在浏览器偷偷增加第二套持久化业务状态。
- 上游隐藏空分组、仅显示已加入频道偏好尚未接入；Loom 单 Human 已授权频道目录不冒充多用户公共目录。
- 上游置顶会清除原分组归属；Loom 既有置顶／取消置顶保留原归属。本批保留既有数据行为，明确不宣称此处完全一致。
- 原版拖动中即重排跨容器投影，并保留容器高度；本地跨组在松手时提交，在当前列表内显示排序变换，拖出目标区域取消。没有引入第二套持久化排列。
- 手机仍是窄列表与正文同时展示，尚未改为官方的列表／正文切换。这与本批桌面分隔线能力分开记录。
- 部分菜单尚未逐项复用官方 MenuItem 图标／分隔线排版；目前使用同一 raft-ui 菜单原语，不能称为整页字节级复用。

## 验证方法

先将原“点击上移”测试改成真实鼠标拖动，旧实现超时失败；标题断言在旧页面失败。
单元测试先复现排序落点函数缺失与非手动排序被意外覆盖，再实现。
隔离真实 Core、临时数据与假发现适配器验证桌面／手机鼠标重排、跨组、分组拖动、
排序持久化、并发拒绝与未知结果恢复；不启动付费模型。

最终检查、部署和正式只读页面结果记录在本批 evidence；未跑过的验证不由组件复用推断通过。
