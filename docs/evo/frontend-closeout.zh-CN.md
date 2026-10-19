# 官方 Web 页面级收口清单

本页是当前入口清单，不替代目标合同。历史批次的 `remaining` 是当时状态；当前判断以本页和后继证据为准。不得通过组件数量或测试数量计算完成百分比。

## 版本与本次结论

2026-10-19 重新请求官方 `https://app.raft.build/s/hakasemac/`，仍为 **v1.21.22**，revision `af3d6ef4a22f0f05f5f9db9424285755d67e9726`。重新下载的主 JS 和 CSS SHA-256 与已锁定资源逐一相同。没有以旧版本冒充官网当前版本。本次未获得登录后的官方页面截图，不能称双站逐像素验收。

初次页面盘点部署为 `ddb10a27`，当时只审查与复验。后继手机首页修复已部署 `d74f92bf`，详见[接线证据](evidence/2026-10-19-official-page-audit/mobile-home-verification.json)。三个隔离 Core 浏览器切片全部通过：navigation、page-polish、layout；前两者为 1440×1000 / 390×844，后者为 390 / 900 / 1440 宽的明暗主题，DPR1。没有付费 CLI 调用。

结论：**已采用页面的主要流程有定向验收，但不满足“官方所有 UI 和全部逻辑完整对等”声明。** 本次没有复现需要紧急修复的新产品缺陷。下面的功能缺口、验证缺口与主动排除不能混成一种“未完成”。

## 页面与次级入口

“已验收子集”只覆盖所列证据，不表示该页所有错误、加载、空态和权限组合全通过。已通过的流程仅在相关代码变更或出现明确回归时重跑。

| ID    | 页面／入口                         | 采用与接线             | 证据及当前边界                                                                                                                                                                                                                                                                                                                                     |
| ----- | ---------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI-01 | 顶栏、左栏、手机首页导航           | 已验收子集             | [壳层](evidence/2026-10-19-official-page-audit/shell-verification.json)；本次导航、URL刷新/前后退、草稿保留、可点击目标复验通过；手机布局是明确采用的适配，不是官方 iOS App 完整移植                                                                                                                                                               |
| UI-02 | 聊天列表、分组、菜单、拖动         | 已验收子集             | [共享侧栏](evidence/2026-10-19-official-page-audit/deep-composition-verification.json)；原有拖动/菜单门禁保留，不重复全部变异；私密入口见 UI-06                                                                                                                                                                                                    |
| UI-03 | 聊天正文、composer、成员设置       | 已验收子集             | [正文](evidence/2026-10-19-official-page-audit/chat-verification.json)、[设置](evidence/2026-10-19-official-page-audit/channel-settings-verification.json)、[表单工具条](evidence/2026-10-19-official-page-audit/form-toolbar-verification.json)；输入、成员和权限仍由 Loom 拥有                                                                   |
| UI-04 | 消息列、实例侧栏、二/三列布局      | 已验收子集             | [消息列](evidence/2026-10-19-official-page-audit/preview-thread-verification.json)、[实例侧栏](evidence/2026-10-19-official-page-audit/inspector-chrome-verification.json)；不加入未接线的搜索/最大化动作                                                                                                                                          |
| UI-05 | 收藏、表情、消息菜单               | 已验收子集             | [共享菜单及行为](evidence/2026-10-19-official-page-audit/document-menu-verification.json)；收藏/表情往返、未知结果核实通过；不是每个菜单调用位置都重新验过                                                                                                                                                                                         |
| UI-06 | 独立单聊与频道实例私密消息         | **功能缺口 G1**        | [语义核查](evidence/2026-10-19-official-page-audit/search-private-verification.json)：当前 private box 共享频道实例 session，不是独立单聊；不能冒充官方 DM。独立单聊入口与旧 private-box 列表迁移尚未实现                                                                                                                                          |
| UI-07 | 顶部搜索、最近对象、结果页         | 已验收子集             | [最近会话](evidence/2026-10-19-official-page-audit/search-private-verification.json)、[搜索组合](evidence/2026-10-19-official-page-audit/search-settings-composition-verification.json)；键盘/跳转证据保留；历史按 origin 隔离、查询有界，不代表全量最近历史                                                                                       |
| UI-08 | 动态列表、定位、读状态菜单         | 已验收子集＋**G2**     | [动态菜单](evidence/2026-10-19-official-page-audit/activity-menu-verification.json)；现有读/未读/完成/跳转通过。手机首页未读数字已接入同一summary并通过零值/99+/失败清除验收；activity.list不携带关注状态，但thread.followers可单独读取；取消关注可能让行退出列表，条件读控件和分组仍未完整对齐；不在前端伪造                                      |
| UI-09 | 任务列表、过滤、详情与消息列       | 已验收子集             | [任务组件](evidence/2026-10-19-official-page-audit/task-surfaces-verification.json)、[过滤](evidence/2026-10-19-official-page-audit/task-filters-verification.json)；Loom 的显式任务状态保持，不引入官方专属工作流                                                                                                                                 |
| UI-10 | Agent 的 Role 列表、配置、实例     | 官方组件＋Loom 语义    | [Role表单](evidence/2026-10-19-official-page-audit/form-toolbar-verification.json)；本次标签页实际点击通过。Role不是官方固定session Agent；配置冻结/修订等按Loom合同，不能宣称逐项官方等价                                                                                                                                                         |
| UI-11 | 计算机列表、详情、运行时、实例     | 已验收本机子集         | [计算机](evidence/2026-10-19-official-page-audit/computers-verification.json)、[编辑](evidence/2026-10-19-official-page-audit/computer-profile-verification.json)；本次实例展示通过；远端执行机制冻结，不伪装已上线                                                                                                                                |
| UI-12 | 设置导航、账户、外观               | 已验收子集             | [设置组合](evidence/2026-10-19-official-page-audit/settings-audit-verification.json)、[资源](evidence/2026-10-19-official-page-audit/settings-resources-verification.json)；本次设置导航及明暗主题布局通过；账户是本机身份，不接云组织                                                                                                             |
| UI-13 | 设置通知                           | **功能缺口 G3**        | `NotificationSettings.tsx` 明确只读显示能力，尚无订阅/权限申请/测试推送/通知跳转；不是一个已完成的官方通知设置页                                                                                                                                                                                                                                   |
| UI-14 | 设置运行、管理、用量、关于/日志    | 官方组合＋本机数据     | [设置](evidence/2026-10-19-official-page-audit/settings-verification.json)、[资源](evidence/2026-10-19-official-page-audit/settings-resources-verification.json)；用量只显示实际 CLI 数据，缺失不估算；不是云账单/组织管理等价                                                                                                                     |
| UI-15 | 附件预览、评论、选区和来源跳转     | 已验收支持格式子集     | [评论](evidence/2026-10-19-official-page-audit/attachment-comments-verification.json)、[文档](evidence/2026-10-19-official-page-audit/document-menu-verification.json)、[HTML状态](evidence/2026-10-19-official-page-audit/html-state-verification.json)；纯文本新配方仍只有源码/构建覆盖；PDF评论未启用；真实数据无已发布附件，浏览器使用隔离Core |
| UI-16 | 工作区文件树、浏览、diff           | Loom扩展，沿用官方组件 | [工作区](evidence/2026-10-19-workspace-completion/summary.json)；遵守主机路径授权，不能把文件路径当已发布附件；非官方全功能复刻                                                                                                                                                                                                                    |
| UI-17 | 全局记忆列表、正文、编辑和历史     | Loom扩展，沿用官方组件 | [卡片](evidence/2026-10-19-memory-cards/summary.json)、[工具条](evidence/2026-10-19-memory-toolbar/summary.json)；Channel记忆语义不是官方Agent记忆语义；本批不重新验收写入                                                                                                                                                                         |
| UI-18 | Fork / Side / 重启、启停、工具轨迹 | Loom实例生命周期扩展   | 以目标合同和既有实例侧栏证据为准；官方没有完全等同的Role/Instance及只读Side合同。本批只核查分类，**不新增全覆盖验收声明**                                                                                                                                                                                                                          |

## 有限剩余队列

按以下顺序完成，不再将已通过的附件等细节重新列成无限待办。

1. **G1 独立单聊入口**：用独立实例及普通频道能力提供正常聊天/任务/文件入口；现有频道实例私密消息只能在频道内部进入。先保证旧记录可达，再改变列表入口；不能把已有private box静默迁移成新session。
2. **G2 动态行为缺口**：手机首页数字徽标已收口。已核实 `thread.followers` 可读取真实关注状态，`activity.follow` 可写且已有未知结果读回机制；缺的是列表接线与语义一致，不是整个平台缺接口。取消关注使普通消息列退出动态资格，新精确提及仍可重新出现，不能用前端缓存保留行假装官方等价。官方双击动态是“待列表有首条未读后滚动并高亮约3秒”，不打开正文也不写已读；桌面双击手势已接入：先刷新既有有界列表，再定位首条未读；不写已读或打开详情，离开页面清除请求；手机仍为单击导航。见[定向验收](evidence/2026-10-19-official-page-audit/activity-focus-verification.json)。分组不能仅重排当前加载页；缺完整数据的控件继续明确省略。该项不是单改CSS可完成。
3. **G3 浏览器推送**：保留当前诚实的未接入状态。涉及订阅和安全上下文能力；不能把站内铃铛已经可用等同于浏览器推送可用。它不阻断当前站内聊天MVP。
4. **V1 验证缺口**：对发生改动的调用位置补验证；纯文本预览、成功外链跳转、低频查询错误与真正iOS/Android触摸保留边界。没有复现问题时不为追求“全部状态”无限添加门禁。逐像素跨站比较需要可访问的官方登录态，本次未完成。

主动排除：公开分享、多Human/云组织/账单、第三方MCP管理、音视频预览；远程Computer属于冻结后续范围。这些不作为本轮缺陷或延期修复项。

## 退出条件

当前可以声明“指定版本的保留页面主要路径已做定向对齐和复验”。只有 G1/G2 被实现或由负责人明确延期、所有保留控件均有真实后端动作、并完成所需页面组合验证后，才考虑扩大声明；仍不能声称包含主动排除功能的“官方所有功能完全一致”。官方版本变更时另建差异批，不自动重新打开所有旧测试。

本次原始日志和摘要见 [页面级复验](evidence/2026-10-19-official-page-audit/page-closeout-verification.json)。

后继动态边界核对：3项Kernel定向测试和4项现有客户端测试通过，见[证据](evidence/2026-10-19-official-page-audit/activity-boundary-verification.json)。这是审查结果，不表示新增交互已实现。
