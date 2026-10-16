# 官方搜索词历史接线

锚点为官方 v1.21.16 `app-shell-L7litFx-.js`，其 `search-history-tags` / `search-history-edit-toggle` 组合与冻结源码 `a98ae003246a0360872a77d76dec2fccd0347ef7` 的 MessageSearchPage 一致。URL/hash沿用[发布证据](../evo/evidence/2026-10-16-native-topbar/upstream.json)。保留 FSL-1.1-ALv2 通知，沿用 owner 非商用复用授权；不修改官方原文件。

## 接线

- 直接复用 `searchHome.ts` 的 key、读取、规范化、去重、删除、持久化和编辑条件函数：workspace＋Human隔离，最多15条，每条最多200字符，storage失败不阻断搜索。
- 从 MessageSearchPage 结构移植完整历史 section：原生 SectionEyebrow / Badge、Clock3 / X、尺寸、class、文案。桌面hover或焦点显示删除；窄屏先编辑再删除；清空及删除最后一项结束编辑。未添加未接入的常用频率块。
- 按官方 `rememberCurrentSearchQuery` / `rememberMessageResultsSearchQuery` 触发，在打开实体／消息结果或进入全部结果时记录；普通键入与输入法未提交片段不记录。点击历史写入搜索URL，恢复输入焦点与末尾光标，调用原搜索路径。
- 浮层与背景页可同时挂载，Loom只补同页面、同scope的历史更新通知，持久化仍使用官方storage；不建立新的后端或消息状态。
- 完整搜索页无查询且无有效过滤时显示历史；浮层继续显示最近访问对话，不混用两种历史。现有认证目录传入principalId，历史为浏览器便利数据，不是后端业务真相。
- 最新Web壳的顶栏有 `leadingEnd` 宿主注入口，本次未确认独立导航历史控件的完整宿主组合链；不凭翻译词条添加前进、后退、历史按钮。

## 验证与边界

新增浏览器专项先复现缺少history tag失败。实现后1440×1000及390×844检查未提交输入不记录、打开结果后跨刷新保存、点击执行原搜索并返回焦点、桌面／手机删除、清除全部后刷新不恢复；桌面另查全部结果入口记录及浮层不出现历史标签。初次输入值断言早于React更新，改为等待输入值、焦点、光标同时成立；未改变期望。全部结果专项另复现了浮层写入后背景页不立即更新，已用同scope界面通知修正并保留用例。复验最近访问／原生菜单专项；类型、产品构建、来源检查、格式与diff按本批范围运行。不跑全仓后端或付费CLI。

未实现常用对象频率、跨设备历史、顶栏独立历史菜单。浏览器清除存储会丢失历史，存储拒绝时仅当前挂载组件内保留。真实页采用只读搜索和临时浏览器profile核对，用户数据与已读位置不变。[本批证据](../evo/evidence/2026-10-16-search-history/summary.json)。
