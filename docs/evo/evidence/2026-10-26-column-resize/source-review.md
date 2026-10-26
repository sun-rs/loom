# 消息列分栏兼容移植

锚点：Web 1.21.34 app-shell-BWgtfY02.js / app-shell-C3nLSlu4.css。来源与摘要记录于 frontends/raft/upstream/published-2026-10-26/manifest.json。

- column-resize.js：官方 oOe 至 LF 连续函数体保留，仅导入 React、Intl、浏览器 layout effect 和外部 Loom UI 宽度注册表；没有引入 upstream server/domain store。
- thread-layout.css：从 .thread-layout-container 到最后消息列专注规则的原始 CSS 字节；替换外层 index.css 的旧规则。消息列双栏从720px起、正文至少360px；保持官方横竖屏条件。
- 注册表把存储键替换为 Loom 前缀；迁移已有 loom:threadPanelWidth；Side 使用独立 side 键并迁移 loom:sidePanelWidth。不读取、删除上游 slock 存储。
- ThreadWorkspace/SideWorkspace 使用同一官方 resize component；动态最大宽度保留相邻正文最少360px，不再采用窗口60%。消息列与Side仍保留独立持久化宽度。
- 消息列专注状态由 ChannelApp 按当前根消息拥有，使用原有官方 data-thread-maximized CSS；不导航、不卸载、不触发关闭或业务写入。覆盖资料页或手机无可见频道主栏时不允许进入专注。更多菜单新增官方 Maximize2/Minimize2 和显示/隐藏频道项。
- 键盘16px、Shift64px、Home/End、Enter专注、双击复位、pointercancel/blur清理由原始 LF 处理。函数行为测试调用原始组件产生的处理器，检验阈值、恢复和清理。

验收范围：消息列/Side调宽与消息列专注。本批未实现列表/主侧栏拖小折叠、移动滑动或新版全部侧卡堆叠交互，不能宣称整个 shell 已对齐。Side 本批仅替换调宽机制，不新增专注入口。

预览代理禁止关注/已读写入，出现“关注者无法加载、已读未确认”属于该只读环境限制，不能把它当作正式服务测试成功；正式服务另行核验。首次手机菜单验证读到了旧构建；最终重载后菜单只有关注项、无桌面隐藏频道操作。
