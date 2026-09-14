# 搜索预览布局与离开清理

## 来源与差异

授权Raft归档index-MqTUR4Ez.js，SHA256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
170570–170587的Zw：搜索宽列400–720/default560，紧凑列320–480/default320；
124117–124127的sQe/iQe独立选宽，132588的Y8断点1024，171026–171066左右并列。
97765–97782的Wi/vK为text-xs、font-bold、text-black/60、tracking-widest；
168703的结果数量及168916的消息分类都用Wi。
使用维护中的PanelResizer，不复制发布bundle；沿用既有Raft来源/许可记录。
Multica没有更完整的同款Room/DM/Task搜索预览路径，未移植其状态模型。

原RAH固定560px列且无分隔拖动，消息列边框受普通会话布局规则覆盖，DM被排除在
搜索预览分支之外。切页时预览hook和URL查询没有一起清除，关闭Thread又只清了
Thread root，暴露同Room旧正文。搜索摘要在点击清除后也没有hover重新标黄。

## 唯一所有者

App与既有useSearchChannelPreview继续持有一个搜索预览选择，不增加消息缓存或业务路由。
Room、DM、Thread、Task都通过已有navigation.resolve鉴权与代次检查后替换这个选择。
Task在搜索右侧复用TaskDetailMetadata/ThreadPane，搜索之外保持既有居中任务弹窗。
宽屏X关闭全部预览并保留搜索结果，窄屏返回按钮执行同一关闭意图。
离开搜索切换主页面时清理搜索筛选和预览URL/选择；搜索历史属于已有独立历史功能，保留。
搜索结果未离开时刷新保留当前task/关键词参数，规范化不能丢失它们。

SearchPreviewResizer只维护两个布局宽度偏好，复用共享指针capture、取消及键盘实现；
1024px以下选紧凑宽度，767px以下预览独占内容区，返回后显示搜索列表。
剩余空间优先缩窄左列，右预览保留至少400px（分屏时）；CSS给频道和Thread同一2px左边框。
普通Room/资料页分栏所有者不变，不新建独立Task或DM业务路径。
结果摘要hover可重新标黄；下一次点击清除及目标蓝/黄定位沿既有表现hook。
结果数量及消息标题统一12px/16px、700、sans、黑60%、0.1em。

## 回归

新test-search-preview-layout-browser先复现缺少可拖动separator；URL单测先复现搜索
Task参数规范化丢失。浏览器覆盖实际拖动、宽度变化、窄屏返回、X关闭、hover关键词、
Agent/计算机/任务/聊天切换再回搜索清空，连续Room/DM/Thread/Task替换、Task刷新及关闭不
露出旧Room，字体和Thread边框。布局等待实际宽度收敛，不用固定延时证明正确。
旧回调fixture补充普通Room分支的surface/previewJoined，不削弱导航过期断言。

补充边界：先复现搜索Task预览切到任务主页面会残留一个任务弹窗，再将target/task/Thread
及Task选择一起清理。setSurface通过当前surface ref判断，保持稳定回调身份，避免移动主页等
既有回调持有旧surface闭包。离开主页面的清空与浏览器历史主动返回/刷新恢复是不同意图。

## 交付验证

Chromium、Firefox完整搜索预览专项通过；原搜索首页、消息定位关键词、任务详情历史
浏览器回归通过，已查看有真实结果的宽屏/390×844截图。URL规范化单测、旧导航回调
回归、完整npm run check通过；最终边界修复后再次完成类型检查及两浏览器专项。
format:check、git diff --check、build:web:workbench通过。
正式实例经空闲检查、持久状态备份校验后优雅重启，冻结构建为
`94db1736f172d1c7a1f718b1d53c7c90d17e509e4e0482b86c3742e4d0a869f6`。
本机/LAN/Tailnet新页面验证实际拖动、预览X、摘要hover标黄、900px压缩及390px返回，
离开到Agent/计算机/任务/聊天再回搜索清空，Task替换和关闭后无旧频道。
截图等待已有回复数据加载完成，未把初始加载占位当成验收结果。正式验证未发送消息、
变更任务或运行付费Provider；DM通过隔离真实浏览器覆盖。
未执行同前提在线Raft双边验收；源码参数移植、隔离浏览器与正式页面分别记录。

## 搜索结果列表关键词保留（后续修正）

按用户最新明确约定，左侧搜索摘要标黄由当前查询派生，不再使用正文定位的
`useMessageHighlight` 点击清除机制，也不依赖 hover 恢复。点击跳转、正文点击、关闭预览和滚动均保留列表关键词。
正文的蓝底与黄色定位提示仍在跳转后的下一次点击清除，滚动不清除；离开搜索仍清空查询和结果。
此规则覆盖本记录先前“摘要点击清除后 hover 恢复”的实现描述，是用户指定的呈现规则。

`test-search-preview-layout-browser.mjs` 增加全列表 mark 数量断言：先等待结果加载，点击结果后移走鼠标，点击其他区域，再滚动。
修复前点击跳转后 mark 数量变为 0；修复后列表持续保留。正文规则继续由原有定位入口场景验证。

该后续修正的全套检查、格式检查、正式构建及 Chromium/Firefox 搜索布局与正文定位回归通过。
正式工作台完成状态备份与安全重启；新页面在 localhost、LAN、Tailnet 验证左侧标黄在跳转、移开鼠标、滚动、清除正文定位和关闭预览后保留。

## 搜索预览 Room 关闭按钮间距

用户要求保留 RAH 的搜索预览关闭能力，作为相对其观察到的 Raft 行为的明确差异。
ChannelHeader 原先把 X 放在 head-actions 外，实测相邻间距分别为 6px、12px。
关闭按钮现与搜索、设置共同使用维护库 `.rah-panel-header .head-actions` 的 6px gap。
私聊预览沿用同一按钮组；窄屏隐藏 X 并保留返回搜索结果，不新增关闭路径。
浏览器测试先复现 12 !== 6，再验证三个按钮实测间距相等，同时回归关闭、返回与左侧关键词保留。

间距修正的全套检查、格式、正式构建及 Chromium/Firefox 搜索预览场景通过。
备份并安全重启后，三个正式入口的新浏览器页面均实测 Room 右上角间距为 6px/6px，关闭保留结果，窄屏返回正常。
