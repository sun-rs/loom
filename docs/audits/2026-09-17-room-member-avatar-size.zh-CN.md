# Room 设置成员头像尺寸修复

截图对应频道设置的成员头像预览区。Human 使用带橙底、黑框和阴影的 36px 外按钮，
内部却给 `ProfileImageAvatar` 传入 `compact`（20px）；Agent 使用无装饰触发器和
`header`（36px）。上传图片因此出现大框套小图。不是上传图片分辨率或图片内容的问题。

修复只改 `room-dialogs.tsx`：Human 同样使用 `rah-channel-avatar-trigger`，
头像尺寸为 `header`。尺寸继续由共享头像 owner 决定，不添加局部缩放、padding 或 CSS 覆盖。
上传图片、预设头像、文字占位都保留单个 36px 黑框；图片内侧为 32px。
频道正文、成员管理列表和头像原文件不受影响。

来源为现有 Raft 头像尺寸合同（Avatar `md` / `size-9`），详见
[标题尺寸源码证据](2026-09-15-pwa-navigation-and-task-stability.zh-CN.md)；
本地 `identity.css` 与 `room-member-pages.css` 已维护相同 36px 参数。
本次修正使用场景接线，不重新定义上游尺寸。

`npm run test:web:room-member-avatar` 在临时 daemon 上实际上传测试图片，
另覆盖预设头像和文字占位；1440×900、390×844 验证头像尺寸、图片加载、
内外框偏移、无外层边框/阴影，以及点击后进入成员管理。
旧实现先失败：上传 Human 头像实测为 20×20，而预期为 36×36；修复后六个场景通过。
截图等待抽屉入场动画结束后采集，输出 `rah-room-member-avatar-WwSwuS`（系统临时目录）。

正式验收时通过 `RAH_FORMAL_ORIGIN` 只读取现有头像，不上传或修改用户资料。
`npm run check`、`npm run format:check`、`git diff --check` 和正式 Web 构建通过。
确认正式实例空闲后校验备份
`~/.rah/backups/pre-restart-2a00c464-45d7-4923-96ce-b137dec1a98f`，
正常停止旧进程，新进程 `94321` 保留原有三个监听地址和 4173 端口。
Web build `b1905f9aede6d934b9dca5f47e12ef22b29dab7f1ab4fa2b408c4597905b32ac`，
health identity `49c1ff86394af587` 与构建一致。
真实头像在正式桌面与 390px 页面通过同一尺寸、图片加载和点击断言，
截图 `rah-room-member-avatar-38SV6q` 已人工检查。
未运行付费 CLI 或物理 iPhone 测试；未提交或推送。
