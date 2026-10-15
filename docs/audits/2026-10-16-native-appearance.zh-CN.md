# 原生外观设置与新版页面结构核对

## 来源与实现

采用仓库既有官方快照 `a98ae003246a0360872a77d76dec2fccd0347ef7`（`v1.21.12-source.1`）；来源、许可与摘要见 [adoption.json](../../frontends/raft/adoption.json)。官方产品源码保留 FSL-1.1-ALv2 声明，owner 另有复用授权；npm `raft-ui` 为 MIT。

直接渲染 `packages/web/src/components/settings/SettingsPanel.tsx` 的 `AppearanceSection`（6609 起），只在构建时追加具名导出，原文件保持不变。主题卡片、明暗／跟随系统、消息字号、消息预览和三个开关均使用原 JSX、组件及参数。既有 AppThemeProvider 与 appearanceStore 是唯一偏好所有者，保存在当前浏览器；没有另造设置模型或上游账户同步。原生页提供消息字号小／中／大（12／14／16px），没有字体家族选择器。

本地接线：SettingsPage 选择外观分区；AppearanceRuntime 使用已鉴权的 agent.list、host.runtime.list、room.agent.activity.list 提供显示数据。模型开关沿用 MessageItem 原生判断，仅补目录标签来源；实时条直接使用 LiveAgentActivityBarPresentation 与原生桌面／移动容器参数；空分组开关使用原生辅助函数。无后端、调度、付费请求或依赖升级。

边界：实时条目前表示当前选中对话，不是全工作区活动聚合；模型标签表示实例当前配置，不证明历史每条消息的实际运行模型。未知目录不填猜测值，活动只来自正式状态接口，空闲时消失。空分组拖拽期间的临时展开尚未接入。虚拟模块仅声明导出组件类型，避免静态引用 SettingsPanel 的无关设置代码引入其既有计时器类型问题；实际构建仍加载同一官方模块。

## 定向验证

先确认缺少原生页面／导出边界的失败，再实现。来源／适配测试 73 项、Loom 前端 typecheck、实际 Web 构建通过。隔离 Core 浏览器在 1440×1000 和 390×844、DPR 1 检查主题、系统明暗变化、刷新保留、预览及真实聊天字号、模型标签开关、空分组和实时条开关，无横向溢出或页面异常。实时工作状态仅在隔离浏览器中模拟，未启动模型。未执行全仓测试或付费 CLI。正式部署另记当前状态页。

## 最新结构：先拿代码，再换壳

2026-10-16 核对 [线上页面](https://app.raft.build/s/hakasemac/) 的公开构建及 [公开产品源码](https://github.com/botiverse/raft-source)：线上为 `release/v1.21.16`、`5239f1af1868fa551d7f9284b927341807b770aa`；公开源码仍为上述 1.21.12 快照。公开生产资源 `app-shell-L7litFx-.js` 已留存于本机 review 目录；登录页不作为已登录布局视觉验收。

- 新版 Web 桌面有 48px AppTopBar，迁入工作区选择与搜索入口；该选择器不能直接解释为计算机选择器。LeftRail 在 topBar 模式隐藏旧入口。
- 搜索采用浮层与背景路由，但仍保留 `presentation=page` 和“查看全部结果”，并非删除完整搜索页。
- 标题高度走主题 recipe（Brutal 62px、Elegant 56px），不能凭截图全局缩短 CSS；尚无本次已登录前后视觉对照。
- npm `raft-ui` 当前 0.5.64；本地 0.5.52 已有此次所需主题组件。包不包含完整 AppTopBar 和产品路由，单升级 npm 无法获得整个新版壳。产品主题注册限制 Brutal 亮色、Elegant 亮／暗，未自行增加配色。

后续顺序：取得新版产品源码并登记版本 → 原样采用 AppTopBar／SearchOverlay／MainLayout 路由组合，替换 Loom 数据来源 → 同步原生标题 recipe 与响应式布局 → 再下线旧搜索导航入口，保留完整结果页。若最新源码尚未公开，应明确等待或登记生产代码的结构移植，不能把自行绘制布局称作官方源码复制。本批仅实现外观，不提前重写顶栏。
