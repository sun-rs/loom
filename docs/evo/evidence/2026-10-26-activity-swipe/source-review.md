# 移动动态行手势（2026-10-26）

来源：已取得的 Web 1.21.34 `ThreadsInbox-CM-EY6gw.js`，URL/原始SHA256/声明摘要见 `frontends/raft/upstream/published-2026-10-26/activity-swipe-manifest.json`。授权及 notices 沿用 adoption.json。锁定函数正文经生成器原样接入；这是 production-resource port，不是最新完整公开应用源码。

官方 xn 的启用条件是 `(max-width: 767px)` 与 `(pointer: coarse)` 同时成立。不是全站滑动返回。Ht/Lt/Rt/zt 的规则包括：两侧24px避让，横向20px才判断接管、纵向优先，超过行宽60%完整滑动，800px/s速度阈值，200ms收尾，取消不提交，400ms抑制合成click。Pt负责另一个行被点击时先关闭已展开操作、避免误开会话。

Loom直接复用上述处理器、CSS recipes及点击抑制函数。外层 useActivitySwipe 只管理当前展开行ID、媒体条件和点击外部关闭；ActivityMessageRow 绑定现有 done、pending和activityFrontier。done仍通过既有 activity.mark 与原请求前沿执行；未知结果重读而不自动重发。完整滑动不等于任务完成。

本批只提供已绑定的完成按钮，宽度沿用官方单动作72px；不为每行增加状态/权限查询。官方静音与取消关注滑动按钮未接入；取消关注保留既有右键菜单。官方撤销toast也未移植，不宣称全套 swipe actions parity。原有键盘/右键/完成按钮继续提供可访问入口，滑动按钮沿用官方aria-hidden/tabIndex=-1策略。

测试直接运行锁定的原生hook及判定函数：鼠标不触发、边缘与纵向滚动不抢占、完整滑动恰好提交一次、取消不提交、误点击抑制、声明摘要不变。桌面与390px浏览器检查仅覆盖布局及非coarse设备不启用；真实iOS/Android滑动送达及触觉仍待验收。
