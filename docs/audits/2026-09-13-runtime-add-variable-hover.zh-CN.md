# 添加环境变量按钮悬停对齐

## 来源与差异

参考 Raft 发布资产 `https://app.raft.build/assets/index-MqTUR4Ez.js`，SHA-256
`9cf480531f38c29136637f7b373f285a0e915711c07dbebeadd22c05b33ad443`。
本地只读证据位于 `/Users/sun/Code/reviews/rah_os/2026-09-13-dialog-audit/`。
pretty 源码 102830 的 JWe 使用 Button ghost/sm；49249 的 ghost 定义透明底和透明边框，
hover 切换 line-strong 边框与 fill-muted 背景。`index-DPaRRgFJ.css` 的 brutal 色值分别为
`oklch(18% .006 25)` 和 `oklch(96.45% .0002 25)`。

RAH 原实现无边框，hover 使用黄色 soft-signal。现由原 owner
`apps/web/src/agent-directory.css` 修正为上述规则，28px 高、12/16px 粗体、
14px 图标、5px 间距、水平 10px 内边距；预留 2px 透明边框避免 hover 位移。
复用现有前景与边框 token，不修改环境变量保存逻辑。此为规则结构移植，不是 bundle 复制。

## 验证

- 官方 Chrome 实际页面读取按钮：91×28、12/16px、700、透明 2px 边框、5px 间距、0/10px 内边距。
- 官方 hover 依据上述源码及用户截图；本轮浏览器控制接口未提供指针 hover，不冒称官方动态双边验收。
- `scripts/test-agent-launch-settings-browser.mjs` 先复现黄色/0px 边框失败，修复后通过。
  覆盖 hover/移出、矩形不变、环境变量保存回读、重复键拒绝和 390px 窄屏；使用独立临时状态及假 Provider。
- 已检查实际悬停截图 `/tmp/rah-add-variable-hover.png`。正式构建与部署结果在交付时单独核验。

## 正式交付

`npm run check`、`npm run format:check`、`git diff --check`、正式 Web 构建均通过。
在空闲与进程身份复核后，完成持久状态备份
`/Users/sun/.rah/backups/pre-restart-1c935718-e842-4c0d-aa88-b808b8934d02`，
通过既有 SIGTERM 关闭并由 launchd 启动冻结构建
`6bb4651ce1f1a8bcd1acfc9eade23bf2f373cec409c52161ce431d44a5a3e9f3`。
新 Chrome 正式页面已加载该构建并打开真实 Agent 配置弹窗，按钮实测 91×28、12px、
2px 透明边框、5px 间距、0/10px 内边距，与官方读取一致。仅查看，未提交配置更改。
没有 commit、push 或付费 CLI 执行。
