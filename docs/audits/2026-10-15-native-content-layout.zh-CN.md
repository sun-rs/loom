# 动态、搜索、聊天的官方页面组合

来源：授权 Raft a98ae003246a0360872a77d76dec2fccd0347ef7，FSL-1.1-ALv2；原始源码逐文件摘要不变，保留 notices。此次不是完整页面逐字复制：原生组件直接复用、页面组合结构移植，SDK／身份／鉴权仍由 Loom 提供。

| 触发                                                   | 官方来源                                                        | 本地实现与状态                                                                                                        |
| ------------------------------------------------------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 动态单击频道／私聊                                     | ThreadsInbox.handleOpen + MainLayout.renderContentSlot          | 右侧同一 Channel；宽屏单击详情、双击聊天，原列表窄屏单击直接聊天                                                      |
| 动态单击线程                                           | MainLayout.ActivityThreadContentRoute                           | 主内容槽直接 ThreadPanel，列表＋线程，关闭返回原筛选列表                                                              |
| 搜索单击／双击消息                                     | MessageSearchPage.openResult / handleMessageResultClick         | 原生 MessageHitRow；220ms单击详情、双击完整聊天；线程结果直接主槽，不弹自建上下文框                                   |
| 搜索结果窄屏选择                                       | MainLayout.SearchContentRoute                                   | 保留搜索路由与结果状态，隐藏列表展示选中正文；返回恢复列表                                                            |
| 已开详情缩放窗口                                       | MainLayout.searchMasterDetail / masterDetailPanelSizing         | 768起列表＋详情；1024以上默认560（400–720）；平板或额外线程／实例侧栏使用独立320（320–480）；缩放不改路由或卸载主详情 |
| 消息列从频道内部打开                                   | MainLayout.RightPanel + index.css thread-layout                 | 原生容器查询和横竖屏规则决定第三列或覆盖；不复制断点到第二套CSS                                                       |
| 频道打开实例详情，已有线程                             | MainLayout.renderStackedSidePanels + thread-profile-side-column | 原生data-collapse-thread标记折起线程，保留挂载与草稿；Escape只关闭顶层实例详情                                        |
| 直接线程内打开实例详情                                 | MainLayout.RightPanel / MessageItem.onOpenProfile               | 尚未接入受控线程的头像回调，不宣称已完整复用                                                                          |
| 动态对勾                                               | ThreadsInbox.InboxRow / inboxStore.markDone                     | 未接：Done是按活动边界处理完、收起动态并清理未读；不是Task完成，也不能用普通已读代替                                  |
| 动态首条未读／提及、收藏／完成列表与菜单               | ThreadsInbox对应选择与数据源                                    | 尚缺部分投影与业务契约，现按卡片展示消息定位                                                                          |
| 搜索完整输入头、筛选、结果分组、实体结果、快捷搜索浮层 | MessageSearchPage                                               | 原生消息行已使用；其余完整页面组合仍待接，不能把现有简化搜索表单称为官方完整页面                                      |
| 聊天线程内头像、并列侧栏恢复等剩余交互                 | MainLayout / ThreadPanel / ProfilePanel                         | 频道来源的实例面板已修正；线程来源和其余菜单须继续按原入口接入，不另创一套页面                                        |

验证限于受影响范围：构建含前端类型检查、官方来源65项、线程适配4项、临时Core专项1440×1000与390×844，另实际切换900→390→1440。覆盖旧消息定位、频道／私聊／线程、单击双击、刷新返回、关闭、拖动、搜索主槽、缩放不改URL、频道线程中打开实例详情及关闭后草稿恢复。没有全仓测试、付费CLI或效率声明。

失败保留：直接线程多挂侧栏拖动柄先红；频道打开实例详情被线程条件挡住先红。测试编写中纠正原生textarea选择器、URL变化早于React提交的等待、查询按OR导致旧目标不在第一页，以及成员弹窗退出动画尚未结束时过早发送Escape。搜索旧上下文链路被移除；老的发现页用例也更新为正文定位／权限拒绝后不导航，未宣称整个发现页大套件已重跑。

另经正式截图和 MainLayout.useMobileTabBarVisible 对照，移动搜索／动态的底部导航与返回头仍有差异，列入下一批，不把当前六入口导航视为原生页面完整对标。

本批后续顺序：先补线程来源实例详情与剩余关闭／返回关系，再移植搜索原生输入头和完整筛选组合，再对接动态Done及菜单的持久化语义。全部遵循同一主槽和侧栏所有者；不为某个页面另造状态机，不用成功fixture代替真实后端。
