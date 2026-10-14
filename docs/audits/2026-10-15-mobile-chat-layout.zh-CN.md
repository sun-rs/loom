# 聊天页手机主从布局纠偏

依据：`frontends/raft/adoption.json` 固定的 [raft-source a98ae003](https://github.com/botiverse/raft-source/tree/a98ae003246a0360872a77d76dec2fccd0347ef7)，沿用 FSL-1.1-ALv2 和 owner 授权。官方源码保持原样，本批仅修改 Loom 组合层。

## 官方规则与本地接入

| 触发／状态                 | 官方源码依据（相对 `frontends/raft/packages/web/src`）                                | Loom 接入                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 手机打开聊天列表           | `components/layout/MainLayout.tsx` 的 `mobileShowSidebarInline` 与 sidebar/main slots | 列表独占整列，详情隐藏；保留原生列表行、右键、排序、分组和拖动。                                                                   |
| 列表打开频道／私聊         | `MainLayout.tsx` 的 detail route 与 `useMobileTabBarVisible`                          | 详情占满页面，侧栏和底部导航均隐藏，底部不留占位条。                                                                               |
| 左上角返回                 | `components/ui/PanelHeader.tsx` 的 `onMobileBack`、`mobileBackProps`                  | 直接复用官方返回控件；返回列表不更换已选 Room，不销毁 composer／WriteIntentSlot。                                                  |
| 切换手机主导航到聊天       | `MainLayout.tsx` 的 `MobileTabBar`／`selectTab`                                       | 打开列表根页，不把带 Room 参数的其他页面误当作聊天详情入口。                                                                       |
| 手机列表外壳               | `components/layout/Sidebar.tsx` 的 `mobileInline` root、header、scroll surface        | 结构移植到 `ChatSidebarFrame`：白色正文、无桌面右侧边框、手机页头、原生滚动留白；桌面保留奶油色、边框、原始宽度 bounds／splitter。 |
| 首次连接失败               | 既有 Loom 目录读取错误 + 上述列表／详情容器                                           | 在当前可见列呈现同一错误，不能因详情隐藏而丢失错误。                                                                               |
| 浏览器前进／后退、宽窄切换 | 原生 route/master-detail 分工                                                         | URL 表达页面位置；已选 Room 的组件保持挂载，草稿与未知发送结果不因单纯显示切换丢失。                                               |

本地差异明确：Loom 使用 `room` 加 `chat=list` 查询参数，而非 Raft server/channel 路径；`chat=list` 只表示页面位置，不拥有读游标、队列或任务。单机聊天标题替代上游 server switcher，省略当前没有对应能力的服务器切换／账户按钮，采用官方普通手机标题参数。六个主入口仍是已有本地范围；Agent／搜索等其他页面的完整手机导航规则不在本批完成声明内。

## 安全与测试边界

- 返回列表不触发 activity.mark；点击频道的既有已读规则保留。
- 未知发送期间跨频道选择仍受既有围栏保护，被拒绝的导航不得确认目标频道已读。
- 频道和私聊的未知发送在列表往返后仍核实原请求，不能因组件卸载或导航自动重发。
- 所有发送、归档、移除、实例操作回归只在隔离 Core／假发现目录运行，无模型执行。
- 先红后绿覆盖并排布局、桌面底色／边框残留、手机根页隐藏连接错误和主导航错误进入详情。CSS 颜色以实际像素值比较，避免 RGB 与 OKLCH 序列化差异。
- 旧门禁改为先返回列表再操作，未删除原有数据隔离、未知结果、归档保护、已读、草稿和持久化断言。

完整私聊列表尚未接入；本批验证私聊返回列表后通过浏览器后退恢复原详情及未知发送核实，不宣称列表已有私聊入口。

本批只收口聊天模块的手机布局与返回路径。系统消息、可见窗口自动已读、搜索主从定位、完整私聊侧栏、Fork／Side inspector 和其他模块的官方对齐仍需继续。
