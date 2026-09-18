# PWA 顶部背景延伸

Owner：`apps/web` 的移动外壳。仅处理顶部背景，不改变导航、标题尺寸、滚动、Composer 或业务状态。

## 依据与原因

- [WebKit 安全区域指南](https://webkit.org/blog/7929/designing-websites-for-iphone-x/)：`viewport-fit=cover` 配合 `env(safe-area-inset-top)`，背景延伸、内容避让；不按机型固定高度。
- [Apple 状态栏 meta 文档](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariHTMLRef/Articles/MetaTags.html)：`black-translucent` 允许内容延伸至状态栏后方，不是自定义颜色接口。
- WebKit 主线 revision `878aa5b6567ce8b27dc935282c8f417351413f95`，[LocalFrameView.cpp](https://github.com/WebKit/WebKit/blob/878aa5b6567ce8b27dc935282c8f417351413f95/Source/WebCore/page/LocalFrameView.cpp)，`fixedContainerEdges` / `containerEdgeCandidateResult`：全视口 fixed 容器可优先保留已有边缘颜色；`primaryBackgroundColorForRenderer` 忽略高度不超过 10px 的细边。这是 WebKit 上游实现证据，并非已经证明用户设备运行了这个具体 revision。

此前 RAH 将整个应用固定在 viewport，切页只改变根背景并同步 theme-color；
自动测试证明了 CSS 改色，未证明 iOS 系统状态栏重采样。全视口颜色保留分支
与用户报告一致，但缺少连接真机的 Web Inspector 数据，不能称为真机根因已证实。

## 首轮实现（已被下方背景分层修正取代）

移动导航 owner 始终在 body 挂载一个无交互、aria-hidden 的固定顶部背景层，
包括不显示底栏的子页。它使用既有 `--rah-mobile-canvas`，不重复页面颜色判断。
高度为 `max(12px, env(safe-area-inset-top))`，宽度跟随 viewport；12px 是避开
上述细边排除的采样下限，不是 iPhone 状态栏高度。桌面不挂载，pointer-events 为 none。
保留现有 meta 同步作为兼容回退。未复制 WebKit 代码；上游 LGPL 源码仅作分析依据。

## 真机截图反馈后的遮挡修正

用户随后报告搜索框上边框消失、根页图标上边框变细。正式页以 430px 宽、
safe-area-top=0 复现：12px 背景覆盖了 y=9px 的搜索框 3px、y=11px 的图标 1px。
隐藏背景层立即恢复边框。根因是绘制层采用最小 12px、布局只避让 env 值，
两者不一致；pointer-events:none 不会阻止视觉遮挡。

修正为共享 `--rah-mobile-top-inset: max(12px, env(safe-area-inset-top))`：
背景高度、应用外壳留白、首页定位，以及全屏任务详情/频道设置顶部与可用高度
消费同一个值。标题本身仍为 60px，不改控件尺寸和业务行为。安全区域不足 12px
时额外保留差额空间，避免采样层压住控件；中央审批弹窗不改布局。

新增浏览器测试在 0/5/12/59px 下比较背景显示/隐藏时搜索框及四个根页标题控件
截图的完整像素，断言相同，并检查控件位于背景层下方。原实现先在零安全区域
布局断言失败；全屏任务详情原实现的顶部按钮避让断言也失败。修正后两项及
Chromium/WebKit 页面切换回归通过。此前仅验证颜色和尺寸、遗漏遮挡的验收不足
由这组像素断言补齐；不代表 iOS 系统状态栏已经真机验收。

## 当前方案：背景分层与系统安全区解耦

用户指出标题背景应位于控件下面。上述避让虽消除了遮挡，却将绘制层的 12px
下限变成额外布局空间。当前撤销该下限与 body portal：顶部背景是移动外壳的
直接子节点，外壳 `isolation:isolate` 建立局部层叠上下文，背景 `z-index:-1`
位于外壳底色之上、全部页面内容之下。它不占 grid 轨道、不参与交互。

背景高度为系统安全区加既有 `--head-h` 标题轨道，覆盖安全区及标题背后；
不再用任意采样最小值推导布局。`--rah-mobile-top-inset` 仅取
`env(safe-area-inset-top, 0px)`，页面、首页侧栏与全屏详情弹层共用该系统值。
白页/黄页仍消费既有 `--rah-mobile-canvas`，颜色判定和 theme-color 同步不分叉。

当系统安全区为零时，顶边命中标题而非背景；共享移动标题和全屏详情标题使用
`position:sticky; top:0`，让标题本身成为 WebKit 的有限高度候选，而非由其祖先
全视口 fixed 容器触发颜色保留。标题仍处于原布局轨道，内部滚动所有者不变。
这来自上述 WebKit `containerEdgeCandidateResult` 对 fixed/sticky 的处理，
不代表当前桌面 WebKit 已测试真实 iOS 状态栏。

新增断言先在旧背景尺寸失败。新回归确认 0/5/12/59px 下布局没有额外留白，
背景显示/隐藏时控件截图逐像素一致；59px 下临时将背景改成异色，安全区截图
随之改变且控件不变，验证负层背景确实可见而非掉到 document 背后。
页面切换、全屏覆盖层、固定标题/导航/Composer 的 Chromium 与 WebKit 回归通过。
WebKit 源码是设计依据，桌面 WebKit 的 DOM/像素检查不证明 iOS 系统取色结果；
最终系统状态栏仍需在真实安装的 PWA 验收。

本轮完整 `npm run check`、`format:check`、`git diff --check` 与
`build:web:workbench` 通过。正式实例经空闲检查、备份核验与优雅停止后重启，
保持原入口；冻结 Web build 为
`fd60c662a6fcf603a7968064a136d4cba88bc986e4ff4d8185ae87ad5fbb23aa`，
health build identity 为 `7d39e2ddaedb6824`。新开 Chromium/WebKit 从现役 LAN
入口验证首页、搜索、任务、设置、刷新及桌面恢复，控件显示/隐藏背景的截图一致，
无页面 JS 错误；已检查正式截图。系统状态栏真机验收仍独立待完成。

## 先前部署的验证边界

- 先增加独立顶部背景与尺寸检查，旧实现因缺失绘制层失败，再实现修复。
- Chromium：模拟顶部安全区域 0/20/59px、390/430/744px 宽度，标题位置与交互滚动回归通过。
- Chromium / WebKit：首页、搜索、动态、任务、成员、设置、Room、私聊及任务/频道设置覆盖层切换通过。
- 已检查模拟安全区域截图。桌面浏览器及模拟 safe-area 不包含真实 iOS 状态栏；真机验收仍待完成。
- `npm run check`、`npm run format:check`、`git diff --check` 与 `npm run build:web:workbench` 通过。
- 正式实例经空闲检查、状态备份核验与优雅停止后，使用冻结 Web 资产重启；原 loopback / Tailnet / LAN 入口保留。
- 遮挡修正部署 Web build：`b0a04dd2feabe67d90e77b986ab56d82315cdb4ae565531b7f51f1a5e940e226`；health identity `eee7c977c6816233` 与候选构建一致。
- 新开 Chromium / WebKit 正式浏览器验证首页、任务、搜索、Room、刷新与桌面恢复；无页面 JS 错误。正式浏览器截图已检查，仍不等同于 iPhone 系统状态栏验收。
