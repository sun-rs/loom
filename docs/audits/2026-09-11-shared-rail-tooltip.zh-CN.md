# 侧栏共享 tooltip 收口

来源：授权 `docs/evidence/raft-web-20260908-current/index-BVfbaScj.js`，SHA256 `65dda3865ac7263afb44308e22bcdc20034e84f886f78767f7198a65c5691dde`。设置入口使用 `zi`，与其他侧栏入口共享：`zi → Bc → qLe/VLe/JLe`。`zi`默认向右、白色；JLe间距6；pR定义2px边框、小阴影、水平10px/垂直4px、13px/18px粗体、150ms透明度/缩放动画，brutal箭头hidden。

根因：RAH `RailButton`用原生title，浏览器负责显示；这不是设置单个图标的问题。采用现有Base UI Tooltip（仓库已安装1.3.0），新增共享HintTooltip于ui-web，视觉参数归ui-tokens；现有RailButton组合它，保留button事件、ref与弹层触发传参。帮助原有悬停资源菜单不叠加tooltip，其他页面的title没有批量替换。属于结构和样式参数移植，不宣称复制整个上游组件。

本地显式保留role=tooltip以便辅助技术与验证定位；Base UI负责悬停、焦点、Escape和点击关闭。未自行写第二套浮层定位算法。默认延迟沿已安装Base UI；官网是否存在全局Provider延迟覆盖，本轮未实测确认。

浏览器测试先确认旧实现title=设置而非null，失败后才修改。测试真实Rail组件的设置、搜索、聊天、Agent与成员、计算机：无原生title、自定义内容/字号/边框/内边距、悬停、焦点、Escape及移出关闭。开发fixture首次依赖优化曾触发重复React加载，重开fixture后消失；记录为开发验收环境问题，不当作正式产品通过证据。

验收：五个入口的真实Chrome fixture通过；Settings回归通过；业务Chrome门禁通过（将旧title定位改为原有aria-label，未削弱导航结果断言）。`npm run check` 的仓库、类型及后端阶段通过，Web单测最初发现动态transform-origin变量缺fallback；补center后重跑Web单测、parity regression、formal browser policy及bilateral capture tests全部通过。最终类型检查、格式与diff检查通过；正式bundle已重建。

正式实例经空闲检查、验证备份后优雅重启，保留原状态。独立Chrome确认构建 `90358c5c11a8be860739611365460391850dbdc53398c58fdfa3f86e47f03b7e`，设置悬停出现自定义提示、无title，点击后提示消失且打开账户设置。截图 `/Users/sun/Code/reviews/rah_os/2026-09-11-tooltip/formal.png` 已目视检查。未执行Agent工作或付费模型，未提交Git。

边界：这次关闭的是共享RailButton原生tooltip差异；不是全站title迁移，也没有新增官网同条件延迟测量。后续其他图标先定位其上游触发组件，再决定tooltip或交互popover，避免破坏本来不同的交互。
