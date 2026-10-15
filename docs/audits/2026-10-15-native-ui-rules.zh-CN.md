# 官方前端规则继续对接

来源：授权 Raft a98ae003246a0360872a77d76dec2fccd0347ef7，FSL-1.1-ALv2，原始文件与 notices 保持不变。

| 规则                                | 官方依据                                                                         | 本地落点与处理                                                                                                                                                                                                 |
| ----------------------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 搜索输入即查询、组词保护、清除、Esc | MessageSearchPage.searchFieldInner / full-page PanelHeader、searchComposition.ts | SearchHeader结构移植官方JSX／类名／组件参数，直接复用组合输入判断；URL通过Loom路由回调，读取200ms防抖；删除独立提交表单；输入框Escape关闭主详情或返回聊天列表                                                  |
| 范围、时间、排序                    | MessageSearchPage的三个Select区块、searchGrouping.ts                             | SearchFilters结构移植三个区块，直接复用原生Select／PickerTriggerButton／弹层、标签与范围归一化；native-search只把原生筛选映射到既有Kernel字段。移除自创的频道／私聊／线程表单选择器；旧URL scope仅保留读取兼容 |
| 日期分页                            | searchGrouping.buildTimeRangeParams                                              | 一组结果固定其时间窗口，翻页不重算after/before，避免游标绑定漂移；人类与Agent同时勾选等于不限制作者类型，提及自己可叠加                                                                                        |
| 移动搜索／动态覆盖底栏，顶部返回    | MainLayout.useMobileTabBarVisible、MessageSearchPage／ThreadsInbox的onMobileBack | ChannelApp不渲染这两页底栏，复用PanelHeader返回入口；返回聊天列表；关闭主详情保留筛选／查询                                                                                                                    |
| 线程头像打开实例                    | ThreadPanel的父消息和renderMessage、MessageItem.onOpenProfile                    | 受检构建适配将两个原生MessageItem回调接到宿主；ThreadWorkspace借用已授权成员投影，复用现有InstanceInspector与MessageProfile，不引入新资料弹窗或上游业务store                                                   |
| 从线程打开实例，折起频道            | MainLayout.renderStackedSidePanels / index.css的thread-profile-side-column       | ChannelApp记录入口来源，使用原生data-collapse-channel／data-collapse-thread属性；保留ThreadWorkspace挂载、正文和草稿，Escape只关闭顶层资料                                                                     |
| 动态／搜索直接线程再打开实例        | MainLayout内容线程与ProfilePanel组合                                             | ThreadContentSlot仅组合现有线程和实例详情，继承原生宽度和覆盖规则；开启实例时列表切紧凑宽度；关闭恢复线程草稿                                                                                                  |

直接复用与结构移植区分：原生组件、图标、CSS、输入法和时间／范围函数直接调用；搜索头部和筛选组合为来自指定源区块的结构移植；URL、稳定身份、授权成员与SDK字段为Loom胶水。未宣称三个大页已经整页逐字复用。

验证：新行为先红（原先输入不能自动查询、线程头像不能打开实例、筛选映射模块尚不存在）后绿。68项来源／适配／筛选检查、单独前端typecheck、Web构建；隔离Core专项1440×1000及390×844、900中间宽度。测试明确设置zh-CN；此前默认英文导致中文筛选标签定位失败，未改产品强制语言来迎合测试。线程作者用浏览器只读响应的UI夹具投影为该房间已有实例，不伪造Worker身份、不改持久作者、不使用付费CLI。验证父消息与回复头像、两种入口折叠规则、草稿恢复、筛选请求字段、组词与导航。旧大套件仅同步新入口预期，未宣称全量重跑。

未接齐：搜索发件人／频道选择器、结果分组与实体结果、快捷搜索浮层及完整键盘结果选择；动态Done、收藏／完成集合及相关菜单；首条未读／提及锚点。没有后端契约的操作不接成形似但语义不同的按钮。移动返回目前落聊天列表，完整来源路由恢复仍待对齐。没有调度、Provider会话或成本规则变化。
