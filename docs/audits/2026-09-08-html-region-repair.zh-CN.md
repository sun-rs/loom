# HTML 区域引用与回跳修复

## 来源与变更

依据 [官网实际矩形、发布刷新回跳及 iframe 源码核实](./2026-09-08-html-region-official-verification.zh-CN.md)，单一 owner 仍是 `HtmlFilePreview` / `html-preview-bridge.js`。本批不修改评论后台协议和权限，不新增运行器或付費模型调用。

结构移植官网 describeRegion 及其文字辅助函数：相交文字矩形、归一化、片段去重／拼接、200 字符上限、caret 与元素回退。跳转按最小包含元素匹配内联文字，重复引用按原选框中心最近匹配，无法匹配则保留坐标回退。桌面回跳保留选择层。高亮参数取自官方 `index-D8Neh8lc.css` 的 anchor-flash：`#ffd440`、1.6s ease-out、前 35% 保持黄色、随后透明；黑色 2px 边框，1800ms 移除。

上游 script SHA-256：`6b921a421b6f772fea3168813c80d319bb2785dc4103f167244132d9cd2ebed0`，来自授权浏览器页面实际 script DOM；无额外 license header 可保留，来源与用户授权边界沿用核实记录。原始脚本留在分析证据目录，生产仅包含适配代码。额外排除 RAH 自己的 overlay/highlight/script/style 节点；iframe 仍为 opaque origin、固定可信脚本、原消息来源及有界数据校验。

## 验证

`node --test scripts/html-region-parity.test.mjs` 先失败：跨段落选框只得到 Second paragraph；改代码后通过，覆盖跨段落、内联文字、重复引用、保留选择层和官方高亮颜色。生产附件门禁新增持久化矩形评论及刷新后回跳断言。生产包附件门禁在 Chrome、Firefox 均通过，包含跨段落真实拖框、评论写入、整页刷新、回跳与保留选择层；移动折叠、媒体、安全隔离、故障重试及 115 条／3 页分页回归通过，页面错误为空。两浏览器 HTML 截图已人工检查。此门禁使用隔离数据库和 Fake Provider，不污染正式数据。

- `npm run check`、`npm run format:check`、`git diff --check`、`npm run build:web:workbench` 通过。
- 证据：`/Users/sun/Code/reviews/rah_os/2026-09-08-html-repair/`，`results.json` 及 Chrome／Firefox HTML 截图。
- 正式服务通过空闲检查与校验备份后，从 PID 68965 优雅更换为 84999；备份 `/Users/sun/.rah/backups/pre-restart-06bfc9d0-43c1-4c68-835a-398cf1745b18`，未强杀。
- 正式地址 `http://127.0.0.1:4173/?surface=computers` 响应 build 与冻结构建 `485485c36beffdc58ad0020b3924840bfc314c2ae072a48e54acdae9c6e9ff6d` 一致；刷新真实页面显示 Computer 已连接、四家 Runtime、四个 Agent。截图 `formal-computer.png`。备份保留历史、Agent 配置和记忆，本批无业务数据迁移。
- 没有 Git 提交、推送或付费 CLI 测试。

## 验收边界

本批已修复官网核实指出的取文、定位、选择模式和高亮差异。官网行为实验与本地生产包门禁分别有证据，但未新增同一 team-mode.html 文件的逐像素双边比较；不把本批声明成整个附件页面或整个产品完全一致。
