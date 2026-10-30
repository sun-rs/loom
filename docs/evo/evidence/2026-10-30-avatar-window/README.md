# 头像弹窗尺寸修复

上批只检查了头像图案、44px选择格和4／8列，漏验了外层窗口及正文／底部按钮层级。这次按同一Web1.21.40整版代码核对，而不是根据截图猜尺寸。

## 根因与修复

官方`AgentDetailPanel-IaqbfbtM.js`的`AgentProfileEditDialog`明确传`className: max-w-lg`，头像分支`narrow: sheet`；DialogBody和DialogFooter是分开的。`max-w-lg`是512px，不能换成UI库的`size=lg`（640px）。手机sheet为全宽、90dvh。

Loom此前没有传调用点的宽度参数，继承npm原语的`md`默认448px；还把带底部按钮的整个form塞进DialogBody，产生额外间距，矮窗口下按钮跟着头像列表滚走。

现在仅头像入口转发原生`max-w-lg`，让表单用`display:contents`保留提交归属，包含一个原生DialogBody与独立DialogFooter。原生库继续管理宽高限制、padding、手机sheet／键盘和提交按钮；其他表单调用点默认行为不变，不改库recipe或全局尺寸。

## 定向验证

- [浏览器先失败](red.txt)复现448≠512；[DOM先失败](dom-red.txt)复现宽度参数丢失。
- [7个DOM检查](dom.txt)、[7项调用点／数据／焦点检查](checks.txt)、[类型](types.txt)与[产品构建](build.txt)通过。保留原有大chunk提示；不跑无关后端或付费CLI套件。
- [Chromium](browser.txt)、[WebKit](webkit.txt)和[Firefox](firefox.txt)：1440×720窄高度桌面确认512px宽、最大688px高、底部按钮独立且在视口内；390×844手机确认全宽、90%高，选择／保存／刷新及描述／prompt不串改。一个DialogBody，Footer不在Body内，无页面异常。
- 同尺寸截图：[之前1440×720](before-1440x720.png)、[修复后1440×720](after-1440x720.png)、[手机](after-390.png)。均为真实临时Core的fixture页面，不是正式用户入口。

已推送`ed73dc3e`及Firefox检查`af187545`，完成备份、空闲检查和平滑重启。[部署收据](deployment.json)核实schema91、12个保护表与通知／记忆文件保持；LAN／Tailnet原CA验证通过。[正式只读页面](formal-page.json)实测桌面512×688、正文高592／内容815，底部按钮位置704；手机390×759.59（844的90%）、正文高704／内容1275，提交在顶栏。72款SVG仍与原图数据一致，无配置写入或页面异常。[正式桌面](formal-1440.png)、[正式手机视口](formal-390.png)。

Firefox首次运行因Playwright不支持isMobile模拟而[中止](firefox-harness-failure.txt)，并非产品失败；改用其支持的viewport／touch参数后同尺寸检查通过，不把它当作实体移动Firefox或iOS模拟。
