# 单条导航与动态触屏完成

Owner要求：底部首页/动态/任务/搜索/更多合为一条胶囊；更多继续使用官方MobileNavServerPopover，四个成员/计算机/设置/记忆使用相同Destination并列。不再有独立字母胶囊和单独记忆行。

根因：已取得的官方 Web1.21.34 ThreadsInbox-CM-EY6gw.js 中 `J = a !== void 0` 表示滑动绑定存在；行操作用 `reveal: J ? undefined : hover` 和 `className: J ? fn : undefined`。`fn`为sr-only并在focus-visible时恢复可见。Loom原生成文件已经包含fn，但未导出/绑定，导致触屏网页同时出现直接对勾和滑动完成。现在通过生成器导出原样fn并应用同一条件；不修改官方原件。源码URL/hash已在activity-swipe-manifest.json，依赖包仍为@botiverse/raft-ui0.35.1（MIT）。

范围：使用原有窄屏且coarse-pointer条件；手机视觉入口为左滑完成（原生全幅滑动亦保留），提供原有撤销。键盘辅助功能仍可聚焦显示直接对勾；桌面/鼠标保留hover对勾。没有拿到最新版iOS App源码，不能将Web证据称为iOS源码验证；它与owner观察一致。本批不改变状态提交、队列或完成语义。

验证：新增两项回归先失败再通过，12项定向source/gesture/undo测试、6项DOM触摸/撤销测试、类型检查与产品构建通过。390×844浏览器验证单条导航及四项并列菜单。正式重启与页面证据见summary.json。未运行付费CLI或全仓测试。
