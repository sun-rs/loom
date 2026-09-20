# 设置页已归档频道卡片规格

Raft v1.16.0 发布源码 `index-CKeqacxz.js`（commit
`ba2a1dbac175595f28dfe1c09e4df2556d59ac0c`，SHA-256
`7841ee0f6f5ea6d58c0fb9a8a9e509807a3df2a0fe9485cbd11215d42bcb393b`）：
`Bdt` 归档卡片调用 `Yp(interactive=false)`，其基础类为
`border-2 px-4 py-3`，即 2px 边框、左右 16px、上下 12px。
取消归档采用 `gt(size=sm,shape=iconText,tone=lime)`；`S9e.sm.iconText`
是 `h-7 gap-1.5 px-2.5 text-xs`，配合 `leading-none` 及 14px 图标：
28px 高、6px 间隔、左右 10px、12px 字号/行高。
沿用[复用台账](2026-08-29-raft-multica-reuse-ledger.zh-CN.md)的许可与分析边界；
仅将源码规格移植到维护中的 ui-tokens/settings.css，没有生产 bundle 依赖。
既有 owner 足够完成，不引入 Multica 组件或第二套卡片。

本地此前卡片上下 16px、按钮 38px，造成卡片和操作区偏大。本批按上述数值
调整；边框保留已正确的 2px black/30。按用户之前要求保留红色无文字删除按钮，
同步为 28×28px、14px 图标，与恢复按钮等高。删除本地 daemon/中央服务器
说明文字，不改变归档、恢复、删除业务行为。

`scripts/test-settings-archive-browser.mjs` 先断言现有 16px 与目标
12px/16px 不符，再验证准确内边距、边框、按钮高度、字体、图标，以及说明文字
不存在；保留取消归档/删除图标等高、390px 响应式、打开归档频道、恢复与未读
确认等真实隔离流程验证。

验证结果：Chromium、WebKit 的隔离归档流程均通过，覆盖 1440px 与 390px；
已检查两种尺寸的截图。TypeScript 检查、正式 Web bundle 构建及
`git diff --check` 通过。全仓库 `npm run check` 仍阻断于既有
`/v1/worker/message-present` 未登记 surface；`npm run format:check` 仍报告
5 个本批未修改文件的格式问题，未将其标为通过。

正式工作台已通过守护脚本完成活动检查、持久状态备份和优雅重启，运行当前构建
`d0f974bfc613c204dcdf54ca8fdf6e9344e6071a8e9aacd15c7ee009c521c77b`。
重启后新建浏览器页面只读检查真实服务器设置：卡片内边距与 2px 边框、28px
操作按钮、14px 图标和说明文字移除均通过，并检查正式截图。未操作真实频道的
归档、恢复或删除，未运行付费 CLI。本批属于源码规格对齐加本地浏览器验证，
不宣称完成同视口的在线 Raft 双边验收。
