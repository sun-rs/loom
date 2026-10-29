# PWA 顶部、任务切页与 Role 保存返回修复

范围是已复现的三个前端缺陷；后端、通知传输、配置修订/冻结规则与官方版本pin不变。

## 根因与改动

1. **顶部先白后黄**：`AppThemeProvider.ModeContext`把theme-color写成canvas，
   子层`WorkspaceTheme`又写frame。实际初次提交捕获到两次canvas写入，覆盖了黄色。
   移除设备模式层的写入，WorkspaceTheme成为唯一chrome颜色owner；它只观察原生
   ThemeProvider提交的mode class，避免其passive effect晚于子layout effect而滞后一档。
   PWA的html/body底层及既有顶部安全区也改用frame token绘制，不增加padding、遮罩或新配色。
2. **任务首次切换闪屏**：并未重新加载整个文档，也未重建外壳；首次Tasks模块未到时，
   通用PanelFallback不含标题栏，导致黄色标题消失、正文一片白。
   将现有官方任务标题提取成同一生成叶子`OfficialTasksHeader.generated.tsx`，实际页面
   与按需加载占位共用它；其JSX仍来自原有锁定source。保留按需加载，不一次加载所有页面。
3. **保存后返回仍问放弃**：父AgentPage保存回调清理过dirty，但旧编辑器的内联回调在
   重渲染时又报告true；新revision替换profile时，没有释放父级标记。
   RoleProfile现在只通过一个layout effect汇总本地编辑器dirty并在卸载时释放，子回调
   直接使用稳定的state setter。取消也同时释放对应局部状态；未确认/拒绝保存不作成功清理。

原生mode provider、任务标题和相关源码hash/兼容记录继续保留，未手改生成输出或immutable原件。

## 复现与验证

真实临时Core、Fake目录，390×844，默认缩放，无付费生成和正式配置写入。
新浏览器探针先失败；增加原生标题占位和单chrome owner的单测也先失败。
深浅切换另发现DOM class提交顺序滞后，`mode-before.json`及失败保留，再修正。

| 现象                      | 修前实际值      | 修后                 |
| ------------------------- | --------------- | -------------------- |
| 初始chrome被写为canvas    | 2条捕获记录     | 0条                  |
| Tasks模块被挂起时可见标题 | 无              | 任务／加载中         |
| 切换时同一Shell／Document | true／true      | true／true           |
| 确认保存后点击角色列表    | 弹出放弃提示    | 正常返回             |
| mode class变dark后chrome  | 仍为light frame | 与实际dark frame相同 |

- Chromium及WebKit均通过上述浏览器复测；采用保存数据模式禁用代码预热，并明确挂起
  Tasks模块请求以覆盖首次加载。没有把观察到的闪屏误当成整页资源重载。
- 409拒绝保存后继续保留草稿及离开确认，继续编辑仍保留修改。
- 桌面1440×1000与手机390×844的现有运行时回环复验通过，保存后分别切换Role／返回列表
  无误提示；AGY与Kimi标准/快速的精确binding、冻结实例语义继续保留。
- 57项定向检查、类型、构建通过；包含原生生成一致性、来源完整性、UI合同、按需加载/
  预热、主题、路由写入围栏及构建后自适应CSS。构建既有chunk提示保留，无全仓或付费重测。

截图tasks-pending.png/tasks-ready.png为WebKit模拟视口、无OS状态栏。初次Role探针未给
单档Fake模型固定low，触发表单校验；修正的是fixture，未为此放宽产品校验。

## PWA 证据边界

本地确定了竞争写入、安全区底色及冷加载标题消失的问题，但桌面WebKit并不等于安装在
iPhone上的PWA。当前Chromium的媒体/安全区模拟接口未能提供真实standalone和设备inset；
不把注入CSS或虚拟视口宣称为原生OS状态栏验收。

Apple的[Web App配置说明](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html)
区分standalone状态栏；[WebKit维护者说明](https://bugs.webkit.org/show_bug.cgi?id=301756#c2)
说明新版Safari会根据贴近视口边缘的固定元素处理颜色延伸。因此同时修正实际底色与meta，
保留原生安全区几何，实体设备最终渲染仍需真机确认。

复测命令：

```sh
LOOM_BROWSER_SLICE=ui-state-repair LOOM_UI_REPAIR_ASSERT=1 node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_ENGINE=webkit LOOM_BROWSER_SLICE=ui-state-repair LOOM_UI_REPAIR_ASSERT=1 node scripts/official-web/channel-browser.mjs
LOOM_BROWSER_SLICE=runtime-sidebar node scripts/official-web/channel-browser.mjs
```

部署及正式页面复查另存本目录收据。终端文本只规范行尾空白，失败结果保留。
