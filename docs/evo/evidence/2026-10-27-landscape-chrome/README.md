# 触屏横屏频道顶部合并验收

产品提交 `e97291b5`，2026-10-27安全部署；正式服务备份重启20项业务表和推送状态保持不变，receipt：`/Users/sun/.loom/reviews/2026-10-27-landscape-chrome/restart.json`。本轮没有消息发送、任务创建或付费CLI调用。

## 官方来源与本地例外

Raft Mobile `eff04722b5904a0d001115d90d3ec49d59fb4f03` 的 `compose/shared/src/commonMain/kotlin/build/raft/app/RaftAppShell.kt` 明确保留宽屏topNavigation（Web AppTopBar），它位于leadingNavigation及正文之上。Web选定源码db5e399生成的OfficialTopBar使用h-12。因此横屏多48px是官方宽屏组合的成本，不是单个字体错误。

本次为owner授权的Loom布局优化，**不宣称是官方已有行为或字节复用**：

- 仅coarse、宽度≥840 CSS px、横屏、显式进入已解析主频道正文时收起全局顶栏。
- 顶部频道搜索保留；复用现有NotificationTrigger的mobile-navbar场景，44px触控目标，将通知入口放到频道标题栏。
- 频道列表、搜索/其他大页、消息列、Side、频道内私聊保持原顶栏；桌面fine指针和竖屏不变。
- 快捷键全局搜索逻辑保留。全局顶栏隐藏时清除零尺寸搜索锚点，使用官方SearchOverlay的fallback布局。
- 不修改官方不可变源码或生成文件，不改字体、行高、头像、按钮规格、输入区、左导航或分栏门限。

## 同条件实测

正式服务同一Agent Council频道、折叠左侧列表、Chrome Sensors强制触屏。前后每个场景均确认coarse=true；全部正文14px/20px，输入区55px。模拟逻辑视口的设备假设和真机限制沿用[上一报告](../2026-10-27-foldable-touch/README.md)，不得当作真实设备测量。截图的滚动锚点未做逐像素断言，因此只报告容器面积，不夸大为可读字数提升。

| 探针   | CSS视口  | 正文高前→后 | 面积占比前→后 | 面积增加 |
| ------ | -------- | ----------- | ------------- | -------- |
| duo-p  | 626×890  | 738→738     | 82.9%→82.9%   | 0.0%     |
| duo-l  | 890×626  | 426→474     | 63.7%→70.9%   | 11.3%    |
| xt2-p  | 744×1061 | 909→909     | 85.7%→85.7%   | 0.0%     |
| xt2-l  | 1061×744 | 544→592     | 69.2%→75.3%   | 8.8%     |
| ipad-p | 834×1210 | 1058→1058   | 87.4%→87.4%   | 0.0%     |
| ipad-l | 1210×834 | 634→682     | 72.4%→77.9%   | 7.6%     |

三个横屏顶部145→97px，正文各增48px；所有竖屏宽高和字号保持。横屏相对竖屏正文面积仍较小，原因是固定栏位占用更宽的横向带状区域，并保留57px左导航；本次不追求用字号变化抹平几何差异。

## 验证

- 先添加失败测试，再实现；6项路由/断点/控制接线检查、1项实际构建CSS检查通过。
- Loom类型检查、产品构建通过。
- 6个coarse视口正式页面DOM和截图完成，见before.json/after.json与before-_/after-_.png。
- 通过原生Chrome辅助功能点击移动通知按钮，打开“暂无通知”，Escape关闭；截图notification-open.png。
- 频道搜索进入实际搜索页，顶栏恢复；全局快捷键进入搜索，缩窄后进入原生全页搜索。
- 草稿横竖屏转换保留、最终清空，没有发送；回列表顶栏48px恢复。
- 恢复fine指针后顶栏48px、频道内替代通知隐藏；控制台无error。恢复Sensors默认与viewport默认，关闭DevTools。

## 尚未覆盖

真实设备软键盘、安全区、地址栏、系统缩放以及其他大页的密度未新增验收。主频道之外保留原组合，本次不是全站顶栏重构。

## 截图

- duo-p：[前](before-duo-p.png) / [后](after-duo-p.png)。
- duo-l：[前](before-duo-l.png) / [后](after-duo-l.png)。
- xt2-p：[前](before-xt2-p.png) / [后](after-xt2-p.png)。
- xt2-l：[前](before-xt2-l.png) / [后](after-xt2-l.png)。
- ipad-p：[前](before-ipad-p.png) / [后](after-ipad-p.png)。
- ipad-l：[前](before-ipad-l.png) / [后](after-ipad-l.png)。
