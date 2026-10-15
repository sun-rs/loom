# 动态卡片正文定位

来源：授权 Raft 源码 a98ae003246a0360872a77d76dec2fccd0347ef7，FSL-1.1-ALv2，保留既有 notices。

官方 `ThreadsInbox.tsx` 的 `handleActivate` / `navigateToChat`：旧列表模式宽屏1024起单击延迟220ms打开详情，双击进入聊天；窄屏直接进入聊天。`MainLayout.tsx` 提供列表默认560、400–720拖动范围，消息列打开时使用 `masterDetailPanelSizing.ts` 的320–480紧凑范围。新 inbox feature flag 有768断点分支，本批采用当前普通列表的1024分支。

本地此前把动态点击接到 MessageContextDialog，二次打开仅传Room ID，消息身份丢失。现在动态卡片单击／键盘打开对应正文，宽屏保留动态列表，双击全页；频道、私聊、消息列保留room/message/thread URL身份，刷新恢复，浏览器返回回到列表。关闭消息列清除回复定位，异步导航核对当前路由及请求代次，拒绝覆盖较新的选择；不可访问的消息显示失败，不制造成功。

直接复用官方 MessageTimeline、MessageItem、ThreadPanel、PanelResizeHandle、useResizablePanel。通过现有 `threadSearchActive` 视觉状态触发 MessageItem 的原生 `data-highlighted`、`bg-info/10`、brutal青色与阴影，不写新的高亮CSS、不向官方消息store注入正文。ThreadPanel冻结源码不改，通过既有受检构建适配传入定位ID、后续分页及高亮状态。ActivityMessageRow 的点击时序及详情区组合是结构移植，本地路由和SDK是胶水代码，不宣称整页原样复制。

RoomTimelineSession / MessageSession 仍分别拥有频道和消息列的窗口、游标。定位验证message.context的消息ID、Room及Thread后，读取不超过50条前向上下文（含目标）和25条后续内容；验证完整后才替换窗口，不遍历目标与最新消息之间的历史。历史窗口未到末尾时暂停自动向最新追赶，用户滚动通过原生分页加载。新会话/消息调度、Kernel业务状态、Provider上下文不变；定位不调用activity.mark，不伪造已读。

本批边界：按动态卡片展示的消息ID定位。服务端当前投影没有首条未读／首条提及的消息ID，因此尚未复刻上游这两种目标优先级。搜索仍保留上下文预览，后续应复用这条正文定位链路；任务动态目前进入其消息列而非新增任务工作流。消息列关注、独立阅读状态、完成／未读菜单未在此批实现。

验收按2026-10-15 Owner分级规则执行：修改前专项浏览器因缺少目标高亮失败；client-core定位先红后绿；20项窗口／会话／线程专项、前端来源检查、受影响类型检查与构建，以及1440×1000、390×844实际pointer浏览器。临时Core验证卡片之后新增65条频道消息／60条回复仍定位原目标，私聊、刷新、返回、双击、边框拖动和关闭线程。私聊夹具首次错误使用agent配置ID被后端拒绝，改为真实instance principal；拖动专项发现原生resize handle仅支持sm/md，改用md（详情本身仅在1024以上显示）。失败不隐藏，不运行整仓check或付费CLI。

当前部署与结果见[证据](../evo/evidence/2026-10-15-activity-navigation/summary.json)。
