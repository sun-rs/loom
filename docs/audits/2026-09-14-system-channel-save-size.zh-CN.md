# 系统频道保存按钮尺寸

Raft `SettingsPanel-Ce-jc2IN.js` SHA256 `2e495cc201cab8fc446c1fede39b81306c685083554104254146796df1ca2f65`，授权展开源码 7600 行附近的系统频道表单保存按钮使用 `btn-brutal bg-brutal-pink px-3 py-1.5 text-xs flex items-center gap-1.5`，成功状态 SVG 为 14px。发布包只作分析，没有引入生产依赖或更改原许可证记录。

RAH 原按钮继承通用 btn 的 13px 字号、8px/14px padding，实测高度 38px。本次仅在 `.rah-system-channel-card > .btn` 修正为 12px/16px 字号行高、6px/12px padding、6px gap，得到含边框 32px 高度；内部 SVG 统一 14px。不新增保存状态或改变系统频道命令。

`test-all-channel-members-browser.mjs` 先复现旧尺寸失败，修复后验证保存按钮几何及原有隐藏/恢复持久化操作。临时夹具测试，不修改正式 #all 设置。专项浏览器门禁、全量 `npm run check`、`npm run format:check`、`git diff --check`、正式 Web 构建通过。全量首轮遇到并行附件评论测试夹具不合法来源值，夹具修正后完整重跑通过。正式服务完成空闲检查和持久数据备份后安全重启，冻结 Web 构建 `e523e2194c3ef22c6115c53addf6bb25fb61b9b9e52515f9f6d0cc07812f9425`；本机、局域网、Tailnet 三个地址的新浏览器页面均确认 12px 字号及 32px 按钮高度，并检查截图。正式 #all 配置未修改。
